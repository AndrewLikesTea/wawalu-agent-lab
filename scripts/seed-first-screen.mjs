// Render /evolution.html's first screen at build time, from the modules that
// already own its figures.
//
// THE DEFECT THIS EXISTS TO CLOSE (#944). The AI FinOps page shipped its first
// screen in a pending state and filled it from JavaScript: the answer block read
// "Results will appear here", the confidence line read "Nothing has been read
// yet, so there is no coverage, grade, or unclassified spend to report", the circulation
// checklist read six "not checked" rows, and the executive briefing payload read
// "Waiting for compatible bundled analysis" — while two screens further down the
// same document the "Example result" section stated the whole bundled analysis.
// Everything above the fold was a promise; the page's best asset was below it.
//
// The values were never missing. They are composed by modules in this
// repository from a fixture that ships with it, so the pending state was only
// ever the gap between parse and paint — a gap a reader on a slow connection,
// a reader with JavaScript off, a printed page, and anything that reads the
// served HTML all live inside.
//
// So the build renders it. Every string below is READ OFF THE SAME MODULE the
// page paints from at runtime:
//
//   - the answer block from `FINOPS_ANSWER_SUMMARY`, which is what
//     `applyAnswerBlock` defaults to;
//   - the stand region's figures from `buildStandHeadline()`, which is what
//     `applyStandHeadline` is called with at boot;
//   - the circulation checklist and the briefing payload's status from
//     `renderBriefingReadiness` and the projection view themselves, driven
//     against a recording stub, so the mapping from record to slot is the
//     view's own rather than a copy of it.
//
// There is therefore no second copy of a figure anywhere in this file, and
// tests/finops-first-screen-seed.test.js pins the whole seed against what the
// booted page paints: a seeded slot that stopped agreeing with the render fails
// there, and a slot whose authored markup moved fails here, in the build, by
// name.
//
// WHAT THIS FILE MAY NOT DO. It writes no clock into the document (the one
// runtime string that carries an instant is seeded as its clock-free prefix and
// completed by the page), it reaches no network, and it never runs against
// anything but the staged copy of the document inside the build's own temporary
// directory.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assessBriefingReadiness } from "../src/briefing-readiness.js";
import { withDerivedFirstAction } from "../src/finops-bundled-next-step.js";
import { renderBriefingReadiness } from "../src/briefing-readiness-view.js";
import { projectExecutiveBriefing } from "../src/executive-briefing-projection.js";
import {
  PROJECTION_STATUS_PREFIX, renderExecutiveBriefingProjection,
} from "../src/executive-briefing-projection-view.js";
import { answerAnnouncement } from "../src/finops-answer-announcement.js";
import { FINOPS_ANSWER_SUMMARY } from "../src/finops-answer-summary.js";
import {
  BUNDLED_RECOVERABLE_CONFIDENCE, confidenceChip, confidenceExplanation,
} from "../src/finops-recoverable-confidence.js";
import {
  BUNDLED_PRICING_PROVENANCE, pricingProvenanceChip, pricingProvenanceDetail,
  pricingProvenanceSummary,
} from "../src/finops-pricing-provenance.js";
import { buildStandHeadline } from "../src/finops-stand.js";
import { standClaimSentence } from "../src/finops-stand-view.js";

/** The document this seed belongs to, relative to a build root. */
export const SEEDED_DOCUMENT = "evolution.html";

/** The bundled analysis the page fetches for its circulation decision. */
export const BUNDLED_SEED = new URL("../src/evolution-demo-data.json", import.meta.url);

/** Text into an HTML text node. Every seeded value goes through it. */
export const escapeText = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Text into a double-quoted attribute value. */
export const escapeAttribute = (value) => escapeText(value).replaceAll('"', "&quot;");

/**
 * A document that records what a view wrote, and nothing else.
 *
 * `renderBriefingReadiness` and `renderExecutiveBriefingProjection` are both
 * pure `(root, record) => void` writers over `getElementById`, so driving them
 * against this stub is what makes the seed the VIEW's mapping of record to slot
 * rather than a second one written here. Nothing is built, queried by selector,
 * or read back, so the stub does not have to be a DOM.
 */
