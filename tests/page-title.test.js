// The tab is a piece of copy like any other. These tests pin the two things a
// reader notices about it: it names the page they are actually on, and it is
// short enough that the naming survives the tab strip.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pageTitle, recordTitle, truncate, TITLE_LIMIT } from "../src/page-title.js";

const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("a page title reads specific-to-general and always ends in the product", () => {
  assert.equal(pageTitle("Decisions"), "Decisions · Shiplog");
  assert.equal(pageTitle("Post by Mina", "Social"), "Post by Mina · Social · Shiplog");
  assert.equal(pageTitle(), "Shiplog");
  // A missing segment closes up instead of leaving " ·  · " in the tab.
  assert.equal(pageTitle("", "Releases"), "Releases · Shiplog");
  assert.equal(pageTitle("  v2.4.0  ", "Releases"), "v2.4.0 · Releases · Shiplog");
});

test("a long name is cut at a word boundary, not mid-word", () => {
  assert.equal(truncate("Adopt a durable job queue", 40), "Adopt a durable job queue");
  assert.equal(truncate("Down-route routine formatting and release-note transforms", 30), "Down-route routine formatting…");
  // Trailing punctuation goes with the cut word: "routine,…" reads as a typo.
  assert.equal(truncate("Cache the read path, then measure it", 22), "Cache the read path…");
  // No word boundary to cut on at all — better a hard cut than an empty tab.
  assert.equal(truncate("Supercalifragilisticexpialidocious", 10), "Supercali…");
  assert.equal(truncate("anything", 0), "");
});

test("a record page is titled by its record, truncated to fit beside the surface name", () => {
  assert.equal(
    recordTitle("Adopt a durable job queue", { surface: "Decisions" }),
    "Adopt a durable job queue · Decisions · Shiplog",
  );
  const long = recordTitle("Down-route routine formatting and release-note transforms", { surface: "Decisions" });
  assert.ok(long.startsWith("Down-route routine"), long);
  assert.ok(long.endsWith(" · Decisions · Shiplog"), long);
  assert.ok(long.length < TITLE_LIMIT, `"${long}" is ${long.length} characters`);
});

test("a record with no name leaves the page named, never wearing its list's title", () => {
  // The failure this guards: a decision that resolves without a title used to
  // be able to leave the tab reading "Decisions · Shiplog" — the log, not the
  // one record the reader opened.
  assert.equal(recordTitle("", { surface: "Decisions", fallback: "Decision" }), "Decision · Shiplog");
  assert.equal(recordTitle(null, { surface: "Decisions", fallback: "Decision" }), "Decision · Shiplog");
  assert.equal(recordTitle(undefined, { surface: "Profile" }), "Profile · Shiplog");
  assert.notEqual(recordTitle("", { surface: "Decisions", fallback: "Decision" }), "");
});

test("the home page and the single-decision page are not titled the same thing", async () => {
  const home = (await read("index.html")).match(/<title>([^<]*)<\/title>/)[1];
  const detail = (await read("decision.html")).match(/<title>([^<]*)<\/title>/)[1];

  assert.notEqual(home, detail);
  assert.equal(home, "Shiplog · one site for AI spend, decisions, and releases");
  // The detail page ships with a title before its record arrives. It has to be
  // stable, non-empty, and not the log's own name — the reader is on one
  // decision, and the tab should say so from the first paint.
  assert.equal(detail, "Decision · Shiplog");
});

test("the single-decision page titles itself with the decision it loaded", async () => {
  const page = await read("decision-page.js");
  assert.match(page, /recordTitle\(result\.decision\.title, \{ surface: "Decisions", fallback: "Decision" \}\)/);
  assert.doesNotMatch(page, /`\$\{result\.decision\.title\} · Decisions · Shiplog`/);
  // What that call produces for the bundled sample decision.
  assert.equal(
    recordTitle("Adopt a durable job queue", { surface: "Decisions", fallback: "Decision" }),
    "Adopt a durable job queue · Decisions · Shiplog",
  );
});

test("no page assembles a title by hand any more", async () => {
  for (const file of ["decision-page.js", "release-page.js", "profile-page.js", "post-detail.js"]) {
    const source = await read(file);
    assert.match(source, /from "[./]*\/?page-title\.js"/, `${file} must build its title through the shared helper`);
    assert.doesNotMatch(source, /`[^`]*· Shiplog`/, `${file} still interpolates a title by hand`);
  }
});
