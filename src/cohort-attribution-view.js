// Where the cohort attribution decision becomes something a reader sees.
//
// It takes the document rather than reading a global, like every other view
// module on this page, so a test drives the shipped markup of evolution.html
// instead of a fixture authored for the test. Every node is built with
// createElement and textContent — no markup string, no innerHTML.
//
// The panel has exactly two states and both of them are sentences: a position
// with the cohort it is against, or a withheld position with the reason and the
// one next step that would resolve it. There is no third state where the panel
// is present and says nothing, and no state where a position appears without
// the note stating what was read to produce it.

// THE DECLARATION CONTROL (#978) is the one interactive thing in this panel,
// and it appears only where the imported export could not supply a cohort
// attribute. Its options are rendered from the cohort model's own enumeration
// rather than authored in the markup, so the list a reader is offered is the
// list the model accepts by construction rather than by review.

import {
  COHORT_ATTRIBUTE_SOURCE, COHORT_DECLARATION_CHOICES, COHORT_PROVENANCE_LABEL,
  COHORT_PROVENANCE_STATEMENT,
} from "./cohort-attribution.js";

const IDS = Object.freeze({
  panel: "local-cohort-position",
  state: "local-cohort-state",
  headline: "local-cohort-headline",
  detail: "local-cohort-detail",
  next: "local-cohort-next",
  note: "local-cohort-note",
  declare: "local-cohort-declare",
  declareStatus: "local-cohort-declare-status",
});

/** One declared attribute: the field wrapper that hides, and the select in it. */
const DECLARE_FIELDS = Object.freeze({
  orgSizeBand: Object.freeze({
    field: "local-cohort-declare-band-field", select: "local-cohort-declare-band",
  }),
  industry: Object.freeze({
    field: "local-cohort-declare-industry-field", select: "local-cohort-declare-industry",
  }),
});

/** The placeholder is the ABSENCE of a declaration, never one of the values. */
export const COHORT_DECLARE_PLACEHOLDER = "Not declared";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

const setText = (doc, id, value) => {
  const node = byId(doc, id);
  if (node) node.textContent = value;
  return node;
};

/**
 * Fill the two declaration selects from the cohort model's own enumeration.
 *
 * Called once, at bind time. Every option is built with createElement and
 * textContent; the value is the published key and the visible label is the
 * band's or industry's own label, so nothing here restates a list.
 *
 * @returns the values offered per attribute, for a caller that wants to assert
 *   the offered list against the enumeration.
 */
export function renderCohortDeclarationChoices(doc) {
  const offered = {};
  for (const [attribute, ids] of Object.entries(DECLARE_FIELDS)) {
    const select = byId(doc, ids.select);
    if (!select) continue;
    select.textContent = "";
    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = COHORT_DECLARE_PLACEHOLDER;
    select.append(placeholder);
    offered[attribute] = COHORT_DECLARATION_CHOICES[attribute].map((choice) => {
      const option = doc.createElement("option");
      option.value = choice.key;
      option.textContent = `${choice.key} — ${choice.label}`;
      select.append(option);
      return choice.key;
    });
  }
  return Object.freeze(offered);
}

/** What the two selects currently hold, in the shape the model validates. */
export function readCohortDeclarationControl(doc) {
  const declaration = {};
  for (const [attribute, ids] of Object.entries(DECLARE_FIELDS)) {
    declaration[attribute] = byId(doc, ids.select)?.value ?? "";
  }
  return declaration;
}

/**
 * Say what the reader's submission did, in the panel's own status region.
 *
 * One-shot and reader-triggered: nothing writes here on an ordinary import, so
 * this page still makes exactly one announcement when an answer changes on its
 * own. Passing null empties it, which announces nothing.
 */
export function announceCohortDeclaration(doc, message = null) {
  const node = byId(doc, IDS.declareStatus);
  if (!node) return null;
  node.textContent = message ?? "";
  node.hidden = !message;
  return message ?? null;
}

