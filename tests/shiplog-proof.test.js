import test from "node:test";
import assert from "node:assert/strict";
import { initReleasesPage } from "../src/releases-page.js";
import { SAMPLE_DECISION_ID, SAMPLE_RELEASE_ID } from "../src/seed-records.js";
import { loadPage, textOf } from "./support/browser.js";

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
  assert.match(textOf(proof), /Open each link below to follow the trail/);
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
  let above = "";
  let reachedForm = false;
  for (const block of main.children) {
    if (block.getAttribute?.("id") === "record-release") { reachedForm = true; break; }
    above += ` ${block.textContent ?? ""}`;
  }
  assert.equal(reachedForm, true, "the walk never reached the record form");
  above = above.replace(/\s+/g, " ");
  assert.equal((above.match(/no customer or production data/g) ?? []).length, 1);
  assert.equal((above.match(/These invented records demonstrate Shiplog\./g) ?? []).length, 1);
  // Said where the example records are, not in the page intro above it.
  assert.doesNotMatch(textOf(page.document.querySelector(".hero")), /example records/i);
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
