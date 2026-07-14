// Decision detail view: a reusable, accessible modal that presents a decision's
// metadata and lets you compare the alternatives that were weighed.
//
// Design tradeoffs (kept explicit so this stays easy to evolve):
// - Pure logic (`compareAlternatives`) is separated from DOM rendering so the
//   comparison rules can be unit-tested without a browser.
// - Alternatives use the ARIA tablist pattern: one tab per alternative plus a
//   "Compare" tab. This gives standard arrow-key navigation for free and keeps
//   the DOM small (one panel visible at a time) instead of a wide grid that
//   fights small screens.
// - A "difference" is a pro/con unique to a single alternative. Shared points
//   are de-emphasised so the differentiators stand out. This is a deliberately
//   simple, text-based heuristic; the rule lives in one place and can be swapped
//   later without touching the view.
// - Rendering only ever uses textContent / createElement, never innerHTML, so
//   recorded text can never execute as HTML (see PRODUCT.md constraints).

const normalizeText = (text) => String(text).trim().toLowerCase();

function tally(items) {
  const counts = new Map();
  for (const item of items) {
    const key = normalizeText(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Annotate each pro/con with whether it is shared across alternatives. Items
// that appear in only one alternative (`shared: false`) are the differentiators.
export function compareAlternatives(alternatives = []) {
  const list = Array.isArray(alternatives) ? alternatives : [];
  const proCounts = tally(list.flatMap((alt) => alt.pros ?? []));
  const conCounts = tally(list.flatMap((alt) => alt.cons ?? []));
  const mark = (counts) => (text) => ({ text, shared: (counts.get(normalizeText(text)) ?? 0) > 1 });
  return list.map((alt) => ({
    id: alt.id,
    name: alt.name,
    pros: (alt.pros ?? []).map(mark(proCounts)),
    cons: (alt.cons ?? []).map(mark(conCounts)),
  }));
}

// --- DOM helpers (browser only) -------------------------------------------

let uidCounter = 0;
const nextId = (prefix) => `${prefix}-${(uidCounter += 1)}`;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "hidden") node.hidden = value;
    else if (key === "id") node.id = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child != null));
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
}

function getFocusable(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter(
    (node) => node.getAttribute("tabindex") !== "-1" && !node.closest("[hidden]"),
  );
}

function metaRow(label, value) {
  return el("div", { class: "detail-meta-row" },
    el("dt", { text: label }),
    el("dd", { text: value }),
  );
}

// Render a titled pros or cons list. Accepts plain strings (single-alternative
// view) or `{ text, shared }` objects (comparison view, where unique points are
// tagged as differences).
function pointList(title, items, kind) {
  const list = el("ul", { class: `detail-points detail-points-${kind}` });
  if (items.length === 0) {
    list.append(el("li", { class: "detail-point-empty", text: `No ${title.toLowerCase()} recorded.` }));
  } else {
    for (const item of items) {
      const text = typeof item === "string" ? item : item.text;
      const shared = typeof item === "object" && item.shared;
      const point = el("li", { class: `detail-point ${shared ? "is-shared" : "is-unique"}` });
      point.append(el("span", { class: "detail-point-text", text }));
      if (!shared) point.append(el("span", { class: "detail-tag", text: "differs" }));
      list.append(point);
    }
  }
  return el("div", { class: `detail-column detail-column-${kind}` },
    el("h4", { class: "detail-column-title", text: title }),
    list,
  );
}

function buildAlternativePanel(alternative) {
  return el("div", { class: "detail-panel" },
    el("div", { class: "detail-columns" },
      pointList("Pros", alternative.pros ?? [], "pros"),
      pointList("Cons", alternative.cons ?? [], "cons"),
    ),
  );
}

function buildComparePanel(compared) {
  const grid = el("div", { class: "detail-compare" });
  for (const alternative of compared) {
    grid.append(el("div", { class: "detail-compare-col" },
      el("h4", { class: "detail-compare-name", text: alternative.name }),
      pointList("Pros", alternative.pros, "pros"),
      pointList("Cons", alternative.cons, "cons"),
    ));
  }
  const legend = el("p", { class: "detail-legend" },
    el("span", { class: "detail-tag", text: "differs" }),
    " marks a point unique to one alternative.",
  );
  return el("div", { class: "detail-panel" }, grid, legend);
}

