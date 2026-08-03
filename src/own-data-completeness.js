/**
 * One finding about incompleteness on the own-data path (#1009).
 *
 * The own-data path used to ask a reader six separate questions about what was
 * missing — evidence preflight, recognition confidence, intake confidence,
 * gradability, brief completeness, circulation readiness — each with its own
 * heading and its own meter, all at the same volume. A reader scanning them
 * could not tell which gap actually stopped them sending the brief. The reader
 * has ONE question, and this module answers it: what is still missing before I
 * can send this brief?
 *
 * Nothing is deleted. Every scorer named above still computes, still renders its
 * own detail, provenance and confidence, and is reachable from the disclosure
 * this module paints. Only the ordering of attention changed.
 *
 * Two rules this module keeps because they are load-bearing elsewhere:
 *
 * 1. NOTHING here is a live region. This page announces through one region plus
 *    the import control's own reason line, and a second announcer would make
 *    every import speak twice.
 * 2. The integers are in the DOM text, never in a bar width alone. A share
 *    carried only by a painted bar is a number a screen reader, a greyscale
 *    screenshot and a stylesheet that failed to load all lose.
 */

/**
 * The state one slot's input is in, from the point of view of the scorer that
 * reads it.
 *
 * `unrecognized` is deliberately NOT folded into `absent`: an unmapped
 * department and a missing org mapping are fixed by different actions, and a
 * reader told "absent" about a file they already imported stops trusting the
 * count. Only `filled` counts toward the numerator.
 */
export const SLOT_INPUT_STATE = Object.freeze({
  filled: "filled",
  absent: "absent",
  unrecognized: "unrecognized",
});

/** The word a gap says. Read by a screen reader, kept by a screenshot. */
export const GAP_WORD = Object.freeze({
  [SLOT_INPUT_STATE.absent]: "absent",
  [SLOT_INPUT_STATE.unrecognized]: "unrecognized",
});

/**
 * THE SLOT LIST. One entry per named, individually-fillable input that at least
 * one existing scorer reads, deduplicated BY THE INPUT and not by the scorer:
 * the spend export is read by four scorers and is one slot.
 *
 * The length of this list is the denominator, and it is constant for a given
 * import shape — it does not shrink as slots fill. Nothing derives the count
 * from a meter percentage.
 *
 * Declared order is presentation order and is also the tie-break for the
 * priority ranking below, so the chosen action never depends on the iteration
 * order of an object or a set.
 *
 * `control` is the id of a real element on /evolution.html that closes the gap.
 * `absent` and `unrecognized` are the gap sentence for each state; a slot whose
 * input cannot be unrecognized declares no `unrecognized` wording.
 */
export const COMPLETENESS_SLOTS = Object.freeze([
  Object.freeze({
    id: "spend-export",
    label: "Provider spend export",
    control: "local-finops-files",
    absent: "No provider spend export has been read in this tab, so there is no brief to send yet.",
    unrecognized: "A file was read but no importer recognized it as a provider spend export.",
  }),
  Object.freeze({
    id: "department-mapping",
    label: "Department names on the spend",
    control: "add-optional-file",
    absent: "The spend has no department column, so the brief cannot say which department the money went to.",
    unrecognized: "The spend carries a grouping column this workspace could not map to your departments.",
  }),
  Object.freeze({
    id: "department-classification",
    label: "Workload category for each department",
    control: "score-classify",
    absent: "No department has been classified, so the literacy letter stays withheld.",
    unrecognized: "Some imported departments are still unclassified, so the literacy letter covers only part of the spend.",
  }),
  Object.freeze({
    id: "conversation-export",
    label: "Conversation export",
    control: "local-finops-files",
    absent: "No conversation export has been read, so the brief carries no AI literacy grade.",
  }),
  Object.freeze({
    id: "cohort-facts",
    label: "Organization size band and industry",
    control: "local-cohort-band",
    absent: "This import has not been placed in a peer cohort, so the brief cannot state a rank.",
  }),
  Object.freeze({
    id: "comparison-period",
    label: "A second, equal-length billing period",
    control: "local-finops-files",
    absent: "Only one period was read, so the brief cannot say whether spend moved.",
  }),
]);

/**
 * THE PRIORITY ORDER, ranked by how much a gap blocks circulation — a gap that
 * makes the brief uncirculatable outranks one that merely weakens it — and NOT
 * by how many slots or scorers the gap touches.
 *
 * Read down: with no spend export there is no brief at all; with no department
 * names the brief cannot make its central claim; without a conversation export
 * the literacy half is withheld; classification is only a partial stand-in for
 * that export; a missing cohort withholds the rank; a missing second period
 * withholds the movement. Ties are impossible — this is a total order over the
 * slot ids — and any slot omitted here falls to the end in slot-list order.
 */
