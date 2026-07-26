// The handoff that lets a visitor leave the profile for Paint and come back to
// the profile they left. Both ends of it are pure, so both ends are covered
// here without a browser.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MAX_AUTHOR_LENGTH } from "../src/social-identity.js";
import { FEED_PATH, JOURNEY_ORIGINS, PAINT_PATH, PROFILE_PATH, paintEntryHref, resolveJourneyLinks } from "../src/paint-journey.js";

test("the entry link carries the origin, and only an origin Paint understands", () => {
  assert.equal(paintEntryHref({ from: "profile", author: "Mina" }), "/paint/?from=profile&author=Mina");
  assert.equal(paintEntryHref({ from: "profile" }), "/paint/?from=profile");
  assert.equal(paintEntryHref({ from: "feed" }), "/paint/?from=feed");
  // A name is only meaningful for a profile; the feed has no single subject.
  assert.equal(paintEntryHref({ from: "feed", author: "Mina" }), "/paint/?from=feed");
  // Unknown origins are dropped rather than passed through, so a stale link
  // from an older page still opens a working editor.
  assert.equal(paintEntryHref({ from: "inbox", author: "Mina" }), PAINT_PATH);
  assert.equal(paintEntryHref(), PAINT_PATH);
});

test("a name that would change the link's meaning is encoded or dropped", () => {
  // The author is the only free text in the URL. Percent-encoding keeps a name
  // containing separators inside its own query value.
  assert.equal(
    paintEntryHref({ from: "profile", author: "A&from=feed#x" }),
    "/paint/?from=profile&author=A%26from%3Dfeed%23x",
  );
  assert.equal(resolveJourneyLinks("?from=profile&author=A%26b")[0].href, "/profile.html?author=A%26b");
  // Over-long and blank names fall back to the unscoped profile rather than
  // producing a link to a profile that cannot exist.
  assert.equal(paintEntryHref({ from: "profile", author: "x".repeat(MAX_AUTHOR_LENGTH + 1) }), "/paint/?from=profile");
  assert.equal(paintEntryHref({ from: "profile", author: "   " }), "/paint/?from=profile");
});

test("Paint's escape links name where the visitor came from", () => {
  const fromProfile = resolveJourneyLinks("?from=profile&author=Mina");
  assert.deepEqual(fromProfile, [
    { href: "/profile.html?author=Mina", label: "Back to Mina’s profile" },
    { href: FEED_PATH, label: "Go to team feed" },
  ]);

  const fromFeed = resolveJourneyLinks("?from=feed");
  assert.deepEqual(fromFeed, [
    { href: FEED_PATH, label: "Back to team feed" },
    { href: PROFILE_PATH, label: "Go to your profile" },
  ]);

  // A profile origin with no name still says "back" — the visitor did come
  // from a profile, we just do not know whose.
  assert.equal(resolveJourneyLinks("?from=profile")[0].label, "Back to your profile");
});

test("a missing, unknown, or hostile origin degrades to the shell's static links", () => {
  const generic = [
    { href: PROFILE_PATH, label: "Go to your profile" },
    { href: FEED_PATH, label: "Go to team feed" },
  ];
  assert.deepEqual(resolveJourneyLinks(""), generic);
  assert.deepEqual(resolveJourneyLinks(), generic);
  assert.deepEqual(resolveJourneyLinks("?from=inbox"), generic);
  // `from` is a key into a table of literal paths, never a path itself, so a
  // redirect or a script URL cannot be smuggled through it.
  for (const hostile of ["https://example.com", "javascript:alert(1)", "//example.com", "../../etc"]) {
    for (const link of resolveJourneyLinks(`?from=${encodeURIComponent(hostile)}&author=${encodeURIComponent(hostile)}`)) {
      assert.ok(link.href === FEED_PATH || link.href === PROFILE_PATH, `unexpected href ${link.href}`);
    }
  }
});

// Every hand-written link into Paint is a chance to invent a `from` value the
// editor silently ignores, which is how the origin becomes decorative.
test("the feed's static link into Paint names an origin Paint understands", async () => {
  const html = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  // The composer's link, not the site nav: nav is a jump between sections and
  // has no journey to preserve.
  const links = [...html.matchAll(/class="[^"]*\bpaint-link\b[^"]*" href="\/paint\/(\?[^"]*)?"/g)];
  assert.equal(links.length, 1, "the feed must offer exactly one way into Paint from the composer");
  const from = new URLSearchParams((links[0][1] ?? "").replace(/^\?/, "")).get("from");
  assert.ok(JOURNEY_ORIGINS.has(from), `"${from}" is not a journey origin`);
});

test("the query string is accepted with or without its leading question mark", () => {
  assert.deepEqual(resolveJourneyLinks("from=profile&author=Mina"), resolveJourneyLinks("?from=profile&author=Mina"));
});
