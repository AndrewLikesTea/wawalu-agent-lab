import test from "node:test";
import assert from "node:assert/strict";
import { initReleasesPage } from "../src/releases-page.js";
import { buildReleaseViewSummary } from "../src/release-view-summary.js";
import { RELEASE_STORAGE_KEY, summarizeReleases } from "../src/releases.js";
import { STORAGE_KEY } from "../src/app.js";
import { loadPage, textOf, typeText, pressEnter, pressSpace } from "./support/browser.js";

const decision = { id: "d", title: "Adopt queues", status: "accepted", owner: "Ari", context: "Retries", alternatives: "Polling", createdAt: "2026-01-01" };
const exampleDecision = { ...decision, id: "sample", title: "Example decision", status: "pending" };
const release = { id: "local", version: "v2", title: "Queue launch", status: "completed", owner: "Mina", createdAt: "2026-02-02", description: "Reliable delivery", decisionIds: ["d", "sample", "missing"] };
const example = { ...release, id: "example", version: "v1", title: "Preview", status: "planned", createdAt: "2026-01-01", decisionIds: [] };
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
async function boot(t, clipboard) {
  const page = await loadPage(new URL("../src/releases.html", import.meta.url), { storage: {
    [STORAGE_KEY]: JSON.stringify([decision]), [RELEASE_STORAGE_KEY]: JSON.stringify([release]),
  } });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, { clipboard, seed: { releases: [example], decisions: [exampleDecision] } });
  const node = (id) => page.document.getElementById(`release-summary-${id}`);
  // The lightweight DOM has no native text selection; model that browser API
  // and verify the controller selects the entire generated value, not a label.
  node("text").select = function () { this.selectionStart = 0; this.selectionEnd = this.value.length; };
  return { ...page, node };
}

test("stable summary includes ordered release fields, decision statuses and mixed provenance", () => {
  const shown = summarizeReleases([example, release], [decision, exampleDecision]);
  const output = buildReleaseViewSummary(shown, new Set(["example"]), new Set(["sample"]));
  assert.ok(output.indexOf("v2") < output.indexOf("v1"));
  for (const expected of ["Status: completed", "Owner: Mina", "Status date: 2026-02-02", "Summary: Reliable delivery", "Adopt queues — Accepted", "Example decision — Pending", "Linked decision missing is not in this log", "Adopt queues: Record added in this browser", "Example decision: Example record", "Source: Example record", "Source: Record added in this browser"]) assert.ok(output.includes(expected), expected);
  assert.equal(output, buildReleaseViewSummary(shown, new Set(["example"]), new Set(["sample"])));
  const bare = buildReleaseViewSummary(summarizeReleases([{ id: "bare", version: "v0", createdAt: "bad", decisionIds: [] }]), new Set(), new Set());
  assert.match(bare, /Owner: Unknown/);
  assert.match(bare, /Status: Not recorded/);
  assert.match(bare, /Status date: Unknown/);
  assert.match(bare, /No decisions linked/);
  assert.doesNotMatch(bare, /undefined|null/);
});

test("page copies exact displayed order, then follows search and decision filters with persistent accessible receipt", async (t) => {
  const writes = [];
  const page = await boot(t, { writeText: async (text) => writes.push(text) });
  const { node, document } = page;
  assert.equal(node("copy").getAttribute("aria-describedby"), "release-summary-scope release-summary-availability");
  assert.equal(node("status").getAttribute("role"), "status");
  assert.equal(node("status").getAttribute("aria-live"), "polite");
  node("copy").focus(); pressEnter(document); await tick();
  assert.ok(writes[0].indexOf("v2") < writes[0].indexOf("v1"));
  assert.match(textOf(node("status")), /Copied a summary of 2 visible releases/);
  assert.equal(document.activeElement, node("copy"));
  await tick(); assert.match(textOf(node("status")), /Copied/);
  document.querySelector("#release-search").focus(); typeText(document, "Queue");
  document.querySelector("#release-decision-status-accepted").click();
  node("copy").click(); await tick();
  assert.match(writes[1], /v2/); assert.doesNotMatch(writes[1], /v1|Preview/);
  assert.match(textOf(node("status")), /1 visible release/);
  document.querySelector("#release-search").focus(); typeText(document, "no matches");
  assert.equal(node("copy").disabled, true);
  assert.match(textOf(node("availability")), /Change the search or filters/);
  node("copy").click(); await tick(); assert.equal(writes.length, 2);
});

for (const [name, clipboard] of [["unavailable", {}], ["denied", { writeText: async () => { throw new Error("Denied"); } }], ["throws", { writeText() { throw new Error("Failure"); } }]]) {
  test(`${name} clipboard exposes labeled selectable fallback without false success`, async (t) => {
    const { node, document } = await boot(t, clipboard);
    node("copy").focus(); pressEnter(document); await tick();
    assert.equal(node("fallback").hidden, false);
    assert.match(textOf(node("status")), /Nothing was copied/);
    assert.equal(document.activeElement, node("text"));
    assert.equal(node("text").selectionEnd, node("text").value.length);
    assert.ok(document.querySelector('label[for="release-summary-text"]'));
    assert.equal(node("text").getAttribute("aria-describedby"), "release-summary-instructions");
    node("select").focus(); pressSpace(document);
    assert.equal(document.activeElement, node("text"));
    assert.equal(node("text").selectionStart, 0);
    assert.match(node("text").value, /v2/);
  });
}

test("pending clipboard failure preserves moved focus and describes changed snapshot", async (t) => {
  let reject;
  const { node, document } = await boot(t, { writeText: () => new Promise((_, fail) => { reject = fail; }) });
  node("copy").focus(); node("copy").click();
  document.querySelector("#release-search").focus(); typeText(document, "Queue");
  reject(new Error("Denied")); await tick();
  assert.equal(document.activeElement, document.querySelector("#release-search"));
  assert.match(textOf(node("status")), /view has since changed/);
  assert.match(node("text").value, /v1/);
});
