// The FinOps half of the local workspace: choose, brief, check, forget.
//
// Two halves, both driving shipped code. The first pins the model — the state a
// given pair of storage keys produces, the briefing derived from it, and the
// single next action chosen from it. The second boots src/workspace.html the way
// the browser boots it and asserts only what a reader can perceive: the words in
// a chip, what a disclosure says before it is opened, the tab order, where focus
// lands after a destructive step, and what the live region says.
//
// Every retained period is projected through the shipped `buildFinopsBriefing`
// rather than hand-typed, so a change to the briefing contract surfaces here
// instead of being masked by a copy of its output. No network (the harness
// throws on an undeclared request), no sleeps, and every clock is injected.

import test from "node:test";
import assert from "node:assert/strict";

import { buildFinopsBriefing } from "../src/finops-briefing-contract.js";
import {
  FINOPS_LABELS_KEY, FINOPS_WORKSPACE_KEY, FINOPS_WORKSPACE_VERSION,
} from "../src/finops-workspace-contract.js";
import {
  FINOPS_CONSENT, FINOPS_OUTCOME, FINOPS_STATE,
  finopsWorkspaceFile, forgetFinopsWorkspace, projectRetainedPeriod, readFinopsWorkspace,
  retainFinopsPeriod, setFinopsConsent,
} from "../src/finops-workspace.js";
import { serializeFinopsPortableRecord } from "../src/finops-portable-record.js";
import { DomEvent, loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/workspace.html", import.meta.url);
const NOW = new Date("2026-07-28T11:30:00.000Z");
const now = () => NOW;

/** A storage stand-in. `refuse` models a browser that blocks site data outright. */
function storageOf(seed = {}, { refuse = false } = {}) {
  const values = new Map(Object.entries(seed));
  const guard = () => {
    if (refuse) throw new Error("this browser blocks site data");
  };
  return {
    getItem(key) { guard(); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { guard(); values.set(key, String(value)); },
    removeItem(key) { guard(); values.delete(key); },
  };
}

/**
 * One analysis envelope, in the shape `buildFinopsBriefing` reads.
 *
 * Only the figures the briefing contract actually selects from are stated: the
 * period, the two money aggregates, the ranked departments the recoverable
 * scenario is summed over, and the join quality that produces coverage.
 */
function analysisOf({ month = "2026-06", spendUsd = 7430, recoverableUsd = 5200 } = {}) {
  const nextMonth = month.endsWith("-12")
    ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 5)}${String(Number(month.slice(5)) + 1).padStart(2, "0")}`;
  return {
    schemaVersion: "local-finops-history/1.0.0",
    period: `${month}-01 to ${nextMonth}-01`,
    spendUsd,
    recoverableUsd,
    rankedDepartments: [
      { id: "customer-support", name: "Customer support", spendUsd: spendUsd * 0.6, recoverableUsd },
      { id: "platform", name: "Platform", spendUsd: spendUsd * 0.4, recoverableUsd: 0 },
    ],
    topDepartment: { id: "customer-support", recoverableUsd },
    action: "Pilot lower-cost routing for text generation in the highest-spend org unit.",
    // A two-file import. `hrisCompleteness` is stated rather than left off
    // because #1024 caps confidence on how much of a brief was supplied: with no
    // org file the ranked units are DERIVED from the export's own billing key
    // and this brief would publish moderate, which is a fact about the cap and
    // not about the retention flow this suite is here to pin.
    quality: {
      joinedRecords: 760, quarantinedRecords: 40, providerCompleteness: true, hrisCompleteness: true,
    },
  };
}

/** A retained period, projected exactly as the AI FinOps page projects one. */
function periodOf(options = {}) {
  const analysis = analysisOf(options);
  return projectRetainedPeriod({
    briefing: buildFinopsBriefing(analysis, options),
    analysis,
    dataset: options.dataset ?? "user",
    now: new Date(options.derivedAt ?? "2026-07-02T09:14:00.000Z"),
  });
}

/** A storage that has already said yes and retained the given months. */
function retaining(periods, extra = {}) {
  const storage = storageOf(extra);
  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now: new Date("2026-07-01T08:00:00.000Z") });
  for (const period of periods) retainFinopsPeriod(storage, period, { now: NOW });
  return storage;
}

/* --------------------------------- the model -------------------------------- */

test("an unasked browser has nothing stored, and the page says so rather than assuming", () => {
  const storage = storageOf();
  const view = readFinopsWorkspace(storage, { now: NOW });

  assert.equal(view.state, FINOPS_STATE.notAsked);
  assert.equal(view.consent.chosen, false);
  assert.equal(view.briefing, null);
  assert.equal(view.nextAction.code, "choose");
  // Not asked is not declined, and reading the page must not create the store.
  assert.equal(storage.getItem(FINOPS_WORKSPACE_KEY), null);
});

test("declining records the choice, writes nothing else, and drops what was retained", () => {
  const storage = retaining([periodOf()]);
  assert.equal(readFinopsWorkspace(storage, { now: NOW }).counts.periods, 1);

  const result = setFinopsConsent(storage, FINOPS_CONSENT.declined, { now: NOW });
  const view = readFinopsWorkspace(storage, { now: NOW });

  assert.equal(result.ok, true);
  assert.equal(view.state, FINOPS_STATE.declined);
  assert.equal(view.counts.periods, 0);
  // The choice survives — a visitor who said no is not asked again every visit.
  assert.equal(JSON.parse(storage.getItem(FINOPS_WORKSPACE_KEY)).consent.state, "declined");
  // And the file flow is what the page points at, not a second opt-in prompt.
  assert.equal(view.nextAction.code, "files_only");
  assert.equal(view.nextAction.href, "/evolution.html");
});

test("a period is retained only after consent, and never before", () => {
  const storage = storageOf();
  const refused = retainFinopsPeriod(storage, periodOf(), { now: NOW });

  assert.equal(refused.ok, false);
  assert.equal(refused.code, "not_granted");
  assert.equal(storage.getItem(FINOPS_WORKSPACE_KEY), null);

  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now: NOW });
  assert.equal(retainFinopsPeriod(storage, periodOf(), { now: NOW }).ok, true);
  assert.equal(readFinopsWorkspace(storage, { now: NOW }).counts.periods, 1);
});

test("a record carrying forbidden content is refused, and the store is unchanged", () => {
  const storage = retaining([periodOf()]);
  const tainted = { ...periodOf({ month: "2026-07" }), topDepartmentId: "ops@example.com" };

  const result = retainFinopsPeriod(storage, tainted, { now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.code, "refused_content");
  assert.deepEqual(result.violations.map((violation) => violation.code), ["email_address"]);
  assert.equal(readFinopsWorkspace(storage, { now: NOW }).counts.periods, 1);
});

test("the briefing names one benchmark, one confidence, and the provenance behind both", () => {
  const view = readFinopsWorkspace(
    retaining([periodOf({ month: "2026-05" }), periodOf({ month: "2026-06" })]), { now: NOW },
  );

  assert.equal(view.state, FINOPS_STATE.retaining);
  assert.equal(view.briefing.available, true);
  // The figure is the briefing contract's selection, repeated — not re-derived.
  assert.equal(view.briefing.benchmark.metricId, "recoverable_scenario");
  assert.equal(view.briefing.benchmark.figure, "5,200.00 USD");
  assert.equal(view.briefing.period, "2026-06");
  assert.equal(view.briefing.priorPeriod, "2026-05");
  assert.equal(view.briefing.confidence.label, "High");
  assert.equal(view.briefing.confidence.coveragePercent, 95);
  // Provenance is checkable: it names the key, the contract, and the transfer.
  const terms = view.briefing.provenance.map((row) => row.term);
  assert.deepEqual(terms, ["Figures", "Dataset", "Derived", "Coverage", "Transfer"]);
  assert.match(view.briefing.provenance[0].detail, new RegExp(FINOPS_WORKSPACE_KEY));
  assert.match(view.briefing.provenance.at(-1).detail, /no FinOps figure has left this device/);
});

test("a period with no material figure is kept as evidence and refuses to headline one", () => {
  const view = readFinopsWorkspace(retaining([periodOf({ recoverableUsd: 0 })]), { now: NOW });

  assert.equal(view.counts.periods, 1);
  assert.equal(view.briefing.available, false);
  assert.equal(view.briefing.benchmark.figure, "No figure");
  // The reason is the contract's authored statement, not a shrug.
  assert.match(view.briefing.benchmark.statement, /no change against a prior period can be computed/);
  assert.equal(view.nextAction.code, "missing_input");
});

test("the next action is one, and it is chosen by what the reader cannot yet answer", () => {
  const ladder = [
    [storageOf({}, { refuse: true }), "recheck_storage"],
    [storageOf({ [FINOPS_WORKSPACE_KEY]: "{ truncated" }), "forget_unreadable"],
    [storageOf(), "choose"],
    [retaining([]), "first_import"],
    [retaining([periodOf()]), "second_period"],
    [retaining([periodOf({ month: "2026-05" }), periodOf({ month: "2026-06" })]), "record_decision"],
  ];
  for (const [storage, code] of ladder) {
    const view = readFinopsWorkspace(storage, { now: NOW });
    assert.equal(view.nextAction.code, code, `wrong action for ${view.state}`);
    assert.ok(view.nextAction.headline.length > 0);
    assert.ok(view.nextAction.why.length > 0);
  }
});

test("forgetting empties both keys, verifies them, and returns consent to never asked", () => {
  const storage = retaining([periodOf()], { [FINOPS_LABELS_KEY]: JSON.stringify({ "psn_a": "Support" }) });
  assert.equal(readFinopsWorkspace(storage, { now: NOW }).counts.labels, 1);

  const result = forgetFinopsWorkspace(storage);
  const view = readFinopsWorkspace(storage, { now: NOW });

  assert.equal(result.ok, true);
  assert.deepEqual(
    [storage.getItem(FINOPS_WORKSPACE_KEY), storage.getItem(FINOPS_LABELS_KEY)], [null, null],
  );
  assert.equal(view.state, FINOPS_STATE.notAsked);
  assert.equal(view.counts.labels, 0);
});

test("the downloaded file holds everything the forget action would remove", () => {
  const storage = retaining([periodOf()], { [FINOPS_LABELS_KEY]: JSON.stringify({ "psn_a": "Support" }) });

  const file = finopsWorkspaceFile(storage, { now: NOW });

  assert.equal(file.workspace.schemaVersion, FINOPS_WORKSPACE_VERSION);
  assert.equal(file.workspace.periods.length, 1);
  assert.deepEqual(file.orgUnitLabels, { psn_a: "Support" });
  assert.equal(file.exportedAt, NOW.toISOString());
});

/* --------------------------------- the page --------------------------------- */

async function open(seed = {}) {
  const page = await loadPage(PAGE, { storage: seed });
  await importPageModule("/local-workspace-page.js");
  await waitFor(
    () => page.document.querySelector("#fw-panel").getAttribute("aria-busy") === "false",
    "the FinOps panel never finished reading storage",
  );
  return page;
}

/** The same seed the model half builds, flattened into storage entries. */
function seedOf(periods, extra = {}) {
  const storage = retaining(periods, extra);
  const seed = { ...extra };
  const document = storage.getItem(FINOPS_WORKSPACE_KEY);
  if (document) seed[FINOPS_WORKSPACE_KEY] = document;
  return seed;
}

const shown = (document, id) => textOf(document.querySelector(`#${id}`));
const click = (document, id) =>
  document.querySelector(`#${id}`).dispatchEvent(new DomEvent("click", { bubbles: true }));

test("the page ships a readable FinOps loading state before any module runs", async () => {
  const document = (await loadPage(PAGE)).document;

  assert.equal(document.querySelector("#fw-panel").getAttribute("aria-busy"), "true");
  assert.match(shown(document, "fw-summary"), /Reading this browser's FinOps keys/);
  // The boundary claims are static markup: they do not wait for a script.
  assert.match(shown(document, "finops-preview-title"), /What AI FinOps would remember here/);
  assert.match(shown(document, "finops-never-stored"), /Credentials, prompts, raw imports/);
  // Nothing is claimed to be kept before the store has been read.
  assert.equal(document.querySelector("#fw-briefing").hidden, true);
});

test("an unasked browser is offered the choice, and neither answer is preselected", async () => {
  const { document, storage, restore } = await open();
  try {
    assert.equal(textOf(document.querySelector("#fw-facts").querySelector(".ws-chip")), "Not asked yet");
    assert.match(shown(document, "fw-consent-note"), /^Not asked yet\./);
    assert.equal(document.querySelector("#fw-grant").getAttribute("aria-pressed"), "false");
    assert.equal(document.querySelector("#fw-decline").getAttribute("aria-pressed"), "false");
    assert.match(shown(document, "fw-next-title"), /Choose whether this browser remembers/);
    // Neither the briefing nor its disclosures exist to be read past yet.
    assert.equal(document.querySelector("#fw-briefing").hidden, true);
    assert.equal(document.querySelector("#fw-evidence").hidden, true);
    assert.equal(document.querySelector("#fw-export").disabled, true);
    assert.equal(document.querySelector("#fw-forget").disabled, true);
    // Drawing the page wrote nothing.
    assert.equal(storage.getItem(FINOPS_WORKSPACE_KEY), null);
  } finally {
    restore();
  }
});

test("opting in is one press, is reflected in the control, and is announced", async () => {
  const page = await open();
  const { document } = page;
  try {
    await click(document, "fw-next-action");

    assert.equal(document.querySelector("#fw-grant").getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelector("#fw-grant").disabled, true);
    assert.equal(shown(document, "fw-announcement"), FINOPS_OUTCOME.granted);
    assert.equal(textOf(document.querySelector("#fw-facts").querySelector(".ws-chip")), "Remembering · nothing kept");
    assert.match(shown(document, "fw-next-title"), /Import a provider export/);
    // The reader lands on the answer, not on the control whose label just changed.
    assert.equal(document.activeElement, document.querySelector("#fw-next-title"));
    assert.equal(JSON.parse(page.storage.getItem(FINOPS_WORKSPACE_KEY)).consent.state, "granted");
  } finally {
    page.restore();
  }
});

test("declining leaves the file flow named on screen and writes no figures", async () => {
  const page = await open();
  const { document } = page;
  try {
    await click(document, "fw-decline");

    assert.equal(document.querySelector("#fw-decline").getAttribute("aria-pressed"), "true");
    assert.equal(textOf(document.querySelector("#fw-facts").querySelector(".ws-chip")), "Not remembering");
    assert.match(shown(document, "fw-announcement"), /The AI FinOps page still analyses the files you choose/);
    assert.match(shown(document, "fw-next-title"), /Carry on with files only/);
    assert.equal(document.querySelector("#fw-next-action").getAttribute("href"), "/evolution.html");
    assert.deepEqual(JSON.parse(page.storage.getItem(FINOPS_WORKSPACE_KEY)).periods, []);
  } finally {
    page.restore();
  }
});

test("a retaining browser draws one benchmark, one confidence chip, and one action", async () => {
  const { document, restore } = await open(
    seedOf([periodOf({ month: "2026-05" }), periodOf({ month: "2026-06" })]),
  );
  try {
    assert.equal(document.querySelector("#fw-briefing").hidden, false);
    assert.equal(shown(document, "fw-benchmark-figure"), "5,200.00 USD");
    assert.equal(document.querySelector("#fw-benchmark-figure").dataset.available, "true");
    assert.match(shown(document, "fw-benchmark-label"), /Recoverable AI spend in this period/);
    assert.match(shown(document, "fw-briefing-period"), /2026-06, with 2026-05 retained beside it/);
    // Chips carry their meaning as words; the tone only reinforces it.
    const chips = document.querySelector("#fw-facts").querySelectorAll(".ws-chip");
    assert.deepEqual(chips.map((chip) => textOf(chip)), ["Remembering", "High"]);
    assert.deepEqual(chips.map((chip) => chip.dataset.tone), ["on", "verified"]);
    // Exactly one prioritized action, and it is the one the figure sizes.
    assert.equal(document.querySelector("#fw-next").querySelectorAll(".ws-next-action").length, 1);
    assert.match(shown(document, "fw-next-title"), /Record the decision this figure sizes/);
  } finally {
    restore();
  }
});

test("supporting evidence stays behind disclosures that name what is inside them", async () => {
  const { document, restore } = await open(
    seedOf([periodOf({ month: "2026-05" }), periodOf({ month: "2026-06" })],
      { [FINOPS_LABELS_KEY]: JSON.stringify({ psn_a: "Support" }) }),
  );
  try {
    for (const id of ["fw-evidence", "fw-provenance"]) {
      const disclosure = document.querySelector(`#${id}`);
      assert.equal(disclosure.hidden, false);
      // Closed by default: "what should I do?" is above the fold, "can I check
      // this?" is one keystroke below it.
      assert.equal(disclosure.hasAttribute("open"), false);
      assert.equal(disclosure.querySelector("summary").tagName, "SUMMARY");
    }
    assert.equal(shown(document, "fw-evidence-summary"), "Check the 2 retained periods behind this figure");
    assert.equal(document.querySelector("#fw-evidence-list").querySelectorAll("li").length, 2);
    assert.match(shown(document, "fw-evidence-list"), /2026-06 · your import/);
    assert.match(shown(document, "fw-provenance-list"), /Coverage/);
    // The records review counts the labels too, because forgetting takes them.
    assert.equal(shown(document, "fw-records-summary"), "Review the 3 records this browser is keeping");
    assert.match(shown(document, "fw-records-list"), /1 org-unit display label/);
  } finally {
    restore();
  }
});

test("the reader can reach every FinOps control by keyboard, in the order they are asked for", async () => {
  const { document, restore } = await open(seedOf([periodOf()]));
  try {
    const labels = tabSequence(document)
      .filter((stop) => stop.closest("#finops-workspace-preview"))
      // The scrollable contract preview is named by its id rather than by the
      // JSON inside it: it is a tab stop because it scrolls, and a keyboard
      // reader who cannot focus it cannot read it.
      .map((stop) => (stop.tagName === "PRE" ? stop.id : textOf(stop) || stop.id));
    // The one action first, then the choice, then the ordinary controls, then
    // the destructive one. Nothing reachable sits above the action it serves.
    // "Remember these figures" is absent because it is already the answer: a
    // disabled control is not a tab stop, so a keyboard reader is not walked
    // through a button that would change nothing. The disclosure summaries are
    // stops in their own right — a <summary> is focusable because it is a
    // summary — so each appears at the DOM position it is reached from.
    assert.deepEqual(labels, [
      "Inspect every retained field and sample value",
      "finops-preview-json",
      "Open the AI FinOps page",
      "Check the 1 retained period behind this figure",
      "Where every figure above comes from",
      // The return path sits above the controls it prefills, and offers exactly
      // two stops until a file is chosen: the file control and the way back to
      // setting up from scratch. Everything else it adds is inside a region that
      // is hidden until there is something in it, so it is not a stop yet.
      "fw-return-file",
      "Start over and set up from scratch",
      "Keep using files only",
      "Download FinOps JSON",
      "fw-import",
      "Forget FinOps figures",
      "Review the 1 record this browser is keeping",
    ]);
    // The Shiplog half of the page still leads: nothing in the FinOps flow is
    // reached before every Shiplog control has been.
    const all = tabSequence(document).filter((stop) => stop.closest("#main-content"));
    const first = all.findIndex((stop) => stop.closest("#finops-workspace-preview"));
    assert.equal(all.slice(first).length, labels.length);
  } finally {
    restore();
  }
});

test("the FinOps download writes one file and changes nothing in this browser", async () => {
  const page = await open(seedOf([periodOf()]));
  const { document } = page;
  try {
    const before = page.storage.getItem(FINOPS_WORKSPACE_KEY);
    await click(document, "fw-export");

    assert.equal(page.downloads.length, 1);
    assert.match(page.downloads[0].filename, /^finops-workspace-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(shown(document, "fw-announcement"), FINOPS_OUTCOME.exported);
    assert.equal(page.storage.getItem(FINOPS_WORKSPACE_KEY), before);
  } finally {
    page.restore();
  }
});

test("the import review renders static-contract compatibility before local reuse", async () => {
  const source = await open(seedOf([periodOf()]));
  const portable = serializeFinopsPortableRecord(source.storage);
  source.restore();
  const target = await open();
  try {
    const input = target.document.querySelector("#fw-import");
    input.files = [{ text: async () => portable }];
    await input.dispatchEvent(new DomEvent("change", { bubbles: true }));

    assert.equal(target.document.querySelector("#fw-import-confirm").hidden, false);
    assert.match(shown(target.document, "fw-import-review-result"),
      /privacy-preserving source declaration.*compatible with the static v1 contracts/i);
    assert.match(shown(target.document, "fw-announcement"), /Review and approve before reuse/);
    assert.equal(target.document.querySelector("#fw-import-replace-note").hidden, true,
      "an empty browser is not warned about a replacement that is not happening");
    assert.equal(target.storage.getItem(FINOPS_WORKSPACE_KEY), null, "review must not write");

    await click(target.document, "fw-import-confirm-yes");
    assert.match(shown(target.document, "fw-announcement"), /FinOps record imported/);
    assert.equal(JSON.parse(target.storage.getItem(FINOPS_WORKSPACE_KEY)).periods.length, 1);
  } finally {
    target.restore();
  }
});

// Compatibility says whether a declaration may be reused. It does not say what
// is already here, and one press does both, so the review must state both.
test("a record already in this browser is named as replaceable before reuse is approved", async () => {
  const source = await open(seedOf([periodOf({ month: "2026-06" })]));
  const portable = serializeFinopsPortableRecord(source.storage);
  source.restore();
  const target = await open(seedOf([periodOf({ month: "2026-05" })]));
  try {
    const input = target.document.querySelector("#fw-import");
    input.files = [{ text: async () => portable }];
    await input.dispatchEvent(new DomEvent("change", { bubbles: true }));

    assert.equal(target.document.querySelector("#fw-import-replace-note").hidden, false);
    assert.match(shown(target.document, "fw-import-replace-note"), /Approving replaces/);
  } finally {
    target.restore();
  }
});

test("a stale declaration is refused with a local correction path and marks the control invalid", async () => {
  const source = await open(seedOf([periodOf()]));
  const record = JSON.parse(serializeFinopsPortableRecord(source.storage));
  source.restore();
  record.sourceDeclarations[0].mappingVersion = "provider-billing-to-finops/0.9.0";
  const target = await open();
  try {
    const input = target.document.querySelector("#fw-import");
    input.files = [{ text: async () => JSON.stringify(record) }];
    await input.dispatchEvent(new DomEvent("change", { bubbles: true }));

    assert.equal(target.document.querySelector("#fw-import-confirm").hidden, true,
      "a stale declaration must not offer the approval press at all");
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.match(shown(target.document, "fw-announcement"), /Re-export this file locally/);
    assert.equal(target.storage.getItem(FINOPS_WORKSPACE_KEY), null);
  } finally {
    target.restore();
  }
});

test("forgetting asks first, names what it will take, and cancelling changes nothing", async () => {
  const page = await open(seedOf([periodOf()], { [FINOPS_LABELS_KEY]: JSON.stringify({ psn_a: "Support" }) }));
  const { document } = page;
  try {
    const forget = document.querySelector("#fw-forget");
    const confirm = document.querySelector("#fw-confirm");
    assert.equal(confirm.hidden, true);
    assert.equal(forget.getAttribute("aria-expanded"), "false");

    await forget.dispatchEvent(new DomEvent("click", { bubbles: true }));

    assert.equal(confirm.hidden, false);
    assert.equal(forget.getAttribute("aria-expanded"), "true");
    // Focus moves into the region a reader has to answer, not past it.
    assert.equal(document.activeElement, document.querySelector("#fw-confirm-title"));
    // The commit button counts what is actually at stake.
    assert.equal(shown(document, "fw-confirm-yes"), "Forget 2 records");
    assert.match(shown(document, "fw-confirm-warning"), /Shiplog decisions and releases are not touched/);

    await click(document, "fw-confirm-no");

    assert.equal(confirm.hidden, true);
    assert.equal(document.activeElement, forget);
    assert.match(shown(document, "fw-announcement"), /Forget cancelled\. Nothing in this browser was changed\./);
    assert.equal(JSON.parse(page.storage.getItem(FINOPS_WORKSPACE_KEY)).periods.length, 1);
  } finally {
    page.restore();
  }
});

test("confirming the forget empties both keys, redraws, and leaves Shiplog records alone", async () => {
  const page = await open({
    ...seedOf([periodOf()], { [FINOPS_LABELS_KEY]: JSON.stringify({ psn_a: "Support" }) }),
    "shiplog.decisions.v1": JSON.stringify([{ id: "keep-me" }]),
  });
  const { document } = page;
  try {
    await click(document, "fw-forget");
    await click(document, "fw-confirm-yes");

    assert.equal(shown(document, "fw-announcement"), FINOPS_OUTCOME.forgotten);
    assert.equal(shown(document, "fw-outcome"), FINOPS_OUTCOME.forgotten);
    assert.equal(document.querySelector("#fw-outcome").hidden, false);
    // Drawn, not merely announced: the state returns to never-asked.
    assert.equal(textOf(document.querySelector("#fw-facts").querySelector(".ws-chip")), "Not asked yet");
    assert.equal(document.querySelector("#fw-briefing").hidden, true);
    assert.equal(document.querySelector("#fw-forget").disabled, true);
    assert.equal(document.activeElement, document.querySelector("#fw-next-title"));
    assert.deepEqual(
      [page.storage.getItem(FINOPS_WORKSPACE_KEY), page.storage.getItem(FINOPS_LABELS_KEY)],
      [null, null],
    );
    // The other store on this page is untouched.
    assert.equal(JSON.parse(page.storage.getItem("shiplog.decisions.v1")).length, 1);
  } finally {
    page.restore();
  }
});

test("unreadable FinOps text is drawn as unreadable, and the action is to forget it", async () => {
  const { document, restore } = await open({ [FINOPS_WORKSPACE_KEY]: "{ truncated" });
  try {
    assert.equal(textOf(document.querySelector("#fw-facts").querySelector(".ws-chip")), "Stored text unreadable");
    assert.match(shown(document, "fw-next-title"), /Forget the unreadable FinOps text/);
    assert.equal(document.querySelector("#fw-forget").disabled, false);
    // No figure is invented over text the page could not read.
    assert.equal(document.querySelector("#fw-briefing").hidden, true);
  } finally {
    restore();
  }
});
