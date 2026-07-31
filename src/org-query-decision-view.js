// The reading surface for "which department needs coaching now?".
//
// It takes the document rather than reading a global, like `graded-sample-view.js`
// and `department-evidence-view.js`, so a test drives the shipped markup of
// evolution.html instead of a fixture authored for the test. Every node is built
// with createElement and textContent: there is no markup string, no innerHTML and
// no template interpolation on any path here, and no prompt text reaches this
// module to begin with — the model it paints is built from classified records
// whose eight fields are an allowlist.
//
// Five rules this surface holds:
//
//   1. **The answer is first, and it is a sentence.** A leader who reads one line
//      reads which department to coach. The grade, the confidence and the
//      provenance are in the same block under it, so the letter cannot be lifted
//      out of its qualifiers.
//   2. **Nothing is signalled by tint alone.** Confidence carries a word, a shape
//      and the capping factor's own sentence; the grade carries a letter that is
//      hidden from assistive tech and a text line that is not.
//   3. **Four disclosures, in one order, each a real button.** Native
//      `aria-expanded` / `aria-controls` on a `button`, keyboard-operable because
//      it is a button and not because a handler was added. Focus returns to the
//      toggle after the repaint, so Enter twice leaves the reader where they were.
//   4. **An ungradeable sample publishes no figure.** No grade, no benchmark, no
//      priority order — the reason and the next step take their place. The
//      disclosures stay, because that is where the reader checks the refusal.
//   5. **The bundled example surface is left alone until there is something to
//      replace it with.** `absent` hides this section and writes nothing.

import { ORG_QUERY_DECISION_STATE } from "./org-query-decision.js";

export const ORG_COACHING_SECTION_ID = "org-coaching";
export const ORG_COACHING_BODY_ID = "org-coaching-body";
export const ORG_COACHING_LIVE_ID = "org-coaching-live";

/** Toggle and panel ids, derived from the disclosure id so both agree. */
export const toggleId = (id) => `org-coaching-${id}-toggle`;
export const panelId = (id) => `org-coaching-${id}-panel`;
/**
 * The assignment control for the nth residue cluster.
 *
 * Indexed off the UNASSISTED residue ranking, which does not move as the lead
 * assigns rows, so the id a control had before a recompute is the id it has
 * after one — which is what makes focus restoration below land on the control
 * the reader just used rather than on whatever is now in that position.
 */
export const residueSelectId = (index) => `org-coaching-residue-${index}`;
const residueLabelId = (index) => `${residueSelectId(index)}-label`;

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shapeSpan(doc, glyph) {
  const shape = element(doc, "span", "org-coaching-shape", glyph);
  shape.setAttribute("aria-hidden", "true");
  return shape;
}

/**
 * Write the live region only when the sentence actually changed.
 *
 * `paint` runs again on every disclosure toggle, and rewriting a status region
 * with the same string is still a change to a screen reader: it would announce
 * the whole decision a second time because the reader opened a panel.
 */
function announce(doc, text) {
  const node = byId(doc, ORG_COACHING_LIVE_ID);
  if (!node || node.textContent === text) return node;
  node.textContent = text;
  return node;
}

/**
 * Per-sample reader state, in memory on the section node and nowhere else.
 *
 * `labels` is the lead's own residue assignments — cluster key to rubric class,
 * and nothing more. No row identifier, no excerpt, no file name, no storage
 * layer: this page writes nothing to the browser and this does not change that.
 */
function held(section) {
  if (!section.__orgCoaching) {
    section.__orgCoaching = { model: null, open: new Set(), labels: {}, recompute: null };
  }
  return section.__orgCoaching;
}

/**
 * Paint the coaching decision, or leave the page in its example state.
 *
 * Returns the state that was painted so a caller can assert on what it asked for
 * rather than on the DOM it got.
 */
export function applyOrgQueryDecision(doc, state, { recompute = null } = {}) {
  const section = byId(doc, ORG_COACHING_SECTION_ID);
  if (!section || !state) return null;
  if (state.state === ORG_QUERY_DECISION_STATE.absent) return clearOrgQueryDecision(doc);
  const store = held(section);
  // A repaint of the same sample keeps the panels the reader opened. A different
  // sample does not: panels left open would be captioned for the old file — and
  // neither would a lead label, which is a statement about clusters in a corpus
  // that is no longer loaded. Re-import therefore clears them, here, rather than
  // through a second code path the import handler would have to remember.
  if (store.model?.provenance?.digest !== state.provenance?.digest) {
    store.open = new Set();
    store.labels = {};
  }
  store.recompute = typeof recompute === "function" ? recompute : null;
  store.model = state;
  paint(doc, section);
  return state;
}

