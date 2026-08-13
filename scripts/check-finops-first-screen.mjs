// The AI FinOps first screen, checked in the bytes Pages will serve (#1509).
//
// THE GAP THIS CLOSES. #1502, #1503, #1504 and #1507 reduced /evolution.html to
// one consolidated answer: ONE question, ONE headline recoverable figure, ONE
// grade with the provenance label beside it, and ONE primary next action. Every
// assertion protecting that answer runs against `src/`. But the document a
// reader receives is not `src/evolution.html` — it is the staged copy after
// scripts/seed-first-screen.mjs has rewritten fifteen of its slots from the
// modules that own them. A seed that filled the wrong slot, a build selection
// that dropped a module, a promoted artifact whose HTML is a build older than
// its JavaScript: each of those leaves every source test green and puts a
// divergent answer in front of a CTO.
//
// So this reads the BUILT document and compares its four first-screen elements
// with what the source modules render. Nothing here is a hand-copied literal:
//
//   question    src/finops-destinations.js — FRONT_DOOR_QUESTION
//   number      src/finops-answer-contract.js — recoverableAttestation(), the
//               same single source of truth
//               tests/fixtures/finops-consolidated-answer-attestation.json pins
//   provenance  src/finops-recoverable-confidence.js — confidenceChip(), and
//               src/finops-pricing-provenance.js — pricingProvenanceChip(),
//               which is what the seed itself writes into those two slots
//   action      src/finops-destinations.js — prioritizedDestination()
//
// EXACTLY ONE OF EACH, COUNTED. Two headline figures is the defect #1496 and
// #1502 removed, and it fails here the same way zero does: the check counts the
// largest type role and the call-to-action treatment inside the answer region
// rather than only reading the one id it expects to find.
//
// IT REPORTS, IT DOES NOT ASSERT. `checkFinopsFirstScreen` is a plain function
// over the document text that returns a structured record naming the element
// that diverged, the slot it is in, and both readings of it — so it is unit
// testable without spawning a build, and so the build's failure output can be
// read without a debugger. scripts/verify-build.mjs is what turns a divergence
// into a non-zero exit.
//
// IT ADDS NOTHING TO THE ARTIFACT. Build-time only: no module here is shipped,
// no byte is added to any asset, and nothing on the page self-checks. It reads
// the filesystem and the source modules — no clock, no network, no storage, no
// binding, no environment variable.
//
// PARSING. The repository's test harness parses no markup and rejects several
// selector forms, so this uses narrowly-anchored extraction keyed on the ids and
// classes the first screen already emits. No attribute was added to the page for
// it.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadExampleDataset } from "../src/example-dataset.js";
import { recoverableAttestation } from "../src/finops-answer-contract.js";
import { RECOVERABLE_ATTESTATION_ID } from "../src/finops-answer-contract-view.js";
import { FRONT_DOOR_QUESTION_ID } from "../src/finops-destinations.js";
import { buildEvolutionFinding } from "../src/evolution-finding-contract.js";
import {
  BUNDLED_PRICING_PROVENANCE, pricingProvenanceChip,
} from "../src/finops-pricing-provenance.js";
import {
  BUNDLED_RECOVERABLE_CONFIDENCE, confidenceChip,
} from "../src/finops-recoverable-confidence.js";

/** The built document the first screen is read out of, relative to a root. */
export const FIRST_SCREEN_DOCUMENT = "evolution.html";

/** The four elements the consolidated answer is, in reading order. */
export const FIRST_SCREEN_ELEMENTS = Object.freeze([
  "question", "number", "provenance", "action",
]);

/**
 * Every hook this check keys on. All of them already ship: `region` opens the
 * consolidated answer and `supporting` opens the supporting-detail layer #1498
 * moved inside it, which is where the answer stops and its evidence begins.
 */
export const FIRST_SCREEN_IDS = Object.freeze({
  region: "finops-recoverable-answer",
  supporting: "finops-analysis-readiness",
  question: FRONT_DOOR_QUESTION_ID,
  value: "finops-recoverable-value",
  grade: "finops-recoverable-grade",
  provenance: "finops-recoverable-provenance",
  attestation: RECOVERABLE_ATTESTATION_ID,
  action: "finops-recoverable-action",
});

/** The largest type role on the page. Only the headline figure may wear it. */
export const HEADLINE_CLASS = "stand-figure-value";

/** The page's one call-to-action treatment. */
export const ACTION_CLASS = "stand-action";

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

