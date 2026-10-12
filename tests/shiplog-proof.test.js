import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initReleasesPage } from "../src/releases-page.js";
import { SAMPLE_DECISION_ID, SAMPLE_RELEASE_ID } from "../src/seed-records.js";
import { loadPage, tabSequence, textOf } from "./support/browser.js";

const PAGE = new URL("../src/releases.html", import.meta.url);

async function open(t, options = {}) {
  const page = await loadPage(PAGE, { location: options.location });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: options.location?.search ?? "", hash: options.location?.hash ?? "" },
    history: { replaceState() {} },
    clipboard: options.clipboard,
  });
  return page;
}

test("renders one clearly disclosed synthetic proof connecting decision, owner, status, and completed release", async (t) => {
  const page = await open(t);
  const proof = page.document.querySelector("#shiplog-proof");
  const copy = page.document.querySelector("#shiplog-proof-copy");
  assert.match(textOf(proof), /Example records/);
  // The panel says in a sentence what the badge says in a label: the records
  // are invented, and the two links are what a reader follows next. The
  // records have one name, the badge's, and "invented" only describes them.
  // It used to call them "invented records" and "demonstration data, not live
  // release-log data" too, three names in three lines.
  assert.match(textOf(proof), /These example records are invented: no such decision or release shipped\. They use no customer or production data\./);
  assert.doesNotMatch(textOf(proof), /demonstration data/i);
  assert.doesNotMatch(textOf(proof), /live release-log data/i);
  assert.doesNotMatch(textOf(proof), /invented records/i);
  assert.equal(textOf(proof.querySelector(".badge-example")), "Example records");
  // The deployment check shares the real record's block, above this one, so it
  // no longer needs a sentence setting itself apart from these records (#2487).
  assert.doesNotMatch(textOf(page.document.querySelector("#deployment-status-proof")), /example/i);
  assert.match(textOf(proof), /Open either link below to read the full record/);
  assert.doesNotMatch(textOf(proof), /[Rr]epresentative/);
  assert.match(textOf(proof), /Adopt a durable job queue/);
  assert.equal(textOf(proof.querySelectorAll("dd")[1]), "Kai");
  // Cased the way the "Linked decision status" filter below offers it, so the
  // example and the option a reader would pick to find it read as one word.
  assert.equal(textOf(proof.querySelectorAll("dd")[2]), "Accepted");
  assert.equal(textOf(proof.querySelectorAll("dd")[3]), "v1.3.0 · Throughput and latency");
  // The word "proof" belongs to the deployment check below, not to invented
  // records: the share controls name what they open, and the button's
  // accessible name is its visible text rather than a differing aria-label.
  assert.doesNotMatch(textOf(proof), /proof/i);
  assert.equal(textOf(page.document.querySelector(".shiplog-proof-link")), "Open this example release");
  assert.equal(textOf(copy), "Copy link to this example release");
  assert.equal(copy.getAttribute("aria-label"), null);
  assert.equal(page.document.querySelector(".shiplog-proof-link").getAttribute("href"), `/releases.html?focus=${SAMPLE_RELEASE_ID}#shiplog-proof`);
});

// The caveat used to be printed twice above the form — once in the page intro
// and once here — in two different sets of words. Counted by walking the
// rendered text of every block above the record form, so a caveat reintroduced
// anywhere up there fails, not only one reintroduced in the intro.
test("the example-records caveat is stated once above the record form", async (t) => {
  const page = await open(t);
  const main = page.document.getElementById("main-content");
  const form = page.document.getElementById("record-release");
  let above = "";
  let reachedForm = false;
  // The recorder is no longer a top-level block: the log stands above it inside
  // the workspace, so the walk descends into whichever block holds the form and
  // keeps counting the log's own text on the way down. A caveat reintroduced in
  // the log is still a caveat above the form.
  for (const block of main.children) {
    if (block === form) { reachedForm = true; break; }
    if ([...(block.children ?? [])].includes(form)) {
      for (const part of block.children) {
        if (part === form) { reachedForm = true; break; }
        above += ` ${part.textContent ?? ""}`;
      }
      break;
    }
    above += ` ${block.textContent ?? ""}`;
  }
  assert.equal(reachedForm, true, "the walk never reached the record form");
  above = above.replace(/\s+/g, " ");

  // ONE REGION ABOVE THE FORM IS ALLOWED TO RESTATE IT (#2682): the copied
  // sentence rendered beside the reasoning figure's copy control. That text is
  // the clipboard payload, printed so it can be checked without pasting, and it
  // has to carry the caveat because the figure gets forwarded to people who
  // never saw this page — so excluding it is the fix, not rewording it.
  //
  // The claim under test is unchanged: how many times the page says this in its
  // own voice, above the form. Blanked rather than cut, the way
  // tests/release-coverage-gaps.test.js excludes rendered record text, and the
  // exclusion asserts that it matched, so a renamed region fails here instead of
  // quietly stopping excluding anything.
  const copyable = page.document.getElementById("reasoning-proof-copyable");
  const recited = (copyable?.textContent ?? "").replace(/\s+/g, " ").trim();
  assert.match(recited, /no customer or production data/,
    "the copied sentence no longer carries the caveat it travels with");
  const parts = above.split(recited);
  assert.equal(parts.length, 2, "the copied sentence is not in the walk exactly once");
  above = parts.join(" ".repeat(recited.length));

  assert.equal((above.match(/no customer or production data/g) ?? []).length, 1);
  assert.equal((above.match(/These example records are invented:/g) ?? []).length, 1);
  // Said where the example records are, not in the page intro above it.
  assert.doesNotMatch(textOf(page.document.querySelector(".hero")), /example records/i);
});

