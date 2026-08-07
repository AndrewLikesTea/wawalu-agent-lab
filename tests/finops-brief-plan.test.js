// The sender's committed plan, carried in the shared brief and rendered by the
// read-only recipient view (#1291).
//
// WHAT THESE ASSERTIONS ARE FOR.
//
//   1. THE ROUND TRIP IS PINNED ON WHAT THE RECIPIENT READS, not on the payload
//      surviving. A plan built from the planning surface's own model is written,
//      encoded, decoded and rendered, and the assertions are on the rendered
//      total and the rendered grade — a payload that survives into a view that
//      shows a different number is the defect this issue exists to prevent.
//   2. THE THREE FAILURE STATES ARE STATED BEHAVIOUR. Absent renders the
//      analysis and says plainly there was no plan; malformed and oversized
//      render NO plan figure at all and say which of the two happened; none of
//      the three stops the rest of the brief opening.
//   3. NOTHING TRAVELS THAT WAS NOT NAMED. A plan state polluted with a
//      credential-shaped key writes no such key into the payload, because the
//      serializer constructs the block field by field.
//   4. THE OLD FORMAT STAYS COVERED. The checked-in pre-change fixtures — schema
//      3 and the legacy schema 2 — are opened and rendered here, so the path a
//      brief written before this change takes cannot rot unnoticed.
//
// The plan fixture is BUILT here from `planScope()` rather than checked in: a
// hand-written plan block would drift from the model the sender's surface
// actually produces, and the round trip is the point of the test.
//
// No clock, no network, no sleeps.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  serializeBriefEnvelope, validateBriefEnvelope,
} from "../src/finops-brief-envelope.js";
import {
  BRIEF_PLAN_REASON, MAX_BRIEF_PLAN_BYTES, MAX_BRIEF_PLAN_MOVES, buildBriefPlanBlock,
  readBriefPlanBlock,
} from "../src/finops-brief-plan.js";
import { decodeSharedBriefing, encodeSharedBriefing } from "../src/finops-shared-briefing-link.js";
import {
  RECIPIENT_BRIEF_IDS, RECIPIENT_PLAN_IDS, renderRecipientBrief,
} from "../src/finops-recipient-brief.js";
import { planScope } from "../src/plan-scope.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const FIXTURE = JSON.parse(
  await readFile(new URL("./fixtures/finops-shared-brief.json", import.meta.url), "utf8"));
const LEGACY = JSON.parse(
  await readFile(new URL("./fixtures/finops-legacy-brief.json", import.meta.url), "utf8"));

const doc = () => parseHtml(html);
const byId = (document, id) => document.getElementById(id);
const count = (document, id) => document.querySelectorAll(`#${id}`).length;

// ---------------------------------------------------------------------------
// The sender's side: a realistic plan, off the planning surface's own model.
// ---------------------------------------------------------------------------

/** Three modelled moves, in the slate's own shape. */
const SLATE = {
  rules: [
    { rank: 1, source: "gpt-4o", unit: "dept-atlas-platform", targetTier: "economy", expectedMonthlyUsd: 12000 },
    { rank: 2, source: "claude-opus", unit: "dept-atlas-support", targetTier: "economy", expectedMonthlyUsd: 8000 },
    { rank: 3, source: "gpt-4o", unit: "dept-atlas-research", targetTier: "economy", expectedMonthlyUsd: 5000 },
  ],
};

/**
 * Two committed moves and one left alone: 40% of the platform move after two
 * excluded workloads, and a support move a team has refused — which is worth
 * exactly nothing and still belongs in the plan, because a refusal is a fact.
 */
const COMMITMENTS = [
  {
    move: "gpt-4o → economy tier · dept-atlas-platform",
    reroutedSharePct: 40,
    eligibleWorkloads: 10,
    excludedWorkloads: 2,
    eligibleTeams: 1,
    refusingTeams: 0,
  },
  {
    move: "claude-opus → economy tier · dept-atlas-support",
    reroutedSharePct: 50,
    eligibleWorkloads: 4,
    excludedWorkloads: 0,
    eligibleTeams: 1,
    refusingTeams: 1,
  },
];

const PLAN = planScope(SLATE, { commitments: COMMITMENTS });

/** 12,000 × 40% × 8/10 = 3,840; the refused move contributes nothing. */
assert.equal(PLAN.plannedMonthlyUsd, 3840, "the plan model this test pins must be the one above");
assert.equal(PLAN.committedCount, 2);

