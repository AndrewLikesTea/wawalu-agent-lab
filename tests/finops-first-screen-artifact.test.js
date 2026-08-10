// The FinOps first screen has to survive the real build (#1509).
//
// WHAT IS BEING PROVED. scripts/check-finops-first-screen.mjs reads the BUILT
// evolution.html and holds its four consolidated-answer elements — one question,
// one headline recoverable figure, one grade with the provenance label beside
// it, one primary next action — against what the source modules render. This
// file proves the check is worth wiring: for each element, it mutates the built
// document the way a bad seed, a stale artifact or an over-eager edit would, and
// asserts the checker turns red NAMING THAT ELEMENT. A checker that cannot be
// made to fail is a green light with nothing behind it.
//
// THE DOCUMENT UNDER TEST IS THE BUILD'S OWN OUTPUT. Every case starts from
// `seedDocument(src/evolution.html, firstScreenEdits(...))` — the exact pair
// scripts/build.mjs applies to its staging copy — written into a temp directory
// the checker is pointed at. The real dist/ is never mutated and never written
// to; the happy path is also run against it directly when the tree has been
// built.
//
// No clock, no network, no storage, no binding, no browser. The repository's
// test harness parses no markup and rejects several selector forms, so nothing
// here reaches for it: the checker is a plain function over document text and is
// exercised as one.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIRST_SCREEN_DOCUMENT, checkFinopsFirstScreen, checkFinopsFirstScreenArtifact,
  finopsFirstScreenExpectations, formatFirstScreenReport,
} from "../scripts/check-finops-first-screen.mjs";
import {
  firstScreenEdits, loadBundledSeed, seedDocument,
} from "../scripts/seed-first-screen.mjs";

const REPO = new URL("../", import.meta.url);
const expected = finopsFirstScreenExpectations();

/** The document the build produces, composed here by the build's own seed. */
const built = seedDocument(
  await readFile(new URL(`src/${FIRST_SCREEN_DOCUMENT}`, REPO), "utf8"),
  firstScreenEdits(await loadBundledSeed()),
);

/**
 * Replace an exact fragment, or fail naming it.
 *
 * The same exactly-once discipline the seed itself enforces: a mutation whose
 * anchor moved would otherwise change nothing and leave the case passing for the
 * wrong reason — a fixture that proves the checker fails when it never ran.
 */
function replaceOnce(html, find, replacement) {
  const occurrences = html.split(find).length - 1;
  assert.equal(occurrences, 1,
    `the built first screen must carry ${JSON.stringify(find)} exactly once`);
  return html.replace(find, () => replacement);
}

/** A temp build root carrying one mutated copy of the built document. */
async function rootWith(t, html) {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-finops-first-screen-"));
  t.after(async () => (await import("node:fs/promises"))
    .rm(directory, { recursive: true, force: true }));
  await writeFile(resolve(directory, FIRST_SCREEN_DOCUMENT), html);
  return directory;
}

/** The fragments each case moves, composed from the source render, never typed. */
const HEADLINE = `<span class="stand-figure-value" id="finops-recoverable-value">`
  + `${expected.headline}</span>`;
const PROVENANCE = `<span class="figure-source-state" id="finops-recoverable-provenance" `
  + `data-band="${expected.provenance.band}">${expected.provenance.text}</span>`;

test("the built first screen agrees with the source render", async (t) => {
  const root = await rootWith(t, built);
  const report = await checkFinopsFirstScreenArtifact(root);
  assert.equal(report.ok, true, formatFirstScreenReport(report));
  assert.deepEqual([...report.divergences], []);
  assert.deepEqual([...report.elements], ["question", "number", "provenance", "action"]);
  assert.match(formatFirstScreenReport(report), /all agree with the source render/);
});

test("and so does the artifact the build actually promoted", async (t) => {
  const root = resolve(fileURLToPath(REPO), "dist");
  try {
    await readFile(resolve(root, FIRST_SCREEN_DOCUMENT), "utf8");
  } catch {
    // Not a silent pass: `npm run verify:build` runs this same check against
    // dist/ on every build, and the case above runs against the build's own
    // seed output on every `npm test`.
    t.skip("dist/ is not built in this tree");
    return;
  }
  const report = await checkFinopsFirstScreenArtifact(root);
  assert.equal(report.ok, true, formatFirstScreenReport(report));
});

