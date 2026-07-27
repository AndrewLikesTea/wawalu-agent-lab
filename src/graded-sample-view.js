// The reading surface for a leader's own graded query sample.
//
// It takes the document rather than reading a global, exactly like
// `import-mapping-view.js` and `model-overspend-finding-view.js`, so a test
// drives the shipped markup of evolution.html instead of a fixture authored for
// the test. Every node is built with createElement and textContent: an imported
// file name is a string in a text node and nothing else. There is no markup
// string, no innerHTML, and no template interpolation on any path here.
//
// Four rules this surface holds:
//
//   1. **Nothing is signalled by tint alone.** A provisional grade carries a
//      word ("Provisional grade"), a shape, a dashed outline and a hatch — three
//      of the four survive monochrome, and the word is a text node beside the
//      letter, so a screen reader reads it without a title or a class.
//   2. **Coverage and confidence sit with the letter**, not in a disclosure and
//      not in a footnote.
//   3. **A sample that cannot be graded publishes no figure.** The KPI row, the
//      mix and the cohort statement are hidden outright rather than drawn empty.
//   4. **The example surface is left alone until there is something to replace
//      it with.** A visitor who imports nothing never reaches this module.

const SECTION_ID = "graded-sample";
const BODY_ID = "graded-sample-body";
const LIVE_ID = "graded-sample-live";
const PROVENANCE_ID = "graded-provenance";
const BADGE_ID = "headline-basis";
const KPI_ROW_ID = "kpi-row";
const MIX_PANEL_ID = "spend-mix-panel";
const TOGGLE_ID = "graded-subscores-toggle";
const PANEL_ID = "graded-subscores-panel";

const CATEGORY_VARS = {
  highValue: "--cat-high-value",
  overProvisioned: "--cat-over-provisioned",
  inefficient: "--cat-inefficient",
  outOfScope: "--cat-out-of-scope",
};

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shapeSpan(doc, glyph) {
  const shape = element(doc, "span", "graded-shape", glyph);
  shape.setAttribute("aria-hidden", "true");
  return shape;
}

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text;
  return node;
}

function show(doc, id, visible) {
  const node = byId(doc, id);
  if (node) node.hidden = !visible;
  return node;
}

function state(section) {
  if (!section.__gradedSample) section.__gradedSample = { model: null };
  return section.__gradedSample;
}

/**
 * Paint the graded surface, or leave the page in its example state.
 *
 * Returns the model that was painted so a caller can assert on the state it
 * asked for rather than on the DOM it got.
 */
export function applyGradedSample(doc, model) {
  const section = byId(doc, SECTION_ID);
  if (!section || !model) return null;
  if (model.state === "example") return clearGradedSample(doc);
  state(section).model = model;
  if (section.dataset.expanded !== "true") section.dataset.expanded = "false";
  paint(doc, section);
  return model;
}

/** Back to the bundled example: every slot this module wrote is handed back. */
export function clearGradedSample(doc) {
  const section = byId(doc, SECTION_ID);
  if (section) {
    state(section).model = null;
    section.hidden = true;
    section.dataset.state = "example";
    section.dataset.expanded = "false";
    delete section.dataset.gradeStatus;
    byId(doc, BODY_ID)?.replaceChildren();
    setText(doc, LIVE_ID, "");
  }
  const provenance = byId(doc, PROVENANCE_ID);
  if (provenance) {
    provenance.replaceChildren();
    provenance.hidden = true;
  }
  const basis = byId(doc, "mix-basis");
  if (basis) {
    basis.replaceChildren();
    basis.hidden = true;
  }
  // The example badge was hidden, never rewritten, so handing it back is one
  // flag rather than a second copy of its wording.
  show(doc, BADGE_ID, true);
  return null;
}

