import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyTheme, DEFAULT_PAINT_RETURN, normalizedBlendMode, normalizedOpacity,
  PAINT_RETURN_LABELS, paintReturnContext,
  persistTheme, preferredTheme, storedTheme, THEME_KEY,
} from "../src/paint/paint.js";
import { SITE_NAV } from "../src/site-nav.js";

test("paint shell has semantic navigation and an accessible canvas", async () => {
  const html = await readFile(new URL("../src/paint/index.html", import.meta.url), "utf8");
  assert.match(html, /<header class="app-header">/);
  assert.match(html, /<nav class="header-actions" aria-label="Document actions">/);
  assert.match(html, /id="paint-return" href="\/social\.html">Back to Social<\/a>/);
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

test("Paint preserves a safe, exact path back to the People view that opened it", () => {
  assert.deepEqual(paintReturnContext("?from=profile&author=Mina+O%27Neil"), {
    href: "/profile.html?author=Mina%20O'Neil",
    label: "Back to People",
  });
  // Arriving from People without a usable name still returns to People: only
  // the name is untrusted, so only the name is dropped.
  for (const search of ["?from=profile", `?from=profile&author=${"x".repeat(61)}`]) {
    assert.deepEqual(paintReturnContext(search), {
      href: "/profile.html",
      label: "Back to People",
    });
  }
  // An origin that is not one of ours is not an origin: back to the feed.
  for (const search of ["?from=https://evil.invalid&author=Mina", "?from=elsewhere", ""]) {
    assert.deepEqual(paintReturnContext(search), {
      href: "/social.html",
      label: "Back to Social",
    });
  }
  // Every destination stays same-origin and relative.
  for (const search of ["?from=profile&author=//evil.invalid", "?from=profile&author=Ari"]) {
    assert.ok(paintReturnContext(search).href.startsWith("/profile.html"));
    assert.doesNotMatch(paintReturnContext(search).href, /^\/\/|:/);
  }
});

test("Paint's back link is spelled with the navigation's names for those surfaces", () => {
  // Not synonyms: "feed" and "profile" name no entry a reader has ever seen in
  // the nav, and "Profile" is the word site-nav.js deliberately retired.
  assert.deepEqual(PAINT_RETURN_LABELS, {
    social: `Back to ${SITE_NAV.find((entry) => entry.href === "/social.html").label}`,
    people: `Back to ${SITE_NAV.find((entry) => entry.href === "/profile.html").label}`,
  });
  assert.equal(DEFAULT_PAINT_RETURN.label, PAINT_RETURN_LABELS.social);
  for (const label of Object.values(PAINT_RETURN_LABELS)) {
    assert.doesNotMatch(label, /feed|profile/i, "the label names something the nav does not");
  }
});

test("Paint navigation keeps focus and narrow-layout safeguards", async () => {
  const css = await readFile(new URL("../src/paint/paint.css", import.meta.url), "utf8");
  assert.match(css, /a:focus-visible\s*\{\s*outline:\s*3px solid var\(--focus\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.app-header \{ grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.header-actions \{ min-width: 0;/);
  assert.doesNotMatch(css, /@media \(max-width: 560px\)[\s\S]*\.return-action \{[^}]*display:\s*none/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*\.theme-toggle \{ display: none; \}/);
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