/** Back to the bundled example: every slot this module wrote is handed back. */
export function clearOrgQueryDecision(doc) {
  const section = byId(doc, ORG_COACHING_SECTION_ID);
  if (!section) return null;
  const store = held(section);
  store.model = null;
  store.open = new Set();
  // The reset control reaches this through the page's own clear. A lead label
  // outliving the corpus it described is the mislabelling this clear exists to
  // prevent, so the labels go with the model.
  store.labels = {};
  store.recompute = null;
  section.hidden = true;
  section.dataset.state = ORG_QUERY_DECISION_STATE.absent;
  delete section.dataset.origin;
  byId(doc, ORG_COACHING_BODY_ID)?.replaceChildren();
  const live = byId(doc, ORG_COACHING_LIVE_ID);
  if (live) live.textContent = "";
  return null;
}

function paint(doc, section) {
  const store = held(section);
  const state = store.model;
  const body = byId(doc, ORG_COACHING_BODY_ID);
  if (!state || !body) return;
  section.hidden = false;
  section.dataset.state = state.state;
  section.dataset.origin = state.origin;

  const blocks = [
    state.state === ORG_QUERY_DECISION_STATE.graded
      ? gradedLead(doc, state) : ungradeableLead(doc, state),
  ];
  // The coverage line rides with the lead, in the same block and under the same
  // heading, because it qualifies the answer above it: a reader who takes the
  // sentence must take the share of their own corpus it was read from with it.
  // Absent on a sample with no coverage result, rather than printed as a zero.
  if (state.coverage) blocks.push(coverageBlock(doc, state.coverage));
  blocks.push(actionBlock(doc, state.action), disclosureList(doc, section, state));
  body.replaceChildren(...blocks);
  announce(doc, state.announcement);

  const focusId = section.dataset.focusTarget;
  if (focusId) {
    delete section.dataset.focusTarget;
    byId(doc, focusId)?.focus?.();
  }
}

// --- the lead block ---------------------------------------------------------
//
// Both leads answer the same question in the same slot order — answer, figure,
// confidence, provenance — so a reader who has seen one state can read the other
// without relearning the block.

function gradedLead(doc, state) {
  const block = element(doc, "div", "org-coaching-lead");
  block.dataset.gradeStatus = "graded";

  const answer = element(doc, "p", "org-coaching-answer");
  answer.append(shapeSpan(doc, "▲"),
    element(doc, "span", "org-coaching-answer-text", state.answer));

  // The letter is decorative: the benchmark line below repeats it in words, and a
  // screen reader that read both would say the grade twice.
  const letter = element(doc, "p", "org-coaching-letter", state.benchmark.grade);
  letter.setAttribute("aria-hidden", "true");
  const figure = element(doc, "div", "org-coaching-figure");
  figure.append(letter, element(doc, "p", "org-coaching-benchmark", state.benchmark.text));

  block.append(
    answer,
    element(doc, "p", "org-coaching-rule", state.rule),
    figure,
    element(doc, "p", "org-coaching-benchmark-rule", state.benchmark.rule),
    confidenceBlock(doc, state.confidence),
    provenanceBlock(doc, state.provenance),
  );
  return block;
}

function ungradeableLead(doc, state) {
  const block = element(doc, "div", "org-coaching-lead");
  block.dataset.gradeStatus = "ungradeable";
  const answer = element(doc, "p", "org-coaching-answer");
  answer.append(shapeSpan(doc, "◇"),
    element(doc, "span", "org-coaching-answer-text", state.answer));
  block.append(
    answer,
    element(doc, "p", "org-coaching-reason-label", state.reason.label),
    element(doc, "p", "org-coaching-reason-detail", state.reason.detail),
    confidenceBlock(doc, state.confidence),
    provenanceBlock(doc, state.provenance),
  );
  return block;
}