export function recordingRoot() {
  const nodes = new Map();
  return {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { id, dataset: {}, textContent: null });
      return nodes.get(id);
    },
    /** What a view wrote into `id`, or null if it wrote nothing. */
    text(id) {
      const node = nodes.get(id);
      return typeof node?.textContent === "string" ? node.textContent : null;
    },
    state(id) {
      return nodes.get(id)?.dataset?.state ?? null;
    },
  };
}

/**
 * One replacement: an exact authored fragment, and what the build puts in its
 * place. `find` must occur EXACTLY ONCE in the document — that rule is the whole
 * safety story of this file. A slot whose markup was edited, moved, duplicated
 * or removed does not seed the wrong element and does not silently seed nothing;
 * it fails the build and names itself.
 */
const edit = (slot, find, replace) => ({ slot, find, replace });

/** `id="x">AUTHORED<` → `id="x">SEEDED<`, for a slot the document authors text in. */
const authoredText = (slot, id, authored, seeded) =>
  edit(slot, `id="${id}">${authored}<`, `id="${id}">${escapeText(seeded)}<`);

/**
 * `<tag …id="x"[ hidden]></tag>` → the same element carrying its figure.
 *
 * The `hidden` an authored empty slot ships is dropped by the same edit that
 * gives it a value: `hidden` takes a node out of the layout AND out of the
 * accessibility tree, which is exactly right for a slot with nothing in it and
 * exactly wrong for one the build just filled. This is the build-time half of
 * what `revealWithheld` does on the paint.
 */
const filledText = (slot, id, attributes, tag, seeded) =>
  edit(slot, `id="${id}"${attributes.authored}></${tag}>`,
    `id="${id}"${attributes.seeded}>${escapeText(seeded)}</${tag}>`);

/**
 * Compose every replacement the first screen needs, in document order.
 *
 * @param bundled the parsed `evolution-demo-data.json` the page fetches.
 */
