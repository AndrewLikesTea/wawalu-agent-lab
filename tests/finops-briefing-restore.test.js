// Reopening a saved briefing on the AI FinOps tab.
//
// Two things are pinned here. First, the reader: it consumes exactly what
// `localFinopsJsonExport` writes — the real writer is called in this file, never
// a hand-authored lookalike — and it turns away everything else with a specific,
// calm sentence rather than a stack trace or a half-read briefing. Second, the
// surface: the restored region says in words that it is restored, names the
// window it observed out of the file, and never renders a delta it cannot
// justify.
//
// Every render assertion drives the shipped markup from src/evolution.html
// through the same harness the rest of the FinOps suites use, and every value
// that came out of a file is asserted on as text, so a payload that reached the
// DOM as markup would fail here rather than in a browser.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import { applyRestoreRejection, applyRestoredBriefing } from "../src/local-import-flow.js";
import { localFinopsJsonExport } from "../src/local-finops.js";
import { CONTRACT_VERSION, buildFinopsBriefing } from "../src/finops-briefing-contract.js";
import { DOWN_ROUTING_RULE_VERSION } from "../src/down-routing-candidates.js";
import {
  MAX_BRIEFING_BYTES, NOT_COMPARABLE, RESTORE_REJECTION, briefingDelta, parseSavedBriefing,
  savedRubricVersion,
} from "../src/finops-briefing-restore.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

async function page() {
  return parseHtml(await readFile(PAGE, "utf8"));
}

// ---------------------------------------------------------------------------
// One analysis envelope, shaped exactly as normalizeLocalFinops returns one.
// Aggregates only: no record, no name, no identifier that a real import would
// not already have pseudonymized.
// ---------------------------------------------------------------------------

function department(id, spendUsd, recoverableUsd, records = 12) {
  return {
    id,
    name: `Department …${id}`,
    spendUsd,
    recoverableUsd,
    records,
    downRouting: {
      ruleVersion: DOWN_ROUTING_RULE_VERSION,
      decisionCode: "candidate_identified",
      confidence: { level: "medium" },
    },
  };
}

function envelope(overrides = {}) {
  const ranked = overrides.rankedDepartments ?? [
    department("a1b2c3", 4200, 3000),
    department("d4e5f6", 2100, 1500),
    department("079abc", 1130, 700),
  ];
  return {
    schemaVersion: "local-finops/1.0.0",
    generatedAt: "2026-07-02T09:00:00.000Z",
    period: "2026-06-01 to 2026-07-01",
    spendUsd: 7430,
    recoverableUsd: 5200,
    rankedDepartments: ranked,
    topDepartment: ranked[0] ?? null,
    action: "Pilot lower-cost routing for text-generation in the highest-spend org unit and verify "
      + "against a like-for-like period.",
    confidence: "Medium",
    quality: {
      providerCompleteness: "complete",
      hrisCompleteness: null,
      joinedRecords: 760,
      quarantinedRecords: 40,
      quarantine: [],
      warnings: [],
    },
    ...overrides,
  };
}

/** The real writer. Nothing in this suite authors the file format by hand. */
function savedFile(result = envelope(), options = {}) {
  return localFinopsJsonExport(result, options);
}

/** Reparse a written file so a test can bend exactly one field of it. */
function tamper(mutate, result = envelope(), options = {}) {
  const raw = JSON.parse(savedFile(result, options));
  mutate(raw);
  return JSON.stringify(raw);
}

function openSaved(text, options) {
  const outcome = parseSavedBriefing(text, options);
  assert.equal(outcome.ok, true, `expected the file to open, got ${outcome.code}`);
  return outcome.saved;
}

function currentAnalysis(result = envelope(), dataset = "user") {
  return { dataset, result, briefing: buildFinopsBriefing(result) };
}

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

