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

const IDS = Object.freeze({
  panel: "local-cohort-position",
  state: "local-cohort-state",
  headline: "local-cohort-headline",
  detail: "local-cohort-detail",
  next: "local-cohort-next",
  note: "local-cohort-note",
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
      + `from this export · cohort snapshot ${position.snapshotDate}`);
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
