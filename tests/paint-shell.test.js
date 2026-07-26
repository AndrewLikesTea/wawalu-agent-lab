import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyTheme, initJourney, normalizedBlendMode, normalizedOpacity, persistTheme, preferredTheme, storedTheme, THEME_KEY } from "../src/paint/paint.js";
import { block, rule } from "./support/css.js";

const anchor = () => ({ href: "", textContent: "" });

function journeyShell(search) {
  const nodes = { "#journey-primary": anchor(), "#journey-secondary": anchor() };
  const root = { querySelector: (selector) => nodes[selector] ?? null };
  initJourney(root, { location: { search } });
  return nodes;
}

test("paint shell has semantic navigation and an accessible canvas", async () => {
  const html = await readFile(new URL("../src/paint/index.html", import.meta.url), "utf8");
  assert.match(html, /<header class="app-header">/);
  assert.match(html, /<nav class="header-actions" aria-label="Document actions">/);
  assert.match(html, /<div class="creation-route">/);
  assert.match(html, /<strong>Create your image here\.<\/strong>/);
  // The landmark holds the destinations only; the instructions sit outside it.
  assert.match(html, /<nav class="creation-route-links" aria-label="Leave the editor">/);
  assert.doesNotMatch(html, /<nav[^>]*class="creation-route"/);
  // Static hrefs, so the way out survives a page whose module never loads.
  assert.match(html, /id="journey-primary" href="\/profile\.html">Go to your profile<\/a>/);
  assert.match(html, /id="journey-secondary" href="\/social\.html">Go to team feed<\/a>/);
  assert.match(html, /<main class="editor" aria-label="Image editor">/);
  assert.match(html, /<aside class="tool-rail" aria-label="Editing tools">/);
  assert.match(html, /id="editor-canvas" tabindex="0" role="region"/);
  assert.match(html, /<canvas id="paint-canvas" width="1200" height="800" aria-label="Editable image">/);
  assert.match(html, /class="skip-link" href="#editor-canvas"/);
  assert.match(html, /id="file-input" type="file" accept="image\/png,image\/jpeg,image\/webp,image\/gif"/);
  assert.match(html, /data-tool="brush"/);
  assert.match(html, /data-tool="rectangle"/);
  assert.match(html, /data-filter="grayscale"/);
  assert.match(html, /<select id="blend-mode">/);
  assert.match(html, /id="layer-opacity" type="range" min="0" max="100"/);
  assert.match(html, /id="layer-visibility" type="button" aria-label="Hide Bitmap layer" aria-pressed="true"/);
  assert.match(html, /class="layer-empty" hidden/);
  assert.match(html, /class="layer-error" role="status" hidden/);
  assert.match(html, /id="publish-button"[^>]*>Use in post/);
  assert.match(html, /id="publish-status" role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("paint journey links remain visible, focusable, and responsive", async () => {
  const css = await readFile(new URL("../src/paint/paint.css", import.meta.url), "utf8");
  assert.match(css, /a:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
  assert.match(rule(css, ".creation-route a"), /min-height:40px/);

  // Scoped to the block: the phone rules have to be inside the phone media
  // query, not merely somewhere further down the file.
  const phone = block(css, "@media (max-width: 560px)");
  assert.match(rule(phone, ".creation-route"), /flex-direction:column/);
  assert.doesNotMatch(rule(phone, ".creation-route"), /display:\s*none/);
  // The header drops its secondary action at this width; the way out must not
  // follow it, and must stay a thumb-sized target.
  assert.match(rule(phone, ".secondary-action"), /display:\s*none/);
  assert.match(rule(phone, ".creation-route a"), /min-height:44px/);
});

test("paint's escape links are relabelled with the page the visitor came from", () => {
  const fromProfile = journeyShell("?from=profile&author=Mina");
  assert.equal(fromProfile["#journey-primary"].textContent, "Back to Mina’s profile");
  assert.equal(fromProfile["#journey-primary"].href, "/profile.html?author=Mina");
  assert.equal(fromProfile["#journey-secondary"].textContent, "Go to team feed");

  // No query string, no JavaScript-supplied context: the static markup stands.
  const direct = journeyShell("");
  assert.equal(direct["#journey-primary"].textContent, "Go to your profile");
  assert.equal(direct["#journey-primary"].href, "/profile.html");
});

test("a shell without the escape links initialises instead of throwing", () => {
  const root = { querySelector: () => null };
  assert.doesNotThrow(() => initJourney(root, {}));
});

test("layer appearance inputs safely handle empty and implausible extremes", () => {
  assert.equal(normalizedOpacity(-900), 0);
  assert.equal(normalizedOpacity(900), 100);
  assert.equal(normalizedOpacity("not a number"), 100);
  assert.equal(normalizedBlendMode("multiply"), "multiply");
  assert.equal(normalizedBlendMode("unexpected-mode"), "normal");
});

test("paint ships as a self-contained static application", async () => {
  const [html, script, engine] = await Promise.all([
    readFile(new URL("../src/paint/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/paint/paint.js", import.meta.url), "utf8"),
    readFile(new URL("../src/paint/paint-engine.js", import.meta.url), "utf8"),
  ]);
  const source = `${html}\n${script}\n${engine}`;
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|https?:\/\//);
  assert.match(script, /createImageBitmap/);
  assert.match(engine, /getContext\("webgl"/);
  assert.match(script, /writePaintHandoff/);
});

test("theme preference accepts only supported stored values", () => {
  const storage = { getItem: () => "sepia" };
  assert.equal(storedTheme(storage), null);
  assert.equal(preferredTheme(storage, { matches: true }), "dark");
  assert.equal(preferredTheme({ getItem: () => "light" }, { matches: true }), "light");
});

test("theme storage failures degrade to the system preference", () => {
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.equal(preferredTheme(storage, { matches: false }), "light");
  assert.equal(persistTheme(storage, "dark"), false);
  assert.equal(persistTheme(storage, "contrast"), false);
});

test("applying a theme keeps visual and accessible toggle state aligned", () => {
  const root = { dataset: {} };
  const attributes = {};
  const button = { setAttribute: (name, value) => { attributes[name] = value; } };
  assert.equal(applyTheme(root, button, "dark"), "dark");
  assert.deepEqual(attributes, {
    "aria-pressed": "true",
    "aria-label": "Switch to light mode",
  });
  assert.equal(applyTheme(root, button, "light"), "light");
  assert.equal(attributes["aria-pressed"], "false");
  assert.equal(attributes["aria-label"], "Switch to dark mode");
});

test("theme uses a stable namespaced storage key", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(persistTheme(storage, "dark"), true);
  assert.equal(values.get(THEME_KEY), "dark");
  assert.equal(storedTheme(storage), "dark");
});
