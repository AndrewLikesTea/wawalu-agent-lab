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

/** The residue review's own disclosure, a sibling of the four above it. */
export const ORG_COACHING_RESIDUE_ID = "residue-review";

/** Toggle and panel ids, derived from the disclosure id so both agree. */
export const toggleId = (id) => `org-coaching-${id}-toggle`;
export const panelId = (id) => `org-coaching-${id}-panel`;
/** One select per cluster, named by the cluster's rank in the ranked list. */
export const residueControlId = (rank) => `org-coaching-residue-class-${rank}`;

/** The one control that erases what this browser kept. Inside the same panel. */
export const RESIDUE_CLEAR_ID = "org-coaching-residue-clear";

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
  if (!section.__orgCoaching) {
    section.__orgCoaching = {
      model: null, open: new Set(), review: null, onAssign: null, retention: null,
    };
  }
  return section.__orgCoaching;
}

/**
 * Paint the coaching decision, or leave the page in its example state.
 *
 * Returns the state that was painted so a caller can assert on what it asked for
 * rather than on the DOM it got.
 */
export function applyOrgQueryDecision(doc, state,
  { review = null, onAssign = null, retention = null } = {}) {
  const section = byId(doc, ORG_COACHING_SECTION_ID);
  if (!section || !state) return null;
  if (state.state === ORG_QUERY_DECISION_STATE.absent) return clearOrgQueryDecision(doc);
  const store = held(section);
  // A repaint of the same sample keeps the panels the reader opened. A different
  // sample does not: panels left open would be captioned for the old file.
  if (store.model?.provenance?.digest !== state.provenance?.digest) store.open = new Set();
  store.model = state;
  // The residue review and the callback that applies a label ride beside the
  // state rather than inside it: `org-query-decision.js` selects data and holds
  // no function, and a repaint this module triggers itself — opening a panel —
  // must not drop the control the reader was using.
  store.review = review;
  if (onAssign) store.onAssign = onAssign;
  // The retention descriptor is the page's, repainted on every call because the
  // notice it may carry is a live state: a browser that refuses a write says so
  // on the next paint rather than on the next import.
  store.retention = retention;
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
  // The lead's own labels go with the reading they qualified. Nothing here
  // outlives the import: the page drops the label map at the same moment.
  store.review = null;
  store.retention = null;
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

  const review = store.review;
  const blocks = [
    state.state === ORG_QUERY_DECISION_STATE.graded
      ? gradedLead(doc, state, review) : ungradeableLead(doc, state, review),
  ];
  // The coverage line rides with the lead, in the same block and under the same
  // heading, because it qualifies the answer above it: a reader who takes the
  // sentence must take the share of their own corpus it was read from with it.
  // Absent on a sample with no coverage result, rather than printed as a zero.
  if (state.coverage) blocks.push(coverageBlock(doc, state.coverage, review));
  blocks.push(actionBlock(doc, state.action), disclosureList(doc, section, state));
  body.replaceChildren(...blocks);
  // One polite region for the whole decision, and the recompute rides in it:
  // the sentence changes when coverage changes, so a reader who assigns a
  // cluster hears the new figure and any unlocked letter without hunting for
  // it. `announce` still writes only on a real change, so opening a panel is
  // silent.
  // The clear control's result rides in the same region rather than in one of
  // its own: it changes the figures above it, so it is the same kind of update.
  announce(doc, [state.announcement, review?.announcement, store.retention?.announcement]
    .filter(Boolean).join(" "));

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

/**
 * The lead-supplied-label marker, wherever an assisted figure is printed.
 *
 * Not a tooltip and not a footnote: a letter grade or a coverage share that
 * rests on the reader's own labels says so in the same block it is printed in,
 * with the count and with what the export earned alone. Absent — not empty —
 * when no label is applied, so an unassisted reading is exactly what it was.
 */
function assistMarker(doc, review) {
  if (!review?.assist?.applied) return null;
  const note = element(doc, "p", "org-coaching-assist");
  note.dataset.labelCount = String(review.assist.count);
  note.setAttribute("role", "note");
  note.setAttribute("aria-label", "Lead-supplied labels");
  note.append(shapeSpan(doc, "✎"),
    element(doc, "span", "org-coaching-assist-text", review.assist.marker));
  return note;
}

function gradedLead(doc, state, review) {
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
  );
  const marker = assistMarker(doc, review);
  if (marker) block.append(marker);
  block.append(confidenceBlock(doc, state.confidence), provenanceBlock(doc, state.provenance));
  return block;
}

