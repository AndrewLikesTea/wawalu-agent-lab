// The import-evidence surface (#931), read the way a keyboard, a screen reader,
// and a monochrome display read it.
//
// Five things are held here, and each is a way this panel could look correct on
// a designer's screen and be unusable off it:
//
//   1. ONE READING ORDER. provider → confidence → benchmark → impact →
//      provenance → action, in the DOM, on both surfaces, at real heading
//      levels, with no stylesheet rule reordering it.
//   2. NO MEANING IN COLOUR ALONE. Every status carries a word, a distinct
//      glyph, and — where there is one — the confidence NUMBER, and every
//      foreground/background pairing the chips ship clears WCAG AA. The ratios
//      are computed here rather than eyeballed.
//   3. ANNOUNCEMENTS ARE ANNOUNCED. Completion, rejection and error each fire
//      into a region that is always rendered and is never inside a disclosure.
//   4. EVERY STATE IS DRAWN. Loading, empty, partial, per-finding error, and the
//      implausible extremes: a provider name longer than the column, a zero, a
//      credit, a billion, and a confidence at both ends of the scale.
//   5. THE DISCLOSURE IS A DISCLOSURE. A real summary in the tab order that
//      actually hides what is behind it — asserted on `open`, not on text, since
//      this harness reads through a closed disclosure and a browser does not.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DomEvent, loadPage, parseHtml, pressEnter, pressSpace, tabSequence, textOf,
} from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  ANNOUNCEMENT_KIND, DEMO_IMPORT_SET, EMPHASIZED_PARTS, EVIDENCE_STATE, EVIDENCE_STATUS,
  FINDING_ORDER, OUTSIZED_IMPACT_MINIMUM, STATUS_PRESENTATION,
  announcementFor, buildDemoImportFindings, buildImportFinding, formatImpactAmount,
  orderFindings, summarizeImportEvidence,
} from "../src/import-evidence.js";
import { renderImportEvidence, renderImportEvidenceLoading } from "../src/import-evidence-view.js";
import {
  INJECTED_INSTRUCTION, KEY_LIKE_STRING, recognitionFixtureById,
} from "../src/export-recognition-fixtures.js";
import { ACCEPTED_MIN_CONFIDENCE, MAX_CONFIDENCE } from "../src/export-recognition.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const STYLES = new URL("../src/evolution.css", import.meta.url);
const SITE_STYLES = new URL("../src/styles.css", import.meta.url);
const ENTRY = new URL("../src/evolution-page.js", import.meta.url);
const ROOT = "import-evidence";
const REVIEW_ROOT = "import-evidence-review";
const byId = (document, id) => document.getElementById(id);

const findingFrom = (fixtureId, overrides = {}) => {
  const fixture = recognitionFixtureById(fixtureId);
  return buildImportFinding({
    id: fixture.id, label: fixture.label, parsed: fixture.parsed, ...overrides,
  });
};

/** The page as authored, with the demo set painted into it. */
async function paintedPage(findings = buildDemoImportFindings()) {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  assert.equal(renderImportEvidence(document, ROOT, { findings, level: 4 }), true);
  return document;
}

// ---------------------------------------------------------------- the model

test("a finding is composed in one declared order, and the order is the whole list", () => {
  assert.deepEqual(FINDING_ORDER,
    ["provider", "confidence", "benchmark", "impact", "provenance", "action"]);
  assert.deepEqual(EMPHASIZED_PARTS, ["impact", "action"]);
  const finding = findingFrom("bedrock-recognized");
  assert.equal(finding.provider.name, "AWS Bedrock");
  assert.equal(finding.status, EVIDENCE_STATUS.TRUSTED);
  assert.equal(finding.confidence.value, MAX_CONFIDENCE);
  assert.equal(finding.benchmark.bar, ACCEPTED_MIN_CONFIDENCE);
  assert.equal(finding.impact.known, true);
  // 4.80 + 0.90 + 3.92, summed from the contract-declared cost column.
  assert.equal(finding.impact.display, "9.62");
  assert.ok(finding.provenance.count >= 5);
  assert.ok(finding.action.sentence.length > 20);
  assert.equal(finding.action.required, false);
});