export const COMPLETENESS_PRIORITY = Object.freeze([
  "spend-export",
  "department-mapping",
  "conversation-export",
  "department-classification",
  "cohort-facts",
  "comparison-period",
]);

/**
 * The six scorers that used to be top-level questions here, in the order to
 * open them. Each keeps its own region, its own detail, its own provenance and
 * its own confidence; this list is how a reader reaches them from the one
 * finding above.
 */
export const COMPLETENESS_SCORERS = Object.freeze([
  Object.freeze({ id: "evidence-preflight", label: "Evidence preflight", target: "own-data-preflight-question",
    question: "Can this export support a trustworthy department-spend decision?" }),
  Object.freeze({ id: "recognition-confidence", label: "Recognition confidence", target: "export-recognition-title",
    question: "How confident is this workspace that it recognized the export?" }),
  Object.freeze({ id: "intake-confidence", label: "Intake confidence", target: "intake-confidence",
    question: "How much of the export was read, and how sure is that reading?" }),
  Object.freeze({ id: "gradability", label: "Gradability", target: "finops-answer-question",
    question: "Is our AI spend classification trustworthy enough to act on?" }),
  Object.freeze({ id: "brief-completeness", label: "Brief completeness", target: "finops-brief-completeness",
    question: "Which slots of the brief were filled from the reader's own import?" }),
  Object.freeze({ id: "circulation-readiness", label: "Circulation readiness", target: "briefing-readiness-question",
    question: "Is this analysis ready to circulate?" }),
]);

/** What the reader does next when nothing is missing. One control, on this page. */
export const COMPLETE_SENTENCE =
  "Nothing is missing: every input this brief is scored from has been read and recognized.";
export const COMPLETE_ACTION = Object.freeze({
  text: "Export this briefing and circulate it",
  control: "export-local-json",
});

const priorityRank = (id) => {
  const rank = COMPLETENESS_PRIORITY.indexOf(id);
  return rank === -1 ? COMPLETENESS_PRIORITY.length : rank;
};

/**
 * Resolve the declared slots against what the page found.
 *
 * `states` maps a slot id to one of SLOT_INPUT_STATE. An id the caller says
 * nothing about is `absent`, because a slot nobody could fill is a slot the
 * reader still has to fill. An unknown state word is treated as `absent` too:
 * this count may never round a gap up into a fill.
 */
export function completenessSlotStates(states = {}) {
  return Object.freeze(COMPLETENESS_SLOTS.map((slot) => {
    const declared = states?.[slot.id];
    const state = declared === SLOT_INPUT_STATE.filled ? SLOT_INPUT_STATE.filled
      : declared === SLOT_INPUT_STATE.unrecognized && slot.unrecognized ? SLOT_INPUT_STATE.unrecognized
        : SLOT_INPUT_STATE.absent;
    return Object.freeze({
      ...slot,
      state,
      filled: state === SLOT_INPUT_STATE.filled,
      word: state === SLOT_INPUT_STATE.filled ? "" : GAP_WORD[state],
      gap: state === SLOT_INPUT_STATE.filled ? "" : (slot[state] ?? slot.absent),
    });
  }));
}

/**
 * The whole finding: how many slots are filled out of how many, every gap, and
 * the ONE action that closes the biggest of them.
 *
 * `total` is the slot list's length and never the count of anything measured.
 */
export function assessOwnDataCompleteness(states = {}) {
  const slots = completenessSlotStates(states);
  const unfilled = slots.filter((slot) => !slot.filled);
  const ranked = [...unfilled].sort((left, right) => priorityRank(left.id) - priorityRank(right.id));
  const next = ranked[0] ?? null;
  return Object.freeze({
    slots,
    total: COMPLETENESS_SLOTS.length,
    filled: slots.length - unfilled.length,
    unfilled: Object.freeze(ranked),
    complete: unfilled.length === 0,
    action: next
      ? Object.freeze({ slotId: next.id, text: next.gap, label: next.label, control: next.control })
      : COMPLETE_ACTION,
  });
}

/**
 * Move focus to the control an action names.
 *
 * Scrolling near a control is not following a link: a reader who pressed Enter
 * on "classify your departments" has to arrive ON the picker. A target that is
 * not natively focusable is given `tabindex="-1"` first, which makes it
 * programmatically focusable without adding it to anyone's tab order.
 */
export function focusCompletenessTarget(document, id) {
  const target = document?.getElementById?.(id);
  if (!target) return null;
  // Queried one tag at a time, in this order, rather than as one grouped
  // selector: the control a reader is sent to fill in is a field before it is a
  // button, and a single grouped selector is the one form a document stub and a
  // browser can disagree about.
  const focusable = ["select", "input", "textarea", "button", "a"]
    .map((tag) => target.querySelector?.(tag) ?? null).find(Boolean) ?? null;
  const node = focusable ?? target;
  if (!focusable && !node.getAttribute?.("tabindex")) node.setAttribute?.("tabindex", "-1");
  node.scrollIntoView?.({ block: "center" });
  node.focus?.();
  return node;
}

