// The AI literacy grade, legible and defensible at a glance (#998).
//
// The card publishes one letter. Whether that letter may be acted on is
// decided by three things it never published: how much of the money was
// graded, how confident that makes the letter, and which band it sits in. The
// band existed only as a tint on the glyph, which is meaning carried by colour
// alone and is gone in a greyscale screenshot, in high-contrast mode, and for
// anyone who cannot separate the amber from the green.
//
// So four things are held here:
//
//   1. ONE READING ORDER, IN EVERY STATE. The four slots are emitted in
//      document order — letter, coverage, confidence, band — and no state
//      removes one. Loading, empty, withheld, error, and the implausible
//      extremes are the same four nodes saying different words. A state that
//      deletes a node reflows the card under a reader mid-sentence.
//   2. THE LETTER IS DOMINANT. Not one of five equal tiles: the glyph is
//      multiples of the type size of everything under it, and the two figures
//      that qualify it are the next thing in the document.
//   3. NOTHING IS TOLD BY COLOUR ALONE. The band ships a word and a numeric
//      range, confidence ships a word and its threshold, coverage leads with
//      its own percentage. Each survives greyscale on its own.
//   4. THE DETAIL IS DISCLOSED, NOT HIDDEN. A native disclosure whose closed
//      summary states the department count, so a keyboard or screen-reader
//      reader knows there is something to open before they open it.
//
// Contrast is measured from src/evolution.css itself rather than asserted from
// memory, and the ratios are printed with `diagnostic` so the numbers are in
// the run. A future edit to a token or a pairing fails here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  LITERACY_CLAMP_NOTE, LITERACY_CONFIDENCE, LITERACY_CONFIDENCE_PENDING, LITERACY_SLOT_IDS,
  applyLiteracyCard, literacyCardModel, literacyDrivers,
} from "../src/finops-literacy-card.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = new URL("../src/evolution.css", import.meta.url);
const css = await readFile(CSS, "utf8");
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const byId = (document, id) => document.getElementById(id);
const openPage = () => loadPage(PAGE);

/** The four slots the card actually emitted, in document order. */
function slotOrder(document) {
  return byId(document, "score-card").querySelectorAll("[data-literacy-slot]")
    .map((node) => node.getAttribute("data-literacy-slot"));
}

/** A department row as the page hands one over. */
const department = (name, score) => ({ name, graded: score !== null, score });

// --- the shipped card -------------------------------------------------------

test("the letter is the dominant element, and coverage then confidence follow it", async () => {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");

  // The contract, on the live card and not on a demo surface beside it.
  assert.deepEqual(slotOrder(document), [...LITERACY_SLOT_IDS]);

  // Dominance is a type-size ratio, not an opinion. The letter is 66px; the
  // two figures under it are 13px, and the band chip is 11px.
  assert.match(declared(".score-grade", "font-size"), /^66px$/);
  assert.match(declared(".score-coverage,.score-confidence", "font-size"), /^13px$/);
  assert.match(declared(".score-band", "font"), /11px/);

  // Every slot says something, and the two figures lead with their own value.
  for (const id of LITERACY_SLOT_IDS) {
    assert.ok(textOf(byId(document, id)).length > 0, `${id} is empty on the shipped card`);
  }
  assert.match(textOf(byId(document, "score-coverage")), /^\d+(\.\d+)?% of spend scored/,
    "the coverage figure must lead with its own percentage");
  assert.match(textOf(byId(document, "score-confidence")), /^(High|Moderate|Provisional|Not established)/,
    "confidence must lead with a word, not with a colour");
  assert.match(textOf(byId(document, "score-band")), /^(Good|Watch|Poor|Under review) · /,
    "the band must be a word and a range, not a tint on the glyph");

  // Two to three drivers, readable without expanding anything.
  const why = textOf(byId(document, "score-why"));
  assert.match(why, /^Why this letter: /);
  assert.ok(why.split(";").length >= 2 && why.split(";").length <= 3,
    `the summary must name two or three drivers, got "${why}"`);

  // The closed disclosure states how much is inside it.
  assert.equal(byId(document, "score-detail").hasAttribute("open"), false,
    "the detail starts closed");
  assert.match(textOf(byId(document, "score-detail-summary")),
    /^Per-department scores and the rubric · \d+ departments?$/);
  assert.ok(byId(document, "score-detail-list").children.length > 0,
    "the disclosure names the departments its summary counted");
});