test("each of the three statuses is reachable from a real export, with its number", () => {
  const seen = new Map();
  for (const id of ["bedrock-recognized", "azure-openai-ambiguous", "bedrock-incompatible"]) {
    const finding = findingFrom(id);
    seen.set(finding.status, finding);
  }
  assert.deepEqual([...seen.keys()].sort(),
    [EVIDENCE_STATUS.AMBIGUOUS, EVIDENCE_STATUS.REJECTED, EVIDENCE_STATUS.TRUSTED].sort());
  // "Ambiguous" is a word AND a figure: the band name never stands alone.
  assert.equal(seen.get(EVIDENCE_STATUS.AMBIGUOUS).confidence.display, `75 of ${MAX_CONFIDENCE}`);
  assert.match(seen.get(EVIDENCE_STATUS.AMBIGUOUS).benchmark.sentence, /^10 points short of/);
  assert.equal(seen.get(EVIDENCE_STATUS.REJECTED).confidence.display, `0 of ${MAX_CONFIDENCE}`);
  assert.ok(seen.get(EVIDENCE_STATUS.REJECTED).action.required);
});

test("findings are ordered by what is owed a decision, then by money", () => {
  const ordered = orderFindings(buildDemoImportFindings());
  const statuses = ordered.map((finding) => finding.status);
  assert.deepEqual(statuses, [...statuses].sort((left, right) =>
    ({ ambiguous: 0, rejected: 1, trusted: 2 })[left] - ({ ambiguous: 0, rejected: 1, trusted: 2 })[right]));
  const trusted = ordered.filter((finding) => finding.status === EVIDENCE_STATUS.TRUSTED);
  assert.ok(trusted.length >= 2, "the bundled set must show more than one trusted export");
  assert.ok(trusted[0].impact.amount >= trusted[1].impact.amount,
    "trusted findings are not ranked by the money they carry");
});

test("the bundled set ships the partial state, not the one that demos well", () => {
  const summary = summarizeImportEvidence(buildDemoImportFindings());
  assert.equal(summary.state, EVIDENCE_STATE.PARTIAL);
  assert.equal(summary.counts.total, DEMO_IMPORT_SET.length);
  assert.ok(summary.counts.trusted > 0 && summary.counts.rejected > 0 && summary.counts.ambiguous > 0);
});

test("every state has an announcement, and each names the outcome rather than 'updated'", () => {
  const demo = buildDemoImportFindings();
  const rejectedOnly = demo.filter((finding) => finding.status !== EVIDENCE_STATUS.TRUSTED)
    .map((finding) => ({ ...finding, status: EVIDENCE_STATUS.REJECTED }));
  const errored = [findingFrom("bedrock-recognized", { error: { message: "Unreadable." } })];
  const cases = [
    [summarizeImportEvidence([], { loading: true }), [], ANNOUNCEMENT_KIND.LOADING],
    [summarizeImportEvidence([]), [], ANNOUNCEMENT_KIND.EMPTY],
    [summarizeImportEvidence(demo), demo, ANNOUNCEMENT_KIND.PARTIAL],
    [summarizeImportEvidence(rejectedOnly), rejectedOnly, ANNOUNCEMENT_KIND.REJECTED],
    [summarizeImportEvidence(errored), errored, ANNOUNCEMENT_KIND.ERROR],
    [summarizeImportEvidence(demo.filter((finding) => finding.status === EVIDENCE_STATUS.TRUSTED)),
      demo, ANNOUNCEMENT_KIND.COMPLETE],
  ];
  for (const [summary, findings, kind] of cases) {
    const announcement = announcementFor(summary, findings);
    assert.equal(announcement.kind, kind);
    assert.ok(announcement.text.length > 40, `${kind} announces nothing a reader can act on`);
    assert.doesNotMatch(announcement.text, /^Updated/);
  }
});

test("an impact figure is grouped, signed, and never a bare blank", () => {
  assert.equal(formatImpactAmount(0), "0.00");
  assert.equal(formatImpactAmount(1204559873.4), "1,204,559,873.40");
  assert.equal(formatImpactAmount(-4500000), "−4,500,000.00");
  assert.equal(formatImpactAmount(Number.NaN), "not computed");
  // A file with no recognized cost column says so in words rather than showing
  // a dash a reader would read as zero.
  const none = findingFrom("none-incompatible");
  assert.equal(none.impact.known, false);
  assert.equal(none.impact.display, "Not computed");
  assert.match(none.impact.sentence, /No cost column was recognized/);
});

// ------------------------------------------------------------- the surface