const ENTITIES = Object.freeze([
  ["&lt;", "<"], ["&gt;", ">"], ["&quot;", '"'], ["&#39;", "'"], ["&amp;", "&"],
]);

const decode = (value) =>
  ENTITIES.reduce((text, [from, to]) => text.replaceAll(from, to), value);

/**
 * One element addressed by id, as `{ tag, attributes, text }`, or null.
 *
 * Text content only — `[^<]*` rather than a lazy any — so an id whose element
 * grew children is reported as absent instead of silently compared against the
 * first child's words. Every id passed in is a constant of this module.
 */
function element(html, id) {
  const match = new RegExp(
    `<([a-z0-9]+)\\b([^>]*\\bid="${id}"[^>]*)>([^<]*)</\\1>`, "i").exec(html);
  if (!match) return null;
  const attributes = {};
  for (const [, name, value] of match[2].matchAll(/([a-z-]+)="([^"]*)"/g)) {
    attributes[name] = decode(value);
  }
  return { tag: match[1], attributes, text: decode(match[3]).trim() };
}

/**
 * The answer, from where it opens to where its supporting layer begins.
 *
 * Bounded rather than whole-document, because the page carries five elements in
 * the headline type role and four call-to-action anchors — legitimately, in the
 * regions below. Only the consolidated answer is held to exactly one of each.
 */
function firstScreen(html) {
  if (occurrences(html, `id="${FIRST_SCREEN_IDS.region}"`) !== 1) return null;
  const open = html.indexOf(`id="${FIRST_SCREEN_IDS.region}"`);
  const close = html.indexOf(`id="${FIRST_SCREEN_IDS.supporting}"`);
  return close > open ? html.slice(open, close) : null;
}

/**
 * What the source render says the four elements are.
 *
 * Composed on every call from the modules the page paints from — no literal
 * below is written twice, and the headline is the attested one, so this check
 * and the #1507 fixture cannot pin two different figures.
 */
export function finopsFirstScreenExpectations() {
  const dataset = loadExampleDataset();
  const attested = recoverableAttestation(dataset).dimensions;
  const finding = buildEvolutionFinding(dataset);
  return Object.freeze({
    question: finding.question,
    headline: attested.headline,
    confidenceBand: attested.confidence,
    grade: Object.freeze({
      text: confidenceChip(BUNDLED_RECOVERABLE_CONFIDENCE),
      grade: BUNDLED_RECOVERABLE_CONFIDENCE.grade,
    }),
    provenance: Object.freeze({
      text: pricingProvenanceChip(BUNDLED_PRICING_PROVENANCE),
      band: BUNDLED_PRICING_PROVENANCE.confidence.key,
    }),
    action: Object.freeze({ label: finding.nextAction.statement, href: finding.nextAction.href }),
  });
}

/**
 * Compare the built first screen with the source render.
 *
 * @param html the built `evolution.html`, as text.
 * @param expected the source render's values, for a test that wants to move one.
 * @returns a frozen `{ ok, document, elements, expected, divergences }`. Each
 *   divergence is `{ element, slot, expected, actual }` — the element is one of
 *   `FIRST_SCREEN_ELEMENTS`, so a reader is told what broke before they are told
 *   where. Never throws: a document with no answer region in it at all is four
 *   divergences, not an exception with no report behind it.
 */
