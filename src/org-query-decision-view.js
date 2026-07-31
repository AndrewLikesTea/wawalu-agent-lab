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
import { residueProgressText } from "./residue-labeling.js";

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
/** The row itself, which is what the roving tab stop moves between. */
export const residueItemId = (rank) => `org-coaching-residue-item-${rank}`;
/** The row's visible name and its visible state chip, in that order. */
export const residueNameId = (rank) => `org-coaching-residue-name-${rank}`;
export const residueStateId = (rank) => `org-coaching-residue-state-${rank}`;

/** The list itself, and the visible "Item N of M" line above it. */
export const RESIDUE_LIST_ID = "org-coaching-residue-list";
export const RESIDUE_PROGRESS_ID = "org-coaching-residue-progress";

/** The one control that erases what this browser kept. Inside the same panel. */
export const RESIDUE_CLEAR_ID = "org-coaching-residue-clear";

/**
 * Elements whose own keys are theirs. The list's arrow handler steps aside for
 * every one of them, so ArrowDown in a `<select>` still opens and walks the
 * options rather than jumping the reader to the next cluster.
 */
const COMPOSITE_TAGS = new Set(["SELECT", "INPUT", "TEXTAREA", "BUTTON", "OPTION", "A"]);

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
      // The review pass: which cluster holds the list's single tab stop, whether
      // the paint about to run was caused by one label (and so must stay quiet),
      // and whether anything was labelled since the region last spoke.
      active: null, quiet: false, dirty: false,
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
  if (store.model?.provenance?.digest !== state.provenance?.digest) {
    store.open = new Set();
    // A different sample is a different list. The row the reader was standing in
    // does not exist in it, so the tab stop goes back to the first row.
    store.active = null;
    store.dirty = false;
  }
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
  store.active = null;
  store.quiet = false;
  store.dirty = false;
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
  //
  // THE ANNOUNCEMENT BUDGET. One label is not an announcement. A reader working
  // down twenty-five clusters would otherwise hear the whole coverage paragraph
  // twenty-five times, each one interrupting the row they are reading — so a
  // paint caused by a single label writes nothing here at all. The change
  // reaches them through the row instead: focus stays inside the row they just
  // answered and the row's accessible name carries its new state. What is owed
  // at the end of the pass is one sentence — how many corrections were applied
  // and the figure they produced — and it is written on the paint that ends the
  // pass: the last open cluster answered, the panel collapsed, or the labels
  // cleared. `announce` writes only on a real change, so that is one write and
  // one polite update, never a burst the reader's screen reader has to queue.
  const quiet = store.quiet && (review?.assist?.pending ?? 0) > 0;
  store.quiet = false;
  if (quiet) store.dirty = true;
  else {
    store.dirty = false;
    announce(doc, [state.announcement, review?.announcement, store.retention?.announcement]
      .filter(Boolean).join(" "));
  }

  // Focus is re-established by CLUSTER, not by position: the row a reader just
  // answered is the row they must still be standing in, even if a future ranking
  // moves it up the list under them.
  const cluster = section.dataset.focusCluster;
  if (cluster) {
    const part = section.dataset.focusPart;
    delete section.dataset.focusCluster;
    delete section.dataset.focusPart;
    const item = residueItemFor(doc, cluster);
    const target = part === "select" ? item?.querySelector(".org-coaching-residue-select") : item;
    if (target) target.focus?.();
  }
  const focusId = section.dataset.focusTarget;
  if (focusId) {
    delete section.dataset.focusTarget;
    byId(doc, focusId)?.focus?.();
  }
}

/** The rendered row for one cluster key, found by its own data rather than by rank. */
function residueItemFor(doc, key) {
  const list = byId(doc, RESIDUE_LIST_ID);
  if (!list) return null;
  return residueItems(list).find((row) => row.dataset.cluster === key) ?? null;
}

