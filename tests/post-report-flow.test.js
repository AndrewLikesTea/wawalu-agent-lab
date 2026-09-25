// Report post on Social and People, driven through the shipped pages (#2343):
// every loaded card offers it, the panel names the post and what a report does,
// focus goes in and comes back, a missing reason is refused in page code, and a
// failed send keeps every entry for a Retry that goes through.
//
// Harness: elements are never handed to assert (it inspects the whole parsed
// page and hangs); identities are compared as booleans, and cards are counted
// without their loading skeletons, which carry the same class.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, pressKey, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { bootSocial } from "./support/social-paint-arrival.js";
import { renderPosts } from "../src/social.js";
import { REPORT_POST_LABEL, REPORT_RECEIVED, REPORT_REVIEW_NOTE } from "../src/post-report.js";

const ARI_POST = "55555555-5555-4555-8555-555555555555";
const BEA_POST = "66666666-6666-4666-8666-666666666666";
const apiPost = (id, author, content, day) => ({ id, author, content, timestamp: `2026-09-0${day}T09:00:00.000Z`, source: "shiplog-web" });
const LIVE = { posts: [apiPost(ARI_POST, "Ari", "Shipped the focus rings.", 1), apiPost(BEA_POST, "Bea", "Posted the wrong screenshot, sorry.", 2)] };

const realCards = (document, card, skeleton) =>
  document.querySelectorAll(card).filter((node) => !node.classList.contains(skeleton));
const reportButtonFor = (document, postId) =>
  document.querySelectorAll(".post-report-button").find((button) => button.dataset.postId === postId);

test("Social: every loaded card has one Report post button, and a loading skeleton has none", async (t) => {
  const { document } = await bootSocial(t, { routes: { "/api/social-posts?limit=100": LIVE } });
  const cards = realCards(document, ".post-card", "post-card-skeleton");
  assert.equal(cards.length, 2, "the live posts did not render");
  for (const card of cards) {
    const buttons = card.querySelectorAll(".post-report-button");
    assert.equal(buttons.length, 1);
    assert.equal(textOf(buttons[0]), "Report post");
    assert.equal(buttons[0].getAttribute("type"), "button");
    const author = card.dataset.postId === ARI_POST ? "Ari" : "Bea";
    assert.match(buttons[0].getAttribute("aria-label"), new RegExp(`^Report post by ${author}, `));
  }

  const loading = document.createElement("div");
  renderPosts(loading, [], { state: "loading", onReport: () => {} });
  assert.ok(loading.querySelectorAll(".post-card-skeleton").length > 0, "no skeleton was drawn to check");
  assert.equal(loading.querySelectorAll(".post-report-button").length, 0);
});

test("Social: the panel names the post, takes focus, and gives it back on Escape and on Close", async (t) => {
  const { document, id } = await bootSocial(t, { routes: { "/api/social-posts?limit=100": LIVE } });
  const button = reportButtonFor(document, BEA_POST);
  assert.equal(id("post-report-panel").hidden, true);

  button.click();
  assert.equal(id("post-report-panel").hidden, false);
  assert.equal(textOf(id("post-report-post")), "You are reporting the post by Bea: “Posted the wrong screenshot, sorry.”");
  assert.equal(textOf(id("post-report-review")), REPORT_REVIEW_NOTE);
  assert.match(textOf(id("post-report-sent")), /this post, your reason, your note if you write one, and your email address\. Only the Wawalu team sees them; none of it is shown on Social or People\./);
  assert.equal(textOf(id("post-report-submit")), "Send report");
  assert.equal(document.activeElement?.id, "post-report-title");

  pressKey(document, "Escape");
  assert.equal(id("post-report-panel").hidden, true);
  assert.equal(document.activeElement === button, true, "Escape did not return focus to Report post");

  button.click();
  id("post-report-close").click();
  assert.equal(id("post-report-panel").hidden, true);
  assert.equal(document.activeElement === button, true, "Close did not return focus to Report post");
});