const setText = (document, id, text) => {
  const node = document?.getElementById?.(id);
  if (node) node.textContent = text;
  return node;
};

/**
 * Paint the one finding block.
 *
 * Every node written to is authored in the document, so this writes text and
 * attributes and never creates or removes a region — a region that arrives with
 * its own content is a region no assistive technology was told about. The list
 * items inside the two disclosures are the exception, and they are inside a
 * static container that ships with the page.
 */
export function renderOwnDataCompleteness(document, model) {
  const root = document?.getElementById?.("own-data-completeness");
  if (!root) return model;
  root.dataset.state = model.complete ? "complete" : "incomplete";
  root.dataset.filled = String(model.filled);
  root.dataset.total = String(model.total);

  setText(document, "own-data-completeness-filled", String(model.filled));
  setText(document, "own-data-completeness-total", String(model.total));
  const meter = document.getElementById("own-data-completeness-meter");
  if (meter) {
    meter.dataset.share = String(Math.round((model.filled / model.total) * 100));
    // The bar is a fourth channel over the integers, the state word and the
    // data attribute — never the only one carrying the share.
    if (meter.style) meter.style.width = `${(model.filled / model.total) * 100}%`;
  }

  const lead = document.getElementById("own-data-completeness-lead");
  if (lead) {
    lead.textContent = model.complete
      ? COMPLETE_SENTENCE
      : `${model.unfilled.length} input${model.unfilled.length === 1 ? " is" : "s are"} still missing. `
        + "Closing the one below moves this brief the furthest.";
  }

  const action = document.getElementById("own-data-completeness-action");
  const link = document.getElementById("own-data-completeness-action-link");
  if (action) action.dataset.state = model.complete ? "complete" : "incomplete";
  if (link) {
    link.textContent = model.complete
      ? COMPLETE_ACTION.text
      : `${model.action.label} — ${model.action.text}`;
    link.setAttribute("href", `#${model.action.control}`);
    link.dataset.control = model.action.control;
  }

  const gaps = document.getElementById("own-data-completeness-gaps");
  if (gaps) {
    // The complete state renders NO gap list — not an empty one. A checklist
    // with nothing in it reads as a checklist that failed to load.
    gaps.replaceChildren(...model.unfilled.map((slot) => {
      const item = document.createElement("li");
      item.className = "own-data-completeness-gap";
      item.dataset.slot = slot.id;
      item.dataset.reason = slot.state;
      const name = document.createElement("strong");
      name.textContent = `${slot.label} · ${slot.word}`;
      const why = document.createElement("span");
      why.textContent = slot.gap;
      item.append(name, why);
      return item;
    }));
    gaps.hidden = model.complete;
  }
  const gapsWrap = document.getElementById("own-data-completeness-gaps-detail");
  if (gapsWrap) gapsWrap.hidden = model.complete;
  return model;
}

/**
 * Paint the scorer index inside the disclosure.
 *
 * Each entry names the scorer, the question it answers, and links to the region
 * that still renders its detail, its provenance and its confidence. This is the
 * "nothing was deleted" half of the consolidation, and it is painted once.
 */
export function renderCompletenessScorers(document) {
  const list = document?.getElementById?.("own-data-completeness-scorer-list");
  if (!list) return COMPLETENESS_SCORERS;
  list.replaceChildren(...COMPLETENESS_SCORERS.map((scorer) => {
    const item = document.createElement("li");
    item.dataset.scorer = scorer.id;
    const link = document.createElement("a");
    link.className = "own-data-completeness-scorer-link";
    link.setAttribute("href", `#${scorer.target}`);
    link.dataset.control = scorer.target;
    link.textContent = scorer.label;
    const question = document.createElement("span");
    question.textContent = scorer.question;
    item.append(link, question);
    return item;
  }));
  return COMPLETENESS_SCORERS;
}

/**
 * Wire every in-block link so following it lands focus on the control, once.
 *
 * One delegated listener on the block rather than one per link: the action link
 * is repainted on every import and a per-link listener would have to be rebound
 * each time, which is how a link quietly stops working.
 */
export function bindOwnDataCompleteness(document) {
  const root = document?.getElementById?.("own-data-completeness");
  if (!root || root.dataset.bound === "true") return false;
  root.dataset.bound = "true";
  root.addEventListener("click", (event) => {
    const target = event?.target ?? null;
    const link = target?.closest?.("a[data-control]")
      ?? (target?.dataset?.control ? target : null);
    if (!link) return;
    const id = link.dataset.control;
    if (!id) return;
    event.preventDefault?.();
    focusCompletenessTarget(document, id);
  });
  return true;
}
