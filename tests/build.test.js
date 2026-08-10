import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createManifest, headerRule, verifyArtifact, verifyEvolutionStructure,
} from "../scripts/verify-build.mjs";
import { seedFirstScreen } from "../scripts/seed-first-screen.mjs";
import {
  SAMPLE_DECISION_ID,
  SAMPLE_RELEASE_ID,
  SEED_DECISIONS,
  SEED_RELEASES,
} from "../src/seed-records.js";
import { SITE_NAV } from "../src/site-nav.js";
import { buildStandHeadline } from "../src/finops-stand.js";
import { parseHtml, pressEnter, pressTab, textOf } from "./support/browser.js";

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
  // The build seeds the AI FinOps first screen into its staging copy BEFORE it
  // verifies it (#944), and #1509 made `verifyArtifact` hold that screen against
  // the modules that render it. A stand-in artifact therefore has to be seeded
  // too: an unseeded copy is a document the build never promotes, so verifying
  // one would prove nothing about what Pages receives.
  await seedFirstScreen(directory);
}

test("product has a health endpoint and accessible title", async () => {
  assert.deepEqual(
    JSON.parse(await readFile(new URL("../src/healthz", import.meta.url), "utf8")),
    { status: "healthy", version: "unstamped" },
  );
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Shiplog · one site for AI spend, decisions, and releases<\/title>/);
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

test("evolution structural verification accepts valid parsed structure", () => {
  assert.doesNotThrow(() => verifyEvolutionStructure(
    '<main><h1>Answer</h1><section data-decision-summary-region="authored"><h2>Detail</h2></section></main>'));
});

test("evolution structural verification rejects duplicate summaries and h2 before h1", () => {
  assert.throws(() => verifyEvolutionStructure(
    '<main><h1>Answer</h1><section data-decision-summary-region="authored"></section>'
      + '<aside data-decision-summary-region="authored"></aside></main>'), /2 decision-summary/);
  assert.throws(() => verifyEvolutionStructure("<main><h2>Detail</h2><h1>Answer</h1></main>"),
    /h1 must precede/);
});

test("evolution structural verification ignores tag-like comments and script text", () => {
  assert.doesNotThrow(() => verifyEvolutionStructure(
    '<main><h1>Answer</h1><!-- <h2 data-decision-summary-region="authored">fake</h2> -->'
      + '<script>const fake = `<h2 data-decision-summary-region="authored">fake</h2>`;</script>'
      + '<section data-decision-summary-region="authored"><h2>Detail</h2></section></main>'));
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

test("the hero names the product before any surface, and keeps the log as a named, complete secondary path", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const hero = heroOf(html);

  // The promise first: what Shiplog is and who it is for, before any one
  // surface is named as a place to go. A visitor who has never heard of this
  // site meets the product, not its best section.
  const promise = hero.indexOf("Shiplog is for engineering teams");
  assert.ok(promise > 0, "the hero must open by saying what Shiplog is and who it is for");
  assert.ok(promise < hero.indexOf("AI FinOps"),
    "the product promise must land before the first surface is named");
  assert.match(hero, /<p class="eyebrow">Shiplog<\/p>/,
    "the hero's eyebrow must name the product, not one of its surfaces");

  // The checkable fact, stated as a fact rather than as a benefit: what the
  // worked decision contains, and what it costs to read.
  assert.match(hero, /A worked decision is already computed on the AI FinOps page/);
  assert.match(hero, /no export of yours, no sign-in, and no account/);
  // One name per concept: the marker AI FinOps publishes the example under.
  assert.match(hero, /bundled synthetic example/);
  assert.match(hero, /invented data for an invented company/);
  assert.match(hero, /Your files do not leave this tab\./);
  assert.doesNotMatch(html, /cost analyzer|spend tool/i);
  assert.ok(
    html.indexOf("AI FinOps") < html.indexOf("Know why it shipped."),
    "the front door must lead with AI FinOps, not with the log",
  );

  // Exactly one primary button in the hero, and it opens the worked decision:
  // the strongest single destination on this site, and the only one that needs
  // nothing of the visitor's. The summary below stays a text link — two primary
  // buttons beside each other would make neither one primary.
  assert.equal((hero.match(/class="button-link"/g) ?? []).length, 1,
    "the hero must carry exactly one primary call to action");
  assert.match(hero, /<a class="button-link" href="\/evolution\.html">Read the worked decision in AI FinOps/);
  assert.match(hero, /<a class="text-link" href="#landing-decision">/);
  assert.equal((hero.match(/class="secondary-button"/g) ?? []).length, 0,
    "the hero must not carry a third call to action");

  // The path the hero used to lead with is not gone, only moved: analyzing your
  // own export is offered under the summary, below the one call to action.
  assert.match(html, /Your own numbers: <a href="\/evolution\.html">analyze a provider export in AI FinOps<\/a>/);
  assert.ok(
    html.indexOf("Your own numbers:") > html.indexOf('<section class="landing-decision"'),
    "the analyze-your-own-export path must read below the hero's call to action",
  );

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

  // Money is authored into the hero now, and only on these terms. The hero may
  // state the bundled example's headline result so a first-screen visitor
  // leaves with a number they can repeat — but a dollar amount typed into this
  // markup is still a claim, so the guard moved rather than lifted. Every
  // figure the hero states must be one AI FinOps publishes, the synthetic
  // disclosure must read in the same paragraph as the figure, and the words
  // this site never uses about a modelled ceiling stay barred.
  const proofPoint = hero.slice(
    hero.indexOf('<p class="hero-proof-point">'),
    hero.indexOf("</p>", hero.indexOf('<p class="hero-proof-point">')),
  );
  for (const figure of hero.match(/\$[\d,]+|\d+% of analyzed AI spend/g) ?? []) {
    assert.ok(proofPoint.includes(figure),
      `the hero states ${figure} outside the paragraph that discloses the example`);
    assert.ok(finops.includes(figure), `the hero states ${figure}, which AI FinOps does not publish`);
  }
  assert.match(proofPoint, /33% of analyzed AI spend is recoverable/,
    "the first screen must state the result, not the categories of an answer");
  assert.match(proofPoint, /bundled synthetic example/,
    "a money figure in the hero must carry its disclosure in the same paragraph");
  assert.doesNotMatch(hero, /realized savings|saved \$|per month/i);

  // The department is composed rather than authored on AI FinOps, so it is
  // pinned against the composer that paints it there instead of against that
  // page's markup. A rename in the example data fails the build here.
  const headline = buildStandHeadline();
  assert.ok(hero.includes(`${headline.team.name} is driving the increase`),
    "the hero must name the department AI FinOps names as driving the increase");
  for (const figure of ["$51,254", "$154,500"]) {
    assert.ok(headline.recoverable.basis.includes(figure),
      `the hero repeats ${figure}, which the composed headline no longer states`);
  }
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

  // Every destination is still here, named and linked exactly as the nav names
  // and links it. The list is grouped now rather than flat, so a destination is
  // found by its href instead of by its position — but the count still has to
  // match, so a regrouping cannot quietly drop one.
  const entries = [...guide.querySelectorAll("li")];
  assert.equal(entries.length, SITE_NAV.length);
  for (const { href, label } of SITE_NAV) {
    const matches = entries.filter((entry) => entry.querySelector("a").getAttribute("href") === href);
    assert.equal(matches.length, 1, `"${label}" must appear exactly once, linking to ${href}`);
    const link = matches[0].querySelector("a");
    // One name per destination: the list calls it exactly what the nav calls it.
    assert.equal(link.textContent, label, `the ${href} entry must be named "${label}"`);

    const sentence = matches[0].textContent.slice(label.length).trim();
    assert.ok(sentence.length > 0, `"${label}" needs a sentence`);
    assert.ok(
      sentence.split(/\s+/).length <= 20,
      `"${label}" runs to ${sentence.split(/\s+/).length} words`,
    );
    assert.doesNotMatch(sentence, /powerful|seamless|unlock|leverage/i, `"${label}" uses filler`);
  }

  // The section says what Shiplog is before it says where anything is, in one
  // sentence that names the product rather than reciting the list below it.
  const opener = textOf(guide.querySelector(".site-guide-intro"));
  assert.ok(opener, "the section must open by saying what Shiplog does");
  assert.ok(opener.split(/\s+/).length <= 25, `the opening sentence runs to ${opener.split(/\s+/).length} words`);
  assert.match(opener, /^Shiplog /, "the opening sentence must name the product first");
  for (const { label } of SITE_NAV) {
    assert.ok(!opener.includes(label), `the opening sentence enumerates ${label} instead of saying what Shiplog does`);
  }

  // Two groups, each under a real heading one level below the section's own:
  // the surfaces that read a visitor's own material, then the ones furnished
  // with invented data. The second heading has to say demonstration in a word a
  // buyer cannot read as a promise about their data.
  const headings = [...guide.querySelectorAll("h3")];
  assert.equal(headings.length, 2, "the destinations must be split into exactly two groups");
  assert.match(textOf(headings[0]), /your own work/i, "the first group must say these run on the reader's own material");
  assert.match(textOf(headings[1]), /demonstrations?/i, "the second group must say plainly that these are demonstrations");

  const lists = [...guide.querySelectorAll("ul")].map((list) =>
    [...list.querySelectorAll("li")].map((entry) => entry.querySelector("a").getAttribute("href")));
  assert.equal(lists.length, 2, "each group needs its own list");
  assert.deepEqual([...lists[0]].sort(), ["/", "/coach.html", "/evolution.html", "/releases.html"]);
  assert.deepEqual([...lists[1]].sort(), ["/agents.html", "/paint/", "/profile.html", "/social.html"]);

  // Reading order, in the source and on the screen: the tools group is first in
  // the markup, and nothing in the stylesheet may move it after the demos.
  const section = html.slice(html.indexOf('<section class="site-guide"'), html.indexOf('<section class="coach-entry"'));
  for (const demo of ["/social.html", "/profile.html", "/paint/"]) {
    assert.ok(
      section.indexOf('"/evolution.html"') < section.indexOf(`"${demo}"`),
      `AI FinOps must be listed before ${demo}`,
    );
  }
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const rule of css.split("\n").filter((line) => line.startsWith(".") && line.includes(".site-guide"))) {
    assert.doesNotMatch(rule, /[;{\s]order:|float:|position:\s*absolute/, `a .site-guide rule can reorder the groups: ${rule}`);
  }

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

test("the built artifact carries the AI FinOps connection policy", async (t) => {
  // Asserted on the artifact a host would serve, not on src/: a policy that
  // exists in the repository and not in dist/ protects nobody. The build copies
  // src/ into the artifact, so this is the same file that reaches the edge —
  // and `npm run verify:build` makes the same assertion against the real dist/.
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-policy-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);
  await createManifest(directory);
  await verifyArtifact(directory);

  const rule = headerRule(await readFile(resolve(directory, "_headers"), "utf8"), "/evolution.html");
  assert.ok(rule, "the artifact declares no header rule for the AI FinOps page");
  const policy = rule["Content-Security-Policy"];
  assert.match(policy, /(^|; )default-src 'self'(;|$)/);
  // The outbound boundary. 'self' rather than 'none' because the page boots by
  // fetching its own bundled fixtures; every cross-origin destination is still
  // refused, and tests/finops-import-egress.test.js is what proves the import
  // path opens no connection at all.
  assert.match(policy, /(^|; )connect-src 'self'(;|$)/,
    "the page must not be allowed to reach any origin but its own");
  assert.match(policy, /(^|; )form-action 'none'(;|$)/);
  assert.match(policy, /(^|; )frame-ancestors 'none'(;|$)/);
  assert.ok(!/connect-src[^;]*(https?:|\*)/.test(policy),
    `a remote destination was added to connect-src: ${policy}`);
});

test("artifact verification rejects a build whose FinOps connection policy went missing", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-policy-removal-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  const headers = await readFile(resolve(directory, "_headers"), "utf8");
  await writeFile(resolve(directory, "_headers"),
    headers.replace("connect-src 'self';", "connect-src https://telemetry.example;"));
  await createManifest(directory);
  await assert.rejects(verifyArtifact(directory), /connect-src 'self'/);
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

test("artifact verification rejects AI FinOps without its workspace navigation", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-finops-nav-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  await (await import("node:fs/promises")).rm(resolve(directory, "finops-workspace-nav.js"));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /missing required UI asset: finops-workspace-nav\.js/,
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

test("artifact verification rejects a rail door whose destination the artifact lost", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-dead-door-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  // The failure this deletes: a door that survives an edit its destination did
  // not. Nothing in the markup, the manifest, or the import graph notices — the
  // anchor parses, styles, and takes focus — so the first report is a reader
  // pressing "Monthly review" on the deployed page and going nowhere.
  const page = resolve(directory, "evolution.html");
  const html = await readFile(page, "utf8");
  await writeFile(page, html.replace(
    /<section class="monthly-review-projection" id="monthly-review-projection"/,
    '<section class="monthly-review-projection" id="monthly-review-projection-renamed"',
  ));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /the "monthly-review" door points at #monthly-review-projection/,
  );
});

test("artifact verification rejects a monthly review that can never reach a decision", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-inert-review-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  // A destination that only ever refuses passes the empty-state probe and every
  // other assertion on this artifact while being permanently inert. Stub the
  // projector into always returning null — the shape a narrowing change to the
  // retained-period contract would produce — and the build has to fail.
  const workspace = resolve(directory, "finops-workspace.js");
  const source = await readFile(workspace, "utf8");
  await writeFile(workspace, `${source.replace(
    "export function projectRetainedPeriod(", "function shadowedProjectRetainedPeriod(",
  )}\nexport function projectRetainedPeriod() { return null; }\n`);
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /retained months cannot reach a monthly decision/,
  );
});

test("artifact verification rejects an AI FinOps entry that stops joining its monthly review", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-review-wiring-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  const entry = resolve(directory, "evolution-page.js");
  await writeFile(entry, (await readFile(entry, "utf8"))
    .replaceAll("readRetainedPeriodInputs", "readNothingAtAll"));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /no longer joins readRetainedPeriodInputs into its monthly review/,
  );
});

