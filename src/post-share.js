// The one address a post is handed over by, and the one control that hands it
// over.
//
// Both halves lived on /post.html (src/post-detail.js) until the publish
// confirmation on Social needed them too — and Social's feed module cannot
// import the detail page's, because src/post-detail.js already imports
// src/social.js. So they moved down here, beside the URL shapes in
// src/social-links.js that they are built out of, where both surfaces can reach
// them without a cycle. src/post-detail.js re-exports what it used to own, so
// every existing caller and every existing assertion is unchanged.
//
// One owner is the whole point: the link the composer's receipt offers and the
// link /post.html copies are the same address for the same post, built once. Two
// implementations of "the public URL of a post" would be two answers a reader
// could paste into the same chat window.

import { postDetailHref } from "./social-links.js";
import { copyRecordUrl } from "./share-link.js";

// What the control is called wherever it appears. It names the thing copied
// rather than the surface it is on, so the receipt on Social and the permalink
// page say the same words for the same act.
export const POST_COPY_LABEL = "Copy link to this post";

// What it says afterwards. The failure line used to send the reader to the
// address bar, which was never this post's link: on Social it holds the feed's
// address, and on /post.html it can carry ?author= and ?from=. So a refusal now
// draws the link itself in a read-only field, the manual-copy fallback the
// homepage's evaluation brief ships (src/shiplog-evaluation-brief.js), with the
// brief's own instruction.
export const POST_COPIED_STATUS = "Link copied.";
export const POST_COPY_FAILED_STATUS = "Could not copy the link. Select the text and use your device’s copy command.";
export const POST_MANUAL_COPY_LABEL = "Link to this post for manual copying";

// The address the button hands over, built rather than read back off the address
// bar. postDetailHref is the one URL shape /post.html reads its post out of
// (src/social-links.js) and it puts the id through URLSearchParams, so an id that
// arrived over the wire is encoded rather than concatenated: it cannot open a
// second parameter, a fragment, or a scheme of its own. What comes out is the
// canonical link to this one post — no ?author=, no ?from=, because those are how
// one reader got here and not part of the post.
//
// No id or no origin, no link: a URL that cannot be resolved absolutely is no use
// pasted into a chat window, so callers withdraw the control rather than hand
// over something broken. That is the same rule the deployment record's copy
// button follows in src/deployed-release-view.js.
// An id is a string here or it is nothing. Every normalizer that puts a post in
// front of a reader — normalizeApiPosts, normalizeProfileApiPosts,
// normalizeSeedPosts — drops a record whose id is not a non-empty string, so a
// value of any other type is a record this site would not have rendered, and
// coercing it into an address would invent a permalink for a post that has none.
export function postPermalink(id, origin) {
  const wanted = typeof id === "string" ? id.trim() : "";
  if (!wanted) return "";
  try {
    return new URL(postDetailHref(wanted), origin).href;
  } catch {
    return "";
  }
}

// A real <button>, so it is in the natural tab order and takes the site's own
// focus ring with no extra rule — and so the clipboard is written under an
// explicit activation. Nothing here touches the clipboard on render.
//
// `id` is the caller's, because two surfaces now draw this control and an id is
// only unique within a document. `tag` is the caller's for the same kind of
// reason: .share-control is `display:flex` in the stylesheet either way, and the
// receipt on Social lives inside a <p>, where a <div> would be markup a browser
// would never have parsed.
//
// The fallback field goes beside the flex row rather than in it, so it takes a
// line of its own with no new rule; an outer element of the same tag holds both.
// It exists only after a refusal, and one success removes it again — so the
// states with nothing to copy by hand carry no hidden copy of the link either.
export function renderPostCopyControl(url, { clipboard, id = "post-copy", tag = "div" } = {}) {
  const control = document.createElement(tag);
  const group = document.createElement(tag);
  group.className = "share-control";
  const button = document.createElement("button");
  button.className = "share-button";
  button.type = "button";
  button.id = id;
  button.textContent = POST_COPY_LABEL;
  const status = document.createElement("span");
  status.className = "share-status";
  status.id = `${id}-status`;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  button.setAttribute("aria-describedby", status.id);
  let manual = null;
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "";
    // Read at press time, not at render time: a page entry can render before a
    // browser has a clipboard to offer, and a test injects one either way.
    const copied = await copyRecordUrl(clipboard ?? globalThis.navigator?.clipboard, url);
    button.disabled = false;
    if (copied) {
      manual?.remove();
      manual = null;
      status.textContent = POST_COPIED_STATUS;
      return;
    }
    if (!manual) {
      manual = renderManualCopy(url, `${id}-manual`, tag, status.id);
      control.append(manual);
    }
    status.textContent = POST_COPY_FAILED_STATUS;
    const field = manual.querySelector("input");
    field.focus();
    field.select();
  });
  group.append(button, status);
  control.append(group);
  return control;
}

// The brief's fallback, sized for one line: a visible label, the link as the
// field's value, and the status line as its description, so a screen reader that
// lands on the field hears what to do with it. Both surfaces put this inside an
// atomic live region (#post-detail, Social's receipt); `off` keeps the field
// appearing from re-reading the whole post when the status line already spoke.
function renderManualCopy(url, fieldId, tag, describedBy) {
  const box = document.createElement(tag);
  box.setAttribute("aria-live", "off");
  const label = document.createElement("label");
  label.setAttribute("for", fieldId);
  label.textContent = POST_MANUAL_COPY_LABEL;
  const field = document.createElement("input");
  field.type = "text";
  field.id = fieldId;
  field.value = url;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-describedby", describedBy);
  box.append(label, field);
  return box;
}