export function firstScreenEdits(bundled) {
  const answer = FINOPS_ANSWER_SUMMARY;
  const headline = buildStandHeadline();
  const readiness = recordingRoot();
  // The circulation block's first action is derived from the dataset by the same
  // function the page and both evidence layers read (#1020), so the served
  // document and the paint cannot state two different first actions.
  renderBriefingReadiness(readiness,
    assessBriefingReadiness(withDerivedFirstAction(bundled) ?? bundled?.briefingReadiness ?? null));
  const projection = recordingRoot();
  renderExecutiveBriefingProjection(projection,
    projectExecutiveBriefing(bundled?.briefingReadiness ?? null));

  const available = (value) => (value ? "true" : "false");
  const edits = [
    // ---- The region's own state, which a stylesheet and a printed page read.
    edit("stand region state",
      '<section class="stand" id="finops-stand" tabindex="-1" data-state="pending"'
      + ' data-position="pending" data-source="example" data-finding="none"'
      + ' data-finding-confidence="unavailable"',
      '<section class="stand" id="finops-stand" tabindex="-1"'
      + ` data-state="${headline.available ? "ready" : "partial"}"`
      + ` data-position="${headline.positioned ? "placed" : "withheld"}"`
      + ` data-source="${escapeAttribute(headline.source ?? "example")}"`
      + ` data-finding="${escapeAttribute(headline.finding?.signalKind ?? "none")}"`
      + ` data-finding-confidence="${escapeAttribute(
        headline.finding?.confidence?.level ?? "unavailable")}"`),
    // ---- The one sentence the region is described by.
    authoredText("stand claim", "finops-stand-claim",
      "Evidence behind the recoverable AI spend answer. The Bundled synthetic example uses invented data."
      + " Results will appear when preparation is complete.",
      standClaimSentence(headline)),

    // ---- The answer block: one figure, its qualifiers, one confidence
    // sentence, one action. Four values and nothing else, from one summary.
    edit("answer block state",
      '<div class="answer-block" id="finops-answer" data-decision-summary-region="authored"'
      + ' data-state="pending" data-available="false"',
      '<div class="answer-block" id="finops-answer" data-decision-summary-region="authored"'
      + ` data-state="${escapeAttribute(answer.state ?? "unavailable")}"`
      + ` data-available="${available(answer.available === true)}"`),
    authoredText("answer metric label", "finops-answer-label",
      "Spend we can stand behind", answer.metricLabel),
    authoredText("answer figure", "finops-answer-value",
      "Results will appear here", answer.figure),
    authoredText("answer direction", "finops-answer-direction",
      "Results will appear when preparation is complete", answer.direction),
    authoredText("answer basis", "finops-answer-basis",
      "as of the Bundled synthetic example", answer.basis),
    authoredText("answer confidence", "finops-answer-confidence",
      "Nothing has been read yet, so there is no coverage, grade, or unclassified spend to report.",
      answer.confidence),
    edit("answer action",
      '<a class="answer-action" id="finops-answer-action" href="#local-import">'
      + "Analyze a provider export — go to the import panel</a>",
      '<a class="answer-action" id="finops-answer-action"'
      + ` href="${escapeAttribute(answer.action.href)}">`
      + `${escapeText(answer.action.label)}</a>`),

    // ---- How sure the page is about the recoverable figure (#1186). The grade
    // is a headline fact and is seeded beside the figure, outside every
    // disclosure; the sentences explaining what holds it there are generated
    // from the same verdict's reason records and seeded into the Limits part of
    // the disclosure the region already ships.
    edit("recoverable confidence grade",
      '<span class="figure-source-state" id="finops-recoverable-grade"'
      + ' data-grade="ungraded">Confidence: not graded</span>',
      '<span class="figure-source-state" id="finops-recoverable-grade"'
      + ` data-grade="${escapeAttribute(BUNDLED_RECOVERABLE_CONFIDENCE.grade)}">`
      + `${escapeText(confidenceChip(BUNDLED_RECOVERABLE_CONFIDENCE))}</span>`),
    authoredText("recoverable confidence explanation", "finops-recoverable-confidence-detail",
      "The confidence grade beside the figure has not been computed for this document.",
      confidenceExplanation(BUNDLED_RECOVERABLE_CONFIDENCE)),

    // ---- And whose prices the figure is (#1266). Same split as the grade above
    // it: the sub-score and its one sentence are seeded beside the figure, outside
    // every disclosure, and the four per-criterion bands are seeded into the same
    // Limits part. All three come from the declaration's metadata, so nothing here
    // moves when a declared rate does.
    edit("recoverable pricing provenance",
      '<span class="figure-source-state" id="finops-recoverable-provenance"'
      + ' data-band="unscored">Pricing provenance: not scored</span>',
      '<span class="figure-source-state" id="finops-recoverable-provenance"'
      + ` data-band="${escapeAttribute(BUNDLED_PRICING_PROVENANCE.confidence.key)}">`
      + `${escapeText(pricingProvenanceChip(BUNDLED_PRICING_PROVENANCE))}</span>`),
    authoredText("recoverable pricing provenance reason", "finops-recoverable-provenance-reason",
      "Whose prices this figure uses has not been scored for this document.",
      pricingProvenanceSummary(BUNDLED_PRICING_PROVENANCE)),
    authoredText("recoverable pricing provenance bands", "finops-recoverable-provenance-detail",
      "The pricing-provenance sub-score beside the figure has not been computed for this document.",
      pricingProvenanceDetail(BUNDLED_PRICING_PROVENANCE)),

    // ---- The circulation decision, painted by its own view above.
    edit("circulation state",
      '<section class="briefing-readiness" id="briefing-readiness" data-state="pending"',
      '<section class="briefing-readiness" id="briefing-readiness"'
      + ` data-state="${escapeAttribute(readiness.state("briefing-readiness"))}"`),
    authoredText("circulation verdict", "briefing-readiness-verdict",
      "Checking required evidence…", readiness.text("briefing-readiness-verdict")),
    authoredText("circulation finding", "briefing-readiness-finding",
      "Headline finding not checked.", readiness.text("briefing-readiness-finding")),
    authoredText("circulation comparison", "briefing-readiness-benchmark",
      "Benchmark not checked.", readiness.text("briefing-readiness-benchmark")),
    authoredText("circulation first action", "briefing-readiness-action",
      "Action not checked.", readiness.text("briefing-readiness-action")),
    authoredText("circulation confidence", "briefing-readiness-confidence",
      "Confidence not checked.", readiness.text("briefing-readiness-confidence")),
    authoredText("circulation source period", "briefing-readiness-period",
      "Source period not checked.", readiness.text("briefing-readiness-period")),
    authoredText("circulation exclusions", "briefing-readiness-boundary",
      "Exclusions not checked.", readiness.text("briefing-readiness-boundary")),

    // ---- The executive briefing payload. The one runtime string on this
    // screen that carries an instant, seeded as the clock-free prefix the view
    // itself exports and completed by the page with the moment it regenerated
    // the payload in the reader's own browser.
    edit("briefing payload state",
      '<section class="briefing-projection" id="executive-briefing-projection" data-state="pending"',
      '<section class="briefing-projection" id="executive-briefing-projection"'
      + ` data-state="${escapeAttribute(projection.state("executive-briefing-projection"))}"`),
    edit("briefing payload status",
      '<p id="executive-briefing-projection-status" role="status" aria-live="polite">'
      + "Waiting for compatible bundled analysis.</p>",
      '<p id="executive-briefing-projection-status" role="status" aria-live="polite">'
      + `${escapeText(PROJECTION_STATUS_PREFIX(projectExecutiveBriefing(
        bundled?.briefingReadiness ?? null).schemaVersion))}</p>`),

    // ---- The standing answer, under the block.
    authoredText("stand answer", "finops-stand-answer",
      "The Bundled synthetic example uses invented data."
      + " Results will appear when preparation is complete.",
      headline.answer),

    // ---- The two entitlement indicators, and the figures they qualify. Each
    // one ships `hidden` so a visitor who has composed nothing meets no empty
    // metric-shaped box; reaching this line means the build composed a figure
    // for it, which is exactly the condition `revealWithheld` reveals them on.
    edit("entitlement state",
      '<p class="stand-entitlement" id="finops-stand-entitlement" data-available="false"'
      + ' data-evidence="none" data-confidence="unavailable">',
      '<p class="stand-entitlement" id="finops-stand-entitlement"'
      + ` data-available="${available(headline.entitlement?.available)}"`
      + ` data-evidence="${escapeAttribute(headline.entitlement?.evidenceClass ?? "none")}"`
      + ` data-confidence="${escapeAttribute(
        headline.entitlement?.confidenceTier ?? "unavailable")}">`),
    filledText("entitlement evidence", "finops-stand-evidence",
      { authored: " hidden", seeded: "" }, "span", headline.entitlement?.evidence ?? ""),
    filledText("entitlement confidence", "finops-stand-confidence",
      { authored: " hidden", seeded: "" }, "span", headline.entitlement?.confidence ?? ""),
    edit("figures revealed",
      '<div class="stand-figures pre-analysis-withheld" hidden>',
      '<div class="stand-figures pre-analysis-withheld">'),
    filledText("position value", "finops-stand-position-value",
      { authored: ' data-available="false"',
        seeded: ` data-available="${available(headline.position?.available)}"` },
      "p", headline.position?.value ?? ""),
    filledText("position basis", "finops-stand-position-basis",
      { authored: "", seeded: "" }, "p", headline.position?.basis ?? ""),
    filledText("recoverable value", "finops-stand-recoverable-value",
      { authored: ' data-available="false"',
        seeded: ` data-available="${available(headline.recoverable?.available)}"` },
      "p", headline.recoverable?.value ?? ""),
    filledText("recoverable basis", "finops-stand-recoverable-basis",
      { authored: "", seeded: "" }, "p", headline.recoverable?.basis ?? ""),
    edit("team revealed",
      '<div class="stand-team pre-analysis-withheld" id="finops-stand-team"'
      + ' data-available="false" hidden>',
      '<div class="stand-team pre-analysis-withheld" id="finops-stand-team"'
      + ` data-available="${available(headline.team?.available)}">`),
    filledText("team name", "finops-stand-team-name",
      { authored: "", seeded: "" }, "p", headline.team?.name ?? ""),
    filledText("team detail", "finops-stand-team-detail",
      { authored: "", seeded: "" }, "p", headline.team?.detail ?? ""),

    // ---- The one action the lead finding ends on. Seeded for the same reason
    // the figures above it are: the served document states what a leader should
    // do first, rather than holding an empty anchor until a script runs. It is
    // seeded ONLY when the composer produced an action — an anchor carrying a
    // label the analysis did not authorize would be a recommendation this build
    // invented, and `applyStandHeadline` reveals it at boot in that case
    // instead.
    ...(headline.action?.available
      ? [
        edit("stand action",
          '<a class="stand-action" id="finops-stand-action" href="#recommendation-evidence"'
          + ' aria-describedby="finops-stand-action-basis" hidden></a>',
          '<a class="stand-action" id="finops-stand-action"'
          + ` href="${escapeAttribute(headline.action.href ?? "#recommendation-evidence")}"`
          + ' aria-describedby="finops-stand-action-basis">'
          + `${escapeText(headline.action.label ?? "")}</a>`),
        filledText("stand action basis", "finops-stand-action-basis",
          { authored: " hidden", seeded: "" }, "p", headline.action.basis ?? ""),
      ]
      : []),

    // ---- The page's one announcer, seeded rather than spoken. A polite region
    // that is already carrying its sentence when the document is parsed
    // announces nothing on load, and `announceAnswer` leaves an unchanged
    // sentence alone at boot — so the first thing a screen-reader user meets on
    // this page is the page, not an unrequested figure.
    filledText("answer announcer", "finops-stand-live",
      { authored: ' role="status" aria-live="polite" aria-atomic="true"',
        seeded: ' role="status" aria-live="polite" aria-atomic="true"' },
      "p", answerAnnouncement(headline)),
  ];
  return edits;
}