test("the grade change is announced from a region that is not inside a disclosure", async () => {
  const { document } = await openPage();
  // The page speaks through exactly one region. What matters for this card is
  // where that region lives: a live region nested inside a closed disclosure
  // reads fine to this harness and is silent in a real browser, because a
  // browser does not compute or announce the subtree of a closed details.
  const live = byId(document, "finops-stand-live");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(live.getAttribute("role"), "status");
  assert.ok(live.closest("details") === null,
    "the announcer sits inside collapsed content, where it never speaks");

  // And the card adds no second voice of its own — one import, one utterance.
  assert.equal(byId(document, "score-card").querySelectorAll(
    '[aria-live], [role="status"], [role="alert"]').length, 0,
  "the literacy card must not announce; the page already has one announcer");
});

test("the disclosure is reachable and operable from the keyboard alone", async () => {
  const { document } = await openPage();
  const summary = byId(document, "score-detail-summary");
  assert.equal(summary.tagName, "SUMMARY", "a native disclosure, not a click-handled div");

  const order = tabSequence(document).map((node) => node.id || node.tagName);
  assert.ok(order.includes("score-detail-summary"), "the summary is in the document's tab order");

  let focused = null;
  for (let step = 0; step <= order.length && focused?.id !== "score-detail-summary"; step += 1) {
    focused = pressTab(document);
  }
  assert.equal(focused?.id, "score-detail-summary");
  pressEnter(document);
  assert.equal(byId(document, "score-detail").hasAttribute("open"), true,
    "Enter on the summary opens the detail");
  assert.equal(document.activeElement?.id, "score-detail-summary",
    "focus is never stranded by the toggle");
  pressEnter(document);
  assert.equal(byId(document, "score-detail").hasAttribute("open"), false);

  // The focus indicator is a ring, not a hairline, and the control has a
  // visible edge before it is focused at all.
  assert.equal(declared(".score-detail>summary:focus-visible", "outline").startsWith("3px solid"), true);
  assert.match(declared(".score-detail>summary", "border"), /^1px solid/);
  assert.match(declared(".score-detail>summary", "min-height"), /^44px$/);
});

test("the card joins the page outline without inventing a heading level", async () => {
  const { document } = await openPage();
  const card = byId(document, "score-card");
  assert.equal(card.getAttribute("aria-labelledby"), "score-card-title");
  // The panel is labelled by its eyebrow rather than by a heading of its own,
  // exactly as it shipped. Adding an h2 here would put a second heading at the
  // page's panel level for one card, and adding an h3 would skip a level.
  assert.equal(card.querySelectorAll("h1,h2,h3,h4,h5,h6").length, 0);
  // The disclosure's list is labelled by the summary that counts it, so the
  // rows are not an orphan list to anything walking the accessibility tree.
  assert.equal(byId(document, "score-detail-list").getAttribute("aria-labelledby"),
    "score-detail-summary");
  for (const [value, label] of [["score-coverage", "score-coverage-label"],
    ["score-confidence", "score-confidence-label"]]) {
    assert.equal(byId(document, value).getAttribute("aria-describedby"), label);
  }
});

// --- every state ------------------------------------------------------------

/**
 * The states this card can be in, each one a model rather than a layout. The
 * loading state is the authored document with nothing painted over it, so it is
 * expressed as `null` and asserted before any paint happens.
 */
const STATES = [
  ["normal graded", literacyCardModel({
    tier: "high", band: "good", coverage: 0.92, rule: "At least 80% of imported spend was scored.",
    mix: { highValue: 0.62, overProvisioned: 0.21, inefficient: 0.12, outOfScope: 0.05 },
    departments: [department("Atlas Platform", 84), department("Boreal Support", 71)],
  })],
  ["empty · 0% coverage", literacyCardModel({
    tier: "insufficient", band: "review", coverage: 0,
    departments: [department("Atlas Platform", null)],
  })],
  ["withheld · no conversation export", literacyCardModel({ tier: null, band: "review" })],
  ["error · the bundle never loaded", literacyCardModel({
    tier: "no_baseline", band: "review", rule: "No positive imported spend total exists.",
  })],
  ["extreme · 100% coverage", literacyCardModel({
    tier: "high", band: "good", coverage: 1,
    mix: { highValue: 1, overProvisioned: 0, inefficient: 0, outOfScope: 0 },
    departments: [department("Atlas Platform", 91)],
  })],
  ["extreme · a clamped over-100 input", literacyCardModel({
    tier: "high", band: "good", coverage: 1, clamped: true,
    departments: [department("Atlas Platform", 88)],
  })],
  ["extreme · missing confidence", literacyCardModel({ band: "watch" })],
];

