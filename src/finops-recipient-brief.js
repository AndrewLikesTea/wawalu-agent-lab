// Somebody else's brief, read-only, in the answer region it belongs in (#1208).
//
// THE PROBLEM THIS SOLVES. #1206 put a lead's own periods into a link's fragment
// and #1207 made the same envelope travel as a file. Neither could be read where
// a lead actually reads an answer: this page's own answer region — the figure,
// the destination, the grade, and the one disclosure that bounds them.
//
// FIVE RULES THIS MODULE HOLDS.
//
//   1. ONE ENVELOPE, NOT A SECOND SCHEMA. Every field comes off the validated
//      envelope src/finops-brief-envelope.js projects, reached through
//      `readSharedBriefingFragment` for a link and `readBriefEnvelopeText` for a
//      file. This module parses nothing and validates nothing itself: a brief
//      the shared reader refuses is a brief this view never sees.
//   2. THE SAME REGION, THE SAME DISCLOSURE. No new page and no new destination:
//      the answer region's own slots, and its own "How we know this" — same
//      element, same summary words, same collapsed default.
//   3. ABSENT IS NOT ZERO. A part the brief did not carry renders NOT_INCLUDED
//      in words rather than disappearing, so a recipient interrogating a figure
//      can tell "the sender had nothing here" from "the sender said nothing".
//   4. READ-ONLY MEANS NO CONTROL. No storage is imported and no button, link or
//      input is added — the region's next-step anchor is HIDDEN, because the
//      sender's move is not this reader's next action. The state takes a tab
//      stop away and adds none.
//   5. NO PAYLOAD MEANS NO CHANGE. An address with no brief on it repaints
//      nothing. A refused brief states why in one paragraph ABOVE the region and
//      leaves the region as the boot painted it: a half-swapped answer is worse
//      than no shared brief at all.
//
// Every string a brief supplied reaches the DOM through `textContent`: no
// `innerHTML`, and no `href` built from a value in the file.

import { briefPricingBasis } from "./finops-brief-envelope.js";
import {
  SHARE_DECODE_REASON, readSharedBriefingFragment,
} from "./finops-shared-briefing-link.js";

/** The ids this view writes. The first seven are authored in evolution.html. */
export const RECIPIENT_BRIEF_IDS = Object.freeze({
  region: "finops-recoverable-answer",
  label: "finops-recoverable-label",
  value: "finops-recoverable-value",
  marker: "finops-recoverable-marker",
  grade: "finops-recoverable-grade",
  destination: "finops-recoverable-confidence",
  action: "finops-recoverable-action",
  disclosure: "finops-recoverable-how-we-know",
  confidenceDetail: "finops-recoverable-confidence-detail",
  origin: "finops-shared-brief-origin",
  notice: "finops-shared-brief-notice",
});

/** What the marker chip beside the figure says instead of "Illustrative". */
export const SHARED_MARKER = "Shared brief";

/** What a part the brief did not carry says. Absent, stated, never dropped. */
export const NOT_INCLUDED = "Not included in this brief. The sender's brief carried nothing for this "
  + "part, so it is absent rather than zero.";

/** The parts of the region's one disclosure, in the order it states them. */
export const RECIPIENT_BRIEF_PARTS = Object.freeze(["Provenance", "Basis", "Priced at", "Limits"]);

/** The part that names whose prices the figure above was computed at (#1265). */
export const PRICED_AT_PART = "Priced at";

/** What the reader is told, in plain words, about whose figures these are. */
export const SHARED_BRIEF_ORIGIN =
  "These figures came from a brief somebody shared with you. They were computed in the sender's "
  + "browser from their own retained months — not this browser's figures and not the bundled "
  + "synthetic example. Nothing was added to your own retained figures by reading them, and nothing "
  + "here proves who sent them.";

/** What a stamp the sender's brief did not carry says, in both stamp slots. */
export const STAMP_ABSENT = "not stated by the sender";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

const setText = (doc, id, text) => {
  const node = byId(doc, id);
  if (node) node.textContent = text;
  return node;
};

/** Element children as a real Array; `children` is live in a browser. */
const childElements = (node) => [...(node?.children ?? [])]
  .filter((child) => child?.nodeType === undefined || child.nodeType === 1);

