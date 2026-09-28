// The Releases page's one quotable figure: how consistently the log keeps its
// reasoning (issue #2579).
//
// WHAT IS PINNED HERE, in the order the acceptance criteria are written:
//
//   * the rule — a release counts when it links a decision that IS in the loaded
//     decision log; a link pointing at an absent id does not count, and neither
//     does a release that linked nothing;
//   * the denominator — every loaded release, not the rendered selection;
//   * the attribution — all three provenance cases (examples only, added only,
//     mixed) in the site's own wording, derived from the records counted;
//   * the clipboard — a pure builder produces the sentence, and the control puts
//     that exact string on the clipboard seam the page already injects;
//   * the invariant chosen in (E) — the figure describes the complete loaded log,
//     so a filter that visibly moves the list's own count leaves it alone.
//
// Every test that expects rendered content asserts its precondition first: a
// fixture missing a required field is dropped by isRelease() and would land the
// page in an empty log, where "0 of 0" passes an assertion about nothing.
//
// Determinism: no network and no timers. Each test seeds its own storage, passes
// its own clipboard, and refuses the health probe the page's deployment band
// makes (loadPage's fetch throws on any undeclared route in any case).

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import {
  NO_RELEASES_TO_COUNT,
  REASONING_PROOF_COPIED_STATUS,
  REASONING_PROOF_COPY_FAILED_STATUS,
  REASONING_PROOF_COPY_LABEL,
  REASONING_PROOF_HEADING,
  REASONING_PROOF_RULE,
  REASONING_PROOF_SCOPE,
  REASONING_PROOF_SUMMARY_SCOPE,
  countReasoningKept,
  reasoningKeptSentence,
  reasoningProofSummary,
  reasoningProvenanceNote,
} from "../src/release-reasoning-proof.js";
import { DomEvent, loadPage, tabSequence, textOf, typeText } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const CSS = new URL("../src/releases-proof.css", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

const decision = (id, title) => ({
  id,
  title,
  context: `Why ${title} was decided.`,
  alternatives: "Doing nothing.",
  owner: "Kai",
  status: "accepted",
  createdAt: "2026-01-02T09:00:00.000Z",
});

const release = (id, version, decisionIds, day = "01") => ({
  id,
  version,
  title: `Release ${version}`,
  description: `What ${version} shipped.`,
  owner: "Ari",
  status: "completed",
  createdAt: `2026-03-${day}T00:00:00.000Z`,
  decisionIds,
});

const QUEUE = decision("d-queue", "Adopt a durable queue");
const CACHE = decision("d-cache", "Cache the read path");

// One release per outcome the rule has to tell apart: linked and present,
// linked and absent from the log, and linked to nothing at all.
const KEPT = release("r-kept", "v1.0.0", ["d-queue"], "01");
const DANGLING = release("r-dangling", "v1.1.0", ["d-gone"], "02");
const BARE = release("r-bare", "v1.2.0", [], "03");

const byId = (page, id) => page.document.querySelector(`#${id}`);
const claim = (page) => textOf(byId(page, "reasoning-proof-claim"));
const provenance = (page) => textOf(byId(page, "reasoning-proof-provenance"));
const settle = async () => { for (let turn = 0; turn < 4; turn += 1) await Promise.resolve(); };

async function openPage(t, {
  releases = [KEPT, DANGLING, BARE],
  decisions = [QUEUE, CACHE],
  seed = NO_SEED,
  clipboard,
  refuse = false,
} = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  const read = page.storage.getItem;
  page.storage.getItem = (key) => {
    if (key === RELEASE_STORAGE_KEY && refuse) throw new Error("storage refused the read");
    return read(key);
  };
  initReleasesPage(page.document, page.storage, {
    seed,
    clipboard,
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: "", hash: "" },
    history: { replaceState() {} },
    readHealth: async () => { throw new Error("no network in tests"); },
  });
  return page;
}

const change = (control, value) => {
  control.value = value;
  control.dispatchEvent(new DomEvent("change", { bubbles: true }));
};

// --- the rule ----------------------------------------------------------------

