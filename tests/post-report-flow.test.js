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
import { REPORT_RECEIVED, REPORT_REVIEW_NOTE } from "../src/post-report.js";

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
  assert.match(textOf(id("post-report-about")), /reviews? each one\. A report does not remove or hide the post, and not every report leads to removal\.$/);
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