test("Social: no reason is refused in page code, and a failed send keeps every entry for a Retry that succeeds", async (t) => {
  const { document, id } = await bootSocial(t, { routes: { "/api/social-posts?limit=100": LIVE } });
  const sent = [];
  const served = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (url !== "/api/post-reports") return served(url, init);
    sent.push(JSON.parse(init.body));
    return sent.length === 1
      ? { ok: false, status: 503, json: async () => ({ error: { message: "Storage is down." } }) }
      : { ok: true, status: 201, json: async () => ({ id: "77777777-7777-4777-8777-777777777777", status: "received" }) };
  };

  reportButtonFor(document, BEA_POST).click();
  id("post-report-email").value = "me@example.org";
  id("post-report-submit").click();
  assert.equal(sent.length, 0, "a report with no reason was sent");
  assert.equal(id("post-report-reason-error").hidden, false);
  assert.equal(textOf(id("post-report-reason-error")), "Choose a reason for this report.");
  assert.equal(document.activeElement?.id, "post-report-reason-0");

  id("post-report-reason-1").click();
  id("post-report-context").value = "It shows a customer's name.";
  id("post-report-email").value = "not-an-email";
  id("post-report-submit").click();
  assert.equal(sent.length, 0, "a report with a bad email was sent");
  assert.equal(id("post-report-reason-error").hidden, true);
  assert.equal(id("post-report-email").getAttribute("aria-invalid"), "true");

  id("post-report-email").value = "me@example.org";
  id("post-report-submit").click();
  await waitFor(() => !id("post-report-retry").hidden, "the failed send offers Retry");
  const expected = { post_id: BEA_POST, reason: "personal_information", context: "It shows a customer's name.", email: "me@example.org" };
  assert.deepEqual(sent, [expected]);
  // The server's 503 wording is not the reader's; the entries are all still there.
  assert.equal(textOf(id("post-report-status")), "Your report was not sent. Your reason, note, and email address are still in the form.");
  assert.equal(id("post-report-form").hidden, false);
  assert.equal(id("post-report-reason-1").checked, true);
  assert.equal(id("post-report-context").value, "It shows a customer's name.");
  assert.equal(id("post-report-email").value, "me@example.org");
  assert.equal(id("post-report-submit").disabled, false);
  assert.equal(document.activeElement?.id, "post-report-retry");

  id("post-report-retry").click();
  await waitFor(() => id("post-report-form").hidden, "the retried report is confirmed");
  assert.deepEqual(sent, [expected, expected]);
  assert.equal(textOf(id("post-report-status")), REPORT_RECEIVED);
  assert.equal(id("post-report-status").getAttribute("role"), "status");
  assert.equal(id("post-report-retry").hidden, true);
  assert.equal(document.activeElement?.id, "post-report-status");
  // Reporting never touched the feed: both posts are still on it.
  assert.equal(realCards(document, ".post-card", "post-card-skeleton").length, 2);
});

test("Social: the reporting route sits outside the composer and points at the explanation", async (t) => {
  const { document, id } = await bootSocial(t);
  const route = id("post-report-route");
  const links = route.querySelectorAll("a");
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), "#post-report-about");
  let inComposer = false;
  for (let at = route; at; at = at.parentNode) if (at.id === "post-compose-panel") inComposer = true;
  assert.equal(inComposer, false, "the route is inside the composer, whose tab order is pinned");
  assert.match(textOf(id("post-report-about")), /reviews? each one\. A report does not remove or hide the post, and not every report leads to removal\. The team decides after review whether to remove it\.$/);

  // Explained once (#2471). The route's link text used to open the explanation
  // as a lead-in too, and the composer's terms restated the review in their own
  // words, so the painted page said how reporting works three times.
  // The report panel's own note is the form speaking once it is open, and stays
  // hidden until then, so it is not counted as a second explanation.
  const main = textOf(id("main-content")).split(textOf(id("post-report-panel"))).join(" ");
  assert.ok(main.split("How reporting works").length - 1 <= 1, "Social says \"How reporting works\" more than once");
  assert.equal(main.split("not every report leads to removal").length - 1, 1, "Social explains what a report leads to other than exactly once");
  const terms = textOf(id("post-consequence"));
  assert.doesNotMatch(terms, /after review|may remove|review/i, "the publishing terms restate the reporting explanation's review process");
});

test("People: every drawn tile has a Report post button that opens the same panel", async (t) => {
  const page = await loadPage(new URL("../src/profile.html", import.meta.url), {
    routes: {
      "/social-demo-data.json": { posts: [] },
      "/api/social-posts?limit=100": { posts: [{ ...apiPost(ARI_POST, "Ari", "A drawing of the release train.", 3), image_url: "/media/ari.svg", image_alt: "A train drawn in pencil", image_width: 10, image_height: 10 }] },
    },
  });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window.history = { replaceState() {} };
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => realCards(document, ".profile-tile", "profile-tile-skeleton").length > 0, "a real tile is drawn");

  const tiles = realCards(document, ".profile-tile", "profile-tile-skeleton");
  const buttons = document.querySelectorAll(".post-report-button");
  assert.equal(buttons.length, tiles.length);
  assert.match(buttons[0].getAttribute("aria-label"), /^Report post by Ari, /);

  buttons[0].click();
  assert.equal(document.querySelector("#post-report-panel").hidden, false);
  assert.equal(textOf(document.querySelector("#post-report-post")), "You are reporting the post by Ari: “A drawing of the release train.”");
  assert.equal(document.activeElement?.id, "post-report-title");
  document.querySelector("#post-report-close").click();
  assert.equal(document.activeElement === buttons[0], true, "Close did not return focus to the tile's Report post");
});

