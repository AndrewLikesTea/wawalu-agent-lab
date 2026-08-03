// CORRECTING A DERIVED NAME OR FIGURE IN PLACE, ON THE LINE IT IS READ (#1026).
//
// #1025 put a marker on every figure in `#finops-first-run` that this page
// worked out rather than read, and #1024 gave the brief a sentence saying how
// much of it was derived. A reader who spots that a derived unit name or figure
// is WRONG still had nowhere to say so: the marker admits the value was
// inferred and then offers no way to replace it.
//
// So each inferred value gains one control beside it, and this module is the
// single place the corrected value lives. Every site that prints the value —
// the headline sentence, the slot it is tabulated in, the recommended action,
// the confidence sentence — composes its text from `effectiveValues()`, so a
// name that appears twice cannot change in one place and stay stale in the
// other. Nothing here hand-patches a second DOM node from a commit handler;
// there is one paint pass and it rewrites every declared site from the store.
//
// WHY THE VALUES ARE TOKENS AND NOT WHOLE SENTENCES. "Atlas Platform" is the
// datum; "Atlas Platform is a full band behind Boreal Support on cost per
// successful task." is one of the sentences it appears in. Making the sentence
// correctable would let a reader retype the claim as well as the name, and the
// claim is this page's, not theirs. Each site therefore declares how it composes
// its own sentence around the tokens, and a reader edits a token.
//
// TEXT ONLY, EVERYWHERE ON THIS PATH. Every value a reader types reaches the
// document through `textContent` or `input.value` and nothing else: no
// markup-assigning property, no adjacent-markup insertion, and no string of
// theirs concatenated into a tag — including the live-region message and the
// accessible name of the controls that echo it back. Angle brackets in a
// correction render as angle brackets. The test at the foot of
// tests/evolution-figure-sources.test.js greps this file for the property names
// that would break that, which is why none of them is written out here.
//
// NO NEW VISUAL SYSTEM. The applied state reuses `.brief-provenance`, the chip
// the imported brief and #1025's markers already ship, on the FILLED silhouette
// the page reserves for "this came from the reader rather than from us". #1025
// held that silhouette back because the bundled example can never hold a figure
// from a reader's FILE; a correction is the one way the reader's own datum does
// arrive in this region, which is exactly what the filled wash means. Derived
// stays outline, absent stays dashed, and the words say the whole thing on their
// own in all three states.
//
// No clock, no storage, no request. A correction lives for the life of the tab
// and is never persisted or sent anywhere.

import { FIGURE_SOURCE, PROVENANCE_MARKERS } from "./finops-brief-provenance.js";

/** Bump when a token, a site, a marker word, or the tally sentence changes. */
export const FIGURE_CORRECTION_VERSION = "finops-figure-corrections/1.0.0";

/** The region every site below is inside, and the sentence tallying the store. */
export const CORRECTION_REGION_ID = "finops-first-run";
export const CORRECTION_TALLY_ID = "finops-first-run-source-tally";
export const CORRECTION_LIVE_ID = "finops-first-run-live";

/**
 * The marker an applied correction wears, replacing the inferred one.
 *
 * The label is the whole meaning: greyscale, a stylesheet that failed to load,
 * and a screen reader all get "Corrected by you" and nothing depends on the
 * wash. The silhouette and tone are the shipped ones, read off the published
 * table rather than restated, so this cannot drift into a fourth treatment.
 */
export const CORRECTED_MARKER = Object.freeze({
  source: "corrected",
  label: "Corrected by you",
  silhouette: PROVENANCE_MARKERS[FIGURE_SOURCE.file].silhouette,
  tone: PROVENANCE_MARKERS[FIGURE_SOURCE.file].tone,
});

/** The visible words on the four controls. Never an icon on its own. */
export const CORRECTION_CONTROLS = Object.freeze({
  edit: "Correct",
  save: "Save",
  cancel: "Cancel",
  revert: "Revert",
});

/**
 * The longest correction accepted, in characters.
 *
 * A unit name and a money figure are both short. The cap exists so a paste
 * cannot turn one slot of the brief into a paragraph that pushes the answer off
 * the first screen; it is not a validation rule and nothing is rejected for
 * failing it — the value is trimmed to fit and applied.
 */
export const CORRECTION_MAX_LENGTH = 120;

