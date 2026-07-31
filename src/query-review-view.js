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

// THE LIST IS ONE TAB STOP. Twenty-five rows, each with two controls, is fifty
// Tab presses between the panel and whatever follows it, and a reviewer who
// corrects row 12 and is dropped back at row 1 has lost their place. So the list
// is an ARIA `grid` under a roving tabindex: exactly one row carries
// `tabindex="0"`, the arrows move it, and every control inside a row is reached
// with Left/Right rather than with Tab. `grid` rather than `listbox` because a
// row holds two operable things — the agree button and the relabel select — and
// an `option` may hold neither.
//
// ANNOUNCEMENTS ARE CONSOLIDATED, NOT PER ROW. The live region below is written
// only when the caller hands this module an `announcement`; a correction on its
// own repaints silently, and the row's own state chip — part of the row's
// accessible name — is what changes under the reader's focus. One message at the
// end of a pass beats twenty-five interruptions during it.

const ids = Object.freeze({
  panel: "query-review",
  open: "query-review-open",
  intro: "query-review-intro",
  position: "query-review-position",
  positionItem: "query-review-position-item",
  positionDone: "query-review-position-done",
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
  agreed: "Agreed",
  corrected: "Corrected",
  unreviewed: "Still unclassified",
});

/**
 * The three states a row can be in, as words.
 *
 * The word is the first carrier and the chip's silhouette is the second — a
 * dashed outline for the classification that has not moved, a filled wash for
 * the two a human just produced, and a left rule on the corrected one. Colour is
 * the third, so the three stay apart in greyscale, in forced colours, and for a
 * reader who never sees the chip at all: the word is inside the row's own
 * accessible name.
 */
export const REVIEW_STATE = Object.freeze({
  agreed: REVIEW_COPY.agreed,
  corrected: REVIEW_COPY.corrected,
  unreviewed: REVIEW_COPY.unreviewed,
});

/**
 * Which of the three a row is in, decided from the correction the model holds
 * rather than from anything the view painted earlier.
 */
export function reviewRowState(row, selected = new Map()) {
  const chosen = selected?.get?.(row.key) ?? null;
  if (!chosen) return "unreviewed";
  return row.classified && chosen === row.category ? "agreed" : "corrected";
}

/**
 * The one message a completed or abandoned pass earns: how many corrections were
 * folded in, and the figure they moved. Never fired per row.
 */
export function reviewPassSummary(count = 0, { grade = null, coverage = null } = {}) {
  const applied = `${count} correction${count === 1 ? "" : "s"} applied`;
  const headline = grade ? `Grade ${grade}` : "Not yet gradeable";
  const share = Number.isFinite(coverage) ? `, ${Math.round(coverage * 100)}% of your rows classified` : "";
  return `${applied}. ${headline}${share}.`;
}

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
 * it, the state a human has left it in, and the two controls that move it.
 *
 * The row is a `grid` row and its own tab stop candidate. Its accessible name is
 * composed with `aria-labelledby` out of nodes this module filled through
 * `textContent` — position, then the query, then the state chip and the
 * classifier's reading — so the reader's own text reaches the name the same way
 * it reaches the screen and NO attribute is ever built out of it. The ids that
 * do the composing come from the override key (`row-<n>`), never from the query.
 */
