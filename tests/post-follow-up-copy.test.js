import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, pressEnter, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { handleLeadRequest, MAX_FOLLOW_UP_MESSAGE_LENGTH, POST_FOLLOW_UP_TOPIC, FOLLOW_UP_TOPICS } from "../src/leads.js";
import { FOLLOW_UP_PRIVACY_WITH_MESSAGE } from "../src/lead-capture.js";

// The request carries no post, so both lines tell the visitor how to name it themselves.
const invitation = "Questions about this post from Social? Send the Wawalu team that operates Shiplog a follow-up request. The request does not include the post. Paste its link in your message so we know which post you mean.";
const hint = "Paste the post’s link, or its display name and a few of its words. Up to 200 characters.";
const post = { id: "p-copy", author: "Mina Okafor", body: "Focus rings landed everywhere.", createdAt: "2026-07-14T09:00:00.000Z", likes: 0, comments: 0 };

for (const state of ["loading", "loaded"]) {
  test(`post follow-up names the individual post during ${state} and sends only disclosed fields`, async () => {
    const page = await loadPage(new URL("../src/post.html", import.meta.url), {
      location: { search: "?id=p-copy&author=Mina%20Okafor" },
    });
    const { document } = page;
    const byId = (id) => document.getElementById(id);
    const calls = [];
    const rows = [];
    let release;
    try {
      assert.equal(textOf(document.querySelector(".site-footer-invitation")), invitation);
      globalThis.fetch = async (url, options) => {
        if (url === "/social-demo-data.json") {
          await new Promise((resolve) => { release = resolve; });
          return new Response(JSON.stringify({ posts: [post] }));
        }
        assert.equal(url, "/api/leads");
        calls.push(JSON.parse(options.body));
        return handleLeadRequest(new Request("https://example.test/api/leads", options), {
          store: { capture: async (...args) => { rows.push(args); return true; } },
        });
      };
      await importPageModule("/site-footer-page.js");
      await importPageModule("/post-page.js");
      await waitFor(() => Boolean(release), "post lookup started");
      if (state === "loaded") {
        release();
        await waitFor(() => document.documentElement.dataset.shiplogPostDetail === "ready", "post loaded");
        assert.ok(textOf(byId("post-detail")).includes(post.body));
      }
      assert.equal(byId("post-detail").dataset.postState, state);
      assert.match(textOf(byId("page-title")), /post/i);
      assert.equal(textOf(document.querySelector(".site-footer-invitation")), invitation);
      assert.equal(textOf(byId("site-footer-topic-note")), "This request is sent about the post from Social.");
      assert.equal(byId("site-footer-topic-note").hidden, false);
      assert.equal(textOf(byId("site-footer-message-hint")), hint);
      assert.ok(byId("site-footer-message").getAttribute("aria-describedby").split(" ").includes("site-footer-message-hint"));
      assert.equal(textOf(byId("site-footer-message-counter")), String(MAX_FOLLOW_UP_MESSAGE_LENGTH));
      assert.equal(textOf(byId("site-footer-note")), FOLLOW_UP_PRIVACY_WITH_MESSAGE);
      byId("site-footer-email").focus();
      typeText(document, "reader@example.com");
      pressEnter(document);
      await waitFor(() => byId("site-footer-form").dataset.state === "success", "request saved");
      assert.deepEqual(calls, [{ email: "reader@example.com", purpose: "follow_up_social", topic: POST_FOLLOW_UP_TOPIC }]);
      assert.equal(rows[0][3], POST_FOLLOW_UP_TOPIC);
      assert.ok(textOf(byId("site-footer-confirmation")).includes(`Fixed page topic: ${POST_FOLLOW_UP_TOPIC}.`));
    } finally {
      // Only settle a lookup that started, or a failure above is replaced by this wait's timeout.
      if (release) {
        release();
        await waitFor(() => document.documentElement.dataset.shiplogPostDetail === "ready", "lookup settled before cleanup");
      }
      page.restore();
    }
  });
}

// The privacy sentence under this form says the typed message is sent, so a question
// must survive the real endpoint, not only a stubbed transport.
test("a post link pasted on the post page reaches the team with the post topic", async () => {
  const page = await loadPage(new URL("../src/post.html", import.meta.url));
  const { document } = page;
  const byId = (id) => document.getElementById(id);
  const rows = [];
  const question = "Is this the focus-ring release? https://labs.wawalu.org/post.html?id=p-copy";
  try {
    globalThis.fetch = async (url, options) => handleLeadRequest(new Request(`https://example.test${url}`, options), {
      store: { capture: async (...args) => { rows.push(args); return true; } },
    });
    await importPageModule("/site-footer-page.js");
    byId("site-footer-message").focus();
    typeText(document, question);
    byId("site-footer-email").focus();
    typeText(document, "reader@example.com");
    pressEnter(document);
    await waitFor(() => ["success", "error"].includes(byId("site-footer-form").dataset.state), "request settled");
    assert.equal(byId("site-footer-form").dataset.state, "success", textOf(byId("site-footer-status")));
    assert.deepEqual(rows.map((row) => [row[1], row[3], row[4]]),
      [["follow_up_social", POST_FOLLOW_UP_TOPIC, question]]);
  } finally {
    page.restore();
  }
});

// The hint's number is the endpoint's. The field has no maxlength on purpose:
// that would silently cut a pasted link short, so an over-long message is refused whole.
test("the post request accepts a 200-character message and refuses 201", async () => {
  const send = (message) => handleLeadRequest(new Request("https://example.test/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "reader@example.com", purpose: "follow_up_social", topic: POST_FOLLOW_UP_TOPIC, message }),
  }), { store: { capture: async () => true } });
  assert.equal(MAX_FOLLOW_UP_MESSAGE_LENGTH, 200);
  assert.equal((await send("x".repeat(200))).status, 201);
  const refused = await send("x".repeat(201));
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).error.code, "invalid_message");
});

test("Social feed keeps its general invitation and fixed topic", async () => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url));
  try {
    await importPageModule("/site-footer-page.js");
    const { document } = page;
    const topic = "Social page — read short posts about shipped work, or publish one";
    assert.equal(FOLLOW_UP_TOPICS.follow_up_social, topic);
    assert.equal(document.getElementById("site-footer-form").dataset.followUpTopic, topic);
    assert.equal(textOf(document.getElementById("site-footer-topic-note")), `This request is sent about the ${topic}.`);
    assert.equal(textOf(document.querySelector(".site-footer-invitation")), "Questions about Shiplog? Send the Wawalu team that operates it a follow-up request.");
  } finally {
    page.restore();
  }
});

test("the post topic is accepted only for Social requests; arbitrary topics stay invalid", async () => {
  for (const [purpose, topic] of [
    ["follow_up_people", POST_FOLLOW_UP_TOPIC],
    ["follow_up_social", "post from Social: p-copy"],
  ]) {
    const response = await handleLeadRequest(new Request("https://example.test/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "reader@example.com", purpose, topic }),
    }), { store: { capture: async () => assert.fail("invalid topic must not be stored") } });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "invalid_topic");
  }
});
