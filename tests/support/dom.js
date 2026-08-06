// The smallest element stub the render layers actually use.
//
// The repo carries no browser dependency, so render-layer tests stand up this
// object instead: createElement, append/replaceChildren/remove, class, dataset,
// attribute, and listener access. It is enough to pin the structure that is easy
// to regress silently — the figure/caption pairing, the link targets, the alt
// text, the labelled tiles, and the loading/empty/error states — without
// pretending to be a browser. Anything needing real layout (offsetTop, focus
// order) belongs in a browser test, not here.

export function createElement(tagName) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    parent: null,
    attributes: {},
    dataset: {},
    listeners: {},
    className: "",
    hidden: false,
    ownText: "",
    // Focus is counted, not simulated: these tests assert that a control was
    // given focus after a re-render, which is a thing the render layer does.
    focused: 0,
    focus() { node.focused += 1; },
    get classes() { return node.className.split(" ").filter(Boolean); },
    classList: {
      add(...names) { node.className = [...new Set([...node.classes, ...names])].join(" "); },
      contains(name) { return node.classes.includes(name); },
    },
    get textContent() { return node.ownText || node.children.map((child) => child.textContent).join(" "); },
    set textContent(value) { node.ownText = String(value); node.children = []; },
    get firstChild() { return node.children[0] ?? null; },
    get lastChild() { return node.children.at(-1) ?? null; },
    append(...nodes) {
      for (const child of nodes) {
        child.parent = node;
        node.children.push(child);
      }
    },
    prepend(...nodes) {
      for (const child of [...nodes].reverse()) {
        child.parent = node;
        node.children.unshift(child);
      }
    },
    replaceChildren(...nodes) {
      node.children = [];
      node.ownText = "";
      node.append(...nodes);
    },
    remove() {
      if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node);
      node.parent = null;
    },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return node.attributes[name] ?? null; },
    removeAttribute(name) { delete node.attributes[name]; },
    addEventListener(type, handler) { (node.listeners[type] ??= []).push(handler); },
    dispatch(type, event) { for (const handler of node.listeners[type] ?? []) handler(event); },
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith(".")) return walk(node, (candidate) => candidate.classes.includes(selector.slice(1)));
      return walk(node, (candidate) => candidate.tagName === selector.toUpperCase());
    },
  };
  return node;
}

// The same stub for a namespaced element (the history trend chart's svg nodes).
// One difference matters: an SVG element has no writable `className`, so a view
// sets its class through setAttribute, and that has to reach the stub's class
// list or byClass would stop finding the node it just drew.
export function createElementNS(namespace, tagName) {
  const node = createElement(tagName);
  node.namespaceURI = namespace;
  const setAttribute = node.setAttribute;
  node.setAttribute = (name, value) => {
    if (name === "class") node.className = String(value);
    else setAttribute(name, value);
  };
  return node;
}

// Render modules read the global `document`, so a test file installs it once.
export function installDocument() {
  globalThis.document = {
    createElement,
    createElementNS,
    createTextNode(text) {
      const node = createElement("#text");
      node.textContent = text;
      return node;
    },
  };
}

export function walk(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of node.children) walk(child, predicate, found);
  return found;
}

export const byClass = (node, name) => walk(node, (candidate) => candidate.classes.includes(name));
export const first = (node, name) => byClass(node, name)[0] ?? null;
export const tags = (node, tagName) => walk(node, (candidate) => candidate.tagName === tagName);
export const ids = (node) => walk(node, () => true).map((candidate) => candidate.id).filter(Boolean);