test("both surfaces exist in the authored document, and neither ships a figure", async () => {
  const html = await readFile(PAGE, "utf8");
  const document = parseHtml(html);
  for (const id of [ROOT, REVIEW_ROOT]) {
    const region = byId(document, id);
    assert.equal(region.dataset.state, EVIDENCE_STATE.LOADING,
      `#${id} must ship the loading state, not a blank box`);
    assert.ok(byId(document, `${id}-list`), `#${id}-list is not authored`);
    assert.ok(textOf(byId(document, `${id}-summary`)).length > 20,
      `#${id} ships without words for the state it is in`);
    assert.equal(byId(document, `${id}-list`).children.length, 0,
      `#${id} ships a pre-painted finding`);
  }
  // No provider, no score, no money in the markup: everything a reader acts on
  // is decided by the model and painted at runtime.
  const authored = html.slice(html.indexOf('id="import-evidence"'), html.indexOf('id="intake-confidence"'));
  assert.doesNotMatch(authored, /AWS Bedrock|Vertex AI|Azure OpenAI/);
  assert.doesNotMatch(authored, /\d+ of 100/);
});

test("the painted order is provider, confidence, benchmark, impact, provenance, action", async () => {
  const document = await paintedPage();
  const items = byId(document, `${ROOT}-list`).querySelectorAll(".import-evidence-finding");
  assert.equal(items.length, DEMO_IMPORT_SET.length);
  for (const item of items) {
    const parts = item.childElements
      .map((child) => child.dataset.part ?? (child.className.includes("import-evidence-provider") ? "provider" : null))
      .filter((part) => part && part !== "error");
    assert.deepEqual(parts, [...FINDING_ORDER],
      "a finding paints its parts out of the declared reading order");
    // The provider is a real heading at the level the host section owes, and it
    // is what names the finding to a screen reader.
    const heading = item.childElements[0];
    assert.equal(heading.tagName, "H4");
    assert.equal(item.getAttribute("aria-labelledby"), heading.id);
  }
  // The review surface nests one level deeper, under its own h4.
  assert.equal(renderImportEvidence(document, REVIEW_ROOT,
    { findings: [findingFrom("vertex-ai-recognized")], level: 5 }), true);
  assert.equal(byId(document, `${REVIEW_ROOT}-list`)
    .querySelectorAll(".import-evidence-finding")[0].childElements[0].tagName, "H5");
});

test("no stylesheet rule reorders, reverses, or hides what the DOM order established", async () => {
  const css = await readFile(STYLES, "utf8");
  const scoped = css.split("\n").filter((line) => line.includes(".import-evidence"));
  assert.ok(scoped.length > 20, "the surface has no rules of its own");
  for (const line of scoped) {
    assert.doesNotMatch(line, /(^|[;{ ])order\s*:\s*-?\d/, `a rule reorders visually: ${line}`);
    assert.doesNotMatch(line, /flex-direction\s*:\s*[a-z-]*reverse/, `a rule reverses: ${line}`);
    assert.doesNotMatch(line, /grid-area\s*:/, `a rule places by grid-area: ${line}`);
    // An extreme value wraps. It is never cut off, and it never pushes the
    // comparison sideways instead.
    assert.doesNotMatch(line, /text-overflow\s*:\s*ellipsis/, `a rule ellipses: ${line}`);
    assert.doesNotMatch(line, /white-space\s*:\s*nowrap/, `a rule refuses to wrap: ${line}`);
    assert.doesNotMatch(line, /-webkit-line-clamp/, `a rule clamps lines: ${line}`);
    assert.doesNotMatch(line, /overflow-x\s*:\s*(auto|scroll)/, `a rule scrolls the comparison: ${line}`);
  }
  for (const selector of ["\\.import-evidence-figure", "\\.import-evidence-chip",
    "\\.import-evidence-action-text", "\\.import-evidence-line"]) {
    assert.match(css, new RegExp(`${selector}[^{]*\\{[^}]*overflow-wrap:anywhere`),
      `${selector} pushes the panel sideways instead of wrapping`);
  }
  // The narrow viewport keeps the same block, one column, with the figure on its
  // own line — never a table with a scrollbar.
  assert.match(css, /@media \(max-width:640px\) \{ \.import-evidence-finding[^}]*\}/);
});

// -------------------------------------------------------- colour is never alone

