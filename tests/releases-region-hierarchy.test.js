// The Releases page's three regions — deployment evidence (the record and the
// check), the coverage count, and the release log — each own their state
// (#2806). Driven through the shipped src/releases.html with every loader
// stubbed on its own: the deployment record through `deployedRelease`, the
// deployment check through a `readHealth` the test resolves when it chooses,
// and the coverage count and the log through a storage double that can refuse
// the release key.
//
// The harness models no layout, so this file pins DOM order, labels, live text,
// and which buttons exist in which state. Painted order, contrast, and wrapping
// at 390px are not observable here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };
const DECISION = { id: "d-queue", title: "Adopt a durable queue", context: "Retries.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" };
const STORED = [
  { id: "r-one", version: "v1.0.0", title: "First", description: "One.", owner: "Kai", status: "completed", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: ["d-queue"] },
];
const RECORD = { id: "shipped-abc1234", version: "abc1234", title: "Deployed build", status: "completed", owner: "CI", createdAt: "2026-02-01T00:00:00.000Z" };
const REGIONS = ["real-deployment", "shipped-build", "deployment-status", "reasoning-proof", "releases-title", "release-list-status"];

// One health read per call, each settled by the test; `calls` counts reads.
function healthStub() {
  const pending = [];
  const read = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  return { read, pending, get calls() { return pending.length; } };
}

async function openPage(t, { refuse = false, record = RECORD } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([DECISION]), [RELEASE_STORAGE_KEY]: JSON.stringify(STORED) },
  });
  t.after(() => page.restore());
  const { getItem } = page.storage;
  const control = { refuse, releaseReads: 0 };
  page.storage.getItem = (key) => {
    if (key === RELEASE_STORAGE_KEY) {
      control.releaseReads += 1;
      if (control.refuse) throw new Error("storage refused the read");
    }
    return getItem(key);
  };
  const health = healthStub();
  initReleasesPage(page.document, page.storage, {
    seed: NO_SEED, deployedRelease: record, readHealth: health.read, now: () => "2026-02-02T00:00:00.000Z",
  });
  return { page, control, health };
}

const byId = (page, id) => page.document.querySelector(`#${id}`);
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

// Every id in document order, by walking children (no universal selector).
function documentIds(node, out = []) {
  const id = node.getAttribute?.("id");
  if (id) out.push(id);
  for (const child of node.children ?? []) if (child.getAttribute) documentIds(child, out);
  return out;
}
const regionOrder = (page) => documentIds(page.document.documentElement ?? page.document).filter((id) => REGIONS.includes(id));

// Counts textContent writes to one node, on the instance only.
function countWrites(node) {
  let proto = Object.getPrototypeOf(node);
  let descriptor;
  while (proto && !(descriptor = Object.getOwnPropertyDescriptor(proto, "textContent"))) proto = Object.getPrototypeOf(proto);
  const spy = { writes: 0 };
  Object.defineProperty(node, "textContent", {
    configurable: true,
    get() { return descriptor.get.call(this); },
    set(value) { spy.writes += 1; descriptor.set.call(this, value); },
  });
  return spy;
}

test("the three regions are labelled and stay in authored order whichever loader settles first", async (t) => {
  const { page, health } = await openPage(t, { refuse: true });
  assert.deepEqual(regionOrder(page), REGIONS);
  assert.match(textOf(byId(page, byId(page, "real-deployment").getAttribute("aria-labelledby"))), /deployment record/i);
  assert.equal(textOf(byId(page, byId(page, "deployment-status").getAttribute("aria-labelledby"))), "Deployment check");
  assert.equal(textOf(byId(page, byId(page, "reasoning-proof").getAttribute("aria-labelledby"))), "Releases on this page that link a decision");
  assert.equal(textOf(byId(page, "releases-title")), "Release log");
  // The log and the count failed first; the check settles last, and late.
  health.pending[0].reject(new Error("offline"));
  await settle();
  assert.deepEqual(regionOrder(page), REGIONS);
});

test("each region's waiting and failed text names that region, and only failures offer a retry", async (t) => {
  const { page, control, health } = await openPage(t, { refuse: true });
  assert.equal(textOf(byId(page, "deployment-verdict")), "Checking the running build now…");
  assert.equal(byId(page, "deployment-retry").hidden, true);
  assert.match(textOf(byId(page, "coverage-gap-result")), /^Couldn’t count coverage\./);
  assert.equal(byId(page, "coverage-gap-retry").hidden, false);
  assert.equal(textOf(byId(page, "release-list-status").querySelector("h3")), "Couldn’t load releases");
  assert.equal(page.document.querySelectorAll(".release-retry-action").filter((b) => !b.hidden).length, 1);

  health.pending[0].reject(new Error("offline"));
  await settle();
  assert.match(textOf(byId(page, "deployment-verdict")), /^The check did not complete/);
  assert.equal(byId(page, "deployment-retry").hidden, false);
  assert.equal(textOf(byId(page, "deployment-retry")), "Retry the deployment check");

  // The log recovers through its own retry; the coverage count follows the
  // same read, and both retries withdraw.
  control.refuse = false;
  page.document.querySelector(".release-retry-action").focus();
  pressEnter(page.document);
  assert.equal(byId(page, "coverage-gap-retry").hidden, true);
  assert.equal(page.document.querySelectorAll(".release-retry-action").filter((b) => !b.hidden).length, 0);
  assert.equal(byId(page, "deployment-retry").hidden, false, "the check's retry belongs to the check alone");
});

