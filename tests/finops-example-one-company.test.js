// The example brief describes ONE company.
//
// THE DEFECT THIS PINS. The brief's headline finding and its literacy letter
// came out of the bundled example dataset, while the peer-position block beside
// them named its departments a different way — `Department …atlas0`, an
// identifier tail, sitting next to panels naming human teams. Two naming schemes
// on one screen read as two unrelated datasets stitched together, which is the
// one thing an example that stands in for a real company cannot look like.
//
// So this file asserts on the RENDERED PAGE rather than on any module's exports.
// A dataset that publishes one roster and a view that paints another would pass
// a unit test and fail a reader; what has to hold is that every department name
// a visitor can actually read in the three blocks of `#finops-first-run` came
// out of `example-dataset.js`.
//
// Conventions this follows, deliberately: counts and attribute values only, and
// never `assert.equal(node, null)` on a harness element — that walks the whole
// parsed page and does not finish.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  EXAMPLE_COHORT_MINIMUM_PEERS, EXAMPLE_COHORT_UNAVAILABLE, EXAMPLE_DEPARTMENT_NAMES,
  EXAMPLE_DEPARTMENT_NAME_SET, exampleCohortPosition, loadExampleDataset, nameExampleDepartments,
} from "../src/example-dataset.js";
import { FIRST_RUN_IDS } from "../src/finops-first-run.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const ROUTES = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

const byId = (document, id) => document.getElementById(id);

async function bootedPage() {
  const page = await loadPage(PAGE, { routes: ROUTES });
  await importPageModule("/evolution-page.js");
  // All three of the page's own starts, not just the first: `restore()` pulls
  // the globals out from under any request still in flight, and the rejection
  // then surfaces in whichever test happens to run next.
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready"
    || byId(document, "finops-load-state")?.dataset.state === "error",
  "the page never settled into a resolved load state");
  await waitFor(() => byId(document, "integration-contract-provenance")
    ?.textContent.trim().startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    ?.getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

/** The rendered text of one block of the brief, value line and detail together. */
function blockText(document, valueId, detailId) {
  return `${textOf(byId(document, valueId))} ${textOf(byId(document, detailId))}`;
}

/** Every published department name this text mentions, with repeats collapsed. */
function namesIn(text) {
  return EXAMPLE_DEPARTMENT_NAME_SET.filter((name) => text.includes(name));
}

// A pseudonymous unit label (`Department …atlas0`), a wire identifier
// (`psn_example_unit_atlas0`), and the `dept-a` / `DEPT_002` shapes an authored
// placeholder takes. None of them is a team name and none may be visible text.
const PLACEHOLDER = /…[a-z0-9]{4,}|psn_[a-z0-9_]+|\b(?:dept|unit|team|org)[-_][a-z0-9]{1,4}\b/i;

test("all three blocks of the example brief name departments from one dataset", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    const headline = blockText(document, FIRST_RUN_IDS.action, FIRST_RUN_IDS.benchmarkDetail);
    const literacy = blockText(document, FIRST_RUN_IDS.literacyValue, FIRST_RUN_IDS.literacyDetail);
    const peer = blockText(document, FIRST_RUN_IDS.internalValue, FIRST_RUN_IDS.internalDetail);

    // Each block actually names teams — an assertion over an empty extraction
    // would pass on a page that names nobody at all.
    assert.equal(namesIn(headline).length, 1, "the headline finding names the team it is about");
    assert.ok(namesIn(literacy).length >= 1, "the literacy letter names the team it could not grade");
    assert.ok(namesIn(peer).length >= EXAMPLE_COHORT_MINIMUM_PEERS,
      "the peer block names the cohort it placed the pair inside");

    // The peer names are a subset of the dataset's set, and — the direction that
    // actually catches a second roster — no name rendered in any of the three
    // blocks is absent from it. Both are counts, so a stray name shows up as a
    // number rather than as a hang.
    const published = new Set(EXAMPLE_DEPARTMENT_NAME_SET);
    assert.equal(namesIn(peer).filter((name) => !published.has(name)).length, 0);
    for (const [block, text] of [["headline", headline], ["literacy", literacy], ["peer", peer]]) {
      // Any capitalised two-word team-shaped phrase the block renders has to be
      // one this dataset published. `Department …atlas0` and `Backend Platform`
      // both fail this; `Atlas Platform` passes.
      const rendered = [...text.matchAll(/\b[A-Z][a-z]+ (?:Platform|Support|Research|Analytics|Studio)\b/g)]
        .map((match) => match[0]);
      assert.equal(rendered.filter((name) => !published.has(name)).length, 0,
        `the ${block} block renders a department name this example never published`);
    }

    // And no placeholder-style identifier reaches visible text in any of them.
    for (const [block, text] of [["headline", headline], ["literacy", literacy], ["peer", peer]]) {
      assert.doesNotMatch(text, PLACEHOLDER,
        `the ${block} block still renders a placeholder-style identifier`);
    }
  } finally {
    page.restore();
  }
});

