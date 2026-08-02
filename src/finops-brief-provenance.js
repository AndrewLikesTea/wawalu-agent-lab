// One provenance marker for every region of the imported brief (#981).
//
// THE PROBLEM THIS SOLVES. Four regions on /evolution.html now paint a reader's
// own import — the headline contract, the period-over-period movement, the
// completeness score, and the ranked cohort position — and each said where its
// figures came from in its own way. The headline had a sentence per row, the
// completeness rows had the words "Earned" and "Fell back", the movement block
// said nothing at all, and the cohort position carried a `sourceLabel` buried at
// the end of a run-on detail line. A reader scanning their own brief could not
// answer the question the whole surface rests on: which of these numbers came
// out of the file I uploaded, which did I type in myself, and which is the
// product telling me it has nothing?
//
// So there is ONE marker with THREE states, and every region paints it:
//
//   file      the figure was computed from the export this reader brought
//   reader    the reader supplied the fact in this tab, because no column had it
//   fallback  neither — the region is stating an absence, not a figure
//
// COLOUR IS NEVER THE CARRIER. Each state pairs its colour role with
//
//   WORDS      "From your file" · "You entered this" · "Not in your file",
//              each one the whole meaning on its own, and
//   SILHOUETTE filled wash · solid outline · DASHED outline,
//
// so the three stay apart in grayscale, in a printout, and to a reader who sees
// no colour. The silhouettes follow the Claude Design foundations card ("Chip
// inventory — filled wash = dynamic signal, outline = static classification"):
// a figure read out of the file in front of you is the live signal and takes the
// wash; a fact declared once and an absence are classifications and take
// outlines, told apart by the dashed edge this page already uses for a slot that
// fell back. Only the file state carries a mark, and it is ◆ — the glyph
// `evolution.css` already publishes for "computed from the file this reader
// brought". No new glyph, no new hue, no new size is introduced here.
//
// THE LABEL REACHES ASSISTIVE TECH WITH THE THING IT QUALIFIES. "From your file"
// read on its own, three stops after the number it belongs to, is noise. Every
// marker therefore carries a visually hidden scope — the label of the figure it
// qualifies — ahead of its words, so the marker is spoken as
// "Recoverable spend: from your file" wherever a screen reader lands on it.
//
// It builds nodes and nothing else: no clock, no storage, no request, and no
// decision about which state a figure is in. That belongs to the module that
// knows the figure.

/** The three states. There is no fourth, and "unknown" is not one of them. */
export const FIGURE_SOURCE = Object.freeze({
  file: "file",
  reader: "reader",
  fallback: "fallback",
});

/**
 * The marker table. `silhouette` is the non-colour carrier a test holds and the
 * stylesheet keys off; `tone` names the palette role, and it is the last carrier
 * rather than the first.
 */
export const PROVENANCE_MARKERS = Object.freeze({
  [FIGURE_SOURCE.file]: Object.freeze({
    source: FIGURE_SOURCE.file,
    label: "From your file",
    shape: "◆",
    silhouette: "filled",
    tone: "import",
  }),
  [FIGURE_SOURCE.reader]: Object.freeze({
    source: FIGURE_SOURCE.reader,
    label: "You entered this",
    shape: "",
    silhouette: "outline",
    tone: "neutral",
  }),
  [FIGURE_SOURCE.fallback]: Object.freeze({
    source: FIGURE_SOURCE.fallback,
    label: "Not in your file",
    shape: "",
    silhouette: "dashed",
    tone: "warn",
  }),
});

/** The marker for one state. An unknown state reads as the absence, never as a
 *  figure: labelling something "from your file" on a guess is the one error this
 *  marker cannot be allowed to make. */
export const provenanceMarker = (source) =>
  PROVENANCE_MARKERS[source] ?? PROVENANCE_MARKERS[FIGURE_SOURCE.fallback];

/** A supported/unsupported slot, as a source. */
export const sourceOfSupported = (supported) =>
  (supported ? FIGURE_SOURCE.file : FIGURE_SOURCE.fallback);

/**
 * What assistive technology reads for one marker: the figure it qualifies, then
 * the state, then the region's own words for the derivation when it has any.
 */
export function provenanceText(source, { qualifies = "", detail = "" } = {}) {
  const marker = provenanceMarker(source);
  const scope = String(qualifies ?? "").trim();
  const extra = String(detail ?? "").trim();
  return [scope ? `${scope}:` : "", marker.label, extra ? `· ${extra}` : ""]
    .filter(Boolean).join(" ");
}

/**
 * Paint one marker.
 *
 * The mark is `aria-hidden` decoration in its own element, so deleting it from
 * the DOM loses nothing and a screen reader never reads a diamond. The scope is
 * visually hidden rather than dropped, because a sighted reader already has the
 * label two lines up and a screen-reader user landing on the marker does not.
 *
 * @param qualifies the visible label of the figure this marker belongs to.
 * @param detail the region's own words for the derivation, when it has them.
 */
export function renderProvenance(doc, source, { qualifies = "", detail = "" } = {}) {
  const marker = provenanceMarker(source);
  const root = doc.createElement("span");
  root.className = "brief-provenance";
  root.dataset.provenance = marker.source;
  root.dataset.silhouette = marker.silhouette;
  root.dataset.tone = marker.tone;
  const parts = [];
  if (marker.shape) {
    const shape = doc.createElement("span");
    shape.className = "brief-provenance-shape";
    shape.setAttribute("aria-hidden", "true");
    shape.textContent = marker.shape;
    parts.push(shape);
  }
  const scope = String(qualifies ?? "").trim();
  if (scope) {
    const named = doc.createElement("span");
    named.className = "visually-hidden";
    named.textContent = `${scope}: `;
    parts.push(named);
  }
  const label = doc.createElement("span");
  label.className = "brief-provenance-label";
  label.textContent = marker.label;
  parts.push(label);
  const extra = String(detail ?? "").trim();
  if (extra) {
    const note = doc.createElement("span");
    note.className = "brief-provenance-detail";
    note.textContent = extra;
    parts.push(note);
  }
  root.replaceChildren(...parts);
  return root;
}

/**
 * Put one marker on a region that has no authored slot for it, once.
 *
 * The line is created on the first paint and REUSED on every later one, in the
 * position it was created in — so a repaint cannot leave two markers behind it,
 * and cannot move a region's provenance to a different place in the reading
 * order than the one it was designed into. `before` is the node it must sit
 * above; without one it lands at the end of the region.
 */
export function mountProvenance(doc, { region, id, source, before = null,
  qualifies = "", detail = "" } = {}) {
  if (!region || !id) return null;
  let host = doc.getElementById?.(id) ?? null;
  if (!host) {
    host = doc.createElement("p");
    host.id = id;
    host.className = "brief-provenance-line";
    if (before) region.insertBefore(host, before);
    else region.append(host);
  }
  host.replaceChildren(renderProvenance(doc, source, { qualifies, detail }));
  return host;
}