/** The rows of the list, as a real array in both a browser and the test harness. */
const residueItems = (list) => [...(list?.querySelectorAll(".org-coaching-residue-row") ?? [])];

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
    // Collapsing the panel IS leaving the pass. Whatever was labelled quietly
    // while it was open is summed up on the paint below, in one sentence.
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
    // finds nothing cannot tell "resolved" from "broken". The progress line is
    // drawn on this state too, and it says so in words rather than counting to
    // "Item 0 of 0" — a position in a list that does not exist.
    const progress = element(doc, "p", "org-coaching-residue-progress",
      residueProgressText(0, 0));
    progress.id = RESIDUE_PROGRESS_ID;
    parts.push(element(doc, "p", "org-coaching-residue-empty", review.empty), progress);
    return withRetention(doc, section, parts);
  }
  parts.push(element(doc, "p", "org-coaching-residue-cap", review.cap.text));

  // Where the reader is in the pass, in the panel and not only in the accessible
  // tree: "Item 12 of 25" beside a list of twenty-five is the difference between
  // a task with a shape and a scroll with no end. Meta type, not a heading — it
  // is on the panel's own caption size and muted ink, under the sentence that
  // introduces the list rather than over it.
  const store = held(section);
  const activeIndex = Math.max(0,
    review.rows.findIndex((row) => row.key === store.active));
  store.active = review.rows[activeIndex].key;
  const progress = element(doc, "p", "org-coaching-residue-progress",
    residueProgressText(activeIndex + 1, review.rows.length));
  progress.id = RESIDUE_PROGRESS_ID;

  const list = element(doc, "ul", "org-coaching-residue-list");
  list.id = RESIDUE_LIST_ID;
  // Declared rather than implied: `list-style:none` takes list semantics off a
  // `ul` in Safari, and the position each row publishes is only meaningful
  // inside a list that still calls itself one.
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", "Unclassified clusters, largest share first");
  for (const [index, row] of review.rows.entries()) {
    list.append(residueRow(doc, section, review, row, index === activeIndex));
  }
  list.addEventListener("keydown", (event) => residueKeydown(doc, section, event));
  parts.push(progress, list,
    element(doc, "p", "org-coaching-residue-ceiling", review.ceiling.text));
  return withRetention(doc, section, parts);
}

/**
 * The list's one tab stop, moved with the arrow keys.
 *
 * Roving tabindex, because the alternative on a twenty-five row list is
 * twenty-five tab stops between the panel and the control under it. Tab reaches
 * the row the reader left off at; the arrows move between rows; Tab from there
 * reaches that row's own `<select>`, and Tab again leaves the panel. The number
 * of stops the list adds to the page is fixed at two and does not grow with the
 * corpus.
 *
 * Traversal does NOT wrap. Home and End are the way to the ends, and ArrowDown
 * on the last row does nothing rather than silently teleporting a reader who
 * cannot see the list back to the top. The horizontal pair is accepted too
 * because the rows reflow to a row-per-line at narrow widths and to name-then-
 * control across the line at wide ones, so a reader may reasonably try either.
 */
function residueKeydown(doc, section, event) {
  const target = event.target;
  // A composite control owns its own keys. ArrowDown in the class `<select>`
  // walks its options; it does not move the reader to the next cluster.
  if (target && (COMPOSITE_TAGS.has(target.tagName) || target.isContentEditable)) return;
  const list = byId(doc, RESIDUE_LIST_ID);
  const rows = residueItems(list);
  if (!rows.length) return;
  const from = rows.findIndex((row) => row === target || row.contains?.(target));
  const at = from === -1 ? rows.findIndex((row) => row.getAttribute("tabindex") === "0") : from;
  let next = null;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(at + 1, rows.length - 1);
  else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(at - 1, 0);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = rows.length - 1;
  else return;
  event.preventDefault?.();
  moveResidueFocus(doc, section, rows, next);
}