/**
 * EVERY INFERRED VALUE A READER CAN CORRECT, and the marker it is corrected at.
 *
 * `noun` is what the control calls the value out loud — "Correct inferred unit
 * name: Atlas Platform" rather than a bare "Edit", so a screen-reader user who
 * lands on the seventh of these knows which figure it belongs to. `derived` is
 * what this page worked out, kept forever so a revert has something to go back
 * to, and `marker` is the #1025 disclosure the control is planted after.
 *
 * The share is corrected at the BENCHMARK marker, not at the headline's, because
 * the same 33% is printed in both places and two controls over one datum is two
 * places for a reader to wonder which one is authoritative.
 */
export const CORRECTABLE_FIGURES = Object.freeze([
  Object.freeze({
    id: "share",
    noun: "recoverable share",
    derived: "33%",
    marker: "finops-first-run-benchmark-source",
  }),
  Object.freeze({
    id: "ceiling",
    noun: "recoverable ceiling",
    derived: "$51,254",
    marker: "finops-first-run-impact-source",
  }),
  Object.freeze({
    id: "unit",
    noun: "unit name",
    derived: "Atlas Platform",
    marker: "finops-first-run-internal-source",
  }),
  Object.freeze({
    id: "peerRate",
    noun: "cost per successful task",
    derived: "$38.63",
    marker: "finops-first-run-peer-source",
  }),
  Object.freeze({
    id: "grade",
    noun: "literacy grade",
    derived: "B · 85 of 100",
    marker: "finops-first-run-literacy-source",
  }),
  Object.freeze({
    id: "role",
    noun: "accountable role",
    derived: "Platform Engineering Lead",
    marker: "finops-first-run-role-source",
  }),
  Object.freeze({
    id: "confidence",
    noun: "confidence score",
    derived: "0.85 of 1.00 · moderate",
    marker: "finops-first-run-confidence-source",
  }),
]);

/**
 * EVERY PLACE A TOKEN IS PRINTED, and how that place words itself.
 *
 * This is the list that makes one correction reach two sentences. `text` is a
 * pure function of the effective values, so no site can compose from a token
 * this module is not tracking, and the recommended action — which names the unit
 * AND the ceiling — stays correct when either one is corrected.
 */
export const CORRECTION_SITES = Object.freeze([
  Object.freeze({
    host: "finops-first-run-answer",
    text: (value) => `${value.share} of analyzed AI spend is recoverable`,
  }),
  Object.freeze({
    host: "finops-first-run-answer-detail",
    text: (value) => `Up to ${value.ceiling} estimated cost reduction in the month`
      + " — a synthetic scenario, not realized customer savings.",
  }),
  Object.freeze({
    host: "finops-first-run-benchmark-value",
    text: (value) => `${value.share} of analyzed AI spend`,
  }),
  Object.freeze({
    host: "finops-first-run-impact-value",
    text: (value) => `${value.ceiling} in the reporting period`,
  }),
  Object.freeze({
    host: "finops-first-run-peer-value",
    text: (value) => `Bottom quartile · ${value.peerRate} per successful task`,
  }),
  Object.freeze({
    host: "finops-first-run-internal-value",
    text: (value) => `${value.unit} is a full band behind Boreal Support on cost per successful task.`,
  }),
  Object.freeze({
    host: "finops-first-run-literacy-value",
    text: (value) => `${value.grade} · literacy-mix/1.0.0`,
  }),
  Object.freeze({
    host: "finops-first-run-action",
    text: (value) => `Pilot lower-cost routing in ${value.unit}, the top-spend`
      + ` invented department. Cap the pilot at ${value.ceiling}, then compare it`
      + " with a similar period.",
  }),
  Object.freeze({
    host: "finops-first-run-role",
    text: (value) => `Accountable role: ${value.role}`,
  }),
  Object.freeze({
    host: "finops-first-run-confidence-value",
    text: (value) => value.confidence,
  }),
]);

// ---------------------------------------------------------------------------
// The store. One record per correctable value, per document.

/**
 * The per-document store: the same shape the table above declares, plus the one
 * mutable field. `override` is `null` until a reader supplies a value, which is
 * what makes "derived or supplied" a question this module can answer rather than
 * a guess a renderer makes from the text on screen.
 */
const STORE = new WeakMap();

/**
 * What each site said before this module first overwrote it, per document.
 *
 * Captured rather than recomposed, for the reason `finops-first-run-view.js`
 * captures the example's copy: a revert has to leave the sentence exactly as the
 * analysis painted it, and rebuilding it here would put a composition path in a
 * module whose only job is to hold one corrected value.
 */
const WRITTEN = new WeakMap();

