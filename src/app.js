import { mountDecisionDetail } from "./detail.js";

export const STORAGE_KEY = "shiplog.decisions.v1";
export const STATUSES = ["proposed", "accepted", "superseded"];

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAlternative(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.id === "string"
    && typeof value.name === "string" && value.name.trim() !== ""
    && isStringArray(value.pros)
    && isStringArray(value.cons);
}

function isDecision(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.id === "string"
    && typeof value.title === "string" && value.title.trim() !== ""
    && typeof value.context === "string" && value.context.trim() !== ""
    && typeof value.owner === "string" && value.owner.trim() !== ""
    && STATUSES.includes(value.status)
    && typeof value.createdAt === "string"
    && !Number.isNaN(Date.parse(value.createdAt))
    // Alternatives are optional so existing records stay valid; when present
    // they must be a well-formed list.
    && (value.alternatives === undefined
      || (Array.isArray(value.alternatives) && value.alternatives.every(isAlternative)));
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

// Accept either an array of strings or a newline-separated string (as typed in
// a textarea) and return trimmed, non-empty lines.
export function normalizeList(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split("\n");
  return items.map((item) => String(item).trim()).filter(Boolean);
}

export function createAlternative(values, options = {}) {
  const name = String(values?.name ?? "").trim();
  if (!name) throw new TypeError("An alternative requires a name.");
  return {
    id: options.id ?? values?.id ?? newId(),
    name,
    pros: normalizeList(values?.pros),
    cons: normalizeList(values?.cons),
  };
}

// Normalize a list of alternative inputs, skipping any that lack a name so a
// half-filled editor row never blocks saving the decision.
export function normalizeAlternatives(list) {
  if (!Array.isArray(list)) return [];
  const normalized = [];
  for (const value of list) {
    try {
      normalized.push(createAlternative(value));
    } catch {
      // Ignore incomplete alternatives (e.g. empty editor rows).
    }
  }
  return normalized;
}

export function loadDecisions(storage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isDecision) : [];
  } catch {
    return [];
  }
}

export function saveDecisions(storage, decisions) {
  storage.setItem(STORAGE_KEY, JSON.stringify(decisions));
}

export function createDecision(values, options = {}) {
  const title = String(values.title ?? "").trim();
  const context = String(values.context ?? "").trim();
  const owner = String(values.owner ?? "").trim();
  const status = String(values.status ?? "");

  if (!title || !context || !owner || !STATUSES.includes(status)) {
    throw new TypeError("A decision requires a title, context, owner, and valid status.");
  }

  const decision = {
    id: options.id ?? newId(),
    title,
    context,
    owner,
    status,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
  // Only attach alternatives when some exist, so decisions without them keep
  // their minimal shape.
  const alternatives = normalizeAlternatives(values.alternatives);
  if (alternatives.length > 0) decision.alternatives = alternatives;
  return decision;
}

function appendTextElement(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderDecisions(container, count, decisions) {
  container.replaceChildren();
  count.textContent = `${decisions.length} ${decisions.length === 1 ? "record" : "records"}`;

  if (decisions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    appendTextElement(empty, "p", "empty-title", "No decisions yet.");
    appendTextElement(empty, "p", "", "Add the first record to start your engineering history.");
    container.append(empty);
    return;
  }

  const list = document.createElement("ol");
  list.className = "decision-list";
  for (const decision of decisions) {
    const item = document.createElement("li");
    const article = document.createElement("article");
    article.className = "decision-card";

    const meta = document.createElement("div");
    meta.className = "decision-meta";
    appendTextElement(meta, "span", `badge badge-${decision.status}`, decision.status);
    appendTextElement(meta, "time", "date", new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(decision.createdAt)))
      .dateTime = decision.createdAt;

    appendTextElement(article, "h3", "", decision.title);
    appendTextElement(article, "p", "context", decision.context);
    const owner = document.createElement("p");
    owner.className = "owner";
    appendTextElement(owner, "span", "owner-label", "Owner");
    owner.append(document.createTextNode(decision.owner));
    article.prepend(meta);
    article.append(owner);

    const actions = document.createElement("div");
    actions.className = "decision-actions";
    const count = decision.alternatives?.length ?? 0;
    if (count > 0) {
      appendTextElement(actions, "span", "alt-count", `${count} ${count === 1 ? "alternative" : "alternatives"}`);
    }
    const view = document.createElement("button");
    view.type = "button";
    view.className = "link-button";
    view.textContent = "View details";
    view.setAttribute("aria-label", `View details for ${decision.title}`);
    view.addEventListener("click", () => mountDecisionDetail(decision, { returnFocusTo: view }));
    actions.append(view);
    article.append(actions);

    item.append(article);
    list.append(item);
  }
  container.append(list);
}

// Build one editable alternative row (name + pros/cons textareas + remove).
// Inputs are intentionally unnamed so they stay out of the form's FormData;
// they are read directly from the DOM on submit.
function createAlternativeRow() {
  const row = document.createElement("div");
  row.className = "alternative-row";

  const nameField = document.createElement("div");
  nameField.className = "field alt-name-field";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 80;
  nameInput.className = "alt-name";
  nameInput.setAttribute("aria-label", "Alternative name");
  nameInput.placeholder = "Alternative name";
  nameField.append(nameInput);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-alternative";
  remove.setAttribute("aria-label", "Remove alternative");
  remove.textContent = "Remove";
  remove.addEventListener("click", () => row.remove());
  nameField.append(remove);

  const makeArea = (className, label, placeholder) => {
    const field = document.createElement("div");
    field.className = "field";
    const area = document.createElement("textarea");
    area.rows = 3;
    area.className = className;
    area.setAttribute("aria-label", label);
    area.placeholder = placeholder;
    field.append(area);
    return field;
  };

  const areas = document.createElement("div");
  areas.className = "alt-areas";
  areas.append(
    makeArea("alt-pros", "Pros, one per line", "Pros — one per line"),
    makeArea("alt-cons", "Cons, one per line", "Cons — one per line"),
  );

  row.append(nameField, areas);
  return row;
}

function readAlternatives(editor) {
  return [...editor.querySelectorAll(".alternative-row")].map((row) => ({
    name: row.querySelector(".alt-name").value,
    pros: row.querySelector(".alt-pros").value,
    cons: row.querySelector(".alt-cons").value,
  }));
}

export function initDecisionLog(root = document, storage = localStorage) {
  const form = root.querySelector("#decision-form");
  const list = root.querySelector("#decision-list");
  const count = root.querySelector("#decision-count");
  const notice = root.querySelector("#storage-notice");
  const editor = root.querySelector("#alternatives-editor");
  const addAlternative = root.querySelector("#add-alternative");
  let decisions = loadDecisions(storage);

  addAlternative?.addEventListener("click", () => {
    const row = createAlternativeRow();
    editor.append(row);
    row.querySelector(".alt-name").focus();
  });

  renderDecisions(list, count, decisions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const values = Object.fromEntries(new FormData(form));
    values.alternatives = editor ? readAlternatives(editor) : [];
    const decision = createDecision(values);
    decisions = [decision, ...decisions];
    try {
      saveDecisions(storage, decisions);
      notice.hidden = true;
    } catch {
      notice.textContent = "This decision is visible for now, but could not be saved in this browser.";
      notice.hidden = false;
    }
    renderDecisions(list, count, decisions);
    form.reset();
    if (editor) editor.replaceChildren();
    form.elements.title.focus();
  });

  document.documentElement.dataset.shiplog = "ready";
}

if (typeof document !== "undefined") initDecisionLog();
