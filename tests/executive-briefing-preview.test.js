// The executive FinOps briefing preview: one printable document, rebuilt in the
// reader's own tab from the canonical synthetic fixture.
//
// What is asserted here is the reading experience, not the arithmetic — the
// arithmetic has its own contract test (tests/executive-finops-briefing.test.js).
// This file holds the page to the four things a briefing can fail at:
//
//   * reading order — question, metric, action, verdict, bounds, then the two
//     labelled levels, in that order and never re-shuffled by a state;
//   * every state drawn — loading, absent, error, and an implausible extreme;
//   * reachable and legible — heading hierarchy without a skipped level, every
//     disclosure a real button with a visible focus ring, and no signal carried
//     by colour alone;
//   * printable — every level open on paper, no site chrome, nothing clipped.
//
// The page runs for real: the shipped markup, the shipped entry, the shipped
// contract. The only thing the harness supplies is `fetch`, which serves the one
// file the page reads and throws on anything else — so a briefing that reached
// for the network would fail here rather than in production.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FORBIDDEN_LINK_PATTERN } from "../src/executive-finops-briefing.js";

const PAGE = new URL("../src/executive-briefing.html", import.meta.url);
const FIXTURE_URL = new URL("../src/executive-finops-briefing-fixture.json", import.meta.url);
const FIXTURE_PATH = "/executive-finops-briefing-fixture.json";

const readFixture = async () => JSON.parse(await readFile(FIXTURE_URL, "utf8"));

/** Stand up the page with a fixture of the caller's choosing, and paint it. */
async function openPage(t, fixture) {
  const routes = fixture === undefined ? {} : { [FIXTURE_PATH]: fixture };
  const page = await loadPage(PAGE, { routes });
  t.after(() => page.restore());
  await importPageModule("/executive-briefing-page.js");
  const root = page.document.getElementById("executive-briefing");
  await waitFor(() => root.getAttribute("aria-busy") === "false", "the briefing finished painting");
  return { page, document: page.document, root };
}

/** The view module, loaded the way the page loads it (root-absolute imports). */
const view = () => importPageModule("/executive-briefing-view.js");

/* ------------------------------ reading order ------------------------------ */

test("the page paints the briefing it rebuilt, in the order a leader reads it", async (t) => {
  const fixture = await readFixture();
  const { document, root } = await openPage(t, fixture);

  const article = root.querySelector(".brief");
  assert.equal(article.getAttribute("data-state"), "briefing");

  // The five things a leader reads, in order, each its own landmarked section.
  assert.deepEqual(
    article.querySelectorAll("[data-role]").map((node) => node.getAttribute("data-role")),
    ["material-metric", "priority-action", "trust-verdict", "limitations"],
  );
  const levels = article.querySelectorAll(".brief-disclosure")
    .map((node) => node.getAttribute("data-level"));
  assert.deepEqual(levels, ["2", "3"], "the levels are disclosed in contract order, after the headline");

  // The answerable question and its answer.
  assert.equal(textOf(document.querySelector(".brief-question")), fixture.briefing.questions[0].question);
  assert.match(textOf(document.querySelector(".brief-answer")), /syn-support-triage/);

  // The material metric, its share, and the standing it is read against — every
  // figure the fixture publishes, formatted, not re-derived.
  assert.equal(textOf(document.querySelector(".brief-figure")), "$6,120.00");
  assert.match(textOf(document.querySelector(".brief-figure-share")), /14\.2% of \$43,000\.00 analyzed spend in 2026-06/);
  const standing = document.querySelector(".brief-standing");
  assert.equal(standing.getAttribute("data-standing"), "more_recoverable_than_baseline");
  assert.match(textOf(standing), /More recoverable than its own baseline/);
  assert.match(textOf(standing), /\+1\.2 pts against 13\.0% over 2 prior periods/);

  // The priority action, with the cap the briefing puts on it.
  const action = article.querySelectorAll("[data-role]")[1];
  assert.match(textOf(action), /Pilot lower-cost routing/);
  assert.match(textOf(action), /Platform Engineering Lead/);
  assert.match(textOf(action), /\$6,120\.00/);

  // The trust verdict, and the limitation that bounds the figure above it.
  assert.match(textOf(document.querySelector(".brief-verdict")), /Confidence High level 4 of 4/);
  assert.match(
    textOf(document.querySelector(".brief-bound-statement")),
    /routing scenario, not a realized saving/,
  );
  assert.match(textOf(document.querySelector(".brief-bound-more")), /4 further limitations/);
  assert.match(textOf(document.querySelector(".brief-bound-more")), /All 5 print/);
});