test("only a release linking a decision the log holds counts as keeping its reasoning", () => {
  const counts = countReasoningKept([KEPT, DANGLING, BARE], [QUEUE, CACHE]);
  assert.equal(counts.total, 3, "the fixtures did not all reach the count");
  assert.equal(counts.preserved, 1);

  // Each outcome on its own, so a failure names which rule broke.
  assert.equal(countReasoningKept([KEPT], [QUEUE]).preserved, 1);
  assert.equal(countReasoningKept([DANGLING], [QUEUE]).preserved, 0,
    "a link pointing at a decision the log does not hold was counted");
  assert.equal(countReasoningKept([BARE], [QUEUE]).preserved, 0,
    "a release with no linked decision was counted");

  // The same release counts or does not, depending only on whether its decision
  // is in the log — which is the whole claim this figure makes.
  assert.equal(countReasoningKept([DANGLING], [QUEUE, decision("d-gone", "Recovered")]).preserved, 1);

  // One of several links being present is enough, and a release linking two
  // absent ids is still not counted.
  assert.equal(countReasoningKept([release("r-mixed", "v2.0.0", ["d-gone", "d-cache"])], [CACHE]).preserved, 1);
  assert.equal(countReasoningKept([release("r-lost", "v2.1.0", ["d-gone", "d-also-gone"])], [CACHE]).preserved, 0);
});

test("the total is the number of loaded releases, whatever their links", () => {
  assert.equal(countReasoningKept([], []).total, 0);
  assert.equal(countReasoningKept([BARE], []).total, 1);
  assert.equal(countReasoningKept([KEPT, DANGLING, BARE], [QUEUE]).total, 3);
  // Not the number that counted, and not the number of decisions.
  assert.equal(countReasoningKept([KEPT, DANGLING, BARE], [QUEUE, CACHE]).preserved, 1);
});

test("the sentence carries both numbers in words, and says nothing at all over an empty log", () => {
  assert.equal(reasoningKeptSentence({ total: 3, preserved: 1 }),
    "1 of 3 releases in this release log links at least one decision the decision log holds.");
  assert.equal(reasoningKeptSentence({ total: 3, preserved: 2 }),
    "2 of 3 releases in this release log link at least one decision the decision log holds.");
  assert.equal(reasoningKeptSentence({ total: 1, preserved: 0 }),
    "0 of 1 release in this release log link at least one decision the decision log holds.");
  // A fraction glyph is not a sentence: both numbers are stated, in words.
  for (const total of [0, 1, 4]) {
    assert.doesNotMatch(reasoningKeptSentence({ total, preserved: 0 }), /\d\s*\/\s*\d/);
  }
  assert.equal(reasoningKeptSentence({ total: 0, preserved: 0 }), NO_RELEASES_TO_COUNT);
  assert.doesNotMatch(NO_RELEASES_TO_COUNT, /\d/, "the empty log still prints a figure");
});

// --- the attribution ---------------------------------------------------------

test("all three provenance cases name both halves in the site's own wording", () => {
  const examplesOnly = countReasoningKept([KEPT, BARE], [QUEUE], new Set(["r-kept", "r-bare"]));
  const addedOnly = countReasoningKept([KEPT, BARE], [QUEUE], new Set());
  const mixed = countReasoningKept([KEPT, BARE], [QUEUE], new Set(["r-kept"]));

  assert.deepEqual([examplesOnly.examples, examplesOnly.added], [2, 0]);
  assert.deepEqual([addedOnly.examples, addedOnly.added], [0, 2]);
  assert.deepEqual([mixed.examples, mixed.added], [1, 1]);

  assert.equal(reasoningProvenanceNote(examplesOnly), "Counted here: 2 example records and none you added.");
  assert.equal(reasoningProvenanceNote(addedOnly), "Counted here: no example records and 2 you added.");
  assert.equal(reasoningProvenanceNote(mixed), "Counted here: 1 example record and 1 you added.");
  // Both halves are always named, so an absence is stated rather than left out.
  for (const counts of [examplesOnly, addedOnly, mixed]) {
    assert.match(reasoningProvenanceNote(counts), /example record/);
    assert.match(reasoningProvenanceNote(counts), /you added/);
  }
});

test("the attribution is over the records counted, not over the whole seed", () => {
  // A release stored under a seed id is the visitor's own, so it is not an
  // example: the set the page passes here is already narrowed that way, and this
  // pins that the figure reads that set rather than counting ids itself.
  const counts = countReasoningKept([KEPT, DANGLING, BARE], [QUEUE], ["r-kept"]);
  assert.equal(counts.total, 3);
  assert.equal(counts.examples, 1);
  assert.equal(counts.added, 2);
});

// --- the clipboard text ------------------------------------------------------