function confidenceBlock(doc, confidence) {
  const block = element(doc, "div", "org-coaching-confidence");
  block.dataset.level = confidence.level;
  const line = element(doc, "p", "org-coaching-confidence-line");
  line.append(shapeSpan(doc, confidence.shape),
    element(doc, "span", "org-coaching-confidence-text", confidence.text));
  block.append(line, element(doc, "p", "org-coaching-confidence-rule",
    `Confidence rule: ${confidence.rule}.`));
  return block;
}

function provenanceBlock(doc, provenance) {
  const block = element(doc, "p", "org-coaching-provenance");
  block.setAttribute("role", "note");
  block.setAttribute("aria-label", "Sample provenance");
  block.append(
    shapeSpan(doc, "▣"),
    element(doc, "strong", "org-coaching-provenance-label", provenance.label),
    element(doc, "span", "org-coaching-provenance-detail",
      `${provenance.detail} · ${provenance.local}`),
  );
  if (provenance.files?.length) {
    block.append(element(doc, "span", "org-coaching-provenance-files",
      `Selected ${provenance.files.length === 1 ? "file" : "files"}: `
      + provenance.files.join(", ")));
  }
  return block;
}

/**
 * One number and one next action, both composed upstream.
 *
 * The number is the share of this corpus the multi-family classifier placed;
 * the action names the residue cluster holding the most coverage back. Neither
 * string is written here — this module formats nothing and computes nothing —
 * and the tier sentence beside the number is the published coverage rule.
 */
function coverageBlock(doc, coverage) {
  const block = element(doc, "div", "org-coaching-coverage");
  block.dataset.available = String(coverage.available);
  const line = element(doc, "p", "org-coaching-coverage-line");
  line.append(shapeSpan(doc, coverage.showGrade ? "◧" : "◇"),
    element(doc, "span", "org-coaching-coverage-text", coverage.text));
  block.append(line, element(doc, "p", "org-coaching-coverage-rule", coverage.rule));
  // Visible text, in the flow, never a title attribute: a corrected reading has
  // to say so where the number is read. It is absent at zero labels rather than
  // printed as "0", and the unassisted figure rides with it so a reader can
  // always see what the import earned on its own.
  if (coverage.leadLabels) {
    const marker = element(doc, "div", "org-coaching-coverage-lead");
    marker.dataset.leadLabels = String(coverage.leadLabels.count);
    marker.append(
      element(doc, "p", "org-coaching-coverage-marker", coverage.leadLabels.marker),
      element(doc, "p", "org-coaching-coverage-unassisted", coverage.leadLabels.unassisted),
    );
    block.append(marker);
  }
  block.append(element(doc, "p", "org-coaching-coverage-action", coverage.action));
  return block;
}

function actionBlock(doc, action) {
  const block = element(doc, "div", "org-coaching-action");
  block.dataset.available = String(action.available);
  const text = element(doc, "p", "org-coaching-action-text");
  text.append(shapeSpan(doc, action.available ? "▶" : "◇"),
    element(doc, "span", "org-coaching-action-title", action.title));
  block.append(
    // An h3, not a styled paragraph: this section's own title is an h2, so the
    // action joins the document outline a heading list actually reaches.
    element(doc, "h3", "eyebrow", "Prioritized department action"),
    text,
    element(doc, "p", "org-coaching-action-detail", action.detail),
    element(doc, "p", "org-coaching-action-basis", action.basis),
    element(doc, "p", "org-coaching-action-money", action.money),
  );
  return block;
}

// --- progressive disclosure -------------------------------------------------

function disclosureList(doc, section, state) {
  const list = element(doc, "div", "org-coaching-disclosures");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "Check this reading");
  for (const disclosure of state.disclosures) {
    list.append(disclosureBlock(doc, section, disclosure));
  }
  return list;
}