test("the peer cohort is built from the same envelope the headline divides", () => {
  const analysis = nameExampleDepartments(loadExampleDataset());
  const cohort = exampleCohortPosition({ analysis });

  assert.equal(cohort.available, true);
  assert.equal(cohort.peers.length, analysis.rankedDepartments.length,
    "a peer entry per department of the one company, not a parallel roster");
  // Same strings, not equal-looking copies: every peer name is the name the
  // envelope the headline benchmark divides carries for that same unit id.
  for (const peer of cohort.peers) {
    assert.equal(peer.name, EXAMPLE_DEPARTMENT_NAMES[peer.id]);
  }
  // The median is derived from those same entries rather than authored.
  const values = [...cohort.peers.map((peer) => peer.value)].sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  assert.equal(cohort.medianValue, values.length % 2 === 1
    ? values[middle] : (values[middle - 1] + values[middle]) / 2);
  assert.match(cohort.medianDisplay, /^\$\d+\.\d{2}$/);
  // The rubric references travel with it, so a quoted position carries the rules
  // it was produced under.
  assert.match(cohort.rubricVersion, /^finops-cost-position\//);
  assert.match(cohort.literacyRubricVersion, /^literacy-mix\//);
});

test("a degenerate cohort states what is missing and what would unblock it", () => {
  // One placeable department: the cohort cannot be stated, and saying so is the
  // whole answer. Nothing here is empty, dashed, or undefined.
  const single = exampleCohortPosition({
    analysis: { rankedDepartments: [{ id: "psn_example_unit_atlas0", spendUsd: 1000 }] },
    tasks: [{ orgUnitId: "psn_example_unit_atlas0", outcome: "success", count: 40 }],
  });
  assert.equal(single.available, false);
  assert.equal(single.peers.length, 1);
  assert.equal(single.medianValue, null);
  assert.equal(single.reason, EXAMPLE_COHORT_UNAVAILABLE.tooFewPeers.reason);
  assert.equal(single.needed, EXAMPLE_COHORT_UNAVAILABLE.tooFewPeers.needed);
  assert.doesNotMatch(single.reason, /undefined|^–$|^-$/);
  assert.ok(single.needed.length > 40, "the unblocking input is a sentence, not a label");

  // No departments at all resolves the same way rather than throwing.
  const none = exampleCohortPosition({ analysis: null });
  assert.equal(none.available, false);
  assert.equal(none.peers.length, 0);
  assert.equal(none.reason, EXAMPLE_COHORT_UNAVAILABLE.tooFewPeers.reason);
});

test("relabelling the example never rewrites the envelope's own identifiers", () => {
  const raw = loadExampleDataset();
  const named = nameExampleDepartments(raw);
  assert.equal(named.rankedDepartments.length, raw.rankedDepartments.length);
  assert.equal(named.spendUsd, raw.spendUsd, "the figures the headline divides are untouched");
  assert.equal(named.recoverableUsd, raw.recoverableUsd);
  for (const [index, department] of named.rankedDepartments.entries()) {
    assert.equal(department.id, raw.rankedDepartments[index].id,
      "the wire identifier is the key and survives the rename");
    assert.equal(department.spendUsd, raw.rankedDepartments[index].spendUsd);
  }
  // A unit this example has no name for keeps whatever the analysis called it.
  const foreign = nameExampleDepartments({ rankedDepartments: [{ id: "psn_other_0001", name: "Active unit …0001" }] });
  assert.equal(foreign.rankedDepartments[0].name, "Active unit …0001");
});
