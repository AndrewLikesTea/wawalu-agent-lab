import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { copyRecordUrl, createShareControl, recordHref, recordUrl } from "../src/share-link.js";
import { first, installDocument } from "./support/dom.js";

installDocument();

test("record links are stable direct routes for the exact encoded record", () => {
  assert.equal(recordHref("decision", "demo queue/1"), "/decision.html?id=demo%20queue%2F1");
  assert.equal(recordHref("release", "demo-r-1-3-0"), "/release.html?id=demo-r-1-3-0");
  assert.equal(recordUrl("https://labs.wawalu.org", "release", "r1"), "https://labs.wawalu.org/release.html?id=r1");
  assert.equal(recordHref("unknown", "r1"), "");
  assert.equal(recordHref("decision", ""), "");
});

test("copy behavior reports clipboard success and resilient failure", async () => {
  let copied = "";
  assert.equal(await copyRecordUrl({ writeText: async (value) => { copied = value; } }, "https://example.test/decision.html?id=d1"), true);
  assert.equal(copied, "https://example.test/decision.html?id=d1");
  assert.equal(await copyRecordUrl({ writeText: async () => { throw new Error("denied"); } }, "https://example.test/release.html?id=r1"), false);
  assert.equal(await copyRecordUrl(undefined, "https://example.test/release.html?id=r1"), false);
});

test("copy control announces the result without changing the direct URL", async () => {
  let copied = "";
  const control = createShareControl({
    type: "decision",
    id: "demo-queue",
    origin: "https://labs.wawalu.org",
    clipboard: { writeText: async (value) => { copied = value; } },
  });
  const button = first(control, "share-button");
  const status = first(control, "share-status");
  await button.listeners.click[0]();
  assert.equal(copied, "https://labs.wawalu.org/decision.html?id=demo-queue");
  assert.equal(status.textContent, "Link copied to clipboard.");
  assert.equal(button.disabled, false);

  const denied = createShareControl({
    type: "release",
    id: "demo-r-1-3-0",
    origin: "https://labs.wawalu.org",
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  });
  await first(denied, "share-button").listeners.click[0]();
  assert.match(first(denied, "share-status").textContent, /Could not copy/);
});

test("public proof pages expose required content, relationships, and announced copy feedback", async () => {
  const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const [decision, release, share, decisionPage, releasePage] = await Promise.all([
    read("decision-detail.js"),
    read("releases.js"),
    read("share-link.js"),
    read("decision-page.js"),
    read("release-page.js"),
  ]);
  assert.match(decision, /Releases that carry this decision/);
  assert.match(decision, /\["Status", statusWord/);
  assert.match(decision, /\["Owner", decision\.owner/);
  assert.match(release, /renderMetaRow\("Status"/);
  assert.match(release, /renderMetaRow\("Owner"/);
  assert.match(release, /Decisions in this release/);
  assert.match(share, /Link copied to clipboard\./);
  assert.match(share, /role", "status"/);
  assert.match(share, /Could not copy the link/);
  assert.match(decisionPage, /publicDecisionIds\.has\(id\)/);
  assert.match(releasePage, /publicReleaseIds\.has\(id\)/);
  assert.doesNotMatch(`${decision}\n${release}\n${decisionPage}\n${releasePage}`, /innerHTML/);
});

test("direct proof pages include an initial accessible loading state", async () => {
  const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const [decisionHtml, releaseHtml] = await Promise.all([read("decision.html"), read("release.html")]);
  for (const html of [decisionHtml, releaseHtml]) {
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /role="status"/);
  }
  // Two ways to draw a served wait, both announced. The release page still
  // spins a described state; the decision page draws a skeleton in the record's
  // own layout and says one line out loud instead of three.
  assert.match(releaseHtml, /list-state-loading/);
  assert.match(decisionHtml, /class="detail-skeleton"/);
  assert.match(decisionHtml, /role="status"><h1[^>]*>Loading decision record</);
});