test("the summary builder is pure and carries both counts, the rule, and the attribution", () => {
  const counts = countReasoningKept([KEPT, DANGLING, BARE], [QUEUE, CACHE], new Set(["r-bare"]));
  const summary = reasoningProofSummary(counts);

  assert.equal(summary, reasoningProofSummary(counts), "the summary is not the same string twice");
  assert.match(summary, /^Shiplog releases: /);
  assert.ok(summary.includes(reasoningKeptSentence(counts)), "the copied text does not carry the sentence on screen");
  assert.match(summary, /1 of 3 releases/);
  assert.ok(summary.includes(reasoningProvenanceNote(counts)), "the copied text carries no attribution");
  assert.match(summary, /Counted here: 1 example record and 2 you added\./);
  assert.ok(summary.includes(REASONING_PROOF_RULE), "the copied text does not carry the counting rule");
  // It travels without the page around it, so it states its own scope in words
  // that mean something off the page.
  assert.ok(summary.includes(REASONING_PROOF_SUMMARY_SCOPE));
  assert.doesNotMatch(REASONING_PROOF_SUMMARY_SCOPE, /below|this page's/);
  // An empty log copies the honest sentence rather than a figure.
  assert.match(reasoningProofSummary(countReasoningKept([], [])), /none to count/);
});

// --- the painted page --------------------------------------------------------

test("the block is a named region with the figure, the rule, the scope and the attribution", async (t) => {
  const page = await openPage(t);
  const region = byId(page, "reasoning-proof");
  assert.ok(page.document.querySelectorAll(".release-toggle").length > 0, "the log rendered no releases to count");

  // Named by its own heading, at the level of the blocks either side of it.
  assert.equal(region.getAttribute("aria-labelledby"), "reasoning-proof-title");
  const headings = region.querySelectorAll("h2");
  assert.equal(headings.length, 1, "the block carries a second heading");
  assert.equal(textOf(headings[0]), REASONING_PROOF_HEADING);
  assert.equal(byId(page, "reasoning-proof-title").tagName, "H2");

  assert.equal(claim(page), "1 of 3 releases in this release log links at least one decision the decision log holds.");
  assert.equal(provenance(page), "Counted here: no example records and 3 you added.");
  assert.equal(textOf(byId(page, "reasoning-proof-rule")), REASONING_PROOF_RULE);
  assert.equal(textOf(byId(page, "reasoning-proof-scope")), REASONING_PROOF_SCOPE);
  // The rule is stated where the number is, not left to the log's rows.
  assert.match(textOf(region), /does not count/);

  // ORDER (#2598): the two figures are named first, then what does not count,
  // then what they are counted over. A reader who meets an exclusion before the
  // thing it excludes from has to hold a rule with nothing to apply it to.
  const said = Array.from(region.children).map((node) => textOf(node)).filter((text) => text !== "");
  const lead = said.findIndex((text) => text.includes("at least one decision the decision log holds."));
  const excludes = said.findIndex((text) => text.includes("does not count"));
  assert.ok(lead >= 0, "the sentence naming both figures never rendered");
  assert.ok(excludes > lead, "an exclusion is stated before the figures it excludes from");
  assert.ok(said.indexOf(REASONING_PROOF_SCOPE) > excludes, "the scope note left the figures it qualifies");
  // And the lead names both numbers, not one: "N of M releases".
  assert.match(said[lead], /^\d+ of \d+ releases? in this release log/);
});

test("the figure is a live region from the first paint, before any module runs", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  const node = byId(page, "reasoning-proof-claim");

  assert.equal(node.getAttribute("role"), "status");
  assert.equal(node.getAttribute("aria-live"), "polite");
  assert.equal(node.getAttribute("aria-atomic"), "true");
  // Empty as shipped: a count is a claim the page cannot make until the log has
  // loaded, and the node has to be in the tree before its text arrives to be
  // announced at all.
  assert.equal(textOf(node), "");
  // The rule and the scope are authored, so the block is legible with no script.
  assert.equal(textOf(byId(page, "reasoning-proof-rule")), REASONING_PROOF_RULE);
  assert.equal(textOf(byId(page, "reasoning-proof-scope")), REASONING_PROOF_SCOPE);
  // And the figure's wait is not a second voice for the log's: this block says
  // nothing about loading, which the log's own status region below does.
  assert.doesNotMatch(textOf(byId(page, "reasoning-proof")), /[Ll]oading/);
});