/**
 * Show the control for exactly the attributes the export could not supply.
 *
 * Gated on `declarable` — what the FILE carries — rather than on whether a
 * position was withheld. An export that carries an org_size_band column holding
 * a value this contract does not publish is not missing the attribute; it is
 * wrong about it, and the instruction it already earns is to fix the file.
 */
function applyDeclarationControl(doc, result) {
  const control = byId(doc, IDS.declare);
  if (!control) return null;
  const declarable = result?.declarable ?? null;
  const wanted = Boolean(declarable && (declarable.orgSizeBand || declarable.industry));
  control.hidden = !wanted;
  for (const [attribute, ids] of Object.entries(DECLARE_FIELDS)) {
    const field = byId(doc, ids.field);
    if (field) field.hidden = !(wanted && declarable[attribute]);
  }
  if (!wanted) announceCohortDeclaration(doc, null);
  return wanted;
}

/**
 * Paint the ranked-position panel from one decision.
 *
 * @param doc the document.
 * @param result a `validateCohortAttribution` result, or null to hand the panel
 *   back — a cleared import must not leave a position on screen for a file that
 *   is no longer loaded.
 * @returns the state painted, for a caller that wants to assert on it.
 */
export function applyCohortAttribution(doc, result = null) {
  const panel = byId(doc, IDS.panel);
  if (!panel) return null;
  if (!result) {
    panel.hidden = true;
    panel.dataset.state = "empty";
    panel.dataset.provenance = "none";
    for (const id of [IDS.state, IDS.headline, IDS.detail, IDS.next, IDS.note]) setText(doc, id, "—");
    const cleared = byId(doc, IDS.next);
    if (cleared) cleared.hidden = true;
    applyDeclarationControl(doc, null);
    return "empty";
  }
  const state = result.eligible ? "ranked" : "withheld";
  panel.hidden = false;
  panel.dataset.state = state;
  applyDeclarationControl(doc, result);
  // WHOSE FACTS THESE ARE, on the marker as well as in the sentence. A position
  // selected from an attribute the reader named on this page is never presented
  // as one read out of their export, so the discriminator the contract publishes
  // is what this attribute and the two sentences below are written from.
  const provenance = result.position?.provenance ?? null;
  panel.dataset.provenance = provenance ?? "none";
  const declared = provenance === COHORT_ATTRIBUTE_SOURCE.readerDeclared;
  setText(doc, IDS.state, result.eligible
    ? `Ranked position available${declared ? ` · ${COHORT_PROVENANCE_LABEL[provenance]}` : ""}`
    : "Ranked position withheld");
  if (result.eligible) {
    const { position } = result;
    setText(doc, IDS.headline,
      `This import is compared against ${position.label.toLowerCase()}.`);
    setText(doc, IDS.detail,
      `${position.memberCount} organizations in ${position.segmentLabel} · declared band `
      + `${position.orgSizeBand} · declared industry ${position.industry} · `
      + `${position.orgUnits} attributed org unit${position.orgUnits === 1 ? "" : "s"} counted `
      + `from this export · cohort snapshot ${position.snapshotDate} · `
      + `${COHORT_PROVENANCE_LABEL[provenance]}. ${COHORT_PROVENANCE_STATEMENT[provenance]}`);
    const next = byId(doc, IDS.next);
    if (next) next.hidden = true;
  } else {
    setText(doc, IDS.headline, result.reasonText);
    setText(doc, IDS.detail, `Reason code: ${result.reason} · `
      + `${result.observed.orgUnits} attributed org unit`
      + `${result.observed.orgUnits === 1 ? "" : "s"} counted from this export`);
    const next = setText(doc, IDS.next, `Next step: ${result.nextStep}`);
    if (next) next.hidden = false;
  }
  // The note travels with the answer in both states: what a comparison read is
  // as much part of it as where it placed.
  setText(doc, IDS.note, `${result.note.label}. ${result.note.text} `
    + `${result.note.provenance.label}: ${result.note.provenance.statement}`);
  return state;
}
