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

// THE OPTIONS ARE NOT AUTHORED HERE. A control that offers cohort values reads
// the published enumeration, because a list retyped in a view is a list that
// drifts from the one the contract accepts, and the reader meets that drift as
// "the page let me choose it and then refused it".
import { INDUSTRY_OPTIONS, ORG_SIZE_BAND_OPTIONS } from "./cohort-attribution.js";

const IDS = Object.freeze({
  panel: "local-cohort-position",
  state: "local-cohort-state",
  headline: "local-cohort-headline",
  detail: "local-cohort-detail",
  next: "local-cohort-next",
  note: "local-cohort-note",
  declare: "local-cohort-declare",
  declareLead: "local-cohort-declare-lead",
  band: "local-cohort-band",
  industry: "local-cohort-industry",
  submit: "local-cohort-declare-submit",
  message: "local-cohort-declare-message",
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

const setText = (doc, id, value) => {
  const node = byId(doc, id);
  if (node) node.textContent = value;
  return node;
};

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
  // The declaration control is handed back on EVERY paint, before anything else
  // is decided. Hiding is not rendering: nothing is constructed here, and the
  // caller re-offers the control only on the one state that earns it. An import
  // that supplies both attributes therefore never reaches the renderer at all,
  // and can never leave a stale chooser standing under its own position.
  hideCohortDeclaration(doc);
  if (!result) {
    panel.hidden = true;
    panel.dataset.state = "empty";
    for (const id of [IDS.state, IDS.headline, IDS.detail, IDS.next, IDS.note]) setText(doc, id, "—");
    const cleared = byId(doc, IDS.next);
    if (cleared) cleared.hidden = true;
    return "empty";
  }
  const state = result.eligible ? "ranked" : "withheld";
  panel.hidden = false;
  panel.dataset.state = state;
  setText(doc, IDS.state, result.eligible
    ? "Ranked position available"
    : "Ranked position withheld");
  if (result.eligible) {
    const { position } = result;
    setText(doc, IDS.headline,
      `This import is compared against ${position.label.toLowerCase()}.`);
    setText(doc, IDS.detail,
      `${position.memberCount} organizations in ${position.segmentLabel} · declared band `
      + `${position.orgSizeBand} · declared industry ${position.industry} · `
      + `${position.orgUnits} attributed org unit${position.orgUnits === 1 ? "" : "s"} counted `
      + `from this export · cohort snapshot ${position.snapshotDate}`
      // Whose two attributes placed this organization, in the contract's own
      // word for it. Read off the discriminator, never worked out from whether
      // the export happened to carry a column.
      + ` · position source: ${position.sourceLabel}`);
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

// ---------------------------------------------------------------------------
// The declaration control.
//
// Offered on exactly one state: the import's own columns cannot supply the two
// attributes a cohort is selected on. Everywhere else it is not on the page.
//
// HOW THE CHOOSERS ARE BUILT, AND WHY IT MATTERS. Both selects are authored
// EMPTY in src/evolution.html and filled here with `replaceChildren`, which is
// the idiom every other chooser on this page uses (see the samples chooser in
// portfolio-comparability-view.js and the two in browser-compat-view.js). An
// earlier attempt at this control built the select itself and hung options off
// it with `appendChild`, which the browser test harness — tests/support/browser.js
// — does not implement on any element: it models `append`, `prepend`,
// `insertBefore` and `replaceChildren` and nothing else, so the call threw
// `TypeError: select.appendChild is not a function` on every import path that
// reached this module and took unrelated suites down with it. Following the
// established idiom is not a workaround for the harness; it is the one way this
// page builds a chooser, and now this control builds one too.
// ---------------------------------------------------------------------------

const LEAD = "This import declares neither an organization size band nor an industry, and no "
  + "column in it can supply them. Declare them here and the position is recomputed from the "
  + "import already in this tab — nothing is re-read, re-uploaded, or kept beyond this session.";

const fillOptions = (doc, select, entries) => {
  select.replaceChildren(...entries.map(({ value, label }) => {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
};

/** Take the control off the page. Nothing is built, nothing is torn down. */
export function hideCohortDeclaration(doc) {
  const form = byId(doc, IDS.declare);
  if (form) form.hidden = true;
  const message = byId(doc, IDS.message);
  if (message) message.hidden = true;
}

/**
 * Offer the control, with both choosers filled from the published enumeration.
 *
 * @param declared the accepted facts already standing this session, or null, so
 *   a reader who declared and then imported a second file sees what they chose
 *   rather than a chooser that silently forgot it.
 * @returns true when the control is on screen.
 */
export function renderCohortDeclaration(doc, { declared = null } = {}) {
  const form = byId(doc, IDS.declare);
  const band = byId(doc, IDS.band);
  const industry = byId(doc, IDS.industry);
  if (!form || !band || !industry) return false;
  setText(doc, IDS.declareLead, LEAD);
  fillOptions(doc, band, ORG_SIZE_BAND_OPTIONS);
  fillOptions(doc, industry, INDUSTRY_OPTIONS);
  band.value = declared?.orgSizeBand ?? ORG_SIZE_BAND_OPTIONS[0].value;
  industry.value = declared?.industry ?? INDUSTRY_OPTIONS[0].value;
  form.hidden = false;
  return true;
}

/** What the two choosers currently hold, unresolved. The contract judges it. */
export function readCohortDeclarationControl(doc) {
  return {
    orgSizeBand: byId(doc, IDS.band)?.value ?? "",
    industry: byId(doc, IDS.industry)?.value ?? "",
  };
}

/** Say what the contract said about a submission. Refusals are not silent. */
export function applyCohortDeclarationOutcome(doc, outcome) {
  const message = byId(doc, IDS.message);
  if (!message) return null;
  message.textContent = outcome?.message ?? "";
  message.hidden = !outcome?.message;
  message.dataset.state = outcome?.accepted ? "accepted" : "refused";
  return message.dataset.state;
}

/**
 * Wire the submit once, at boot.
 *
 * Binding is not rendering: this attaches one listener to markup that is
 * already served, builds nothing, and leaves the control hidden.
 */
export function bindCohortDeclaration(doc, { onDeclare } = {}) {
  const submit = byId(doc, IDS.submit);
  if (!submit || typeof onDeclare !== "function") return false;
  submit.addEventListener("click", () => onDeclare(readCohortDeclarationControl(doc)));
  return true;
}
