// The release brief's words: one release, and the reasoning behind it, as plain
// text a manager can paste into a mail, a ticket, or a board pack.
//
// WHY THIS IS ITS OWN MODULE. The brief is the only thing on the Releases page
// that leaves the page. Everything around it — the disclosure, the filters, the
// clipboard — can be rebuilt without changing what a reader receives, and the
// words can change without touching any of that. Keeping them apart means the
// wording is asserted directly (record in, string out) instead of being read
// back out of rendered markup, which would be testing the renderer.
//
// PURE, AND WITHOUT A CYCLE. Nothing here reads a clock, the DOM, or storage,
// and it imports only the shared decision vocabulary. releases.js does the
// resolving — it owns `resolveRelease`, and it owns the field fallbacks a
// release record needs — and hands the results down. That direction is the one
// that keeps releases.js free to import this module without the two of them
// importing each other.
//
// WHAT "MANAGER-READY" ADDED. The brief used to name each linked decision and
// its status. That answers *what* shipped. A reader deciding whether to sign
// off also needs *who owns it* and *why it was taken*, which are the decision's
// own owner and context fields — so both are on the brief now, under the
// decision they belong to, in the log's own field names.

import { canonicalDecisionStatus } from "./decision-status.js";

// ---------------------------------------------------------------------------
// The two disclosures, never both, never neither.
//
// A brief arrives somewhere with none of the page's framing around it, so it
// has to carry its own provenance. Which line a record gets is decided from the
// distinction the page already draws — the example ids, the same set that
// badges a row "Example record" — rather than from a new field or a guess: a
// seeded example cannot be described as something written in this browser, and
// a release the visitor recorded cannot be described as a demonstration of the
// product. The browser-local line is deliberately not Social's wording:
// Social's posts are hosted records, these are in this browser's storage and
// nowhere else, and saying otherwise would promise a reader durability they do
// not have.
// ---------------------------------------------------------------------------

export const RELEASE_BRIEF_EXAMPLE_LINE =
  "Example record: invented to demonstrate Shiplog. It uses no customer or production data, and it is not a customer result.";
export const RELEASE_BRIEF_BROWSER_LINE =
  "Recorded in this browser: this release is stored only in this browser, and it is not a shared hosted record.";

/** The per-decision version of the example line, for a seeded decision a real release links. */
export const EXAMPLE_DECISION_NOTE = "Example decision: invented to demonstrate Shiplog, not a customer result.";

export const NO_SUMMARY_TEXT = "No summary recorded.";
export const NO_CONTEXT_TEXT = "No context recorded.";

// What the brief says about a linked id it could not resolve.
//
// The honest scope, not a verdict on the decision. This summary is built from
// the decisions this browser holds; an id that is not among them may still be a
// real decision in somebody else's log, lost in an export/import round trip, or
// never recorded at all. Claiming it does not exist would be a stronger
// statement than the lookup can support, so the line names what is missing
// *here* and stops there. It is never omitted: a brief that quietly dropped a
// dangling reference would claim the release carried fewer decisions than it
// recorded.
export const UNRESOLVED_DECISION_NOTE =
  "Not available in this log: this browser holds no decision with that id, so its status, owner and context are not included here.";

const unresolvedDecisionLine = (id) => `Linked decision ${id} is not in this log.`;

// Linked-decision fields arrive from storage and from imports, so a decision
// may reach here without a usable title. Naming it by id keeps the follow-up
// specific — "resolve d-queue" is still actionable; "resolve a decision" is not.
// Exported because the rendered row names a decision the same way, and two
// spellings of this fallback are two spellings that can drift apart.
export function decisionLabel(decision) {
  for (const value of [decision?.title, decision?.id]) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "an untitled decision";
}

// The calendar day, not a formatted one. The screen's formatter renders in the
// reader's locale, which is this browser's; a brief is read somewhere else
// entirely, and YYYY-MM-DD is the one shape that means the same day to
// everyone. It is also the shape the recorder's own date field writes.
export function briefDate(iso) {
  const day = typeof iso === "string" ? iso.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "Unknown";
}

// Status words in the casing the recorder's own options and the hero sentence
// use ("Completed, Planned, or Cancelled"), because the brief is prose. The
// vocabulary is unchanged — only the first letter.
export const capitalized = (word) => word.charAt(0).toUpperCase() + word.slice(1);

const text = (value, fallback) =>
  typeof value === "string" && value.trim() !== "" ? value.replace(/\s+/g, " ").trim() : fallback;

// Sub-lines sit under the decision they describe, indented by two spaces. Plain
// text has no other way to say "this belongs to the line above", and a reader
// pasting into a mail keeps the grouping without any markup surviving the trip.
const under = (line) => `  ${line}`;

/**
 * One release, and the reasoning behind it, as plain text.
 *
 * @param release the release's own fields, already normalised by the caller —
 *   `{ version, title, createdAt, status, owner, summary }`. The caller owns
 *   these fallbacks (`releaseOwner`, `releaseStatus`, `releaseDescription`)
 *   because the rest of the page is held to the same ones.
 * @param associations resolveRelease()'s output, in association order:
 *   `{ id, decision, missing }` per linked id, dangling references included and
 *   in place. An association may carry `example: true` when the decision it
 *   resolved to is one of the shipped examples.
 * @param options.example whether the release itself is a shipped example the
 *   visitor has not taken over. Decides which disclosure the brief ends on.
 *
 * The same record and the same decisions produce the same string every time,
 * which is what makes the wording testable at all.
 */
export function buildReleaseRationale(release = {}, associations = [], options = {}) {
  const linked = Array.isArray(associations) ? associations : [];
  const version = text(release.version, "Unknown version");
  // The title the record carries itself, not the screen's fallback: on a row
  // that fallback IS the heading, but here the version is already on the line,
  // and "v1.2.0 — v1.2.0" names one release twice.
  const title = text(release.title, "");

  const lines = [
    title === "" || title === version ? `Release brief: ${version}` : `Release brief: ${version} — ${title}`,
    `Release date: ${briefDate(release.createdAt)}`,
    `Status: ${capitalized(text(release.status, "Unknown"))}`,
    `Owner: ${text(release.owner, "Unknown")}`,
    `Summary: ${text(release.summary, NO_SUMMARY_TEXT)}`,
  ];

  if (linked.length === 0) {
    // The sentence the collapsed row and the detail view both use, so the brief
    // reads the same as the page it came from.
    lines.push("No decisions linked to this release.");
  } else {
    lines.push(`Linked decisions (${linked.length}):`);
    for (const association of linked) {
      if (!association?.decision) {
        lines.push(`- ${unresolvedDecisionLine(association?.id)}`, under(UNRESOLVED_DECISION_NOTE));
        continue;
      }
      const decision = association.decision;
      lines.push(`- ${decisionLabel(decision)} — ${capitalized(canonicalDecisionStatus(decision.status))}`);
      // Owner then context: who to ask, then why it was taken. Both are stated
      // even when the record is blank, because a brief that silently drops a
      // field reads as a decision with no owner rather than as one whose owner
      // was never written down.
      lines.push(under(`Decision owner: ${text(decision.owner, "Unknown")}`));
      lines.push(under(`Context: ${text(decision.context, NO_CONTEXT_TEXT)}`));
      if (association.example === true) lines.push(under(EXAMPLE_DECISION_NOTE));
    }
  }

  lines.push("", options.example === true ? RELEASE_BRIEF_EXAMPLE_LINE : RELEASE_BRIEF_BROWSER_LINE);
  return lines.join("\n");
}
