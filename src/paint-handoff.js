// One vocabulary for the route out of Paint and into a Social post.
//
// Paint is a local editor: it writes a file to the device or a preview into
// this tab's sessionStorage, and it uploads nothing. Two surfaces have to agree
// about that — the card Paint shows when the work is ready, and the panel
// Social shows when the visitor arrives — so the promise made at the departure
// is the promise kept at the destination. Both read the same copy from here,
// and the link between them carries the kind in the query string rather than in
// a store, so a reload, a new tab, or a bookmark still explains itself.
//
// "exported" is the file the browser downloaded; nothing is attached at the
// destination and the visitor picks the file. "prepared" is the in-tab preview
// handed to the composer by src/publishing-media.js; it is attached to the
// draft, and still nothing has been uploaded or posted.

export const SOCIAL_COMPOSER_PATH = "/social.html";
export const EXPORT_FILE_NAME = "paint-export.png";

export const PAINT_HANDOFF_COPY = Object.freeze({
  exported: Object.freeze({
    kind: "exported",
    chip: "Saved to this device",
    title: "The PNG is on your device, not on Social",
    detail: `Paint uploaded nothing. Open Social to write a post, then attach ${EXPORT_FILE_NAME} yourself.`,
    action: "Add it to a post on Social",
    arrivalTitle: "Attach the PNG you exported",
    arrivalDetail: `Paint saved ${EXPORT_FILE_NAME} to this device and uploaded nothing. Nothing is attached to this post yet.`,
    arrivalStep: "Choose “Upload image” below and pick that file.",
  }),
  prepared: Object.freeze({
    kind: "prepared",
    chip: "Ready for a post",
    title: "The drawing is ready to attach",
    detail: "Paint uploaded and posted nothing. Open Social to check the preview, describe it, and publish it yourself.",
    action: "Open the post preview on Social",
    arrivalTitle: "Your drawing is attached to this draft only",
    arrivalDetail: "Paint handed the drawing to this form as a preview. It has not been uploaded or published.",
    arrivalStep: "Describe the image, then publish the post to share it.",
  }),
});

export function paintHandoffCopy(kind) {
  return PAINT_HANDOFF_COPY[kind] ?? PAINT_HANDOFF_COPY.exported;
}

// Same-origin, relative, and fully determined by the kind: a hostile value on
// the way in cannot become a destination on the way out.
export function paintHandoffHref(kind) {
  return `${SOCIAL_COMPOSER_PATH}?from=paint&image=${paintHandoffCopy(kind).kind}#post-form`;
}

export function paintHandoffIntent(search = "") {
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  if (params.get("from") !== "paint") return null;
  const kind = params.get("image");
  return Object.hasOwn(PAINT_HANDOFF_COPY, kind) ? PAINT_HANDOFF_COPY[kind] : null;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The destination panel. Every string is assigned through textContent, and the
// shape — a marked chip, a heading, the "nothing was uploaded" sentence, and
// the one next step — is the same for both kinds so the difference between them
// is the words, not the layout.
export function renderPaintArrival(panel, intent) {
  if (!panel) return null;
  if (!intent) {
    panel.hidden = true;
    panel.replaceChildren();
    delete panel.dataset.handoff;
    return null;
  }

  const shape = element("span", "paint-arrival-shape");
  shape.setAttribute("aria-hidden", "true");
  const chip = element("p", "paint-arrival-chip");
  chip.append(shape, element("span", "", `From Paint · ${intent.chip}`));

  const next = element("p", "paint-arrival-next");
  next.append(element("span", "paint-arrival-step", "Next"), element("span", "", intent.arrivalStep));

  panel.dataset.handoff = intent.kind;
  panel.hidden = false;
  panel.replaceChildren(
    chip,
    element("h3", "paint-arrival-title", intent.arrivalTitle),
    element("p", "paint-arrival-detail", intent.arrivalDetail),
    next,
  );
  return panel;
}