/**
 * The figure, as money, from the envelope's own minor units and currency.
 *
 * The envelope carries a number and a currency code and no formatted string,
 * which is the right way round: the sender's locale is not the reader's. A
 * currency code the platform refuses formats as the bare major amount rather
 * than taking the answer region down.
 */
export function sharedFigureText(figure) {
  const minor = figure?.valueMinor;
  if (!Number.isFinite(minor)) return NOT_INCLUDED;
  const major = minor / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: figure?.currency ?? "USD", maximumFractionDigits: 0,
    }).format(major);
  } catch {
    return `${major} ${figure?.currency ?? ""}`.trim();
  }
}

/**
 * The period the sender briefed on, read off the records the brief carries.
 *
 * A range when there is more than one month, the month itself when there is
 * one, and null when the brief named none. NEVER a clock: the reader's own
 * month is not what this sentence is about.
 */
export function sharedPeriodLabel(envelope) {
  const named = (envelope?.periods ?? [])
    .map((period) => period?.period ?? period?.periodId ?? null)
    .filter((label) => typeof label === "string" && label !== "");
  if (named.length === 0) return null;
  const sorted = [...new Set(named)].sort();
  return sorted.length === 1 ? sorted[0] : `${sorted[0]} to ${sorted[sorted.length - 1]}`;
}

/** The sentence naming whose brief this is, with the sender's two stamps. */
export function sharedOriginSentence(envelope) {
  const period = sharedPeriodLabel(envelope) ?? STAMP_ABSENT;
  const produced = envelope?.producedAt ?? STAMP_ABSENT;
  return `From a shared brief · period ${period} · produced ${produced}. ${SHARED_BRIEF_ORIGIN}`;
}

/**
 * The three disclosure bodies, composed from the envelope and nothing else.
 *
 * Each one falls back to `NOT_INCLUDED` rather than to an empty string or a
 * dropped row — rule 3. Basis is composed from the records the brief carries
 * because the envelope states no basis prose: what a recipient can check is
 * which months the figure was taken over, and how many of them.
 */
export function recipientBriefSections(envelope, { localRateCard = null } = {}) {
  const provenance = envelope?.provenance ?? null;
  const periodIds = provenance?.periodIds ?? [];
  const provenanceParts = [];
  if (provenance?.dataset) provenanceParts.push(`Dataset: ${provenance.dataset}.`);
  if (provenance?.derivedAt) provenanceParts.push(`Derived at ${provenance.derivedAt}.`);
  if (periodIds.length > 0) provenanceParts.push(`Periods: ${periodIds.join(", ")}.`);
  if (Number.isFinite(provenance?.retainedPeriodCount)) {
    provenanceParts.push(`${provenance.retainedPeriodCount} retained period(s) behind it.`);
  }

  const periods = envelope?.periods ?? [];
  const periodLabel = sharedPeriodLabel(envelope);
  const limits = (envelope?.limits ?? []).map((entry) => entry?.statement)
    .filter((statement) => typeof statement === "string" && statement !== "");

  return Object.freeze({
    Provenance: provenanceParts.length === 0
      ? NOT_INCLUDED
      : `${provenanceParts.join(" ")} The sender's own retained records, carried in the brief; no file `
        + "of yours was read to show them.",
    Basis: periods.length === 0
      ? NOT_INCLUDED
      : `${envelope?.figure?.label ?? "The figure above"} was computed in the sender's browser over `
        + `${periods.length} retained period(s), ${periodLabel}. The arithmetic is theirs and is not `
        + "re-run here; what travelled is the result and the records it was taken over.",
    [PRICED_AT_PART]: pricedAtStatement(envelope, { localRateCard }),
    Limits: limits.length === 0 ? NOT_INCLUDED : limits.join(" "),
  });
}

