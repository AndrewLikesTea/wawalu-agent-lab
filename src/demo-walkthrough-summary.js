// The finished demo, as a summary a buyer can copy (#2793).
//
// Once this browser holds a decision and a release that links it, the four-step
// guide on Releases has nothing left to ask for but a read. This states what
// was recorded — the decision's title, owner and status, the release, and that
// the one links the other — and offers it as plain text plus a route to a pilot
// conversation.
//
// ONE BUILDER FOR WHAT IS SHOWN AND WHAT IS COPIED. `walkthroughSummary` returns
// the lines; the page paints exactly those lines and the copy control writes
// exactly their join, so the two cannot say different things.
//
// GATED ON THE STORE, NOT ON A FLAG. The records come from the same tracked
// pair the guide reads (trackedRecords in demo-progress.js), re-read on every
// change. A missing, deleted or unlinked record yields null and the whole
// region stays hidden — no summary, no copy control, no pilot route framed as a
// finish. Step four (reading the release) leaves nothing in the store, so the
// summary appears once steps one to three are recorded and is itself the check
// step four asks for.
//
// Every value is user input and is written as textContent, never markup.

import { decisionDetailHref, releaseDetailHref } from "./releases.js";
import { canonicalDecisionStatus } from "./decision-status.js";
import { onRecordsChanged } from "./shiplog-records.js";

export const WALKTHROUGH_SUMMARY_TITLE = "Shiplog demo walkthrough summary";
export const WALKTHROUGH_SUMMARY_PROVENANCE =
  "These are browser-local demo records created in this browser. "
  + "This is evidence from this browser-based demo, not customer results or production evidence, "
  + "a benchmark, a testimonial, or an externally verified claim.";
export const WALKTHROUGH_COPY_MESSAGES = Object.freeze({
  copied: "Walkthrough summary copied.",
  failed: "Could not copy: this browser refused clipboard access. Select the summary above and copy it by hand.",
  unavailable: "Could not copy: this browser offers no clipboard access here. Select the summary above and copy it by hand.",
  ready: "Demo complete. Your walkthrough summary is ready to copy.",
});

// One line per stored value: a name that carries a line break, control or bidi
// character could otherwise forge its own line (or reorder the caveat) in the
// text a buyer pastes into email.
const text = (value) => (typeof value === "string"
  ? value.replace(/[\s\p{Cc}\p{Cf}]+/gu, " ").trim()
  : "");

/**
 * The summary of a finished walkthrough, or null when it is not finished.
 *
 * Finished means both records exist and the release lists the decision among
 * its linked decisions. Returns `{ lines, text }`: `lines` are painted one per
 * paragraph, and `text` is the title plus those lines, one per line.
 */
export function walkthroughSummary(decision, release) {
  if (!decision?.id || !release?.id) return null;
  const linked = Array.isArray(release.decisionIds) ? release.decisionIds : [];
  if (!linked.includes(decision.id)) return null;
  const title = text(decision.title) || text(String(decision.id));
  const owner = text(decision.owner) || "not recorded";
  const status = canonicalDecisionStatus(text(decision.status)) || "not recorded";
  const releaseId = text(release.version) || text(String(release.id));
  const lines = [
    `Decision: “${title}” — owner ${owner}, status ${status}.`,
    `Release: ${releaseId}.${text(release.title) ? ` Title: “${text(release.title)}”.` : ""}`,
    `Release ${releaseId} links to the decision “${title}”.`,
    WALKTHROUGH_SUMMARY_PROVENANCE,
  ];
  return {
    lines,
    text: [WALKTHROUGH_SUMMARY_TITLE, ...lines].join("\n"),
    links: [
      { href: decisionDetailHref(decision.id), label: `Reopen decision “${title}” in this browser` },
      { href: releaseDetailHref(release.id), label: `Reopen release ${releaseId} in this browser` },
    ],
  };
}

/**
 * Paint `summary` (or its absence) into `#demo-summary`.
 *
 * Returns true when the region is shown. `wasShown` is the previous answer: a
 * region that appears after the first paint says so in its own polite status
 * line, because the record that finished the demo was saved somewhere else on
 * the page and focus stays where that save left it.
 */
export function renderWalkthroughSummary(root, summary, { wasShown = null } = {}) {
  const region = root.querySelector("#demo-summary");
  if (!region) return false;
  const doc = root.ownerDocument ?? root;
  const lines = root.querySelector("#demo-summary-lines");
  const status = root.querySelector("#demo-summary-status");
  const records = root.querySelector("#demo-summary-records");
  region.hidden = !summary;
  if (!summary) {
    lines?.replaceChildren();
    records?.replaceChildren();
    if (status) status.textContent = "";
    return false;
  }
  lines?.replaceChildren(...summary.lines.map((line) => {
    const node = doc.createElement("p");
    node.textContent = line;
    return node;
  }));
  records?.replaceChildren(...summary.links.map(({ href, label }) => {
    const link = doc.createElement("a");
    link.setAttribute("class", "text-link");
    link.setAttribute("href", href);
    link.textContent = label;
    return link;
  }));
  if (status) status.textContent = wasShown === false ? WALKTHROUGH_COPY_MESSAGES.ready : "";
  return true;
}

/** Copy `value`, resolving to the message the status line should carry. */
export async function copyWalkthroughSummary(value, clipboard) {
  if (typeof clipboard?.writeText !== "function") return WALKTHROUGH_COPY_MESSAGES.unavailable;
  try {
    await clipboard.writeText(value);
    return WALKTHROUGH_COPY_MESSAGES.copied;
  } catch {
    return WALKTHROUGH_COPY_MESSAGES.failed;
  }
}

/**
 * Mount the summary and keep it current for the life of the page.
 *
 * `read` returns the tracked `{ decision, release }` pair; it is called again on
 * every record change and at every copy, so the copied text is the store's
 * answer at the press rather than at load.
 */
export function initWalkthroughSummary(root, { read, clipboard } = {}) {
  if (!root?.querySelector?.("#demo-summary") || typeof read !== "function") return null;
  const current = () => {
    const { decision = null, release = null } = read() ?? {};
    return walkthroughSummary(decision, release);
  };
  let shown = renderWalkthroughSummary(root, current());
  onRecordsChanged(root, () => {
    shown = renderWalkthroughSummary(root, current(), { wasShown: shown });
  });
  root.querySelector("#demo-summary-copy")?.addEventListener("click", async () => {
    const summary = current();
    const status = root.querySelector("#demo-summary-status");
    if (!summary) {
      shown = renderWalkthroughSummary(root, null);
      return;
    }
    renderWalkthroughSummary(root, summary);
    if (status) status.textContent = "";
    const message = await copyWalkthroughSummary(summary.text, clipboard ?? globalThis.navigator?.clipboard);
    if (status && current()?.text === summary.text) status.textContent = message;
  });
  return shown;
}