// The panel used to name the trail twice before the reader reached a record —
// an eyebrow reading "From decision to release" and, directly under it, a
// heading reading "A decision carried through to release". One heading names
// it now, and the sentence beside the records says what following a link gets
// you rather than restating the heading.
test("the decision-to-release trail is named once above the first example record", async (t) => {
  const page = await open(t);
  const proof = page.document.querySelector("#shiplog-proof");
  let intro = "";
  for (const block of page.document.getElementById("main-content").children) {
    if (block.getAttribute?.("id") === "shiplog-proof") {
      for (const part of block.children) {
        if (part.classList?.contains?.("shiplog-proof-facts")) break;
        intro += ` ${part.textContent ?? ""}`;
      }
      break;
    }
    intro += ` ${block.textContent ?? ""}`;
  }
  intro = intro.replace(/\s+/g, " ");
  assert.equal((intro.match(/From decision to release/g) ?? []).length, 1,
    "the trail is named twice, or not at all, before the example record");
  assert.doesNotMatch(textOf(page.document.querySelector("body")), /A decision carried through to release/,
    "the second heading for the same idea is still rendered");
  // Counted, not compared against null: a surviving heading would send
  // assert.equal through the whole parsed page instead of failing.
  const headings = proof.querySelectorAll("h2");
  assert.equal(headings.length, 1, "the example panel carries a second heading");
  assert.equal(textOf(headings[0]), "From decision to release");
  // One instruction, and it names what the linked record shows.
  assert.equal((intro.match(/Open either link below to read the full record/g) ?? []).length, 1);
  assert.match(intro, /the decision’s context, or the release and its linked decisions/);
});

// "Record a release" printed twice in a row above the first field: an eyebrow,
// then the heading it duplicated. The eyebrow was not a control, so it is gone
// rather than relabelled.
test("the record form is named once above its first field", async (t) => {
  const page = await open(t);
  const panel = page.document.querySelector(".form-panel");
  assert.equal(panel.querySelectorAll(".eyebrow").length, 0,
    "the form carries a second name above its heading again");
  const headings = panel.querySelectorAll("h2");
  assert.equal(headings.length, 1);
  assert.equal(textOf(headings[0]), "Record a release");
  assert.equal((textOf(panel).match(/Record a release/g) ?? []).length, 1,
    "the form's name is printed more than once above its fields");
});

// --- the log above the recorder --------------------------------------------

// Walking up rather than selecting down: the harness rejects a descendant
// selector, so containment is a parent chain.
const isWithin = (node, ancestor) => {
  for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor === ancestor) return true;
  return false;
};

