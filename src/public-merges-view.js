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
// remembers, through ./merged-count-retention.js: a count public GitHub actually
// returned is kept with the moment it was taken, and shown again, dated and
// named as an earlier count, when the next request does not answer. That is the
// only number this block can show without a live response. There is no seed, no
// default, and no constant: a browser that has never had an answer from GitHub
// still gets the honest empty sentence, and the document still ships in that
// state so a slow response cannot flash a placeholder digit.
//
// NO FIGURE IS EVER UNDATED HERE. A live count carries the response time; a
// retained one carries the sentence saying it is not live and the date it was
// taken. Both are plain text in the status region — nothing about a stale number
// is behind a disclosure, a tooltip, or a title attribute — and the feed links
// below survive every state, because the state with no live number is the one
// where a reader most needs to go and count it themselves.
import {
  COUNTED_SUBJECT_SENTENCE,
  EVENTS_URLS,
  SOURCE_REPOSITORIES,
  UNAVAILABLE_REASONS,
  feedLinkText,
  loadMergedCount,
  mergedCountUnit,
  unavailableSentence,
} from "./public-merges.js";
import {
  RETAINED_LEAD,
  browserCountStorage,
  formatRetainedClock,
  formatRetainedDate,
  readRetainedCount,
  writeRetainedCount,
} from "./merged-count-retention.js";

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

/** A record is only a figure when it carries a whole count AND its moment. */
const datedCount = (record) => (record
  && Number.isInteger(record.count) && record.count >= 0
  && record.takenAt instanceof Date && !Number.isNaN(record.takenAt.getTime())
  ? record : null);

/**
 * Paint the figure, or the sentence that stands in for it.
 *
 * A result is only a live number when it says so, carries a whole non-negative
 * count, AND carries the time the response arrived: an undated figure is one a
 * reader cannot check, so it is not one this block shows. A failure falls to
 * `result.retained` — the last count this browser saw GitHub return — and to the
 * reason only when there is no such count. Anything else, including a shape this
 * function does not recognise, lands on the reason, because the one thing this
 * block must never do is render a digit nothing returned.
 */
export function renderPublicMerges(root = document, result = {}) {
  const section = root.querySelector("#public-merges");
  const readout = root.querySelector("#public-merges-readout");
  if (!section || !readout) return null;
  const live = result?.ok === true ? datedCount({ count: result.count, takenAt: result.asOf }) : null;
  const retained = live ? null : datedCount(result?.retained);
  section.dataset.state = live ? "live" : retained ? "retained" : "unavailable";

  const value = document.createElement("p");
  if (live || retained) {
    const shown = live ?? retained;
    appendCount(value, shown.count);
    const source = document.createElement("p");
    // Two sentences a reader can tell apart without a colour: a live count says
    // where it was counted from, and a retained one says that GitHub did not
    // answer and that this number is the earlier one. Each ends in its own date.
    appendText(source, "span", live
      ? `Counted from public GitHub activity in ${SOURCE_REPOSITORIES.join(" and ")}, as of `
      : RETAINED_LEAD);
    appendStamp(source, shown.takenAt);
    readout.replaceChildren(value, source);
  } else {
    // Two sentences, because one of them is not enough to leave with. The first
    // is the honest absence; the second says what was being counted and where a
    // reader may go and count it, which is what the feed links below are for.
    // The live region announces both, so a reader who arrives after the failure
    // hears the same thing a reader who was waiting hears.
    value.textContent = unavailableSentence(result?.reason ?? UNAVAILABLE_REASONS.unreachable);
    readout.replaceChildren(value);
    appendText(readout, "p", COUNTED_SUBJECT_SENTENCE);
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
 * The links first, then whatever this browser already knows, then the count once
 * GitHub has answered either way.
 *
 * The retained figure is painted before the request resolves on purpose: a
 * rate-limited reader gets a dated number to read while the live request is
 * still in flight, rather than a sentence that is about to be replaced by the
 * same sentence. A live response then overwrites it and is written back, so the
 * next visit starts from this response rather than an older one.
 */
export async function loadPublicMerges(root = document, fetcher = fetch, storage = browserCountStorage()) {
  renderPublicMergeSources(root);
  const retained = readRetainedCount(storage);
  if (retained) renderPublicMerges(root, { ok: false, reason: UNAVAILABLE_REASONS.pending, retained });
  const result = await loadMergedCount(fetcher);
  if (result.ok) writeRetainedCount(storage, result);
  renderPublicMerges(root, { ...result, retained });
  return result;
}

if (typeof document !== "undefined" && document.querySelector?.("#public-merges-readout")) {
  loadPublicMerges();
}
