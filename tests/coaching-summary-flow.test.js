// The copy control, driven through the shipped markup of evolution.html.
//
// `coaching-summary.test.js` covers the summary and the three rungs of the copy
// as functions. This file covers only what a page can be wrong about: when the
// control appears, whether a keyboard can reach and operate it, what the status
// line says after each outcome, where focus goes when copying is unavailable,
// and that a repaint or a clear does not leave a stale "Copied." over figures it
// no longer describes.
//
// The harness has no `navigator`, so the shipped page's own clipboard is absent
// and the failure path is what a test gets for free. The success path is driven
// by installing a clipboard on `globalThis` — which is exactly what the browser
// does, and is read at press time rather than at load for that reason.
//
// The harness's fetch throws on any request a test did not declare, and this
// file declares none. That is the network assertion: no part of copying a
// summary may ever become a request.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import { coachingSample } from "../src/prompt-coaching-contract.js";

const PAGE = fileURLToPath(new URL("../src/evolution.html", import.meta.url));
const CSS = new URL("../src/evolution.css", import.meta.url);

const WEAK = coachingSample("underspecified-request").text;
const STRONG = coachingSample("well-formed-request").text;

const byId = (document, id) => document.getElementById(id);
const copyBlock = (document) => byId(document, "prompt-coaching-copy");
const copyStatus = (document) => byId(document, "prompt-coaching-copy-status");
const copyText = (document) => byId(document, "prompt-coaching-copy-text");
const fallback = (document) => byId(document, "prompt-coaching-copy-fallback");

async function openCoachingPage() {
  const page = await loadPage(PAGE);
  await importPageModule("/prompt-coaching-page.js");
  return page;
}