/** The envelope a sender with this plan writes, encoded by the shipped codec. */
const SHARED = encodeSharedBriefing(FIXTURE.periods, {
  producedAt: FIXTURE.producedAt, plan: PLAN,
});
assert.ok(SHARED.ok, "the fixture's periods plus a committed plan must encode");

/** The same brief as a supplied object, for the failure states to mutate. */
const WIRE = JSON.parse(serializeBriefEnvelope(SHARED.envelope));

// ---------------------------------------------------------------------------
// 1. The round trip, asserted on what the recipient reads.
// ---------------------------------------------------------------------------

test("a committed plan survives write and read, and the view states the sender's own total", () => {
  const read = decodeSharedBriefing(SHARED.token);
  assert.ok(read.ok, "the token carrying a plan decodes");
  assert.equal(read.planNotice, null, "a carried plan has no notice to state");

  const plan = read.envelope.plan;
  assert.equal(plan.plannedMonthlyUsd, PLAN.plannedMonthlyUsd);
  assert.equal(plan.committedCount, 2);
  assert.equal(plan.currency, "USD");
  assert.equal(plan.grade.tier, PLAN.grade.tier);
  assert.deepEqual(plan.moves.map((move) => move.id), [
    "gpt-4o → economy tier · dept-atlas-platform",
    "claude-opus → economy tier · dept-atlas-support",
  ]);
  // The move's contribution, and the scope vocabulary it was committed at.
  assert.equal(plan.moves[0].plannedMonthlyUsd, 3840);
  assert.deepEqual(plan.moves[0].scope.map((lever) => lever.key),
    ["reroutedSharePct", "excludedWorkloads", "refusingTeams"]);
  assert.equal(plan.moves[0].scope[0].value, 40);
  assert.equal(plan.moves[0].scope[1].stated, true);
  // One exclusion and one refusal, carried as the counts and the org unit.
  assert.equal(plan.excluded.length, 1);
  assert.equal(plan.excluded[0].workloads, 2);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].team, "dept-atlas-support");

  const document = doc();
  renderRecipientBrief(document, read.envelope, { planNotice: read.planNotice });
  const region = byId(document, RECIPIENT_PLAN_IDS.region);
  assert.equal(region.dataset.plan, "committed");
  // THE RENDERED figure and THE RENDERED grade, not the payload's own fields.
  assert.match(textOf(byId(document, RECIPIENT_PLAN_IDS.total)), /\$3,840 a month/);
  assert.match(textOf(byId(document, RECIPIENT_PLAN_IDS.total)), /2 committed move\(s\)/);
  assert.match(textOf(byId(document, RECIPIENT_PLAN_IDS.grade)),
    new RegExp(`Plan confidence: ${PLAN.grade.marker} · ${PLAN.grade.label}`));
  assert.equal(byId(document, RECIPIENT_PLAN_IDS.grade).dataset.grade, PLAN.grade.tier);
});

test("the planned total is named beside the brief's own recoverable figure", () => {
  const document = doc();
  const read = decodeSharedBriefing(SHARED.token);
  renderRecipientBrief(document, read.envelope, { planNotice: read.planNotice });

  // $31,415 recoverable in the brief, $3,840 a month committed: the remainder is
  // LABELLED as scope nobody committed, never shown as a bare difference.
  const difference = textOf(byId(document, RECIPIENT_PLAN_IDS.difference));
  assert.match(difference, /Scope the sender chose not to commit: \$27,575/);
  assert.match(difference, /\$31,415/);
  assert.match(difference, /not a saving they missed/);

  // The exclusions and the refusals are in the open too, with the team named.
  const scope = textOf(byId(document, RECIPIENT_PLAN_IDS.scope));
  assert.match(scope, /Excluded workloads: 2 on/);
  assert.match(scope, /Teams that refused: dept-atlas-support/);
});

test("per-move detail is behind a disclosure whose summary states the count", () => {
  const document = doc();
  const read = decodeSharedBriefing(SHARED.token);
  renderRecipientBrief(document, read.envelope, { planNotice: read.planNotice });

  const detail = byId(document, RECIPIENT_PLAN_IDS.moves);
  assert.equal(detail.tagName, "DETAILS");
  assert.equal(detail.hasAttribute("open"), false, "it ships collapsed like every other one");
  const summary = [...detail.children].find((child) => child.tagName === "SUMMARY");
  assert.match(textOf(summary), /\(2\)$/, "the count is on the summary, so it means something shut");

  // …and the figures a reader must not have to open anything to see are OUTSIDE
  // it: the harness reads through a shut disclosure and a real browser does not.
  for (const id of [RECIPIENT_PLAN_IDS.total, RECIPIENT_PLAN_IDS.grade,
    RECIPIENT_PLAN_IDS.difference]) {
    let inside = false;
    for (let walk = byId(document, id); walk; walk = walk.parentNode) if (walk === detail) inside = true;
    assert.equal(inside, false, `${id} must not be folded into the per-move disclosure`);
  }
});

