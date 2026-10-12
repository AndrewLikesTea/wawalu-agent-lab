// The Releases log leads the page (#2796): intro, then the log's search,
// filters and results, then the supporting material (deployment record,
// example records, four-step guide, coverage figure), then the recorder.
//
// Order is asserted on indices into the markup and the tab sequence, never by
// comparing harness elements, which hangs the run. The hero's one link and its
// focus landing are pinned in tests/shiplog-proof.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { loadPage, tabSequence, textOf } from "./support/browser.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const STYLES = new URL("../src/styles.css", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };
const DECISION = { id: "d-queue", title: "Adopt a durable queue", context: "Retries.", owner: "Kai", status: "accepted", createdAt: "2026-01-02T09:00:00.000Z" };
const STORED = [
  { id: "r-one", version: "v1.0.0", title: "First", description: "One.", owner: "Kai", status: "completed", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: [] },
  { id: "r-two", version: "v1.1.0", title: "Second", description: "Two.", owner: "Ari", status: "completed", createdAt: "2026-03-01T00:00:00.000Z", decisionIds: ["d-queue"] },
];

const SUPPORTING = ["real-deployment", "shiplog-proof", "evaluation-path", "reasoning-proof"];

async function openPage(t, { releases = STORED, refuse = false, boot = true } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([DECISION]), [RELEASE_STORAGE_KEY]: JSON.stringify(releases) },
  });
  t.after(() => page.restore());
  const { getItem } = page.storage;
  page.storage.getItem = (key) => {
    if (key === RELEASE_STORAGE_KEY && refuse) throw new Error("storage refused the read");
    return getItem(key);
  };
  if (boot) initReleasesPage(page.document, page.storage, { seed: NO_SEED });
  return page;
}

const byId = (page, id) => page.document.querySelector(`#${id}`);
// Ids of every ancestor, nearest first. The harness rejects descendant
// selectors, so containment is a parent chain.
function ancestry(node) {
  const ids = [];
  for (let cursor = node; cursor; cursor = cursor.parentNode) {
    const id = cursor.getAttribute?.("id");
    if (id) ids.push(id);
    if (cursor.getAttribute?.("aria-label") === "Release log") ids.push("@release-log");
  }
  return ids;
}
const inLog = (node) => ancestry(node).includes("@release-log");

test("the log's heading, search, filters and results come before every supporting section", async () => {
  const html = await readFile(RELEASES_PAGE, "utf8");
  const order = [
    "page-title", "record-release-link",
    "releases-title", "release-search", "release-status", "release-decision", "release-decision-status-all",
    "release-list-status", "release-list",
    "real-deployment", "deployment-status", "ask-about-shiplog-actions", "shiplog-proof", "evaluation-path",
    "reasoning-proof", "coverage-gap-definition", "coverage-gap-worklist",
    "record-release", "release-form",
  ];
  for (const id of order) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id} is not in the page exactly once`);
  }
  const at = order.map((id) => html.indexOf(`id="${id}"`));
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i - 1] < at[i], `#${order[i - 1]} no longer comes before #${order[i]}`);
  }
  // The log may not say "uncovered" ahead of the definition below it: the
  // worklist that does moved into the coverage block for that reason.
  const log = html.slice(html.indexOf('aria-label="Release log"'), html.indexOf('id="real-deployment"'))
    .replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(log, /uncovered/i, "the log says “uncovered” before the page defines it");
});

test("loading, populated, empty and failed all render in the log's own status region", async (t) => {
  const loading = await openPage(t, { boot: false });
  assert.ok(inLog(byId(loading, "release-list-status")), "the status region left the log section");
  assert.equal(textOf(byId(loading, "release-list-status").querySelector("h3")), "Loading releases…");

  const cases = [
    ["populated", { releases: STORED }],
    ["empty", { releases: [] }],
    ["failed", { refuse: true }],
  ];
  for (const [name, options] of cases) {
    const page = await openPage(t, options);
    const status = byId(page, "release-list-status");
    assert.ok(inLog(status), `${name}: the status region left the log section`);
    assert.ok(inLog(byId(page, "release-list")), `${name}: the list left the log section`);
    if (name === "populated") {
      assert.equal(page.document.querySelectorAll(".release-toggle").length, 2);
    } else {
      assert.match(textOf(status.querySelector("h3")),
        name === "empty" ? /^No releases recorded yet/ : /^Couldn’t load releases/);
    }
    // No state moves the visitor into the supporting material on its own.
    const focusedIn = ancestry(page.document.activeElement);
    for (const id of SUPPORTING) {
      assert.equal(focusedIn.includes(id), false, `${name}: focus landed inside #${id}`);
    }
  }
});

