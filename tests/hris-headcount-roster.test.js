// Engineer headcount from a privacy-preserving HRIS roster (#1105).
//
// WHAT THIS FILE HOLDS THE IMPORT TO:
//   1. THE CONTRACT IS THE SPECIFICATION. Every rule asserted here is read out
//      of contracts/integrations/hris-headcount-roster/v1/manifest.json, and the
//      version string in the document and in the module are asserted equal — a
//      rule that changes in one and not the other fails here.
//   2. AN UNLISTED COLUMN IS REFUSED, NEVER DROPPED. Exercised against a real-
//      shaped HRIS export carrying names, emails, employee ids, a manager and a
//      location, which is the file a reader is most likely to try first.
//   3. A REFUSAL LEAVES THE BRIEF WHOLE. The previously declared headcount and
//      the estimate above it survive every refused file, asserted by value.
//   4. ACCEPTED MEANS SUPPLIED, NEVER VERIFIED. Asserted on the answer block's
//      own attribute and on every code path the parser can return.
//   5. NOTHING LEAVES THE BROWSER. Asserted with fetch, XMLHttpRequest,
//      sendBeacon and both storages instrumented across a full accepted import.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, parseHtml, tabSequence, textOf } from "./support/browser.js";
import {
  ENGINEERING_CLASSIFICATION, HEADCOUNT_SOURCE, REFUSED_COLUMN_EXAMPLES, ROSTER_COLUMN,
  ROSTER_CONTRACT_VERSION, ROSTER_EXPECTATION, ROSTER_REFUSAL, ROSTER_REFUSAL_NOTICE,
  parseHeadcountRoster, rosterAcceptedSentence, rosterRefusalSentence, safeHeaderName,
} from "../src/hris-headcount-roster.js";
import {
  INTAKE_IDS, ROSTER_UNCHOSEN, currentHeadcountSource, setDeclaredFacts, setHeadcountSource,
} from "../src/finops-declared-fact-intake.js";
import {
  bindDeclaredFactIntake, importHeadcountRoster, pendingRosterImport, resetDeclaredFactIntake,
} from "../src/finops-declared-fact-intake-view.js";
import { EXAMPLE_DECLARED_FACTS } from "../src/finops-declared-fact-fixtures.js";
import { FOCUS_SPEC } from "../src/finops-decision-interaction.js";