// "In progress", not "loading": the coverage block never echoes the log's own
// wait (release-reasoning-proof.test.js), but its wait still names the count.
test("a fresh page says the coverage count is still in progress, in the count's own words", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { storage: {} });
  t.after(() => page.restore());
  assert.equal(textOf(byId(page, "coverage-gap-result")), "Coverage count still in progress.");
  assert.equal(byId(page, "coverage-gap-retry").hidden, true);
  assert.equal(byId(page, "deployment-retry").hidden, true);
});

test("the deployment check's retry re-runs only the health probe", async (t) => {
  const { page, control, health } = await openPage(t);
  health.pending[0].reject(new Error("offline"));
  await settle();
  const reads = control.releaseReads;
  const retry = byId(page, "deployment-retry");
  retry.focus();
  pressEnter(page.document);
  assert.equal(health.calls, 2);
  assert.equal(control.releaseReads, reads, "the log and the count were not read again");
  assert.equal(textOf(byId(page, "deployment-verdict")), "Checking the running build now…");
  assert.equal(retry.hidden, false, "the pressed button stays under focus while the probe runs");
  pressEnter(page.document);
  assert.equal(health.calls, 2, "a second press during the probe starts nothing");
  health.pending[1].resolve({ status: "ok", build: "abc1234" });
  await settle();
  assert.match(textOf(byId(page, "deployment-verdict")), /^Confirmed:/);
  assert.equal(retry.hidden, true);
  assert.equal(page.document.activeElement?.getAttribute("id"), "deployment-status");
});

test("the coverage retry re-reads the stores but never calls the health probe", async (t) => {
  const { page, control, health } = await openPage(t, { refuse: true });
  control.refuse = false;
  byId(page, "coverage-gap-retry").focus();
  pressEnter(page.document);
  assert.equal(health.calls, 1);
  assert.match(textOf(byId(page, "coverage-gap-result")), /^Covered: 1\. Total: 1\./);
});

test("a region that did not change keeps its live text unwritten", async (t) => {
  const { page, health } = await openPage(t);
  const coverage = countWrites(byId(page, "coverage-gap-result"));
  const record = countWrites(byId(page, "shipped-build-note"));
  const logHeading = countWrites(byId(page, "release-list-status").querySelector("h3"));
  const verdict = countWrites(byId(page, "deployment-verdict"));
  health.pending[0].resolve({ status: "ok", build: "abc1234" });
  await settle();
  assert.equal(verdict.writes, 1);
  assert.deepEqual([coverage.writes, record.writes, logHeading.writes], [0, 0, 0]);
  // A filter change redraws the log, which was and still is showing rows.
  const search = byId(page, "release-search");
  search.value = "First";
  search.dispatchEvent({ type: "input", bubbles: true });
  assert.deepEqual([coverage.writes, record.writes, logHeading.writes, verdict.writes], [0, 0, 0, 1]);
});

test("recovery buttons come first in region order, then the filters, then the log", async (t) => {
  const { page, health } = await openPage(t, { refuse: true });
  health.pending[0].reject(new Error("offline"));
  await settle();
  const ids = tabSequence(page.document).map((node) => node.getAttribute("id") ?? node.className);
  const at = (key) => ids.findIndex((id) => id.includes(key));
  assert.ok(at("deployment-retry") >= 0 && at("coverage-gap-retry") >= 0 && at("release-retry-action") >= 0);
  assert.ok(at("deployment-retry") < at("coverage-gap-retry"));
  assert.ok(at("coverage-gap-retry") < at("release-search"));
  // The log's retry stands in the status region it recovers, directly above
  // the rows, so it follows the filters that narrow those rows.
  assert.ok(at("release-search") < at("release-retry-action"));
});

// The harness lays nothing out, so wrapping at 390px is pinned at the source.
test("every region's state text and recovery control may wrap anywhere", async () => {
  const css = await readFile(new URL("../src/releases-proof.css", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const wraps = (sheet, selector) => sheet.replace(/\/\*[\s\S]*?\*\//g, "").split("}").some((rule) => {
    const [selectors, body = ""] = rule.split("{");
    return selectors.split(",").map((s) => s.trim()).includes(selector) && body.includes("overflow-wrap:anywhere");
  });
  for (const selector of ["#deployment-retry", ".coverage-gap-reveal .empty-action", ".coverage-gap-reveal", "#release-list-status"]) {
    assert.ok(wraps(css, selector), `${selector} must wrap`);
  }
  for (const selector of [".release-followup-lead", ".detail-summary"]) assert.ok(wraps(styles, selector), `${selector} must wrap`);
});

test("with the log loaded, the check's retry precedes the filters, which precede the rows", async (t) => {
  const { page, health } = await openPage(t);
  health.pending[0].reject(new Error("offline"));
  await settle();
  const ids = tabSequence(page.document).map((node) => node.getAttribute("id") ?? node.className);
  const at = (key) => ids.findIndex((id) => id.includes(key));
  assert.ok(at("deployment-retry") >= 0 && at("release-toggle") >= 0);
  assert.ok(at("deployment-retry") < at("release-search"));
  assert.ok(at("release-search") < at("release-toggle"));
  assert.equal(at("coverage-gap-retry"), -1);
});
