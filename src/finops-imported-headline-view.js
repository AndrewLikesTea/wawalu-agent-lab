// The render layer for the imported-state headline contract.
//
// It takes the document rather than reading a global, like the view modules
// beside it, so a test drives the shipped markup of evolution.html. Every node
// is built with createElement and textContent: no markup string, no innerHTML.
//
// WHAT IT WILL NOT DO.
//
//   * Decide anything. Which slots the export supported, what each one says
//     when it did not, and which provenance label belongs to it are
//     `importedHeadline`'s answers, and they come off the checked-in fixture.
//     This layer paints rows and holds no string of its own.
//   * Drop a row. Five slots are painted in fixture order in every state. A
//     slot the export could not supply is painted with its fallback sentence
//     and its fallback provenance label, marked `data-supported="false"` — not
//     hidden, not blank, and never carrying the bundled example's figure.
//   * Touch the example path. Passing `null` takes this block off screen and
//     leaves every node the example headline owns exactly as it was.
//   * Announce. This block is part of the stand region's one answer, and that
//     region already has the page's single live region for an import. A second
//     one is a queue a reader hears instead of an answer, which is the rule
//     tests/finops-answer-announcement.test.js holds.
//
// The provenance label is an ATTRIBUTE as well as a word, because the word is
// what a reader sees and the attribute is what a test can hold: the harness
// these tests run under reads text through collapsed containers, so "this slot
// says it came from your export" is asserted on `data-supported` and on the
// rendered label rather than on whether something is visible.

import { importedHeadline } from "./finops-imported-headline.js";
import { renderProvenance, sourceOfSupported } from "./finops-brief-provenance.js";

const REGION_ID = "finops-imported-headline";
const QUESTION_ID = "finops-imported-headline-question";
const SLOTS_ID = "finops-imported-headline-slots";
// Where the names in the sentence above came from, in the export's own column
// names. Both lines are plain text in the region, never inside a fold: the
// harness reads through a collapsed disclosure and a real browser does not, so
// folding this away would silence it for everyone except the tests.
const NAMING_ID = "finops-imported-headline-naming";
const NAMING_CONTRACT_ID = "finops-imported-headline-naming-contract";

/**
 * The emphasis each slot is painted at. ONE order, and it is the fixture's: the
 * question is the block's first line, the recoverable figure the question asks
 * for is the next thing on the page at the largest step this region draws, and
 * the action to take about it is the one after that. Everything else is support
 * and is painted a step down, in the same DOM order a Tab key and a screen
 * reader walk. Nothing here reverses, floats or re-orders in CSS — the row order
 * IS the reading order, and it is decided in the contract.
 */
const SLOT_ROLE = Object.freeze({ recoverable_spend: "lead", rank_1_action: "action" });

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * One row per slot: the label, the value or its fallback, the provenance label,
 * and the basis sentence when the slot earned one.
 *
 * Rebuilt on every paint rather than diffed. The rows are five, and a row kept
 * from a previous import would be a figure for a file that is no longer loaded.
 */
function paintSlots(doc, slots) {
  const host = byId(doc, SLOTS_ID);
  if (!host) return [];
  const built = [];
  for (const entry of slots) {
    const role = SLOT_ROLE[entry.id] ?? "support";
    const term = element(doc, "dt", "imported-headline-label", entry.label);
    term.dataset.slot = entry.id;
    term.dataset.role = role;
    const detail = element(doc, "dd", "imported-headline-slot");
    detail.dataset.slot = entry.id;
    detail.dataset.role = role;
    detail.dataset.supported = String(entry.supported);
    detail.append(element(doc, "span", "imported-headline-value", entry.value));
    // The shared marker carries what a per-row sentence used to: the state, in
    // the same words every other region of this brief uses, with the contract's
    // own sentence for the derivation as its detail. One marker, one pattern —
    // the row no longer words provenance its own way.
    detail.append(renderProvenance(doc, sourceOfSupported(entry.supported),
      { qualifies: entry.label, detail: entry.provenance }));
    if (entry.detail) {
      detail.append(element(doc, "span", "imported-headline-basis", entry.detail));
    }
    host.append(term, detail);
    built.push(detail);
  }
  return built;
}

/**
 * Where the unit names in this headline came from, and what the derivation is
 * allowed to read.
 *
 * Two lines, both of them the derivation contract's own words — this layer holds
 * no string here either. The first names the actual columns, because "names were
 * derived" is a claim a reader cannot check and `“project_name” column` is one
 * they can go and look at. The second states the recognized fields and their
 * precedence, so a reader can tell a column that was ignored from one that was
 * read and lost a tie.
 *
 * An import with no derivation to report — a JSON envelope, or a reading with no
 * org-unit column — empties both and hides the block. It never falls back to a
 * generic sentence, because a generic sentence about provenance is the thing
 * this block exists to replace.
 */
function paintNaming(doc, naming) {
  const line = byId(doc, NAMING_ID);
  const contract = byId(doc, NAMING_CONTRACT_ID);
  const available = Boolean(naming?.available && naming.unitCount > 0);
  if (line) {
    line.textContent = available ? naming.statement : "";
    line.hidden = !available;
    line.dataset.derived = available ? String(naming.derivedCount) : "0";
    line.dataset.units = available ? String(naming.unitCount) : "0";
    line.dataset.conflicted = available ? String(naming.conflictedCount) : "0";
    line.dataset.contractVersion = available ? String(naming.contractVersion) : "";
  }
  if (contract) {
    contract.textContent = available ? naming.precedenceStatement : "";
    contract.hidden = !available;
  }
  return available;
}

/**
 * Paint the imported headline for an analysis, or take it off screen.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null when
 *   the reader is on the bundled example or has cleared an import.
 * @param {{labels?: object, naming?: object}} [options] `labels` is the resolved
 *   org-unit name map — the reader's own names over the ones derived from their
 *   export — carried through to the contract, which is where the one resolver is
 *   called. `naming` is the derivation result behind the second half of that
 *   map, painted as this block's provenance. This layer still holds no string.
 * @returns the composed headline, including the unavailable one.
 */
export function applyImportedHeadline(doc, analysis, { labels = null, naming = null } = {}) {
  const region = byId(doc, REGION_ID);
  const headline = importedHeadline(analysis ?? null, { labels });
  if (!region) return headline;
  const host = byId(doc, SLOTS_ID);
  if (host) host.replaceChildren();
  paintNaming(doc, headline.available ? naming : null);
  if (!headline.available) {
    region.hidden = true;
    region.dataset.state = "unavailable";
    delete region.dataset.tier;
    const question = byId(doc, QUESTION_ID);
    if (question) question.textContent = "";
    return headline;
  }

  region.hidden = false;
  region.dataset.state = "imported";
  region.dataset.tier = headline.tier;
  region.dataset.contractVersion = headline.contractVersion;
  const question = byId(doc, QUESTION_ID);
  // The question line renders above the five slots, in the fixture's words.
  if (question) question.textContent = headline.question;
  paintSlots(doc, headline.slots);
  return headline;
}

/** Take the imported headline off screen. The example path is left untouched. */
export function clearImportedHeadline(doc) {
  return applyImportedHeadline(doc, null);
}
