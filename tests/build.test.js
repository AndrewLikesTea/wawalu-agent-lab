import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createManifest, verifyArtifact } from "../scripts/verify-build.mjs";
import {
  SAMPLE_DECISION_ID,
  SAMPLE_RELEASE_ID,
  SEED_DECISIONS,
  SEED_RELEASES,
} from "../src/seed-records.js";
import { SITE_NAV } from "../src/site-nav.js";
import { parseHtml, pressEnter, pressTab } from "./support/browser.js";

async function copyDeployableArtifact(directory) {
  await cp(new URL("../src", import.meta.url), directory, { recursive: true });
  await cp(
    new URL("../contracts/integrations/org-query-source/v1", import.meta.url),
    resolve(directory, "contracts/integrations/org-query-source/v1"),
    { recursive: true },
  );
  await cp(
    new URL("../contracts/integrations/shiplog-delivery-history/v1", import.meta.url),
    resolve(directory, "contracts/integrations/shiplog-delivery-history/v1"),
    { recursive: true },
  );
  await mkdir(resolve(directory, "docs"), { recursive: true });
  for (const page of ["org-query-source-contract.md", "org-query-aggregate.md",
    "shiplog-delivery-history-contract.md"]) {
    await cp(new URL(`../docs/${page}`, import.meta.url), resolve(directory, "docs", page));
  }
}

test("product has a health endpoint and accessible title", async () => {
  assert.equal((await readFile(new URL("../src/healthz", import.meta.url), "utf8")).trim(), "ok");
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Shiplog · AI FinOps, decisions, and releases<\/title>/);
  // The landmark the skip link targets — header and nav sit outside it.
  assert.match(html, /<main id="main-content" tabindex="-1">/);
  assert.match(html, /<label for="title">Title<\/label>/);
  assert.match(html, /<label for="context">Context<\/label>/);
  assert.match(html, /<label for="owner">Owner<\/label>/);
  assert.match(html, /<label for="status">Status<\/label>/);
  assert.match(html, /<label for="filter-status">Decision status:<\/label>/);
  // One decision-status vocabulary: the filter offers exactly these four words,
  // in lifecycle order, and the glossary below it defines every one of them
  // plus what "Current only" hides.
  assert.match(html, /<select id="filter-status" aria-describedby="filter-status-hint">\s*<option value="all">all<\/option>\s*<option value="proposed">Proposed<\/option>\s*<option value="pending">Pending<\/option>\s*<option value="accepted">Accepted<\/option>\s*<option value="superseded">Superseded<\/option>\s*<\/select>/);
  assert.doesNotMatch(html, /<option value="approved">/);
  for (const term of ["Proposed", "Pending", "Accepted", "Superseded", "Current only"]) {
    assert.match(html, new RegExp(`<dt>${term}</dt><dd>[^<]+</dd>`), `the status glossary does not define ${term}`);
  }
  assert.match(html, /<legend>Record type<\/legend>\s*<div class="filter-options">/);
  assert.match(html, /<label for="filter-owner">Filter by owner:<\/label>\s*<select id="filter-owner">\s*<option value="all">all<\/option>/);
});

test("homepage explains the decision-to-release value and links to live examples", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

  assert.match(html, /Know why it shipped\./);
  assert.match(html, /records decisions, tracks the releases they shape/);
  assert.match(html, /id="decision-to-release"/);
  assert.match(html, /Keep reasoning with the work/);
  assert.match(html, /data-proof-point="decision-to-release"/);
  assert.match(html, /data-conversion-slot="hero"/);
  assert.match(html, /href="\/decision\.html\?id=demo-queue"/);
  assert.match(html, /href="\/release\.html\?id=demo-r-1-3-0"/);
});

// The hero is everything before the decision summary the front door leads with.
const heroOf = (html) =>
  html.slice(html.indexOf('<section class="hero'), html.indexOf('<section class="landing-decision"'));

// The log's own entry: from its heading down to the destination list.
const logEntryOf = (html) =>
  html.slice(html.indexOf('<section class="shiplog-entry"'), html.indexOf('<section class="site-guide"'));