test("a briefing written by the real export path reopens with its finding intact", () => {
  const result = envelope();
  const saved = openSaved(savedFile(result));

  assert.equal(saved.contractVersion, CONTRACT_VERSION);
  assert.equal(saved.analysisSchemaVersion, "local-finops/1.0.0");
  assert.equal(saved.spendUsd, 7430);
  assert.equal(saved.recoverableUsd, 5200);
  assert.equal(saved.period.label, "2026-06-01 to 2026-07-01");
  assert.equal(saved.period.days, 30);
  assert.equal(saved.rubricVersion, DOWN_ROUTING_RULE_VERSION);
  // The finding is the contract's, re-selected from the file's own envelope —
  // byte-identical to what the live surface would have said about it.
  assert.deepEqual(saved.briefing, buildFinopsBriefing(result));
  assert.equal(saved.briefing.materialMetric.value, 5200);
  assert.equal(saved.briefing.coverage.confidence, "high");
  assert.match(saved.briefing.rankedAction.action, /Pilot lower-cost routing/);
});

test("the written date comes off the file, never off the clock", () => {
  const text = tamper((raw) => { raw.exportedAt = "2026-06-30T23:15:00.000Z"; });
  assert.equal(openSaved(text).savedOn, "2026-06-30");
});

test("the rubric version is read from the file's own departments, not from this build", () => {
  const stale = envelope({
    rankedDepartments: [{
      ...department("a1b2c3", 4200, 3000),
      downRouting: { ruleVersion: "down-routing-candidate/0.9.0", decisionCode: "x", confidence: { level: "low" } },
    }],
  });
  assert.equal(savedRubricVersion(stale), "down-routing-candidate/0.9.0");
  assert.equal(openSaved(savedFile(stale)).rubricVersion, "down-routing-candidate/0.9.0");
});

// ---------------------------------------------------------------------------
// The restored region
// ---------------------------------------------------------------------------

test("the restored region is labelled as restored and names the period it captured", async () => {
  const doc = await page();
  // Written last month, opened today: every date on screen has to be the file's.
  const saved = openSaved(tamper((raw) => { raw.exportedAt = "2026-07-02T09:04:00.000Z"; }));
  applyRestoredBriefing(doc, { saved, delta: null });

  const section = doc.getElementById("restored-briefing");
  assert.equal(section.hidden, false);
  assert.equal(section.dataset.state, "restored");
  // The accessible name is what a screen-reader user hears when they jump here,
  // so "reopened" and "read-only" have to be in it rather than in a tooltip.
  const heading = doc.getElementById(section.getAttribute("aria-labelledby"));
  assert.equal(section.getAttribute("role"), "region");
  assert.match(textOf(heading), /Reopened FinOps briefing \(read-only\)/);
  assert.match(textOf(section), /Reopened from a file · not the current analysis/);
  // Both dates are the file's own.
  assert.equal(textOf(doc.getElementById("restored-briefing-captured")),
    "Observation window 2026-06-01 to 2026-07-01 · written 2026-07-02 · "
    + "read from a file you chose, not recomputed here.");
  assert.match(textOf(doc.getElementById("restored-briefing-metric")), /5200\.00 USD/);
  assert.match(textOf(doc.getElementById("restored-briefing-coverage")), /High confidence · 95\.0% of records/);
  assert.match(textOf(doc.getElementById("restored-briefing-action")), /Accountable role: Platform Engineering Lead\./);
});

test("the restored region never occupies or clears the live analysis slot", async () => {
  const doc = await page();
  applyRestoredBriefing(doc, { saved: openSaved(savedFile()), delta: null });

  // The live surface is a different element with a different heading, and it is
  // still in the state a visitor who imported nothing meets it in.
  const live = doc.getElementById("local-lead-finding");
  assert.equal(live.hidden, true, "reopening a file must not reveal the live analysis slot");
  assert.equal(textOf(doc.getElementById("local-lead-question")), "—");
  assert.notEqual(doc.getElementById("restored-briefing"), live);
});

test("an example-dataset briefing keeps saying so after it is reopened", async () => {
  const doc = await page();
  const saved = openSaved(savedFile(envelope(), { exampleDataset: true }));
  assert.equal(saved.dataset, "example");
  applyRestoredBriefing(doc, { saved, delta: null });
  const notice = doc.getElementById("restored-briefing-dataset");
  assert.equal(notice.hidden, false);
  assert.match(textOf(notice), /bundled example dataset/);
});