test("the three provenance cases reach the painted attribution", async (t) => {
  const examples = await openPage(t, {
    releases: [],
    seed: { decisions: [QUEUE], releases: [KEPT, BARE] },
  });
  assert.equal(examples.document.querySelectorAll(".release-toggle").length, 2, "the seeded examples never rendered");
  assert.equal(claim(examples), "1 of 2 releases in this release log links at least one decision the decision log holds.");
  assert.equal(provenance(examples), "Counted here: 2 example records and none you added.");

  const added = await openPage(t, { releases: [KEPT, BARE] });
  assert.equal(added.document.querySelectorAll(".release-toggle").length, 2, "the stored releases never rendered");
  assert.equal(provenance(added), "Counted here: no example records and 2 you added.");

  const mixed = await openPage(t, {
    releases: [KEPT],
    seed: { decisions: [QUEUE], releases: [BARE] },
  });
  assert.equal(mixed.document.querySelectorAll(".release-toggle").length, 2, "the mixed log never rendered");
  assert.equal(claim(mixed), "1 of 2 releases in this release log links at least one decision the decision log holds.");
  assert.equal(provenance(mixed), "Counted here: 1 example record and 1 you added.");
});

test("a dangling link is not counted on the page either, and recovering the decision moves the figure", async (t) => {
  const withoutIt = await openPage(t, { releases: [KEPT, DANGLING], decisions: [QUEUE] });
  assert.equal(withoutIt.document.querySelectorAll(".release-toggle").length, 2, "the log rendered nothing to count");
  assert.equal(claim(withoutIt), "1 of 2 releases in this release log links at least one decision the decision log holds.");

  const withIt = await openPage(t, {
    releases: [KEPT, DANGLING],
    decisions: [QUEUE, decision("d-gone", "The decision that was missing")],
  });
  assert.equal(claim(withIt), "2 of 2 releases in this release log link at least one decision the decision log holds.");
});

test("a log that could not be read counts nothing rather than claiming a figure", async (t) => {
  const page = await openPage(t, { refuse: true });
  assert.equal(page.document.querySelectorAll(".release-toggle").length, 0, "the refused log still rendered rows");
  assert.equal(claim(page), NO_RELEASES_TO_COUNT);
  assert.equal(provenance(page), "Counted here: no example records and none you added.");
});

// --- the filter invariant (E): the complete loaded log ------------------------

test("filtering the log moves the list's own count and leaves the figure alone", async (t) => {
  const page = await openPage(t);
  const before = claim(page);
  assert.match(before, /1 of 3 releases/, "the precondition figure never rendered");
  assert.equal(textOf(byId(page, "release-count")), "Showing 3 releases, newest first.");

  // A search that visibly narrows the list.
  byId(page, "release-search").focus();
  typeText(page.document, "v1.0.0");
  assert.equal(page.document.querySelectorAll(".release-toggle").length, 1, "the search did not narrow the list");
  assert.equal(textOf(byId(page, "release-count")), "Showing 1 of 3 releases, newest first.");
  assert.equal(claim(page), before, "the search moved the figure");

  // And a filter that empties it: the figure still describes the whole log.
  change(byId(page, "release-status"), "cancelled");
  assert.equal(page.document.querySelectorAll(".release-toggle").length, 0, "the status filter matched something");
  assert.equal(claim(page), before, "an empty view moved the figure");
  assert.equal(provenance(page), "Counted here: no example records and 3 you added.");
  // The copy is what tells a reader that, so it is held to saying it.
  assert.match(REASONING_PROOF_SCOPE, /the search and the filters below do not change them/);
});

// --- the copy control --------------------------------------------------------

test("the copy control hands the summary to the clipboard and says so", async (t) => {
  const written = [];
  const page = await openPage(t, { clipboard: { writeText: async (text) => { written.push(text); } } });
  const button = byId(page, "reasoning-proof-copy");

  assert.equal(textOf(button), REASONING_PROOF_COPY_LABEL);
  // The label names what is copied, and the block reports two numbers (#2598),
  // so it names two — in the words the scope sentence above it already uses.
  assert.equal(REASONING_PROOF_COPY_LABEL, "Copy both numbers as a sentence");
  assert.doesNotMatch(REASONING_PROOF_COPY_LABEL, /this count/, "the control still names one figure");
  assert.match(REASONING_PROOF_SCOPE, /^Both numbers /, "the label and the scope note no longer agree");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.getAttribute("aria-label"), null, "the visible label is not the accessible name");
  assert.equal(button.getAttribute("aria-describedby"), "reasoning-proof-copy-status");
  assert.equal(button.disabled, false, "the control is still disabled after the page booted");
  assert.ok(tabSequence(page.document).includes(button), "the copy control is not reachable by Tab");

  button.click();
  await settle();
  assert.equal(written.length, 1);
  assert.equal(written[0], reasoningProofSummary(countReasoningKept([KEPT, DANGLING, BARE], [QUEUE, CACHE])));
  assert.match(written[0], /1 of 3 releases/);
  assert.match(written[0], /Counted here: no example records and 3 you added\./);
  // The copied bytes carry the page's own lead sentence, both figures included,
  // so the clipboard and the screen cannot state different numbers (#2598).
  assert.ok(written[0].includes(claim(page)), "the copied text is not the sentence on screen");
  assert.match(claim(page), /^\d+ of \d+ releases? /, "the sentence on screen lost a figure");
  assert.equal(textOf(byId(page, "reasoning-proof-copy-status")), REASONING_PROOF_COPIED_STATUS);
  assert.equal(button.disabled, false, "the control did not come back after a successful copy");
});