// ---------------------------------------------------------------------------
// 2. Absent: a brief written before this change, and every uncommitted plan.
// ---------------------------------------------------------------------------

test("the pre-change brief fixture still opens and says there was no committed plan", () => {
  const read = validateBriefEnvelope(FIXTURE);
  assert.ok(read.ok, "the checked-in regression fixture must still validate");
  assert.equal(read.envelope.plan, null);
  assert.equal(read.planNotice.reason, BRIEF_PLAN_REASON.absent);

  const document = doc();
  renderRecipientBrief(document, read.envelope, { planNotice: read.planNotice });
  // The analysis renders exactly as it did before this change…
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.value)), "$31,415");
  assert.equal(byId(document, RECIPIENT_BRIEF_IDS.region).dataset.sharedBrief, "true");
  // …and the absence is stated in words rather than left to be inferred.
  const region = byId(document, RECIPIENT_PLAN_IDS.region);
  assert.equal(region.dataset.plan, BRIEF_PLAN_REASON.absent);
  assert.match(textOf(byId(document, RECIPIENT_PLAN_IDS.notice)),
    /shared an analysis without a committed plan/);
  assert.match(textOf(byId(document, RECIPIENT_PLAN_IDS.notice)), /normal state, not a/);
  assert.equal(count(document, RECIPIENT_PLAN_IDS.total), 0, "no planned figure is invented");
});

test("the legacy schema-2 fixture opens on this path too", () => {
  const read = validateBriefEnvelope(LEGACY);
  assert.ok(read.ok, "the legacy fixture must still validate");
  assert.equal(read.envelope.plan, null);
  assert.equal(read.planNotice.reason, BRIEF_PLAN_REASON.absent);
});

test("a plan with nothing committed writes no block at all", () => {
  const empty = planScope(SLATE, { commitments: [] });
  const built = buildBriefPlanBlock(empty);
  assert.equal(built.ok, false);
  assert.equal(built.reason, BRIEF_PLAN_REASON.absent);

  const encoded = encodeSharedBriefing(FIXTURE.periods, {
    producedAt: FIXTURE.producedAt, plan: empty,
  });
  assert.ok(encoded.ok);
  assert.equal(encoded.envelope.plan, null, "absence is the signal, never an empty object");
  assert.equal(JSON.parse(serializeBriefEnvelope(encoded.envelope)).plan, null);
});

// ---------------------------------------------------------------------------
// 3. Malformed: refused whole, no partial plan, and the brief still opens.
// ---------------------------------------------------------------------------

const MALFORMED = [
  ["a missing required field", (plan) => { delete plan.committedCount; }],
  ["a non-numeric planned total", (plan) => { plan.plannedMonthlyUsd = "3840"; }],
  ["an unknown grade value", (plan) => { plan.grade = { tier: "audited", marker: "Audited", label: "High" }; }],
  ["a move missing its scope", (plan) => { delete plan.moves[0].scope; }],
  ["a move whose scope is not the shipped levers", (plan) => {
    plan.moves[0].scope = [{ key: "claimedShare", stated: true, value: 100 }];
  }],
  ["moves that do not add up to the stated total", (plan) => { plan.plannedMonthlyUsd = 99999; }],
];

for (const [what, break_] of MALFORMED) {
  test(`a plan block with ${what} is refused whole and renders no plan figure`, () => {
    const supplied = JSON.parse(JSON.stringify(WIRE));
    break_(supplied.plan);
    const read = validateBriefEnvelope(supplied);

    // The BRIEF still opens: a refused block must not take the analysis with it.
    assert.ok(read.ok, "the rest of the brief opens");
    assert.equal(read.envelope.plan, null);
    assert.equal(read.planNotice.reason, BRIEF_PLAN_REASON.malformed);

    const document = doc();
    renderRecipientBrief(document, read.envelope, { planNotice: read.planNotice });
    assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.value)), "$31,415");
    assert.equal(byId(document, RECIPIENT_PLAN_IDS.region).dataset.plan,
      BRIEF_PLAN_REASON.malformed);
    assert.match(textOf(byId(document, RECIPIENT_PLAN_IDS.notice)), /could not be read/);
    // NOT ONE plan figure: no total, no grade, no difference, no move list.
    for (const id of [RECIPIENT_PLAN_IDS.total, RECIPIENT_PLAN_IDS.grade,
      RECIPIENT_PLAN_IDS.difference, RECIPIENT_PLAN_IDS.scope, RECIPIENT_PLAN_IDS.moves]) {
      assert.equal(count(document, id), 0, `${id} must not be rendered for a refused plan`);
    }
  });
}