function paint(doc, section) {
  const model = state(section).model;
  const body = byId(doc, BODY_ID);
  if (!model || !body) return;
  section.hidden = false;
  section.dataset.state = model.state;

  if (model.state === "not_gradeable") {
    delete section.dataset.gradeStatus;
    body.replaceChildren(...notGradeable(doc, model));
    // No figure is published, so nothing is un-hidden. A half-filled KPI row is
    // worse than none: the reader would read four numbers as graded.
    show(doc, KPI_ROW_ID, false);
    show(doc, MIX_PANEL_ID, false);
    paintProvenance(doc, model.provenance);
    setText(doc, LIVE_ID, `${model.message.label}. ${model.nextAction.text}`);
    return;
  }

  section.dataset.gradeStatus = model.provisional ? "provisional" : "confident";
  body.replaceChildren(
    gradeBlock(doc, model),
    disclosure(doc, section, model),
    cohortBlock(doc, model.cohort),
    actionBlock(doc, model.nextAction),
  );
  paintProvenance(doc, model.provenance);
  paintKpis(doc, model);
  paintMix(doc, model.mix);
  show(doc, KPI_ROW_ID, true);
  show(doc, MIX_PANEL_ID, true);
  setText(doc, LIVE_ID,
    `${model.gradeLine}. ${model.coverage.text} · ${model.coverage.label}.`);

  const focusId = section.dataset.focusTarget;
  if (focusId) {
    delete section.dataset.focusTarget;
    byId(doc, focusId)?.focus?.();
  }
}

// --- the letter, and everything a reader needs beside it --------------------

function gradeBlock(doc, model) {
  const block = element(doc, "div", "graded-headline");
  block.dataset.gradeStatus = model.provisional ? "provisional" : "confident";

  // The letter itself is decorative: it is repeated in words on the line below,
  // and a screen reader that read both would say the grade twice.
  const letter = element(doc, "p", "graded-letter", model.grade);
  letter.dataset.gradeStatus = model.provisional ? "provisional" : "confident";
  letter.setAttribute("aria-hidden", "true");

  // Channel two and three: the word, and a shape beside it. Neither is a tint,
  // and the word is the accessible name of this figure.
  const line = element(doc, "p", "graded-grade-line");
  line.append(shapeSpan(doc, model.statusShape),
    element(doc, "span", "graded-grade-text", model.gradeLine));

  const coverage = element(doc, "p", "graded-coverage");
  coverage.append(
    element(doc, "span", "graded-coverage-value", model.coverage.text),
    element(doc, "span", "graded-coverage-label", model.coverage.label),
  );
  block.append(letter, line, coverage,
    element(doc, "p", "graded-coverage-rule", model.coverage.rule));
  return block;
}

function notGradeable(doc, model) {
  const block = element(doc, "div", "graded-not-gradeable");
  block.append(
    element(doc, "p", "graded-not-gradeable-label", model.message.label),
    element(doc, "p", "graded-not-gradeable-rule", model.message.rule),
  );
  if (model.message.unscored) {
    block.append(element(doc, "p", "graded-not-gradeable-unscored", model.message.unscored));
  }
  return [block, actionBlock(doc, model.nextAction)];
}

function actionBlock(doc, action) {
  const block = element(doc, "div", "graded-action");
  block.dataset.available = String(action.available);
  block.dataset.kind = action.kind;
  block.append(
    element(doc, "p", "eyebrow", "Prioritized next action"),
    element(doc, "p", "graded-action-text", action.text),
  );
  return block;
}

function cohortBlock(doc, cohort) {
  const block = element(doc, "div", "graded-cohort");
  block.dataset.available = String(cohort.available);
  block.append(
    element(doc, "p", "eyebrow", "Cohort comparison"),
    element(doc, "p", "graded-cohort-answer", cohort.answer),
    element(doc, "p", "graded-cohort-reason", cohort.reason),
  );
  return block;
}

// --- progressive disclosure -------------------------------------------------
//
// The same trigger semantics, the same expanded/collapsed announcement and the
// same keyboard behaviour as the per-model evidence disclosure: a real button
// that owns its panel, says whether it is open, starts closed, and takes focus
// back after the repaint.

