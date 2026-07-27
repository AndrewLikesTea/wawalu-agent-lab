import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createManifest, verifyArtifact } from "../scripts/verify-build.mjs";
import { SITE_NAV } from "../src/site-nav.js";
import { parseHtml, pressEnter, pressTab } from "./support/browser.js";

test("product has a health endpoint and accessible title", async () => {
  assert.equal((await readFile(new URL("../src/healthz", import.meta.url), "utf8")).trim(), "ok");
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Shiplog · Decision and release log<\/title>/);
  assert.match(html, /<main>/);
  assert.match(html, /<label for="title">Title<\/label>/);
  assert.match(html, /<label for="context">Context<\/label>/);
  assert.match(html, /<label for="owner">Owner<\/label>/);
  assert.match(html, /<label for="status">Status<\/label>/);
  assert.match(html, /<label for="filter-status">Decision status:<\/label>\s*<select id="filter-status" aria-describedby="filter-status-hint">\s*<option value="all">all<\/option>/);
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

test("the hero names both capabilities and quotes AI FinOps without contradicting it", async () => {
  const [html, finops] = await Promise.all([
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
  ]);
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('<section class="product-story"'));

  // Both capabilities, in the hero, in the surface's own name — not a synonym.
  assert.match(hero, /score your own provider export in AI FinOps/);
  assert.match(hero, /Your files do not leave this tab\./);
  assert.doesNotMatch(html, /cost analyzer|spend tool/i);

  // The demo stays the primary call to action; AI FinOps is the secondary one,
  // a real focusable anchor whose name names its destination. The demo link
  // lands on the populated record list, not on the one sample decision the
  // story card already links — the log is what "the live demo" means.
  assert.match(hero, /<a class="button-link" href="#record-history">Explore the live demo/);
  assert.match(html, /<section class="workspace" id="record-history"/);
  assert.match(hero, /<a class="secondary-button" href="\/evolution\.html">Score your provider export in AI FinOps<\/a>/);
  assert.ok(hero.indexOf('class="button-link"') < hero.indexOf('class="secondary-button"'));

  // Every quoted figure is the AI FinOps page's own, and the qualifier that
  // governs them shares their block.
  const proof = hero.slice(hero.indexOf('<div class="hero-proof">'));
  for (const figure of ["$7,430", "$5,200 / month", "High · 760-query scored sample"]) {
    assert.ok(proof.includes(figure), `hero must quote ${figure}`);
    assert.ok(finops.includes(figure), `AI FinOps must still publish ${figure}`);
  }
  assert.match(proof, /Bundled synthetic sample data/);
  assert.match(proof, /not live analysis, customer data, or realized savings/);
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
  for (const file of ["index.html", "evolution.html"]) {
    const html = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

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
    // instruction written for whoever edits these two pages, or a source path.
    assert.doesNotMatch(text, /src\/[a-z-]+\.html/, `${file} paints a source path`);
    assert.doesNotMatch(text, /They are literals on both pages/, `${file} paints an editing note`);
    assert.doesNotMatch(text, /was deliberately removed because/, `${file} paints an editing note`);
  }
});

test("the AI FinOps call to action is reachable by Tab alone and opens on Enter", async () => {
  const document = parseHtml(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
  const secondary = document.querySelector('a[href="/evolution.html"].secondary-button');

  // From the top of the page, with nothing but Tab: the demo comes first, the
  // AI FinOps link is the very next stop, and Enter navigates there.
  let reached = null;
  for (let press = 0; press < 20 && reached !== secondary; press += 1) reached = pressTab(document);
  assert.equal(reached, secondary, "the AI FinOps link must sit in the natural tab order");
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
  await cp(new URL("../src", import.meta.url), directory, { recursive: true });

  const first = await createManifest(directory);
  const firstBytes = await readFile(resolve(directory, "build-manifest.json"), "utf8");
  const second = await createManifest(directory);
  assert.deepEqual(second, first);
  assert.equal(await readFile(resolve(directory, "build-manifest.json"), "utf8"), firstBytes);
  await verifyArtifact(directory);

  await writeFile(resolve(directory, "social.js"), "tampered\n");
  await assert.rejects(verifyArtifact(directory), /does not match build manifest/);
});
