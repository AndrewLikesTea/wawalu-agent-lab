// The read-path guarantee that every posted image is described.
//
// Writing a description is required in two places now: the composer refuses to
// publish an image without one (src/social.js), and the API refuses an upload
// without one (validateMediaUpload in src/social-media.js). Rows written before
// that requirement existed carry no description, and nothing here backfills
// them — this is a read-path fallback only, so a stored row is left exactly as
// it was found.
//
// One helper, imported by both surfaces that render a post's image — the Social
// feed (src/social.js) and a People profile (src/profile.js) — so the two
// cannot drift into describing the same undescribed post differently.
//
// The read-time failure placeholder below is imported by those two and by the
// permalink (src/post-detail.js), for the same reason.

export const MISSING_DESCRIPTION_NOTE = "No description provided";

// A described image announces itself. An undescribed one says who posted it and
// that the description is missing, which is the honest thing left to say: alt=""
// would drop the image out of the accessibility tree as if it were decoration,
// and a storage path is not a description of anything.
export function imageDescription(post) {
  const alt = typeof post?.image?.alt === "string" ? post.image.alt.trim() : "";
  if (alt) return { alt, missing: false };
  const author = typeof post?.author === "string" ? post.author.trim() : "";
  return {
    alt: author
      ? `Image posted by ${author}. ${MISSING_DESCRIPTION_NOTE}.`
      : `Posted image. ${MISSING_DESCRIPTION_NOTE}.`,
    missing: true,
  };
}

// The visible half of the same fallback, so a sighted reader is told what a
// screen reader is told. Both surfaces put it in the post's caption area.
export function renderDescriptionNote() {
  const note = document.createElement("p");
  note.className = "description-note";
  note.textContent = MISSING_DESCRIPTION_NOTE;
  return note;
}

// ---------------------------------------------------------------------------
// The read-time failure placeholder.
//
// NOT the composer's preview failure. That one (#compose-preview-error in
// src/social.html) is *pre-publish*: the file is in the reader's own hand, the
// preview did not draw, and the honest instruction is "upload the file again
// and check the preview before publishing". This is its read-time sibling — the
// post is published, someone else is reading it, and the image will not load
// for them. Nothing here can be re-uploaded, so this state offers no action; it
// states the classification and hands over the one thing that still describes
// what was there, which is the description the poster was required to write.
//
// THE MARKER IS AN OUTLINE CHIP, NOT A FILLED ONE.
// design-system/claude-design/review-08-foundations.html splits one chip
// silhouette into two jobs: a filled wash means a dynamic signal (a delta, a
// live state), an outline means a static classification. "This post's image did
// not load" is a standing fact about the post, not a live reading of anything,
// so it takes the outline — the same distinction the resolved-lookup chips on
// the permalink make by being filled.
//
// COLOUR CARRIES NONE OF THE MEANING. Three things say "unavailable" here and
// only one of them is hue: the literal words in the chip, the outline drawn
// around them (`currentColor`, so it can never fall out of contrast with its
// own text), and the frame's own inset border from
// `[data-state="error"]`. With the stylesheet stripped, the words remain.
//
// NOTHING HERE IS FOCUSABLE. A span and a paragraph — no link, no button, no
// tabindex — so a card has exactly the same number of tab stops whether its
// image loaded or failed.
export const IMAGE_UNAVAILABLE_LABEL = "Image unavailable";

// `className` is the surface's own frame-fallback class, because the three
// frames are different shapes (a 4:3 feed tile, a square People tile, a
// full-width detail panel) and each already owns its padding and type. What is
// shared is the structure: the label chip first, then the description as real
// on-screen text — never an alt attribute alone, which is exactly the text a
// sighted reader of a broken image cannot get at.
//
// `textClassName` is how the two tile surfaces ask for the shared clamp: a tile
// is a fixed box and a long description must not spill out of it. The permalink
// passes nothing, because there the description is the content of the panel and
// clamping it would hide the only thing left. `chipId` is for a caller that
// needs to point aria-labelledby at the label.
export function renderImageUnavailable(className, descriptionText, { textClassName, chipId } = {}) {
  const box = document.createElement("div");
  box.className = className;

  const chip = document.createElement("span");
  chip.className = "detail-state-chip";
  chip.textContent = IMAGE_UNAVAILABLE_LABEL;
  if (chipId) chip.id = chipId;

  const description = document.createElement("p");
  if (textClassName) description.className = textClassName;
  description.textContent = descriptionText;

  box.append(chip, description);
  return box;
}