function renderRow(document, row, { labels, selected, onCorrect, index, total }) {
  const item = element(document, "li", "query-review-row");
  const state = reviewRowState(row, selected);
  const position = index + 1;
  item.id = `query-review-row-${row.key}`;
  item.dataset.key = row.key;
  item.dataset.classified = row.classified ? "true" : "false";
  item.dataset.state = state;
  item.setAttribute("role", "row");
  // Roving: every row ships out of focus order and exactly one is promoted below.
  item.setAttribute("tabindex", "-1");
  item.setAttribute("aria-rowindex", String(position));
  item.setAttribute("aria-posinset", String(position));
  item.setAttribute("aria-setsize", String(total));
  const ref = {
    position: `query-review-pos-${row.key}`,
    text: `query-review-text-${row.key}`,
    read: `query-review-read-${row.key}`,
    state: `query-review-state-${row.key}`,
  };
  item.setAttribute("aria-labelledby", `${ref.position} ${ref.text} ${ref.read}`);

  const cell = element(document, "div", "query-review-cell");
  cell.setAttribute("role", "gridcell");

  // The count a screen reader hears on the row itself, so the position is
  // available whether or not the visible indicator below the intro is read.
  const posted = element(document, "span", "visually-hidden", `Item ${position} of ${total}`);
  posted.id = ref.position;
  cell.append(posted);

  // The reader's own text. `textContent`, wrapping, and no attribute carries it.
  const quote = element(document, "p", "query-review-text", row.text);
  quote.id = ref.text;
  quote.dataset.role = "query-text";
  cell.append(quote);

  const read = element(document, "p", "query-review-read");
  read.id = ref.read;
  const chip = element(document, "span", "query-review-state", REVIEW_STATE[state]);
  chip.id = ref.state;
  chip.dataset.state = state;
  read.append(chip);
  read.append(element(document, "span", "query-review-class",
    row.classified ? `Classifier: ${row.categoryLabel}` : REVIEW_COPY.declined));
  // The matched token, published by the classifier rather than cut from the
  // query. A refusal has no token, so it says why instead of showing an empty
  // pair of quotation marks.
  read.append(element(document, "span", "query-review-signal",
    row.signal ? `Matched signal: “${row.signal}”` : `No signal matched: ${row.reason ?? "no rule fired"}`));
  cell.append(read);
  item.append(cell);

  const actions = element(document, "div", "query-review-actions");
  actions.setAttribute("role", "gridcell");
  const controlId = `query-review-label-${row.key}`;
  if (row.classified) {
    const agree = element(document, "button", "query-review-agree", REVIEW_COPY.agree);
    agree.type = "button";
    agree.id = `query-review-agree-${row.key}`;
    agree.setAttribute("tabindex", "-1");
    agree.setAttribute("aria-describedby", controlId);
    agree.addEventListener("click", () => onCorrect(row.key, row.category));
    actions.append(agree);
  }

  const label = element(document, "label", "query-review-label", REVIEW_COPY.relabel);
  label.setAttribute("for", controlId);
  actions.append(label);

  const select = element(document, "select", "query-review-select");
  select.id = controlId;
  select.dataset.key = row.key;
  select.setAttribute("tabindex", "-1");
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
  actions.append(select);
  item.append(actions);
  return item;
}

const rowsIn = (list) => [...list.querySelectorAll(".query-review-row")];

/** Keep the moved row on screen without animating it at anyone who asked not to. */
function revealRow(node) {
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? true;
  node.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
}

/** "Item N of M", updated as the active row moves. Not a live region: see below. */
function paintPosition(document, active, total) {
  const line = document.getElementById(ids.position);
  if (!line) return;
  line.hidden = !active;
  text(document.getElementById(ids.positionItem),
    active ? `Item ${active.getAttribute("aria-posinset")} of ${total}` : "");
}

/** Move the one tab stop, and the focus with it. */
function setActiveRow(document, list, next) {
  if (!next) return;
  const rows = rowsIn(list);
  for (const node of rows) node.setAttribute("tabindex", node === next ? "0" : "-1");
  next.focus();
  revealRow(next);
  paintPosition(document, next, rows.length);
}

const STEP = Object.freeze({ ArrowDown: 1, ArrowUp: -1 });

/**
 * The grid's keyboard, delegated to the list so a repaint cannot lose it.
 *
 * `preventDefault` is called on the keys this handler actually consumes and on
 * no others, so Arrow keys inside the list never scroll the page and every key
 * it does not claim — Tab out, typing into the select, Enter on the button —
 * still does what the platform does. The one deliberate exception is Up/Down on
 * the relabel select: those belong to the select, because they ARE the
 * correction, so the handler steps aside.
 */
function onListKey(document, list, event) {
  const target = event.target;
  const row = target?.closest?.(".query-review-row");
  if (!row || !target.closest?.(`#${ids.rows}`)) return;
  const onRow = target === row;
  const isSelect = target.tagName === "SELECT";
  const key = event.key;

  if (key === "ArrowDown" || key === "ArrowUp") {
    if (!onRow && isSelect) return;
    const rows = rowsIn(list);
    const at = rows.indexOf(row);
    event.preventDefault();
    setActiveRow(document, list, rows[Math.min(rows.length - 1, Math.max(0, at + STEP[key]))]);
    return;
  }
  if (onRow && (key === "Home" || key === "End")) {
    const rows = rowsIn(list);
    event.preventDefault();
    setActiveRow(document, list, key === "Home" ? rows[0] : rows.at(-1));
    return;
  }
  if (key === "ArrowRight" || key === "ArrowLeft") {
    // Along the row: the row itself, then every control in it, in DOM order.
    const stops = [row, ...row.querySelectorAll("button,select")];
    const at = stops.indexOf(target);
    if (at === -1) return;
    event.preventDefault();
    stops[Math.min(stops.length - 1, Math.max(0, at + (key === "ArrowRight" ? 1 : -1)))]?.focus();
    return;
  }
  if (key === "Escape" && !onRow) {
    event.preventDefault();
    row.focus();
  }
}