// A prospect follows "Explore the decision and release log" from the home page.
// What they used to reach first was the deployment record, the example records,
// the four-step guide and the coverage figure, with the log below all of it.
// The log now leads directly under the introduction (#2796); the supporting
// blocks follow it in their own order — the record and the check against it
// still together ahead of the example (#2487) — and the recorder closes the page.
test("the log's heading, count, search, filters, records and export come before every supporting block and the form", async (t) => {
  const page = await open(t);
  const order = page.document
    .querySelectorAll("#shipped-build,#shiplog-proof,#deployment-status,#evaluation-path,#reasoning-proof,#releases-title,#release-count,#release-search,#release-status,#release-decision,#release-decision-status-all,#release-export,#release-list-status,#release-list,#record-release,#release-form-title,#release-version")
    .map((node) => node.id);
  assert.deepEqual(order, [
    "releases-title",
    "release-count",
    "release-search",
    "release-status",
    "release-decision",
    "release-decision-status-all",
    "release-export",
    "release-list-status",
    "release-list",
    "shipped-build",
    "deployment-status",
    "shiplog-proof",
    "evaluation-path",
    "reasoning-proof",
    "record-release",
    "release-form-title",
    "release-version",
  ]);

  // As top-level blocks of the content region: introduction, log, then the
  // supporting material, then the recorder. Whole units, so the log's results
  // live inside the log's own section and nowhere else.
  const main = page.document.getElementById("main-content");
  const blocks = main.children.filter((node) => node.getAttribute?.("id")).map((node) => node.getAttribute("id"));
  assert.deepEqual(blocks, [
    "top", "release-log", "real-deployment", "ask-about-shiplog-actions", "release-discussion-actions",
    "shiplog-proof", "evaluation-path", "reasoning-proof", "release-recorder",
  ]);
  const log = page.document.getElementById("release-log");
  for (const id of ["releases-title", "release-search", "release-status", "release-list-status", "release-list"]) {
    assert.ok(isWithin(page.document.getElementById(id), log), `#${id} left the Release log section`);
  }
  assert.ok(isWithin(page.document.getElementById("record-release"), page.document.getElementById("release-recorder")));
  // The order is the markup's, not a rule's: no positive tabindex anywhere in
  // the content region.
  const positive = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (!child.getAttribute) continue;
      if (Number(child.getAttribute("tabindex")) > 0) positive.push(child.getAttribute("id"));
      walk(child);
    }
  };
  walk(main);
  assert.deepEqual(positive, []);

  // Scrolling from the top with the log loaded, a release record arrives before
  // any field of the recorder does.
  const records = page.document.querySelectorAll(".release-item,#release-version");
  assert.ok(records.length > 1, "the log rendered no records to read before the form");
  assert.ok(records[0].classList.contains("release-item"),
    "the first thing reached below the log's controls is a form field, not a release");
});

// Tab order and reading order are the same order because the markup moved, not
// because a rule reorders the paint. Asserted on the sequence a browser would
// build, so a CSS-only reordering of these panels would fail here.
test("tab order reaches the log's controls before the recorder's fields, and adds one stop", async (t) => {
  const page = await open(t);
  const sequence = tabSequence(page.document);
  const at = (id) => sequence.findIndex((node) => node.id === id);

  for (const id of ["release-search", "release-status", "release-decision", "release-decision-status-all", "release-export"]) {
    assert.ok(at(id) >= 0, `${id} is not in the tab order at all`);
    assert.ok(at(id) < at("release-version"), `${id} is tabbed to after the recorder's first field`);
  }
  // The rows are reached before the form too: one stop for the list, because
  // the release toggles are the log's own roving widget.
  const firstToggle = sequence.findIndex((node) => node.classList?.contains?.("release-toggle"));
  assert.ok(firstToggle >= 0 && firstToggle < at("release-version"),
    "a release row is not reachable before the recorder's first field");

  // The hero's one route: the page's own action. The ask that #2458 put beside
  // it moved below the deployment record in #2654, so the opening screen is the
  // promise and the recorder rather than a paragraph about a follow-up form.
  // Counted, so a second control has to be added here before it can be added to
  // the hero.
  const hero = page.document.querySelector(".hero");
  const heroStops = sequence.filter((node) => isWithin(node, hero));
  assert.equal(heroStops.length, 1, "the hero gained a control beyond its one route");
  assert.equal(heroStops[0].id, "record-release-link");
  assert.equal(textOf(heroStops[0]), "Open the form to record a release");
  assert.equal(heroStops[0].getAttribute("href"), "#record-release");

  // And the ask is still reached exactly once, after the record it follows and
  // before the example records below it.
  const ask = sequence.filter((node) => node.id === "ask-about-shiplog");
  assert.equal(ask.length, 1, `the ask is reachable ${ask.length} times`);
  assert.equal(textOf(ask[0]), "Ask about Shiplog");
  assert.equal(ask[0].getAttribute("href"), "#site-footer-panel");
  assert.ok(sequence.indexOf(ask[0]) > sequence.indexOf(heroStops[0]),
    "the ask is tabbed to before the page's own action");
  assert.ok(isWithin(ask[0], page.document.querySelector("#ask-about-shiplog-actions")),
    "the ask left the row its description sits in");
  assert.equal(textOf(page.document.querySelector("#release-form").querySelector("button")), "Record release");
  // The recorder panel is a focus target, not a stop: it carries tabindex="-1",
  // so nothing else joined the sequence when it became focusable.
  assert.equal(sequence.filter((node) => node.id === "record-release").length, 0);
});