// ---------------------------------------------------------------------------
// 4. Oversized: the same refusal path, worded so a reader knows which it was.
// ---------------------------------------------------------------------------

test("a plan block over the size ceiling is refused as too large, not as corrupt", () => {
  const supplied = JSON.parse(JSON.stringify(WIRE));
  const template = supplied.plan.moves[0];
  // Generated here rather than checked in: twelve moves at the ceiling of what a
  // name may hold, which is bytes rather than nonsense.
  supplied.plan.moves = Array.from({ length: MAX_BRIEF_PLAN_MOVES }, (unused, index) => ({
    ...JSON.parse(JSON.stringify(template)),
    id: `${template.id}-${index}`,
    name: `${"gpt-4o → economy tier in dept-atlas-platform ".repeat(8)}${index}`,
    plannedMonthlyUsd: 320,
  }));
  supplied.plan.committedCount = MAX_BRIEF_PLAN_MOVES;
  supplied.plan.plannedMonthlyUsd = 320 * MAX_BRIEF_PLAN_MOVES;
  assert.ok(JSON.stringify(supplied.plan).length > MAX_BRIEF_PLAN_BYTES,
    "the generated block must actually exceed the ceiling");

  const read = validateBriefEnvelope(supplied);
  assert.ok(read.ok, "an oversized plan does not stop the brief opening");
  assert.equal(read.envelope.plan, null);
  assert.equal(read.planNotice.reason, BRIEF_PLAN_REASON.oversize);

  const document = doc();
  renderRecipientBrief(document, read.envelope, { planNotice: read.planNotice });
  const notice = textOf(byId(document, RECIPIENT_PLAN_IDS.notice));
  assert.match(notice, /too large to read/);
  assert.match(notice, /oversized, not corrupt/);
  assert.equal(count(document, RECIPIENT_PLAN_IDS.total), 0);
  assert.equal(textOf(byId(document, RECIPIENT_BRIEF_IDS.value)), "$31,415");
});

// ---------------------------------------------------------------------------
// 5. Nothing travels that the serializer did not name.
// ---------------------------------------------------------------------------

test("a plan state polluted with a secret-looking key carries none of it into the payload", () => {
  const polluted = {
    ...PLAN,
    apiKey: "sk-live-0123456789abcdef",
    operatorEmail: "lead@example.com",
    moves: PLAN.moves.map((move) => ({
      ...move,
      accessToken: "bearer 0123456789abcdef",
      promptText: "summarise the customer's contract",
    })),
  };
  const built = buildBriefPlanBlock(polluted);
  assert.ok(built.ok, "a polluted plan still produces the plan it committed");
  const bytes = JSON.stringify(built.block);
  for (const leak of ["apiKey", "sk-live", "operatorEmail", "example.com", "accessToken",
    "promptText", "customer"]) {
    assert.equal(bytes.includes(leak), false, `${leak} must not reach the payload`);
  }
  // …and the same through the whole shared path, bytes on the wire.
  const encoded = encodeSharedBriefing(FIXTURE.periods, {
    producedAt: FIXTURE.producedAt, plan: polluted,
  });
  assert.ok(encoded.ok);
  const wire = serializeBriefEnvelope(encoded.envelope);
  for (const leak of ["apiKey", "sk-live", "operatorEmail", "accessToken", "promptText"]) {
    assert.equal(wire.includes(leak), false, `${leak} must not reach the wire`);
  }
  assert.equal(JSON.parse(wire).plan.plannedMonthlyUsd, PLAN.plannedMonthlyUsd);
});

test("a supplied block carrying a credential-shaped key is refused by the reader", () => {
  const supplied = JSON.parse(JSON.stringify(WIRE.plan));
  supplied.apiKey = "sk-live-0123456789abcdef";
  const read = readBriefPlanBlock(supplied);
  assert.equal(read.ok, false);
  assert.equal(read.reason, BRIEF_PLAN_REASON.malformed);
});
