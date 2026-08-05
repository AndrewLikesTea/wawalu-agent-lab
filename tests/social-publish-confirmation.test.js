// What a reader gets back for pressing Publish.
//
// The composer's confirmation is the only place the product tells someone their
// post exists, so it has to say WHICH post, link to it, and — because Social's
// two filters can be on while you publish — admit when the post it just
// confirmed is not among the cards below. Each of those is a way the previous
// "Post published successfully." could be true and useless at the same time.
//
// The permalink is the load-bearing part: it is built from the id the publish
// response returned, in the shape /post.html reads its id out of, so the link in
// the confirmation resolves to the post the confirmation is about.
//
// Harness notes: assertions are on counts and attribute values, never on element
// identity (a null-equality assertion on a harness element walks the whole parsed
// page), and the select double accepts values a real control would refuse — so
// the filtered-out case asserts on the rendered feed, not on the control.

import test from "node:test";
import assert from "node:assert/strict";
import {
  FILTERED_OUT_NOTE,
  NO_IMAGE_NOTE,
  PUBLISH_STATE_WORDS,
  REVEAL_CONTROL_LABEL,
  mountSocialFeed,
  postMatchesFilters,
  publishedPostLabel,
} from "../src/social.js";
import { postDetailHref } from "../src/social-links.js";
import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");
const SAVED_ID = "3f2a1c58-8f6e-4a1b-9c2d-77c4f0a1b2e3";

// An existing post, so the display-name filter has a second name to sit on.
const EXISTING = {
  id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  author: "Iris",
  body: "Shipped the release row.",
  createdAt: new Date(NOW - 60_000).toISOString(),
};

// A composer on the shipped markup, with the media half and the API replaced by
// values the test controls. `create` is the publish response: it returns the row
// the server made, id and all, which is where the permalink comes from.
async function composer(t, { hasImage = false, fail = null } = {}) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const document = page.document;
  const published = [];
  let media = hasImage
    ? { content_type: "image/png", data: "iVBORw0KGgo=", width: 32, height: 32, preview: "data:image/png;base64,carried" }
    : null;

  const feed = mountSocialFeed(document, {
    posts: [EXISTING],
    state: "ready",
    storage: page.storage,
    getMedia: () => (media ? { ...media, alt: document.querySelector("#post-image-alt").value.trim() } : null),
    clearMedia: () => { media = null; },
    create: async (post) => {
      if (fail) throw new Error(fail);
      published.push(post);
      return { ...post, id: SAVED_ID, createdAt: new Date(NOW).toISOString() };
    },
  });
  feed.description.setAttached(Boolean(media));
  if (media) {
    document.querySelector("#compose-preview-image").src = media.preview;
    document.querySelector("#compose-media").hidden = false;
  }

  const fill = ({ body, author, description }) => {
    if (body !== undefined) document.querySelector("#post-body").value = body;
    if (author !== undefined) document.querySelector("#post-author").value = author;
    if (description !== undefined) document.querySelector("#post-image-alt").value = description;
  };
  const publish = async () => {
    document.querySelector("#post-submit").click();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { page, document, feed, published, fill, publish, get media() { return media; } };
}

const notice = (document) => document.querySelector("#social-notice");
const noticeLinks = (document) => notice(document).querySelectorAll("a");

test("the confirmation names the post and links to the permalink the response's id addresses", async (t) => {
  const harness = await composer(t);
  harness.fill({ body: "Confirmed a published post.", author: "Remy" });

  await harness.publish();

  const region = notice(harness.document);
  assert.equal(region.hidden, false, "the confirmation is on screen");
  assert.match(textOf(region), /^Published “Confirmed a published post\.” as Remy\./);

  const links = noticeLinks(harness.document);
  assert.equal(links.length, 1, "no image, so the permalink is the only link");
  // The id came back from the publish response; nothing here rebuilt it from the
  // caption or the clock, and the shape is the one src/post-page.js reads.
  assert.equal(links[0].getAttribute("href"), postDetailHref(SAVED_ID, "Remy"));
  assert.match(links[0].getAttribute("href"), /^\/post\.html\?id=3f2a1c58-/);
  assert.equal(textOf(links[0]), "Open the post’s permalink");

  // Success without colour: the sentence alone says what happened.
  assert.match(textOf(region), /Published/);
  // And the reader is standing on it, so a screen reader reads it without hunting.
  assert.equal(harness.document.activeElement?.id, "social-notice");
  assert.equal(region.getAttribute("tabindex"), "-1", "programmatic only — not a new tab stop");
  assert.equal(
    tabSequence(harness.document).filter((node) => node.id === "social-notice").length,
    0,
    "the confirmation itself never joins the tab order",
  );
});

