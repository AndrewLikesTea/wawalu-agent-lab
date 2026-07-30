// The workspace-destination region, painted from the contract.
//
// One job: make the prioritized destination the thing a reader acts on without
// scanning for it. The rank-1 door is a visible link with the reason it came
// first beside it; the other two doors and the whole derivation sit behind two
// native disclosures, so the region is four lines until somebody asks it for
// more.
//
// Every node is built with createElement and textContent. The site policy
// forbids executing user-generated markup, so no markup string is assigned here
// and no figure is transcribed — every string comes from the validated record.

import {
  DESTINATION_ROLE, MATERIALITY, PRIORITY_RULE_VERSION,
  prioritizedDestination, supportingDestinations,
} from "./finops-destination-contract.js";

export const DESTINATION_SECTION_ID = "finops-destinations";
export const DESTINATION_BODY_ID = "finops-destinations-body";

/** The states the region can be in, as the reader would describe them. */
export const DESTINATION_STATE = Object.freeze({
  unavailable: "unavailable",
  ranked: "ranked",
});

/**
 * The shapes are redundant with the words beside them, never a substitute: a
 * reader who cannot see the glyph loses nothing.
 */
const ROLE_SHAPE = Object.freeze({
  [DESTINATION_ROLE.evidence]: "◇",
  [DESTINATION_ROLE.departmentDetail]: "◈",
  [DESTINATION_ROLE.actAndVerify]: "◆",
});

const byId = (doc, id) => doc.getElementById(id);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shape(doc, glyph) {
  const node = element(doc, "span", "dest-shape", glyph ?? "◇");
  node.setAttribute("aria-hidden", "true");
  return node;
}

/** A `dt`/`dd` pair inside a `div`, which is how the page's other lists group. */
function term(doc, label, detail) {
  const wrap = element(doc, "div");
  wrap.append(element(doc, "dt", null, label));
  wrap.append(element(doc, "dd", null, detail));
  return wrap;
}

/**
 * A disclosure whose summary carries its own heading and a visible state chip.
 * Visible text rather than an `aria-label`, so the name a speech-control user
 * says is the name they can see.
 */
function disclosure(doc, key, headingText) {
  const details = element(doc, "details", "dest-disclosure");
  details.dataset.disclosure = key;
  const summary = element(doc, "summary");
  const heading = element(doc, "h3", "dest-disclosure-heading");
  heading.append(element(doc, "span", null, headingText));
  const chip = element(doc, "span", "dest-disclosure-state");
  chip.append(shape(doc, "▸"));
  chip.append(element(doc, "span", null, " Show detail"));
  heading.append(chip);
  summary.append(heading);
  details.append(summary);
  return details;
}

/**
 * The rank-1 door: the call to action first, then the question it answers, then
 * the one sentence saying why it outranked the other two. The reason is visible
 * rather than disclosed — a recommendation whose justification is behind a
 * triangle asks the reader to take the ordering on faith.
 */
function primaryBlock(doc, destination, clauseReason) {
  const wrap = element(doc, "div", "dest-primary-block");
  wrap.dataset.destinationRole = destination.role;
  wrap.dataset.destinationRank = String(destination.rank);
  wrap.append(element(doc, "p", "eyebrow dest-primary-eyebrow", "Go here first · rank 1 of 3"));

  // Its own class rather than the page's `.secondary-button`: this control is
  // the region's one primary action, and borrowing the secondary silhouette
  // would draw the prioritized door at the weight of the two it outranks.
  const link = element(doc, "a", "dest-primary");
  link.id = "finops-destination-primary";
  link.setAttribute("href", destination.href);
  link.dataset.destinationId = destination.id;
  link.dataset.destinationRole = destination.role;
  link.dataset.destinationRank = String(destination.rank);
  link.append(shape(doc, ROLE_SHAPE[destination.role]));
  link.append(element(doc, "span", null, destination.callToAction));
  wrap.append(link);

  wrap.append(element(doc, "p", "dest-primary-label", destination.label));
  wrap.append(element(doc, "p", "dest-primary-answers", destination.answers));
  if (clauseReason) wrap.append(element(doc, "p", "dest-primary-because", clauseReason));
  return wrap;
}

/** The two doors the rule did not promote, in rank order, behind a disclosure. */
function othersBlock(doc, destinations) {
  const details = disclosure(doc, "other-destinations",
    "Other places you can go, and what each one answers");
  const list = element(doc, "ol", "dest-others");
  for (const entry of destinations) {
    const item = element(doc, "li", "dest-other");
    item.dataset.destinationRole = entry.role;
    item.dataset.destinationRank = String(entry.rank);
    const link = element(doc, "a", "dest-other-link");
    link.setAttribute("href", entry.href);
    link.dataset.destinationId = entry.id;
    link.append(shape(doc, ROLE_SHAPE[entry.role]));
    link.append(element(doc, "span", null, entry.label));
    item.append(link);
    item.append(element(doc, "p", "dest-other-answers", entry.answers));
    // What a destination will not tell you, beside the link to it. A door
    // labelled only with what it offers is how a reader ends up in the wrong room.
    item.append(element(doc, "p", "dest-other-limit", entry.doesNotAnswer));
    list.append(item);
  }
  details.append(list);
  return details;
}

