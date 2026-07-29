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

function held(section) {
  if (!section.__orgCoaching) section.__orgCoaching = { model: null, open: new Set() };
  return section.__orgCoaching;
}

/**
 * Paint the coaching decision, or leave the page in its example state.
 *
 * Returns the state that was painted so a caller can assert on what it asked for
 * rather than on the DOM it got.
 */
export function applyOrgQueryDecision(doc, state) {
  const section = byId(doc, ORG_COACHING_SECTION_ID);
  if (!section || !state) return null;
  if (state.state === ORG_QUERY_DECISION_STATE.absent) return clearOrgQueryDecision(doc);
  const store = held(section);
  // A repaint of the same sample keeps the panels the reader opened. A different
  // sample does not: panels left open would be captioned for the old file.
  if (store.model?.provenance?.digest !== state.provenance?.digest) store.open = new Set();
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

  body.replaceChildren(
    state.state === ORG_QUERY_DECISION_STATE.graded
      ? gradedLead(doc, state) : ungradeableLead(doc, state),
    actionBlock(doc, state.action),
    disclosureList(doc, section, state),
  );
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
  if (expanded) panel.append(rowList(doc, disclosure));
  wrap.append(toggle, panel);
  return wrap;
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