test("the caption, the image, and the description are cleared only after a confirmed publish", async (t) => {
  const harness = await composer(t, { hasImage: true });
  harness.fill({ body: "A blue focus ring on a card.", author: "Remy", description: "A card wrapped in a blue focus ring." });

  await harness.publish();

  assert.equal(harness.published.length, 1);
  assert.equal(harness.document.querySelector("#post-body").value, "");
  assert.equal(harness.document.querySelector("#post-image-alt").value, "");
  assert.equal(harness.media, null, "the encoded image left the composer with the post");
  // The display name is not one of the fields a post consumes: it is who this
  // browser is, and it was just remembered.
  assert.equal(harness.document.querySelector("#post-author").value, "Remy");
  assert.equal(harness.document.querySelector("#post-counter").textContent, "280");
});

test("an image post offers People, and a text post says it is on Social only", async (t) => {
  const withImage = await composer(t, { hasImage: true });
  withImage.fill({ body: "Ring landed on every control.", author: "Remy", description: "A card wrapped in a blue focus ring." });
  await withImage.publish();

  const links = noticeLinks(withImage.document);
  assert.equal(links.length, 2, "permalink plus the display name's People page");
  assert.equal(links[1].getAttribute("href"), "/profile.html?author=Remy");
  assert.equal(textOf(links[1]), "See Remy’s image posts on People");
  assert.doesNotMatch(textOf(notice(withImage.document)), /Social only/);

  const textOnly = await composer(t);
  textOnly.fill({ body: "No picture on this one.", author: "Remy" });
  await textOnly.publish();

  assert.equal(noticeLinks(textOnly.document).length, 1, "nothing on People, so no link to it");
  assert.match(textOf(notice(textOnly.document)), new RegExp(NO_IMAGE_NOTE));
});

test("a post the filters hide is confirmed as hidden, and the control that reveals it works from the keyboard", async (t) => {
  const harness = await composer(t);
  const document = harness.document;
  // Iris is the only name with a post, so the picker holds it and the feed is
  // narrowed to her — the state a reader can genuinely be in when they publish.
  document.querySelector("#post-name-filter").value = "Iris";
  harness.fill({ body: "Published under another name.", author: "Remy" });

  await harness.publish();

  // The rendered feed, not the select, is what says the post is hidden: the
  // harness's select accepts any value, so the control is not the evidence.
  assert.equal(
    document.querySelectorAll(".post-card").length,
    1,
    "the filter is still on, so only Iris's post is on screen",
  );
  assert.equal(
    document.querySelectorAll(".post-card").filter((card) => card.dataset.postId === SAVED_ID).length,
    0,
    "the new post is not among the cards",
  );

  const region = notice(document);
  assert.match(textOf(region), new RegExp(PUBLISH_STATE_WORDS.filtered), "the state is a word, not a colour");
  assert.match(textOf(region), new RegExp(FILTERED_OUT_NOTE));
  // A live state reads as a filled wash, not an outline classification chip.
  const chips = region.querySelectorAll(".detail-state-chip");
  assert.equal(chips.length, 1);
  assert.ok(chips[0].getAttribute("class").includes("detail-state-chip-missing"));

  // Reachable by Tab: the control is in the page's tab sequence exactly once,
  // and tabbing from where the reader is standing arrives at it.
  const controls = tabSequence(document).filter((node) => textOf(node) === REVEAL_CONTROL_LABEL);
  assert.equal(controls.length, 1, "the reveal control is exactly one tab stop");
  let landed = null;
  for (let step = 0; step < tabSequence(document).length && landed === null; step += 1) {
    const next = pressTab(document);
    if (textOf(next) === REVEAL_CONTROL_LABEL) landed = next;
  }
  assert.equal(textOf(landed), REVEAL_CONTROL_LABEL, "Tab reaches the control");

  // And activates with Enter, the way a keyboard reader activates a button.
  pressEnter(document);

  assert.equal(document.querySelector("#post-name-filter").value, "all", "the filters are cleared");
  assert.equal(
    document.querySelectorAll(".post-card").filter((card) => card.dataset.postId === SAVED_ID).length,
    1,
    "the post the confirmation promised is now on screen",
  );
  assert.equal(document.activeElement?.dataset?.postId, SAVED_ID, "focus lands on the revealed post");
  assert.doesNotMatch(textOf(notice(document)), new RegExp(FILTERED_OUT_NOTE), "and the notice no longer claims it is hidden");
  assert.equal(
    tabSequence(document).filter((node) => textOf(node) === REVEAL_CONTROL_LABEL).length,
    0,
    "the control leaves with the state it fixed",
  );
});