test("the copied sentence follows the log rather than the press that came before it", async (t) => {
  const written = [];
  const page = await openPage(t, {
    releases: [KEPT, DANGLING],
    decisions: [QUEUE],
    clipboard: { writeText: async (text) => { written.push(text); } },
  });
  byId(page, "reasoning-proof-copy").click();
  await settle();
  assert.match(written[0], /1 of 2 releases/);

  // Recording a release joins the loaded log, so the next press copies the new
  // figure rather than the one captured when the control was mounted.
  for (const [id, value] of [
    ["release-version", "v9.9.9"],
    ["release-owner", "Priya"],
    ["release-released-on", "2026-07-02"],
    ["release-description", "Recorded in this test."],
  ]) {
    byId(page, id).focus();
    typeText(page.document, value);
  }
  byId(page, "release-form").dispatchEvent(new DomEvent("submit", { bubbles: true }));
  assert.equal(page.document.querySelectorAll(".release-toggle").length, 3, "the release was not recorded");
  assert.equal(claim(page), "1 of 3 releases in this release log links at least one decision the decision log holds.");

  byId(page, "reasoning-proof-copy").click();
  await settle();
  assert.match(written[1], /1 of 3 releases/);
});

test("a clipboard that is absent or refuses is a stated failure, naming where the sentence is", async (t) => {
  for (const clipboard of [{}, { writeText: async () => { throw new Error("refused"); } }]) {
    const page = await openPage(t, { clipboard });
    page.document.querySelector("#reasoning-proof-copy").click();
    await settle();
    assert.equal(textOf(page.document.querySelector("#reasoning-proof-copy-status")), REASONING_PROOF_COPY_FAILED_STATUS);
    // The fallback is the sentence itself, which is on screen above the control.
    assert.match(claim(page), /1 of 3 releases/);
    assert.equal(page.document.querySelector("#reasoning-proof-copy").disabled, false);
  }
});

// --- placement and cost ------------------------------------------------------

test("the figure stands above the log it describes and does not repeat the example caveat", async (t) => {
  const page = await openPage(t);
  const order = page.document
    .querySelectorAll("#shiplog-proof,#evaluation-path,#reasoning-proof,#releases-title,#release-count,#release-search")
    .map((node) => node.getAttribute("id"));
  assert.deepEqual(order, [
    "shiplog-proof",
    "evaluation-path",
    "reasoning-proof",
    "releases-title",
    "release-count",
    "release-search",
  ]);
  // The example-records caveat is counted once above the record form by
  // tests/shiplog-proof.test.js; this block must not be a second occurrence.
  const region = textOf(byId(page, "reasoning-proof"));
  assert.doesNotMatch(region, /no customer or production data/);
  assert.doesNotMatch(region, /These example records are invented/);
});

test("the block pays for two rules, in the page's own sheet", async () => {
  const css = await readFile(CSS, "utf8");
  assert.match(css, /#reasoning-proof-claim \{ margin:0; \}/);
  // The attribution collapses while it has nothing to say; the figure does not,
  // because a live region rendered from display:none may never be announced.
  assert.match(css, /#reasoning-proof-provenance:empty \{ display:none; \}/);
  assert.doesNotMatch(css, /#reasoning-proof-claim:empty/);
  // Every other rule the block needs is one this page already ships.
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(styles, /reasoning-proof/, "the measured stylesheet gained a rule for this block");
  for (const selector of [".shiplog-proof", ".shiplog-proof-note", ".shiplog-proof-share"]) {
    assert.ok(css.includes(`${selector} {`), `${selector} is no longer in the sheet this block reuses`);
  }
  assert.match(styles, /\.feed-summary \{/);
});
