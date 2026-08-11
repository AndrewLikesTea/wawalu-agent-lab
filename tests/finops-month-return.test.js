// Coming back a month later: import the record, add one month, get one answer.
//
// Two halves again. The first pins the model — which refusal a bad file earns,
// which declarations may be prefilled and which may not, and what the summary
// claims — by calling the shipped modules rather than a description of them.
// Every verdict here comes out of the merged two-period evaluator and every
// compatibility call out of the merged codec, so a change to either surfaces in
// this file instead of being masked by a copy.
//
// The second boots src/workspace.html the way the browser boots it and asserts
// only what a reader can perceive: what the one live region says, where focus
// lands, what a keyboard reaches, and how many claims the summary makes.

import test from "node:test";
import assert from "node:assert/strict";

import { buildFinopsBriefing } from "../src/finops-briefing-contract.js";
import { FINOPS_LABELS_KEY, FINOPS_WORKSPACE_KEY } from "../src/finops-workspace-contract.js";
import {
  FINOPS_CONSENT, projectRetainedPeriod, retainFinopsCommitment, retainFinopsPeriod,
  setFinopsConsent,
} from "../src/finops-workspace.js";
import { serializeFinopsPortableRecord } from "../src/finops-portable-record.js";
import {
  addReturnMonth, parseSpendInput, planReturn, readReturnFile,
} from "../src/finops-month-return.js";
import { DomEvent, loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/workspace.html", import.meta.url);
const NOW = new Date("2026-07-28T11:30:00.000Z");

function storageOf(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
}

function analysisOf({ month = "2026-06", spendUsd = 7430 } = {}) {
  const next = `${month.slice(0, 5)}${String(Number(month.slice(5)) + 1).padStart(2, "0")}`;
  return {
    schemaVersion: "local-finops-history/1.0.0",
    period: `${month}-01 to ${next}-01`,
    spendUsd,
    recoverableUsd: 5200,
    rankedDepartments: [
      { id: "customer-support", name: "Customer support", spendUsd: spendUsd * 0.6, recoverableUsd: 5200 },
      { id: "platform", name: "Platform", spendUsd: spendUsd * 0.4, recoverableUsd: 0 },
    ],
    topDepartment: { id: "customer-support", recoverableUsd: 5200 },
    action: "Pilot lower-cost routing for text generation in the highest-spend org unit.",
    quality: {
      joinedRecords: 760, quarantinedRecords: 40, providerCompleteness: true, hrisCompleteness: true,
    },
  };
}

const periodOf = (options = {}) => {
  const analysis = analysisOf(options);
  return projectRetainedPeriod({
    briefing: buildFinopsBriefing(analysis, options),
    analysis,
    dataset: "user",
    now: new Date("2026-07-02T09:14:00.000Z"),
  });
};

/** One approved commitment, in the envelope the workspace store keeps. */
const commitmentOf = ({ period = "2026-06", savingMinor = 10_000 } = {}) => ({
  schemaVersion: "shiplog-finops-commitment/1.0.0",
  commitmentId: `commit-${period}`,
  claim: {
    baselineMonthlyCostMinor: 743_000,
    projectedMonthlyCostMinor: 743_000 - savingMinor,
    monthlySavingsMinor: savingMinor,
    currency: "USD",
    period,
  },
  confidence: { percent: 80, band: "moderate" },
  provenance: { designation: "declared", analysisPeriod: period, recordCount: 760 },
  recommendedAction: {
    workloadId: "text-generation", departmentId: "customer-support",
    fromModelId: "gpt-4o", toModelId: "gpt-4o-mini",
  },
  recordedAt: "2026-07-02T09:14:00.000Z",
  status: "recorded",
  periodId: `user:${period}`,
});

/**
 * A portable record, written by the shipped serializer out of a browser that
 * retained the given months and commitments. Never hand-typed: a hand-typed
 * record is a second opinion about the codec's own output.
 */
function recordOf({ months = ["2026-06"], commitments = [commitmentOf()], labels = null } = {}) {
  const storage = storageOf(labels ? { [FINOPS_LABELS_KEY]: JSON.stringify(labels) } : {});
  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now: NOW });
  for (const month of months) retainFinopsPeriod(storage, periodOf({ month }), { now: NOW });
  for (const commitment of commitments) retainFinopsCommitment(storage, commitment, { now: NOW });
  return JSON.parse(serializeFinopsPortableRecord(storage));
}

