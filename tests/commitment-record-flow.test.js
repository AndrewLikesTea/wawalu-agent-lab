// Recording the decisive FinOps finding as a Shiplog decision.
//
// Three things are pinned here:
//
//   1. THE ONE ACTION WORKS END TO END. The shipped page, its shipped markup,
//      and Rowan's `recordCommitmentDecision` put one decision in the browser's
//      own log, and the confirmation links to it and says what to do next.
//   2. THE HANDOFF IS THE VISITOR'S OWN FILE, AND A BAD ONE COSTS NOTHING. A
//      briefing that cannot be read, or that carries no commitment, leaves the
//      commitment already on screen exactly where it was.
//   3. THE DISCLOSURES STAY REACHABLE. Confidence, provenance, and the
//      supporting calculation are native disclosures with named summaries, and
//      the confirmation is a labelled region focus lands on.
//
// The briefing files are built in-test from `buildBriefing` — the same call the
// AI FinOps export button makes — rather than committed as JSON, so a change to
// the file format fails here instead of leaving a stale fixture behind.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { analyzeModelRouting } from "../src/down-routing-candidates.js";
import { buildBriefing, serializeBriefing } from "../src/finops-briefing-export.js";
import {
  COMMITMENT_ORIGIN,
  previewFromCommitmentBlock,
  readCommitmentHandoff,
  readCommitmentHandoffs,
} from "../src/commitment-handoff.js";
import { COMMITMENT_METADATA_FIELD } from "../src/finops-commitment-decision.js";

const PAGE = new URL("../src/savings-commitment.html", import.meta.url);
const FIXTURE = JSON.parse(await readFile(
  new URL("../src/savings-commitment-fixture.json", import.meta.url), "utf8",
));
const DECISION_STORAGE_KEY = "shiplog.decisions.v1";

/* --------------------------------- fixtures -------------------------------- */

/** One per-model row the routing rule scores: 300.00 USD repriced at 150.00. */
function usageRow(overrides = {}) {
  return {
    orgUnitId: "psn_example_unit_atlas0",
    model: "Vendor-Large-2026",
    provider: "openai",
    inputTokens: 6_000_000,
    outputTokens: 4_000_000,
    tokens: 10_000_000,
    requests: 5_000,
    spendMinor: 30_000,
    estimated: false,
    sourceRows: 12,
    ...overrides,
  };
}

function envelope({ modelUsage = [usageRow()], period = "2026-06-01 to 2026-07-01" } = {}) {
  const unitIds = [...new Set(modelUsage.map((row) => row.orgUnitId))];
  return {
    schemaVersion: "local-finops/1.0.0",
    generatedAt: "2026-07-02T09:15:00.000Z",
    period,
    spendUsd: 1_000,
    recoverableUsd: 150,
    rankedDepartments: unitIds.map((id) => ({
      id,
      name: "Atlas Platform",
      spendUsd: 500,
      recoverableUsd: 150,
      records: 12,
      downRouting: { ruleVersion: "down-routing-candidate/1.0.0", recoverableUsd: 150 },
    })),
    modelRouting: analyzeModelRouting({ modelUsage, unitIds }),
    quality: { joinedRecords: 12, quarantinedRecords: 0, providerCompleteness: "complete" },
    action: "Pilot lower-cost routing for text-generation in Atlas Platform.",
    topDepartment: { id: unitIds[0], recoverableUsd: 150 },
  };
}

function briefingPayload(options = {}) {
  return buildBriefing(envelope(options), {
    dataset: "user", exportedAt: "2026-07-10T08:00:00.000Z",
  });
}

const briefingText = (options) => serializeBriefing(briefingPayload(options));

const file = (name, text) => ({ name, size: text.length, text: async () => text });

/* ------------------------------- the handoff ------------------------------- */

test("an exported briefing hands over the commitment it carries", () => {
  const read = readCommitmentHandoff({
    name: "shiplog-finops-briefing.json", text: briefingText(), byteSize: 4_000,
  });

  assert.equal(read.ok, true, read.message ?? "");
  assert.equal(read.origin, COMMITMENT_ORIGIN.imported);
  assert.equal(read.month, "2026-06");
  assert.equal(read.dataset, "user");
  assert.equal(read.preview.status, "ok");
  assert.equal(read.preview.designation, "imported");
  assert.equal(read.preview.commitment.department.departmentId, "psn-example-unit-atlas0");
  assert.equal(read.preview.commitment.projectedMonthlySavings.amountUsd, 150);
  // The label names the month, whose spend it is, and when the file was written,
  // so nobody records a decision against the wrong month by mistake.
  assert.match(read.label,
    /shiplog-finops-briefing\.json · the 2026-06 analysis · your own imported spend · briefing written 2026-07-10/);
});