test("the briefing states its provenance as a rebuild, and reaches no link of any kind", async (t) => {
  const { document, root } = await openPage(t, await readFixture());

  assert.match(textOf(document.querySelector(".brief-provenance-note")), /Rebuilt in this tab/);
  assert.match(textOf(document.querySelector(".brief-origin")), /synthetic sample/i);

  // The safety claim the briefing makes about itself has to be true of what is
  // on screen: no URL, no blob, no data: anywhere in the rendered document.
  assert.doesNotMatch(textOf(root), FORBIDDEN_LINK_PATTERN);
  assert.equal(root.querySelectorAll("a").length, 0, "a printable briefing offers no link to follow");
});

/* --------------------------- semantics and keyboard ------------------------ */

test("the document has one h1 and no skipped heading level, before and after a level opens", async (t) => {
  const { document } = await openPage(t, await readFixture());

  const levelsOf = () => document.querySelector("main")
    .querySelectorAll("h1,h2,h3,h4")
    .map((node) => Number(node.tagName.slice(1)));

  const check = (found, when) => {
    assert.equal(found[0], 1, `${when}: the page does not open at h1`);
    assert.equal(found.filter((level) => level === 1).length, 1, `${when}: more than one h1`);
    for (const [index, level] of found.entries()) {
      if (index === 0) continue;
      assert.ok(level <= found[index - 1] + 1, `${when}: h${found[index - 1]} is followed by h${level}`);
    }
  };

  check(levelsOf(), "collapsed");
  for (const button of document.querySelectorAll(".brief-toggle")) {
    button.focus();
    pressEnter(document);
  }
  check(levelsOf(), "expanded");
});

test("each disclosure is a real button in the tab order that opens the panel it names", async (t) => {
  const { document } = await openPage(t, await readFixture());

  const toggles = document.querySelectorAll(".brief-toggle");
  assert.equal(toggles.length, 2);
  const sequence = tabSequence(document);
  for (const toggle of toggles) {
    assert.ok(sequence.includes(toggle), `${textOf(toggle)} is not reachable from the keyboard`);
    assert.equal(toggle.tagName, "BUTTON");
    assert.equal(toggle.getAttribute("type"), "button");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls"));
    assert.ok(panel, "a disclosure names a panel that exists");
    assert.ok(panel.hasAttribute("hidden"), "a collapsed panel is hidden from everything, not just from sight");
    assert.equal(panel.getAttribute("aria-labelledby"), toggle.id);
    // The heading owns the control, so the panel is reachable by heading too.
    assert.equal(toggle.parentNode.tagName, "H3");
  }

  const [supporting] = toggles;
  supporting.focus();
  pressEnter(document);
  assert.equal(supporting.getAttribute("aria-expanded"), "true");
  assert.equal(document.getElementById(supporting.getAttribute("aria-controls")).hasAttribute("hidden"), false);
  pressEnter(document);
  assert.equal(supporting.getAttribute("aria-expanded"), "false");
  assert.ok(document.getElementById(supporting.getAttribute("aria-controls")).hasAttribute("hidden"));
});