test("a failed publish keeps every field and says something different from the confirmation", async (t) => {
  const harness = await composer(t, { hasImage: true, fail: "Posts API returned 503" });
  harness.fill({ body: "This one does not land.", author: "Remy", description: "A card wrapped in a blue focus ring." });

  await harness.publish();

  // Exactly what the reader left, still there to try again with.
  assert.equal(harness.document.querySelector("#post-body").value, "This one does not land.");
  assert.equal(harness.document.querySelector("#post-author").value, "Remy");
  assert.equal(harness.document.querySelector("#post-image-alt").value, "A card wrapped in a blue focus ring.");
  assert.equal(harness.media?.data, "iVBORw0KGgo=", "the encoded image is still in the composer");
  assert.equal(harness.document.querySelector("#compose-media").hidden, false, "the preview is still on screen");
  assert.equal(harness.document.querySelector("#compose-preview-image").src, "data:image/png;base64,carried");

  const region = notice(harness.document);
  assert.equal(region.hidden, false);
  assert.match(textOf(region), new RegExp(PUBLISH_STATE_WORDS.failed));
  assert.match(textOf(region), /Posts API returned 503/);
  assert.doesNotMatch(textOf(region), /^Published/, "the failure does not borrow the confirmation's opening");
  assert.equal(noticeLinks(harness.document).length, 0, "no permalink, because there is no post");
  assert.equal(region.classList.contains("is-success"), false);
  assert.equal(
    harness.document.querySelectorAll(".post-card").filter((card) => card.dataset.postId === SAVED_ID).length,
    0,
    "nothing was added to the feed",
  );
});

test("the confirmation and the feed answer 'is this post visible' with one predicate", () => {
  const post = { author: "Remy", createdAt: new Date(NOW).toISOString() };
  assert.equal(postMatchesFilters(post, { author: "all", range: "all", now: NOW }), true);
  assert.equal(postMatchesFilters(post, { author: "Iris", range: "all", now: NOW }), false);
  assert.equal(postMatchesFilters(post, { author: "all", range: "hour", now: NOW }), true);
  assert.equal(
    postMatchesFilters({ ...post, createdAt: new Date(NOW - 90 * 60_000).toISOString() }, { author: "all", range: "hour", now: NOW }),
    false,
  );
});

test("a long caption is shortened in the confirmation rather than repeated whole", () => {
  assert.equal(publishedPostLabel({ body: "  Short   one.  ", author: "Remy" }), "Published “Short one.” as Remy.");
  const long = "w".repeat(120);
  const label = publishedPostLabel({ body: long, author: "Remy" });
  assert.ok(label.length < long.length, "the caption is shortened");
  assert.match(label, /…” as Remy\.$/);
});