// ---------------------------------------------------------------------------
// "Priced at" — the sender's card, never silently the reader's (#1265).
// ---------------------------------------------------------------------------
//
// A recipient can already see the figure, the grade and the months. What they
// could not see is the one thing that decides whether the number means anything
// to them: which rate card it was priced at. `briefPricingBasis` answers that
// and this section states the answer, in the words the page already uses for a
// rate basis — "Priced at your declared rate card" beside a routing slate,
// "a ceiling at list prices" under an illustrative figure.
//
// A READER'S OWN CARD IS A COMPARISON AND SAYS SO. It never re-prices a figure
// somebody else derived, and the sentence that mentions it says so first.

/** What a figure priced at the published reference card is, in one sentence. */
export const PRICED_AT_REFERENCE =
  "Priced at the published-list reference card, which states no effective date: a ceiling at list "
  + "prices, before any committed-use discount, and not anybody's contract.";

/** The lead-in for a figure the sender's own contract priced. */
export const PRICED_AT_DECLARED = "Priced at the sender's declared rate card";

/** What a reader's own declared card is, and is not, in this state. */
export const LOCAL_CARD_COMPARISON =
  "Your own declared rate card was not used for anything above — these are the sender's prices. For "
  + "comparison only, your card is graded";

/**
 * The "Priced at" sentence for one opened brief.
 *
 * @param envelope a validated envelope, whose `rateBasis` the reader supplied
 *   for every schema it reads — the reference card for a brief written before
 *   the field existed, with the wording that brief always carried.
 * @param options.localRateCard the reader's own declared card, or null. It can
 *   only ever add the comparison sentence; it can never change the one above it.
 */
export function pricedAtStatement(envelope, { localRateCard = null } = {}) {
  const { basis, comparison } = briefPricingBasis(envelope, { localRateCard });
  if (!basis) return NOT_INCLUDED;
  const discount = basis.models.some((model) => (model.committedUseDiscountPct ?? 0) > 0);
  const stated = basis.declared
    ? `${PRICED_AT_DECLARED}, in effect from ${basis.effectiveDate ?? STAMP_ABSENT}`
      + `${discount ? ", committed-use discount applied" : ""}.`
    : PRICED_AT_REFERENCE;
  const tier = ` Rate confidence: ${basis.marker} · ${basis.label}.`;
  const local = comparison
    ? ` ${LOCAL_CARD_COMPARISON} ${comparison.marker} · ${comparison.label}, in effect from `
      + `${comparison.effectiveDate ?? STAMP_ABSENT}.`
    : "";
  return `${stated}${tier}${local}`;
}

/** The `dl` the region's disclosure states its parts in. */
const detailList = (disclosure) => childElements(disclosure)
  .find((child) => child.tagName?.toUpperCase() === "DL") ?? null;

/**
 * Repopulate the region's one disclosure from the brief.
 *
 * REBUILT, not edited in place: the served bodies are about the bundled example,
 * and an edit that missed one would leave a sentence about an invented company
 * under a colleague's figure. Same element, same summary, same collapsed
 * default — only the bodies change, and the confidence meaning keeps the
 * authored id the region already declares for it inside Limits.
 */
export function renderRecipientDisclosure(doc, envelope, { localRateCard = null } = {}) {
  const disclosure = byId(doc, RECIPIENT_BRIEF_IDS.disclosure);
  const list = detailList(disclosure);
  if (!list) return null;
  const sections = recipientBriefSections(envelope, { localRateCard });
  const rows = RECIPIENT_BRIEF_PARTS.map((part) => {
    const row = doc.createElement("div");
    const term = doc.createElement("dt");
    term.textContent = part;
    const body = doc.createElement("dd");
    body.textContent = sections[part];
    if (part === "Limits") {
      const meaning = doc.createElement("span");
      meaning.setAttribute("id", RECIPIENT_BRIEF_IDS.confidenceDetail);
      meaning.textContent = ` ${envelope?.confidence?.meaning ?? NOT_INCLUDED}`;
      body.append(meaning);
    }
    row.append(term, body);
    return row;
  });
  list.replaceChildren(...rows);
  return disclosure;
}