test("closing a restored briefing leaves no slot behind", async () => {
  const doc = await page();
  applyRestoredBriefing(doc, { saved: openSaved(savedFile()), delta: null });
  applyRestoredBriefing(doc, null);
  const section = doc.getElementById("restored-briefing");
  assert.equal(section.hidden, true);
  assert.equal(section.dataset.state, "empty");
  // Every slot is emptied, not merely hidden: nothing of the closed file is
  // still sitting in the document for a later state to reveal.
  for (const id of ["captured", "dataset", "question", "metric", "coverage", "arithmetic", "action", "delta"]) {
    const slot = doc.getElementById(`restored-briefing-${id}`);
    assert.equal(slot.textContent, "", `restored-briefing-${id} still holds text after closing`);
    assert.equal(slot.hidden, true);
  }
});

// ---------------------------------------------------------------------------
// The delta
// ---------------------------------------------------------------------------

test("there is no delta without both a restored briefing and a current analysis", () => {
  const saved = openSaved(savedFile());
  assert.equal(briefingDelta(saved, null), null);
  assert.equal(briefingDelta(null, currentAnalysis()), null);
  assert.equal(briefingDelta(saved, { dataset: "user", result: null, briefing: null }), null);
});

test("the delta reports the spend change and the grade change in words", () => {
  const saved = openSaved(savedFile());
  const now = envelope({
    period: "2026-07-01 to 2026-07-31",
    spendUsd: 8916,
    quality: { ...envelope().quality, joinedRecords: 500, quarantinedRecords: 300 },
  });
  const delta = briefingDelta(saved, currentAnalysis(now));

  assert.equal(delta.comparable, true);
  assert.equal(delta.spend.direction, "up");
  assert.equal(delta.spend.changeUsd, 1486);
  assert.equal(delta.grade.direction, "fell");
  assert.equal(delta.grade.saved, "high");
  assert.equal(delta.grade.current, "moderate");
  // Direction and magnitude are both in the sentence; nothing here depends on a
  // tint to be read.
  assert.equal(delta.text,
    "Since the saved briefing: Observed spend up 1486.00 USD (+20.0%) — 7430.00 USD in the saved "
    + "briefing, 8916.00 USD now. Confidence grade fell from High to Moderate.");
});

test("a fall and a flat month each read as themselves", () => {
  const saved = openSaved(savedFile());
  const lower = briefingDelta(saved, currentAnalysis(envelope({
    period: "2026-07-01 to 2026-07-31", spendUsd: 6430,
  })));
  assert.equal(lower.spend.direction, "down");
  assert.match(lower.text, /Observed spend down 1000\.00 USD \(−13\.5%\)/);
  assert.match(lower.text, /Confidence grade unchanged at High\./);

  const flat = briefingDelta(saved, currentAnalysis(envelope({ period: "2026-07-01 to 2026-07-31" })));
  assert.match(flat.text, /Observed spend unchanged at 7430\.00 USD\./);
});

test("a coverage mismatch is stated in place of the numbers, and says which mismatch it is", () => {
  const saved = openSaved(savedFile());

  // Different scope: the saved briefing is a single period, the current one is
  // a reconciled history.
  const scope = briefingDelta(saved, currentAnalysis(envelope({ schemaVersion: "local-finops-history/1.0.0" })));
  assert.equal(scope.comparable, false);
  assert.equal(scope.code, "analysis");
  assert.equal(scope.text, NOT_COMPARABLE.analysis);

  // Different observation window length: 30 days against 90.
  const window = briefingDelta(saved, currentAnalysis(envelope({ period: "2026-04-01 to 2026-06-30" })));
  assert.equal(window.code, "window");
  assert.equal(window.text, NOT_COMPARABLE.window);

  // Example data against the visitor's own.
  const dataset = briefingDelta(saved, currentAnalysis(envelope(), "example"));
  assert.equal(dataset.code, "dataset");
  assert.equal(dataset.text, NOT_COMPARABLE.dataset);

  // Nothing covered on one side, so there is no shared base.
  const empty = briefingDelta(saved, currentAnalysis(envelope({
    period: "2026-07-01 to 2026-07-31",
    quality: { ...envelope().quality, joinedRecords: 0, quarantinedRecords: 0 },
  })));
  assert.equal(empty.code, "coverage");
  assert.equal(empty.text, NOT_COMPARABLE.coverage);

  // None of these carry a figure a reader could mistake for a delta.
  for (const outcome of [scope, window, dataset, empty]) {
    assert.equal(outcome.spend, undefined);
    assert.doesNotMatch(outcome.text, /USD/);
  }
});

