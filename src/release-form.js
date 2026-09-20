// Release recorder: the form that writes a release and links the decisions
// behind it.
//
// Split the same way releases.js is: a pure, DOM-free core (field validation,
// selection state, summary copy) that is unit tested without a browser, and a
// rendering layer below it. Data sourcing stays in releases-data.js and the
// page wiring in releases-page.js, so this module can be mounted anywhere a
// release has to be recorded.
//
// Persistence contract: none is invented here. A recorded release is exactly
// the shape isRelease() in releases.js already accepts and shiplog-import.js
// already validates — id, version, createdAt, decisionIds, plus the optional
// title/description/owner/status those modules carry through. Nothing new is
// stored, so an export/import round trip of a recorded release is the same
// round trip the example records already survive.
//
// The multi-select is a native checkbox group on purpose. A custom listbox
// would have to re-implement focus, typeahead, and the announcement of each
// option's state; checkboxes get all of that from the platform, stay operable
// with a screen reader in forms mode, and remain a single Tab stop per option
// in a group a user can also reach by clicking its label.

import { canonicalDecisionStatus } from "./decision-status.js";
import { RELEASE_STATUSES, decisionRationalePreview, releaseStatus, releaseTitle } from "./releases.js";

// Mirror the form's maxlength attributes so a value written straight through
// this core (a test, a future importer) is bounded the same way the form is.
export const MAX_VERSION_LENGTH = 40;
export const MAX_RELEASE_TITLE_LENGTH = 120;
export const MAX_RELEASE_DESCRIPTION_LENGTH = 1000;
export const MAX_RELEASE_OWNER_LENGTH = 80;

// Where the empty state sends someone who has nothing to link yet: the decision
// recorder on the decisions page, not the page's top.
export const RECORD_DECISION_HREF = "/#decision-form";
export const DECISION_PICKER_LOADING_TEXT = "Loading decisions to link…";
// The status line beside the picker says the same state in different words. The
// visible placeholder inside the picker already reads "Loading decisions to
// link…"; repeating it here stacks two identical sentences in the form and
// tells a screen-reader user the same thing twice.
export const DECISION_PICKER_LOADING_STATUS_TEXT = "No decisions can be linked until the list loads.";

// The third state of this control, and the one it used to be unable to draw.
// loadDecisions() turns a store that refused the read into an empty array, so a
// failure arrived here dressed as "you have not recorded any decisions yet" —
// with a "Record a decision" link offering to add one to a log that could not be
// read. These four sentences keep the two apart: the heading states the failure,
// the body says what it does and does not mean for the records already stored,
// the status line says why nothing can be ticked, and the retrying line is what
// the same panel says while it reads again.
export const DECISION_PICKER_FAILED_TEXT = "Couldn’t load decisions to link";
export const DECISION_PICKER_FAILED_BODY = "This browser’s decision log could not be read, so there is nothing to choose from here. Your saved decisions have not been changed, and this release can still be recorded without linking any.";
export const DECISION_PICKER_FAILED_STATUS_TEXT = "No decisions can be linked: the decision log could not be read.";
export const DECISION_PICKER_RETRYING_BODY = "Reading this browser’s decision log again.";
export const DECISION_PICKER_RETRY_LABEL = "Retry loading decisions";

export const RELEASE_FORM_ERRORS = {
  required: "A release needs a version, an owner, a status, a release date, and a summary.",
  // What a submit the browser itself refused leaves behind. The native bubble
  // names the one field it stopped on and then disappears; this stays on the
  // page, so a recorder who dismissed it — or never saw it — is not left with a
  // form that simply did nothing. Worded for every native rejection this form
  // can raise (a required field left empty, a date that is not a real calendar
  // day, a value past its maximum length) rather than guessing which one fired.
  incomplete: "This release was not recorded. Complete every required field in the format its hint describes, then record the release again.",
  length: "A release field exceeds its maximum length.",
  invalidDate: "A release date must be a real calendar day written as YYYY-MM-DD.",
  unknownDecision: "A decision you linked is no longer in this log. Review the linked decisions and record the release again.",
};