test("no state collapses the layout, and every one keeps the same reading order", async () => {
  // Loading: nothing has been painted, and the four slots are already there.
  const loading = (await openPage()).document;
  assert.deepEqual(slotOrder(loading), [...LITERACY_SLOT_IDS]);
  for (const id of LITERACY_SLOT_IDS) {
    assert.ok(textOf(byId(loading, id)).length > 0, `${id} is blank before the first paint`);
  }

  for (const [name, model] of STATES) {
    const { document } = await openPage();
    applyLiteracyCard(document, model);
    assert.deepEqual(slotOrder(document), [...LITERACY_SLOT_IDS], `${name} reordered the card`);
    for (const id of [...LITERACY_SLOT_IDS, "score-why", "score-detail-summary"]) {
      assert.ok(textOf(byId(document, id)).length > 0, `${name} left ${id} empty`);
    }
    // The disclosure survives every state, and its closed summary still says
    // whether there is anything inside it.
    assert.equal(byId(document, "score-detail").hasAttribute("open"), false, `${name} forced the detail open`);
    assert.match(textOf(byId(document, "score-detail-summary")), /^Per-department scores and the rubric · /);
    assert.ok(byId(document, "score-detail-list").children.length > 0,
      `${name} emptied the disclosure instead of saying it is empty`);
  }
});

test("extremes · 0%, 100%, a clamp, and a missing confidence each say which they are", () => {
  const zero = literacyCardModel({
    tier: "insufficient", band: "review", coverage: 0,
    departments: [department("Atlas Platform", null)],
  });
  assert.equal(zero.confidence, LITERACY_CONFIDENCE.insufficient);
  assert.equal(zero.bandLine, "Under review · no letter published");
  assert.match(zero.why, /1 of 1 departments carried no scored sample/);

  const full = literacyCardModel({
    tier: "high", band: "good", coverage: 1,
    departments: [department("Atlas Platform", 91)],
  });
  assert.equal(full.confidence, LITERACY_CONFIDENCE.high);
  assert.equal(full.bandLine, "Good · score 80–100");
  assert.match(full.why, /all 1 departments carried a scored sample/);

  // An input where covered spend exceeded the total it is a share of. The
  // coverage figure upstream is clamped to 100%; the card says so rather than
  // publishing a confident letter over arithmetic that did not close.
  const clamped = literacyCardModel({ tier: "high", band: "good", coverage: 1, clamped: true });
  assert.ok(clamped.confidence.endsWith(LITERACY_CLAMP_NOTE),
    `a clamped input must name the clamp, got "${clamped.confidence}"`);

  // No tier at all, and a zero-length one: both are "not established", never a
  // zero confidence, which would read as a measurement.
  assert.equal(literacyCardModel({}).confidence, LITERACY_CONFIDENCE_PENDING);
  assert.equal(literacyCardModel({ tier: "" }).confidence, LITERACY_CONFIDENCE_PENDING);
  assert.equal(literacyCardModel({ tier: "not_a_tier" }).confidence, LITERACY_CONFIDENCE_PENDING);

  // And no state ever prints a bare zero as if somebody measured it.
  assert.equal(literacyDrivers({}).length, 0);
  assert.match(literacyCardModel({}).why, /no scored sample has been read/);
});