test("a file that is not a readable briefing is refused with the reader's own sentence", () => {
  const cases = [
    ["not-json.json", "{ truncated", /not complete JSON/],
    ["not-a-briefing.json", JSON.stringify({ nope: true }), /not a saved briefing|different version/],
    ["empty.json", "", /not complete JSON|could not be read/],
  ];
  for (const [name, text, expected] of cases) {
    const read = readCommitmentHandoff({ name, text });
    assert.equal(read.ok, false, `${name} was accepted`);
    assert.equal(read.preview, null);
    assert.match(read.message, expected);
    assert.equal(read.name, name);
  }
});

test("a briefing whose analysis proposes no commitment says so, and offers no decision", () => {
  // A window that is not one calendar month has no monthly baseline to commit
  // against, so the block travels as `unavailable` with its own sentence.
  const payload = briefingPayload({ period: "2026-06-01 to 2026-06-15" });
  const read = readCommitmentHandoff({ name: "half-month.json", text: serializeBriefing(payload) });
  assert.equal(read.ok, false);
  assert.equal(read.code, "commitment_unavailable");
  assert.match(read.message, /states a monthly saving against a monthly baseline/);
});

test("a hand-edited commitment block is refused rather than half-believed", () => {
  // The built payload is frozen, so the edit is made on a copy — which is what
  // a hand-edited file is anyway.
  const payload = JSON.parse(JSON.stringify(briefingPayload()));
  payload.savingsCommitment.commitment.projectedMonthlySavings.amountMinor = 9_999_900;
  const read = readCommitmentHandoff({ name: "edited.json", text: serializeBriefing(payload) });
  assert.equal(read.ok, false);
  assert.match(read.message, /did not satisfy the savings-commitment contract|not satisfy/);

  // And the projection refuses the same block directly, so no caller can route
  // around the file reader and believe it.
  assert.equal(previewFromCommitmentBlock(payload.savingsCommitment), null);
  assert.equal(previewFromCommitmentBlock(null), null);
  assert.equal(previewFromCommitmentBlock({ status: "unavailable" }), null);
});

test("one commitment is decided at a time; the rest of a selection are reported", () => {
  const good = briefingText();
  const read = readCommitmentHandoffs([
    { name: "first.json", text: good },
    { name: "broken.json", text: "{" },
    { name: "second.json", text: good },
  ]);
  assert.equal(read.accepted.name, "second.json");
  assert.deepEqual(read.rejections.map((entry) => entry.name), ["broken.json", "first.json"]);
  assert.deepEqual(readCommitmentHandoffs([]).accepted, null);
});

/* -------------------------------- the page --------------------------------- */

async function openPage(storage = {}) {
  const page = await loadPage(PAGE, {
    storage,
    routes: { "/savings-commitment-fixture.json": FIXTURE },
  });
  await importPageModule("/savings-commitment-page.js");
  await waitFor(() => page.document.getElementById("savings-commitment")
    .getAttribute("aria-busy") === "false", "the commitment to render");
  return page;
}

const byId = (document, id) => document.getElementById(id);

function chooseFile(document, name, text) {
  const input = byId(document, "commit-file");
  input.files = [file(name, text)];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

test("the page records one decision and confirms it with a link and next steps", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    assert.match(textOf(byId(document, "commit-handoff-status")), /bundled example analysis/);

    const button = byId(document, "commit-record-submit");
    assert.equal(textOf(button), "Record this decision");
    byId(document, "commit-record-owner").value = "Director of Platform";
    button.click();

    // One decision, written through the same store the record form uses.
    const decisions = JSON.parse(page.storage.getItem(DECISION_STORAGE_KEY));
    assert.equal(decisions.length, 1);
    const [decision] = decisions;
    assert.equal(decision.id, "finops-commitment-syn-commit-support-triage");
    assert.equal(decision.owner, "Director of Platform");
    assert.equal(decision.status, "accepted");
    assert.equal(decision[COMMITMENT_METADATA_FIELD].claim.monthlySavingsMinor, 3_130_000);

    // The confirmation is a labelled region, focus lands on it, and it links to
    // the decision that was just written.
    const confirmation = document.querySelector(".commit-recorded");
    assert.equal(confirmation.getAttribute("tabindex"), "-1");
    assert.equal(confirmation.getAttribute("aria-labelledby"), "commit-recorded-title");
    assert.equal(document.activeElement, confirmation);
    assert.equal(byId(document, "commit-recorded-title").tagName, "H3");
    assert.match(textOf(confirmation), /Decision recorded in your Shiplog/);

    const links = confirmation.querySelectorAll("a").map((node) => node.getAttribute("href"));
    assert.deepEqual(links, [
      "/decision.html?id=finops-commitment-syn-commit-support-triage",
      "/releases.html#release-form",
      "/evolution.html#local-import",
    ]);
    // Both next steps are stated, not implied by two bare links.
    assert.match(textOf(confirmation), /Associate the release that implements it/);
    assert.match(textOf(confirmation), /Revisit after the next import/);
    assert.match(textOf(byId(document, "commit-handoff-status")), /Decision recorded/);
    // The action cannot be fired twice from the same card.
    assert.equal(byId(document, "commit-record-submit").getAttribute("disabled"), "disabled");
  } finally {
    page.restore();
  }
});

