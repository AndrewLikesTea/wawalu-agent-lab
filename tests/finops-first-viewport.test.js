// What the AI FinOps page shows a visitor in the first viewport, before they
// have retried anything or chosen a file.
//
// THE REGRESSION THIS EXISTS TO CATCH. The bundled example brief is composed
// from a module in the bundle and needs no network. Two things that do wait on
// /evolution-demo-data.json — the page status strip and the AI-literacy score
// card — used to be authored above it. So until that fetch resolved, and
// permanently if it failed, the first viewport read "Not scored yet", "No
// action ranked yet", "Reading the bundled example…", and then "Bundled
// analysis unavailable · press Retry bundled analysis", with a complete,
// populated decision brief sitting underneath the lot of it. A reader was asked
// to retry, or to choose a file, for an answer the page already had.
//
// So the claims pinned here are about *order and precedence*, not about the
// brief's own figures — tests/finops-first-run.test.js owns those. Everything
// above the brief must be either the page's own name or nothing, the pending
// vocabulary must never precede it, and the whole set of claims has to hold on
// the run where the bundled fixture never arrives, because that is the run
// where the old page had nothing to say at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FIRST_RUN_IDS } from "../src/finops-first-run.js";
import { BUNDLED_LOAD_STATE, HEADLINE_BUNDLE_UNAVAILABLE } from "../src/briefing-strings.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const SERVED = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

/**
 * The pending vocabulary, in the exact words the page ships. None of it may be
 * read before the brief: each one is an answer to "what does this tell me?"
 * that is worse than the answer the page is already holding.
 */
const PENDING_LANGUAGE = [
  "Not read yet", "Not measured yet",
  "Reading the bundled example", "Bundled analysis unavailable",
];

const byId = (document, id) => document.getElementById(id);

/** Every element in `<main>`, in document order, up to the brief. */
function beforeTheBrief(document) {
  const out = [];
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (child?.nodeType !== 1) continue;
      if (child.id === FIRST_RUN_IDS.region) return true;
      out.push(child);
      if (visit(child)) return true;
    }
    return false;
  };
  assert.equal(visit(byId(document, "main-content")), true,
    `#${FIRST_RUN_IDS.region} is not inside <main> at all`);
  return out;
}

/** A node's own text — its direct text children, not its descendants'. */
function ownText(node) {
  const direct = (node.children ?? []).filter((child) => child?.nodeType === 3);
  if (!direct.length && (node.children ?? []).some((child) => child?.nodeType === 1)) return "";
  return textOf(node);
}

async function bootedPage({ routes = SERVED } = {}) {
  const page = await loadPage(PAGE, { routes });
  await importPageModule("/evolution-page.js");
  // All three of the page's self-started jobs, not just the one under test:
  // `restore()` pulls the globals out from under any request still in flight,
  // and the rejection then surfaces in whichever test runs next.
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready"
    || byId(page.document, "finops-load-state")?.dataset.state === "error",
  "the page never settled into a resolved load state");
  await waitFor(() => byId(page.document, "integration-contract-provenance")
    ?.textContent.trim().startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(page.document, "finops-evaluation-result")
    ?.getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

// --- the shipped markup ----------------------------------------------------

test("nothing that waits on the bundled fixture is authored above the brief", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const preceding = beforeTheBrief(document);

  for (const id of ["finops-load-state", "score-card", "guided-result", "kpi-row"]) {
    assert.ok(!preceding.some((node) => node.id === id),
      `#${id} waits on /evolution-demo-data.json and is authored above the brief that does not`);
  }
  // The hero still comes first, so the page leads with what it is.
  assert.ok(preceding.some((node) => node.id === "page-title"), "the h1 is above the brief");
  // And nothing above it is a control. "No retry or file selection required"
  // is only true if the reader meets no control at all before the result: the
  // hero is copy, and the first thing to press belongs to the brief.
  //
  // A control authored inside a hidden block is not one the reader meets: the
  // headline region above carries a resolving control for the state where no
  // peer position can be shown, and that block ships `hidden`. It is revealed
  // only when there genuinely is nothing to place — which is a result, not a
  // gate on one — so it is the authored-visible set this rule is about.
  const controls = preceding.filter((node) => ["BUTTON", "INPUT", "SELECT", "TEXTAREA"]
    .includes(node.tagName) && !node.closest("[hidden]"));
  assert.deepEqual(controls.map((node) => node.id), [],
    "a control is authored above the result it is not needed for");
});

test("the brief carries the sample label and both next steps as authored markup", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const sample = textOf(byId(document, FIRST_RUN_IDS.sample));
  // True before a script runs, because a reader decides what kind of number
  // they are looking at before they read the number.
  assert.match(sample, /Bundled synthetic example/);
  assert.match(sample, /invented data/);
  assert.match(sample, /not your spend/);
  assert.match(sample, /not .*realized savings/);

  // The calculation disclosure hangs off the headline as a native details, so
  // it is keyboard-operable without this page owning a disclosure widget.
  assert.equal(byId(document, "finops-first-run-method").tagName.toLowerCase(), "details");
  // And the CTA onto the reader's own data is a real, enabled button.
  const chooseOwn = byId(document, FIRST_RUN_IDS.import);
  assert.equal(chooseOwn.tagName.toLowerCase(), "button");
  assert.equal(chooseOwn.hasAttribute("disabled"), false);
  assert.match(textOf(byId(document, `${FIRST_RUN_IDS.import}-note`)),
    /stay in this browser and are not uploaded/);
});