test("the hero leads with AI FinOps and keeps the log as a named, complete secondary path", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const hero = heroOf(html);

  // What AI FinOps answers, in the surface's own name — not a synonym — before
  // any other destination on this site is named.
  assert.match(hero, /AI FinOps · what your AI spend is buying/);
  assert.match(hero, /Your files do not leave this tab\./);
  assert.doesNotMatch(html, /cost analyzer|spend tool/i);
  assert.ok(
    html.indexOf("AI FinOps") < html.indexOf("Know why it shipped."),
    "the front door must lead with AI FinOps, not with the log",
  );

  // Exactly one primary button in the hero, and it opens the surface the hero
  // is about. The second way on is the summary below it, as a text link: two
  // primary buttons beside each other would make neither one primary.
  assert.equal((hero.match(/class="button-link"/g) ?? []).length, 1,
    "the hero must carry exactly one primary call to action");
  assert.match(hero, /<a class="button-link" href="\/evolution\.html">Analyze your own provider export in AI FinOps/);
  assert.match(hero, /<a class="text-link" href="#landing-decision">/);
  assert.equal((hero.match(/class="secondary-button"/g) ?? []).length, 0,
    "the hero must not carry a third call to action");

  // The log is not demoted out of the page, only out of the first screen: its
  // own labelled section, its own heading, and the same call to action landing
  // on the same populated record list.
  const entry = logEntryOf(html);
  assert.match(entry, /Also on this site · the decision and release log/);
  assert.match(entry, /records decisions, tracks the releases they shape/);
  assert.match(entry, /<a class="button-link" href="#record-history">Explore the decision and release log/);
  assert.match(html, /<section class="workspace" id="record-history"/);
  assert.ok(
    html.indexOf('<section class="landing-decision"') < html.indexOf('<section class="shiplog-entry"'),
    "the decision summary must read before the log's entry",
  );
});

test("the log entry's proof point ties a recorded decision to the release that shipped it", async () => {
  const [html, finops] = await Promise.all([
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
  ]);
  const hero = heroOf(html);
  const entry = logEntryOf(html);
  const proof = entry.slice(entry.indexOf('<div class="hero-proof">'), entry.indexOf('<div class="hero-actions">'));
  const proofDocument = parseHtml(proof);
  const facts = proofDocument.querySelector(".hero-proof-facts")
    .querySelectorAll("dd")
    .map(({ textContent }) => textContent);

  // Resolve by stable ids, never array position: fixture exports may be
  // reordered without changing which pair the homepage promises to show.
  const decision = SEED_DECISIONS.find(({ id }) => id === SAMPLE_DECISION_ID);
  const release = SEED_RELEASES.find(({ id }) => id === SAMPLE_RELEASE_ID);
  assert.ok(decision, "the homepage decision fixture must exist");
  assert.ok(release, "the homepage release fixture must exist");
  assert.ok(
    release.decisionIds.includes(decision.id),
    "the homepage release fixture must link to the homepage decision fixture",
  );

  // Pin every displayed value to that resolved pair. A renamed, partial, or
  // stale fixture now fails the build instead of leaving plausible old copy.
  assert.deepEqual(facts, [
    `${decision.title} · ${decision.status[0].toUpperCase()}${decision.status.slice(1)}`,
    `Release ${release.version} · ${release.status[0].toUpperCase()}${release.status.slice(1)}`,
    decision.owner,
  ]);
  assert.equal(release.owner, decision.owner,
    "the single displayed owner must apply to both proof records");

  // Said in the same words the record list uses, in the same block as the
  // records themselves.
  assert.match(proof, /Representative synthetic records/);
  assert.match(proof, /invented records demonstrate Shiplog/);
  assert.match(proof, /not customer or internal operational data/);

  // No money authored into the hero, still. Every figure on this page is
  // rebuilt by a contract into the summary below, under the qualifier that
  // contract carries; a dollar amount typed into the markup above it would be
  // a claim with no arithmetic and no caveat behind it.
  assert.doesNotMatch(hero, /\$\d/);
  assert.doesNotMatch(hero, /realized savings|saved \$|per month/i);
  for (const figure of ["$7,430", "$5,200 / month", "High · 760-query scored sample"]) {
    assert.ok(finops.includes(figure), `AI FinOps must still publish ${figure}`);
  }
});

