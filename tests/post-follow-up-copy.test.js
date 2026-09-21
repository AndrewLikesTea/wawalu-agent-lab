import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressEnter, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { handleLeadRequest, POST_FOLLOW_UP_TOPIC, FOLLOW_UP_TOPICS } from "../src/leads.js";
import { REPORT_POST_LABEL } from "../src/post-report.js";
import { INVITATION } from "../src/site-footer.js";

// The block a shared link lands a stranger on. It used to be headed "Questions
// about this post from Social?" above four topics that are all about Shiplog —
// availability, a demonstration, a pilot, security and data handling — so it
// promised answers the form cannot route, and never named the control that does
// answer a question about the post. It carries Social's heading line now, says
// what the topics cover, and sends a question about the post itself to Report
// post (#2436). The two sentences about naming the post in a message are
// unchanged: a Shiplog question prompted by this post still has to say which.
const invitation = "Questions about Shiplog? Send the Wawalu team that operates it a follow-up request. The topics below are about Shiplog — whether it is available for your team, a demonstration, a pilot, and security and data handling — not about this post. If your question is about this post itself, select Report post instead. Nothing about the post is attached to the request automatically. Select Copy link to this post and paste the link into your message so the team knows which post you mean.";
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
          store: { capture: async (...args) => { rows.push(args); return { created: true, intent: args[5] }; } },
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
      assert.equal(textOf(byId("site-footer-topic-note")), "This request is sent about the Social post page — one post from Social, at its own link.");
      assert.equal(byId("site-footer-topic-note").hidden, false);
      byId("site-footer-intent-demo").click();
      byId("site-footer-email").focus();
      typeText(document, "reader@example.com");
      pressEnter(document);
      await waitFor(() => byId("site-footer-form").dataset.state === "success", "request saved");
      assert.deepEqual(calls, [{ email: "reader@example.com", purpose: "follow_up_social", topic: POST_FOLLOW_UP_TOPIC, intent: "demo" }]);
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
test("a question typed on the post page reaches the team with the post topic", async () => {
  const page = await loadPage(new URL("../src/post.html", import.meta.url));
  const { document } = page;
  const byId = (id) => document.getElementById(id);
  const rows = [];
  try {
    globalThis.fetch = async (url, options) => handleLeadRequest(new Request(`https://example.test${url}`, options), {
      store: { capture: async (...args) => { rows.push(args); return { created: true, intent: args[5] }; } },
    });
    await importPageModule("/site-footer-page.js");
    byId("site-footer-intent-pilot").click();
    byId("site-footer-message").focus();
    typeText(document, "Is this the focus-ring release?");
    byId("site-footer-email").focus();
    typeText(document, "reader@example.com");
    pressEnter(document);
    await waitFor(() => ["success", "error"].includes(byId("site-footer-form").dataset.state), "request settled");
    assert.equal(byId("site-footer-form").dataset.state, "success", textOf(byId("site-footer-status")));
    assert.deepEqual(rows.map((row) => [row[1], row[3], row[4]]),
      [["follow_up_social", POST_FOLLOW_UP_TOPIC, "Is this the focus-ring release?"]]);
  } finally {
    page.restore();
  }
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

// The two halves of #2436, held to their sources rather than to a second copy
// of the words: the block opens on the heading line Social and People render,
// and it names the reporting control exactly as src/post-report.js does. The
// pointer is in the invitation, which every task page reads before the panel
// (tests/footer-directory-order.test.js), so it is above the topic choices.
test("the post page opens on Social's heading line and points a post question at Report post", async () => {
  const page = await loadPage(new URL("../src/post.html", import.meta.url));
  try {
    const paragraph = textOf(page.document.querySelector(".site-footer-invitation"));
    assert.ok(paragraph.startsWith(`${INVITATION} `),
      "the post page no longer opens on the invitation every other page carries");
    assert.ok(paragraph.includes(`select ${REPORT_POST_LABEL} instead`),
      `the post page names the reporting control something other than "${REPORT_POST_LABEL}"`);
    const markup = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
    assert.ok(markup.indexOf('class="site-footer-invitation"') < markup.indexOf('id="site-footer-intent"'),
      "the pointer to Report post is read after the topic choices");
    // The form's own copy is untouched: same four topics, same action.
    for (const label of ["Availability or pricing", "A product demonstration", "A pilot evaluation", "Security or data handling"])
      assert.ok(markup.includes(`>${label}</label>`), `the post page stopped offering "${label}"`);
    assert.ok(markup.includes('<button type="submit">Request a follow-up</button>'),
      "the post page changed the submit label the privacy invariant discovers forms by");
  } finally {
    page.restore();
  }
});

test("the post topic is accepted only for Social requests; arbitrary topics stay invalid", async () => {
  for (const [purpose, topic] of [
    ["follow_up_people", POST_FOLLOW_UP_TOPIC],
    ["follow_up_social", `${POST_FOLLOW_UP_TOPIC}: p-copy`],
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
