// Harness for the Shiplog history page (initDecisionLog).
//
// Same idea as the paint editor harness: stand up the smallest environment the
// view actually touches — the controls it queries, a storage stub, and a demo
// fetch — so the wiring between the filter controls, the render function, and
// the empty state can be driven the way a user drives it. The controls are
// modelled as the native form elements they are: a change event carries the
// new value, which is exactly what a keyboard user produces.
import { createElement, installDocument } from "./dom.js";

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

export function createHistoryHarness(data) {
  installDocument();
  globalThis.document.documentElement = { dataset: {} };
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
    "#sort-by": select("newest"),
    "#decision-search": control({ value: "" }),
    "#clear-decision-filters": control(),
    "#exit-decision-recorder": control(),
    "#title": control({ scrollIntoView() {} }),
    "#decisions-title": control({ scrollIntoView() {} }),
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