// #2373: the publication warning and the reporting explanation used to
// contradict each other. The warning said a published post could not be
// deleted, full stop; the reporting copy on the same page says the Wawalu team
// reviews reported posts and may take one down. The warning now names whose act
// each one is — you cannot take your own post down, anyone can report it. What
// the team does with a report is left to the explanation below the feed, which
// says it once (#2471).
//
// It is stated once, beside the composer that performs the act (#2401). People
// used to carry a second copy on a page with no composer; it points at Social's
// now, and the test below pins that it kept neither half.
//
// Asserted on the painted DOM, not on the markup: a page could hydrate over its
// own warning.
const SELF_SERVICE = /You cannot edit or delete your own post after you publish it/;
const REMOVAL_PATH = /Anyone can select Report post on a published post\./;
// A promise of removal, and a second name for the one actor the site has.
const OVERPROMISES = [/will be removed/i, /will remove/i, /we remove/i, /guarantee/i];
const RIVAL_ACTORS = [/moderator/i, /\badmin\b/i, /support team/i, /\bstaff\b/i];

const statesTheDistinction = (copy, surface) => {
  assert.match(copy, SELF_SERVICE, `${surface} no longer says the publisher cannot take their own post down`);
  assert.match(copy, REMOVAL_PATH, `${surface} no longer points at Report post`);
  assert.ok(copy.includes(REPORT_POST_LABEL), `${surface} names the reporting control something other than "${REPORT_POST_LABEL}"`);
  for (const promise of OVERPROMISES)
    assert.doesNotMatch(copy, promise, `${surface} promises a reported post comes down (${promise})`);
  for (const rival of RIVAL_ACTORS)
    assert.doesNotMatch(copy, rival, `${surface} names the reviewing team a second way (${rival})`);
};

test("Social: the composer says the publisher cannot delete a post and reporting may", async (t) => {
  const { document, id } = await bootSocial(t, { routes: { "/api/social-posts?limit=100": LIVE } });
  // Open, because this is what a visitor reads while deciding to publish.
  id("post-compose-open").click();
  await waitFor(() => realCards(document, ".post-card", "post-card-skeleton").length === 2, "Social painted its posts");
  assert.equal(id("post-compose-panel").hidden, false);

  statesTheDistinction(textOf(id("post-consequence")), "Social's composer");
  // The control it sends a reader to is on the page it sends them from.
  assert.equal(document.querySelectorAll(".post-report-button").length, 2);
  assert.equal(textOf(document.querySelectorAll(".post-report-button")[0]), REPORT_POST_LABEL);
});

test("People: the helper points at the terms instead of restating them, once the tiles are drawn", async (t) => {
  const page = await loadPage(new URL("../src/profile.html", import.meta.url), {
    routes: {
      "/social-demo-data.json": { posts: [] },
      "/api/social-posts?limit=100": { posts: [{ ...apiPost(ARI_POST, "Ari", "A drawing of the release train.", 3), image_url: "/media/ari.svg", image_alt: "A train drawn in pencil", image_width: 10, image_height: 10 }] },
    },
  });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window.history = { replaceState() {} };
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  await importPageModule("/profile-page.js");
  const { document } = page;
  // The intro is authored markup, so a wait on its text would return before the
  // module ran. Wait on drawn tiles instead; skeletons carry the tile class.
  await waitFor(() => realCards(document, ".profile-tile", "profile-tile-skeleton").length > 0, "People drew an image post");

  // People states both halves in its own shorter words (#2484): the post
  // cannot be edited or deleted, and anyone can select Report post on it. What
  // is pinned here is that the page carries no orphaned half of the pair — the
  // failure this test was written for was one warning without the other.
  // Since #2557 the second half also says where the control is, and the count
  // at the end of this test is what makes that claim true of this page.
  //
  // On the painted DOM, not the markup: src/profile.js takes that paragraph out
  // of the document while the first fetch is open and puts it back, so a wait on
  // drawn tiles is also the wait for this region.
  const helper = textOf(document.querySelector(".feed-create"));
  assert.doesNotMatch(helper, SELF_SERVICE,
    "People recites the composer's own sentence about taking a post down");
  assert.doesNotMatch(helper, REMOVAL_PATH,
    "People recites the composer's own sentence about the removal path");
  assert.ok(helper.trim().endsWith(
    "A published post is public and cannot be edited or deleted, and anyone can select Report post on it — the button under every post here and in Social's feed. "
    + "Do not include customer or production data."),
  `People's helper no longer states both halves of the distinction: ${helper}`);
  assert.ok(helper.includes(REPORT_POST_LABEL), `People names the reporting control something other than "${REPORT_POST_LABEL}"`);
  const readable = textOf(document.getElementById("main-content"));
  for (const promise of OVERPROMISES)
    assert.doesNotMatch(readable, promise, `People promises a reported post comes down (${promise})`);
  for (const rival of RIVAL_ACTORS)
    assert.doesNotMatch(readable, rival, `People names the reviewing team a second way (${rival})`);
  assert.doesNotMatch(textOf(document.querySelectorAll(".profile-lede")[1]), SELF_SERVICE,
    "People's first screen warns again about publishing a post it has no composer for");
  assert.equal(document.querySelectorAll(".post-report-button").length,
    realCards(document, ".profile-tile", "profile-tile-skeleton").length);
});