export function checkFinopsFirstScreen(html, expected = finopsFirstScreenExpectations()) {
  const divergences = [];
  const add = (name, slot, want, actual) =>
    divergences.push(Object.freeze({ element: name, slot, expected: want, actual }));
  const screen = firstScreen(String(html ?? ""));

  if (!screen) {
    const slot = `#${FIRST_SCREEN_IDS.region}`;
    add("question", slot, expected.question, null);
    add("number", slot, expected.headline, null);
    add("provenance", slot, expected.grade.text, null);
    add("action", slot, expected.action.label, null);
    return frozenReport(divergences, expected);
  }

  // ---- One question.
  const question = element(screen, FIRST_SCREEN_IDS.question);
  if (question?.text !== expected.question) {
    add("question", `#${FIRST_SCREEN_IDS.question}`, expected.question, question?.text ?? null);
  }

  // ---- One headline figure. Two is a failure exactly as zero is: a second
  // money string in the largest role is the competing figure #1502 deleted.
  const headlines = occurrences(screen, `class="${HEADLINE_CLASS}"`);
  if (headlines !== 1) {
    add("number", `.${HEADLINE_CLASS} inside #${FIRST_SCREEN_IDS.region}`,
      "exactly 1 headline figure", `${headlines} headline figures`);
  }
  const value = element(screen, FIRST_SCREEN_IDS.value);
  if (value?.text !== expected.headline) {
    add("number", `#${FIRST_SCREEN_IDS.value}`, expected.headline, value?.text ?? null);
  }
  // The attestation carries the figure it attested as an attribute rather than
  // as a third dollar string. A headline the region no longer states is a
  // headline the attestation no longer covers, so the two are compared.
  const attestation = element(screen, FIRST_SCREEN_IDS.attestation);
  if (attestation?.attributes["data-headline"] !== expected.headline) {
    add("number", `#${FIRST_SCREEN_IDS.attestation}[data-headline]`, expected.headline,
      attestation?.attributes["data-headline"] ?? null);
  }

  // ---- One grade, and the provenance label beside it. Both are seeded at build
  // time, so both are exactly what a stale or half-applied seed loses first.
  for (const [id, want, attribute, actualAttribute] of [
    [FIRST_SCREEN_IDS.grade, expected.grade.text, "data-grade", expected.grade.grade],
    [FIRST_SCREEN_IDS.provenance, expected.provenance.text, "data-band", expected.provenance.band],
  ]) {
    const count = occurrences(screen, `id="${id}"`);
    if (count !== 1) {
      add("provenance", `#${id}`, "exactly 1", `${count}`);
      continue;
    }
    const chip = element(screen, id);
    if (chip?.text !== want) add("provenance", `#${id}`, want, chip?.text ?? null);
    if (chip?.attributes[attribute] !== actualAttribute) {
      add("provenance", `#${id}[${attribute}]`, actualAttribute,
        chip?.attributes[attribute] ?? null);
    }
  }
  if (attestation?.attributes["data-confidence"] !== expected.confidenceBand) {
    add("provenance", `#${FIRST_SCREEN_IDS.attestation}[data-confidence]`, expected.confidenceBand,
      attestation?.attributes["data-confidence"] ?? null);
  }

  // ---- One primary next action, and it goes where the registry sends it.
  const actions = occurrences(screen, `class="${ACTION_CLASS}"`);
  if (actions !== 1) {
    add("action", `.${ACTION_CLASS} inside #${FIRST_SCREEN_IDS.region}`,
      "exactly 1 primary action", `${actions} primary actions`);
  }
  const anchor = element(screen, FIRST_SCREEN_IDS.action);
  if (anchor?.text !== expected.action.label) {
    add("action", `#${FIRST_SCREEN_IDS.action}`, expected.action.label, anchor?.text ?? null);
  }
  if (anchor?.attributes.href !== expected.action.href) {
    add("action", `#${FIRST_SCREEN_IDS.action}[href]`, expected.action.href,
      anchor?.attributes.href ?? null);
  }

  return frozenReport(divergences, expected);
}

function frozenReport(divergences, expected) {
  return Object.freeze({
    ok: divergences.length === 0,
    document: FIRST_SCREEN_DOCUMENT,
    elements: FIRST_SCREEN_ELEMENTS,
    expected,
    divergences: Object.freeze(divergences),
  });
}

const quoted = (value) => (value === null || value === undefined
  ? "(not present in the built first screen)" : JSON.stringify(String(value)));

/**
 * The report as the words a build prints.
 *
 * It names the elements first and the slots second, because the question a
 * reader of a red build asks is "which of the four broke?" — and it prints every
 * divergence, since stopping at the first hides the others behind a re-run each.
 */
export function formatFirstScreenReport(report) {
  if (report.ok) {
    return `AI FinOps first screen in ${report.document}: question, number, provenance and `
      + "action all agree with the source render.";
  }
  const named = [...new Set(report.divergences.map((one) => one.element))];
  return `the AI FinOps first screen in ${report.document} diverged from the source render `
    + `— ${named.join(", ")}:\n`
    + report.divergences.map((one) =>
      `  ${one.element} at ${one.slot}\n`
      + `    expected: ${quoted(one.expected)}\n`
      + `    built:    ${quoted(one.actual)}`).join("\n");
}

/**
 * The same check against a build root, so a test can point it at a copy of the
 * document rather than mutating the real dist/.
 */
export async function checkFinopsFirstScreenArtifact(root = "dist") {
  return checkFinopsFirstScreen(
    await readFile(resolve(root, FIRST_SCREEN_DOCUMENT), "utf8"));
}
