// The home page's counted figure: the merged pull requests public GitHub is
// reporting right now, beside the feeds it was counted from.
//
// Everything it knows about the number comes from ./public-merges.js, which the
// Agent observatory reads too — the same request, the same definition of a
// merge, the same refusal to count an undated or empty response. Given one
// GitHub response the two pages therefore show one number, and neither can be
// corrected without the other.
//
// WHAT THIS BLOCK MAY NOT DO. It may not invent. The request is unauthenticated
// and routinely rate-limited, so the block used to be blank exactly when a
// reader arrived — the one figure the page offers as checkable, missing. It now
// has three counts it can reach, in one order, decided in one place
// (./merged-count-resolution.js): the live response, then this browser's
// retained count from ./merged-count-retention.js, then the baseline committed
// in ./pr-count-baseline.js. Exactly one of them renders, so an earlier figure
// is never left standing beside a live one as a second number.
//
// THE BASELINE IS NOT A SEED. It is a count somebody took from the same two
// public feeds, committed with the instant they took it, and it renders saying
// so. What it replaced was a first-time visitor meeting a sentence where the
// site's one checkable figure belongs — the visitor with the least reason to
// believe the rest of the page, shown the least proof. The served document still
// authors no digit: every figure here is painted by this module from a record
// that carries its own date.
//
// NO FIGURE IS EVER UNDATED HERE. A live count carries the response time; a
// retained one carries the sentence saying it is not live and the date it was
// taken. Both are plain text in the status region — nothing about a stale number
// is behind a disclosure, a tooltip, or a title attribute — and the feed links
// below survive every state, because the state with no live number is the one
// where a reader most needs to go and count it themselves.
import {
  EVENTS_URLS,
  SOURCE_REPOSITORIES,
  UNAVAILABLE_REASONS,
  feedLinkText,
  loadMergedCount,
  mergedCountUnit,
  unavailableSentences,
} from "./public-merges.js";
import {
  RETAINED_LEAD,
  browserCountStorage,
  formatRetainedClock,
  formatRetainedDate,
  readRetainedCount,
  writeRetainedCount,
} from "./merged-count-retention.js";
import { BASELINE_LEAD, MERGED_COUNT_SOURCES, resolveMergedCount } from "./merged-count-resolution.js";
import { baselineCountRecord } from "./pr-count-baseline.js";