test("level 2 carries what the claim rests on, and level 3 how to recompute it", async (t) => {
  const { document } = await openPage(t, await readFixture());
  const [supporting, method] = document.querySelectorAll(".brief-panel");

  for (const term of ["Benchmark", "Provenance", "Limitations (5)", "c1daf8d2", "user:2026-06"]) {
    assert.match(textOf(supporting), new RegExp(term.replace(/[()]/g, "\\$&")), `level 2 is missing ${term}`);
  }
  for (const term of ["recoverable_share_ppm", "Contract versions", "executive-finops-briefing/1.0.0"]) {
    assert.match(textOf(method), new RegExp(term), `level 3 is missing ${term}`);
  }
  // The method never climbs into the headline: the contract forbids promoting a
  // level-3 field, and a "recompute it" panel in the first screen is a dashboard.
  assert.doesNotMatch(textOf(document.querySelector(".brief-masthead")), /recoverable_share_ppm/);
});

test("no confidence or standing signal is carried by colour alone", async (t) => {
  const { document } = await openPage(t, await readFixture());

  const standing = document.querySelector("[data-standing]");
  assert.match(textOf(standing), /baseline/, "the standing has no word");
  assert.match(textOf(standing), /pts/, "the standing has no value");
  assert.ok(standing.querySelector(".brief-standing-shape"), "the standing has no shape channel");

  const verdict = document.querySelector("[data-confidence]");
  assert.match(textOf(verdict), /High/, "the verdict has no word");
  assert.match(textOf(verdict), /level 4 of 4/, "the verdict has no rung");
  assert.ok(verdict.querySelector(".brief-verdict-shape"), "the verdict has no shape channel");

  // The stylesheet backs both channels with a shape rather than a hue alone.
  const css = await readFile(new URL("../src/executive-briefing.css", import.meta.url), "utf8");
  for (const standingValue of ["more_recoverable_than_baseline", "in_line_with_baseline", "less_recoverable_than_baseline", "unavailable"]) {
    assert.match(css, new RegExp(`data-standing="${standingValue}"\\] \\.brief-standing-shape::before \\{ content:`),
      `${standingValue} has no shape`);
  }
  for (const level of ["high", "moderate", "low", "insufficient"]) {
    assert.match(css, new RegExp(`data-confidence="${level}"\\] \\.brief-verdict-shape::before \\{ content:`),
      `${level} has no shape`);
  }
  assert.match(css, /\.brief-toggle:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
});

/* --------------------------------- states ---------------------------------- */

test("the page ships its own loading state rather than an empty frame", async () => {
  const html = await readFile(PAGE, "utf8");
  assert.match(html, /<div id="executive-briefing" aria-live="polite" aria-busy="true">/);
  assert.match(html, /data-state="loading" role="status"/);
  // The state names what is actually read first: this browser's own retained
  // periods. The sample below is the fallback, and tests/executive-briefing-local
  // .test.js owns the states that choose between them.
  assert.match(html, /Reading this browser's own FinOps figures/);
});

test("a workspace with nothing retained says what is absent, in the same reading order", async (t) => {
  const { buildExecutiveBriefing } = await importPageModule("/executive-finops-briefing.js");
  const { renderExecutiveBriefingPreview } = await view();
  await openPage(t, await readFixture());

  const empty = renderExecutiveBriefingPreview(buildExecutiveBriefing([]));
  assert.equal(empty.getAttribute("data-state"), "absent");
  assert.match(textOf(empty), /Nothing here can be briefed on yet/);
  // Every slot a reader looks for is named and explained — no blank, no zero.
  for (const label of ["Where to act first", "How much is indicated", "How it compares", "What should happen next"]) {
    assert.match(textOf(empty), new RegExp(label));
  }
  assert.match(textOf(empty), /retained no derived period/);
  // The verdict and the bounds still print, and the two levels are still there.
  assert.match(textOf(empty.querySelector("[data-confidence]")), /Insufficient level 1 of 4/);
  assert.equal(empty.querySelectorAll(".brief-disclosure").length, 2);
  assert.match(textOf(empty.querySelector(".brief-bound-statement")), /routing scenario/);
});

test("a tab that can reach nothing at all still paints the whole sample", async (t) => {
  // `undefined` declares no routes, so the harness throws on any request. The
  // sample used to be fetched from this origin, and a reader who could not reach
  // it got an error panel with no artifact on it. It is carried in the bundle
  // now, so there is no request left to fail and nothing left to withhold.
  const { document, root } = await openPage(t, undefined);

  assert.equal(root.querySelector(".brief-state"), null, "a reachable-nothing tab was left on a state panel");
  assert.equal(root.getAttribute("aria-busy"), "false");
  assert.equal(root.querySelector(".brief").getAttribute("data-state"), "briefing");
  assert.equal(textOf(document.querySelector(".brief-figure")), "$6,120.00");
  assert.equal(document.querySelectorAll(".brief-figure").length, 1, "one headline figure, not a dashboard");
});

test("the error state a briefing can still reach says what is not wrong", async (t) => {
  // The one failure left is a briefing that fails the contract it declares. It
  // is unreachable from the shipped sample by construction, so it is exercised
  // through the view directly rather than by breaking a file on disk.
  await openPage(t, await readFixture());
  const { renderBriefingError } = await view();

  const panel = renderBriefingError({
    summary: "The published sample failed its own contract",
    detail: "1 violation(s).",
    remedy: "No figure is shown. Nothing was uploaded and nothing was stored.",
  });
  assert.equal(panel.getAttribute("data-state"), "error");
  assert.equal(panel.getAttribute("role"), "alert");
  assert.match(textOf(panel), /Error: The published sample failed its own contract/);
  assert.match(textOf(panel), /Nothing was uploaded and nothing was stored/);
  assert.equal(panel.querySelectorAll(".brief-figure").length, 0, "no figure is shown beside an error");
});

test("an implausible extreme is drawn with its figure and named in words", async (t) => {
  const { buildExecutiveBriefing } = await importPageModule("/executive-finops-briefing.js");
  const { renderExecutiveBriefingPreview, implausibilities } = await view();
  await openPage(t, await readFixture());

  // Generated here rather than committed: three gapless months whose last one
  // claims a recoverable scenario larger than everything it analyzed.
  const period = (month, analyzedMinor, recoverableMinor) => ({
    periodId: `user:2026-0${month}`,
    period: `2026-0${month}`,
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: `2026-0${month + 1}-02T09:00:00Z`,
    sourceFingerprint: `f${month}`,
    analyzedSpendMinor: analyzedMinor,
    attributedSpendMinor: analyzedMinor,
    recoverableScenarioMinor: recoverableMinor,
    recordsTotal: 10,
    recordsAnalyzed: 10,
    coverageRatioPpm: 960_000,
    confidence: "high",
    missingInputs: [],
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: recoverableMinor,
    topDepartmentId: "syn-a-department-identifier-long-enough-to-wrap-a-narrow-column",
  });
  const briefing = buildExecutiveBriefing([
    period(4, 1_000_000, 10_000),
    period(5, 1_000_000, 10_000),
    period(6, 400_000_000_000, 400_000_000_000),
  ]);

  assert.equal(implausibilities(briefing).length, 3, "the share, the magnitude, and the swing all read wrong");
  const node = renderExecutiveBriefingPreview(briefing);
  const caution = node.querySelector(".brief-caution");
  assert.ok(caution, "an implausible briefing is drawn without its caution");
  assert.equal(caution.getAttribute("data-implausible"), "true");
  assert.equal(caution.querySelectorAll("li").length, 3);
  assert.match(textOf(caution), /100\.0% of the spend that was analyzed/);
  assert.match(textOf(caution), /\$4,000,000,000\.00 for a single reporting period/);
  assert.match(textOf(caution), /from its own trailing baseline/);

  // The figure itself is still shown: hiding a number the reader can find in the
  // fixture is how a briefing loses the argument about whether it is honest.
  assert.equal(textOf(node.querySelector(".brief-figure")), "$4,000,000,000.00");
  assert.match(textOf(node.querySelector(".brief-answer")), /syn-a-department-identifier/);
  // A long identifier and a fifteen-digit figure both have to wrap rather than clip.
  const css = await readFile(new URL("../src/executive-briefing.css", import.meta.url), "utf8");
  assert.match(css, /\.brief-figure \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.brief-org-unit \{[^}]*overflow-wrap:anywhere/);
});

/* ---------------------------------- print ---------------------------------- */

test("every level opens for print and the reader's own state comes back afterwards", async (t) => {
  const { document } = await openPage(t, await readFixture());
  const {
    PRINT_EXPANDED_ATTRIBUTE, expandForPrint, restoreAfterPrint, wirePrintExpansion,
  } = await view();

  const article = document.querySelector(".brief");
  const [supporting, method] = document.querySelectorAll(".brief-toggle");

  // The reader opened level 2 themselves; only level 3 is this code's to close.
  supporting.focus();
  pressEnter(document);

  expandForPrint(article, document);
  for (const toggle of [supporting, method]) {
    assert.equal(toggle.getAttribute("aria-expanded"), "true", `${textOf(toggle)} is collapsed on paper`);
    assert.equal(document.getElementById(toggle.getAttribute("aria-controls")).hasAttribute("hidden"), false);
  }
  assert.equal(supporting.hasAttribute(PRINT_EXPANDED_ATTRIBUTE), false);
  assert.ok(method.hasAttribute(PRINT_EXPANDED_ATTRIBUTE));

  restoreAfterPrint(article, document);
  assert.equal(supporting.getAttribute("aria-expanded"), "true", "printing closed a level the reader opened");
  assert.equal(method.getAttribute("aria-expanded"), "false");

  // The same pair, wired to the window events a browser fires around printing.
  const listeners = new Map();
  const scope = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
  };
  const unbind = wirePrintExpansion(scope, article, document);
  listeners.get("beforeprint")();
  assert.equal(method.getAttribute("aria-expanded"), "true");
  listeners.get("afterprint")();
  assert.equal(method.getAttribute("aria-expanded"), "false");
  unbind();
  assert.equal(listeners.size, 0);
});

test("the print sheet removes the chrome, opens every panel, and clips nothing", async () => {
  const css = await readFile(new URL("../src/executive-briefing.css", import.meta.url), "utf8");
  const print = css.slice(css.indexOf("@media print"));
  assert.ok(print.includes("@media print"), "the sheet has no print rules at all");

  // The rule this whole design rests on: CSS alone reveals a collapsed panel, so
  // a briefing printed from a page whose script never ran still carries its
  // provenance, its limitations, and its method.
  assert.match(print, /\.brief-panel\[hidden\] \{ display:block !important; \}/);
  assert.doesNotMatch(print, /\.brief-panel \{[^}]*display:none/);

  // Application chrome and control affordances come off the page.
  const chrome = print.match(/^ {2}(\.site-header[^\n]*display:none[^\n]*)$/m)?.[1];
  assert.ok(chrome, "the print sheet keeps the site header");
  for (const selector of [".site-footer", ".skip-link", ".brief-print-hint", ".brief-toggle-mark"]) {
    assert.ok(chrome.includes(selector), `${selector} still prints`);
  }
  assert.match(print, /\.brief-toggle \{[^}]*cursor:auto/, "the disclosure still looks like a control on paper");

  // Nothing sticks, scrolls, or is capped in height on paper, and the panels a
  // reader is owed stay whole across a page break.
  assert.match(print, /position:static; overflow:visible; max-height:none/);
  assert.match(print, /\.brief-masthead,\.brief-section,\.brief-disclosure \{ break-inside:avoid; \}/);
  assert.match(print, /@page \{ size:portrait; margin:14mm; \}/);
  // Colour is decorative on paper: the washes become outlines and the words stay.
  assert.match(print, /\.brief-standing,\.brief-verdict \{[^}]*background:none !important; color:#171713 !important/);
});

test("the view builds every node through the DOM, never through markup", async () => {
  const source = await readFile(new URL("../src/executive-briefing-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});
