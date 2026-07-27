// The evidence panel for one department's grade, drawn into the shipped markup
// of evolution.html.
//
// It takes the document rather than reading a global, exactly like
// `graded-sample-view.js`, and builds every node with createElement and
// textContent. There is no markup string, no innerHTML, and no template
// interpolation on any path here — the strings it paints come from
// `department-evidence.js`, which is itself assembled from counts and authored
// copy.
//
// Four rules this surface holds:
//
//   1. **The finding is legible before anything is expanded.** Grade, impact,
//      confidence, provenance, why it matters and the one next action are all
//      in the head. The disclosure holds the audit trail, not the answer.
//   2. **The redaction promise is persistent.** It is painted in every state,
//      open or closed, above the control that opens the evidence. It is not a
//      tooltip, not a toast, and it cannot be dismissed.
//   3. **Redaction is drawn as a deliberate treatment, never as a failure.**
//      The sketch rows use the page's neutral chip idiom — outline chips for
//      static classifications, per the Claude Design foundations card — and
//      never the error palette, which on this page means "we could not read
//      your file".
//   4. **Nothing is signalled by tint alone.** Every state carries a word and a
//      shape beside its tint, and each sketch row carries its own counts.
//
// Provenance hierarchy: an own-import finding is painted at the panel's primary
// type role and a bundled-sample finding one step down, with less spacing
// around it. That is scale, weight and rhythm — not colour — so a reader who
// cannot see the tint still reads which grade is theirs.

import { evidenceAnnouncement } from "./department-evidence.js";

const SECTION_ID = "department-evidence";
const BODY_ID = "department-evidence-body";
const LIVE_ID = "department-evidence-live";
const TOGGLE_ID = "department-evidence-toggle";
const PANEL_ID = "department-evidence-panel";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A shape channel. Hidden from assistive tech: the word beside it is the fact. */
function shapeSpan(doc, glyph) {
  const shape = element(doc, "span", "evidence-shape", glyph);
  shape.setAttribute("aria-hidden", "true");
  return shape;
}

function state(section) {
  if (!section.__departmentEvidence) section.__departmentEvidence = { model: null };
  return section.__departmentEvidence;
}

/**
 * Write the live region only when the sentence actually changed.
 *
 * `paint` runs again on every disclosure toggle, and rewriting a status region
 * with the same string still announces it: a reader who opened a panel would
 * hear the whole finding a second time. The disclosure's own state travels on
 * the button's `aria-expanded` and in its label, which is where a reader
 * expects it.
 */
function announce(doc, text) {
  const node = byId(doc, LIVE_ID);
  if (!node || node.textContent === text) return node;
  node.textContent = text;
  return node;
}

/**
 * Paint the evidence panel.
 *
 * @returns the model that was painted, so a caller can assert on the state it
 *   asked for rather than on the DOM it got.
 */
export function applyDepartmentEvidence(doc, model) {
  const section = byId(doc, SECTION_ID);
  if (!section || !model) return null;
  state(section).model = model;
  if (section.dataset.expanded !== "true") section.dataset.expanded = "false";
  paint(doc, section);
  return model;
}

/** Hand the section back empty. Nothing this module wrote survives. */
export function clearDepartmentEvidence(doc) {
  const section = byId(doc, SECTION_ID);
  if (!section) return null;
  state(section).model = null;
  section.hidden = true;
  section.dataset.state = "empty";
  section.dataset.expanded = "false";
  section.removeAttribute("aria-busy");
  delete section.dataset.provenance;
  byId(doc, BODY_ID)?.replaceChildren();
  const live = byId(doc, LIVE_ID);
  if (live) live.textContent = "";
  return null;
}

function paint(doc, section) {
  const model = state(section).model;
  const body = byId(doc, BODY_ID);
  if (!model || !body) return;
  section.hidden = false;
  section.dataset.state = model.state;
  section.dataset.provenance = model.provenance.kind;
  // A busy region is a fact about the region, not a spinner: a reader is told
  // the panel is still filling rather than reading a half-drawn finding.
  if (model.state === "loading") section.setAttribute("aria-busy", "true");
  else section.setAttribute("aria-busy", "false");

  if (!model.head) {
    body.replaceChildren(shellBlock(doc, model), privacyBlock(doc, model));
    announce(doc, `${model.title} ${model.impact}`);
    return;
  }

  body.replaceChildren(
    headBlock(doc, model),
    privacyBlock(doc, model),
    disclosure(doc, section, model),
  );
  announce(doc, evidenceAnnouncement(model));

  const focusId = section.dataset.focusTarget;
  if (focusId) {
    delete section.dataset.focusTarget;
    // Focus returns to the control the reader pressed, so expanding the panel
    // never drops a keyboard user at the top of the document.
    byId(doc, focusId)?.focus?.();
  }
}

