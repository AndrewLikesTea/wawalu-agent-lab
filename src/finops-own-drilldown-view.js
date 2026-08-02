// Repopulate #finops-first-run from the reader's own import, instead of
// retiring it.
//
// THE ONE HEADLINE RULE. This region ships with the example's headline authored
// into it and the own-data headline authored hidden beside it. Painting swaps
// which of the two is on screen; it never leaves both. Everything else the
// example composed — its sample marker, its two slot grids, its recommendation,
// its confidence line, its print copy of the example evidence, and the hand-off
// to the example briefing — goes off screen in the same pass, because a figure
// computed from invented data sitting under a headline computed from a reader's
// own file is the mislabelling this whole region exists to prevent.
//
// ONE DISCLOSURE, NOT TWO. The drill-down is painted INTO the details element
// this region already owns, beside the example's evidence list rather than
// under a second control. `paintDisclosureState` in finops-first-run-view.js
// still owns the summary's three state channels, so the expanded state, the
// visible word, and `aria-expanded` come from one place in both modes. The
// summary is a native `summary`: a real focusable control in tab order,
// operable by Enter and Space with no script at all, in the fallback state as
// much as in the department one.
//
// THE HEADLINE NUMBER IS OUTSIDE THE DISCLOSURE. Deliberately, and it is worth
// saying why the tests are not the reason: this repository's harness reads text
// through a closed details element and models no layout, so a number hidden
// inside the collapsed content would pass every assertion here and be invisible
// in a real browser. The figure is a sibling of the disclosure, not a child.
//
// Nothing here assigns markup. Every string arrives through `textContent` and
// every node through `createElement`, because the strings below include group
// names taken straight out of a reader's file.

import { FIRST_RUN_IDS } from "./finops-first-run.js";
import { paintDisclosureState } from "./finops-first-run-view.js";
import { ownDataDrilldown } from "./finops-own-drilldown.js";

/** The example-composed blocks this region hides while it holds own data. */
const EXAMPLE_BLOCKS = ".first-run-answer,.first-run-answer-detail,.first-run-sample,"
  + ".first-run-slots,.first-run-support,.first-run-recommendation,.first-run-confidence,"
  + ".first-run-method-print,.first-run-handoff";

