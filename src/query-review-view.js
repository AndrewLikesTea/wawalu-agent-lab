// The review-and-correct panel, painted.
//
// CONTAINMENT IS THE WHOLE DESIGN. Every string that came out of a reader's own
// export reaches this page through `textContent` and through nothing else: there
// is no `innerHTML`, no `insertAdjacentHTML`, no template string that becomes
// markup, and no attribute built out of prompt text. A query reading
// `<img src=x onerror=alert(1)>` is twenty-eight visible characters here, not an
// element and not a handler. Nothing in this module fetches, and nothing it
// renders can cause a fetch.
//
// The one identifier derived per row is the select's `id`, and it is built from
// the override key (`row-<n>`), never from the query text.
//
// This module decides no figure. The grade, the coverage, the recoverable
// dollars, the provenance count and the next action all arrive already computed
// by the override model; what happens here is layout, wording of the slots the
// model does not own, and the two events that send a reviewer's choice back.

const ids = Object.freeze({
  panel: "query-review",
  open: "query-review-open",
  intro: "query-review-intro",
  rows: "query-review-rows",
  figures: "query-review-figures",
  provenance: "query-review-provenance",
  revert: "query-review-revert",
  live: "query-review-live",
});

/** The value that means "no correction on this row". Never a rubric key. */
export const NO_CORRECTION = "";

/** The words the panel owns. Authored once so the panel and its tests agree. */
export const REVIEW_COPY = Object.freeze({
  open: "Review a sample of your own queries",
  close: "Hide the query review",
  agree: "Agree with the classifier",
  relabel: "Your label for this query",
  noCorrection: "Not reviewed",
  declined: "The classifier assigned no class to this query.",
  revert: "Go back to the classifier's own labels",
  reverted: "Your corrections were set aside. These are the classifier's own numbers.",
});

const text = (node, value) => { if (node) node.textContent = value ?? ""; };

const money = (value) => (Number.isFinite(value)
  ? `$${Math.round(value).toLocaleString("en-US")}` : "not published");

function element(document, tagName, className, content) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

/**
 * One reviewable row: the query as inert text, what the classifier read out of
 * it, and the two controls that let a human agree or disagree.
 */
function renderRow(document, row, { labels, selected, onCorrect }) {
  const item = element(document, "li", "query-review-row");
  item.dataset.key = row.key;
  item.dataset.classified = row.classified ? "true" : "false";

  // The reader's own text. `textContent`, wrapping, and no attribute carries it.
  const quote = element(document, "p", "query-review-text", row.text);
  quote.dataset.role = "query-text";
  item.append(quote);

  const read = element(document, "p", "query-review-read");
  read.append(element(document, "span", "query-review-class",
    row.classified ? `Classifier: ${row.categoryLabel}` : REVIEW_COPY.declined));
  // The matched token, published by the classifier rather than cut from the
  // query. A refusal has no token, so it says why instead of showing an empty
  // pair of quotation marks.
  read.append(element(document, "span", "query-review-signal",
    row.signal ? `Matched signal: “${row.signal}”` : `No signal matched: ${row.reason ?? "no rule fired"}`));
  item.append(read);

  const controlId = `query-review-label-${row.key}`;
  if (row.classified) {
    const agree = element(document, "button", "query-review-agree", REVIEW_COPY.agree);
    agree.type = "button";
    agree.setAttribute("aria-describedby", controlId);
    agree.addEventListener("click", () => onCorrect(row.key, row.category));
    item.append(agree);
  }

  const label = element(document, "label", "query-review-label", REVIEW_COPY.relabel);
  label.setAttribute("for", controlId);
  item.append(label);

  const select = element(document, "select", "query-review-select");
  select.id = controlId;
  select.dataset.key = row.key;
  // Exactly the model's own label set, plus the one value that means no
  // correction. A control offering anything else could hand the model a label it
  // would then discard without saying so.
  const options = [{ key: NO_CORRECTION, label: REVIEW_COPY.noCorrection }, ...labels];
  for (const choice of options) {
    const option = element(document, "option", null, choice.label);
    option.setAttribute("value", choice.key);
    select.append(option);
  }
  select.value = selected.get(row.key) ?? NO_CORRECTION;
  select.addEventListener("change", (event) => onCorrect(row.key, event?.target?.value ?? select.value));
  item.append(select);
  return item;
}

