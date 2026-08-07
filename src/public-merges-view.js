// The home page's counted figure: the merged pull requests public GitHub is
// reporting right now, beside the feeds it was counted from.
//
// Everything it knows about the number comes from ./public-merges.js, which the
// Agent observatory reads too — the same request, the same definition of a
// merge, the same refusal to count an undated or empty response. Given one
// GitHub response the two pages therefore show one number, and neither can be
// corrected without the other.
//
// WHAT THIS BLOCK MAY NOT DO. It may not remember. There is no snapshot, no
// cached last value, and no recorded fallback on this page: when GitHub does not
// answer, the block says which way it failed and shows nothing that looks like a
// figure — no zero, no dash, no greyed digit waiting to be replaced. That is
// also the state the document ships in, so a slow response cannot flash a
// placeholder a reader could quote. The observatory can show a dated recorded
// count in the same situation; that number is a durable record with its date
// rendered beside it, and this page carries no such record to render.
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

function appendText(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

/**
 * Paint the figure, or the sentence that stands in for it.
 *
 * A result is only a number when it says so and carries a whole non-negative
 * count. Anything else — a failure, a refusal, a shape this function does not
 * recognise — lands on the reason, because the one thing this block must never
 * do is render a digit nothing returned.
 */
export function renderPublicMerges(root = document, result = {}) {
  const section = root.querySelector("#public-merges");
  const readout = root.querySelector("#public-merges-readout");
  if (!section || !readout) return null;
  const counted = result?.ok === true && Number.isInteger(result.count) && result.count >= 0;
  section.dataset.state = counted ? "live" : "unavailable";

  const value = document.createElement("p");
  if (counted) {
    appendText(value, "strong", String(result.count));
    appendText(value, "span", ` ${mergedCountUnit(result.count)}`);
    const source = document.createElement("p");
    source.textContent = `Counted from public GitHub activity in ${SOURCE_REPOSITORIES.join(" and ")}, `
      + "each time this page is opened.";
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

/** The links first, then the count once GitHub has answered either way. */
export async function loadPublicMerges(root = document, fetcher = fetch) {
  renderPublicMergeSources(root);
  const result = await loadMergedCount(fetcher);
  renderPublicMerges(root, result);
  return result;
}

if (typeof document !== "undefined" && document.querySelector?.("#public-merges-readout")) {
  loadPublicMerges();
}