/**
 * Move the tab stop and the focus together, without repainting the panel.
 *
 * A repaint would rebuild the node under the reader's own focus on every arrow
 * press. The four things that change on a move — two tabindex values, the row's
 * marker, and the visible position — are written in place instead.
 */
function moveResidueFocus(doc, section, rows, index) {
  const target = rows[index];
  if (!target) return;
  for (const row of rows) {
    const active = row === target;
    row.setAttribute("tabindex", active ? "0" : "-1");
    row.dataset.active = String(active);
    // The row's own control follows its row out of the tab order, so Tab past
    // the active row leaves the list instead of walking every remaining select.
    row.querySelector(".org-coaching-residue-select")?.setAttribute("tabindex", active ? "0" : "-1");
  }
  held(section).active = target.dataset.cluster;
  const progress = byId(doc, RESIDUE_PROGRESS_ID);
  // Not a live region: the position follows focus, and a screen reader already
  // reads `aria-posinset` when it lands on the row.
  if (progress) progress.textContent = residueProgressText(index + 1, rows.length);
  target.focus?.();
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

function residueRow(doc, section, review, row, active) {
  const store = held(section);
  const item = element(doc, "li", "org-coaching-residue-row");
  item.id = residueItemId(row.rank);
  item.dataset.cluster = row.key;
  item.dataset.assigned = row.assigned === "" ? "none" : row.assigned;
  item.dataset.state = row.state.key;
  item.dataset.active = String(active);
  item.setAttribute("role", "listitem");
  // Position, programmatically. `listitem` is the role that carries these; they
  // are not bolted onto a `div`, and the count is the list's own length rather
  // than the corpus's — the cap sentence above the list owns that difference.
  item.setAttribute("aria-posinset", String(row.rank));
  item.setAttribute("aria-setsize", String(review.rows.length));
  item.setAttribute("tabindex", active ? "0" : "-1");
  // The name a reader hears when focus lands here is the cluster AND its state,
  // composed from the two visible elements below rather than from a second copy
  // of their text: a row's state reaches assistive technology as words, not only
  // as a chip.
  item.setAttribute("aria-labelledby",
    `${residueNameId(row.rank)} ${residueStateId(row.rank)}`);

  const id = residueControlId(row.rank);
  const label = element(doc, "label", "org-coaching-residue-name", row.controlLabel);
  label.id = residueNameId(row.rank);
  label.setAttribute("for", id);

  const select = element(doc, "select", "org-coaching-residue-select");
  select.id = id;
  select.setAttribute("tabindex", active ? "0" : "-1");
  for (const choice of review.choices) {
    const option = element(doc, "option", null, choice.label);
    option.setAttribute("value", choice.value);
    if (choice.value === row.assigned) option.setAttribute("selected", "");
    select.append(option);
  }
  select.value = row.assigned;
  select.addEventListener("change", () => {
    // Focus returns to the control the reader was in — by cluster, so the row
    // they answered is the row they are still standing in even if the ranking
    // moves it. The whole decision repaints on a label, and a keyboard user who
    // lost their place after each assignment could not work down the list.
    store.active = row.key;
    store.quiet = true;
    section.dataset.focusCluster = row.key;
    section.dataset.focusPart = "select";
    store.onAssign?.(row.key, select.value);
  });

  // The state chip: a shape, a word, and — where there is one — the class the
  // reader chose. A filled wash because this is a live state rather than a
  // static classification, and never a tint on its own: delete the colour and
  // the row still reads "Not reviewed" against "Assigned: High-value".
  const state = element(doc, "p", "org-coaching-residue-state");
  state.id = residueStateId(row.rank);
  state.dataset.state = row.state.key;
  state.append(
    shapeSpan(doc, row.state.shape),
    element(doc, "span", "org-coaching-residue-state-text", `Assigned: ${row.assignedLabel}`),
  );

  item.append(
    label,
    select,
    element(doc, "p", "org-coaching-residue-detail", row.detail),
    state,
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