test("a rubric-version mismatch is stated in place of the numbers", () => {
  const stale = envelope({
    rankedDepartments: [{
      ...department("a1b2c3", 4200, 3000),
      downRouting: { ruleVersion: "down-routing-candidate/0.9.0", decisionCode: "x", confidence: { level: "low" } },
    }],
  });
  const mismatch = briefingDelta(openSaved(savedFile(stale)),
    currentAnalysis(envelope({ period: "2026-07-01 to 2026-07-31" })));
  assert.equal(mismatch.comparable, false);
  assert.equal(mismatch.code, "rubric");
  assert.equal(mismatch.text, NOT_COMPARABLE.rubric);

  // A file that never recorded a rubric version is a different fault, and says
  // so rather than being folded into the mismatch above.
  const silent = briefingDelta(
    openSaved(savedFile(envelope({ rankedDepartments: [], topDepartment: null, recoverableUsd: 0 }))),
    currentAnalysis(envelope({ period: "2026-07-01 to 2026-07-31" })));
  assert.equal(silent.code, "rubric_unknown");
  assert.equal(silent.text, NOT_COMPARABLE.rubric_unknown);
});

test("the delta line is absent, not blank, when there is nothing to compare", async () => {
  const doc = await page();
  applyRestoredBriefing(doc, { saved: openSaved(savedFile()), delta: null });
  const line = doc.getElementById("restored-briefing-delta");
  assert.equal(line.hidden, true);
  assert.equal(textOf(line), "");

  applyRestoredBriefing(doc, {
    saved: openSaved(savedFile()),
    delta: briefingDelta(openSaved(savedFile()),
      currentAnalysis(envelope({ period: "2026-07-01 to 2026-07-31", spendUsd: 8916 }))),
  });
  assert.equal(line.hidden, false);
  assert.equal(line.dataset.comparable, "true");
  assert.equal(line.dataset.direction, "up");
  assert.match(textOf(line), /Observed spend up 1486\.00 USD/);
});

// ---------------------------------------------------------------------------
// Rejections. One test per fault, each asserting the sentence a reader gets.
// ---------------------------------------------------------------------------

