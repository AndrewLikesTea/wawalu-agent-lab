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
  EXAMPLE_DEPARTMENT_NAME_SET, exampleCohortPosition, loadExampleDataset,
  loadExampleDatasetInputs,
} from "../src/example-dataset.js";
import { normalizeLocalFinopsHistory } from "../src/local-finops.js";
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

// The three places a reader meets the driving department without expanding
// anything: the answer sentence, the residue sentence under the literacy
// verdict, and the action that says what to do about it.
const DRIVER_SENTENCE = /\. ([^.]+) is driving the increase\./;
const RESIDUE_SENTENCE = /the largest single block of it in ([^.]+)\./;
const WIDEN_ACTION = /^Widen the scored sample for (.+) — go to /;

test("with no import, no department on the example page is named by its id tail", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    const text = textOf(document.body);
    // A pseudonymised label — `Department …atlas0`, `Active unit …0001` — is an
    // identifier tail with an ellipsis in front of it. None may be visible text
    // anywhere on the page the bundled example composes.
    assert.equal((text.match(/…[a-z0-9]{4,}/g) ?? []).length, 0,
      "a department is still labelled by its identifier tail");
    // The wire identifier survives in exactly one place, and it is not a label:
    // the reproduction recipe, which names the filter to recompute the figure
    // from. Pinned as a count so a second, decorative use shows up as a number.
    // A wire identifier is still visible in exactly one construction, and it is
    // not a label: the reproduction recipe, whose whole job is to name the
    // filter a reader recomputes the figure against. Two identifiers per recipe,
    // so every occurrence on the page is accounted for by a recipe rather than
    // by a team that lost its name.
    const wire = (text.match(/psn_[a-z0-9_]+/g) ?? []).length;
    const recipes = (text.match(/orgUnitId in psn_[a-z0-9_]+, psn_[a-z0-9_]+/g) ?? []).length;
    assert.ok(recipes >= 1, "the reproduction recipe no longer carries the identifiers it filters on");
    assert.equal(wire, recipes * 2, "a wire identifier reached the page as a label");
  } finally {
    page.restore();
  }
});

test("the headline, the residue sentence and the widen action name one same string", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    const text = textOf(document.body);
    const headline = DRIVER_SENTENCE.exec(textOf(document.getElementById("finops-stand-answer")));
    const residue = RESIDUE_SENTENCE.exec(text);
    const widen = WIDEN_ACTION.exec(textOf(document.getElementById("finops-answer-action")).trim());
    assert.ok(headline, "the headline no longer names a department driving the increase");
    assert.ok(residue, "the residue sentence no longer names the block it is largest in");
    assert.ok(widen, "the widen-the-sample action no longer names a department");

    // Character for character, all three, and against the name the dataset
    // published for that unit rather than against each other alone.
    assert.equal(headline[1], "Atlas Platform");
    assert.equal(residue[1], headline[1]);
    assert.equal(widen[1], headline[1]);
    assert.equal(headline[1], EXAMPLE_DEPARTMENT_NAMES.psn_example_unit_atlas0);
    // And the circulation decision acts on that same team, so the brief does not
    // name one department as the driver and send the reader to another.
    const pilot = /Pilot lower-cost routing in ([^,]+), the top-spend invented department\./.exec(text);
    assert.ok(pilot, "the circulation decision no longer states a rank-1 pilot");
    assert.equal(pilot[1], headline[1],
      "the prioritised action names a different department from the headline");
  } finally {
    page.restore();
  }
});

test("every department name the bundled example renders is a readable word", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    const text = textOf(document.body);
    for (const name of EXAMPLE_DEPARTMENT_NAME_SET) {
      assert.ok(name.length >= 4, `${name} is too short to be a department name`);
      assert.equal((name.match(/…|\.\.\./g) ?? []).length, 0, `${name} carries an ellipsis`);
      assert.doesNotMatch(name, /[0-9a-f]{4,}\b/i, `${name} ends in a hex-looking suffix`);
    }
    // The set is the vocabulary; this is the page actually using it. Four of the
    // five carry spend the brief names, so a rename that reached the table and
    // not the render path fails here rather than passing on an empty scan.
    assert.ok(EXAMPLE_DEPARTMENT_NAME_SET.filter((name) => text.includes(name)).length >= 4,
      "the page renders fewer of this company's names than the brief describes");
  } finally {
    page.restore();
  }
});

test("the peer cohort is built from the same envelope the headline divides", () => {
  const analysis = loadExampleDataset();
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

test("naming the example never rewrites the envelope's own identifiers or figures", () => {
  const inputs = loadExampleDatasetInputs();
  const named = loadExampleDataset();
  // The same inputs with the name table withheld: this is the own-data path,
  // and it is what a reader's file produces, because a reader's file declares
  // no names. The two runs must differ in the label and in nothing else.
  const bare = normalizeLocalFinopsHistory({ ...inputs, unitNames: null });

  assert.equal(named.rankedDepartments.length, bare.rankedDepartments.length);
  assert.equal(named.spendUsd, bare.spendUsd, "the figures the headline divides are untouched");
  assert.equal(named.recoverableUsd, bare.recoverableUsd);
  for (const [index, department] of named.rankedDepartments.entries()) {
    assert.equal(department.id, bare.rankedDepartments[index].id,
      "the wire identifier is the key and survives the naming");
    assert.equal(department.spendUsd, bare.rankedDepartments[index].spendUsd);
    assert.equal(department.name, EXAMPLE_DEPARTMENT_NAMES[department.id]);
    // And with no declared name the analysis still labels the unit from its own
    // id tail, exactly as it did before this table was handed to the translator.
    assert.match(bare.rankedDepartments[index].name, /^Department …[a-z0-9]{6}$/);
  }
});

test("a unit the example has no name for keeps the label the analysis minted", () => {
  const inputs = loadExampleDatasetInputs();
  // One name declared out of five. The other four are exactly the own-data
  // case, so a fixture rename cannot leak onto a unit nobody named.
  const partial = normalizeLocalFinopsHistory({
    ...inputs,
    unitNames: { psn_example_unit_atlas0: "Atlas Platform", psn_example_unit_boreal: "   " },
  });
  const byId = new Map(partial.rankedDepartments.map((item) => [item.id, item.name]));
  assert.equal(byId.get("psn_example_unit_atlas0"), "Atlas Platform");
  // A whitespace-only declaration is an absent one, not a blank team name.
  assert.equal(byId.get("psn_example_unit_boreal"), "Department …boreal");
  assert.equal(byId.get("psn_example_unit_cinder"), "Department …cinder");
});