function disclosureBlock(doc, section, disclosure) {
  const store = held(section);
  const expanded = store.open.has(disclosure.id);
  const wrap = element(doc, "div", "org-coaching-disclosure");
  wrap.dataset.disclosure = disclosure.id;

  const toggle = element(doc, "button", "org-coaching-disclosure-toggle");
  toggle.id = toggleId(disclosure.id);
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", panelId(disclosure.id));
  toggle.append(
    element(doc, "span", "org-coaching-disclosure-question", disclosure.question),
    // The count is the reader's reason to open it. Hidden from assistive tech
    // only where it would repeat the row count they are about to hear.
    element(doc, "span", "org-coaching-disclosure-chip", disclosure.chip),
  );
  toggle.addEventListener("click", () => {
    if (expanded) store.open.delete(disclosure.id); else store.open.add(disclosure.id);
    section.dataset.focusTarget = toggleId(disclosure.id);
    paint(doc, section);
  });

  const panel = element(doc, "div", "org-coaching-disclosure-panel");
  panel.id = panelId(disclosure.id);
  panel.hidden = !expanded;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", disclosure.question);
  // Built only when open. A hidden panel holding forty rows is forty nodes a
  // screen reader's element search still walks past.
  if (expanded) {
    panel.append(rowList(doc, disclosure));
    // The control rides with the rows that named the residue, in the same panel.
    if (disclosure.review) panel.append(residueReviewList(doc, section, disclosure.review));
  }
  wrap.append(toggle, panel);
  return wrap;
}

// --- the residue review control ---------------------------------------------
//
// A real list, a real heading, and one real `<select>` per cluster, each with a
// real `<label for>` naming the cluster it belongs to. Nothing here is a div
// with a role: a keyboard user gets the platform's own listbox behaviour and a
// screen-reader user gets "Assign a class to 6 rows sharing model x" rather than
// the sixth "Class" on the page.

function residueReviewList(doc, section, review) {
  const wrap = element(doc, "div", "org-coaching-residue");
  const heading = element(doc, "h4", "org-coaching-residue-heading", review.heading);
  heading.id = "org-coaching-residue-heading";
  wrap.append(heading, element(doc, "p", "org-coaching-residue-intro", review.intro));
  if (review.marker) {
    wrap.append(element(doc, "p", "org-coaching-residue-marker", review.marker));
  }
  // No rows means nothing to review, and an empty list with a caption reads as a
  // control that failed rather than as a corpus with no residue.
  if (!review.rows.length) return wrap;

  const list = element(doc, "ul", "org-coaching-residue-list");
  list.setAttribute("aria-labelledby", heading.id);
  review.rows.forEach((row, index) => list.append(residueRow(doc, section, review, row, index)));
  wrap.append(list);
  return wrap;
}

function residueRow(doc, section, review, row, index) {
  const store = held(section);
  const item = element(doc, "li", "org-coaching-residue-item");
  item.dataset.cluster = String(index);
  item.dataset.assigned = row.assigned;

  const description = element(doc, "p", "org-coaching-residue-description", row.description);
  const share = element(doc, "p", "org-coaching-residue-share",
    `${row.amount} · ${row.percent} of the scored denominator · ${row.points}`);

  // The accessible name carries the cluster, so no two controls on this page
  // share one. It is visually hidden because the description is already visible
  // in the row above it and reading it twice is noise, not redundancy.
  const label = element(doc, "label", "visually-hidden",
    `Assign a class to ${row.description}`);
  label.id = residueLabelId(index);
  label.setAttribute("for", residueSelectId(index));

  const select = element(doc, "select", "org-coaching-residue-select");
  select.id = residueSelectId(index);
  for (const option of review.options) {
    const node = element(doc, "option", null, option.label);
    node.setAttribute("value", option.value);
    if (option.value === row.assigned) node.setAttribute("selected", "");
    select.append(node);
  }
  select.value = row.assigned;
  // On committed change only — a `<select>` fires `change` when the reader
  // settles on a value, not per arrow key in an open listbox, which is exactly
  // the granularity the live region should announce at.
  select.addEventListener("change", (event) => {
    if (!store.recompute) return;
    store.labels = { ...store.labels, [row.key]: String(event?.target?.value ?? select.value) };
    store.model = store.recompute(store.labels);
    section.dataset.focusTarget = residueSelectId(index);
    paint(doc, section);
  });

  item.append(description, share, label, select);
  return item;
}

function rowList(doc, disclosure) {
  const rows = element(doc, "dl", "org-coaching-rows");
  rows.setAttribute("aria-label", disclosure.question);
  for (const row of disclosure.rows) {
    const term = element(doc, "dt", "org-coaching-row-term", row.term);
    if (row.gradeable === false) term.dataset.gradeable = "false";
    if (row.gradeable === true) term.dataset.gradeable = "true";
    rows.append(term, element(doc, "dd", "org-coaching-row-detail", row.detail));
  }
  return rows;
}