const REJECTIONS = [
  {
    name: "a file that is not JSON",
    code: "not_json",
    text: () => "This is a meeting summary, not a briefing.",
  },
  {
    name: "JSON that stops halfway through",
    code: "not_json",
    text: () => savedFile().slice(0, 240),
  },
  {
    name: "JSON that is an array rather than a briefing",
    code: "not_a_briefing_file",
    text: () => "[]",
  },
  {
    name: "a briefing with no analysis in it",
    code: "missing_results",
    text: () => tamper((raw) => { delete raw.results; }),
  },
  {
    name: "a briefing with no period on it",
    code: "missing_period",
    text: () => tamper((raw) => { delete raw.results.period; }),
  },
  {
    name: "a briefing with no written date",
    code: "missing_written_date",
    text: () => tamper((raw) => { raw.exportedAt = "not a date"; }),
  },
  {
    name: "a briefing that does not say which dataset it came from",
    code: "unknown_dataset",
    text: () => tamper((raw) => { raw.dataset = "somebody else's"; }),
  },
  {
    name: "an unsupported contract version",
    code: "unsupported_version",
    text: () => tamper((raw) => { raw.briefingContractVersion = "finops-briefing/9.0.0"; }),
  },
  {
    name: "an analysis schema this build cannot read",
    code: "unsupported_analysis",
    text: () => tamper((raw) => { raw.results.schemaVersion = "local-finops/9.9.9"; }),
  },
  {
    name: "a string where a number belongs",
    code: "wrong_type",
    text: () => tamper((raw) => { raw.results.spendUsd = "7430"; }),
  },
  {
    name: "an array where an object belongs",
    code: "wrong_type",
    text: () => tamper((raw) => { raw.results.quality = []; }),
  },
  {
    name: "a record count that is not a whole number",
    code: "wrong_type",
    text: () => tamper((raw) => { raw.results.quality.joinedRecords = 12.5; }),
  },
  {
    name: "a spend figure that parses to Infinity",
    code: "not_a_number",
    text: () => savedFile().replace('"spendUsd": 7430', '"spendUsd": 1e999'),
  },
  {
    name: "an absurdly large spend figure",
    code: "implausible_number",
    text: () => tamper((raw) => { raw.results.spendUsd = 9e14; }),
  },
  {
    name: "a string carrying HTML",
    code: "unsafe_content",
    text: () => tamper((raw) => {
      raw.results.action = "<script data-payload=\"1\">globalThis.pwned = true</script>";
    }),
  },
  {
    name: "a javascript: URL",
    code: "unsafe_content",
    text: () => tamper((raw) => { raw.results.provenance = "javascript:globalThis.pwned=1"; }),
  },
  {
    name: "a data: URL",
    code: "unsafe_content",
    text: () => tamper((raw) => { raw.results.provenance = "data:text/html;base64,PHNjcmlwdD4="; }),
  },
  {
    name: "an inline event handler",
    code: "unsafe_content",
    text: () => tamper((raw) => { raw.results.action = "Pilot routing\" onclick=\"steal()"; }),
  },
  {
    name: "a __proto__ key",
    code: "unsafe_keys",
    text: () => savedFile().replace('"results": {', '"results": { "__proto__": { "polluted": true },'),
  },
  {
    name: "a constructor key",
    code: "unsafe_keys",
    text: () => savedFile().replace('"results": {', '"results": { "constructor": { "polluted": true },'),
  },
  {
    name: "a prototype key",
    code: "unsafe_keys",
    text: () => savedFile().replace('"results": {', '"results": { "prototype": { "polluted": true },'),
  },
  {
    name: "a file nested far deeper than a briefing",
    code: "too_deeply_nested",
    // Generated here rather than committed: a fixture whose only content is its
    // own depth is a fixture nobody can read.
    text: () => tamper((raw) => {
      let node = raw.results;
      for (let depth = 0; depth < 60; depth += 1) node = (node.deeper = {});
    }),
  },
  {
    name: "a file holding far more values than a briefing does",
    code: "too_many_values",
    text: () => tamper((raw) => {
      raw.results.padding = Array.from({ length: 60_000 }, (_, index) => index);
    }),
  },
];

for (const { name, code, text } of REJECTIONS) {
  test(`${name} is turned away with the sentence that names the fault`, async () => {
    const outcome = parseSavedBriefing(text());
    assert.equal(outcome.ok, false, `${name} must not open`);
    assert.equal(outcome.code, code);
    assert.equal(outcome.message, RESTORE_REJECTION[code]);
    assert.equal(outcome.saved, null);
    // Never a stack trace and never the file's own content quoted back.
    assert.doesNotMatch(outcome.message, /Error|SyntaxError|at Object|undefined|\bJSON\.parse\b/);
    assert.doesNotMatch(outcome.message, /[<>]/);
    assert.equal(globalThis.pwned, undefined, "a rejected file must not have executed anything");
    assert.equal({}.polluted, undefined, "a rejected file must not have polluted Object.prototype");

    // A rejection leaves the page with a sentence and no briefing at all.
    const doc = await page();
    applyRestoreRejection(doc, outcome);
    applyRestoredBriefing(doc, null);
    const error = doc.getElementById("restored-briefing-error");
    assert.equal(error.hidden, false);
    assert.equal(error.textContent, RESTORE_REJECTION[code]);
    assert.equal(doc.getElementById("reopen-briefing-file").getAttribute("aria-invalid"), "true");
    assert.equal(doc.getElementById("restored-briefing").hidden, true);
    assert.equal(textOf(doc.getElementById("restored-briefing-metric")), "");
    // Nothing from the payload became an element.
    assert.equal(doc.querySelectorAll("script").filter((node) => node.hasAttribute("data-payload")).length, 0);
  });
}

test("an oversized file is refused before it is parsed", () => {
  const outcome = parseSavedBriefing(null, { byteSize: MAX_BRIEFING_BYTES + 1 });
  assert.equal(outcome.code, "file_too_large");
  assert.equal(outcome.message, RESTORE_REJECTION.file_too_large);
  // And by the text's own length when the platform gave no size.
  assert.equal(parseSavedBriefing(" ".repeat(MAX_BRIEFING_BYTES + 1)).code, "file_too_large");
});