function appendText(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

/** The digit and the words for it, the two of them always rendered together. */
function appendCount(value, count) {
  appendText(value, "strong", String(count));
  appendText(value, "span", ` ${mergedCountUnit(count)}`);
}

/**
 * When the figure above was taken, as text a reader reads and a machine parses.
 *
 * The time element carries the whole instant in its datetime, and the words
 * beside it are the same ISO date and UTC clock the observatory prints, so one
 * count read on two pages is never two different-looking stamps.
 */
function appendStamp(source, date) {
  const stamp = appendText(source, "time", formatRetainedDate(date));
  stamp.dateTime = date.toISOString();
  appendText(source, "span", ` at ${formatRetainedClock(date)}.`);
  return stamp;
}

// The state this block paints for each tier the shared resolver can land on,
// and the clause in front of that state's date. The ordering itself is not here
// — it is in ./merged-count-resolution.js, which the observatory reads too, so
// the two surfaces cannot rank one set of counts two ways.
const FIGURE_STATES = Object.freeze({
  [MERGED_COUNT_SOURCES.live]: Object.freeze({
    state: "live",
    lead: `Counted from public GitHub activity in ${SOURCE_REPOSITORIES.join(" and ")}, as of `,
  }),
  [MERGED_COUNT_SOURCES.earlier]: Object.freeze({ state: "retained", lead: RETAINED_LEAD }),
  [MERGED_COUNT_SOURCES.baseline]: Object.freeze({ state: "baseline", lead: BASELINE_LEAD }),
});

/**
 * Paint the figure, or the sentence that stands in for it.
 *
 * Which count wins is not decided here: `resolveMergedCount` is given every
 * candidate this load holds and returns exactly one, so this function paints one
 * figure and never two. A live result counts as a candidate only when it says
 * `ok`, carries a whole non-negative count, AND carries the time the response
 * arrived — an undated figure is one a reader cannot check. Every state's words
 * differ in the sentence itself rather than in styling, and only the live one is
 * undated by nothing but its own response time.
 *
 * Given no candidate at all — which is what a render called by hand with a
 * half-shaped result gets — it lands on the reason and paints no digit, because
 * the one thing this block must never do is render a number nothing returned.
 */
export function renderPublicMerges(root = document, result = {}) {
  const section = root.querySelector("#public-merges");
  const readout = root.querySelector("#public-merges-readout");
  if (!section || !readout) return null;
  const shown = resolveMergedCount({
    live: result?.ok === true ? { count: result.count, takenAt: result.asOf } : null,
    retained: result?.retained,
    baseline: result?.baseline,
  });
  const figure = FIGURE_STATES[shown.source] ?? null;
  section.dataset.state = figure ? figure.state : "unavailable";

  const value = document.createElement("p");
  if (figure) {
    appendCount(value, shown.count);
    const source = document.createElement("p");
    // Sentences a reader tells apart without a colour: a live count says where
    // it was counted from, a retained one says GitHub did not answer and this is
    // the last count this browser took, and the baseline says in so many words
    // that it is not live. Each ends in its own date.
    appendText(source, "span", figure.lead);
    appendStamp(source, shown.takenAt);
    readout.replaceChildren(value, source);
  } else {
    // Two sentences, because one of them is not enough to leave with. The first
    // is the honest absence; the second says what was being counted and where a
    // reader may go and count it, which is what the feed links below are for.
    // The live region announces both, so a reader who arrives after the failure
    // hears the same thing a reader who was waiting hears. They are the shared
    // module's sentences, so the observatory's empty state reads word for word
    // the same as this one.
    const [absence, subject] = unavailableSentences(result?.reason ?? UNAVAILABLE_REASONS.unreachable);
    value.textContent = absence;
    readout.replaceChildren(value);
    appendText(readout, "p", subject);
  }
  return section;
}

/**
 * Verification, by hand: the exact responses the count is computed from, so a
 * reader can open one and count the merges themselves. They are built from the
 * requested URLs rather than typed beside them, which is what makes them the
 * same links the observatory carries — and they are painted in every state,
 * because the state with no number is the one where a reader needs them most.
 */
export function renderPublicMergeSources(root = document) {
  const list = root.querySelector("#public-merges-sources");
  if (!list) return null;
  list.replaceChildren(...EVENTS_URLS.map((url, index) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.textContent = feedLinkText(SOURCE_REPOSITORIES[index]);
    item.append(link);
    return item;
  }));
  return list;
}

/**
 * The links first, then the best dated count this page load already holds, then
 * the live count once GitHub has answered either way.
 *
 * The earlier figure is painted before the request resolves on purpose: a
 * rate-limited reader — and a first-time reader, who has nothing retained and
 * gets the committed baseline — reads a dated number while the live request is
 * still in flight, rather than a sentence that is about to be replaced by the
 * same sentence. A live response then overwrites it and is written back, so the
 * next visit starts from this response rather than an older one. Both paints go
 * through the one resolver, so the second cannot rank the same counts
 * differently from the first.
 */
export async function loadPublicMerges(root = document, fetcher = fetch, storage = browserCountStorage()) {
  renderPublicMergeSources(root);
  const retained = readRetainedCount(storage);
  const baseline = baselineCountRecord();
  renderPublicMerges(root, { ok: false, reason: UNAVAILABLE_REASONS.pending, retained, baseline });
  const result = await loadMergedCount(fetcher);
  if (result.ok) writeRetainedCount(storage, result);
  renderPublicMerges(root, { ...result, retained, baseline });
  return result;
}

if (typeof document !== "undefined" && document.querySelector?.("#public-merges-readout")) {
  loadPublicMerges();
}