/**
 * Paint the panel, or take it off the page.
 *
 * @param model `{ available, sample, grade, composite, coverage, recoverableSpend,
 *   included, provenance, nextAction, labels, selected, announcement }` — every
 *   figure already computed by the override model.
 * @param handlers `{ onCorrect, onRevert }`. Both are called with what the reader
 *   chose; neither is given a figure to recompute.
 * @returns frozen `{ available, rows, included }`, so a caller can assert on what
 *   was painted without re-reading the document.
 */
export function renderQueryReview(document, model = null, handlers = {}) {
  const panel = document.getElementById(ids.panel);
  const open = document.getElementById(ids.open);
  if (!panel || !open) return Object.freeze({ available: false, rows: 0, included: 0 });

  const available = Boolean(model?.available && model.sample?.rows?.length);
  open.hidden = !available;
  if (!available) {
    panel.hidden = true;
    open.setAttribute("aria-expanded", "false");
    document.getElementById(ids.rows)?.replaceChildren();
    text(document.getElementById(ids.live), "");
    return Object.freeze({ available: false, rows: 0, included: 0 });
  }

  const { sample, labels = [], selected = new Map() } = model;
  const onCorrect = typeof handlers.onCorrect === "function" ? handlers.onCorrect : () => {};

  text(document.getElementById(ids.intro),
    `${sample.rows.length} of the ${sample.total} queries your export left unclassified, drawn the same `
    + "way every time. Agreeing or relabelling one moves the figures below. Nothing here leaves this tab.");

  const list = document.getElementById(ids.rows);
  if (list) {
    list.replaceChildren();
    for (const row of sample.rows) list.append(renderRow(document, row, { labels, selected, onCorrect }));
  }

  // The figures, in the live region's own paragraph so a change is announced once
  // rather than once per slot.
  const figures = document.getElementById(ids.figures);
  const grade = model.grade ? `Grade ${model.grade}` : "Not yet gradeable";
  const coverage = Number.isFinite(model.coverage)
    ? `${Math.round(model.coverage * 100)}% of your rows classified` : "no rows classified";
  const recoverable = `Recoverable: ${money(model.recoverableSpend)}`;
  const action = model.nextAction
    ? `Next: ${model.nextAction.action} (${model.nextAction.label}, ${money(model.nextAction.recoverableUsd)})`
    : "Next: nothing recoverable in this mix yet.";
  if (figures) {
    figures.replaceChildren(
      element(document, "span", "query-review-figure", grade),
      element(document, "span", "query-review-figure", coverage),
      element(document, "span", "query-review-figure", recoverable),
      element(document, "span", "query-review-action", action),
    );
  }

  const provenance = document.getElementById(ids.provenance);
  if (provenance) {
    provenance.hidden = !model.provenance;
    text(provenance, model.provenance ?? "");
  }
  const revert = document.getElementById(ids.revert);
  if (revert) {
    revert.hidden = !model.included;
    revert.textContent = REVIEW_COPY.revert;
  }
  // Announced, not just repainted: a figure that moves under a reader who is not
  // looking at it is a figure they never learn changed.
  text(document.getElementById(ids.live),
    model.announcement ?? `${grade}. ${coverage}. ${recoverable}. ${model.provenance ?? "Classifier labels only."}`);

  return Object.freeze({ available: true, rows: sample.rows.length, included: model.included ?? 0 });
}

/**
 * Wire the disclosure and the revert control. Called once; the panel's contents
 * are repainted by `renderQueryReview` on every correction.
 */
export function bindQueryReview(document, { onRevert = () => {} } = {}) {
  const open = document.getElementById(ids.open);
  const panel = document.getElementById(ids.panel);
  const revert = document.getElementById(ids.revert);
  if (open && panel) {
    open.setAttribute("aria-controls", ids.panel);
    open.setAttribute("aria-expanded", "false");
    open.addEventListener("click", () => {
      const expanded = open.getAttribute("aria-expanded") !== "true";
      open.setAttribute("aria-expanded", expanded ? "true" : "false");
      panel.hidden = !expanded;
      open.textContent = expanded ? REVIEW_COPY.close : REVIEW_COPY.open;
    });
  }
  revert?.addEventListener("click", () => onRevert());
  return Object.freeze({ bound: Boolean(open && panel) });
}
