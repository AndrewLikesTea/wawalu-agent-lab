import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyTheme,
  normalizeOpacity,
  opacityLabel,
  persistTheme,
  preferredTheme,
  setLayerPanelState,
  storedTheme,
  syncOpacity,
  THEME_KEY,
} from "../src/paint/paint.js";

test("paint shell has semantic navigation and an accessible canvas", async () => {
  const html = await readFile(new URL("../src/paint/index.html", import.meta.url), "utf8");
  assert.match(html, /<header class="app-header">/);
  assert.match(html, /<nav class="header-actions" aria-label="Document actions">/);
  assert.match(html, /<main class="editor" aria-label="Image editor">/);
  assert.match(html, /<aside class="tool-rail" aria-label="Editing tools">/);
  assert.match(html, /id="editor-canvas" tabindex="0" role="region"/);
  assert.match(html, /<canvas width="1200" height="800" aria-label="Blank image">/);
  assert.match(html, /class="skip-link" href="#editor-canvas"/);
});

test("layer appearance controls expose labels, values, help, and native keyboard controls", async () => {
  const html = await readFile(new URL("../src/paint/index.html", import.meta.url), "utf8");
  assert.match(html, /<fieldset class="appearance-controls"/);
  assert.match(html, /<label for="blend-mode">Blend mode<\/label>/);
  assert.match(html, /<select id="blend-mode"/);
  assert.match(html, /<label for="layer-opacity">Opacity<\/label>/);
  assert.match(html, /type="range" min="0" max="100" step="1" value="100"/);
  assert.match(html, /<output id="opacity-value" for="layer-opacity" aria-live="polite">100%<\/output>/);
  assert.match(html, /role="status" aria-live="polite" hidden/);
});

test("opacity clamps implausible values and keeps visible and spoken values aligned", () => {
  assert.equal(normalizeOpacity(-900), 0);
  assert.equal(normalizeOpacity(900), 100);
  assert.equal(normalizeOpacity("49.6"), 50);
  assert.equal(normalizeOpacity("not-a-number"), 100);
  assert.equal(opacityLabel(0), "0%");

  const attributes = {};
  const input = { value: "184", setAttribute: (name, value) => { attributes[name] = value; } };
  const output = { value: "", textContent: "" };
  assert.equal(syncOpacity(input, output), 100);
  assert.equal(input.value, "100");
  assert.equal(output.textContent, "100%");
  assert.equal(attributes["aria-valuetext"], "100%");
});

test("layer loading, empty, error, and ready states remain explicit", () => {
  const classes = new Set();
  const section = {
    classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
    setAttribute(name, value) { this[name] = value; },
  };
  const state = { hidden: true, dataset: {}, textContent: "" };

  assert.equal(setLayerPanelState(section, state, "loading"), "loading");
  assert.equal(state.hidden, false);
  assert.match(state.textContent, /Loading/);
  assert.equal(section["aria-busy"], "true");
  assert.equal(setLayerPanelState(section, state, "empty"), "empty");
  assert.match(state.textContent, /No layers/);
  assert.equal(setLayerPanelState(section, state, "error", "Connection lost."), "error");
  assert.equal(state.textContent, "Connection lost.");
  assert.equal(setLayerPanelState(section, state, "ready"), "ready");
  assert.equal(state.hidden, true);
  assert.equal(classes.has("is-unavailable"), false);
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