test("artifact verification rejects a module the artifact imports but does not carry", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-import-closure-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  // Deliberately a module the hand-maintained required list never named. The
  // executive briefing entry imports it, so dropping it is a rejected entry
  // module: the page keeps its static "Reading…" panel and aria-busy="true" for
  // good, with the manifest and every required-asset assertion still green.
  // Closing the import graph is what turns that into a failed build.
  await (await import("node:fs/promises")).rm(resolve(directory, "finops-contact.js"));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /artifact references files it does not carry:.*finops-contact\.js/s,
  );
});

test("artifact verification rejects a stylesheet a shipped page links but the artifact omits", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-linked-asset-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  await (await import("node:fs/promises")).rm(resolve(directory, "styles.css"));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /artifact references files it does not carry:.*styles\.css/s,
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

// The two ways a provider sample can stop being real (#1067). Neither can happen
// by editing the contract's DATA — the sample and the column list are derived from
// one detection entry — so both are broken here the only way they could break in
// life: by editing the serializer that turns that entry into a file. The patched
// module is a staged copy in a temp directory; src/ is never touched.
async function patchReadinessSerializer(directory, from, to) {
  const path = resolve(directory, "provider-readiness-contract.js");
  const source = await readFile(path, "utf8");
  assert.ok(source.includes(from), `the readiness serializer no longer contains: ${from}`);
  await writeFile(path, source.replace(from, to));
  await createManifest(directory);
}

test("artifact verification rejects a provider advertised with no downloadable sample", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-provider-sample-missing-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  // One provider's download becomes an empty file. The card still names it, still
  // lists its columns, and still offers the button — which is the whole point:
  // only the artifact check can tell that the button now hands over nothing.
  await patchReadinessSerializer(directory,
    'if (!entry) return "";',
    'if (!entry || entry.id === "openai") return "";');

  await assert.rejects(
    verifyArtifact(directory),
    /provider sample: openai is advertised in the readiness contract but produces no downloadable sample artifact \(wawalu-sample-openai\.csv\)/,
  );
});