test("every supporting section keeps its heading and its actions", async (t) => {
  const page = await openPage(t);
  const sections = [
    ["real-deployment", "shipped-build-title", /deployment record/i, ["deployment-copy"]],
    ["deployment-status", "deployment-status-title", /^Deployment check$/, ["deployment-evidence-summary"]],
    ["shiplog-proof", "shiplog-proof-title", /^From decision to release$/, ["shiplog-proof-copy"]],
    ["evaluation-path", "evaluation-path-title", /^Try the whole demo in four steps$/, ["evaluation-path-action"]],
    ["reasoning-proof", "reasoning-proof-title", /^Releases on this page that link a decision$/, ["reasoning-proof-copy", "coverage-gap-toggle"]],
    ["record-release", "release-form-title", /^Record a release$/, ["release-version"]],
  ];
  for (const [section, heading, name, actions] of sections) {
    assert.equal(page.document.querySelectorAll(`#${section}`).length, 1, `#${section} is gone`);
    assert.match(textOf(byId(page, heading)), name, `#${section} lost its heading`);
    assert.ok(ancestry(byId(page, heading)).includes(section), `#${heading} left #${section}`);
    assert.equal(inLog(byId(page, heading)), false, `#${section} moved into the log`);
    for (const action of actions) {
      assert.ok(ancestry(byId(page, action)).includes(section), `#${action} left #${section}`);
    }
  }
  assert.equal(page.document.querySelectorAll(".shiplog-proof-link").length, 1, "the example record lost its link");
  assert.equal(byId(page, "evaluation-path-steps").querySelectorAll("li").length, 4);
});

test("Tab order follows the reading order: intro link, log, supporting material, recorder", async (t) => {
  const page = await openPage(t);
  const sequence = tabSequence(page.document);
  const at = (id) => sequence.findIndex((node) => node.getAttribute?.("id") === id);
  const firstRow = sequence.findIndex((node) => node.classList?.contains?.("release-toggle"));
  const stops = [
    ["record-release-link", at("record-release-link")],
    ["release-search", at("release-search")],
    ["release-status", at("release-status")],
    ["release-decision", at("release-decision")],
    ["release-decision-status-all", at("release-decision-status-all")],
    ["release-export", at("release-export")],
    ["first release row", firstRow],
    ["ask-about-shiplog", at("ask-about-shiplog")],
    ["shiplog-proof-copy", at("shiplog-proof-copy")],
    ["evaluation-path-action", at("evaluation-path-action")],
    ["coverage-gap-toggle", at("coverage-gap-toggle")],
    ["reasoning-proof-copy", at("reasoning-proof-copy")],
    ["release-version", at("release-version")],
  ];
  for (const [name, index] of stops) assert.ok(index >= 0, `${name} is not in the tab order`);
  for (let i = 1; i < stops.length; i += 1) {
    assert.ok(stops[i - 1][1] < stops[i][1], `${stops[i - 1][0]} is tabbed to after ${stops[i][0]}`);
  }
  // No positive tabindex anywhere: the order is the markup's.
  const html = await readFile(RELEASES_PAGE, "utf8");
  assert.doesNotMatch(html, /tabindex="[1-9]/);
});

// The harness models no layout, so the narrow-width promise is held on the CSS:
// the log's controls wrap rather than widen the page.
test("the log's filters and chips wrap at narrow widths", async () => {
  const css = await readFile(STYLES, "utf8");
  assert.match(css, /\.release-filters \{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.filter-options \{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.share-control \{[^}]*flex-wrap:wrap/);
  assert.match(css, /@media\(max-width:520px\) \{ \.release-filters\{align-items:stretch;flex-direction:column\}/);
});