test("a status is a word and a shape before it is a colour, in every state", async () => {
  const css = await readFile(STYLES, "utf8");
  const shapes = new Set();
  for (const status of Object.values(EVIDENCE_STATUS)) {
    const presentation = STATUS_PRESENTATION[status];
    assert.ok(presentation.label.length > 0, `${status} has no word`);
    assert.ok(presentation.shape.length > 0, `${status} has no glyph`);
    assert.equal(shapes.has(presentation.shape), false, `${status} reuses another status's glyph`);
    shapes.add(presentation.shape);
    // The silhouette rule from design-system/claude-design/review-08-foundations
    // .html: a measured status is a dynamic signal and gets a filled wash; where
    // a finding came from is a static classification and gets an outline.
    assert.equal(presentation.silhouette, "wash");
    assert.match(css, new RegExp(`\\.import-evidence-chip\\[data-state="${status}"\\]`),
      `${status} has no rule of its own in the stylesheet`);
  }
  assert.match(css, /\.import-evidence-chip\[data-silhouette="outline"\]/);
});

test("status meaning survives with the colour switched off", async () => {
  const document = await paintedPage();
  for (const item of byId(document, `${ROOT}-list`).querySelectorAll(".import-evidence-finding")) {
    const chip = item.querySelectorAll('[data-chip="status"]')[0];
    const presentation = STATUS_PRESENTATION[item.dataset.status];
    // The attributes carry the shape and the state; the text carries the word
    // and the number. Neither reads a colour to know what this finding is.
    assert.equal(chip.dataset.state, item.dataset.status);
    assert.equal(chip.dataset.shape, presentation.shape);
    assert.ok(textOf(chip).includes(presentation.label));
    assert.match(textOf(chip), new RegExp(`\\d+ of ${MAX_CONFIDENCE}|not scored`),
      "the confidence chip carries a band name with no number in it");
    // The glyph is a second channel for the word, not a thing to read aloud.
    assert.equal(chip.querySelectorAll(".import-evidence-chip-shape")[0]
      .getAttribute("aria-hidden"), "true");
    // And the source chip is the outline one, as the mirror's rule requires.
    const source = item.querySelectorAll('[data-chip="source"]')[0];
    assert.equal(source.dataset.silhouette, "outline");
  }
});