export function figureCorrectionStore(doc) {
  if (!STORE.has(doc)) {
    STORE.set(doc, CORRECTABLE_FIGURES.map((figure) => ({ ...figure, override: null })));
  }
  return STORE.get(doc);
}

/** THE one accessor. Every site, every marker, and the tally read through it. */
export const effectiveValue = (record) => record.override ?? record.derived;

/** The effective value of every token, keyed by id, for a site's own wording. */
export function effectiveValues(doc) {
  const values = {};
  for (const record of figureCorrectionStore(doc)) values[record.id] = effectiveValue(record);
  return values;
}

/** The records a reader has corrected, in the order the region publishes them. */
export const correctedFigures = (doc) =>
  figureCorrectionStore(doc).filter((record) => record.override !== null);

/**
 * A reader's string, made safe to be a value without being made into markup.
 *
 * Trimmed, collapsed to single spaces so a pasted line break cannot split a
 * sentence in half, and capped. Nothing is escaped and nothing is stripped:
 * angle brackets are legitimate characters in a name, and they stay in it —
 * what keeps them inert is that this value only ever reaches the document
 * through `textContent`.
 */
export function normalizeCorrection(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, CORRECTION_MAX_LENGTH);
}

/**
 * Apply a correction. An empty string is not a correction — it is a reader
 * changing their mind — so it reverts instead of blanking the brief.
 */
export function applyCorrection(doc, id, value) {
  const record = figureCorrectionStore(doc).find((entry) => entry.id === id);
  if (!record) return null;
  const next = normalizeCorrection(value);
  record.override = next === "" || next === record.derived ? null : next;
  return record;
}

/** Put the derived value back. One action, no confirm step. */
export function revertCorrection(doc, id) {
  const record = figureCorrectionStore(doc).find((entry) => entry.id === id);
  if (record) record.override = null;
  return record ?? null;
}

// ---------------------------------------------------------------------------
// The sentences.

/**
 * The confidence sentence, recomputed: how much of this brief is still ours.
 *
 * A reader's correction is SUPPLIED, not derived, so applying one moves that
 * value out of the derived count and into the supplied one, and reverting moves
 * it back. The corrected values are named, because a count with no names tells a
 * reader a number changed and not which.
 */
export function correctionTallyText(doc) {
  const records = figureCorrectionStore(doc);
  const corrected = records.filter((record) => record.override !== null);
  const total = records.length;
  if (corrected.length === 0) {
    return `Confidence in this brief: all ${total} correctable figures are still`
      + " as this page derived them, and none has been corrected by a reader.";
  }
  const names = corrected.map((record) => record.noun).join(", ");
  const supplied = corrected.length === 1 ? "is reader-supplied" : "are reader-supplied";
  return `Confidence in this brief: ${total - corrected.length} of the ${total}`
    + ` correctable figures are still as this page derived them; ${corrected.length}`
    + ` ${supplied} — ${names}.`;
}

/** What the live region says. The value is interpolated into TEXT, never markup. */
export function correctionAnnouncement(doc, record, { reverted = false } = {}) {
  const count = correctedFigures(doc).length;
  const tally = count === 0
    ? "No figures are reader-supplied."
    : `${count} of ${figureCorrectionStore(doc).length} figures now reader-supplied.`;
  const head = reverted
    ? `The ${record.noun} was restored to the derived value ${record.derived}.`
    : `The ${record.noun} was corrected to ${effectiveValue(record)}.`;
  return `${head} ${tally}`;
}

/** The control's accessible name: which value it edits, and what it says now. */
export const correctionControlName = (record) =>
  `Correct inferred ${record.noun}: ${effectiveValue(record)}`;

// ---------------------------------------------------------------------------
// Painting. Built in script rather than authored in evolution.html: a control
// that cannot work without script is not first-screen answer content, and
// shipping seven editors as static markup would spend the document's payload
// budget on forms nobody has opened. The VALUES they correct are authored, and
// the markers they hang off are authored, so a page whose script never ran still
// reads correctly — it just cannot be corrected.

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/** The ids are deterministic so focus can find its way back after a repaint. */
export const correctionControlId = (id) => `finops-correct-${id}`;
export const correctionTriggerId = (id) => `${correctionControlId(id)}-edit`;
export const correctionFieldId = (id) => `${correctionControlId(id)}-field`;

