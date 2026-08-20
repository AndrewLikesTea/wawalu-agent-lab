import test from "node:test";
import assert from "node:assert/strict";
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
  // are invented, and the two links are what a reader follows next. It opens
  // with the home page's sentence for the same idea, then carries the one fact
  // the home page has no reason to state, so a reader moving between pages
  // meets one wording for it.
  assert.match(textOf(proof), /These invented records demonstrate Shiplog\. They use no customer or production data, and no such decision or release shipped\./);
  assert.match(textOf(proof), /Open either link below to read the full record/);
  assert.doesNotMatch(textOf(proof), /[Rr]epresentative/);
  assert.match(textOf(proof), /Adopt a durable job queue/);
  assert.equal(textOf(proof.querySelectorAll("dd")[1]), "Kai");
  assert.equal(textOf(proof.querySelectorAll("dd")[2]), "accepted");
  assert.equal(textOf(proof.querySelectorAll("dd")[3]), "v1.3.0 · Throughput and latency");
  // The word "proof" belongs to the deployment check below, not to invented
  // records: the share controls name what they open, and the button's
  // accessible name is its visible text rather than a differing aria-label.
  assert.doesNotMatch(textOf(proof), /proof/i);
  assert.equal(textOf(page.document.querySelector(".shiplog-proof-link")), "Open this example");
  assert.equal(textOf(copy), "Copy link to this example");
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
  assert.equal((above.match(/no customer or production data/g) ?? []).length, 1);
  assert.equal((above.match(/These invented records demonstrate Shiplog\./g) ?? []).length, 1);
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
  assert.match(intro, /the decision’s context, or the release and the decisions it carried/);
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
// What they used to reach, in this order, was the pitch, the example record,
// the deployment check and then nine fields to fill in, with the log itself at
// the bottom of the page. The record of this deployment and the check against
// it still lead — they are what the observatory's link lands on — and the log
// now stands between them and the recorder.
test("the log's heading, count, search, filters, records and export all come before the first form field", async (t) => {
  const page = await open(t);
  const order = page.document
    .querySelectorAll("#shipped-build,#shiplog-proof,#deployment-status,#releases-title,#release-count,#release-search,#release-status,#release-decision,#release-decision-status-all,#release-export,#release-list,#record-release,#release-form-title,#release-version")
    .map((node) => node.id);
  assert.deepEqual(order, [
    "shipped-build",
    "shiplog-proof",
    "deployment-status",
    "releases-title",
    "release-count",
    "release-search",
    "release-status",
    "release-decision",
    "release-decision-status-all",
    "release-export",
    "release-list",
    "record-release",
    "release-form-title",
    "release-version",
  ]);

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

  // The one tab stop this change adds, and the only one in the hero.
  const hero = page.document.querySelector(".hero");
  const heroStops = sequence.filter((node) => isWithin(node, hero));
  assert.equal(heroStops.length, 1, "the hero gained more than the one jump control");
  assert.equal(heroStops[0].id, "record-release-link");
  assert.equal(textOf(heroStops[0]), "Open the release form");
  assert.equal(heroStops[0].getAttribute("href"), "#record-release");
  assert.equal(textOf(page.document.querySelector("#release-form").querySelector("button")), "Record release");
  // The recorder panel is a focus target, not a stop: it carries tabindex="-1",
  // so nothing else joined the sequence when it became focusable.
  assert.equal(sequence.filter((node) => node.id === "record-release").length, 0);
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
  assert.match(textOf(unavailable.document.querySelector("#shiplog-proof-copy-status")), /Clipboard unavailable/);
  assert.equal(unavailable.document.querySelector(".shiplog-proof-link").tagName, "A");
});