// `<input type="date">` yields a calendar day, never an instant. It is stored as
// that day's UTC midnight so one recorded release has one unambiguous
// `createdAt` no matter which timezone recorded it — the list ordering, the
// export comparator, and the detail view all read that single field.
//
// The regex alone would accept a well-formed but unreal day (2026-02-31, which
// Date rolls forward to March 3), so the parse is round-tripped: a value that
// does not come back out as it went in is rejected rather than silently moved.
const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function releaseDateToIso(day) {
  const value = String(day ?? "").trim();
  if (!RELEASE_DATE_PATTERN.test(value)) return null;
  const iso = `${value}T00:00:00.000Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== iso) return null;
  return iso;
}

// Selection state is an ordered, de-duplicated list of decision ids, kept apart
// from the DOM for two reasons: a re-render (new data arriving, an error state
// redrawn) must not silently drop what the user picked, and the order the user
// chose is the association order the release detail view then preserves.
export function toggleDecisionSelection(selected = [], id, checked) {
  const current = [...new Set(selected)];
  const wanted = checked === undefined ? !current.includes(id) : checked === true;
  if (!wanted) return current.filter((value) => value !== id);
  // Re-ticking something already ticked leaves its position alone: the order is
  // the association order, and it should not shuffle under a stray event.
  return current.includes(id) ? current : [...current, id];
}

// Drop ids that no longer resolve. Used when fresh data replaces the offered
// decisions, so a stale tick cannot survive as a dangling reference — the same
// treatment createRelease() gives an id it cannot resolve at submit time.
export function pruneSelection(selected = [], decisions = []) {
  const known = new Set(decisions.map(({ id }) => id));
  return [...new Set(selected)].filter((id) => known.has(id));
}

// What is linked, and — once anything is — which of those decisions governs the
// release. It is the first ticked (see toggleDecisionSelection: the selection
// keeps the order it was chosen in, and the detail view reads the head of that
// order back). Saying so here is how the recorder chooses it: the summary is a
// live region, so the answer is announced as the choice is made without moving
// focus out of the checkbox group.
//
// "Linked decision" is the one user-facing name for this relationship: the
// field's hint above says it, this summary says it, and the release detail view
// heads the section it renders for the first one with it.
export function selectionSummaryText(count, total, governingTitle = "") {
  if (total === 0) return "No decisions are available to link yet.";
  if (count === 0) return `No decisions linked yet. ${total} available.`;
  const linked = `${count} of ${total} ${total === 1 ? "decision" : "decisions"} linked.`;
  const governing = typeof governingTitle === "string" ? governingTitle.trim() : "";
  return governing === "" ? linked : `${linked} “${governing}” is the first linked decision.`;
}

// Build the record. Throws a TypeError carrying one of RELEASE_FORM_ERRORS so
// the caller can report it inline instead of writing a record it would then
// have to walk back. Every id is checked against the decisions that exist right
// now: a release must not be stored naming a decision this log cannot show.
//
// This function is the single validation boundary for a recorded release. The
// form's `required` attributes and `maxlength`s mirror the rules below, but
// they are a convenience for the person typing, not the contract: every rule is
// re-checked here, so a caller that bypasses the markup (a test, a future
// importer, a paste into the console) cannot write a record the views and the
// export schema would then have to tolerate.
export function createRelease(values = {}, options = {}) {
  const version = String(values.version ?? "").trim();
  const title = String(values.title ?? "").trim();
  const description = String(values.description ?? "").trim();
  const owner = String(values.owner ?? "").trim();
  const status = String(values.status ?? "");
  const releasedOn = String(values.releasedOn ?? "").trim();

  // A release is a dated, described, attributed event or it is not a record
  // worth keeping: the summary answers "what shipped" on every surface that
  // lists it, and the date is what every one of them orders by.
  if (!version || !owner || !description || !releasedOn || !RELEASE_STATUSES.includes(status)) {
    throw new TypeError(RELEASE_FORM_ERRORS.required);
  }
  if (version.length > MAX_VERSION_LENGTH || title.length > MAX_RELEASE_TITLE_LENGTH
      || description.length > MAX_RELEASE_DESCRIPTION_LENGTH || owner.length > MAX_RELEASE_OWNER_LENGTH) {
    throw new TypeError(RELEASE_FORM_ERRORS.length);
  }
  const createdAt = releaseDateToIso(releasedOn);
  if (!createdAt) throw new TypeError(RELEASE_FORM_ERRORS.invalidDate);

  const known = new Set((options.decisions ?? []).map(({ id }) => id));
  const decisionIds = [...new Set(values.decisionIds ?? [])].map(String);
  // Linking is optional: releases can be recorded before their supporting
  // decisions exist. Any id that is selected must still resolve, so the log
  // never invents a relationship it cannot show.
  if (decisionIds.some((id) => !known.has(id))) throw new TypeError(RELEASE_FORM_ERRORS.unknownDecision);

  const release = {
    id: options.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    version,
    description,
    owner,
    status,
    createdAt,
    decisionIds,
  };
  // Title stays optional: an absent field and an empty string are the same
  // state, and one of them is not worth storing on every record. The list and
  // detail views already fall back to the version.
  if (title) release.title = title;
  return release;
}

// What was just written, named the way the log names it everywhere else.
//
// Three facts, all read back off the stored record rather than off the fields
// that produced it: which release (releaseTitle — the title if one was given,
// the version otherwise, exactly as the row and the detail view head it), which
// status it was filed under, and what it carried. A recorder who picked
// "Planned" has to be told the log holds a planned release, because that is the
// one field whose effect is invisible in the sentence otherwise — and because
// the row this sentence announces badges that status a moment later.
export function recordedSummaryText(release) {
  const count = release.decisionIds.length;
  const linked = count === 0
    ? "no linked decisions"
    : `${count} linked ${count === 1 ? "decision" : "decisions"}`;
  return `Recorded “${releaseTitle(release)}” as a ${releaseStatus(release)} release, with ${linked}.`;
}

// ---------------------------------------------------------------------------
// Rendering layer. Every field is written through textContent / text nodes —
// never HTML strings — so a stored decision title can never execute
// (PRODUCT.md: no user-generated HTML).
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// One option. The label names the decision; its identifier, status, and owner
// are described by the row so a screen reader hears them with the checkbox
// instead of having to leave the group to find out what it is ticking.
function renderOption(decision, index, checked) {
  const item = el("li", "decision-picker-option");
  // Render-local ids keep arbitrary stored decision ids out of ARIA IDREFs.
  const inputId = `release-decision-${index}`;
  const metaId = `release-decision-meta-${index}`;

  const input = document.createElement("input");
  input.className = "decision-picker-check";
  input.type = "checkbox";
  input.id = inputId;
  input.setAttribute("name", "decisionIds");
  input.setAttribute("value", decision.id);
  input.setAttribute("aria-describedby", metaId);
  input.dataset.decisionId = decision.id;
  // The property, deliberately not the attribute: the attribute is the value a
  // native form reset restores to, and a reset must clear the selection rather
  // than restore whatever was ticked when the group was last drawn.
  if (checked) input.checked = true;

  const label = el("label", "decision-picker-label", decision.title);
  label.setAttribute("for", inputId);

  const meta = el("span", "decision-picker-meta");
  meta.id = metaId;
  const status = canonicalDecisionStatus(decision.status);
  meta.append(el("span", `badge badge-${status}`, status));
  const owner = el("span", "decision-picker-owner");
  owner.append(el("span", "decision-picker-meta-label", "Owner"));
  owner.append(document.createTextNode(decision.owner ?? "Unknown"));
  meta.append(owner);
  const identifier = el("span", "decision-picker-identifier");
  identifier.append(el("span", "decision-picker-meta-label", "ID"));
  identifier.append(el("code", undefined, decision.id));
  meta.append(identifier);
  // The rationale is part of the option's description rather than a separate
  // stop: choosing which decision governs a release is a judgement about why it
  // was taken, and the recorder should not have to leave the form to read it.
  const rationale = el("span", "decision-picker-rationale");
  rationale.append(el("span", "decision-picker-meta-label", "Rationale"));
  rationale.append(document.createTextNode(decisionRationalePreview(decision)));
  meta.append(rationale);

  // Deliberately no "open this decision" link inside the option: it would put a
  // second tab stop between every checkbox and double the distance through a
  // group whose whole job is ticking boxes. The row already states the title,
  // status, owner, and id, and the release detail view links each decision once
  // the release exists.
  item.append(input, label, meta);
  return item;
}

// Nothing to link yet. Recording a decision is useful but not a prerequisite
// for recording the release, so this state offers the route without presenting
// the picker as a dead end.
function renderPickerEmpty() {
  const empty = el("div", "decision-picker-empty");
  empty.append(el("p", "decision-picker-empty-title", "No decisions to link yet."));
  empty.append(el("p", undefined, "You can record this release now, or record a decision and come back to link it later."));
  const action = el("a", "empty-action decision-picker-empty-action", "Record a decision");
  action.href = RECORD_DECISION_HREF;
  empty.append(action);
  return empty;
}

function renderPickerLoading() {
  const loading = el("div", "decision-picker-empty decision-picker-loading");
  loading.append(el("p", "decision-picker-empty-title", DECISION_PICKER_LOADING_TEXT));
  // The adjacent status is the single announcement source. This visible copy
  // keeps the state clear without making a screen reader repeat the sentence.
  loading.setAttribute("aria-hidden", "true");
  return loading;
}

// The failure, and the one way out of it. Unlike the other two unavailable
// states this one holds a focusable control, so it is NOT aria-hidden: a Retry
// inside a hidden subtree is a button a screen-reader user cannot reach.
//
// The chip is a filled wash because the state it names is a dynamic one, per the
// chip rule in design-system/claude-design/review-08-foundations.html
// ("filled wash = dynamic signal, outline = static classification"). It carries
// the word as well as the wash, so the state is never told by colour alone, and
// it is a div rather than a p so the panel's paragraph rule does not overwrite
// the chip's own type and spacing. Both classes already ship in styles.css.
function renderPickerFailed() {
  const failed = el("div", "decision-picker-empty decision-picker-failed");
  failed.append(el("div", "detail-state-chip detail-state-chip-error", "Failed"));
  failed.append(el("p", "decision-picker-empty-title", DECISION_PICKER_FAILED_TEXT));
  failed.append(el("p", "decision-picker-failed-body", DECISION_PICKER_FAILED_BODY));
  const action = el("button", "empty-action decision-picker-empty-action decision-picker-retry-action", DECISION_PICKER_RETRY_LABEL);
  action.type = "button";
  action.dataset.action = "retry-decisions";
  action.setAttribute("aria-controls", "release-decisions");
  failed.append(action);
  return failed;
}

// Put the failed panel into `failed` or `retrying` WITHOUT replacing it.
//
// Retry is the control under the reader's finger at the moment it runs, and a
// re-render would remove that button from under their focus — in a real browser
// focus would fall to the body and would not come back when the next failure
// drew a moment later. So the panel is built once and only its words change:
// the same button node survives both outcomes. This is the rule the log's own
// status region follows, in miniature.
function paintPickerUnavailable(container, kind) {
  let panel = container.querySelector(".decision-picker-failed");
  if (!panel) {
    panel = renderPickerFailed();
    container.replaceChildren(panel);
  }
  const retrying = kind === "retrying";
  const chip = panel.querySelector(".detail-state-chip");
  // Both washes are filled: loading, retrying and failed are all dynamic states.
  chip.className = `detail-state-chip detail-state-chip-${retrying ? "missing" : "error"}`;
  chip.textContent = retrying ? "Retrying" : "Failed";
  panel.querySelector(".decision-picker-empty-title").textContent = retrying
    ? DECISION_PICKER_LOADING_TEXT
    : DECISION_PICKER_FAILED_TEXT;
  panel.querySelector(".decision-picker-failed-body").textContent = retrying
    ? DECISION_PICKER_RETRYING_BODY
    : DECISION_PICKER_FAILED_BODY;
  return container;
}

export function renderDecisionPicker(container, decisions = [], selected = [], state = "loaded") {
  const chosen = new Set(selected);

  // The two unavailable states render no options at all — not a greyed list, not
  // a list that silently ignores clicks. There is nothing to tick because there
  // is nothing the page can honestly offer to link, and `aria-disabled` says so
  // to a reader who is navigating the group rather than looking at it.
  if (state === "failed" || state === "retrying") {
    container.setAttribute("aria-disabled", "true");
    return paintPickerUnavailable(container, state);
  }

  container.replaceChildren();

  if (state === "loading") {
    container.setAttribute("aria-disabled", "true");
    container.append(renderPickerLoading());
    return container;
  }

  container.removeAttribute("aria-disabled");

  if (decisions.length === 0) {
    container.append(renderPickerEmpty());
    return container;
  }

  const list = el("ul", "decision-picker-options");
  decisions.forEach((decision, index) => {
    list.append(renderOption(decision, index, chosen.has(decision.id)));
  });
  container.append(list);
  return container;
}

// Mount the picker over a container and own its selection state. The returned
// API is what the page wiring drives: read the selection when submitting, hand
// it fresh decisions when the data changes, and clear it after a save.
export function mountDecisionPicker(container, options = {}) {
  let decisions = options.decisions ?? [];
  let state = ["loading", "failed", "retrying"].includes(options.state) ? options.state : "loaded";
  let selected = pruneSelection(options.selected ?? [], decisions);
  const summary = options.summary ?? null;

  const governingTitle = () => {
    const first = selected[0];
    const decision = decisions.find(({ id }) => id === first);
    return typeof decision?.title === "string" ? decision.title : "";
  };

  // The group's one announcement. It is the live region the fieldset names in
  // `aria-describedby`, so each state is spoken once, on the transition into it,
  // rather than on every keystroke that re-renders the list.
  const STATUS_TEXT = {
    loading: DECISION_PICKER_LOADING_STATUS_TEXT,
    retrying: DECISION_PICKER_LOADING_STATUS_TEXT,
    failed: DECISION_PICKER_FAILED_STATUS_TEXT,
  };

  const syncSummary = () => {
    if (!summary) return;
    summary.textContent = STATUS_TEXT[state]
      ?? selectionSummaryText(selected.length, decisions.length, governingTitle());
  };

  const render = () => {
    renderDecisionPicker(container, decisions, selected, state);
    syncSummary();
  };

  // Delegated to the container so the handler survives every re-render without
  // re-binding, and so a checkbox added by fresh data is live immediately.
  container.addEventListener("change", (event) => {
    const check = event.target.closest?.(".decision-picker-check");
    if (!check) return;
    selected = toggleDecisionSelection(selected, check.dataset.decisionId, check.checked === true);
    syncSummary();
    options.onChange?.(selected);
  });

  // Delegated for the same reason: the panel is repainted around this button
  // between attempts, and a handler bound to the node would have to be rebound
  // every time it was.
  container.addEventListener("click", (event) => {
    if (!event.target.closest?.(".decision-picker-retry-action")) return;
    options.onRetry?.();
  });

  render();

  return {
    selectedIds: () => [...selected],
    setDecisions(next = []) {
      decisions = next;
      state = "loaded";
      selected = pruneSelection(selected, decisions);
      render();
    },
    setLoading() {
      state = "loading";
      render();
    },
    // The wait a Retry states, in the panel Retry lives in. Kept apart from
    // setLoading() because the two are drawn differently on purpose: the first
    // load has no control to preserve, a retry is standing on one.
    setRetrying() {
      state = "retrying";
      render();
    },
    setFailed() {
      state = "failed";
      render();
    },
    state: () => state,
    clear() {
      selected = [];
      render();
    },
    focus() {
      container.querySelector(".decision-picker-check")?.focus?.();
      return true;
    },
  };
}