const planOf = (record, options = {}) => {
  const read = readReturnFile(JSON.stringify(record));
  assert.equal(read.ok, true, `the record under test is not valid: ${read.detail ?? ""}`);
  return planReturn(read.parsed, { now: NOW, ...options });
};

/* --------------------------------- the model -------------------------------- */

test("the three ways a file can fail each earn their own instruction", () => {
  const unreadable = readReturnFile("{ truncated");
  const wrongVersion = readReturnFile(JSON.stringify({
    ...recordOf(), schemaVersion: "finops-portable-record/9.9.9",
  }));
  const invalid = readReturnFile(JSON.stringify({
    ...recordOf(), periods: [{ periodId: "user:2026-06", period: "nope" }],
  }));

  assert.deepEqual(
    [unreadable.code, wrongVersion.code, invalid.code],
    ["unreadable_file", "unsupported_version", "invalid_record"],
  );
  // Three different errands: choose another file, re-export it, correct it.
  assert.match(unreadable.message, /could not be read as JSON text/);
  assert.match(wrongVersion.message, /download it again/);
  assert.match(invalid.message, /do not match the record contract/);
  const messages = new Set([unreadable.message, wrongVersion.message, invalid.message]);
  assert.equal(messages.size, 3, "a shared 'import failed' sentence would be no instruction at all");
});

test("a valid record prefills its setup and names the month it is waiting for", () => {
  const plan = planOf(recordOf({ labels: { psn_a: "Support" } }));

  assert.equal(plan.prefill.periods, 1);
  assert.equal(plan.prefill.commitments, 1);
  assert.equal(plan.prefill.labels, 1);
  assert.equal(plan.priorMonth, "2026-06");
  assert.equal(plan.nextMonth, "2026-07");
  assert.deepEqual(plan.review, []);
  assert.equal(plan.reusable.length, 2);
});

test("a stale declaration and an incompatible one are surfaced apart, and neither is prefilled", () => {
  const record = recordOf({ labels: { psn_a: "Support" } });
  const provider = record.sourceDeclarations.find((entry) => entry.role === "provider");
  const hris = record.sourceDeclarations.find((entry) => entry.role === "hris");
  provider.mappingVersion = "provider-billing-to-finops/0.9.0";
  hris.contractVersion = "2.0";

  const plan = planOf(record);

  assert.deepEqual(plan.review.map((entry) => [entry.role, entry.wording]),
    [["provider", "Stale"], ["hris", "Incompatible"]]);
  // Old and wrong are different failures and are told apart in words.
  assert.match(plan.review[0].why, /older mapping/);
  assert.match(plan.review[1].why, /does not support/);
  assert.deepEqual(plan.reusable, []);

  // Held back means held out of the arithmetic, not merely annotated.
  const held = addReturnMonth(plan, { month: "2026-07", spendMinor: 733_000 });
  assert.equal(held.summary.verdict.comparable, false);
  assert.equal(held.summary.verdict.headline, "No comparison available");
  assert.match(held.summary.verdict.statement, /held back for review/);
  assert.match(held.summary.nextAction.headline, /Review the provider source declaration/);

  // And an explicit review of that one declaration is what lets its figures in.
  const used = addReturnMonth(plan, {
    month: "2026-07", spendMinor: 733_000, approvedRoles: ["provider"],
  });
  assert.equal(used.summary.verdict.code, "met");
  assert.match(used.summary.evidence.declarations.join(" "), /provider · stale · used after review/);
  assert.match(used.summary.evidence.declarations.join(" "), /hris · incompatible · held back/);
});