test("artifact verification rejects a sample whose columns drifted from the contract", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-provider-sample-columns-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  // Rename the last column of every CSV header, and nothing else: same column
  // count, same row, a file that still parses. A string compare against a
  // remembered header would catch this too — and would also fire on a reordering
  // that changes nothing. This fires because the PARSED set disagrees.
  await patchReadinessSerializer(directory,
    "const header = entry.requiredColumns.map(csvField).join(\",\");",
    "const header = entry.requiredColumns.map((column, index) => csvField("
      + "index === entry.requiredColumns.length - 1 ? `${column}-renamed` : column)).join(\",\");");

  // Bedrock is the first CSV provider in contract order, so it is the one the
  // build names — with both halves of the disagreement in the message.
  await assert.rejects(
    verifyArtifact(directory),
    /provider sample: the bedrock sample \(wawalu-sample-bedrock\.csv\) disagrees with its columns in the readiness contract\. Required and missing: lineItem\/UsageAccountId\. Present and undeclared: lineItem\/UsageAccountId-renamed\./,
  );
});

test("artifact verification rejects AI FinOps first-paint and runtime copy drift", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "shiplog-finops-copy-artifact-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await copyDeployableArtifact(directory);

  const pagePath = resolve(directory, "evolution.html");
  const page = await readFile(pagePath, "utf8");
  await writeFile(pagePath, page.replace(
    "Analyze your own export",
    "Analyze provider exports",
  ));
  await createManifest(directory);

  await assert.rejects(
    verifyArtifact(directory),
    /AI FinOps first-paint copy drifted from its runtime contract at #finops-first-run-import/,
  );
});