// Each case: what a divergence looks like in the built bytes, which element the
// report must name, and the slot it must point at.
const CASES = [
  {
    name: "a missing headline number",
    mutate: (html) => replaceOnce(html, HEADLINE, ""),
    element: "number",
    slot: "#finops-recoverable-value",
    actual: null,
  },
  {
    name: "a second competing headline number",
    mutate: (html) => replaceOnce(html, HEADLINE, `${HEADLINE} <span `
      + 'class="stand-figure-value" id="finops-recoverable-rival">$61,000</span>'),
    element: "number",
    slot: ".stand-figure-value inside #finops-recoverable-answer",
    actual: "2 headline figures",
  },
  {
    name: "a missing provenance label",
    mutate: (html) => replaceOnce(html, PROVENANCE, ""),
    element: "provenance",
    slot: "#finops-recoverable-provenance",
    actual: "0",
  },
  {
    name: "a grade that lost its seeded band",
    mutate: (html) => replaceOnce(html, `data-grade="${expected.grade.grade}"`,
      'data-grade="ungraded"'),
    element: "provenance",
    slot: "#finops-recoverable-grade[data-grade]",
    actual: "ungraded",
  },
  {
    name: "a changed primary action",
    mutate: (html) => replaceOnce(html, `>${expected.action.label}</a>`,
      ">Book a call with sales</a>"),
    element: "action",
    slot: "#finops-recoverable-action",
    actual: "Book a call with sales",
  },
  {
    name: "an action pointed somewhere else",
    mutate: (html) => replaceOnce(html, `<a class="stand-action" `
      + `id="finops-recoverable-action" href="${expected.action.href}">`,
      '<a class="stand-action" id="finops-recoverable-action" href="/index.html">'),
    element: "action",
    slot: "#finops-recoverable-action[href]",
    actual: "/index.html",
  },
  {
    name: "a reworded question",
    mutate: (html) => replaceOnce(html, `>${expected.question}</h2>`,
      ">Are we spending too much on AI?</h2>"),
    element: "question",
    slot: "#finops-recoverable-question",
    actual: "Are we spending too much on AI?",
  },
];

for (const scenario of CASES) {
  test(`${scenario.name} fails the build, naming ${scenario.element}`, async (t) => {
    const root = await rootWith(t, scenario.mutate(built));
    const report = await checkFinopsFirstScreenArtifact(root);
    assert.equal(report.ok, false, "the checker must refuse the mutated artifact");

    const named = report.divergences.filter((one) => one.slot === scenario.slot);
    assert.equal(named.length, 1,
      `expected one divergence at ${scenario.slot}, got `
      + `${JSON.stringify(report.divergences.map((one) => one.slot))}`);
    assert.equal(named[0].element, scenario.element);
    assert.equal(named[0].actual, scenario.actual);
    assert.notEqual(named[0].expected, named[0].actual,
      "a divergence states what was expected as well as what shipped");

    // The words a red build prints have to carry the element, the slot and both
    // readings, or whoever reads them opens a debugger instead.
    const printed = formatFirstScreenReport(report);
    assert.match(printed, new RegExp(scenario.element));
    assert.ok(printed.includes(scenario.slot), printed);
    assert.ok(printed.includes(JSON.stringify(String(named[0].expected))), printed);
    assert.ok(scenario.actual === null
      ? printed.includes("(not present in the built first screen)")
      : printed.includes(JSON.stringify(scenario.actual)), printed);
  });
}

test("a document with no answer region at all reports all four elements", () => {
  const report = checkFinopsFirstScreen(
    replaceOnce(built, 'id="finops-recoverable-answer"', 'id="finops-recoverable-answer-v2"'));
  assert.equal(report.ok, false);
  assert.deepEqual(report.divergences.map((one) => one.element),
    ["question", "number", "provenance", "action"]);
  for (const one of report.divergences) assert.equal(one.actual, null);
});

test("the build path is the thing that runs this check", async () => {
  const verify = await readFile(new URL("scripts/verify-build.mjs", REPO), "utf8");
  for (const wiring of ["checkFinopsFirstScreen", "formatFirstScreenReport"]) {
    assert.ok(verify.includes(wiring),
      `scripts/verify-build.mjs must ${wiring} — a checker nothing calls is not a check`);
  }
});
