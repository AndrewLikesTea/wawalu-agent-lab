// Harness for the Shiplog history page (initDecisionLog).
//
// Same idea as the paint editor harness: stand up the smallest environment the
// view actually touches — the controls it queries, a storage stub, and a demo
// fetch — so the wiring between the filter controls, the render function, and
// the empty state can be driven the way a user drives it. The controls are
// modelled as the native form elements they are: a change event carries the
// new value, which is exactly what a keyboard user produces.
import { byClass, createElement, installDocument, walk } from "./dom.js";

function control(properties = {}) {
  const node = {
    listeners: {},
    focused: 0,
    ...properties,
    addEventListener(type, handler) { (node.listeners[type] ??= []).push(handler); },
    dispatch(type, event) { for (const handler of node.listeners[type] ?? []) handler(event); },
    focus() { node.focused += 1; },
  };
  return node;
}

function select(value = "all") {
  const node = control({ value, disabled: false, options: [] });
  node.replaceChildren = (...options) => { node.options = options; };
  node.append = (...options) => { node.options.push(...options); };
  return node;
}

// A browsing session: one location, one history stack, and the popstate the
// browser fires when the Back button unwinds it. pushState/replaceState are
// modelled the way a browser implements them — they rewrite `location.search`
// without firing an event — so the page under test is driven through exactly
// the API it calls in production, and Back is a real step backwards rather than
// a direct call into a handler.
function createBrowsingSession(start = "") {
  const location = { pathname: "/", search: start, hash: "", origin: "https://labs.wawalu.org" };
  const entries = [start];
  let index = 0;
  const listeners = [];
  const searchOf = (url) => {
    const query = String(url).indexOf("?");
    return query === -1 ? "" : String(url).slice(query);
  };
  const history = {
    pushState(state, title, url) {
      entries.splice(index + 1);
      entries.push(searchOf(url));
      index = entries.length - 1;
      location.search = entries[index];
    },
    replaceState(state, title, url) {
      entries[index] = searchOf(url);
      location.search = entries[index];
    },
  };
  const window = {
    location,
    history,
    addEventListener(type, handler) { if (type === "popstate") listeners.push(handler); },
  };
  return {
    location,
    history,
    window,
    get entries() { return [...entries]; },
    back() {
      if (index === 0) return false;
      index -= 1;
      location.search = entries[index];
      for (const handler of listeners) handler({ type: "popstate" });
      return true;
    },
  };
}

export function createHistoryHarness(data, { search = "", clipboard } = {}) {
  installDocument();
  globalThis.document.documentElement = { dataset: {} };
  const session = createBrowsingSession(search);
  globalThis.window = { location: { hash: "" } };
  globalThis.Option = function Option(label, value) { return { label, value, textContent: label }; };
  globalThis.fetch = async () => ({ ok: true, json: async () => data });

  const elements = {
    "#decision-form": control({ elements: { title: control() }, reset() {}, reportValidity: () => true }),
    "#decision-list": createElement("div"),
    "#decision-count": createElement("span"),
    "#storage-notice": createElement("p"),
    "#history-announcement": createElement("p"),
    "#filter-status": select(),
    "#filter-status-hint": createElement("span"),
    "#filter-owner": select(),
    "#filter-release": select(),
    "#filter-release-hint": createElement("span"),
    "#history-release-followup": createElement("div"),
    "#sort-by": select("newest"),
    "#decision-search": control({ value: "" }),
    "#clear-decision-filters": control(),
    "#exit-decision-recorder": control(),
    "#title": control({ scrollIntoView() {} }),
    "#decisions-title": control({ scrollIntoView() {} }),
    "#filter-from": control({ value: "" }),
    "#filter-to": control({ value: "" }),
    "#filter-current-only": control(),
    "#history-filter-summary": createElement("p"),
    "#history-trend": createElement("div"),
    "#history-filter-chips": createElement("ul"),
    "#copy-history-link": control(),
    "#history-copy-status": createElement("p"),
  };
  const radios = ["all", "decision", "release"].map((value) =>
    control({ value, checked: value === "all", name: "record-type" }));

  const root = {
    querySelector: (selector) => elements[selector] ?? null,
    querySelectorAll: (selector) => selector === 'input[name="record-type"]' ? radios : [],
    getElementById: () => null,
  };

  const stored = new Map();
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };

  return {
    root,
    storage,
    radios,
    elements,
    // Handed to initDecisionLog as `options`, so the page reads and writes this
    // session's URL instead of the process-wide one.
    browser: {
      location: session.location,
      history: session.history,
      window: session.window,
      clipboard,
    },
    get url() { return session.location.search; },
    get entries() { return session.entries; },
    back: () => session.back(),
    summary: elements["#history-filter-summary"],
    trend: elements["#history-trend"],
    // The bar groups currently drawn, in week order. A keyboard user reaches
    // them through one Tab stop and moves with the arrows, so a test presses a
    // key on the group rather than clicking it.
    trendBars: () => walk(elements["#history-trend"], (node) => node.dataset.week !== undefined),
    pressBar(week, key = "Enter") {
      const bar = walk(elements["#history-trend"], (node) => node.dataset.week === week)[0];
      if (!bar) throw new Error(`No bar for the week of ${week} is on screen.`);
      bar.dispatch("keydown", { key, preventDefault() {} });
      return bar;
    },
    chips: elements["#history-filter-chips"],
    copyStatus: elements["#history-copy-status"],
    chipButtons: () => byClass(elements["#history-filter-chips"], "filter-chip"),
    removeChip(filter) {
      const button = byClass(elements["#history-filter-chips"], "filter-chip")
        .find((chip) => chip.dataset.filter === filter);
      if (!button) throw new Error(`No chip for the ${filter} filter is on screen.`);
      button.dispatch("click");
      return button;
    },
    chooseDates(from, to) {
      elements["#filter-from"].value = from;
      elements["#filter-to"].value = to;
      elements["#filter-from"].dispatch("change");
    },
    list: elements["#decision-list"],
    count: elements["#decision-count"],
    search: elements["#decision-search"],
    status: elements["#filter-status"],
    statusHint: elements["#filter-status-hint"],
    announcement: elements["#history-announcement"],
    // A keyboard user selecting a radio produces a change event on the checked
    // input; model exactly that rather than calling the handler directly.
    chooseType(value) {
      for (const radio of radios) radio.checked = radio.value === value;
      radios.find((radio) => radio.value === value).dispatch("change");
    },
    chooseStatus(value) {
      elements["#filter-status"].value = value;
      elements["#filter-status"].dispatch("change");
    },
    chooseRelease(value) {
      elements["#filter-release"].value = value;
      elements["#filter-release"].dispatch("change");
    },
    type(query) {
      elements["#decision-search"].value = query;
      elements["#decision-search"].dispatch("input");
    },
    click(node) {
      elements["#decision-list"].dispatch("click", {
        target: { closest: (selector) => selector === "[data-action]" ? node : null },
      });
    },
  };
}