test("a department name made of markup reaches the disclosure as text, never as a node", async () => {
  const { document } = await openPage();
  const shipped = document.querySelectorAll("script").length;
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  applyLiteracyCard(document, literacyCardModel({
    tier: "high", band: "good", departments: [department(hostile, 80)],
  }));
  assert.match(textOf(byId(document, "score-detail-list")), /<img src=x onerror="alert\(1\)">/);
  assert.equal(document.querySelectorAll("img").length, 0);
  assert.equal(document.querySelectorAll("script").length, shipped);

  // A long name wraps rather than being clipped: this row is the evidence for
  // the coverage figure above it, so a truncated one is an unaccountable one.
  for (const selector of [".score-coverage,.score-confidence", ".score-band", ".score-why",
    ".score-detail-list li", ".score-detail-rule"]) {
    assert.equal(declared(selector, "overflow-wrap"), "anywhere", `${selector} must break rather than overflow`);
  }
  const cardRules = [...css.matchAll(/(?:^|\})\s*([^{}]*score-(?:grade|coverage|confidence|band|why|figure|detail)[^{}]*)\{([^}]*)\}/g)];
  assert.ok(cardRules.length > 8, "the card's selectors were found");
  for (const [, selector, body] of cardRules) {
    assert.equal(/text-overflow/.test(body), false, `${selector.trim()} truncates with an ellipsis`);
    assert.equal(/white-space\s*:\s*nowrap/.test(body), false, `${selector.trim()} refuses to wrap`);
  }
});

// --- contrast ---------------------------------------------------------------

const TOKENS = new Map(
  [...(css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value.trim()]),
);
// Declared in src/styles.css's `:root`, which this stylesheet layers on. Named
// here rather than resolved because the two files are read separately, and
// asserted against that file below so the constants cannot drift silently.
const SHARED = new Map([["--focus-ring", "#155f9e"]]);
const PAGE_INK = "#171713";
const PAGE_BG = "#f3f1eb";

/** Resolve `var(--x)` one level deep — the depth this stylesheet actually uses. */
function color(value) {
  const named = value.match(/^var\((--[\w-]+)\)$/);
  const resolved = named ? TOKENS.get(named[1]) ?? SHARED.get(named[1]) : value;
  assert.ok(resolved, `no value for ${value}`);
  return resolved.trim();
}

/** The declared value of one property on one selector, top-level rules only. */
function declared(selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(rule, `no rule for ${selector}`);
  const found = rule[1].match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  assert.ok(found, `${selector} declares no ${property}`);
  return found[1].trim();
}

function channel(value) {
  const linear = value / 255;
  return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
}