/**
 * Apply every edit to a document, or fail naming the one that did not apply.
 *
 * Exactly-once is enforced per edit rather than trusted: a `find` that matches
 * nothing is a slot whose markup moved, and a `find` that matches twice is a
 * slot that would be seeded in a place nobody checked.
 */
export function seedDocument(html, edits) {
  let seeded = html;
  for (const { slot, find, replace } of edits) {
    const occurrences = seeded.split(find).length - 1;
    if (occurrences !== 1) {
      throw new Error(`first-screen seed "${slot}": expected exactly one authored match, `
        + `found ${occurrences}. The markup moved; update scripts/seed-first-screen.mjs.`);
    }
    seeded = seeded.replace(find, () => replace);
  }
  return seeded;
}

/** Read the bundled analysis the circulation decision is assessed from. */
export async function loadBundledSeed(source = BUNDLED_SEED) {
  return JSON.parse(await readFile(source, "utf8"));
}

/**
 * Seed the staged document in place. Called by the build against its own
 * temporary staging directory, never against `src/`.
 */
export async function seedFirstScreen(root) {
  const page = resolve(root, SEEDED_DOCUMENT);
  const edits = firstScreenEdits(await loadBundledSeed());
  const before = await readFile(page, "utf8");
  const after = seedDocument(before, edits);
  await writeFile(page, after);
  return { slots: edits.length, bytes: Buffer.byteLength(after) - Buffer.byteLength(before) };
}