test("every chip pairing, rail, and focus ring clears its WCAG floor", async () => {
  const css = await readFile(STYLES, "utf8");
  const channel = (value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((index) => channel(parseInt(hex.slice(index, index + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const token = (name) => {
    if (!name.startsWith("--")) return name;
    const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    assert.ok(match, `${name} is declared in the stylesheet`);
    return match[1].toLowerCase();
  };
  const CARD = "#ffffff";        // a finding's own surface
  const PANEL = "#fbfcfa";       // the section behind it
  const measured = [];
  const pairs = [
    // The chip label is small mono text on its own fill: body text, 4.5:1.
    { what: "trusted chip label", ink: "--import-ink", on: "--import-wash", floor: 4.5 },
    { what: "ambiguous chip label", ink: "--state-warn-ink", on: "--state-warn-wash", floor: 4.5 },
    { what: "rejected chip label", ink: "--state-error-ink", on: "--state-error-wash", floor: 4.5 },
    { what: "source chip label", ink: "--ink-muted", on: CARD, floor: 4.5 },
    // The status rail on each card encodes the status, so it is a meaningful
    // non-text indicator: 3:1 against the surfaces on both sides of it.
    { what: "trusted rail on the card", ink: "--import-accent", on: CARD, floor: 3 },
    { what: "trusted rail on the panel", ink: "--import-accent", on: PANEL, floor: 3 },
    { what: "ambiguous rail on the card", ink: "--state-warn-line", on: CARD, floor: 3 },
    { what: "rejected rail on the card", ink: "--state-error-line", on: CARD, floor: 3 },
    // Body copy: the action, the supporting detail, the state line.
    { what: "the action", ink: "--import-ink", on: "--import-wash", floor: 4.5 },
    { what: "supporting detail", ink: "--ink-muted", on: CARD, floor: 4.5 },
    { what: "the state line", ink: "--ink-muted", on: PANEL, floor: 4.5 },
    { what: "a per-finding error", ink: "--state-error-ink", on: "--state-error-wash", floor: 4.5 },
    { what: "the disclosure summary", ink: "--import-ink", on: CARD, floor: 4.5 },
  ];
  for (const pair of pairs) {
    const ratio = contrast(token(pair.ink), token(pair.on));
    measured.push(`${pair.what}: ${ratio.toFixed(2)}:1`);
    assert.ok(ratio >= pair.floor,
      `${pair.what} is ${ratio.toFixed(2)}:1, under the ${pair.floor}:1 floor`);
  }
  assert.equal(measured.length, pairs.length);
  // The focus ring is a non-text indicator and lands on both surfaces here.
  const ring = new RegExp("--focus-ring\\s*:\\s*(#[0-9a-fA-F]{6})")
    .exec(await readFile(SITE_STYLES, "utf8"))[1];
  for (const behind of [CARD, PANEL, token("--import-wash")]) {
    assert.ok(contrast(ring, behind) >= 3,
      `the focus ring is under 3:1 against ${behind}`);
  }
  assert.match(css, /\.import-evidence-support-summary:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
});

// ------------------------------------------------------- keyboard and disclosure

test("every disclosure summary is a tab stop, in the list's own order, and hides its contents", async () => {
  const page = await loadPage(PAGE);
  try {
    const { document } = page;
    renderImportEvidence(document, ROOT, { findings: buildDemoImportFindings(), level: 4 });
    const items = byId(document, `${ROOT}-list`).querySelectorAll(".import-evidence-finding");
    const summaries = items.map((item) => item.querySelectorAll("summary")[0]);
    assert.equal(summaries.length, DEMO_IMPORT_SET.length);

    const sequence = tabSequence(document);
    const positions = summaries.map((summary) => sequence.indexOf(summary));
    for (const [index, at] of positions.entries()) {
      assert.ok(at >= 0, `the disclosure on finding ${index + 1} is not reachable by keyboard`);
    }
    assert.deepEqual(positions, [...positions].sort((left, right) => left - right),
      "the tab order runs against the reading order of the list");
    // Nothing focusable is trapped between two findings: the stops between the
    // first and the last summary are exactly the summaries in between.
    const between = sequence.slice(positions[0], positions.at(-1) + 1)
      .filter((element) => element.tagName === "SUMMARY");
    assert.equal(between.length, summaries.length);

    const [summary] = summaries;
    const details = summary.parentNode;
    assert.equal(summary.hasAttribute("aria-label"), false,
      "the visible summary text is the accessible name");
    assert.match(textOf(summary), /Supporting evidence — \d+ matched signals, \d+ reasons, \d+ provenance rows/);
    // Closed means closed. Asserted on `open`, because textOf reads through a
    // collapsed disclosure in this harness and a real browser does not.
    assert.equal(details.hasAttribute("open"), false);
    summary.focus();
    assert.equal(document.activeElement, summary);
    pressEnter(document);
    assert.equal(details.hasAttribute("open"), true, "Enter did not open the disclosure");
    pressSpace(document);
    assert.equal(details.hasAttribute("open"), false, "Space did not close the disclosure");

    // A repaint keeps what the reader opened open and leaves them standing on it.
    pressEnter(document);
    renderImportEvidence(document, ROOT, { findings: buildDemoImportFindings(), level: 4 });
    const repainted = byId(document, `${ROOT}-list`).querySelectorAll("details")[0];
    assert.equal(repainted.hasAttribute("open"), true, "the repaint closed the reader's disclosure");
    assert.equal(document.activeElement?.id, summary.id, "the repaint moved the reader's focus");
  } finally {
    page.restore?.();
  }
});

test("the status region is always rendered, outside every disclosure", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const live = byId(document, `${ROOT}-live`);
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.ok(live.closest("details") === null,
    "the status region is inside a disclosure, so a real browser announces nothing");
  assert.ok(live.closest("[hidden]") === null,
    "the status region ships inside a hidden container, so the first import announces nothing");
  // The review step carries no second announcer: it already has one in
  // #import-mapping-status, and two regions speaking at the same moment are a
  // queue in the reader's ear rather than an answer. Its own state is always
  // rendered and always visible instead.
  const review = byId(document, REVIEW_ROOT);
  assert.ok(review.closest("#import-mapping") !== null);
  assert.equal(review.querySelectorAll("[aria-live]").length, 0);
  assert.ok(textOf(byId(document, `${REVIEW_ROOT}-summary`)).length > 20);
});

test("completion, rejection, and error each reach the live region", async () => {
  const document = await paintedPage();
  const live = byId(document, `${ROOT}-live`);
  assert.equal(live.dataset.kind, ANNOUNCEMENT_KIND.PARTIAL);
  assert.match(textOf(live), /2 of 5 exports are trusted; 1 ambiguous and 2 rejected/);

  const trusted = buildDemoImportFindings().filter((finding) => finding.status === EVIDENCE_STATUS.TRUSTED);
  renderImportEvidence(document, ROOT, { findings: trusted, level: 4 });
  assert.equal(live.dataset.kind, ANNOUNCEMENT_KIND.COMPLETE);

  const rejected = [findingFrom("bedrock-incompatible")];
  renderImportEvidence(document, ROOT, { findings: rejected, level: 4 });
  assert.equal(live.dataset.kind, ANNOUNCEMENT_KIND.REJECTED);
  assert.match(textOf(live), /nothing has entered the briefing/);

  renderImportEvidence(document, ROOT, {
    findings: [findingFrom("bedrock-recognized", { error: { message: "This file could not be read." } })],
    level: 4,
  });
  assert.equal(live.dataset.kind, ANNOUNCEMENT_KIND.ERROR);
  assert.match(textOf(live), /unreadable/);
  // And the visible state line says the same thing, so the announcement is not
  // the only place the outcome exists.
  assert.equal(textOf(byId(document, `${ROOT}-summary`)), textOf(live));
});

// ----------------------------------------------------------------- states

test("loading, empty, and per-finding error are drawn with words, not blanks", async () => {
  const document = await paintedPage();
  const region = byId(document, ROOT);
  const list = byId(document, `${ROOT}-list`);

  renderImportEvidenceLoading(document, ROOT, { level: 4 });
  assert.equal(region.dataset.state, EVIDENCE_STATE.LOADING);
  assert.equal(list.children.length, 0);
  assert.match(textOf(byId(document, `${ROOT}-summary`)), /Scoring the selected exports/);

  renderImportEvidence(document, ROOT, { findings: [], level: 4 });
  assert.equal(region.dataset.state, EVIDENCE_STATE.EMPTY);
  assert.match(textOf(byId(document, `${ROOT}-summary`)), /Nothing here has been recognized/);

  const failed = findingFrom("vertex-ai-recognized",
    { error: { message: "This file stopped part-way through and was not scored." } });
  renderImportEvidence(document, ROOT, { findings: [failed], level: 4 });
  assert.equal(region.dataset.state, EVIDENCE_STATE.ERROR);
  const item = list.querySelectorAll(".import-evidence-finding")[0];
  assert.equal(item.dataset.error, "true");
  assert.equal(item.dataset.status, EVIDENCE_STATUS.REJECTED);
  // The failure is stated where the reader is looking, and the action says what
  // to do about it rather than about the export.
  assert.match(textOf(item.querySelectorAll('[data-part="error"]')[0]), /stopped part-way through/);
  assert.match(textOf(item.querySelectorAll('[data-part="action"]')[0]), /Choose the file again/);
  // Even in the error state the reading order is intact.
  assert.equal(item.querySelectorAll('[data-part="impact"]').length, 1);
});

test("the implausible extremes wrap instead of breaking the comparison", async () => {
  const document = await paintedPage();
  // Generated here rather than committed: a 240-character provider name is the
  // shape a hand-edited contract display name actually arrives in.
  const long = `Contoso ${"Hyperscale".repeat(23)} AI`;
  const base = findingFrom("bedrock-recognized");
  const extremes = [
    { ...base, id: "long-name", provider: { known: true, name: long } },
    { ...base, id: "billion", impact: { ...base.impact, amount: 1204559873.4, display: formatImpactAmount(1204559873.4), scale: "outsized" } },
    { ...base, id: "credit", impact: { ...base.impact, amount: -4500000, display: formatImpactAmount(-4500000), scale: "credit" } },
    { ...base, id: "zero", impact: { ...base.impact, amount: 0, display: formatImpactAmount(0), scale: "zero" } },
    {
      ...base, id: "floor", status: EVIDENCE_STATUS.REJECTED,
      presentation: STATUS_PRESENTATION[EVIDENCE_STATUS.REJECTED],
      confidence: { ...base.confidence, value: 0, display: `0 of ${MAX_CONFIDENCE}` },
    },
  ];
  assert.equal(renderImportEvidence(document, ROOT, { findings: extremes, level: 4 }), true);
  const items = byId(document, `${ROOT}-list`).querySelectorAll(".import-evidence-finding");
  assert.equal(items.length, extremes.length);
  for (const item of items) {
    // Whatever the figure, the two elements that carry the decision are still
    // there and still last in the order.
    assert.equal(item.querySelectorAll('[data-part="action"]').length, 1);
    assert.equal(item.childElements.at(-1).dataset.part, "action");
    assert.ok(textOf(item.querySelectorAll('[data-part="impact"]')[0]).length > 0);
  }
  assert.ok(textOf(byId(document, `${ROOT}-list`)).includes(long),
    "a provider name longer than the column was dropped rather than wrapped");
  // The two scales that produce the widest strings get their own line rather
  // than pushing the action off the side.
  const scales = items.map((item) => item.querySelectorAll('[data-part="impact"]')[0].dataset.scale);
  assert.ok(scales.includes("outsized") && scales.includes("credit") && scales.includes("zero"));
  assert.ok(textOf(byId(document, `${ROOT}-list`)).includes("1,204,559,873.40"));
  assert.ok(textOf(byId(document, `${ROOT}-list`)).includes(`0 of ${MAX_CONFIDENCE}`));
  assert.ok(textOf(byId(document, `${ROOT}-list`)).includes(`${MAX_CONFIDENCE} of ${MAX_CONFIDENCE}`));
});

test("no cell of a reader's file reaches the surface, hostile fixture included", async () => {
  const document = await paintedPage([findingFrom("bedrock-incompatible")]);
  const painted = textOf(byId(document, ROOT));
  assert.ok(painted.length > 0);
  assert.equal(painted.includes(INJECTED_INSTRUCTION), false);
  assert.equal(painted.includes(KEY_LIKE_STRING), false);
  assert.equal(painted.includes("acct-synthetic-01"), false);
  assert.equal(painted.includes("synthetic.sonnet-mini"), false);
});

// ---------------------------------------------------------------- the wiring

test("the review step paints the file it is about to run, on the real page", async () => {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": JSON.parse(
        await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8")),
      "/finops-evaluation-fixtures.json": JSON.parse(
        await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8")),
    },
  });
  try {
    const { document } = page;
    await importPageModule("/evolution-page.js");
    await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
      "the bundled analysis to finish rendering");

    // The import panel's own comparison is painted by the page entry, not by
    // this test: a module nothing renders is a module that ships nothing.
    assert.equal(byId(document, ROOT).dataset.state, EVIDENCE_STATE.PARTIAL);
    assert.equal(byId(document, `${ROOT}-list`)
      .querySelectorAll(".import-evidence-finding").length, DEMO_IMPORT_SET.length);

    // A file no published contract claims goes to the review step, and the step
    // says what it is before the reader runs it.
    const input = byId(document, "local-finops-files");
    input.files = [{
      name: "ledger.csv",
      type: "text/csv",
      text: async () => "posting_date,gl_account,amount\n2026-07-20,6100-software,482.10\n",
    }];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => !byId(document, "import-mapping").hidden,
      "the column-mapping review to open");

    const review = byId(document, REVIEW_ROOT);
    assert.notEqual(review.dataset.state, EVIDENCE_STATE.LOADING);
    const item = byId(document, `${REVIEW_ROOT}-list`).querySelectorAll(".import-evidence-finding")[0];
    assert.equal(item.dataset.status, EVIDENCE_STATUS.REJECTED);
    assert.match(textOf(item), /No provider recognized/);
    assert.match(textOf(byId(document, `${REVIEW_ROOT}-summary`)), /rejected|unreadable/);
    // The evidence is read before the table it explains and before the control
    // that runs it.
    const order = byId(document, "import-mapping").childElements.map((child) => child.id || child.className);
    assert.ok(order.indexOf(REVIEW_ROOT) < order.findIndex((name) => String(name).includes("import-mapping-actions")));
    // Let the selection finish before the page globals go away: a continuation
    // that lands after the restore reads a `document` that no longer exists.
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  } finally {
    page.restore?.();
  }
});

test("the entry point renders both surfaces rather than only defining them", async () => {
  const source = await readFile(ENTRY, "utf8");
  assert.match(source, /renderImportEvidence\(document, "import-evidence", \{/);
  assert.match(source, /renderImportEvidence\(document, REVIEW_EVIDENCE_ID, \{/);
  assert.match(source, /paintReviewEvidence\(file\);/);
});
