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
    addEventListener(type, handler) { (node.listeners[type] ??= []).push(handler); },
    dispatch(type) { for (const handler of node.listeners[type] ?? []) handler(); },
    querySelector(selector) {
      if (selector.startsWith(".")) return walk(node, (candidate) => candidate.classes.includes(selector.slice(1)))[0] ?? null;
      return walk(node, (candidate) => candidate.tagName === selector.toUpperCase())[0] ?? null;
    },
  };
  return node;
}

// Render modules read the global `document`, so a test file installs it once.
export function installDocument() {
  globalThis.document = {
    createElement,
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
