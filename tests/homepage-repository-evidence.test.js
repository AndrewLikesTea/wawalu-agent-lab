import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initDecisionLog, renderRepositoryEvidence, STORAGE_KEY } from "../src/app.js";
import { REPOSITORY_DECISIONS, SEED_DECISIONS, pullRequestUrl } from "../src/seed-records.js";
import { loadPage, textOf, tabSequence } from "./support/browser.js";

const home = new URL(`../${process.env.SHIPLOG_E2E_BUILD_ROOT || "src"}/index.html`, import.meta.url);

test("homepage renders canonical repository evidence near the opening proposition", async (t) => {
  const page = await loadPage(home, { storage: { [STORAGE_KEY]: JSON.stringify([
    { ...REPOSITORY_DECISIONS[0], id: "imitation", title: "Customer success invented locally" },
  ]) } });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  const block = page.document.getElementById("repository-evidence");
  assert.equal(textOf(block.querySelector("h3")), "Repository-backed product evidence");
  assert.equal(block.getAttribute("aria-labelledby"), block.querySelector("h3").id);
  assert.match(textOf(block), /neither an invented example nor a customer result/);
  assert.doesNotMatch(textOf(block), /Customer success invented locally|saved|adoption|performance improvement/i);
  const links = block.querySelectorAll("a");
  // Pinned to the rule the renderer states — the newest repository decision —
  // and not to "any of the three". Accepting any member let the one record a
  // buyer reads first change silently with the seed order or the default sort,
  // which is exactly the question a sceptical reader would ask of this block.
  const [newest] = [...REPOSITORY_DECISIONS].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  assert.equal(textOf(links[0]), `${newest.title} — public pull request #${newest.repository.pullRequest}`);
  assert.equal(links[0].getAttribute("href"), pullRequestUrl(newest.repository.pullRequest));
  assert.equal(textOf(links[1]), "Browse all repository-backed Shiplog decisions");
  assert.equal(links[1].getAttribute("href"), "/?source=repository#record-history");
  for (const link of links) assert.ok(tabSequence(page.document).includes(link));
  const html = await readFile(home, "utf8");
  assert.ok(html.indexOf('id="repository-evidence"') > html.indexOf('id="shiplog-entry-title"'));
  assert.ok(html.indexOf('id="repository-evidence"') < html.indexOf('id="featured-decision"'));
});

test("collection route opens the complete repository-only history", async (t) => {
  const page = await loadPage(home, { location: { search: "?source=repository", hash: "#record-history" } });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  const list = page.document.getElementById("decision-list");
  assert.equal(list.querySelectorAll(".history-card").length, REPOSITORY_DECISIONS.length);
  for (const record of REPOSITORY_DECISIONS) assert.ok(textOf(list).includes(record.title));
  assert.equal(list.querySelectorAll(".badge-example").length, 0);
});

test("evidence excludes unmarked examples and missing or malformed PR citations", async (t) => {
  const page = await loadPage(home);
  t.after(() => page.restore());
  const target = page.document.getElementById("repository-evidence-records");
  for (const records of [[], SEED_DECISIONS.filter((record) => !record.repository),
    [ { ...REPOSITORY_DECISIONS[0], repository: {} } ],
    [ { ...REPOSITORY_DECISIONS[0], repository: { pullRequest: "javascript:alert(1)" } } ],
    // Without a date there is no "newest", so the block has no rule left to
    // explain its pick and shows nothing rather than an arbitrary one.
    [ { ...REPOSITORY_DECISIONS[0], createdAt: "whenever" } ]]) {
    renderRepositoryEvidence(page.document, records);
    assert.equal(textOf(target), "No repository-backed decisions are available in this log.");
    assert.equal(target.querySelectorAll("a").length, 0);
  }
  renderRepositoryEvidence(page.document);
  assert.equal(target.querySelectorAll("a").length, 1);
  renderRepositoryEvidence(page.document, []);
  assert.equal(target.querySelectorAll("a").length, 0, "stale evidence is removed");
});

// Wrapping, width and the focus ring come from `.release-followup-lead` and the
// global `a:focus-visible`, both already carried by the deployment-check block
// beside this one. There is no per-id CSS here to assert, and asserting that
// styles.css still contains rules this change never touched would be a test
// that cannot fail from this feature. What this change can break is the hand-off
// to that class, so that is what is pinned here instead of a CSS string.
test("every paragraph in the block carries the shared proof-copy class", async (t) => {
  const page = await loadPage(home);
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  const block = page.document.getElementById("repository-evidence");
  const paragraphs = block.querySelectorAll("p");
  assert.ok(paragraphs.length >= 3, `expected the copy, the record and the route, got ${paragraphs.length}`);
  for (const paragraph of paragraphs) {
    assert.equal(paragraph.getAttribute("class"), "release-followup-lead");
  }
});