// --- loading, empty and error ----------------------------------------------
//
// One block for all three. Each carries its own word and its own shape, so
// "still reading", "nothing imported" and "could not read" are three readings,
// not one grey box a reader has to guess at.

function shellBlock(doc, model) {
  const block = element(doc, "div", "evidence-shell");
  block.dataset.state = model.state;
  const status = element(doc, "p", "evidence-shell-status");
  status.append(shapeSpan(doc, model.mark.shape),
    element(doc, "span", "evidence-shell-word", model.mark.word));
  block.append(
    status,
    element(doc, "h3", "evidence-shell-title", model.title),
    element(doc, "p", "evidence-shell-impact", model.impact),
    element(doc, "p", "evidence-shell-why", model.why),
  );
  return block;
}

// --- the finding ------------------------------------------------------------
//
// DOM order is the reading order and the announcement order: grade, impact,
// confidence, coverage, provenance, why it matters, next action. Nothing here
// is placed by CSS order, so what a screen reader hears and what an eye reads
// cannot drift apart.

function headBlock(doc, model) {
  const head = model.head;
  const block = element(doc, "div", "evidence-head");
  block.dataset.state = model.state;
  block.dataset.rank = model.provenance.rank;

  // The letter is decorative: the line beside it says the same thing in words,
  // and a screen reader that read both would announce the grade twice.
  const figure = element(doc, "p", "evidence-grade", head.grade ?? "—");
  figure.setAttribute("aria-hidden", "true");
  figure.dataset.state = model.state;

  const line = element(doc, "h3", "evidence-grade-line");
  line.append(shapeSpan(doc, model.mark.shape),
    element(doc, "span", "evidence-grade-text", head.gradeLine));

  const confidence = element(doc, "p", "confidence-chip evidence-confidence");
  confidence.dataset.tone = head.confidence.tone;
  confidence.append(
    element(doc, "span", "confidence-chip-shape", head.confidence.shape),
    element(doc, "span", "confidence-chip-label", head.confidence.label),
  );

  const provenance = element(doc, "p", "evidence-provenance");
  provenance.dataset.rank = model.provenance.rank;
  provenance.append(
    element(doc, "span", "evidence-provenance-label", model.provenance.label),
    element(doc, "span", "evidence-provenance-detail", model.provenance.detail ?? ""),
  );

  block.append(
    figure,
    line,
    element(doc, "p", "evidence-impact", head.impact),
    confidence,
    element(doc, "p", "evidence-confidence-detail", head.confidence.detail),
    element(doc, "p", "evidence-coverage", head.coverage.text),
  );
  if (head.coverage.rule) {
    block.append(element(doc, "p", "evidence-coverage-rule", head.coverage.rule));
  }
  block.append(provenance, element(doc, "p", "evidence-why", head.why), actionBlock(doc, head.action));
  return block;
}

function actionBlock(doc, action) {
  const block = element(doc, "div", "evidence-action");
  block.dataset.available = String(action.available);
  const text = element(doc, "p", "evidence-action-text");
  text.append(shapeSpan(doc, action.available ? "▶" : "◇"),
    element(doc, "span", "evidence-action-words", action.text));
  block.append(element(doc, "h4", "eyebrow", "Next action"), text);
  return block;
}

// --- the promise ------------------------------------------------------------

function privacyBlock(doc, model) {
  const block = element(doc, "p", "evidence-privacy");
  // Neutral surface, never the error palette: this is a design decision the
  // product made, not a fault it is reporting.
  block.append(
    shapeSpan(doc, "▨"),
    element(doc, "strong", "evidence-privacy-label", "Prompt text withheld"),
    element(doc, "span", "evidence-privacy-copy", model.privacy.statement),
  );
  return block;
}

// --- progressive disclosure -------------------------------------------------
//
// A real button, not a summary: it says what it expands, owns the region by id,
// reports its own state, starts closed, and takes focus back after the repaint.

function disclosure(doc, section, model) {
  const expanded = section.dataset.expanded === "true";
  const wrap = element(doc, "div", "evidence-disclosure-block");
  const toggle = element(doc, "button", "evidence-disclosure-toggle");
  toggle.id = TOGGLE_ID;
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", PANEL_ID);
  toggle.textContent = `${expanded ? "Hide" : "Show"} ${model.disclosureLabel.replace(/^Show /, "")}`;
  toggle.addEventListener("click", () => {
    section.dataset.expanded = expanded ? "false" : "true";
    section.dataset.focusTarget = TOGGLE_ID;
    paint(doc, section);
  });

  const panel = element(doc, "div", "evidence-disclosure-panel");
  panel.id = PANEL_ID;
  panel.hidden = !expanded;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", `Evidence behind ${model.head.department}'s grade`);
  if (expanded) panel.append(...detailBlocks(doc, model.detail));
  wrap.append(toggle, panel);
  return wrap;
}