// The whole page in Tab order (#2796): the introduction's one link, the log's
// search and filters, its results, then each supporting block's controls in
// their order, then the form. The status-of-linked-decisions radios are one stop.
test("tab order runs intro link, search, filters, results, supporting blocks, then the form", async (t) => {
  const page = await open(t);
  const sequence = tabSequence(page.document);
  const at = (id) => sequence.findIndex((node) => node.id === id);
  const firstToggle = sequence.findIndex((node) => node.classList?.contains?.("release-toggle"));
  const chain = [
    at("record-release-link"), at("release-search"), at("release-status"), at("release-decision"),
    at("release-decision-status-all"), at("release-export"), firstToggle,
    at("ask-about-shiplog"), at("shiplog-proof-copy"), at("evaluation-path-action"), at("release-version"),
  ];
  for (const index of chain) assert.ok(index >= 0, `a stop in the chain ${JSON.stringify(chain)} is not reachable`);
  for (let i = 1; i < chain.length; i += 1) {
    assert.ok(chain[i] > chain[i - 1], `stop ${i} of ${JSON.stringify(chain)} is tabbed to out of order`);
  }
  const radios = sequence.filter((node) => node.getAttribute?.("name") === "release-decision-status");
  assert.equal(radios.length, 1, "the linked-decision status radios are more than one tab stop");
});

// Supporting material moved, it was not cut: each block keeps its heading and
// one action a reader can still reach.
test("the supporting blocks keep their headings and actions below the log", async (t) => {
  const page = await open(t);
  const sequence = tabSequence(page.document);
  const blocks = [
    ["real-deployment", "shipped-build-title", "Deployment record", "deployment-copy"],
    ["shiplog-proof", "shiplog-proof-title", "From decision to release", "shiplog-proof-copy"],
    ["evaluation-path", "evaluation-path-title", "Try the whole demo in four steps", "evaluation-path-action"],
    ["reasoning-proof", "reasoning-proof-title", "Releases on this page that link a decision", "reasoning-proof-copy"],
  ];
  for (const [block, heading, words, action] of blocks) {
    const region = page.document.getElementById(block);
    assert.ok(isWithin(page.document.getElementById(heading), region), `#${heading} left #${block}`);
    assert.equal(textOf(page.document.getElementById(heading)), words);
    const control = page.document.getElementById(action);
    assert.ok(isWithin(control, region), `#${action} left #${block}`);
    assert.equal(control.hidden, false, `#${action} is hidden`);
  }
  // The JSON export stays with the log it exports, and both reachable controls
  // are in the Tab order.
  assert.ok(isWithin(page.document.getElementById("release-export"), page.document.getElementById("release-log")));
  for (const id of ["shiplog-proof-copy", "evaluation-path-action"]) {
    assert.equal(sequence.filter((node) => node.id === id).length, 1, `#${id} is not one tab stop`);
  }
});

