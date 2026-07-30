// A dependency-free browser stand-in for whole-page flow tests.
//
// tests/support/dom.js deliberately stops short of this: it stubs the handful of
// element APIs one render function touches. Locking in the *flow* needs more —
// the real page markup, a document-order tab sequence, native activation, and
// the file the export button actually produces. So this module parses a shipped
// HTML file into a small DOM and drives it with keyboard events.
//
// It is honest about what it is not: no layout, no CSS, no network, no timers.
// Anything that depends on painting or real focus rings still belongs in a
// browser. What it does model faithfully is the part a keyboard user feels —
// which elements are in the tab sequence, in what order, and what Enter, Space,
// and the arrow keys do to them.

import { readFile } from "node:fs/promises";

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

const FOCUSABLE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function camelToDataAttribute(key) {
  return `data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

// --- selectors -------------------------------------------------------------
// Compound selectors only (`tag`, `#id`, `.class`, `[attr]`, `[attr="value"]`,
// and comma-separated lists). Combinators are rejected loudly rather than
// silently mismatching: a selector this harness cannot model is a harness bug,
// not a test result.
function parseSelector(selector) {
  return String(selector).split(",").map((part) => {
    const compound = part.trim();
    if (/[\s>+~]/.test(compound)) throw new Error(`Unsupported selector for this harness: "${selector}"`);
    const tokens = compound.match(/\[[^\]]*\]|[#.]?[A-Za-z0-9_-]+/g);
    if (!tokens) throw new Error(`Unparseable selector: "${selector}"`);
    return tokens;
  });
}

function matchesToken(node, token) {
  if (token.startsWith("#")) return node.id === token.slice(1);
  if (token.startsWith(".")) return node.classList.contains(token.slice(1));
  if (token.startsWith("[")) {
    const [, name, assignment, , value] = token.slice(1, -1).match(/^([^=]+)(=("?)([^"]*)\3)?$/) ?? [];
    if (!name) return false;
    if (assignment === undefined) return node.getAttribute(name.trim()) !== null;
    return node.getAttribute(name.trim()) === value;
  }
  return node.tagName === token.toUpperCase();
}

// --- nodes -----------------------------------------------------------------

class TextNode {
  constructor(text, ownerDocument) {
    this.nodeType = 3;
    this.tagName = "#text";
    this.data = String(text);
    this.parentNode = null;
    this.ownerDocument = ownerDocument;
    this.children = [];
  }

  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }

  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

// A fragment inserts its children, not itself — the one piece of fragment
// behaviour a page depends on. Without it, `append(fragment)` would nest a node
// no browser ever renders and every assertion below it would read the wrong tree.
function expandFragments(nodes) {
  return nodes.flatMap((node) => (node?.nodeType === 11 ? node.children.splice(0) : [node]));
}

class Element {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.ownerDocument = ownerDocument;
    this.listeners = new Map();
    this.focusCount = 0;
  }

  // --- attributes and reflected properties ---
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  get id() { return this.getAttribute("id") ?? ""; }
  set id(value) { this.setAttribute("id", value); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(value) { this.setAttribute("class", value); }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (name) => names().includes(name),
      add: (...added) => { this.className = [...new Set([...names(), ...added])].join(" "); },
      remove: (...removed) => { this.className = names().filter((name) => !removed.includes(name)).join(" "); },
    };
  }

  get dataset() {
    this._dataset ??= new Proxy({}, {
      get: (_, key) => this.getAttribute(camelToDataAttribute(key)) ?? undefined,
      set: (_, key, value) => { this.setAttribute(camelToDataAttribute(key), value); return true; },
      deleteProperty: (_, key) => { this.removeAttribute(camelToDataAttribute(key)); return true; },
      has: (_, key) => this.hasAttribute(camelToDataAttribute(key)),
      ownKeys: () => [...this.attributes.keys()].filter((name) => name.startsWith("data-")),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
    return this._dataset;
  }

  // No layout and no cascade: this records what a page set, so a test can read
  // back a width or a flex share, and claims nothing about what it would render.
  get style() {
    this._style ??= { setProperty(name, value) { this[name] = String(value); } };
    return this._style;
  }

  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(value) { if (value) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(value) { if (value) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }
  get checked() { return this._checked ?? this.hasAttribute("checked"); }
  set checked(value) { this._checked = Boolean(value); }
  get type() { return this._type ?? this.getAttribute("type") ?? (this.tagName === "BUTTON" ? "submit" : "text"); }
  set type(value) { this._type = String(value); }
  get name() { return this.getAttribute("name") ?? ""; }
  get href() { return this.getAttribute("href") ?? ""; }
  set href(value) { this.setAttribute("href", value); }
  get download() { return this.getAttribute("download") ?? ""; }
  set download(value) { this.setAttribute("download", value); }
  get dateTime() { return this.getAttribute("datetime") ?? ""; }
  set dateTime(value) { this.setAttribute("datetime", value); }
  get required() { return this.hasAttribute("required"); }

  get options() { return this.children.filter((child) => child.tagName === "OPTION"); }

  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === "TEXTAREA") return this.textContent;
    if (this.tagName === "OPTION") return this.getAttribute("value") ?? this.textContent;
    if (this.tagName === "SELECT") return this.options[0]?.value ?? "";
    return this.getAttribute("value") ?? "";
  }

  set value(next) { this._value = String(next); }

  // --- tree ---
  get childElements() { return this.children.filter((child) => child.nodeType === 1); }
  // The renderers label a section by appending its heading and then naming
  // `firstChild`, so a page driven through this harness needs the same
  // accessors the DOM offers (tests/support/dom.js already has them).
  get firstChild() { return this.children[0] ?? null; }
  get lastChild() { return this.children.at(-1) ?? null; }

  append(...nodes) {
    for (const node of expandFragments(nodes)) {
      const child = typeof node === "string" ? new TextNode(node, this.ownerDocument) : node;
      child.remove?.();
      child.parentNode = this;
      this.children.push(child);
    }
  }

  prepend(...nodes) {
    for (const node of [...expandFragments(nodes)].reverse()) {
      const child = typeof node === "string" ? new TextNode(node, this.ownerDocument) : node;
      child.remove?.();
      child.parentNode = this;
      this.children.unshift(child);
    }
  }

  // Standard DOM placement, needed by any view that has to land a node in a
  // specific slot rather than at one end. A null reference appends, which is
  // what the browser does; a reference that is not a child throws there, and
  // appending here instead of throwing would hide the mistake.
  insertBefore(node, reference) {
    if (!reference) { this.append(node); return node; }
    const index = this.children.indexOf(reference);
    if (index === -1) throw new Error("insertBefore: the reference node is not a child of this node");
    const child = typeof node === "string" ? new TextNode(node, this.ownerDocument) : node;
    child.remove?.();
    child.parentNode = this;
    this.children.splice(this.children.indexOf(reference), 0, child);
    return node;
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  get textContent() { return this.children.map((child) => child.textContent).join(""); }
  set textContent(value) {
    this.children = [];
    if (value !== "") this.append(new TextNode(value, this.ownerDocument));
  }

  matches(selector) {
    return parseSelector(selector).some((tokens) => tokens.every((token) => matchesToken(this, token)));
  }

  closest(selector) {
    let node = this;
    while (node && node.nodeType === 1) {
      if (node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const groups = parseSelector(selector);
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.nodeType !== 1) continue;
        if (groups.some((tokens) => tokens.every((token) => matchesToken(child, token)))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  // --- events ---
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== handler));
  }

  dispatchEvent(event) {
    event.target ??= this;
    let node = this;
    while (node) {
      event.currentTarget = node;
      for (const handler of [...(node.listeners?.get(event.type) ?? [])]) handler.call(node, event);
      if (event.bubbles === false || event.propagationStopped) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
    this.focusCount += 1;
  }

  blur() {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null;
  }

  scrollIntoView() {}

  // Native activation, modelled closely enough that a test never has to reach
  // past the control it is "clicking": a radio checks itself and emits change, a
  // submit button submits its form, an anchor navigates, and a download anchor
  // hands the browser a file.
  click() {
    if (this.disabled) return;
    if (this.tagName === "INPUT" && (this.type === "radio" || this.type === "checkbox")) {
      if (this.type === "radio") {
        for (const peer of this.ownerDocument.querySelectorAll(`input[name="${this.name}"]`)) peer.checked = peer === this;
      } else {
        this.checked = !this.checked;
      }
    }

    const event = new DomEvent("click", { bubbles: true });
    this.dispatchEvent(event);

    if (this.tagName === "INPUT" && (this.type === "radio" || this.type === "checkbox")) {
      this.dispatchEvent(new DomEvent("change", { bubbles: true }));
      return;
    }
    if (event.defaultPrevented) return;
    if (this.tagName === "BUTTON" && this.type === "submit") {
      this.closest("form")?.dispatchEvent(new DomEvent("submit", { bubbles: true }));
      return;
    }
    if (this.tagName === "A" && this.href) this.ownerDocument.activate(this);
  }

  // --- forms ---
  get elements() {
    const named = {};
    for (const control of this.querySelectorAll("input,select,textarea,button")) {
      if (control.name) named[control.name] ??= control;
      if (control.id) named[control.id] ??= control;
    }
    return named;
  }

  get formControls() {
    return this.querySelectorAll("input,select,textarea")
      .filter((control) => control.name && !control.disabled);
  }

  reportValidity() {
    return this.formControls.every((control) => {
      if (control.type === "radio" || control.type === "checkbox") return true;
      return !control.required || String(control.value).trim() !== "";
    });
  }

  reset() {
    for (const control of this.querySelectorAll("input,select,textarea")) {
      delete control._value;
      control._checked = control.hasAttribute("checked");
    }
  }
}

export class DomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? true;
    this.key = init.key;
    this.target = init.target ?? null;
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }

  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

class ShiplogDocument extends Element {
  constructor() {
    super("#document", null);
    this.nodeType = 9;
    this.ownerDocument = this;
    this.activeElement = null;
    this.navigations = [];
    this.downloads = [];
    this.objectUrls = new Map();
  }

  createElement(tagName) { return new Element(tagName, this); }
  createTextNode(text) { return new TextNode(text, this); }

  createDocumentFragment() {
    const fragment = new Element("#document-fragment", this);
    fragment.nodeType = 11;
    return fragment;
  }

  get documentElement() { return this.childElements.find((child) => child.tagName === "HTML") ?? null; }
  get body() { return this.querySelector("body"); }

  getElementById(id) { return this.querySelector(`#${id}`); }

  // Anchor activation: either a navigation or, when the anchor carries a
  // download attribute, the file the user receives.
  activate(anchor) {
    if (anchor.hasAttribute("download")) {
      this.downloads.push({
        filename: anchor.download,
        text: this.objectUrls.get(anchor.href) ?? "",
      });
      return;
    }
    this.navigations.push(anchor.href);
  }
}

// --- parsing ---------------------------------------------------------------

const TAG_PATTERN = new RegExp(
  [
    "<!--[\\s\\S]*?-->",
    "<!doctype[^>]*>",
    "</([a-zA-Z][a-zA-Z0-9-]*)\\s*>",
    "<([a-zA-Z][a-zA-Z0-9-]*)((?:\\s+[^\\s\"'>/=]+(?:\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s\"'>]+))?)*)\\s*/?>",
  ].join("|"),
  "gi",
);

const ATTRIBUTE_PATTERN = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function parseHtml(html) {
  const document = new ShiplogDocument();
  const stack = [document];
  let cursor = 0;

  const appendText = (text) => {
    if (text === "") return;
    stack.at(-1).append(new TextNode(decodeEntities(text), document));
  };

  for (const match of html.matchAll(TAG_PATTERN)) {
    appendText(html.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const [token, closing, opening, attributeText] = match;
    if (token.startsWith("<!")) continue;

    if (closing) {
      const index = stack.findLastIndex((node) => node.tagName === closing.toUpperCase());
      if (index > 0) stack.length = index;
      continue;
    }

    const element = document.createElement(opening);
    for (const attribute of (attributeText ?? "").matchAll(ATTRIBUTE_PATTERN)) {
      const [, name, quoted, singleQuoted, bare] = attribute;
      element.setAttribute(name, decodeEntities(quoted ?? singleQuoted ?? bare ?? ""));
    }
    stack.at(-1).append(element);
    if (!VOID_TAGS.has(element.tagName.toLowerCase())) stack.push(element);
  }
  appendText(html.slice(cursor));
  return document;
}

// --- keyboard --------------------------------------------------------------

function hasHiddenAncestor(element) {
  let node = element;
  while (node && node.nodeType === 1) {
    if (node.hidden) return true;
    node = node.parentNode;
  }
  return false;
}

// A radio group is one tab stop: only the checked radio (or the first, when the
// group is untouched) is in the sequence, and the arrow keys move within it.
// Modelling this matters — a test that tabbed to every radio would pass on a
// page a real keyboard user cannot operate.
function isTabbable(element, document) {
  if (!FOCUSABLE_TAGS.has(element.tagName)) return element.getAttribute("tabindex") !== null
    && element.getAttribute("tabindex") !== "-1";
  if (element.disabled || hasHiddenAncestor(element)) return false;
  if (element.getAttribute("tabindex") === "-1") return false;
  if (element.tagName === "A" && !element.href) return false;
  if (element.tagName === "INPUT" && element.type === "hidden") return false;
  if (element.tagName === "INPUT" && element.type === "radio" && element.name) {
    const group = document.querySelectorAll(`input[name="${element.name}"]`);
    const checked = group.find((radio) => radio.checked);
    return checked ? checked === element : group[0] === element;
  }
  return true;
}

export function tabSequence(document) {
  return document.querySelectorAll("a,button,input,select,textarea")
    .filter((element) => isTabbable(element, document));
}

export function pressTab(document, { shift = false } = {}) {
  const sequence = tabSequence(document);
  if (sequence.length === 0) return null;
  const index = sequence.indexOf(document.activeElement);
  const next = shift
    ? sequence[(index <= 0 ? sequence.length : index) - 1]
    : sequence[(index + 1) % sequence.length];
  next.focus();
  return next;
}

export function pressKey(document, key) {
  const target = document.activeElement;
  if (!target) throw new Error(`Nothing is focused, so "${key}" has no target.`);
  const event = new DomEvent("keydown", { bubbles: true, key });
  target.dispatchEvent(event);
  if (event.defaultPrevented) return target;

  if (target.tagName === "SELECT" && (key === "ArrowDown" || key === "ArrowUp")) {
    const options = target.options;
    const current = Math.max(0, options.findIndex((option) => option.value === target.value));
    const next = key === "ArrowDown"
      ? Math.min(current + 1, options.length - 1)
      : Math.max(current - 1, 0);
    if (next !== current) {
      target.value = options[next].value;
      target.dispatchEvent(new DomEvent("change", { bubbles: true }));
    }
    return target;
  }

  if (target.tagName === "INPUT" && target.type === "radio" && ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(key)) {
    const group = document.querySelectorAll(`input[name="${target.name}"]`);
    const step = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;
    const next = group[(group.indexOf(target) + step + group.length) % group.length];
    for (const radio of group) radio.checked = radio === next;
    next.focus();
    next.dispatchEvent(new DomEvent("change", { bubbles: true }));
    return next;
  }

  // A `<summary>` is natively operable with both Enter and Space, and both go
  // through the same path: flip the owning `<details>`, then fire `toggle`.
  // Modelled here so a keyboard test of a disclosure exercises the page's own
  // `toggle` binding rather than a click the shim invented.
  if (target.tagName === "SUMMARY" && (key === "Enter" || key === " ")) {
    const details = target.closest("details");
    if (details) {
      if (details.hasAttribute("open")) details.removeAttribute("open");
      else details.setAttribute("open", "");
      details.dispatchEvent(new DomEvent("toggle", { bubbles: false }));
      return document.activeElement;
    }
  }
  if (key === "Enter") {
    if (target.tagName === "A" || target.tagName === "BUTTON") target.click();
    else if (target.tagName === "INPUT" && target.type !== "radio" && target.type !== "checkbox") {
      // Implicit submission: Enter in a text field submits its form.
      target.closest("form")?.dispatchEvent(new DomEvent("submit", { bubbles: true }));
    }
  }
  if (key === " ") {
    if (target.tagName === "BUTTON" || (target.tagName === "INPUT" && ["radio", "checkbox"].includes(target.type))) {
      target.click();
    }
  }
  return document.activeElement;
}

export function pressEnter(document) { return pressKey(document, "Enter"); }
export function pressSpace(document) { return pressKey(document, " "); }

// Typing into the focused control, keystroke by keystroke as far as the page can
// tell: each character produces the `input` event the search filter listens for.
export function typeText(document, text) {
  const target = document.activeElement;
  if (!target) throw new Error("Nothing is focused, so there is nothing to type into.");
  for (const character of String(text)) {
    target.value = `${target.value}${character}`;
    target.dispatchEvent(new DomEvent("input", { bubbles: true }));
  }
  return target;
}

// --- environment -----------------------------------------------------------

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
    get length() { return values.size; },
  };
}

