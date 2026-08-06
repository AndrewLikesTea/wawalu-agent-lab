// Somebody else's analysis, opened in this reader's browser (#1208).
//
// THE PROBLEM THIS SOLVES. #1206 gave a FinOps lead a link that carries their own
// retained periods in its fragment, and pointed it at the printable executive
// briefing. A CFO who follows that link to the AI FinOps page instead — the page
// the sender was reading when they copied it, and the page the site nav's one
// FinOps door lands on — meets the bundled synthetic example's $62,400 under the
// sender's sentence about our spend. Nothing on the page is wrong and the reader
// is still misled, which is the same defect the fragment path exists to prevent,
// one surface further along.
//
// So the answer region reads the fragment too, and when it carries a brief this
// build can decode it states the SENDER's figure instead of the example's.
//
// FIVE RULES THIS MODULE HOLDS.
//
//   1. **One decoder, one payload shape.** `readSharedBriefingFragment` is
//      #1206's, imported whole. This module parses no token, restates no field
//      allowlist, and validates nothing itself: a period the link module refuses
//      never reaches a slot here.
//
//   2. **The refusal never becomes an empty page.** A fragment carrying nothing
//      leaves the region byte-identical to the served document — the common
//      visit repaints nothing at all. A fragment this build refuses leaves the
//      normal page exactly as it is and adds ONE sentence saying a shared brief
//      could not be read, in the words the codec already publishes for that
//      refusal. Neither state blanks a figure.
//
//   3. **Read-only, in both directions.** Nothing here touches storage, and
//      nothing here offers to. The region carries exactly one control — the
//      anchor to the savings action center, which this module retitles and
//      never re-targets — so there is no apply, no save-to-my-analysis and no
//      edit affordance to remove: the region never had one. The reader's own
//      retained periods are not read on this path and are byte-identical after
//      it, and the shared figures reach no store.
//
//   4. **No slot is invented and no arithmetic is done.** Every value painted is
//      read off ONE retained period exactly as the sender's browser stored it.
//      In particular the figure is that period's `recoverableScenarioMinor` —
//      a MONTH, not a year — so the label beside it says the shared period
//      rather than keeping the served document's "annual", and the grade is the
//      one stored with the period rather than the local rubric's re-run.
//
//   5. **The same disclosure, with the sender's words in it.** The three parts
//      of the region's one how-we-know disclosure (#1185) are rewritten, because
//      a shared brief under "The bundled synthetic example: invented usage
//      records" is a lie about whose numbers these are. No disclosure is added,
//      none is removed, none is opened, and no focusable node is added to the
//      first screen: the summary that was the region's one tab stop still is.

import { formatUsd } from "./evolution.js";
import { SHARED_ORIGIN, SHARED_PROVENANCE_NOTE } from "./executive-briefing-source.js";
import { GRADE_LABEL } from "./finops-recoverable-confidence.js";
import { SHARE_DECODE_REASON, readSharedBriefingFragment } from "./finops-shared-briefing-link.js";

/** The slots this view writes. Authored in evolution.html; written only here. */
export const RECIPIENT_IDS = Object.freeze({
  region: "finops-recoverable-answer",
  label: "finops-recoverable-label",
  value: "finops-recoverable-value",
  marker: "finops-recoverable-marker",
  grade: "finops-recoverable-grade",
  hedge: "finops-recoverable-confidence",
  action: "finops-recoverable-action",
  provenance: "finops-recoverable-provenance",
  basis: "finops-recoverable-basis",
  limits: "finops-recoverable-limits",
  confidenceDetail: "finops-recoverable-confidence-detail",
  note: "finops-recoverable-shared-note",
});

/**
 * Whose figures the region is stating, in the DOM.
 *
 * `own` is the served document's own state and is never written back: a repaint
 * that had to say "not shared" would mean the common visit repaints at all.
 */
export const BRIEF_STATE = Object.freeze({ shared: "shared", refused: "refused" });

/** The marker beside the figure, where the served document says "Illustrative". */
export const SHARED_MARKER = "Shared brief";

/**
 * The three grades the answer region's own rubric publishes are the same three
 * words a retained period carries, so its labels are imported rather than typed
 * again. A retained period may also be `insufficient`, which that rubric has no
 * cut point and therefore no word for; it is named here and nowhere else.
 */
const gradeLabel = (grade) => GRADE_LABEL[grade] ?? "Insufficient";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

const write = (node, text) => { if (node) node.textContent = text; };

/** Whole dollars from the minor units every retained figure is stored in. */
const dollars = (minor) => formatUsd(Number.isFinite(minor) ? minor / 100 : 0);

/** Parts per million as the percent a reader reads. Display, not arithmetic. */
const share = (ppm) => `${Math.round((Number(ppm) || 0) / 10000)}%`;

/** The date half of a stored instant. Never reformatted, never re-zoned. */
const day = (instant) => (typeof instant === "string" ? instant.slice(0, 10) : "an unstated date");

/**
 * The month the region states: the sender's newest.
 *
 * The region answers with ONE figure, and a link may carry up to six periods.
 * Newest by period name, sorted here rather than trusted from the token, so a
 * reordered token cannot change which month a reader is shown.
 */
export function reportingPeriod(periods) {
  const list = Array.isArray(periods) ? periods.filter(Boolean) : [];
  return [...list].sort((left, right) =>
    String(left.period).localeCompare(String(right.period))).at(-1) ?? null;
}