// The harness models no layout, so the narrow-width and focus-ring claims are
// the rules themselves.
test("at a phone width the log's chips wrap in the column, and the intro link has the focus ring", async () => {
  const sheet = await readFile(new URL("../src/releases-proof.css", import.meta.url), "utf8");
  const site = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const narrow = sheet.match(/@media\(max-width:520px\) \{ \.release-filters [^\n]*\}/)?.[0] ?? "";
  assert.match(narrow, /\.release-filters \.filter\{min-width:0\}/);
  assert.match(narrow, /\.release-filters \.filter-option\{max-width:100%\}/);
  assert.match(narrow, /#release-log \.badge\{[^}]*max-width:100%[^}]*white-space:normal/);
  // Words are never split mid-word: no anywhere-wrap on the chips' labels.
  assert.doesNotMatch(narrow, /overflow-wrap:anywhere/);
  // The chips' row already wraps, and the filters stack at the same width.
  assert.match(site, /\.filter-options \{ display:flex; flex-wrap:wrap;/);
  assert.match(site, /@media\(max-width:520px\) \{ \.release-filters\{align-items:stretch;flex-direction:column\}/);
  // The intro link is a plain anchor wearing an existing class, so the site's
  // focus ring is what draws on it.
  const page = await loadPage(PAGE);
  try {
    const link = page.document.querySelector("#record-release-link");
    assert.equal(link.tagName, "A");
    assert.equal(link.getAttribute("class"), "text-link");
  } finally {
    page.restore();
  }
  assert.match(site, /a:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
});

test("the jump control puts focus on the record-a-release form", async (t) => {
  const page = await open(t);
  const panel = page.document.querySelector("#record-release");
  assert.equal(panel.getAttribute("aria-labelledby"), "release-form-title",
    "the landing region is not named by the form's heading");
  assert.equal(panel.getAttribute("tabindex"), "-1");

  page.document.querySelector("#record-release-link").click();
  const focused = page.document.activeElement;
  assert.ok(focused === panel || isWithin(focused, panel),
    "activating the jump control left focus outside the recorder");
  // Focus, not only a scroll: the next Tab is inside the form.
  assert.ok(isWithin(page.document.querySelector("#release-version"), panel));
});

// The hero's link used to be named for the destination alone, which read like
// the record links a few blocks below it. It now states the action too, in the
// form's own words. Pinned as a relationship rather than a second copy of the
// string: the link is checked against the heading of the panel it lands on, so
// renaming one and not the other fails here instead of drifting.
test("the jump control names the form it opens and reads unlike the links that open records", async (t) => {
  const page = await open(t);
  const link = page.document.querySelector("#record-release-link");
  const label = textOf(link);
  assert.match(label, /^Open the form to /, "the link no longer says a form is what it opens");
  const heading = textOf(page.document.querySelector("#release-form-title"));
  assert.ok(label.endsWith(heading.toLowerCase()),
    `the link ends "${label}" but the form it opens is headed "${heading}"`);

  // Distinguishable from the real record, the example record and the repository:
  // those open something already written, this one opens the form that writes
  // one. Compared as strings, never element against element.
  const others = page.document.querySelectorAll("a").filter((node) => node.id !== "record-release-link");
  assert.ok(others.length > 2, "the page rendered too few links for this to be a real comparison");
  for (const other of others) {
    assert.notEqual(textOf(other), label, "another link on the page reads exactly like the form's link");
    assert.doesNotMatch(textOf(other), /the form/, "a link that opens a record claims to open the form");
  }
});

test("deep link identifies and expands the same release so its linked decision is visible", async (t) => {
  const page = await open(t, { location: { search: `?focus=${SAMPLE_RELEASE_ID}`, hash: "#shiplog-proof" } });
  const toggle = page.document.querySelectorAll(".release-toggle").find((node) => node.dataset.releaseId === SAMPLE_RELEASE_ID);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const panel = page.document.getElementById(toggle.getAttribute("aria-controls"));
  assert.equal(panel.hidden, false);
  assert.match(textOf(panel), /Adopt a durable job queue/);
  assert.match(panel.querySelector(".release-decision-link").getAttribute("href"), new RegExp(SAMPLE_DECISION_ID));
});

test("copy announces success and keeps a usable share link when clipboard is unavailable", async (t) => {
  let copied = "";
  const page = await open(t, { clipboard: { writeText: async (value) => { copied = value; } } });
  const button = page.document.querySelector("#shiplog-proof-copy");
  button.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(copied, `https://labs.wawalu.org/releases.html?focus=${SAMPLE_RELEASE_ID}#shiplog-proof`);
  assert.equal(textOf(page.document.querySelector("#shiplog-proof-copy-status")), "Example link copied to clipboard.");

  const unavailable = await open(t, { clipboard: {} });
  unavailable.document.querySelector("#shiplog-proof-copy").click();
  await Promise.resolve();
  await Promise.resolve();
  // The fallback sends a visitor to a control by name, so it is held to the name
  // that control actually carries rather than to a copy of it written here: a
  // rename of the link that leaves this sentence behind tells a visitor whose
  // clipboard just failed to look for a control the page does not have.
  const fallbackLink = unavailable.document.querySelector(".shiplog-proof-link");
  assert.equal(fallbackLink.tagName, "A");
  const fallback = textOf(unavailable.document.querySelector("#shiplog-proof-copy-status"));
  assert.match(fallback, /^Clipboard unavailable\./);
  assert.ok(fallback.includes(textOf(fallbackLink)), `the clipboard fallback ${JSON.stringify(fallback)} names a control this page does not have`);
});