// Build the alternatives region as an ARIA tablist with roving-tabindex
// arrow-key navigation. Returns the region node; keyboard wiring is self
// contained so the caller only manages the surrounding modal.
function buildAlternatives(alternatives) {
  const compared = compareAlternatives(alternatives);
  const region = el("section", { class: "detail-alternatives", "aria-label": "Alternatives" },
    el("h3", { class: "detail-section-title", text: "Alternatives" }),
  );
  const tablist = el("div", { class: "detail-tablist", role: "tablist", "aria-label": "Alternatives" });
  const panelWrap = el("div", { class: "detail-panels" });
  const tabs = [];
  const panels = [];

  const addTab = (label, panel, index) => {
    const tabId = nextId("detail-tab");
    const panelId = nextId("detail-panel");
    const tab = el("button", {
      class: "detail-tab",
      type: "button",
      role: "tab",
      id: tabId,
      "aria-controls": panelId,
      "aria-selected": index === 0 ? "true" : "false",
      tabindex: index === 0 ? "0" : "-1",
      text: label,
    });
    panel.setAttribute("role", "tabpanel");
    panel.id = panelId;
    panel.setAttribute("aria-labelledby", tabId);
    panel.tabIndex = 0;
    panel.hidden = index !== 0;
    tabs.push(tab);
    panels.push(panel);
    tablist.append(tab);
    panelWrap.append(panel);
  };

  alternatives.forEach((alternative, index) => {
    addTab(alternative.name, buildAlternativePanel(alternative), index);
  });
  // The comparison view only means something with at least two options.
  if (alternatives.length > 1) {
    addTab("Compare", buildComparePanel(compared), alternatives.length);
  }

  const select = (index, { focus = true } = {}) => {
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
      panels[i].hidden = !active;
    });
    if (focus) tabs[index].focus();
  };

  tablist.addEventListener("keydown", (event) => {
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(next);
  });
  tabs.forEach((tab, index) => tab.addEventListener("click", () => select(index, { focus: false })));

  region.append(tablist, panelWrap);
  return region;
}

// Open the decision detail modal. Returns `{ close }`.
// options: { returnFocusTo?: Element, onClose?: () => void }
export function mountDecisionDetail(decision, options = {}) {
  const returnFocusTo = options.returnFocusTo ?? document.activeElement;
  const alternatives = Array.isArray(decision.alternatives) ? decision.alternatives : [];
  const titleId = nextId("detail-title");

  const closeButton = el("button", { class: "detail-close", type: "button", "aria-label": "Close details" }, "×");
  const header = el("header", { class: "detail-header" },
    el("div", { class: "detail-heading" },
      el("span", { class: `badge badge-${decision.status}`, text: decision.status }),
      el("h2", { class: "detail-title", id: titleId, text: decision.title }),
    ),
    closeButton,
  );

  const body = el("div", { class: "detail-body" },
    el("dl", { class: "detail-meta" },
      metaRow("Owner", decision.owner),
      metaRow("Status", decision.status),
      metaRow("Recorded", formatDate(decision.createdAt)),
    ),
    el("section", { class: "detail-context", "aria-label": "Context" },
      el("h3", { class: "detail-section-title", text: "Context" }),
      el("p", { class: "detail-context-body", text: decision.context }),
    ),
  );

  if (alternatives.length === 0) {
    body.append(el("p", { class: "detail-empty", text: "No alternatives were recorded for this decision." }));
  } else {
    body.append(buildAlternatives(alternatives));
  }

  const modal = el("div", {
    class: "detail-modal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titleId,
    tabindex: "-1",
  }, header, body);
  const backdrop = el("div", { class: "detail-backdrop" }, modal);

  const previousOverflow = document.body.style.overflow;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    document.body.style.overflow = previousOverflow;
    if (returnFocusTo && typeof returnFocusTo.focus === "function") returnFocusTo.focus();
    options.onClose?.();
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    // Trap focus inside the dialog.
    const focusables = getFocusable(modal);
    if (focusables.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    // The dialog container itself (tabindex -1) counts as "before the first"
    // element so focus wraps instead of escaping the modal.
    if (event.shiftKey && (active === first || active === modal || !modal.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeydown, true);

  document.body.style.overflow = "hidden";
  document.body.append(backdrop);
  modal.focus();

  return { close };
}
