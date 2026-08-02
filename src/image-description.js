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