/** `#fff` and `#ffffff` are the same colour; the stylesheet uses both spellings. */
function expand(hex) {
  const digits = hex.replace("#", "");
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits}`;
}

function luminance(hex) {
  const n = parseInt(expand(hex).slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

/** Flatten a translucent layer onto an opaque one, so a ratio means something. */
function over(top, bottom, alpha) {
  const parts = (hex) => [1, 3, 5].map((at) => parseInt(expand(hex).slice(at, at + 2), 16));
  const [f, b] = [parts(top), parts(bottom)];
  return `#${f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha))
    .toString(16).padStart(2, "0")).join("")}`;
}

function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const CARD_BG = over("#ffffff", PAGE_BG, 0.72);
const REVIEW_BG = () => color(declared('.score-card[data-band="review"]', "background"));
const CHIP_BG = () => color(declared(".score-band", "background"));

test("every pairing this card draws clears WCAG AA on the background it is drawn on", async (t) => {
  // The two constants above are read from the files that own them, so a change
  // there fails here instead of quietly invalidating every ratio below.
  const shared = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(shared, new RegExp(`--focus-ring:${SHARED.get("--focus-ring")}`));
  assert.match(shared, new RegExp(`color:${PAGE_INK}`));
  assert.match(shared, new RegExp(`background:${PAGE_BG}`));
  assert.match(declared(".score-card", "background"), /rgba\(255,255,255,\.72\)/,
    "the flattened card fill below assumes this alpha");

  const text = [
    ["good letter", declared('.score-card[data-band="good"] .score-grade', "color"), CARD_BG],
    ["watch letter", declared('.score-card[data-band="watch"] .score-grade', "color"), CARD_BG],
    ["poor letter", declared('.score-card[data-band="poor"] .score-grade', "color"), CARD_BG],
    ["withheld letter on its own wash",
      declared('.score-card[data-band="review"] .score-grade', "color"), REVIEW_BG()],
    ["coverage and confidence values", PAGE_INK, CARD_BG],
    ["coverage and confidence values on the withheld wash", PAGE_INK, REVIEW_BG()],
    ["their labels", declared(".score-figure-label", "color"), CARD_BG],
    ["the why-this-letter summary", PAGE_INK, CARD_BG],
    ["band chip · unbanded", declared(".score-band", "color"), CHIP_BG()],
    ["band chip · good", declared('.score-card[data-band="good"] .score-band', "color"), CHIP_BG()],
    ["band chip · watch", declared('.score-card[data-band="watch"] .score-band', "color"), CHIP_BG()],
    ["band chip · poor", declared('.score-card[data-band="poor"] .score-band', "color"), CHIP_BG()],
    ["band chip · under review", declared('.score-card[data-band="review"] .score-band', "color"), CHIP_BG()],
    ["disclosure summary label", declared(".score-detail>summary", "color"),
      declared(".score-detail>summary", "background")],
    ["an ungraded department row", declared('.score-detail-list li[data-graded="false"]', "color"), CARD_BG],
    ["the rubric rule under the rows", declared(".score-detail-rule", "color"), CARD_BG],
  ];
  for (const [name, foreground, background] of text) {
    const measured = ratio(color(foreground), color(background));
    t.diagnostic(`text  ${measured.toFixed(2)}:1  ${name}`);
    assert.ok(measured >= 4.5, `${name} is ${measured.toFixed(2)}:1, below the 4.5:1 AA text floor`);
  }

  // 1.4.11: the edge that says "this is a control", the ring that says "you are
  // here", and the chip edge that repeats the band all stand on their own.
  const nonText = [
    ["disclosure summary border", declared(".score-detail>summary", "border").split(" ").pop(),
      declared(".score-detail>summary", "background")],
    ["focus ring on the summary", declared(".score-detail>summary:focus-visible", "outline").split(" ").pop(), CARD_BG],
    ["band chip edge · unbanded", declared(".score-band", "border").split(" ").pop(), CHIP_BG()],
    ["band chip edge · good", declared('.score-card[data-band="good"] .score-band', "border-color"), CHIP_BG()],
    ["band chip edge · watch", declared('.score-card[data-band="watch"] .score-band', "border-color"), CHIP_BG()],
    ["band chip edge · poor", declared('.score-card[data-band="poor"] .score-band', "border-color"), CHIP_BG()],
    ["band chip edge · under review", declared('.score-card[data-band="review"] .score-band', "border-color"), CHIP_BG()],
    ["the ungraded row's leading rule", declared('.score-detail-list li[data-graded="false"]', "border-left").split(" ").pop(), CARD_BG],
  ];
  for (const [name, foreground, background] of nonText) {
    const measured = ratio(color(foreground), color(background));
    t.diagnostic(`shape ${measured.toFixed(2)}:1  ${name}`);
    assert.ok(measured >= 3, `${name} is ${measured.toFixed(2)}:1, below the 3:1 AA non-text floor`);
  }
});

test("no slot on this card is told by colour, and none of them signals with opacity", () => {
  // Every band reads as itself with the stylesheet deleted: the word and the
  // range are in the text node, not in the border-colour beside it.
  for (const [key, word, range] of [["good", "Good", "score 80–100"], ["watch", "Watch", "score 65–79"],
    ["poor", "Poor", "score 0–64"], ["review", "Under review", "no letter published"]]) {
    assert.equal(literacyCardModel({ band: key }).bandLine, `${word} · ${range}`);
  }
  // The withheld band carries a second static channel too — a dashed edge on
  // the chip and on the card, so a screenshot separates it from a published
  // band with no colour at all.
  assert.match(declared('.score-card[data-band="review"] .score-band', "border-style"), /dashed/);
  assert.match(declared('.score-card[data-band="review"]', "border-style"), /dashed/);

  for (const selector of [".score-band", ".score-figure-label", ".score-why",
    '.score-card[data-band="good"] .score-band', '.score-card[data-band="poor"] .score-band']) {
    const rule = css.match(new RegExp(`(?:^|[,}])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m"));
    assert.equal(/(?:^|;)\s*opacity\s*:/.test(rule[1]), false, `${selector} must not signal with opacity`);
  }
});