/** The provenance line that replaces the bundled-example one, in own-data mode. */
export const OWN_DATA_SAMPLE = Object.freeze({
  badge: "Your imported export",
  statement: "Every figure in this block was computed in this browser tab from the file you "
    + "chose. It was not uploaded, and no figure here comes from the bundled example.",
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text;
  return node;
}

function cell(doc, tag, text, scope) {
  const node = doc.createElement(tag);
  node.textContent = text;
  if (scope) node.setAttribute("scope", scope);
  return node;
}

/** Toggle every example-composed block in the region in one pass. */
function showExample(region, visible) {
  for (const node of region.querySelectorAll(EXAMPLE_BLOCKS)) node.hidden = !visible;
}

/**
 * Paint the ranked table. Rebuilt on every paint rather than diffed: a row kept
 * from a previous import is a figure for a file that is no longer loaded.
 */
function paintRows(doc, model) {
  const body = byId(doc, FIRST_RUN_IDS.ownRows);
  if (!body) return 0;
  const built = model.rows.map((row) => {
    const line = doc.createElement("tr");
    line.dataset.rank = String(row.rank);
    line.dataset.group = row.name;
    // The name is the row header, so a screen reader reading a cell across
    // announces which group it belongs to rather than a bare figure.
    line.append(cell(doc, "td", String(row.rank)),
      cell(doc, "th", row.name, "row"),
      cell(doc, "td", row.spend),
      cell(doc, "td", `${row.sharePercent}%`));
    return line;
  });
  body.replaceChildren(...built);
  return built.length;
}

/**
 * Repopulate the region from an imported analysis.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null.
 * @returns the composed model, including the unavailable one. `available:
 *   false` means this export carried no dimension worth ranking; the caller
 *   retires the region exactly as it did before this block existed.
 */
export function applyOwnDataDrilldown(doc, analysis) {
  const model = ownDataDrilldown(analysis ?? null);
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region) return model;
  if (!model.available) {
    clearOwnDataDrilldown(doc);
    return model;
  }

  region.hidden = false;
  region.dataset.superseded = "false";
  region.dataset.source = "own-data";
  region.dataset.grouping = model.grouping.id;
  showExample(region, false);

  const own = byId(doc, FIRST_RUN_IDS.own);
  if (own) own.hidden = false;
  // The headline node carries `hidden` in its own right rather than inheriting
  // it from the block: exactly one of the two headline nodes in this region is
  // ever unhidden, and that is a property of the NODES so it survives whatever
  // a caller does to the containers around them.
  const answer = setText(doc, FIRST_RUN_IDS.ownAnswer, model.headline.value);
  if (answer) answer.hidden = false;
  setText(doc, FIRST_RUN_IDS.ownDetail, model.headline.detail);
  // Which grouping this landed on and why the one above it was unavailable, in
  // visible text rather than in an attribute a reader cannot see.
  const grouping = setText(doc, FIRST_RUN_IDS.ownGrouping, model.grouping.note);
  if (grouping) grouping.dataset.fallback = String(model.grouping.fallback);

  const sample = byId(doc, FIRST_RUN_IDS.ownSample);
  if (sample) {
    const badge = doc.createElement("strong");
    badge.textContent = OWN_DATA_SAMPLE.badge;
    sample.replaceChildren(badge, doc.createTextNode(` ${OWN_DATA_SAMPLE.statement}`));
  }

  const evidence = byId(doc, FIRST_RUN_IDS.ownEvidence);
  if (evidence) evidence.hidden = false;
  const exampleTitle = byId(doc, FIRST_RUN_IDS.methodTitle);
  if (exampleTitle) exampleTitle.hidden = true;
  const ownTitle = byId(doc, FIRST_RUN_IDS.ownTitle);
  if (ownTitle) ownTitle.hidden = false;
  const methodList = byId(doc, FIRST_RUN_IDS.methodList);
  if (methodList) methodList.hidden = true;
  setText(doc, FIRST_RUN_IDS.ownGroupHeading,
    model.grouping.label.replace(/^./, (letter) => letter.toUpperCase()));
  setText(doc, FIRST_RUN_IDS.ownCaption,
    `Your imported spend by ${model.grouping.label}, highest first. `
    + `${model.rows.length} ranked; row 1 is the group named above.`);
  const painted = paintRows(doc, model);
  // The count travels with the disclosure's state word, so "Show evidence · 5"
  // says how much is behind the control in this mode too.
  paintDisclosureState(doc, painted);
  return model;
}

/**
 * Give the region back to the example path.
 *
 * The example's own nodes were hidden, never rewritten, so there is nothing to
 * restore here but visibility — which is what keeps "clear the import" from
 * needing a second copy of every string the example composed.
 */
export function clearOwnDataDrilldown(doc) {
  const region = byId(doc, FIRST_RUN_IDS.region);
  if (!region) return null;
  showExample(region, true);
  delete region.dataset.source;
  delete region.dataset.grouping;
  for (const id of [FIRST_RUN_IDS.own, FIRST_RUN_IDS.ownAnswer,
    FIRST_RUN_IDS.ownEvidence, FIRST_RUN_IDS.ownTitle]) {
    const node = byId(doc, id);
    if (node) node.hidden = true;
  }
  for (const id of [FIRST_RUN_IDS.methodTitle, FIRST_RUN_IDS.methodList]) {
    const node = byId(doc, id);
    if (node) node.hidden = false;
  }
  const body = byId(doc, FIRST_RUN_IDS.ownRows);
  if (body) body.replaceChildren();
  return region;
}