test("recording the same commitment again links the decision that exists", async () => {
  const first = await openPage();
  let stored;
  try {
    byId(first.document, "commit-record-submit").click();
    stored = first.storage.getItem(DECISION_STORAGE_KEY);
  } finally {
    first.restore();
  }

  const page = await openPage({ [DECISION_STORAGE_KEY]: stored });
  try {
    byId(page.document, "commit-record-submit").click();
    assert.equal(JSON.parse(page.storage.getItem(DECISION_STORAGE_KEY)).length, 1);
    const confirmation = page.document.querySelector(".commit-recorded");
    assert.equal(confirmation.dataset.created, "false");
    assert.match(textOf(confirmation), /already recorded/);
    assert.match(textOf(confirmation), /nothing was written again/);
  } finally {
    page.restore();
  }
});

test("an empty owner is refused where the button is, and nothing is written", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    byId(document, "commit-record-owner").value = "   ";
    byId(document, "commit-record-submit").click();
    const error = document.querySelector(".commit-record-error");
    assert.equal(error.getAttribute("role"), "alert");
    assert.match(textOf(error), /names who approved it/);
    assert.equal(page.storage.getItem(DECISION_STORAGE_KEY), null);
    // The action is still available: a refusal is not a dead end.
    assert.equal(byId(document, "commit-record-submit").getAttribute("disabled"), null);
  } finally {
    page.restore();
  }
});

test("an opened briefing decides on the visitor's own figures", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    chooseFile(document, "shiplog-finops-briefing.json", briefingText());
    await waitFor(() => textOf(byId(document, "commit-handoff-status")).includes("Now proposing"),
      "the imported briefing to take over");

    const card = document.querySelector(".commit-card");
    assert.match(textOf(card), /Should Atlas Platform move/);
    assert.equal(document.querySelector(".commit-designation").dataset.designation, "imported");
    assert.match(textOf(document.querySelector(".commit-benchmark-figure")), /\$150\.00 a month/);

    byId(document, "commit-record-submit").click();
    const [decision] = JSON.parse(page.storage.getItem(DECISION_STORAGE_KEY));
    assert.equal(decision[COMMITMENT_METADATA_FIELD].provenance.designation, "imported");
    assert.equal(decision[COMMITMENT_METADATA_FIELD].recommendedAction.departmentId,
      "psn-example-unit-atlas0");
  } finally {
    page.restore();
  }
});

test("a briefing that cannot be read never replaces the one being decided on", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    chooseFile(document, "shiplog-finops-briefing.json", briefingText());
    await waitFor(() => textOf(byId(document, "commit-handoff-status")).includes("Now proposing"),
      "the imported briefing to take over");

    chooseFile(document, "corrupt.json", "{ truncated");
    await waitFor(() => document.querySelector(".commit-rejections") !== null,
      "the rejection notice to appear");

    // The imported commitment is still the one on screen, and the notice says so.
    assert.match(textOf(document.querySelector(".commit-card")), /Should Atlas Platform move/);
    const notice = document.querySelector(".commit-rejections");
    assert.equal(notice.getAttribute("role"), "status");
    assert.match(textOf(notice), /corrupt\.json/);
    assert.match(textOf(notice), /not complete JSON/);
    assert.match(textOf(notice), /The commitment shown above is unchanged/);
    assert.match(textOf(byId(document, "commit-handoff-status")), /was not used/);
    // And the one action still records the briefing that survived.
    byId(document, "commit-record-submit").click();
    assert.equal(JSON.parse(page.storage.getItem(DECISION_STORAGE_KEY)).length, 1);
  } finally {
    page.restore();
  }
});

test("the entry point is keyboard-reachable, labelled, and responsive", async () => {
  const [html, css] = await Promise.all([
    readFile(PAGE, "utf8"),
    readFile(new URL("../src/savings-commitment.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<label for="commit-file">/);
  assert.match(html, /id="commit-file" type="file"[^>]*aria-describedby="commit-file-note"/);
  assert.match(html, /id="commit-handoff-status" role="status" aria-live="polite"/);
  // The handoff controls sit outside the region the page replaces on every read.
  assert.ok(html.indexOf("commit-handoff-controls") < html.indexOf('id="savings-commitment"'));
  assert.match(css, /@media \(max-width:640px\)/);
  assert.match(css, /\.commit-record-button:focus-visible|:focus-visible/);

  const page = await openPage();
  try {
    // The disclosures are native details with named summaries, so they are
    // operable from the keyboard and exposed with their own state.
    const summaries = page.document.querySelectorAll("summary");
    assert.deepEqual(summaries.map((node) => textOf(node)), [
      "Inspect confidence and the supporting calculation",
      "Inspect provenance and what was set aside",
    ]);
    // Each summary is the first child of its own details, which is what makes
    // it the disclosure's own control rather than text beside one.
    for (const summary of summaries) {
      assert.equal(summary.parentNode.tagName, "DETAILS");
      assert.equal(summary.parentNode.children[0], summary);
    }
  } finally {
    page.restore();
  }
});