function ungradeableLead(doc, state, review) {
  const block = element(doc, "div", "org-coaching-lead");
  block.dataset.gradeStatus = "ungradeable";
  const answer = element(doc, "p", "org-coaching-answer");
  answer.append(shapeSpan(doc, "◇"),
    element(doc, "span", "org-coaching-answer-text", state.answer));
  block.append(
    answer,
    element(doc, "p", "org-coaching-reason-label", state.reason.label),
    element(doc, "p", "org-coaching-reason-detail", state.reason.detail),
  );
  const marker = assistMarker(doc, review);
  if (marker) block.append(marker);
  block.append(confidenceBlock(doc, state.confidence), provenanceBlock(doc, state.provenance));
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
function coverageBlock(doc, coverage, review) {
  const block = element(doc, "div", "org-coaching-coverage");
  block.dataset.available = String(coverage.available);
  block.dataset.assisted = String(review?.assist?.applied === true);
  const line = element(doc, "p", "org-coaching-coverage-line");
  line.append(shapeSpan(doc, coverage.showGrade ? "◧" : "◇"),
    element(doc, "span", "org-coaching-coverage-text", coverage.text));
  block.append(
    line,
    element(doc, "p", "org-coaching-coverage-rule", coverage.rule),
    element(doc, "p", "org-coaching-coverage-action", coverage.action),
  );
  const marker = assistMarker(doc, review);
  if (marker) block.append(marker);
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
  // The one disclosure that is not read-only. It is a sibling of the four
  // above, in the same group and behind the same kind of toggle: a reader who
  // has just been told which cluster is holding coverage back reaches the
  // control that resolves it in the same interaction, and never in a modal, a
  // second panel, or another page.
  const review = held(section).review;
  if (review) list.append(residueBlock(doc, section, review));
  return list;
}

// --- the residue review -----------------------------------------------------
//
// The lead's own labels, applied a cluster at a time. Three rules:
//
//   1. **A native `<select>`, one per cluster.** Keyboard-operable, announced as
//      a combo box, and it refuses a value that is not one of its options —
//      which a custom listbox would have to be taught to do.
//   2. **The label IS the row's visible text.** One string names the cluster,
//      its share and its record count, so the control's accessible name, the
//      name a speech-control user says, and the name a sighted reader reads are
//      one string.
//   3. **Nothing here computes.** Every number and every sentence is composed by
//      `residue-labeling.js` off `familyCoverage`, so this surface cannot state
//      a coverage figure the decision above it disagrees with.

function residueBlock(doc, section, review) {
  const store = held(section);
  const expanded = store.open.has(ORG_COACHING_RESIDUE_ID);
  const wrap = element(doc, "div", "org-coaching-disclosure org-coaching-residue");
  wrap.dataset.disclosure = ORG_COACHING_RESIDUE_ID;
  wrap.dataset.assisted = String(review.assist.applied);

  const toggle = element(doc, "button", "org-coaching-disclosure-toggle");
  toggle.id = toggleId(ORG_COACHING_RESIDUE_ID);
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", panelId(ORG_COACHING_RESIDUE_ID));
  toggle.append(
    element(doc, "span", "org-coaching-disclosure-question", review.question),
    element(doc, "span", "org-coaching-disclosure-chip", review.chip),
  );
  toggle.addEventListener("click", () => {
    if (expanded) store.open.delete(ORG_COACHING_RESIDUE_ID);
    else store.open.add(ORG_COACHING_RESIDUE_ID);
    section.dataset.focusTarget = toggleId(ORG_COACHING_RESIDUE_ID);
    paint(doc, section);
  });

  const panel = element(doc, "div", "org-coaching-disclosure-panel");
  panel.id = panelId(ORG_COACHING_RESIDUE_ID);
  panel.hidden = !expanded;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", review.question);
  if (expanded) panel.append(...residueBody(doc, section, review));
  wrap.append(toggle, panel);
  return wrap;
}

function residueBody(doc, section, review) {
  const parts = [element(doc, "p", "org-coaching-residue-intro", review.intro)];
  const marker = assistMarker(doc, review);
  if (marker) parts.push(marker);
  if (review.assist.unclassifiableText) {
    parts.push(element(doc, "p", "org-coaching-residue-unclassifiable",
      review.assist.unclassifiableText));
  }
  if (review.empty) {
    // Zero residue is a state, not an empty panel: a reader who opens this and
    // finds nothing cannot tell "resolved" from "broken".
    parts.push(element(doc, "p", "org-coaching-residue-empty", review.empty));
    return withRetention(doc, section, parts);
  }
  parts.push(element(doc, "p", "org-coaching-residue-cap", review.cap.text));
  const list = element(doc, "ul", "org-coaching-residue-list");
  list.setAttribute("aria-label", "Unclassified clusters, largest share first");
  for (const row of review.rows) list.append(residueRow(doc, section, review, row));
  parts.push(list, element(doc, "p", "org-coaching-residue-ceiling", review.ceiling.text));
  return withRetention(doc, section, parts);
}

/**
 * What this browser keeps, and the one control that empties it.
 *
 * It sits at the foot of the panel the labels are made in — not in a second
 * panel and not in a dialog — because the reader checking the claim is the
 * reader using the control. Three parts, in reading order: what is kept in plain
 * words, a notice when this browser refused to keep it, and a real `button`,
 * keyboard-operable because it is a button. Present on an empty residue too: a
 * reviewer verifying the claim must be able to read it whatever the corpus did.
 */
function withRetention(doc, section, parts) {
  const retention = held(section).retention;
  if (!retention) return parts;
  const wrap = element(doc, "div", "org-coaching-residue-retention");
  wrap.dataset.storage = retention.notice ? "unavailable" : "available";
  wrap.append(element(doc, "p", "org-coaching-residue-retention-text", retention.text));
  if (retention.notice) {
    // A note, not an alert: the corrections still hold on screen, and the region
    // already announces the recompute they caused.
    const notice = element(doc, "p", "org-coaching-residue-retention-notice", retention.notice);
    notice.setAttribute("role", "note");
    wrap.append(notice);
  }
  const clear = element(doc, "button", "org-coaching-residue-clear", retention.clearLabel);
  clear.id = RESIDUE_CLEAR_ID;
  clear.setAttribute("type", "button");
  clear.addEventListener("click", () => {
    // Focus stays on the control, exactly as it does on the selects above: the
    // whole decision repaints, and this button is rebuilt with the panel.
    section.dataset.focusTarget = RESIDUE_CLEAR_ID;
    held(section).retention?.onClear?.();
  });
  wrap.append(clear);
  parts.push(wrap);
  return parts;
}

function residueRow(doc, section, review, row) {
  const store = held(section);
  const item = element(doc, "li", "org-coaching-residue-row");
  item.dataset.cluster = row.key;
  item.dataset.assigned = row.assigned === "" ? "none" : row.assigned;

  const id = residueControlId(row.rank);
  const label = element(doc, "label", "org-coaching-residue-name", row.controlLabel);
  label.setAttribute("for", id);

  const select = element(doc, "select", "org-coaching-residue-select");
  select.id = id;
  for (const choice of review.choices) {
    const option = element(doc, "option", null, choice.label);
    option.setAttribute("value", choice.value);
    if (choice.value === row.assigned) option.setAttribute("selected", "");
    select.append(option);
  }
  select.value = row.assigned;
  select.addEventListener("change", () => {
    // Focus returns to the control the reader was in: the whole decision
    // repaints on a label, and a keyboard user who lost their place after each
    // assignment could not work down the list.
    section.dataset.focusTarget = id;
    store.onAssign?.(row.key, select.value);
  });

  item.append(
    label,
    select,
    element(doc, "p", "org-coaching-residue-detail", row.detail),
    // The state in words as well as in the control, because a row a reader has
    // answered and a row they have not must differ by more than a tint.
    element(doc, "p", "org-coaching-residue-state", `Assigned: ${row.assignedLabel}`),
  );
  return item;
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