test("a file that could not be read as text is a rejection, not a throw", () => {
  for (const value of [undefined, null, 42, {}]) {
    assert.equal(parseSavedBriefing(value).code, "unreadable");
  }
});

test("a briefing the contract itself refuses does not open", () => {
  // Every field-level check above passes; the coverage counts contradict the
  // confidence the contract computes from them, so the contract refuses it.
  const outcome = parseSavedBriefing(tamper((raw) => {
    raw.results.rankedDepartments = [{ id: "a1b2c3", name: "Department …a1b2c3", spendUsd: 1, records: 1 }];
    raw.results.topDepartment = raw.results.rankedDepartments[0];
    raw.results.recoverableUsd = Number.MAX_SAFE_INTEGER;
  }));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.saved, null);
});

test("clearing a rejection takes the sentence and the invalid state back off", async () => {
  const doc = await page();
  applyRestoreRejection(doc, parseSavedBriefing("not json"));
  applyRestoreRejection(doc, null);
  const error = doc.getElementById("restored-briefing-error");
  assert.equal(error.hidden, true);
  assert.equal(error.textContent, "");
  assert.equal(doc.getElementById("reopen-briefing-file").getAttribute("aria-invalid"), "false");
});

// ---------------------------------------------------------------------------
// Keyboard and labelling
// ---------------------------------------------------------------------------

test("the reopen control is a labelled, keyboard-reachable file input", async () => {
  const doc = await page();
  const input = doc.getElementById("reopen-briefing-file");
  assert.equal(input.getAttribute("type"), "file");

  // A real label element pointing at the control — not a placeholder, and not
  // an aria-label standing in for one.
  const label = doc.querySelectorAll("label").find((node) => node.getAttribute("for") === "reopen-briefing-file");
  assert.ok(label, "the reopen input needs a label element bound to it");
  // Says what it reopens, not what it imports (#958): the one import affordance
  // is the drop zone above, and this control must not read as a rival to it.
  assert.equal(textOf(label), "Reopen a saved briefing");
  assert.equal(input.getAttribute("placeholder"), null);

  // The help text is programmatically associated and repeats the same promise
  // the Shiplog importer makes about a chosen file.
  const help = doc.getElementById(input.getAttribute("aria-describedby"));
  assert.match(textOf(help), /read in this browser only — nothing is uploaded/);

  assert.ok(tabSequence(doc).includes(input),
    "a keyboard user must be able to reach the reopen control by Tab alone");
});

test("the restored region and its close control are reachable and named once open", async () => {
  const doc = await page();
  applyRestoredBriefing(doc, { saved: openSaved(savedFile()), delta: null });
  const section = doc.getElementById("restored-briefing");
  const heading = doc.getElementById(section.getAttribute("aria-labelledby"));

  // Discoverable by its accessible name, and focusable so the load can send a
  // screen-reader user straight to it.
  assert.equal(heading.getAttribute("tabindex"), "-1");
  heading.focus();
  assert.equal(doc.activeElement, heading);

  const close = doc.getElementById("restored-briefing-close");
  assert.ok(tabSequence(doc).includes(close),
    "the close control must be reachable by Tab once the region is open");
  assert.equal(textOf(close), "Close this reopened briefing");
});

test("reading a file touches neither the network nor any storage API", async () => {
  const calls = [];
  const trap = (name) => new Proxy(() => {}, {
    apply: () => { calls.push(name); },
    get: (_, key) => { calls.push(`${name}.${String(key)}`); return () => { calls.push(`${name}.${String(key)}()`); }; },
  });
  const saved = Object.fromEntries(["fetch", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of Object.keys(saved)) {
    Object.defineProperty(globalThis, key, { value: trap(key), configurable: true, writable: true });
  }
  try {
    const doc = await page();
    const text = savedFile();
    applyRestoredBriefing(doc, {
      saved: openSaved(text),
      delta: briefingDelta(openSaved(text),
        currentAnalysis(envelope({ period: "2026-07-01 to 2026-07-31", spendUsd: 8000 }))),
    });
    assert.equal(parseSavedBriefing("nope").ok, false);
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  assert.deepEqual(calls, [],
    `reopening a briefing must not reach the network or storage; it touched ${calls.join(", ")}`);
});