test("the home page names every nav destination and says what each one does", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const document = parseHtml(html);
  const guide = document.querySelector(".site-guide");
  assert.ok(guide, "the home page must carry the destination list");

  // The list reads near the hero, not at the foot of the page.
  assert.ok(
    html.indexOf('class="site-guide"') < html.indexOf('class="product-story"'),
    "the destination list must sit above the decision-to-release story",
  );

  const entries = guide.querySelectorAll("li");
  assert.equal(entries.length, SITE_NAV.length);
  entries.forEach((entry, index) => {
    const { href, label } = SITE_NAV[index];
    const link = entry.querySelector("a");
    // One name per destination: the list calls it exactly what the nav calls it
    // and sends the reader to exactly where the nav does.
    assert.equal(link.textContent, label, `entry ${index + 1} must be named "${label}"`);
    assert.equal(link.getAttribute("href"), href, `"${label}" must link to ${href}`);

    const sentence = entry.textContent.slice(label.length).trim();
    assert.ok(sentence.length > 0, `"${label}" needs a sentence`);
    assert.ok(
      sentence.split(/\s+/).length <= 20,
      `"${label}" runs to ${sentence.split(/\s+/).length} words`,
    );
    assert.doesNotMatch(sentence, /powerful|seamless|unlock|leverage/i, `"${label}" uses filler`);
  });

  // The hero may not claim a count it does not then list.
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('class="site-guide"'));
  assert.doesNotMatch(hero, /Shiplog does (one|two|three|four|five|six|seven|\d+) things?/i);
});

test("no developer note leaks into the copy a visitor reads", async () => {
  // Every shipped page, not a hand-kept list: the note that leaked onto the
  // Agent observatory was written long after the two pages this guard first
  // covered, so a new page has to inherit the rule rather than opt into it.
  const entries = await readdir(new URL("../src/", import.meta.url), {
    withFileTypes: true,
    recursive: true,
  });
  const pages = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".html"));
  assert.ok(pages.length > 2, "the page sweep found no pages to check");

  for (const page of pages) {
    const path = resolve(page.parentPath, page.name);
    // Named by route-relative path so a failure on /paint/ is not read as one
    // on the home page.
    const file = relative(fileURLToPath(new URL("../src/", import.meta.url)), path);
    const html = await readFile(path, "utf8");

    // A raw tag inside a comment ends it early in the browser and paints the
    // rest of the note, plus its closing marker, as body text. Keep notes plain.
    for (const [comment] of html.matchAll(/<!--[\s\S]*?-->/g)) {
      const body = comment.slice(4, -3);
      assert.doesNotMatch(
        body,
        /<\/?[a-zA-Z]/,
        `${file} has tag markup inside a comment: ${comment.slice(0, 70)}…`,
      );
      // A double hyphen inside the body is the other way these notes have
      // leaked: it reads as the start of a closing marker. Use an em dash.
      assert.doesNotMatch(
        body,
        /--/,
        `${file} has a double hyphen inside a comment: ${comment.slice(0, 70)}…`,
      );
    }
    assert.equal(
      (html.match(/<!--/g) ?? []).length,
      (html.match(/-->/g) ?? []).length,
      `${file} has an unbalanced comment`,
    );
    const text = parseHtml(html).body.textContent;
    assert.doesNotMatch(text, /-->/, `${file} paints a comment marker`);
    // The notes themselves, by their own words: a visitor may never read an
    // instruction written for whoever edits a page, or a source path.
    assert.doesNotMatch(text, /src\/[a-z-]+\.html/, `${file} paints a source path`);
    assert.doesNotMatch(text, /They are literals on both pages/, `${file} paints an editing note`);
    assert.doesNotMatch(text, /was deliberately removed because/, `${file} paints an editing note`);
  }
});