/**
 * The derivation, behind the second disclosure: the clause that decided the
 * order, the arithmetic the benchmark is, the ordering the action won, the
 * limits, the provenance, and the record's own evidence entries.
 */
function derivationBlock(doc, record, primary) {
  const details = disclosure(doc, "how-this-was-ranked",
    "How this order was decided and what it cannot tell you");
  const list = element(doc, "dl", "dest-derivation");
  list.append(term(doc, "Why this one first", primary.selectionBasis));
  list.append(term(doc, "Rule version", `${PRIORITY_RULE_VERSION} · first matching clause wins,`
    + " and the two roles it did not promote keep their declared order."));
  list.append(term(doc, record.benchmark.name, record.benchmark.basis));
  list.append(term(doc, "Materiality thresholds",
    `Both required: share at least ${MATERIALITY.minShare * 100}% and recoverable spend at least`
    + ` ${MATERIALITY.minObservedUsd.toLocaleString("en-US")} USD.`));
  list.append(term(doc, "Ranked action", record.rankedAction.priorityBasis));
  list.append(term(doc, "Accountable role", record.rankedAction.accountableRole));
  for (const limit of record.finding.confidence.limits) {
    list.append(term(doc, `Limit · ${limit.code}`, limit.detail));
  }
  for (const entry of record.finding.evidence.entries) {
    list.append(term(doc, entry.term, entry.detail));
  }
  list.append(term(doc, "Provenance", `${record.finding.provenance.sourceLabel}. `
    + `${record.finding.provenance.executionContext}`));
  list.append(term(doc, "Dated", `${record.finding.provenance.generatedAt} · `
    + record.finding.provenance.generatedAtBasis));
  details.append(list);
  return details;
}

/**
 * Paint the region from a loaded record.
 *
 * A record that failed its own contract paints the labelled unavailable state
 * and names the count of failures. It does not paint a partial ranking: half a
 * recommendation is worse than an honest absence, because a reader cannot tell
 * which half is missing.
 *
 * @returns the painted record, or null when nothing could be painted.
 */
export function applyWorkspaceDestinations(doc, loaded) {
  const section = byId(doc, DESTINATION_SECTION_ID);
  const body = byId(doc, DESTINATION_BODY_ID);
  if (!section || !body) return null;
  body.replaceChildren();

  const record = loaded?.record ?? null;
  const primary = prioritizedDestination(record);
  if (!record || !primary) {
    section.dataset.state = DESTINATION_STATE.unavailable;
    const count = loaded?.errors?.length ?? 0;
    body.append(element(doc, "p", "dest-unavailable",
      count > 0
        ? `No destination is ranked: the bundled example failed ${count} contract`
          + ` check${count === 1 ? "" : "s"}.`
        : "No destination is ranked from this example."));
    return null;
  }

  section.dataset.state = DESTINATION_STATE.ranked;
  section.dataset.priorityClause = String(primary.priorityClause);
  section.dataset.destinationRole = primary.role;

  // The finding first, in one sentence, then why it matters to a leader. This
  // is the reading order the region keeps in every medium; nothing below
  // reorders in CSS.
  body.append(element(doc, "p", "dest-finding", record.finding.statement));
  body.append(element(doc, "p", "dest-why", record.finding.whyItMatters));
  body.append(primaryBlock(doc, primary, loaded?.clause?.because ?? null));

  // A score never appears without the basis for it, and the basis is visible
  // rather than disclosed for the same reason the ordering reason is.
  const confidence = record.finding.confidence;
  const score = element(doc, "p", "dest-confidence");
  score.dataset.band = confidence.band;
  score.append(element(doc, "span", "dest-confidence-value",
    `Confidence ${confidence.score.toFixed(2)} of 1.00 · ${confidence.band}`));
  body.append(score);
  body.append(element(doc, "p", "dest-confidence-basis", confidence.basis));

  body.append(othersBlock(doc, supportingDestinations(record)));
  body.append(derivationBlock(doc, record, primary));
  return record;
}

/**
 * Retire the region when the reader's own analysis has replaced the example.
 *
 * The destinations themselves stay true — they are places, not figures — but the
 * *ranking* was computed from invented data, and a recommendation to check one
 * door first is only honest about the dataset it was ranked from. So the region
 * follows the example brief it belongs to: superseded and hidden together.
 */
export function supersedeWorkspaceDestinations(doc, superseded) {
  const section = byId(doc, DESTINATION_SECTION_ID);
  if (!section) return null;
  const retired = Boolean(superseded);
  section.dataset.superseded = retired ? "true" : "false";
  section.hidden = retired;
  return section;
}