test("the hero is one column, and the card that left it is still bounded", async () => {
  const styles = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  // No second hero column to collapse: the score card is not in the hero, so
  // there is no width at which it re-appears above the brief.
  assert.doesNotMatch(styles, /\.finops-hero \{[^}]*grid-template-columns/);
  // A 66px letter across a full desktop column would read as the page's
  // verdict, which is the prominence this card gave up when it moved.
  assert.match(styles, /\.score-card \{[^}]*width:min\(100%,360px\)/);
});

// --- the booted page, with the bundled fixture served -----------------------

test("no pending language is read before the brief on a resolved load", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    const read = beforeTheBrief(document)
      .filter((node) => !node.hidden).map(ownText).join(" ");
    for (const phrase of PENDING_LANGUAGE) {
      assert.doesNotMatch(read, new RegExp(phrase),
        `"${phrase}" is read before the populated brief`);
    }
    assert.equal(byId(document, FIRST_RUN_IDS.region).dataset.state, "ready");
  } finally {
    page.restore();
  }
});

test("the brief's two next steps are reached before the retry control", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    const order = tabSequence(document).map((node) => node.id);
    const brief = order.indexOf(FIRST_RUN_IDS.import);
    assert.ok(brief >= 0, "the reader's own-data CTA is in the tab sequence");
    for (const later of ["finops-choose-files", "finops-data-retry", "local-finops-files"]) {
      const index = order.indexOf(later);
      assert.ok(index === -1 || brief < index,
        `#${later} is reached before the brief's own next step`);
    }
  } finally {
    page.restore();
  }
});

// --- the booted page, with the bundled fixture failing ----------------------

test("a failed bundled fixture still meets the visitor with the complete brief", async () => {
  // Nothing is served: every fixture request throws. This is the run the old
  // first viewport had nothing to say on.
  const page = await bootedPage({ routes: {} });
  const { document } = page;
  try {
    assert.equal(byId(document, "finops-load-state").dataset.state, "error",
      "the bundled fixture request is expected to have failed");

    // No retry, no file chosen — and a complete, populated result regardless.
    const region = byId(document, FIRST_RUN_IDS.region);
    assert.equal(region.dataset.state, "ready");
    assert.equal(region.hidden, false);
    assert.match(textOf(byId(document, FIRST_RUN_IDS.benchmarkValue)),
      /^\d+% of analyzed AI spend$/);
    assert.equal(byId(document, FIRST_RUN_IDS.benchmarkValue).dataset.available, "true");
    assert.match(textOf(byId(document, FIRST_RUN_IDS.impactValue)), /^\$[\d,]+ in the reporting period$/);
    assert.equal(byId(document, FIRST_RUN_IDS.action).dataset.available, "true");
    assert.match(textOf(byId(document, FIRST_RUN_IDS.role)), /Accountable role: /);
    // Provenance and the arithmetic behind the figure, one keystroke away.
    const terms = byId(document, FIRST_RUN_IDS.methodList)
      .querySelectorAll("dt").map((node) => textOf(node));
    for (const term of ["Arithmetic", "Coverage", "Limits"]) assert.ok(terms.includes(term));

    // And still no pending vocabulary above it.
    const read = beforeTheBrief(document).filter((node) => !node.hidden).map(ownText).join(" ");
    for (const phrase of PENDING_LANGUAGE) {
      assert.doesNotMatch(read, new RegExp(phrase), `"${phrase}" is read before the brief`);
    }
  } finally {
    page.restore();
  }
});

test("the failure names the panels it cost, not the page", async () => {
  const page = await bootedPage({ routes: {} });
  const { document } = page;
  try {
    // The old copy — "Bundled analysis unavailable. The bundled sample file
    // could not be loaded. Press Retry" — read as the whole page having
    // failed, over a result that had not.
    const title = textOf(byId(document, "finops-load-title"));
    const copy = textOf(byId(document, "finops-load-copy"));
    assert.equal(title, BUNDLED_LOAD_STATE.firstFailure.title);
    assert.match(title, /panels below/);
    assert.match(copy, /example decision above is complete and needed no network/);
    // The retry is still offered, and still second.
    assert.equal(byId(document, "finops-data-retry").hidden, false);
    assert.ok(copy.indexOf("complete") < copy.indexOf("Retry bundled analysis"));

    // The hero provenance is the one failure sentence a reader meets before the
    // brief, so it has to lead with what they already have and mention the
    // retry only as something that also still works.
    const provenance = textOf(byId(document, "finops-provenance"));
    assert.equal(provenance, HEADLINE_BUNDLE_UNAVAILABLE.provenance);
    assert.match(provenance, /example decision is complete without it/);
    assert.ok(provenance.indexOf("complete without it") < provenance.indexOf("Retry bundled analysis"),
      "the hero sends a reader to the retry before telling them they need not press it");

    // The browser-only promise is untouched by any of this.
    assert.match(textOf(document.querySelector(".privacy-boundary")),
      /Your files do not leave this tab/);
  } finally {
    page.restore();
  }
});