const CONTRACT = new URL("../contracts/integrations/hris-headcount-roster/v1/", import.meta.url);
const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const view = await readFile(
  new URL("../src/finops-declared-fact-intake-view.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("manifest.json", CONTRACT), "utf8"));

const fixture = (name) => readFile(new URL(`fixtures/${name}`, CONTRACT), "utf8");
/** The real-shaped HRIS export already committed under the dialects contract. */
const personalRoster = () => readFile(
  new URL("../contracts/integrations/tabular-dialects/v1/fixtures/generic-hris-roster.csv",
    import.meta.url), "utf8");

const byId = (doc, id) => {
  const node = doc.getElementById(id);
  assert.ok(node, `#${id} is not on the page`);
  return node;
};

/** A fresh page with the intake bound and both shared values at their default. */
function intakePage() {
  setDeclaredFacts(EXAMPLE_DECLARED_FACTS);
  setHeadcountSource(HEADCOUNT_SOURCE.estimated);
  const document = parseHtml(html);
  bindDeclaredFactIntake(document);
  return document;
}

const chosenFile = (name, text) => ({ name, type: "text/csv", text: async () => text });

/** Choose a file the way a reader does: through the control's own change event. */
async function chooseRoster(document, text) {
  const input = byId(document, INTAKE_IDS.roster);
  input.files = [chosenFile("roster.csv", text)];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return pendingRosterImport();
}

const statusOf = (doc) => textOf(byId(doc, INTAKE_IDS.rosterStatus));

// ---------------------------------------------------------------------------
// 1. The contract, before the parser
// ---------------------------------------------------------------------------

test("the committed contract and the parser publish the same rules", () => {
  assert.equal(manifest.contract_version, ROSTER_CONTRACT_VERSION);
  assert.equal(manifest.kind, "wawalu.integration.hris-headcount-roster");
  assert.equal(manifest.engineering_classification, ENGINEERING_CLASSIFICATION);
  assert.equal(manifest.unlisted_columns, "refused");

  // Exactly two columns, by the names the parser reads.
  assert.equal(manifest.required_columns.length, 2);
  assert.deepEqual(manifest.required_columns.map((column) => column.name),
    [ROSTER_COLUMN.role, ROSTER_COLUMN.period]);

  // The personal columns the disclosure names are the contract's own list.
  assert.deepEqual(manifest.refused_column_examples, [...REFUSED_COLUMN_EXAMPLES]);
  for (const personal of ["email", "employee_id", "salary", "manager", "location", "birth_date"]) {
    assert.ok(REFUSED_COLUMN_EXAMPLES.includes(personal), `${personal} is named as refused`);
  }

  // Supplied on accept, and the contract states the one word it can never reach.
  assert.equal(manifest.trust_outcome.on_accept, HEADCOUNT_SOURCE.supplied);
  assert.equal(manifest.trust_outcome.never, "verified");

  // Every degenerate shape this issue names has a documented behavior.
  for (const shape of ["empty_file", "header_only", "wrong_column_count", "unparseable_period",
    "blank_role_cell", "stale_or_mismatched_period", "reordered_columns", "duplicate_rows"]) {
    assert.equal(typeof manifest.behavior[shape], "string", `${shape} is documented`);
    assert.ok(manifest.behavior[shape].length > 20, `${shape} is documented in a sentence`);
  }
  assert.match(manifest.behavior.stale_or_mismatched_period, /FILTERED/);
  assert.match(manifest.behavior.duplicate_rows, /COUNTED/);
  assert.match(manifest.behavior.reordered_columns, /ACCEPTED/);
});

// ---------------------------------------------------------------------------
// 2. The accepted roster
// ---------------------------------------------------------------------------

test("an accepted roster counts the engineering rows for one period", async () => {
  const result = parseHeadcountRoster(await fixture("accepted.csv"));
  assert.equal(result.ok, true);
  assert.equal(result.contractVersion, ROSTER_CONTRACT_VERSION);
  // Three engineering rows in the latest month; the design row and the
  // "engineering support" row are other buckets, and the June row is another
  // period. Case and quoting do not make a row a different bucket.
  assert.equal(result.headcount, 3);
  assert.equal(result.period, "2026-07");
  assert.equal(result.countedRows, 5);
  assert.equal(result.otherPeriodRows, 1);
  assert.equal(result.source, HEADCOUNT_SOURCE.supplied);
});

test("column order is not read: a reordered export is the same export", async () => {
  const straight = parseHeadcountRoster(await fixture("accepted.csv"));
  const swapped = parseHeadcountRoster(await fixture("reordered.csv"));
  assert.equal(swapped.ok, true);
  assert.equal(swapped.headcount, straight.headcount);
  assert.equal(swapped.period, straight.period);
  assert.equal(swapped.countedRows, straight.countedRows);
});

test("identical rows are counted, not merged, and the repeats are reported", async () => {
  const result = parseHeadcountRoster(await fixture("duplicated.csv"));
  assert.equal(result.ok, true);
  assert.equal(result.headcount, 3, "three identical engineering rows are three people");
  assert.equal(result.duplicateRows, 3, "the repeats are stated rather than hidden");
  assert.match(rosterAcceptedSentence(result), /counted, not merged/);
});

test("rows for another period are filtered out and counted back to the reader", async () => {
  // The file's own latest month is counted when no caller names a period.
  const latest = parseHeadcountRoster(await fixture("accepted.csv"));
  assert.equal(latest.otherPeriodRows, 1);
  assert.match(rosterAcceptedSentence(latest), /1 row for another month was set aside\./);

  // A caller that knows the brief's period gets that period, and the stale rows
  // are set aside rather than refusing the file.
  const june = parseHeadcountRoster(await fixture("accepted.csv"), { period: "2026-06" });
  assert.equal(june.ok, true);
  assert.equal(june.period, "2026-06");
  assert.equal(june.headcount, 1);
  assert.equal(june.otherPeriodRows, 5);
});

test("a roster with nothing for the period being counted is refused, not counted as zero",
  async () => {
    const result = parseHeadcountRoster(await fixture("stale.csv"), { period: "2026-07" });
    assert.equal(result.ok, false);
    assert.equal(result.code, ROSTER_REFUSAL.NO_ROWS_FOR_PERIOD);
    assert.match(result.message, /2026-07/);
  });

// ---------------------------------------------------------------------------
// 3. Refusal: the point of the whole contract
// ---------------------------------------------------------------------------

test("a real HRIS export carrying personal columns is refused by header name", async () => {
  const result = parseHeadcountRoster(await personalRoster());
  assert.equal(result.ok, false);
  assert.equal(result.code, ROSTER_REFUSAL.UNLISTED_COLUMN);
  // The refusal names the offending column so the reader can act on it, and it
  // stops on the FIRST unlisted header — before any data cell is parsed.
  assert.equal(result.column, "employee_id");
  assert.match(result.message, /employee_id/);
  // Non-blaming: it says what this page will not read, not what the reader did.
  assert.doesNotMatch(result.message, /you (?:should|must|failed|forgot)/i);
  // And it tells them the shape that would work.
  assert.match(result.message, new RegExp(ROSTER_COLUMN.role));
});

test("an unlisted column is refused even when both required columns are present", () => {
  const result = parseHeadcountRoster(
    `${ROSTER_COLUMN.role},${ROSTER_COLUMN.period},email\nengineering,2026-07,a@b.invalid\n`);
  assert.equal(result.ok, false);
  assert.equal(result.code, ROSTER_REFUSAL.UNLISTED_COLUMN);
  assert.equal(result.column, "email");
  // The refusal is on the header, so nothing in the email column was parsed: no
  // cell value reaches the message a reader is shown.
  assert.doesNotMatch(result.message, /a@b\.invalid/);
});

test("each degenerate shape refuses with its own documented code", async () => {
  const cases = [
    ["", ROSTER_REFUSAL.EMPTY_FILE],
    ["   \n", ROSTER_REFUSAL.EMPTY_FILE],
    [await fixture("header-only.csv"), ROSTER_REFUSAL.NO_DATA_ROWS],
    [`${ROSTER_COLUMN.period}\n2026-07\n`, ROSTER_REFUSAL.UNREADABLE],
    [`${ROSTER_COLUMN.role},x\nengineering,1\n`, ROSTER_REFUSAL.UNLISTED_COLUMN],
    [`${ROSTER_COLUMN.role},${ROSTER_COLUMN.role}\na,b\n`, ROSTER_REFUSAL.DUPLICATE_COLUMN],
    [`${ROSTER_COLUMN.role},${ROSTER_COLUMN.period}\nengineering\n`, ROSTER_REFUSAL.MALFORMED_ROW],
    [`${ROSTER_COLUMN.role},${ROSTER_COLUMN.period}\nengineering,Q3 2026\n`,
      ROSTER_REFUSAL.UNPARSEABLE_PERIOD],
    [`${ROSTER_COLUMN.role},${ROSTER_COLUMN.period}\n,2026-07\n`, ROSTER_REFUSAL.BLANK_ROLE],
    [`${ROSTER_COLUMN.role},${ROSTER_COLUMN.period}\ndesign,2026-07\n`,
      ROSTER_REFUSAL.NO_ENGINEERING_ROWS],
  ];
  for (const [text, code] of cases) {
    const result = parseHeadcountRoster(text);
    assert.equal(result.ok, false, `${code} is expected to refuse`);
    assert.equal(result.code, code);
    assert.ok(result.message.length > 30, `${code} explains itself in a sentence`);
  }
});

test("one bad row refuses the whole file rather than counting what it can", async () => {
  const result = parseHeadcountRoster(await fixture("malformed.csv"));
  assert.equal(result.ok, false);
  // The short row is row 3 in the reader's own spreadsheet, and the refusal
  // says so rather than reporting an offset into an array.
  assert.equal(result.code, ROSTER_REFUSAL.MALFORMED_ROW);
  assert.equal(result.row, 3);
  assert.match(result.message, /Row 3/);
  assert.equal(result.headcount, undefined, "no partial count rides out on a refusal");
});

test("a header name printed back at the reader is cleaned and capped", () => {
  assert.equal(safeHeaderName("  work  email \n"), "work email");
  assert.equal(safeHeaderName(""), "(an unnamed column)");
  assert.equal(safeHeaderName("x".repeat(80)).length, 41, "a long header is capped with an ellipsis");
});

// ---------------------------------------------------------------------------
// 4. On the page
// ---------------------------------------------------------------------------

test("the expected and refused columns are readable before any file is chosen", () => {
  const document = intakePage();
  // The authored copy is the module's own constants, so the disclosure and the
  // parser's rules cannot drift.
  assert.equal(textOf(byId(document, INTAKE_IDS.rosterExpectation)), ROSTER_EXPECTATION);
  assert.equal(textOf(byId(document, INTAKE_IDS.rosterRefused)), ROSTER_REFUSAL_NOTICE);
  assert.equal(statusOf(document), ROSTER_UNCHOSEN);

  // Read in the open: neither paragraph is inside a disclosure widget, so it is
  // read without a control being operated. Walked by parent, never selected.
  for (const id of [INTAKE_IDS.rosterExpectation, INTAKE_IDS.rosterRefused]) {
    for (let walk = byId(document, id).parentNode; walk; walk = walk.parentNode) {
      assert.notEqual(walk.tagName?.toLowerCase(), "details",
        `#${id} is folded away inside a disclosure`);
    }
  }

  // The refusal notice names personal columns by the names an HRIS uses.
  for (const personal of REFUSED_COLUMN_EXAMPLES) {
    assert.match(ROSTER_REFUSAL_NOTICE, new RegExp(personal));
  }
});

test("the roster control is an alternative to the typed field, reached beside it", () => {
  const document = intakePage();
  const input = byId(document, INTAKE_IDS.roster);
  assert.equal(input.tagName.toLowerCase(), "input");
  assert.equal(input.getAttribute("type"), "file");
  // Labelled, and the label points at this control.
  const labels = [...document.querySelectorAll("label")]
    .filter((node) => node.getAttribute("for") === INTAKE_IDS.roster);
  assert.equal(labels.length, 1);
  assert.match(textOf(labels[0]), /roster/i);

  // Reached immediately after the field it is an alternative to, and the typed
  // field is still in the sequence — this replaces nothing.
  const order = tabSequence(document).map((node) => node.id);
  assert.equal(order.indexOf(INTAKE_IDS.roster), order.indexOf(INTAKE_IDS.engineers) + 1);
  assert.equal(FOCUS_SPEC.order.indexOf(INTAKE_IDS.roster),
    FOCUS_SPEC.order.indexOf(INTAKE_IDS.engineers) + 1);

  // The status paragraph is a live region that already has something to say.
  const status = byId(document, INTAKE_IDS.rosterStatus);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("data-state"), "unchosen");
});

test("an accepted roster fills the headcount and moves it to supplied, never verified",
  async () => {
    const document = intakePage();
    assert.equal(byId(document, INTAKE_IDS.answer).dataset.headcountSource,
      HEADCOUNT_SOURCE.estimated);

    await chooseRoster(document, await fixture("accepted.csv"));

    assert.equal(byId(document, INTAKE_IDS.engineers).value, "3");
    assert.equal(currentHeadcountSource(), HEADCOUNT_SOURCE.supplied);
    const block = byId(document, INTAKE_IDS.answer);
    assert.equal(block.dataset.headcountSource, HEADCOUNT_SOURCE.supplied);
    assert.notEqual(block.dataset.headcountSource, "verified");
    // The estimate as a whole is still an estimate: the spend, the mix and the
    // cohort are all still declared, and only the denominator changed source.
    assert.equal(block.dataset.provenance, "estimated");

    const status = byId(document, INTAKE_IDS.rosterStatus);
    assert.equal(status.getAttribute("data-state"), "accepted");
    assert.match(statusOf(document), /^Supplied: 3 engineers/);
    assert.match(statusOf(document), /Supplied, not verified/);
    // No file name, no cell value, and the word this import can never earn on
    // its own never appears as a claim.
    assert.doesNotMatch(statusOf(document), /roster\.csv/);
    assert.doesNotMatch(statusOf(document), /\bis verified\b/);
  });

test("a refused roster leaves the previously declared headcount exactly as it was",
  async () => {
    const document = intakePage();
    const engineers = byId(document, INTAKE_IDS.engineers);
    const before = engineers.value;
    const headlineBefore = textOf(byId(document, INTAKE_IDS.headline));

    const result = await chooseRoster(document, await personalRoster());
    assert.equal(result.ok, false);

    assert.equal(engineers.value, before, "the declared headcount survived the refusal");
    assert.equal(textOf(byId(document, INTAKE_IDS.headline)), headlineBefore,
      "the brief was not half-updated");
    assert.equal(byId(document, INTAKE_IDS.answer).dataset.headcountSource,
      HEADCOUNT_SOURCE.estimated);
    assert.equal(byId(document, INTAKE_IDS.rosterStatus).getAttribute("data-state"), "refused");
    assert.match(statusOf(document), /employee_id/);
    assert.match(statusOf(document), /The declared headcount is unchanged\.$/);
  });

test("a refusal after an accepted roster keeps the accepted headcount", async () => {
  const document = intakePage();
  await chooseRoster(document, await fixture("accepted.csv"));
  const accepted = byId(document, INTAKE_IDS.engineers).value;

  await chooseRoster(document, await fixture("malformed.csv"));
  assert.equal(byId(document, INTAKE_IDS.engineers).value, accepted);
  assert.match(statusOf(document), /Row 3/);
});

test("typing a headcount after an import takes the supplied claim back", async () => {
  const document = intakePage();
  await chooseRoster(document, await fixture("accepted.csv"));
  assert.equal(currentHeadcountSource(), HEADCOUNT_SOURCE.supplied);

  const engineers = byId(document, INTAKE_IDS.engineers);
  engineers.value = "250";
  engineers.dispatchEvent(new DomEvent("input", { bubbles: true }));

  assert.equal(currentHeadcountSource(), HEADCOUNT_SOURCE.estimated);
  assert.equal(byId(document, INTAKE_IDS.answer).dataset.headcountSource,
    HEADCOUNT_SOURCE.estimated);
  assert.equal(statusOf(document), ROSTER_UNCHOSEN);
  assert.equal(byId(document, INTAKE_IDS.rosterStatus).getAttribute("data-state"), "unchosen");
});

test("clearing the region returns the roster claim to the bundled example's state", async () => {
  const document = intakePage();
  await chooseRoster(document, await fixture("accepted.csv"));
  resetDeclaredFactIntake(document);

  assert.equal(currentHeadcountSource(), HEADCOUNT_SOURCE.estimated);
  assert.equal(statusOf(document), ROSTER_UNCHOSEN);
  assert.equal(byId(document, INTAKE_IDS.engineers).value,
    String(EXAMPLE_DECLARED_FACTS.engineers));
});

// ---------------------------------------------------------------------------
// 5. Nothing leaves the browser
// ---------------------------------------------------------------------------

test("no request and no stored copy is made anywhere in an accepted import", async () => {
  const document = intakePage();
  const calls = [];
  const watched = ["fetch", "XMLHttpRequest", "navigator", "localStorage", "sessionStorage",
    "indexedDB"];
  const saved = new Map(watched.map((key) => [key, Reflect.get(globalThis, key)]));
  const trap = (label) => new Proxy(() => {}, {
    apply: () => calls.push(label),
    get: (_, key) => (typeof key === "string" ? () => calls.push(`${label}.${key}`) : undefined),
    construct: () => { calls.push(`new ${label}`); return {}; },
  });
  for (const key of watched) {
    Object.defineProperty(globalThis, key, { value: trap(key), configurable: true, writable: true });
  }
  try {
    await importHeadcountRoster(document, chosenFile("roster.csv", await fixture("accepted.csv")));
    await importHeadcountRoster(document, chosenFile("bad.csv", await personalRoster()));
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(globalThis, key);
      else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  }
  assert.deepEqual(calls, [], "the import path touched a network or storage global");

  // And the sources say the same thing, so a future edit has to defeat both.
  const parser = await readFile(new URL("../src/hris-headcount-roster.js", import.meta.url), "utf8");
  for (const source of [parser, view]) {
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/);
  }
  // The only file API used is the browser's own local text read.
  assert.match(view, /file\.text\(\)/);
});

test("a file the browser cannot read is a sentence, not a silent stale headcount", async () => {
  const document = intakePage();
  const before = byId(document, INTAKE_IDS.engineers).value;
  const result = await importHeadcountRoster(document, {
    name: "roster.csv", text: async () => { throw new Error("unreadable"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ROSTER_REFUSAL.UNREADABLE);
  assert.equal(byId(document, INTAKE_IDS.engineers).value, before);
  assert.match(statusOf(document), /could not be read/);
  assert.equal(rosterRefusalSentence(result).endsWith("The declared headcount is unchanged."), true);
});