test("one added month answers with a verdict, a movement, and one next action", () => {
  const plan = planOf(recordOf());

  const { summary } = addReturnMonth(plan, { month: "2026-07", spendMinor: 733_000 });

  assert.equal(summary.verdict.code, "met");
  assert.equal(summary.verdict.comparable, true);
  assert.equal(summary.movement.material, true);
  assert.equal(summary.movement.percentOfBenchmark, 100);
  assert.match(summary.movement.statement, /100% of the 100.00 USD committed saving/);
  // Material is the benchmark's own missed floor, quoted from the evaluator.
  assert.match(summary.movement.statement, /25% missed floor.*95% or more/);
  assert.match(summary.nextAction.headline, /Commit the next month's saving/);
  // Provenance is evidence, not a fourth claim.
  assert.match(summary.evidence.periods.join(" "), /2026-06 · 7,430.00 USD retained/);
  assert.match(summary.evidence.lines.join(" "), /commitment commit-2026-06/);
  assert.equal(summary.evidence.recordVersion, "finops-portable-record/1.1.0");
});

test("movement under the benchmark's own floor is reported as immaterial, not as nothing", () => {
  const plan = planOf(recordOf());

  const { summary } = addReturnMonth(plan, { month: "2026-07", spendMinor: 742_000 });

  assert.equal(summary.verdict.code, "missed");
  assert.equal(summary.movement.material, false);
  assert.match(summary.movement.headline, /Immaterial movement: 10.00 USD below 2026-06/);
  assert.match(summary.nextAction.headline, /Reopen the commitment that missed/);
});

test("a month with no commitment before it is told so plainly, not graded hollow", () => {
  const plan = planOf(recordOf({ months: ["2026-06"] }));

  const { summary } = addReturnMonth(plan, { month: "2026-08", spendMinor: 700_000 });

  assert.equal(summary.verdict.code, "not_enough_evidence");
  assert.equal(summary.verdict.headline, "No comparison available");
  assert.equal(summary.verdict.comparable, false);
  assert.match(summary.verdict.statement, /No commitment was made in the month before 2026-08/);
  assert.equal(summary.movement.material, false);
  assert.match(summary.movement.headline, /No month-over-month movement to measure/);
  assert.match(summary.nextAction.headline, /Add the missing month/);
});

test("a commitment whose committed month is not retained abstains for that reason", () => {
  const plan = planOf(recordOf({ months: ["2026-05"], commitments: [commitmentOf()] }));

  const { summary } = addReturnMonth(plan, { month: "2026-07", spendMinor: 733_000 });

  assert.equal(summary.verdict.comparable, false);
  assert.match(summary.verdict.statement, /committed month 2026-06 is not retained/);
});

test("a record with no prior month says this is the first one, and still adds it", () => {
  const plan = planOf(recordOf({ months: [], commitments: [] }));

  assert.equal(plan.prefill.periods, 0);
  assert.equal(plan.nextMonth, "2026-07", "with nothing on file the clock names the month");

  const { summary } = addReturnMonth(plan, { month: "2026-07", spendMinor: 733_000 });
  assert.equal(summary.verdict.headline, "No comparison available");
  assert.match(summary.verdict.statement, /carries no prior month/);
  assert.match(summary.evidence.periods.join(" "), /2026-07 · 7,330.00 USD added now/);
});

test("a month or a total the page cannot read is refused before anything is scored", () => {
  const plan = planOf(recordOf());

  assert.equal(addReturnMonth(plan, { month: "July", spendMinor: 1 }).code, "invalid_month");
  assert.equal(addReturnMonth(plan, { month: "2026-07", spendMinor: -1 }).code, "invalid_spend");
  assert.deepEqual(
    ["7430.50", "7,430.50", "$7430", "", "seven", "1.234"].map(parseSpendInput),
    [743_050, 743_050, 743_000, null, null, null],
  );
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

const shown = (document, id) => textOf(document.querySelector(`#${id}`));
const click = (document, id) =>
  document.querySelector(`#${id}`).dispatchEvent(new DomEvent("click", { bubbles: true }));

async function choose(document, record) {
  const input = document.querySelector("#fw-return-file");
  input.files = [{ text: async () => (typeof record === "string" ? record : JSON.stringify(record)) }];
  await input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return input;
}

/** Choose a record and answer the review, which is where the write happens. */
async function stage(document, record) {
  await choose(document, record);
  if (!document.querySelector("#fw-return-replace").hidden) await click(document, "fw-return-replace-yes");
}

function type(document, id, value) {
  const field = document.querySelector(`#${id}`);
  field.value = value;
  field.dispatchEvent(new DomEvent("input", { bubbles: true }));
  return field;
}

/** Every element under `node`, without the universal selector the harness rejects. */
function descendants(node, found = []) {
  for (const child of node.children ?? []) {
    if (typeof child.getAttribute === "function") {
      found.push(child);
      descendants(child, found);
    }
  }
  return found;
}

const inside = (node, ancestorId) => {
  for (let step = node; step; step = step.parentNode) if (step.id === ancestorId) return true;
  return false;
};

test("the return path is offered beside the from-scratch setup, and reaches it by keyboard", async () => {
  const { document, restore } = await open();
  try {
    const stops = tabSequence(document)
      .filter((stop) => inside(stop, "fw-return"))
      .map((stop) => textOf(stop) || stop.id);
    // Before a file is chosen there are exactly two: the control that takes one,
    // and the way back to setting up from scratch. Both are real controls.
    assert.deepEqual(stops, ["fw-return-file", "Start over and set up from scratch"]);
    const file = document.querySelector("#fw-return-file");
    assert.equal(file.tagName, "INPUT");
    assert.equal(file.type, "file");
    assert.equal(document.querySelector('label[for="fw-return-file"]').tagName, "LABEL");
    assert.equal(document.querySelector("#fw-return-restart").tagName, "BUTTON");
    // The from-scratch choice is still on the page, untouched.
    assert.equal(document.querySelector("#fw-grant").disabled, false);
    // And this region adds no second live region: one channel, one announcement.
    assert.equal(
      descendants(document.querySelector("#fw-return"))
        .filter((node) => node.getAttribute("aria-live")).length,
      0,
    );
  } finally {
    restore();
  }
});

test("each of the three file failures is announced in its own words, through the one region", async () => {
  const { document, restore } = await open();
  try {
    const said = [];
    for (const text of [
      "{ truncated",
      JSON.stringify({ ...recordOf(), schemaVersion: "finops-portable-record/9.9.9" }),
      JSON.stringify({ ...recordOf(), labels: { "not a label id": "x" } }),
    ]) {
      await choose(document, text);
      said.push(shown(document, "fw-announcement"));
      assert.equal(document.querySelector("#fw-return-file").getAttribute("aria-invalid"), "true");
      assert.equal(document.querySelector("#fw-return-setup").hidden, true);
    }
    assert.equal(new Set(said).size, 3);
    assert.match(said[0], /could not be read as JSON text/);
    assert.match(said[1], /download it again/);
    assert.match(said[2], /do not match the record contract/);
    // The visible notice and the announcement carry the same sentence.
    assert.equal(shown(document, "fw-outcome"), said[2]);
  } finally {
    restore();
  }
});

test("adding a month is one press after a valid import, and lands three claims", async () => {
  const page = await open();
  const { document } = page;
  try {
    await stage(document, recordOf());

    assert.equal(document.querySelector("#fw-return-setup").hidden, false);
    // The setup came out of the file: the reader re-enters nothing.
    assert.match(shown(document, "fw-return-prefill"), /1 prior month.*1 approved commitment/);
    assert.equal(document.querySelector("#fw-return-month").value, "2026-07");
    assert.equal(document.activeElement, document.querySelector("#fw-return-prefill"));
    // The add action is reachable by keyboard once there is something to add.
    assert.ok(tabSequence(document).some((stop) => stop.id === "fw-return-add"));

    type(document, "fw-return-spend", "7330");
    await click(document, "fw-return-add");

    const summary = document.querySelector("#fw-return-summary");
    assert.equal(summary.hidden, false);
    // Exactly three claims at the top level. A fourth headline would make the
    // reader choose which one the month is about.
    const claims = descendants(summary).filter((node) => node.dataset?.claim);
    assert.deepEqual(claims.map((node) => node.dataset.claim), ["verdict", "movement", "next-action"]);
    assert.equal(claims.filter((node) => inside(node, "fw-return-evidence")).length, 0);
    assert.match(shown(document, "fw-return-verdict"), /^Commitment met\./);
    assert.match(shown(document, "fw-return-movement"), /Material movement: 100.00 USD below 2026-06/);
    assert.match(shown(document, "fw-return-next"), /Do this next: Commit the next month's saving/);
    // Evidence sits inside the disclosure, closed, and is not a claim.
    const evidence = document.querySelector("#fw-return-evidence");
    assert.equal(evidence.hasAttribute("open"), false);
    assert.ok(document.querySelector("#fw-return-evidence-list").querySelectorAll("li").length >= 4);
    assert.equal(inside(document.querySelector("#fw-return-evidence-list"), "fw-return-evidence"), true);
    // Announced once, in the region the section already had, and focus lands on
    // the answer rather than on the button that produced it.
    assert.match(shown(document, "fw-announcement"), /^2026-07 added\. Commitment met\./);
    assert.equal(document.activeElement, document.querySelector("#fw-return-summary-title"));
  } finally {
    page.restore();
  }
});

test("re-importing over a record already here names what would be replaced first", async () => {
  const source = await open();
  const first = recordOf({ months: ["2026-05"] });
  await stage(source.document, first);
  const kept = source.storage.getItem(FINOPS_WORKSPACE_KEY);
  source.restore();

  const page = await open({ [FINOPS_WORKSPACE_KEY]: kept });
  const { document } = page;
  try {
    await choose(document, recordOf({ months: ["2026-06"] }));

    const replace = document.querySelector("#fw-return-replace");
    assert.equal(replace.hidden, false);
    assert.match(shown(document, "fw-return-replace-title"), /Replace the record already in this browser/);
    assert.match(shown(document, "fw-return-replace-detail"), /REPLACES all of it/);
    assert.match(shown(document, "fw-return-replace-detail"), /1 retained period/);
    assert.equal(document.activeElement, document.querySelector("#fw-return-replace-title"));
    // Nothing was replaced by the warning itself.
    assert.equal(page.storage.getItem(FINOPS_WORKSPACE_KEY), kept);
    assert.equal(document.querySelector("#fw-return-setup").hidden, true);

    await click(document, "fw-return-replace-no");
    assert.equal(page.storage.getItem(FINOPS_WORKSPACE_KEY), kept);
    assert.match(shown(document, "fw-announcement"), /Nothing was replaced/);

    await choose(document, recordOf({ months: ["2026-06"] }));
    await click(document, "fw-return-replace-yes");
    assert.equal(JSON.parse(page.storage.getItem(FINOPS_WORKSPACE_KEY)).periods[0].period, "2026-06");
    assert.equal(document.querySelector("#fw-return-setup").hidden, false);
  } finally {
    page.restore();
  }
});

test("a declaration needing review is named on screen and keeps its figures out", async () => {
  const record = recordOf();
  record.sourceDeclarations[0].mappingVersion = "provider-billing-to-finops/0.9.0";
  const page = await open();
  const { document } = page;
  try {
    await choose(document, record);

    // Not written: the codec refuses this file whole, and the page does not
    // overrule it by writing most of it.
    assert.equal(page.storage.getItem(FINOPS_WORKSPACE_KEY), null);
    assert.equal(document.querySelector("#fw-return-review").hidden, false);
    assert.match(shown(document, "fw-return-review-list"), /Stale: the provider declaration/);
    assert.match(shown(document, "fw-return-review-list"), /Re-export this file locally/);

    type(document, "fw-return-spend", "7330");
    await click(document, "fw-return-add");
    assert.match(shown(document, "fw-return-verdict"), /^No comparison available\./);

    // One explicit press per declaration, then the figures are allowed in.
    await click(document, "fw-return-approve-provider");
    await click(document, "fw-return-add");
    assert.match(shown(document, "fw-return-verdict"), /^Commitment met\./);
  } finally {
    page.restore();
  }
});

test("starting over clears the staged import and hands the reader back to setup", async () => {
  const page = await open();
  const { document } = page;
  try {
    await stage(document, recordOf());
    type(document, "fw-return-spend", "7330");
    await click(document, "fw-return-add");
    assert.equal(document.querySelector("#fw-return-summary").hidden, false);

    await click(document, "fw-return-restart");

    assert.equal(document.querySelector("#fw-return-setup").hidden, true);
    assert.equal(document.querySelector("#fw-return-summary").hidden, true);
    assert.equal(document.querySelector("#fw-return-spend").value, "");
    assert.equal(document.querySelector("#fw-return-file").value, "");
    assert.match(shown(document, "fw-announcement"), /Set up from scratch with the choice below/);
    // The reader is put on the from-scratch control, not left on a cleared form.
    assert.equal(document.activeElement, document.querySelector("#fw-grant"));
  } finally {
    page.restore();
  }
});