/** Bound once per list element, and idempotent, because the rows are repainted. */
function bindRoving(document, list) {
  if (list.dataset.roving === "bound") return;
  list.dataset.roving = "bound";
  list.addEventListener("keydown", (event) => onListKey(document, list, event));
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
    // Empty (no sample drawn) and error (nothing loaded) are the same drawn
    // state: the panel leaves the page and takes its tab stop with it. Nothing
    // focusable and no `tabindex="0"` is left behind to trap anyone, and the
    // indicator is hidden rather than reading "Item 0 of 0".
    panel.hidden = true;
    open.setAttribute("aria-expanded", "false");
    document.getElementById(ids.rows)?.replaceChildren();
    const line = document.getElementById(ids.position);
    if (line) line.hidden = true;
    text(document.getElementById(ids.positionItem), "");
    text(document.getElementById(ids.positionDone), "");
    text(document.getElementById(ids.live), "");
    return Object.freeze({ available: false, rows: 0, included: 0, labelled: 0, complete: false });
  }

  const { sample, labels = [], selected = new Map() } = model;
  const onCorrect = typeof handlers.onCorrect === "function" ? handlers.onCorrect : () => {};

  text(document.getElementById(ids.intro),
    `${sample.rows.length} of the ${sample.total} queries your export left unclassified, drawn the same `
    + "way every time. Agreeing or relabelling one moves the figures below. Nothing here leaves this tab.");

  const total = sample.rows.length;
  const labelled = sample.rows.filter((row) => reviewRowState(row, selected) !== "unreviewed").length;
  const list = document.getElementById(ids.rows);
  if (list) {
    // What focus was on before this repaint, by id rather than by node: a
    // correction repaints the whole list from inside the control that made it,
    // so the node the reader was standing on is about to be discarded. The id is
    // stable across the render, the detached clone is not.
    const wasInside = Boolean(document.activeElement?.closest?.(`#${ids.rows}`));
    const focusedId = wasInside ? document.activeElement.id : null;
    // Where focus is beats where the tab stop was. A reviewer who clicked into
    // row 12 with a mouse, or landed there any way other than the arrow keys,
    // is standing on row 12; promoting it here is what stops the repaint from
    // sending them back to the top of the list.
    const focusedKey = wasInside
      ? document.activeElement.closest(".query-review-row")?.dataset.key ?? null : null;
    const activeKey = focusedKey
      ?? rowsIn(list).find((node) => node.getAttribute("tabindex") === "0")?.dataset.key ?? null;

    list.setAttribute("role", "grid");
    list.setAttribute("aria-rowcount", String(total));
    list.replaceChildren();
    sample.rows.forEach((row, index) => list.append(
      renderRow(document, row, { labels, selected, onCorrect, index, total })));

    const rows = rowsIn(list);
    const active = rows.find((node) => node.dataset.key === activeKey) ?? rows[0];
    active?.setAttribute("tabindex", "0");
    paintPosition(document, active, total);
    text(document.getElementById(ids.positionDone),
      labelled >= total ? `All ${total} reviewed` : `${labelled} of ${total} reviewed`);
    bindRoving(document, list);
    // Focus lands back where it was — the same control, or failing that the row
    // that owned it — and `focus()` alone brings it into view, so nothing is
    // scrolled away from under a reader who never moved.
    if (wasInside) (document.getElementById(focusedId) ?? active)?.focus();
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
  // Announced only when the caller has one message to make. A correction on its
  // own repaints in silence: the row's state chip is inside its accessible name
  // and the reader's focus is already on it, so the change is heard without the
  // region speaking, and twenty-five of them do not become twenty-five
  // interruptions. The region itself is authored in the document and is never
  // replaced here — one inserted at announce time is routinely missed.
  if (typeof model.announcement === "string" && model.announcement) {
    text(document.getElementById(ids.live), model.announcement);
  }

  return Object.freeze({
    available: true, rows: total, included: model.included ?? 0,
    labelled, complete: labelled >= total,
  });
}

/**
 * Wire the disclosure and the revert control. Called once; the panel's contents
 * are repainted by `renderQueryReview` on every correction.
 */
export function bindQueryReview(document, { onRevert = () => {}, onLeave = () => {} } = {}) {
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
      // Leaving the pass earns the same one consolidated message finishing it
      // does, so a reviewer who stops halfway still hears what they moved.
      if (!expanded) onLeave();
    });
  }
  revert?.addEventListener("click", () => onRevert());
  return Object.freeze({ bound: Boolean(open && panel) });
}