/**
 * Paint the answer region as the recipient of somebody else's brief.
 *
 * @param doc the document to paint, or a stand-in.
 * @param options `{ hash }` — the location fragment, defaulting to this tab's.
 * @returns `{ state, reason, period }` when the fragment carried a brief, and
 *   `null` when it carried none. `null` is the common case and it means exactly
 *   one thing: nothing on the page was touched.
 */
export function applyRecipientBrief(doc, { hash = globalThis.location?.hash ?? "" } = {}) {
  const region = byId(doc, RECIPIENT_IDS.region);
  if (!region) return null;

  const decoded = readSharedBriefingFragment(hash);
  // Every ordinary anchor link on this site lands here, including the site
  // nav's own door into this region. It is not a failure and it is not a state.
  if (decoded.reason === SHARE_DECODE_REASON.absent) return null;

  const note = byId(doc, RECIPIENT_IDS.note);
  if (!decoded.ok) {
    // The normal page stands, whole, and one sentence says why the link did not
    // change it — in the codec's own words for this refusal, so the sentence a
    // reader is given here and the one the printable briefing gives them agree.
    write(note, `${decoded.summary}. ${decoded.remedy}`);
    if (note) note.hidden = false;
    region.dataset.brief = BRIEF_STATE.refused;
    region.dataset.briefReason = decoded.reason;
    return Object.freeze({ state: BRIEF_STATE.refused, reason: decoded.reason, period: null });
  }

  const period = reportingPeriod(decoded.periods);
  if (!period) return null;

  // The three facts that lead: the money, whose month it is, and how far the
  // sender's own browser said it could be trusted. All outside the disclosure.
  write(byId(doc, RECIPIENT_IDS.label), "Recoverable AI spend in the shared period");
  write(byId(doc, RECIPIENT_IDS.value), dollars(period.recoverableScenarioMinor));
  write(byId(doc, RECIPIENT_IDS.marker), `${SHARED_MARKER} · ${period.period}`);
  const grade = byId(doc, RECIPIENT_IDS.grade);
  write(grade, `Confidence: ${gradeLabel(period.confidence)}`);
  if (grade) grade.dataset.grade = period.confidence ?? "insufficient";
  write(byId(doc, RECIPIENT_IDS.hedge),
    `Sent by someone else, produced ${day(period.derivedAt)} — a ceiling, not a banked saving.`);

  // The one prioritized destination. Retitled, never re-targeted: the href is
  // the one the document authored, it carries no shared value, and following it
  // writes nothing here or anywhere else.
  const action = byId(doc, RECIPIENT_IDS.action);
  const unit = typeof period.topDepartmentId === "string" ? period.topDepartmentId : "";
  write(action, unit === ""
    ? "The shared brief names no first move — open the savings action center"
    : `Act first in org unit ${unit} — the one the shared brief ranks first`);
  if (action) action.dataset.available = String(unit !== "");

  paintDisclosure(doc, period, decoded.periods.length);

  region.dataset.brief = BRIEF_STATE.shared;
  region.dataset.briefReason = decoded.reason;
  return Object.freeze({ state: BRIEF_STATE.shared, reason: decoded.reason, period });
}

/**
 * The same three parts, in the same order, saying the same kinds of thing about
 * the shared month that they say about the bundled example.
 *
 * Provenance is #1206's own two sentences, imported rather than rewritten, so
 * the claim a reader is given about a link on this page cannot drift from the
 * claim the printable briefing gives them about the same link.
 */
function paintDisclosure(doc, period, count) {
  write(byId(doc, RECIPIENT_IDS.provenance),
    `${SHARED_ORIGIN} ${SHARED_PROVENANCE_NOTE} This region states the newest of the ${count} `
    + `period(s) in the link: ${period.period} of dataset ${period.dataset}, derived by the sender `
    + `on ${day(period.derivedAt)}.`);

  write(byId(doc, RECIPIENT_IDS.basis),
    `Read off one retained period exactly as the sender's browser stored it, with no arithmetic in `
    + `this tab: ${dollars(period.recoverableScenarioMinor)} recoverable against `
    + `${dollars(period.analyzedSpendMinor)} analyzed, ${period.recordsAnalyzed} of `
    + `${period.recordsTotal} records analyzed, at ${share(period.coverageRatioPpm)} coverage. The `
    + `link carries the ranked org unit's identifier and not its display name, so the move above `
    + `names it as the sender's browser stored it.`);

  const limits = byId(doc, RECIPIENT_IDS.limits);
  write(limits,
    "These are not your figures and this page cannot check them: the sender's export was never read "
    + "here, and a link is evidence of what somebody chose to send rather than proof of who sent it. "
    + "The amount is a modelled ceiling for the one shared month, not an annual figure and not a "
    + "saving anyone has banked, and nothing on this page writes it into your own analysis. "
    + "Analyzing an export of your own answers this region with your own months instead. ");
  // The grade's explanation keeps its own slot inside Limits, as #1186 put it:
  // rewriting the part replaces the span, so it is rebuilt with the sentence
  // that is true of a shared grade rather than of a locally computed one.
  if (limits && doc?.createElement) {
    const detail = doc.createElement("span");
    detail.setAttribute("id", RECIPIENT_IDS.confidenceDetail);
    detail.textContent = `The grade beside the figure is the ${gradeLabel(period.confidence)} one the `
      + "sender's browser stored with this period. It was not recomputed here, and this build does "
      + "not know which rubric version produced it.";
    limits.append(detail);
  }
}
