export const STORAGE_KEY = "shiplog.decisions.v1";
export const STATUSES = ["proposed", "accepted", "superseded"];

function isDecision(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.id === "string"
    && typeof value.title === "string" && value.title.trim() !== ""
    && typeof value.context === "string" && value.context.trim() !== ""
    && typeof value.owner === "string" && value.owner.trim() !== ""
    && STATUSES.includes(value.status)
    && typeof value.createdAt === "string"
    && !Number.isNaN(Date.parse(value.createdAt));
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

  return {
    id: options.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    title,
    context,
    owner,
    status,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
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
    item.append(article);
    list.append(item);
  }
  container.append(list);
}

export function initDecisionLog(root = document, storage = localStorage) {
  const form = root.querySelector("#decision-form");
  const list = root.querySelector("#decision-list");
  const count = root.querySelector("#decision-count");
  const notice = root.querySelector("#storage-notice");
  let decisions = loadDecisions(storage);

  renderDecisions(list, count, decisions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const decision = createDecision(Object.fromEntries(new FormData(form)));
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
    form.elements.title.focus();
  });

  document.documentElement.dataset.shiplog = "ready";
}

if (typeof document !== "undefined") initDecisionLog();
