import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyTheme, DEFAULT_PAINT_RETURN, normalizedBlendMode, normalizedOpacity,
  PAINT_RETURN_LABELS, paintReturnContext,
  persistTheme, preferredTheme, storedTheme, THEME_KEY,
} from "../src/paint/paint.js";
import { navCurrentFor, SITE_NAV } from "../src/site-nav.js";
import { parseHtml, textOf } from "./support/browser.js";

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

/* ----------------------- the destination you are in ------------------------ */
// Paint is a full-screen workspace, so it carries no row of site links. It is
// still one of the destinations in src/site-nav.js, and a reader who took that
// link used to arrive somewhere whose only answer to "which one am I in?" was a
// wordmark reading "Paint" that navigated to Decisions. The answer now is the
// one every other page gives: the navigation's own name for this surface,
// carrying aria-current, marked in weight and a rule rather than in a hue.

const paintCss = () => readFile(new URL("../src/paint/paint.css", import.meta.url), "utf8");

// The declaration block a selector ships, read by exact selector text so a
// renamed or deleted rule fails here instead of making an assertion vacuous.
function declarations(css, selector) {
  const literal = selector.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
  const found = css.match(new RegExp(`^${literal} \\{([^}]*)\\}`, "m"));
  assert.ok(found, `no rule for ${selector}`);
  return found[1];
}

const channels = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
function relativeLuminance(hex) {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(foreground, background) {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// Both themes are one attribute on the root element, so both token sets live in
// this one stylesheet and the marker can be measured in each of them here.
function themeTokens(css, selector) {
  return Object.fromEntries(
    [...declarations(css, selector).matchAll(/--([a-z-]+):\s*(#[0-9a-f]{3,6})/gi)]
      .map(([, name, value]) => [name, value]),
  );
}

test("Paint names the destination it is, marks it current, and keeps the way home a link elsewhere", async () => {
  const document = parseHtml(await readFile(new URL("../src/paint/index.html", import.meta.url), "utf8"));
  const place = document.querySelector(".site-place");
  assert.ok(place, "the Paint header must carry a site-level landmark");
  assert.equal(place.tagName, "NAV");
  assert.equal(place.getAttribute("aria-label"), "Site", "named apart from the document actions beside it");

  const marked = place.querySelectorAll("a").filter((link) => link.getAttribute("aria-current") === "page");
  assert.equal(marked.length, 1, `${marked.length} controls in the Paint header claim to be the page`);
  assert.equal(marked[0].tagName, "A", "the current item stays an ordinary link, not a span");
  assert.equal(marked[0].getAttribute("href"), "/paint/");
  assert.equal(textOf(marked[0]), SITE_NAV.find((entry) => entry.href === "/paint/").label);
  // The name and the resolver agree: /paint/ is the destination this page is in.
  assert.equal(navCurrentFor("/paint/"), "/paint/");

  const home = place.querySelector(".brand");
  assert.equal(home.getAttribute("href"), "/", "the wordmark is the way out of the workspace");
  assert.equal(home.getAttribute("aria-current"), null, "a link elsewhere must not claim to be this page");
  assert.equal(textOf(home), "Shiplog", "the wordmark names the product, not the surface it leaves");
  // The visible word is inside the accessible name, so voice control and the
  // screen reader ask for the same thing.
  assert.match(home.getAttribute("aria-label"), /Shiplog/);

  // Nothing here buys a place in the tab order or gives one up.
  for (const link of place.querySelectorAll("a")) {
    assert.equal(link.getAttribute("tabindex"), null, `"${textOf(link)}" sets tabindex`);
    assert.ok(link.getAttribute("href"), `"${textOf(link)}" is not reachable as a link`);
  }
});

test("the Paint marker is drawn in weight and a rule, and holds its contrast in both themes", async () => {
  const css = await paintCss();
  const current = declarations(css, '.site-place a[aria-current="page"]');
  const base = declarations(css, ".site-place-current");

  // Keyed off the attribute, so the state a reader hears and the state a reader
  // sees are one fact that cannot drift into two.
  assert.match(current, /font-weight:\s*750/, "the marker must promote the weight");
  assert.match(current, /box-shadow:\s*inset 0 -2px 0 currentColor/, "the marker must carry a rule, not a hue");
  const resting = Number(base.match(/font-weight:\s*(\d+)/)?.[1]);
  assert.ok(resting < 750, `the marker promotes from ${resting}, so weight is a real difference`);
  // Never the accent: review-08-foundations flags blue as both the input series
  // and the selection colour, so a marker drawn in it reads as one of those.
  assert.doesNotMatch(current, /--accent/, "the marker must not be drawn in the ambiguous blue");
  // The ring is a different property with a different geometry, drawn outside
  // the box the rule sits inside. The marker neither restyles nor suppresses it.
  assert.doesNotMatch(current, /outline/, "the marker must not touch the focus ring");
  assert.match(css, /a:focus-visible\s*\{\s*outline:\s*3px solid var\(--focus\)/);

  for (const [theme, selector] of [["light", ":root"], ["dark", ':root[data-theme="dark"]']]) {
    const tokens = themeTokens(css, selector);
    // The rule is drawn in currentColor, so the marker's ink is the rule's ink:
    // one measurement covers the word and the band under it.
    const marker = contrastRatio(tokens.text, tokens.surface);
    const sibling = contrastRatio(tokens.muted, tokens.surface);
    assert.ok(marker >= 4.5, `${theme}: the marker measures ${marker.toFixed(2)}:1 on the header`);
    assert.ok(marker >= sibling, `${theme}: the marker is dimmer than the type beside it`);
    assert.ok(contrastRatio(tokens.focus, tokens.surface) >= 3, `${theme}: the focus ring must stay visible`);
  }
});

test("the destination name survives the narrow header, where the wordmark folds to its mark", async () => {
  const css = await paintCss();
  const phone = css.match(/@media \(max-width: 560px\) \{([\s\S]*?)\n\}/)[1];
  assert.match(phone, /\.site-place-current \{[^}]*font-size: 12px/, "the name stays, one size down");
  assert.doesNotMatch(phone, /\.site-place[^{]*\{[^}]*display:\s*none/, "the narrow header must not drop the name");
  assert.doesNotMatch(phone, /\.site-place a\[aria-current="page"\] \{/, "the breakpoint must not restyle the marker");
  // It is the only thing left on a phone that says which destination this is:
  // the wordmark next to it is reduced to its mark by the rule above.
  assert.match(phone, /\.brand span:last-child \{ position: absolute;/);
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