test("the AI FinOps call to action is reachable by Tab alone and opens on Enter", async () => {
  const document = parseHtml(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const primary = document.querySelector('a[href="/evolution.html"].button-link');

  // From the top of the page, with nothing but Tab: the skip link, the brand,
  // the nav, and then the hero's own call to action. Leading a page with a
  // surface means reaching its control early in the natural order, not putting
  // it somewhere only a pointer finds.
  let reached = null;
  for (let press = 0; press < 20 && reached !== primary; press += 1) reached = pressTab(document);
  assert.equal(reached, primary, "the AI FinOps link must sit in the natural tab order");
  pressEnter(document);
  assert.deepEqual(document.navigations, ["/evolution.html"]);
});

test("security headers ship with the site", async () => {
  const headers = await readFile(new URL("../src/_headers", import.meta.url), "utf8");
  assert.match(headers, /Content-Security-Policy:.*script-src 'self'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /connect-src 'self' https:\/\/api\.github\.com/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
});

test("build manifest is reproducible and detects artifact mutation", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  const first = await createManifest(directory);
  const firstBytes = await readFile(resolve(directory, "build-manifest.json"), "utf8");
  const second = await createManifest(directory);
  assert.deepEqual(second, first);
  assert.equal(await readFile(resolve(directory, "build-manifest.json"), "utf8"), firstBytes);
  await verifyArtifact(directory);

  await writeFile(resolve(directory, "social.js"), "tampered\n");
  await assert.rejects(verifyArtifact(directory), /does not match build manifest/);
});

test("artifact verification rejects an executive page without its panel status module", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-executive-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  await (await import("node:fs/promises")).rm(resolve(directory, "panel-status-view.js"));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /missing required UI asset: panel-status-view\.js/,
  );
});

test("artifact verification rejects an imported briefing without its peer benchmark module", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-peer-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  await (await import("node:fs/promises")).rm(resolve(directory, "imported-peer-benchmark.js"));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /missing required UI asset: imported-peer-benchmark\.js/,
  );
});

test("artifact verification rejects AI FinOps without a department drill-down view", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-department-view-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  await (await import("node:fs/promises")).rm(resolve(directory, "department-fix-pack-view.js"));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /missing required UI asset: department-fix-pack-view\.js/,
  );
});

test("artifact verification rejects a partial organizational-artifact reader", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-org-query-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  await (await import("node:fs/promises")).rm(resolve(directory, "org-query-aggregate.js"));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /missing required UI asset: org-query-aggregate\.js/,
  );
});

test("artifact verification probes the executive FinOps contract and canonical fixture together", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-finops-briefing-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  const fixturePath = resolve(directory, "executive-finops-briefing-fixture.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  fixture.briefing.recoverable.valueMinor += 1;
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /executive FinOps fixture does not match its artifact contract/,
  );
});

test("artifact verification rejects a canonical FinOps decision that drifted from its derivation", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-finops-decision-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  // Move the published baseline by one dollar. The contract re-derives that
  // figure from the bundled dataset rather than reading it back, so the artifact
  // check is what stands between a hand-edited decision figure and production.
  const fixturePath = resolve(directory, "finops-decision-fixture.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  fixture.benchmark.baselineUsd += 1;
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /canonical FinOps decision fixture does not match its artifact contract/,
  );
});

test("artifact verification refuses to ship the FinOps front door without its decision", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-finops-decision-missing-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  await (await import("node:fs/promises")).rm(resolve(directory, "finops-decision-fixture.json"));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /missing required UI asset: finops-decision-fixture\.json/,
  );
});

test("artifact verification rejects AI FinOps first-paint and runtime copy drift", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-finops-copy-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  const pagePath = resolve(directory, "evolution.html");
  const page = await readFile(pagePath, "utf8");
  await writeFile(pagePath, page.replace(
    "Analyze your provider export",
    "Analyze provider exports",
  ));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /AI FinOps first-paint copy drifted from its runtime contract at #finops-first-run-import/,
  );
});