function tabTo(document, id) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot use the workflow.`);
}

function gradeText(document, text) {
  const field = byId(document, "prompt-coaching-input");
  field.value = text;
  tabTo(document, "prompt-coaching-grade");
  pressEnter(document);
}

/**
 * Press the copy control the way a keyboard user does, and wait for the copy to
 * settle. The handler is async, so a test that asserts on the same tick asserts
 * on "Copying…" and passes for the wrong reason.
 */
async function pressCopy(document) {
  tabTo(document, "prompt-coaching-copy-button");
  pressEnter(document);
  await new Promise((resolve) => { setImmediate(resolve); });
}

/** Install a clipboard the way a browser presents one, and take it back. */
function withClipboard(clipboard) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard }, writable: true, configurable: true,
  });
  return () => {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
    else delete globalThis.navigator;
  };
}

test("there is nothing to copy until a revision has been compared", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    // Shipped in the markup, hidden before a script runs: the control explains
    // itself in the page source rather than being conjured by JavaScript.
    assert.ok(copyBlock(document), "the copy control must ship in the page markup");
    assert.equal(copyBlock(document).hidden, true);
    assert.equal(tabSequence(document).includes(byId(document, "prompt-coaching-copy-button")),
      false, "a hidden control must not be in the tab sequence");

    gradeText(document, WEAK);
    assert.equal(copyBlock(document).hidden, true,
      "one grade is an answer, not a comparison; there is no revision to summarise");

    gradeText(document, STRONG);
    assert.equal(copyBlock(document).hidden, false);
    assert.equal(copyBlock(document).dataset.reason, "compared");
  } finally {
    page.restore();
  }
});

test("the control is labelled, described, and reachable from the keyboard", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);

    const button = byId(document, "prompt-coaching-copy-button");
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.getAttribute("type"), "button",
      "a button inside no form still must not be able to submit one");
    assert.equal(textOf(button), "Copy this coaching summary");
    // What is copied, and what is not, said before the press rather than after.
    assert.equal(button.getAttribute("aria-describedby"),
      "prompt-coaching-copy-lead prompt-coaching-copy-status");
    assert.match(textOf(byId(document, "prompt-coaching-copy-lead")), /never your prompt text/i);

    // The status line is a permanent region, so an outcome written into it is a
    // change to a node assistive technology was already watching.
    const status = copyStatus(document);
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(status.getAttribute("aria-atomic"), "true");
    assert.equal(textOf(status), "Nothing has been copied yet.");

    // Reachable by Tab, with the fallback box out of the way until it is needed.
    tabTo(document, "prompt-coaching-copy-button");
    assert.equal(fallback(document).hidden, true);
    assert.equal(tabSequence(document).includes(copyText(document)), false);
  } finally {
    page.restore();
  }
});

test("a successful copy reports success and asks nothing further of the reader", async () => {
  const page = await openCoachingPage();
  const written = [];
  const restoreClipboard = withClipboard({
    writeText: async (text) => { written.push(text); },
  });
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);
    await pressCopy(document);

    assert.equal(written.length, 1, "the summary must reach the clipboard exactly once");
    assert.equal(written[0], copyText(document).value);
    assert.match(written[0], /^Prompt coaching — did my revised prompt improve\?$/m);
    assert.match(written[0], /^Baseline: /m);
    assert.match(written[0], /^Revised: /m);

    const status = copyStatus(document);
    assert.equal(status.dataset.outcome, "copied");
    assert.match(textOf(status), /^Copied\./);
    // Success is said in words, not only in a tint, and the fallback box stays
    // out of the way of a reader who does not need it.
    assert.equal(fallback(document).hidden, true);
    assert.equal(byId(document, "prompt-coaching-copy-button").disabled, false,
      "the control must come back so a second copy is possible");
  } finally {
    restoreClipboard();
    page.restore();
  }
});

test("a browser with no clipboard says so and hands over selectable text", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);
    // No navigator and no execCommand: every rung of the fallback is gone,
    // which is what an insecure origin or a hardened browser presents.
    await pressCopy(document);

    const status = copyStatus(document);
    assert.equal(status.dataset.outcome, "manual",
      "a copy that did not happen must never be reported as one");
    assert.match(textOf(status), /Could not copy automatically/);
    assert.match(textOf(status), /Ctrl\+C/);
    assert.match(textOf(status), /Cmd\+C/);

    // The floor of the chain: the text, visible, labelled, and read-only.
    const box = copyText(document);
    assert.equal(fallback(document).hidden, false);
    assert.equal(box.tagName, "TEXTAREA");
    assert.equal(box.getAttribute("readonly"), "");
    assert.equal(document.querySelector('label[for="prompt-coaching-copy-text"]')
      .textContent.trim(), "Coaching summary to copy by hand");
    assert.ok(box.value.includes("Baseline:"));
    // Focus follows the instruction: the status line just said to press Ctrl+C,
    // and the keystroke has to land on the thing that has the text in it.
    assert.equal(document.activeElement, box);
    assert.equal(tabSequence(document).includes(box), true);
    assert.equal(byId(document, "prompt-coaching-copy-button").disabled, false);
  } finally {
    page.restore();
  }
});

test("a copy the browser refuses is reported as a failure, not as a success", async () => {
  const page = await openCoachingPage();
  const restoreClipboard = withClipboard({
    writeText: async () => { throw new Error("NotAllowedError: write permission denied"); },
  });
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);
    await pressCopy(document);

    assert.equal(copyStatus(document).dataset.outcome, "manual");
    assert.match(textOf(copyStatus(document)), /Could not copy automatically/);
    assert.equal(fallback(document).hidden, false);
  } finally {
    restoreClipboard();
    page.restore();
  }
});

test("an outcome survives a repaint but never outlives the figures it describes", async () => {
  const page = await openCoachingPage();
  const restoreClipboard = withClipboard({ writeText: async () => {} });
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);
    await pressCopy(document);
    assert.equal(copyStatus(document).dataset.outcome, "copied");
    const copied = copyText(document).value;

    // Opening a disclosure repaints the change region. A copy that came undone
    // because the reader opened a panel would be a lie in the other direction.
    tabTo(document, "prompt-coaching-criteria-toggle");
    pressEnter(document);
    assert.equal(copyStatus(document).dataset.outcome, "copied",
      "opening a disclosure must not retire an outcome the reader can still see");
    assert.equal(copyText(document).value, copied);

    // A third grade is a different comparison. The old outcome goes with the
    // old figures rather than standing over new ones.
    gradeText(document, WEAK);
    assert.equal(copyBlock(document).hidden, false);
    assert.notEqual(copyText(document).value, copied);
    assert.equal(copyStatus(document).dataset.outcome, undefined);
    assert.equal(textOf(copyStatus(document)), "Nothing has been copied yet.");
    assert.equal(fallback(document).hidden, true);
  } finally {
    restoreClipboard();
    page.restore();
  }
});

test("clearing the panel takes the summary with it", async () => {
  const page = await openCoachingPage();
  const restoreClipboard = withClipboard({ writeText: async () => {} });
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);
    await pressCopy(document);

    tabTo(document, "prompt-coaching-clear");
    pressEnter(document);
    assert.equal(copyBlock(document).hidden, true);
    assert.equal(copyText(document).value, "",
      "the summary must not linger in the document after the panel is cleared");
    assert.equal(textOf(copyStatus(document)), "");
    assert.equal(fallback(document).hidden, true);
  } finally {
    restoreClipboard();
    page.restore();
  }
});

// --- contrast ----------------------------------------------------------------
//
// Measured out of the stylesheet rather than asserted from memory, so a future
// edit to a token or a pairing fails here instead of shipping a status line
// nobody can read. Same method as the delta variants in
// `prompt-coaching-revision-flow.test.js`, over the two outcomes this control
// has and the box it hands over when neither worked.

const css = await readFile(CSS, "utf8");

const TOKENS = new Map(
  [...(css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value.trim()]),
);

function declared(selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(rule, `no rule for ${selector}`);
  const found = rule[1].match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  const value = found?.[1].trim();
  const named = value?.match(/^var\((--[\w-]+)\)$/);
  return (named ? TOKENS.get(named[1]) : value)?.trim();
}

const channel = (value) => {
  const linear = value / 255;
  return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const digits = hex.replace("#", "");
  const n = parseInt(digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits, 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("every copy outcome is readable on the fill it is drawn on", (t) => {
  const variants = [
    [".prompt-coaching-copy-status", "idle"],
    ['.prompt-coaching-copy-status[data-outcome="pending"]', "copying"],
    ['.prompt-coaching-copy-status[data-outcome="copied"]', "copied"],
    ['.prompt-coaching-copy-status[data-outcome="manual"]', "could not copy"],
    ["#prompt-coaching-copy-button", "the control"],
    ["#prompt-coaching-copy-text", "the fallback box"],
  ];
  for (const [selector, name] of variants) {
    const measured = ratio(declared(selector, "color"), declared(selector, "background"));
    t.diagnostic(`${name}: ${measured.toFixed(2)}:1`);
    assert.ok(measured >= 4.5, `${name} is ${measured.toFixed(2)}:1, below 4.5:1`);
  }
  // No outcome is carried by tint alone: each one is styled from `data-outcome`
  // and each one writes a sentence into the status line, asserted above.
  assert.match(css, /#prompt-coaching-copy-button:focus-visible \{[^}]*outline:3px solid/);
  assert.match(css, /#prompt-coaching-copy-text:focus-visible \{[^}]*outline:3px solid/);
});

test("a refusal after a comparison withdraws the summary rather than restating it", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);
    assert.equal(copyBlock(document).hidden, false);

    // An empty box is a refusal: there is no revised grade behind it, so there
    // is nothing to summarise and nothing to copy.
    gradeText(document, "");
    assert.equal(copyBlock(document).hidden, true);
    assert.equal(copyText(document).value, "");
  } finally {
    page.restore();
  }
});
