import { loadReleases, saveReleases } from "./releases.js";

export const RELEASE_DRAFT_KEY = "shiplog.release-draft.v1";
export const EMPTY_RELEASE_DRAFT = Object.freeze({ version: "", date: "", description: "", decisionIds: [] });
export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function loadReleaseDraft(storage) {
  try {
    const value = JSON.parse(storage.getItem(RELEASE_DRAFT_KEY) ?? "null");
    if (!value || typeof value !== "object") return { ...EMPTY_RELEASE_DRAFT };
    return {
      version: typeof value.version === "string" ? value.version : "",
      date: typeof value.date === "string" ? value.date : "",
      description: typeof value.description === "string" ? value.description : "",
      decisionIds: Array.isArray(value.decisionIds) ? value.decisionIds.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return { ...EMPTY_RELEASE_DRAFT };
  }
}

export function saveReleaseDraft(storage, draft) {
  storage.setItem(RELEASE_DRAFT_KEY, JSON.stringify(draft));
}

export function isValidDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateReleaseDraft(draft) {
  const errors = {};
  const version = draft.version.trim();
  if (!version) errors.version = "Enter a version number.";
  else if (!SEMVER_PATTERN.test(version)) errors.version = "Use semantic versioning, such as 1.0.0 or 2.1.0-beta.1.";
  if (!draft.date) errors.date = "Choose the release date.";
  else if (!isValidDateInput(draft.date)) errors.date = "Choose a valid calendar date.";
  if (!draft.decisionIds.length) errors.decisionIds = "Select at least one decision that informed this release.";
  return errors;
}

// Drop any decisionIds a restored draft carries that no longer exist in the
// current decision set (deleted, or saved against different browser data).
// Carrying them through to createRelease would mint a release with dangling
// references from birth — the exact broken state resolveRelease/missingIds is
// built to surface after the fact. Returns the same object reference when
// nothing changed so the caller can skip a needless re-persist.
export function reconcileDraftDecisions(draft, decisions) {
  const available = new Set((decisions ?? []).map((decision) => decision.id));
  const decisionIds = draft.decisionIds.filter((id) => available.has(id));
  return decisionIds.length === draft.decisionIds.length ? draft : { ...draft, decisionIds };
}

export function createRelease(draft, options = {}) {
  if (Object.keys(validateReleaseDraft(draft)).length) throw new TypeError("Release fields are invalid.");
  return {
    id: options.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    version: draft.version.trim(),
    description: draft.description.trim(),
    decisionIds: [...draft.decisionIds],
    status: "completed",
    createdAt: options.createdAt ?? `${draft.date}T12:00:00.000Z`,
  };
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function fieldError(field, message) {
  const error = document.querySelector(`#${field}-error`);
  const control = field === "decision-options"
    ? document.querySelector("#decision-options")
    : document.querySelector(`#release-${field}`);
  if (error) {
    error.textContent = message ?? "";
    error.hidden = !message;
  }
  control?.setAttribute("aria-invalid", message ? "true" : "false");
}

export function mountReleaseForm(container, { decisions, storage, onCreated }) {
  let draft = loadReleaseDraft(storage);
  let errors = {};
  // Reconcile a restored draft against the decisions that actually exist before
  // the form can act on it, so a stale association can never be submitted.
  const reconciled = reconcileDraftDecisions(draft, decisions);
  if (reconciled !== draft) {
    draft = reconciled;
    try { saveReleaseDraft(storage, draft); } catch { /* stale storage is corrected on next edit */ }
  }
  const form = node("form", "release-create-form");
  form.noValidate = true;

  form.innerHTML = `
    <div class="field">
      <label for="release-version">Version <span aria-hidden="true">*</span></label>
      <input id="release-version" name="version" type="text" inputmode="text" autocomplete="off" placeholder="1.0.0" required aria-describedby="version-hint version-error">
      <span class="hint" id="version-hint">Semantic version, for example 1.4.0.</span>
      <span class="field-error" id="version-error" role="alert" hidden></span>
    </div>
    <div class="field">
      <label for="release-date">Release date <span aria-hidden="true">*</span></label>
      <input id="release-date" name="date" type="date" required aria-describedby="date-error">
      <span class="field-error" id="date-error" role="alert" hidden></span>
    </div>
    <div class="field field-wide">
      <label for="release-description">Description <span class="label-optional">(optional)</span></label>
      <textarea id="release-description" name="description" rows="4" maxlength="1000" aria-describedby="description-hint"></textarea>
      <span class="hint" id="description-hint">A concise summary of what changed and who it helps.</span>
    </div>
    <fieldset class="decision-picker field-wide" id="decision-options" aria-describedby="decision-options-hint decision-options-error">
      <legend>Associated decisions <span aria-hidden="true">*</span></legend>
      <div class="decision-picker-heading">
        <span class="hint" id="decision-options-hint">Select every decision this release puts into practice.</span>
        <span class="selection-count" aria-live="polite">0 selected</span>
      </div>
      <div class="decision-options"></div>
      <span class="field-error" id="decision-options-error" role="alert" hidden></span>
    </fieldset>
    <p class="draft-status" role="status" aria-live="polite">Draft saved locally</p>
    <button class="release-submit" type="submit"><span>Create release</span><span aria-hidden="true">→</span></button>`;

  const version = form.querySelector("#release-version");
  const date = form.querySelector("#release-date");
  const description = form.querySelector("#release-description");
  const options = form.querySelector(".decision-options");
  const count = form.querySelector(".selection-count");
  const status = form.querySelector(".draft-status");
  const button = form.querySelector(".release-submit");
  version.value = draft.version;
  date.value = draft.date;
  description.value = draft.description;

  function updateCount() {
    const total = draft.decisionIds.length;
    count.textContent = `${total} selected`;
  }

  if (!decisions.length) {
    options.append(node("p", "decision-picker-empty", "No decisions are available yet. Add a decision before recording a release."));
    button.disabled = true;
  } else {
    for (const decision of decisions) {
      const label = node("label", "decision-option");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "decisionIds";
      checkbox.value = decision.id;
      checkbox.checked = draft.decisionIds.includes(decision.id);
      const copy = node("span", "decision-option-copy");
      copy.append(node("strong", "", decision.title), node("span", "", `${decision.status} · ${decision.owner}`));
      label.append(checkbox, copy);
      options.append(label);
      checkbox.addEventListener("change", () => {
        draft.decisionIds = [...form.querySelectorAll('input[name="decisionIds"]:checked')].map((item) => item.value);
        persist();
        updateCount();
        if (errors.decisionIds) validate("decisionIds");
      });
    }
  }

  function persist() {
    try {
      saveReleaseDraft(storage, draft);
      status.textContent = "Draft saved locally";
    } catch {
      status.textContent = "Draft could not be saved in this browser.";
    }
  }

  function validate(name) {
    errors = validateReleaseDraft(draft);
    const id = name === "decisionIds" ? "decision-options" : name;
    fieldError(id, errors[name]);
  }

  for (const [control, name] of [[version, "version"], [date, "date"], [description, "description"]]) {
    control.addEventListener("input", () => {
      draft[name] = control.value;
      persist();
      if (errors[name]) validate(name);
    });
    if (name !== "description") control.addEventListener("blur", () => validate(name));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errors = validateReleaseDraft(draft);
    fieldError("version", errors.version);
    fieldError("date", errors.date);
    fieldError("decision-options", errors.decisionIds);
    if (Object.keys(errors).length) {
      (errors.version ? version : errors.date ? date : options.querySelector("input"))?.focus();
      status.textContent = "Fix the highlighted fields to create this release.";
      return;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.querySelector("span").textContent = "Creating release…";
    status.textContent = "Creating release…";
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const release = createRelease(draft);
      saveReleases(storage, [release, ...loadReleases(storage)]);
      storage.removeItem(RELEASE_DRAFT_KEY);
      status.textContent = `Release ${release.version} created.`;
      onCreated?.(release);
    } catch {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.querySelector("span").textContent = "Create release";
      status.textContent = "The release could not be saved. Your draft is still here; try again.";
    }
  });

  container.replaceChildren(form);
  updateCount();
  return form;
}
