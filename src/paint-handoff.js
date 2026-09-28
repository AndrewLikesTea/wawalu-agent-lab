// One vocabulary for the route out of Paint and into a Social post.
//
// Paint is a local editor: it writes a file to the device or leaves the image in
// this browser's storage for the composer, and it uploads nothing. Two surfaces have to agree
// about that — the card Paint shows when the work is ready, and the panel
// Social shows when the visitor arrives — so the promise made at the departure
// is the promise kept at the destination. Both read the same copy from here,
// and the link between them carries the kind in the query string rather than in
// a store, so a reload, a new tab, or a bookmark still explains itself.
//
// "exported" is the file the browser downloaded; nothing is attached at the
// destination and the visitor picks the file. "prepared" is the image handed to
// the composer by src/publishing-media.js; it is attached to the draft, and
// still nothing has been uploaded or posted.

export const SOCIAL_COMPOSER_PATH = "/social.html";
// The other end of the same route, for the composer's way back when a transfer
// could not be read. Same value the nav and the footer link Paint by.
export const PAINT_EDITOR_PATH = "/paint/";
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
    arrivalStep: "Select “Choose image” below and pick that file.",
  }),
  prepared: Object.freeze({
    kind: "prepared",
    chip: "Image transferred",
    title: "The drawing is ready to attach",
    detail: "Paint uploaded and posted nothing. Open Social to check the preview, describe it, and publish it yourself.",
    action: "Open the post preview on Social",
    arrivalTitle: "Your drawing is attached to this draft only",
    arrivalDetail: "Paint handed the drawing to the composer as a preview. It has not been uploaded or published.",
    arrivalStep: "Describe the image, then publish the post to share it.",
  }),
});

// #2604. The three sentences the arrival itself draws, kept here with the rest
// of the route's vocabulary because each of them is said in two places and the
// two must not drift apart.
//
// The line rendered beside the preview, inside the media region, on a prepared
// arrival. It is two sentences and they are kept as two constants, because only
// one of them can be said in advance.
//
// The first names the origin in plain words. That is the half the composer's own
// description of the Paint route quotes byte for byte (#post-image-return in
// src/social.html), so the promise a reader is given before they leave is the
// sentence they meet on their return.
//
// The second names the one step left. It cannot be quoted in that promise: per
// #2294 nothing reachable in the composer may name the image description field
// before there is an image it applies to, which is exactly the pre-warning that
// issue removed — so this half is said at the arrival, where the field is on
// screen and the rule has started to bind, and the promise says only that it
// will be said there. Held instead against the code that enforces it: the claim
// is src/social.js's, where imageDescriptionProblem refuses a blank description
// whenever an image is attached and the submit guard calls it with exactly that
// condition, so the sentence is true of the publish path and not only of the
// copy. tests/paint-social-arrival-state.test.js publishes an undescribed
// arrival to prove it.
//
// Neither half is written into #post-media-status: that region is a live one,
// the arrival panel above the form is already announcing this transfer, and a
// single handoff announced twice is how a live region stops being worth
// listening to.
export const PAINT_ARRIVAL_ORIGIN_LINE = "This image came from Paint.";
export const PAINT_ARRIVAL_REQUIRED_STEP =
  "Add the image description below — it is the last required step before you can publish.";
export const PAINT_ARRIVAL_PREVIEW_LINE = `${PAINT_ARRIVAL_ORIGIN_LINE} ${PAINT_ARRIVAL_REQUIRED_STEP}`;

// The two ways on from a transfer that did not arrive, said in the refusal slot
// the picker's own news goes to. Exactly two, named in the words of the controls
// that take them: the picker's label, and the route back that follows this
// sentence as a link. An arrival that cannot show an image must never be an
// empty frame with no account of itself.
export const PAINT_ARRIVAL_ROUTES =
  "Two ways on: select “Choose image” to use a file already on this device, or go back to Paint and send it again.";

// Said only on an arrival, and only when this tab's post field is genuinely
// empty. Paint opens beside the Social tab a visitor was writing in, and a draft
// is held in one tab's memory on purpose (src/publishing-media.js), so a visitor
// who typed their post next door lands on an empty form with text that is not
// lost — merely elsewhere. On every other composer open this would be a remark
// about nothing, so nothing says it there.
export const PAINT_ARRIVAL_NO_DRAFT =
  "This tab holds no post text yet — a draft you typed in another Social tab stays in that tab.";

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
// `note` is the no-draft sentence, appended last because it is about the tab the
// visitor landed in rather than about the image: it follows the next step instead
// of interrupting it. It reuses the detail paragraph's own class so it costs no
// new rule in styles.css, and carries a second, unstyled class purely as a hook.
export function renderPaintArrival(panel, intent, { note = "" } = {}) {
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
  if (note) panel.append(element("p", "paint-arrival-detail paint-arrival-note", note));
  return panel;
}
