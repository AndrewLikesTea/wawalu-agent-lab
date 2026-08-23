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
import { RELEASE_STATUSES, decisionRationalePreview } from "./releases.js";

// Mirror the form's maxlength attributes so a value written straight through
// this core (a test, a future importer) is bounded the same way the form is.
export const MAX_VERSION_LENGTH = 40;
export const MAX_RELEASE_TITLE_LENGTH = 120;
export const MAX_RELEASE_DESCRIPTION_LENGTH = 1000;
export const MAX_RELEASE_OWNER_LENGTH = 80;

// Where the empty state sends someone who has nothing to link yet: the decision
// recorder on the decisions page, not the page's top.
export const RECORD_DECISION_HREF = "/#decision-form";

export const RELEASE_FORM_ERRORS = {
  required: "A release needs a version, an owner, a status, a release date, and a summary.",
  length: "A release field exceeds its maximum length.",
  invalidDate: "A release date must be a real calendar day written as YYYY-MM-DD.",
  unknownDecision: "A selected decision is no longer in this log. Review the selection and record the release again.",
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
// "Governing decision" is the one name for this concept: the field's hint above
// says it, this summary says it, and the release detail view heads the section
// it renders for that decision with it.
export function selectionSummaryText(count, total, governingTitle = "") {
  if (total === 0) return "No decisions are available to link yet.";
  if (count === 0) return `No decisions linked yet. ${total} available.`;
  const linked = `${count} of ${total} ${total === 1 ? "decision" : "decisions"} linked.`;
  const governing = typeof governingTitle === "string" ? governingTitle.trim() : "";
  return governing === "" ? linked : `${linked} “${governing}” is the governing decision.`;
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

export function recordedSummaryText(release) {
  const count = release.decisionIds.length;
  const linked = count === 0
    ? "no linked decisions"
    : `${count} linked ${count === 1 ? "decision" : "decisions"}`;
  return `Recorded ${release.version} with ${linked}.`;
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

export function renderDecisionPicker(container, decisions = [], selected = []) {
  container.replaceChildren();
  const chosen = new Set(selected);

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
  let selected = pruneSelection(options.selected ?? [], decisions);
  const summary = options.summary ?? null;

  const governingTitle = () => {
    const first = selected[0];
    const decision = decisions.find(({ id }) => id === first);
    return typeof decision?.title === "string" ? decision.title : "";
  };

  const syncSummary = () => {
    if (summary) summary.textContent = selectionSummaryText(selected.length, decisions.length, governingTitle());
  };

  const render = () => {
    renderDecisionPicker(container, decisions, selected);
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

  render();

  return {
    selectedIds: () => [...selected],
    setDecisions(next = []) {
      decisions = next;
      selected = pruneSelection(selected, decisions);
      render();
    },
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