// Some of these (localStorage, fetch) are getter-only globals in current Node,
// so they are installed and restored through property descriptors rather than
// plain assignment.
const GLOBAL_KEYS = ["document", "window", "localStorage", "fetch", "Option", "FormData", "Blob"];

function defineGlobals(values) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: false });
  }
}

function restoreGlobals(descriptors) {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

class HarnessFormData {
  constructor(form) {
    this.entryList = [];
    for (const control of form.querySelectorAll("input,select,textarea")) {
      if (!control.name || control.disabled) continue;
      if ((control.type === "radio" || control.type === "checkbox") && !control.checked) continue;
      this.entryList.push([control.name, control.value]);
    }
  }

  get(name) { return this.entryList.find(([key]) => key === name)?.[1] ?? null; }
  entries() { return this.entryList[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entryList[Symbol.iterator](); }
}

// Stand up one page: real markup, empty-by-default browser storage, and a fetch
// that serves exactly the fixtures a test names. Every unlisted request throws,
// so a test can never accidentally depend on the network or on a file it did not
// declare.
export async function loadPage(pageUrl, { storage = {}, routes = {}, location = {} } = {}) {
  const html = await readFile(pageUrl, "utf8");
  const document = parseHtml(html);
  const browserStorage = createStorage(storage);
  const saved = Object.fromEntries(GLOBAL_KEYS
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const savedCreateObjectURL = URL.createObjectURL;
  const savedRevokeObjectURL = URL.revokeObjectURL;
  let objectUrlCount = 0;

  class HarnessBlob {
    constructor(parts) { this.text = parts.join(""); }
  }

  defineGlobals({
    document,
    window: {
      location: { hash: "", search: "", origin: "https://labs.wawalu.org", ...location },
      addEventListener() {},
    },
    localStorage: browserStorage,
    Blob: HarnessBlob,
    FormData: HarnessFormData,
    Option: function Option(label, value) {
      const option = document.createElement("option");
      option.textContent = label;
      option.setAttribute("value", value);
      return option;
    },
    fetch: async (url) => {
      if (!(url in routes)) throw new Error(`Unexpected network request in a test: ${url}`);
      return { ok: true, json: async () => structuredClone(routes[url]) };
    },
  });
  URL.createObjectURL = (blob) => {
    const href = `blob:shiplog/${(objectUrlCount += 1)}`;
    document.objectUrls.set(href, blob.text);
    return href;
  };
  URL.revokeObjectURL = () => {};

  return {
    document,
    storage: browserStorage,
    get downloads() { return document.downloads; },
    get navigations() { return document.navigations; },
    restore() {
      restoreGlobals(saved);
      URL.createObjectURL = savedCreateObjectURL;
      URL.revokeObjectURL = savedRevokeObjectURL;
    },
  };
}

export const textOf = (node) => node.textContent.replace(/\s+/g, " ").trim();
