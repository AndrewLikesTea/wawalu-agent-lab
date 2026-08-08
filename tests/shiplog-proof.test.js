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
  assert.match(textOf(proof), /Synthetic example · not customer data/);
  assert.match(textOf(proof), /Adopt a durable job queue/);
  assert.equal(textOf(proof.querySelectorAll("dd")[1]), "Kai");
  assert.equal(textOf(proof.querySelectorAll("dd")[2]), "accepted");
  assert.equal(textOf(proof.querySelectorAll("dd")[3]), "v1.3.0 · Throughput and latency");
  assert.equal(copy.getAttribute("aria-label"), "Copy link to this synthetic Shiplog proof");
  assert.equal(page.document.querySelector(".shiplog-proof-link").getAttribute("href"), `/releases.html?focus=${SAMPLE_RELEASE_ID}#shiplog-proof`);
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
  assert.equal(textOf(page.document.querySelector("#shiplog-proof-copy-status")), "Proof link copied to clipboard.");

  const unavailable = await open(t, { clipboard: {} });
  unavailable.document.querySelector("#shiplog-proof-copy").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(textOf(unavailable.document.querySelector("#shiplog-proof-copy-status")), /Clipboard unavailable/);
  assert.equal(unavailable.document.querySelector(".shiplog-proof-link").tagName, "A");
});