/** A button with a visible word and the rest of its name spoken but not drawn. */
function control(doc, className, id, word, spoken) {
  const button = doc.createElement("button");
  button.className = className;
  button.type = "button";
  if (id) button.id = id;
  const hidden = doc.createElement("span");
  hidden.className = "visually-hidden";
  hidden.textContent = ` ${spoken}`;
  button.replaceChildren(doc.createTextNode(word), hidden);
  return button;
}

/** The applied state's chip: the words first, the silhouette second. */
function correctedChip(doc, record) {
  const chip = doc.createElement("span");
  chip.className = "brief-provenance";
  chip.dataset.provenance = CORRECTED_MARKER.source;
  chip.dataset.silhouette = CORRECTED_MARKER.silhouette;
  chip.dataset.tone = CORRECTED_MARKER.tone;
  const scope = doc.createElement("span");
  scope.className = "visually-hidden";
  scope.textContent = `The ${record.noun}, ${effectiveValue(record)}: `;
  const label = doc.createElement("span");
  label.className = "brief-provenance-label";
  label.textContent = CORRECTED_MARKER.label;
  chip.replaceChildren(scope, label);
  return chip;
}

/**
 * Paint one control in its resting state: the marker if it has been corrected,
 * the revert if there is something to revert to, and the trigger that opens the
 * editor. The editor itself is only ever in the DOM while it is open — an input
 * a reader can tab into but not see is a tab stop with no purpose.
 */
function paintControl(doc, host, record) {
  host.dataset.state = record.override === null ? "derived" : "corrected";
  const parts = [];
  if (record.override !== null) {
    parts.push(correctedChip(doc, record));
    parts.push(control(doc, "figure-correction-revert", `${correctionControlId(record.id)}-revert`,
      CORRECTION_CONTROLS.revert,
      `the ${record.noun} to the derived value ${record.derived}`));
  }
  parts.push(control(doc, "figure-correction-edit", correctionTriggerId(record.id),
    CORRECTION_CONTROLS.edit, `inferred ${record.noun}: ${effectiveValue(record)}`));
  host.replaceChildren(...parts);
  return host;
}

/**
 * Swap the value for a field, seeded and focused.
 *
 * NOTHING COMMITS ON BLUR. A reader who tabs out mid-thought, or who reaches for
 * the Save button with a pointer, must not have a half-typed name written into
 * the brief behind them — so the only ways out are Enter, Save, Escape, and
 * Cancel, and all four put focus back on the trigger that opened this. Focus is
 * not trapped: Tab leaves, and the edit is simply still open when they come
 * back to it.
 */
function openEditor(doc, host, record, render) {
  host.dataset.state = "editing";
  const label = doc.createElement("label");
  label.className = "visually-hidden";
  label.setAttribute("for", correctionFieldId(record.id));
  label.textContent = `Corrected ${record.noun}`;
  const field = doc.createElement("input");
  field.className = "figure-correction-field";
  field.id = correctionFieldId(record.id);
  field.setAttribute("type", "text");
  field.setAttribute("maxlength", String(CORRECTION_MAX_LENGTH));
  field.setAttribute("autocomplete", "off");
  field.value = effectiveValue(record);

  const close = ({ commit }) => {
    if (commit) applyCorrection(doc, record.id, field.value);
    render(doc, { announce: commit ? record.id : null });
    byId(doc, correctionTriggerId(record.id))?.focus?.();
  };
  const save = control(doc, "figure-correction-save", `${correctionControlId(record.id)}-save`,
    CORRECTION_CONTROLS.save, `the corrected ${record.noun}`);
  save.addEventListener("click", () => close({ commit: true }));
  const cancel = control(doc, "figure-correction-cancel", `${correctionControlId(record.id)}-cancel`,
    CORRECTION_CONTROLS.cancel, `correcting the ${record.noun}`);
  cancel.addEventListener("click", () => close({ commit: false }));
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    // Enter would otherwise submit whatever form this region ends up inside, and
    // Escape would otherwise reach a dialog above us. Both belong to the editor.
    event.preventDefault();
    close({ commit: event.key === "Enter" });
  });

  host.replaceChildren(label, field, save, cancel);
  field.focus?.();
  return field;
}

/** Is the region still speaking for the bundled example? */
function showingExample(doc) {
  const state = byId(doc, CORRECTION_REGION_ID)?.dataset?.superseded;
  return !state || state === "false";
}

/**
 * THE ONE PAINT PASS.
 *
 * Every site, the tally sentence, and every control are written from the store
 * on every change. That is what makes the second place a name appears impossible
 * to forget: there is no per-site commit path to forget it in.
 *
 * It writes nothing once the reader's own export has superseded the example —
 * the figures on screen are then theirs, not this page's, and a correction to a
 * derived example value has no meaning over them. The controls are hidden in
 * that state rather than removed, so clearing the import brings them back with
 * the corrections intact.
 */