function disclosure(doc, section, model) {
  const expanded = section.dataset.expanded === "true";
  const wrap = element(doc, "div", "graded-disclosure");
  const toggle = element(doc, "button", "graded-disclosure-toggle");
  toggle.id = TOGGLE_ID;
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", PANEL_ID);
  const count = model.disclosure.categories.length;
  toggle.textContent = `${expanded ? "Hide" : "Show"} the per-category subscores `
    + `(${count} categor${count === 1 ? "y" : "ies"})`;
  toggle.addEventListener("click", () => {
    section.dataset.expanded = expanded ? "false" : "true";
    section.dataset.focusTarget = TOGGLE_ID;
    paint(doc, section);
  });

  const panel = element(doc, "div", "graded-disclosure-panel");
  panel.id = PANEL_ID;
  panel.hidden = !expanded;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Per-category subscores behind this grade");
  if (expanded) panel.append(...subscoreDetail(doc, model.disclosure));
  wrap.append(toggle, panel);
  return wrap;
}

function subscoreDetail(doc, detail) {
  const axes = element(doc, "dl", "graded-axes");
  axes.setAttribute("aria-label", "Axis subscores");
  for (const axis of detail.axes) {
    axes.append(
      element(doc, "dt", undefined, axis.weightPercent === null
        ? axis.label : `${axis.label} · ${axis.weightPercent}% of the composite`),
      element(doc, "dd", undefined, axis.text),
    );
  }
  const categories = element(doc, "ul", "graded-categories");
  categories.setAttribute("aria-label", "Per-category subscores");
  for (const row of detail.categories) {
    const item = element(doc, "li", "graded-category");
    item.dataset.category = row.key;
    item.append(
      element(doc, "span", "graded-category-label", row.label),
      element(doc, "span", "graded-category-share", `${row.shareText} of scored queries`),
      element(doc, "span", "graded-category-score", row.scoreText),
      element(doc, "span", "graded-category-records",
        `${row.records} record${row.records === 1 ? "" : "s"}`),
    );
    categories.append(item);
  }
  return [axes, categories,
    element(doc, "p", "graded-unclassified", detail.unclassifiedText)];
}

// --- the three panels -------------------------------------------------------

function paintProvenance(doc, provenance) {
  const node = byId(doc, PROVENANCE_ID);
  if (!node) return;
  node.replaceChildren(
    shapeSpan(doc, "▣"),
    element(doc, "strong", "provenance-label", provenance.label),
    element(doc, "span", "provenance-detail", provenance.detail),
  );
  node.hidden = false;
  // Replaced, not accompanied: two provenance sentences on one row is the state
  // this line exists to end.
  show(doc, BADGE_ID, false);
}

const KPI_SLOT = Object.freeze({
  spend: "kpi-spend", recoverable: "kpi-recoverable",
  productive: "kpi-productive", peer: "kpi-peer",
});

function paintKpis(doc, model) {
  for (const kpi of model.kpis) {
    const slot = KPI_SLOT[kpi.key];
    if (!slot) continue;
    setText(doc, `${slot}-value`, kpi.value);
    setText(doc, `${slot}-note`, kpi.note);
    const card = byId(doc, slot);
    if (card) card.dataset.available = String(kpi.available);
  }
}

function paintMix(doc, mix) {
  const bar = byId(doc, "mix-bar");
  const legend = byId(doc, "mix-legend");
  if (!bar || !legend) return;
  bar.replaceChildren();
  legend.replaceChildren();
  for (const segment of mix.segments) {
    const color = `var(${CATEGORY_VARS[segment.key]})`;
    const piece = element(doc, "div", "mix-segment");
    piece.style.flexGrow = String(Math.max(segment.share, 0.004));
    piece.style.background = color;
    piece.title = `${segment.label} · ${segment.shareText} · ${segment.countText}`;
    bar.append(piece);

    const item = element(doc, "li");
    item.style.color = color;
    const head = element(doc, "div", "legend-head");
    const label = element(doc, "span", "legend-label");
    const swatch = element(doc, "span", "legend-swatch");
    swatch.style.background = color;
    label.append(swatch, element(doc, "span", undefined, segment.label));
    head.append(label, element(doc, "span", "legend-share", segment.shareText));
    item.append(head,
      element(doc, "p", "legend-spend", segment.countText),
      element(doc, "p", "legend-copy", segment.description),
      element(doc, "p", "legend-action", segment.systemAction));
    legend.append(item);
  }
  setText(doc, "mix-summary", `${mix.summary} ${mix.basis}`);
  const basis = byId(doc, "mix-basis");
  if (basis) {
    basis.textContent = mix.basis;
    basis.hidden = false;
  }
}