/** Counts, then signals, then distribution, then sketches. Linear on purpose. */
function detailBlocks(doc, detail) {
  return [
    countsBlock(doc, detail.counts),
    signalsBlock(doc, detail.signals),
    distributionBlock(doc, detail.distribution),
    sketchesBlock(doc, detail.sketches),
  ];
}

function countsBlock(doc, counts) {
  const block = element(doc, "section", "evidence-counts");
  block.append(element(doc, "h4", "eyebrow", "Counts"));
  const list = element(doc, "dl", "evidence-count-list");
  for (const row of counts) {
    list.append(element(doc, "dt", undefined, row.label),
      element(doc, "dd", undefined, row.value));
  }
  block.append(list);
  return block;
}

function signalsBlock(doc, signals) {
  const block = element(doc, "section", "evidence-signals");
  block.append(element(doc, "h4", "eyebrow", "Rubric signals"));
  if (!signals.length) {
    block.append(element(doc, "p", "evidence-note",
      "No rubric signal is defined for this department's mix."));
    return block;
  }
  const list = element(doc, "ul", "evidence-signal-list");
  for (const signal of signals) {
    const item = element(doc, "li", "evidence-signal");
    item.dataset.fired = String(signal.fired);
    // The word "no prompts" is the state, not the empty bar: a signal that did
    // not fire says so in text, in its own row, rather than disappearing.
    item.append(
      element(doc, "span", "evidence-signal-label", signal.label),
      element(doc, "span", "evidence-signal-count",
        signal.fired ? `${signal.countText} · ${signal.shareText}` : "no prompts · 0%"),
      element(doc, "span", "evidence-signal-impact", signal.impactText),
      element(doc, "span", "evidence-signal-evidence", signal.evidence),
    );
    list.append(item);
  }
  block.append(list);
  return block;
}

function distributionBlock(doc, distribution) {
  const block = element(doc, "section", "evidence-distribution");
  block.append(element(doc, "h4", "eyebrow", "Score distribution"));
  const list = element(doc, "ul", "evidence-distribution-list");
  for (const row of distribution) {
    const item = element(doc, "li", "evidence-distribution-row");
    item.dataset.category = row.key;
    const bar = element(doc, "span", "evidence-bar");
    // The bar is decoration over a number that is already in the row; it never
    // carries a value on its own, and a 0% row still renders its label.
    bar.setAttribute("aria-hidden", "true");
    bar.style?.setProperty?.("--evidence-bar-share", `${Math.round((row.share ?? 0) * 100)}%`);
    item.append(
      element(doc, "span", "evidence-distribution-label", row.label),
      element(doc, "span", "evidence-distribution-count",
        `${row.countText} prompts · ${row.shareText}`),
      element(doc, "span", "evidence-distribution-score", `scores ${row.scoreText}`),
      bar,
    );
    list.append(item);
  }
  block.append(list);
  return block;
}

function sketchesBlock(doc, sketches) {
  const block = element(doc, "section", "evidence-sketches");
  block.append(element(doc, "h4", "eyebrow", "Redacted prompt sketches"));
  if (sketches.emptyText) {
    block.append(element(doc, "p", "evidence-note", sketches.emptyText));
    return block;
  }
  const list = element(doc, "ul", "evidence-sketch-list");
  for (const row of sketches.rows) {
    const item = element(doc, "li", "evidence-sketch");
    const marker = element(doc, "span", "evidence-sketch-redaction");
    marker.append(shapeSpan(doc, "▨"),
      element(doc, "span", "evidence-sketch-redaction-word", "text withheld"));
    item.append(
      element(doc, "span", "evidence-sketch-count", `${row.countText} · ${row.shareText}`),
      marker,
      chip(doc, row.lengthText),
      chip(doc, row.intentText),
      chip(doc, row.modelText),
      chip(doc, row.signalText),
    );
    list.append(item);
  }
  block.append(list, element(doc, "p", "evidence-note", sketches.truncationText));
  return block;
}

/**
 * A static classification chip: outline, neutral ink, no fill.
 *
 * Claude Design · Foundations, chip inventory: filled wash is a dynamic signal
 * and an outline is a static classification. A length band, an intent class, a
 * model tier and a signal name are all static classifications of a prompt that
 * has already been read, so all four are outlines.
 */
function chip(doc, text) {
  return element(doc, "span", "evidence-chip", text);
}