/** The origin sentence's paragraph, mounted once, above the disclosure. */
function mountOrigin(doc, region, envelope) {
  let origin = byId(doc, RECIPIENT_BRIEF_IDS.origin);
  if (!origin) {
    origin = doc.createElement("p");
    origin.setAttribute("id", RECIPIENT_BRIEF_IDS.origin);
    origin.className = "local-lead-basis";
    const disclosure = byId(doc, RECIPIENT_BRIEF_IDS.disclosure);
    if (disclosure && disclosure.parentNode === region) region.insertBefore(origin, disclosure);
    else region.append(origin);
  }
  origin.textContent = sharedOriginSentence(envelope);
  return origin;
}

/**
 * Paint the recipient state into the answer region.
 *
 * @param envelope a VALIDATED envelope — the object `validateBriefEnvelope`
 *   returns, however it travelled. This function does not check it, because the
 *   contract already refused every brief that would need checking here.
 * @param options.localRateCard the reader's OWN declared rate card, or null. It
 *   reaches one sentence in the disclosure, labelled as a comparison, and no
 *   figure: repricing a colleague's brief at this reader's contract is the
 *   defect #1265 exists to prevent.
 * @returns the region, or null when this document does not carry one.
 */
export function renderRecipientBrief(doc, envelope, { localRateCard = null } = {}) {
  const region = byId(doc, RECIPIENT_BRIEF_IDS.region);
  if (!region || !envelope) return null;
  region.dataset.sharedBrief = "true";

  setText(doc, RECIPIENT_BRIEF_IDS.label, envelope.figure?.label ?? NOT_INCLUDED);
  setText(doc, RECIPIENT_BRIEF_IDS.value, sharedFigureText(envelope.figure));
  setText(doc, RECIPIENT_BRIEF_IDS.marker, SHARED_MARKER);
  const grade = byId(doc, RECIPIENT_BRIEF_IDS.grade);
  if (grade) {
    grade.textContent = `Confidence: ${envelope.confidence?.level ?? "not graded"}`;
    grade.dataset.grade = envelope.confidence?.level ?? "ungraded";
  }
  // The destination goes in the region's own answer sentence, as text. The
  // anchor under it is taken out of the tree and out of the tab order: it is
  // this reader's route to their own action centre, and the move above it is
  // the sender's. Offering it here is the write-back this state must not have.
  setText(doc, RECIPIENT_BRIEF_IDS.destination,
    `Start here: ${envelope.destination?.statement ?? NOT_INCLUDED}`);
  const action = byId(doc, RECIPIENT_BRIEF_IDS.action);
  if (action) action.hidden = true;

  mountOrigin(doc, region, envelope);
  renderRecipientDisclosure(doc, envelope, { localRateCard });
  return region;
}

/**
 * Say why a brief was refused, once, above the region — and change nothing else.
 *
 * A paragraph in the open, never inside a disclosure element: the harness reads
 * through a shut one and a real browser does not. Not a live region either — it
 * is painted during boot, and a polite region written on load speaks over the
 * answer the reader came for.
 */
export function announceRefusedBrief(doc, result) {
  const region = byId(doc, RECIPIENT_BRIEF_IDS.region);
  if (!region?.parentNode || !result) return null;
  let notice = byId(doc, RECIPIENT_BRIEF_IDS.notice);
  if (!notice) {
    notice = doc.createElement("p");
    notice.setAttribute("id", RECIPIENT_BRIEF_IDS.notice);
    notice.className = "local-lead-basis";
    region.parentNode.insertBefore(notice, region);
  }
  notice.textContent = `${result.summary}. ${result.statement} ${result.remedy}`;
  notice.dataset.outcome = result.reason;
  return notice;
}

/**
 * Read whatever the address carries and paint the outcome.
 *
 * THREE OUTCOMES AND NO FOURTH. A brief is painted whole; an address with no
 * brief on it changes nothing at all; a refused brief gets one paragraph above
 * an answer region that is still the fully functional one the boot painted.
 *
 * @returns the shared reader's own frozen result, so a caller can branch on the
 *   named reason without a second vocabulary of absences.
 */
export function applyRecipientBrief(doc = globalThis.document, { hash = "", localRateCard = null } = {}) {
  const read = readSharedBriefingFragment(hash);
  if (read.ok) renderRecipientBrief(doc, read.envelope, { localRateCard });
  else if (read.reason !== SHARE_DECODE_REASON.absent) announceRefusedBrief(doc, read);
  return read;
}