export function renderFigureCorrections(doc, { announce = null } = {}) {
  const live = showingExample(doc);
  const tally = byId(doc, CORRECTION_TALLY_ID);
  // The tally speaks for the example's figures, so it is withheld with them.
  if (tally) tally.hidden = !live;
  for (const record of figureCorrectionStore(doc)) {
    const host = byId(doc, correctionControlId(record.id));
    if (host) host.hidden = !live;
  }
  if (!live) return null;

  const values = effectiveValues(doc);
  const derived = {};
  for (const record of figureCorrectionStore(doc)) derived[record.id] = record.derived;
  const written = WRITTEN.get(doc) ?? WRITTEN.set(doc, new Map()).get(doc);
  for (const site of CORRECTION_SITES) {
    const node = byId(doc, site.host);
    if (!node) continue;
    const next = site.text(values);
    // A SITE IS ONLY TOUCHED IF A TOKEN IT PRINTS HAS ACTUALLY BEEN CORRECTED.
    // The analysis owns these sentences in every other state — a withheld peer
    // position, an unavailable slot, a reader's own hostile export — and a paint
    // pass that rewrote them from this table would put the example's figures
    // back over results that are not the example's. So the pass compares the
    // effective wording against the derived wording and leaves the node alone
    // when they agree, keeping whatever the analysis painted.
    if (next === site.text(derived)) {
      // Nothing of this reader's is in it any more: put back exactly the text
      // that was there before this module first overwrote it, rather than the
      // sentence this table would compose.
      if (written.has(site.host)) {
        node.textContent = written.get(site.host);
        written.delete(site.host);
      }
      continue;
    }
    if (!written.has(site.host)) written.set(site.host, node.textContent ?? "");
    // `textContent`, always. This is the line a reader's own string lands on.
    node.textContent = next;
  }
  if (tally) tally.textContent = correctionTallyText(doc);

  for (const record of figureCorrectionStore(doc)) {
    const host = byId(doc, correctionControlId(record.id));
    if (host) paintControl(doc, host, record);
  }

  if (announce) {
    const record = figureCorrectionStore(doc).find((entry) => entry.id === announce);
    const region = byId(doc, CORRECTION_LIVE_ID);
    // The live region is a top-level sibling of the brief, authored unhidden and
    // never inside a `details` — text injected into a shut disclosure is read by
    // a text harness and by no real screen reader.
    if (record && region) {
      region.textContent = correctionAnnouncement(doc, record,
        { reverted: record.override === null });
    }
  }
  return figureCorrectionStore(doc);
}

/**
 * Plant one control after each marker, once, and paint the region from the store.
 *
 * The control is a SIBLING of the `details` rather than a child of its summary:
 * a button inside a summary is an interactive control inside an interactive
 * control, which no browser resolves the same way twice.
 */
export function bindFigureCorrections(doc) {
  const planted = [];
  for (const record of figureCorrectionStore(doc)) {
    const marker = byId(doc, record.marker);
    if (!marker?.parentNode) continue;
    let host = byId(doc, correctionControlId(record.id));
    if (!host) {
      host = doc.createElement("p");
      host.className = "figure-correction";
      host.id = correctionControlId(record.id);
      host.dataset.state = "derived";
      // Immediately after the marker, in its own container. `children` is read
      // through `Array.from` because it is a live collection in a browser and a
      // plain array in the test harness, and only one of the two has `indexOf`.
      const siblings = Array.from(marker.parentNode.children ?? []);
      marker.parentNode.insertBefore(host, siblings[siblings.indexOf(marker) + 1] ?? null);
      // One delegated listener per control, bound where the control is created,
      // so a second bind pass cannot double-fire a commit.
      host.addEventListener("click", (event) => {
        const trigger = event.target?.closest?.("button");
        if (!trigger) return;
        if (trigger.classList.contains("figure-correction-edit")) {
          openEditor(doc, host, record, renderFigureCorrections);
        } else if (trigger.classList.contains("figure-correction-revert")) {
          revertCorrection(doc, record.id);
          renderFigureCorrections(doc, { announce: record.id });
          byId(doc, correctionTriggerId(record.id))?.focus?.();
        }
      });
    }
    planted.push(host);
  }
  renderFigureCorrections(doc);
  return planted;
}
