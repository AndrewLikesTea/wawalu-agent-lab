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
import { readFile } from "node:fs/promises";
import {
  FILTERED_OUT_NOTE,
  NO_IMAGE_NOTE,
  PUBLISH_FAILED_NOTE,
  PUBLISH_NO_LINK_NOTE,
  PUBLISH_RETRY_LABEL,
  PUBLISH_RETRY_NOTE,
  PUBLISH_STATE_WORDS,
  REVEAL_CONTROL_LABEL,
  mountSocialFeed,
  postMatchesFilters,
  publishedPostLabel,
} from "../src/social.js";
import { POST_COPY_LABEL, postDetailHref, postPermalink } from "../src/social-links.js";
import { SHARE_COPIED_STATUS, SHARE_COPY_FAILED_STATUS } from "../src/share-link.js";
import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");
const SAVED_ID = "3f2a1c58-8f6e-4a1b-9c2d-77c4f0a1b2e3";
// The origin tests/support/browser.js serves every page from, and therefore the
// one the confirmation's permalink resolves against.
const ORIGIN = "https://labs.wawalu.org";

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
//
// The request is controllable in two ways the outcome tests need: `fail` can be
// cleared between presses (a retry that lands), and `hold` parks the request
// mid-flight so the in-flight state can be read while it is actually true.
//
// `saved` rewrites the row the response returns, which is how the case with no
// usable post identity is reached: a response that came back without an id is
// the one state where the confirmation has no address to offer. `clipboard` is
// what the copy control writes through — absent means a browser that has none.
async function composer(t, {
  hasImage = false, fail = null, hold = false, saved = null, clipboard = undefined,
} = {}) {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const document = page.document;
  const published = [];
  // Every payload the composer handed the API, in order — the evidence for "one
  // press, one request" and for "the retry sent the same post".
  const requests = [];
  let failure = fail;
  let holding = hold;
  let resume = null;
  let media = hasImage
    ? { content_type: "image/png", data: "iVBORw0KGgo=", width: 32, height: 32, preview: "data:image/png;base64,carried" }
    : null;

  const feed = mountSocialFeed(document, {
    posts: [EXISTING],
    state: "ready",
    storage: page.storage,
    clipboard,
    getMedia: () => (media ? { ...media, alt: document.querySelector("#post-image-alt").value.trim() } : null),
    clearMedia: () => { media = null; },
    create: async (post, image) => {
      requests.push({ post, image });
      if (holding) await new Promise((release) => { resume = release; });
      if (failure) throw new Error(failure);
      published.push(post);
      const row = { ...post, id: SAVED_ID, createdAt: new Date(NOW).toISOString() };
      return saved ? { ...row, ...saved } : row;
    },
  });
  feed.description.setAttached(Boolean(media));
  // The composer ships collapsed behind the hero's Publish a post control, and
  // the receipt this file is about lives inside it, so open it first.
  feed.composer.open();
  if (media) {
    document.querySelector("#compose-preview-image").src = media.preview;
    document.querySelector("#compose-media").hidden = false;
  }

  const fill = ({ body, author, description }) => {
    if (body !== undefined) document.querySelector("#post-body").value = body;
    if (author !== undefined) document.querySelector("#post-author").value = author;
    if (description !== undefined) document.querySelector("#post-image-alt").value = description;
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const publish = async () => {
    document.querySelector("#post-submit").click();
    await settle();
  };
  return {
    page,
    document,
    feed,
    published,
    requests,
    fill,
    publish,
    settle,
    // Enter in the display name field: implicit submission, which is a second
    // route into the same handler that never touches the submit button.
    async submitFromField() {
      document.querySelector("#post-author").focus();
      pressEnter(document);
      await settle();
    },
    setFailure(next) { failure = next; },
    hold(next) { holding = next; },
    async releaseRequest() {
      const release = resume;
      resume = null;
      release?.();
      await settle();
    },
    get media() { return media; },
  };
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
  //
  // The href is the canonical permalink — the same string the shared post page's
  // own copy control hands over, built by the same function — so the link the
  // reader follows and the address they can copy are one address, not two.
  assert.equal(links[0].getAttribute("href"), postPermalink(SAVED_ID, ORIGIN));
  assert.equal(links[0].getAttribute("href"), `${ORIGIN}${postDetailHref(SAVED_ID)}`);
  assert.match(links[0].getAttribute("href"), /\/post\.html\?id=3f2a1c58-/);
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

/* ---------------- handing the published post's link onward ---------------- */

const copyControls = (document) =>
  notice(document).querySelectorAll(".share-control");
const copyButton = (document) => document.querySelector("#publish-copy");
const copyStatus = (document) => document.querySelector("#publish-copy-status");

test("the confirmation offers the post's own address, copied in the site's existing words", async (t) => {
  let copied = null;
  const harness = await composer(t, { clipboard: { writeText: async (value) => { copied = value; } } });
  harness.fill({ body: "Handed the link straight over.", author: "Remy" });

  await harness.publish();

  const document = harness.document;
  assert.equal(copyControls(document).length, 1, "one control, not a row of them");
  const button = copyButton(document);
  assert.equal(textOf(button), POST_COPY_LABEL, "the label the permalink's own control uses");
  assert.equal(textOf(button), "Copy link to this post");
  // A button, so it is focusable already and takes the site's own focus ring.
  // The harness reflects no properties, so this is the property, not the
  // attribute.
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("tabindex"), null);
  assert.ok(button.getAttribute("class").includes("share-button"));
  assert.equal(button.getAttribute("aria-label"), null, "the visible words are the accessible name");
  assert.equal(button.getAttribute("aria-describedby"), "publish-copy-status");

  // Rendering copies nothing: the clipboard is written under an activation.
  assert.equal(copied, null, "the confirmation wrote to the clipboard without being asked");
  assert.equal(copyStatus(document).textContent, "");

  button.click();
  await harness.settle();

  // What was copied is the address the link points at, which is the address the
  // shared post page's copy control produces for this post.
  assert.equal(copied, postPermalink(SAVED_ID, ORIGIN));
  assert.equal(copied, noticeLinks(document)[0].getAttribute("href"));
  assert.equal(copyStatus(document).textContent, SHARE_COPIED_STATUS);
  assert.equal(copyStatus(document).textContent, "Link copied to clipboard.");
  assert.equal(button.disabled, false, "the control is pressable again once it has reported");

  // Reachable by Tab, exactly once — it is a control in the receipt, not a
  // decoration on it.
  assert.equal(
    tabSequence(document).filter((node) => node.id === "publish-copy").length,
    1,
    "the copy control is exactly one tab stop",
  );
});

// A browser that refuses the clipboard is a state, not a silence — and it is
// reported in the sentence share-link.js already owns.
test("a refused clipboard is reported in the confirmation's own words", async (t) => {
  const harness = await composer(t, { clipboard: {} });
  harness.fill({ body: "This one cannot reach the clipboard.", author: "Remy" });

  await harness.publish();
  copyButton(harness.document).click();
  await harness.settle();

  assert.equal(copyStatus(harness.document).textContent, SHARE_COPY_FAILED_STATUS);
  assert.match(copyStatus(harness.document).textContent, /Could not copy the link/);
  // The confirmation itself is untouched by a failed copy: the post is still
  // published, and still says so.
  assert.match(textOf(notice(harness.document)), /^Published “This one cannot reach the clipboard\.” as Remy\./);
  assert.equal(noticeLinks(harness.document).length, 1, "the link is still there to follow");
});

// The one state where there is no address to hand over: the response came back
// without an id. The confirmation still says the post was published and says
// where it is — and offers nothing that looks like a link to it.
test("a response with no post identity confirms the publish and offers no link at all", async (t) => {
  const harness = await composer(t, { saved: { id: "" } });
  harness.fill({ body: "Published without an id coming back.", author: "Remy" });

  await harness.publish();

  const document = harness.document;
  const region = notice(document);
  assert.equal(region.hidden, false, "the publish is still confirmed");
  assert.match(textOf(region), /^Published “Published without an id coming back\.” as Remy\./);
  assert.match(textOf(region), new RegExp(PUBLISH_NO_LINK_NOTE));
  assert.match(textOf(region), /Find it in the feed below\./);

  // Nothing that looks like a way to open or copy the post: no anchor at all,
  // so no href="" and no href="#", and no control offering to copy nothing.
  assert.equal(noticeLinks(document).length, 0, "a link was drawn for a post with no address");
  assert.equal(copyControls(document).length, 0, "a copy control was drawn with nothing to copy");
  assert.equal(document.querySelectorAll("#publish-copy").length, 0);
  assert.equal(
    textOf(region).includes(POST_COPY_LABEL),
    false,
    "the copy label survived into a confirmation with no address",
  );
  // And the post is on the feed the sentence sends the reader to.
  assert.equal(
    document.querySelectorAll(".post-card")
      .filter((card) => !card.getAttribute("class").includes("-skeleton"))
      .filter((card) => textOf(card).includes("Published without an id coming back.")).length,
    1,
    "the feed the confirmation names does not hold the post",
  );
});

// The whole point of the link, followed: the address the confirmation handed
// over is fed to the shipped permalink page, answered by the API the way the
// server would answer it for the row that was just written, and what comes back
// is the post as published — its words, its image, and the display name it went
// out under. A confirmation whose link resolved to the wrong post, or to none,
// fails here rather than in a reader's chat window.
test("following the confirmation's link opens the post as it was published", async (t) => {
  const harness = await composer(t, { hasImage: true });
  harness.fill({
    body: "Ring landed on every control.",
    author: "Remy",
    description: "A card wrapped in a blue focus ring.",
  });

  await harness.publish();

  const href = noticeLinks(harness.document)[0].getAttribute("href");
  // A browser follows an absolute address by taking its query string to the next
  // page. That query string is the whole contract between the two halves.
  const search = new URL(href).search;
  assert.equal(new URLSearchParams(search).get("id"), SAVED_ID, "the link does not address the published row");
  const sent = harness.requests[0];
  // One page at a time: Social's globals go back before the permalink installs
  // its own.
  harness.page.restore();

  // What the API returns for that id — the same row, in the public read model
  // src/social-posts-api.js serves it in.
  const row = {
    id: SAVED_ID,
    author: sent.post.author,
    content: sent.post.body,
    timestamp: new Date(NOW).toISOString(),
    source: "shiplog-web",
    image_url: "/media/published-card.svg",
    image_alt: sent.image.alt,
    image_width: 32,
    image_height: 32,
  };
  const permalink = await loadPage(new URL("../src/post.html", import.meta.url), { location: { search } });
  t.after(() => permalink.restore());
  globalThis.fetch = async (url) => {
    if (String(url) === `/api/social-posts/${SAVED_ID}`) {
      return { ok: true, status: 200, json: async () => ({ post: row }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  await importPageModule("/post-page.js");
  await waitFor(
    () => permalink.document.documentElement.dataset.shiplogPostDetail === "ready",
    "the permalink the confirmation handed over settled",
  );

  const panel = permalink.document.querySelector("#post-detail");
  const shown = textOf(panel);
  assert.match(shown, /Ring landed on every control\./, "the post's own words");
  assert.match(shown, /Remy/, "the display name it was published under");
  const images = panel.querySelectorAll("img");
  assert.equal(images.length, 1, "the image it was published with");
  // Properties, not attributes: the harness reflects nothing a renderer assigns.
  assert.equal(images[0].src, "/media/published-card.svg");
  assert.match(images[0].alt, /A card wrapped in a blue focus ring/);
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
  assert.equal(document.activeElement?.closest(".post-card")?.dataset?.postId, SAVED_ID,
    "focus lands on the revealed post's native People link");
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
  // What happened, that nothing was lost, and what to do about it — the last of
  // which is the only instruction, and it is the button already on screen.
  assert.match(textOf(region), new RegExp(PUBLISH_FAILED_NOTE));
  assert.match(textOf(region), new RegExp(PUBLISH_RETRY_NOTE));
  const retry = region.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  assert.equal(textOf(retry), PUBLISH_RETRY_LABEL);
  assert.ok(tabSequence(harness.document).includes(retry), "the retry is keyboard reachable");
  assert.equal(harness.document.querySelector("#post-submit").disabled, false,
    "the original publish control is usable too");
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

test("a retry after a failure sends the same post again, without re-entering any of it", async (t) => {
  const harness = await composer(t, { hasImage: true, fail: "Posts API returned 503" });
  const description = "A card wrapped in a blue focus ring.";
  harness.fill({ body: "This one lands on the second try.", author: "Remy", description });

  await harness.publish();
  assert.equal(harness.requests.length, 1);

  // The page the reader is standing on has not changed: the composer is still
  // open, the preview is still on screen, and the button is live again. Nothing
  // to reopen, reselect, or retype before pressing it a second time.
  assert.equal(harness.document.querySelector("#post-compose-panel").hidden, false);
  assert.equal(harness.document.querySelector("#compose-media").hidden, false);
  assert.equal(harness.document.querySelector("#post-submit").disabled, false);

  harness.setFailure(null);
  notice(harness.document).querySelector(".feed-status-action").click();
  await harness.settle();

  assert.equal(harness.requests.length, 2, "the second press is a second request, not a queued repeat");
  const [first, second] = harness.requests;
  // Byte for byte the same post. The id differs because createPost mints one per
  // attempt; the three fields the reader typed do not.
  assert.equal(second.post.body, first.post.body);
  assert.equal(second.post.author, first.post.author);
  assert.equal(second.image?.data, first.image?.data, "the same encoded image, never reselected");
  assert.equal(second.image?.alt, description, "the same description, never retyped");

  const region = notice(harness.document);
  assert.equal(region.classList.contains("is-success"), true, "and the retry is confirmed like any publish");
  assert.match(textOf(region), /^Published “This one lands on the second try\.” as Remy\./);
  assert.equal(harness.document.querySelector("#post-body").value, "", "only now is the draft spent");
  assert.equal(harness.media, null);
});

test("while a publish is in flight the button carries the state alone, and a second submit cannot leave", async (t) => {
  const harness = await composer(t, { fail: "Posts API returned 503" });
  harness.fill({ body: "Only one of these is sent.", author: "Remy" });

  await harness.publish();
  assert.match(textOf(notice(harness.document)), new RegExp(PUBLISH_STATE_WORDS.failed));

  harness.setFailure(null);
  harness.hold(true);
  await harness.publish();
  assert.equal(harness.requests.length, 2, "the retry is on the wire");

  // Exactly one thing on the page describes the attempt. The failed outcome of
  // the previous press is gone rather than sitting under a request in flight,
  // which would state two contradictory states at once.
  const region = notice(harness.document);
  assert.equal(region.hidden, true);
  assert.equal(textOf(region), "");

  const submit = harness.document.querySelector("#post-submit");
  assert.match(textOf(submit), /Publishing…/, "the control names what it is doing");
  assert.doesNotMatch(textOf(submit), /Publish post/);
  assert.equal(submit.getAttribute("aria-busy"), "true");
  assert.equal(submit.disabled, true);

  // Two more ways to press Publish, neither of which reaches the API: the button
  // itself, and implicit submission from a single-line field, which in a browser
  // does not care that the button is disabled.
  submit.click();
  await harness.settle();
  await harness.submitFromField();
  assert.equal(harness.requests.length, 2, "one press, one request");

  await harness.releaseRequest();
  assert.equal(harness.requests.length, 2);
  assert.equal(notice(harness.document).classList.contains("is-success"), true);
  assert.equal(harness.published.length, 1, "and exactly one post was created");
  assert.equal(submit.disabled, false);
  assert.match(textOf(submit), /Publish a post/, "the control is back to naming what it will do");
  assert.equal(submit.getAttribute("aria-busy"), "false");
});

// Both outcomes are drawn with rules that already ship, so this reads the
// stylesheet rather than restating it: the pairings below are the ones the
// confirmation and the failure actually render, and each has to clear 4.5:1
// without a new colour being added to pay for it.
test("the confirmation and the failure clear 4.5:1 on colours already in the palette", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  const declared = (selector, property) => {
    const rule = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`));
    assert.ok(rule, `no rule for ${selector}`);
    const found = rule[1].match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(#[0-9a-f]{6})`, "i"));
    assert.ok(found, `${selector} declares no ${property}`);
    return found[1];
  };

  const channel = (pair) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => 0.2126 * channel(hex.slice(1, 3))
    + 0.7152 * channel(hex.slice(3, 5)) + 0.0722 * channel(hex.slice(5, 7));
  const ratio = (foreground, background) => {
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  };

  const pairings = [
    // The failure sentence, on the notice's own surface.
    ".notice",
    // The confirmation sentence, on the success surface.
    ".notice.is-success",
    // The two state chips: "Not published", and "Hidden by filters".
    ".detail-state-chip-error",
    ".detail-state-chip-missing",
  ];
  for (const selector of pairings) {
    const text = ratio(declared(selector, "color"), declared(selector, "background"));
    assert.ok(text >= 4.5, `${selector}: text ${text.toFixed(2)}:1 is under 4.5:1`);
  }

  // Links inside the confirmation inherit the sentence's colour rather than
  // introducing a second one, so the permalink and the People link are covered
  // by the pairing above.
  assert.match(css, /\.notice a \{[^}]*color:inherit/);
});

test("a long caption is shortened in the confirmation rather than repeated whole", () => {
  assert.equal(publishedPostLabel({ body: "  Short   one.  ", author: "Remy" }), "Published “Short one.” as Remy.");
  const long = "w".repeat(120);
  const label = publishedPostLabel({ body: long, author: "Remy" });
  assert.ok(label.length < long.length, "the caption is shortened");
  assert.match(label, /…” as Remy\.$/);
});
