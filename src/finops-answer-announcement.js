// One answer change, one sentence, one region.
//
// THE PROBLEM THIS SOLVES. A lead who imports their own export into
// /evolution.html watched the answer change and heard nine things about it. The
// answer region, the page-status strip, the journey rail, the partial-evidence
// note, the import panel's own status, the result notice, the headline rail and
// the delivery comparison are all polite live regions, and every one of them is
// repainted on the same tick an import lands. A sighted reader sees one page
// settle. A screen-reader user is read a queue: nine utterances, in whatever
// order the regions happen to be painted in, of which only the first sentence
// of one of them answers the question they came with.
//
// So this module states the rule the page kept breaking: an answer change is
// ONE announcement, from ONE region, and it carries the three things a reader
// needs to decide whether to keep listening —
//
//   1. the question the page is answering,
//   2. the headline metric, with its unit,
//   3. the single prioritized next action,
//
// in that reading order, followed by whose figures they are.
//
// It composes; it computes nothing. Every part is a string the visible slots
// are painted from, so the sentence cannot drift from what is on screen, and a
// part with nothing behind it is rendered as the reason it is unavailable
// rather than dropped — "Recoverable spend: Not yet measured" is a fact; a gap
// where a number should be is not.
//
// NOTHING FROM A READER'S FILE REACHES THIS MODULE UNREDACTED. The failure
// sentence goes through `redactDiagnostic`, the same filter the visible import
// notice uses, so a parser's message, a path, or a row's contents cannot be
// announced. Everything is returned as a string and written with `textContent`
// by the one writer below; no markup is ever assigned.

import { STAND_IDS } from "./finops-stand.js";
import { redactDiagnostic } from "./local-import-flow.js";

/** The page's one announcer. It already ships visually hidden and polite. */
export const ANSWER_ANNOUNCER_ID = STAND_IDS.live;

/**
 * The regions that ECHO an answer change, silenced so one change is one message.
 *
 * Each of these is repainted on the tick an import lands, is visible on screen,
 * and says something the sentence below already says — the page is showing your
 * imported analysis, the figure it is showing, what to do about it. They keep
 * their text and their role; only the announcement is taken away, because the
 * announcement was a duplicate. `aria-live="off"` is explicit rather than
 * removed: an explicit value overrides the implicit one a `role="status"` or
 * `role="alert"` carries, and leaving the attribute off would leave the role
 * speaking.
 *
 * A region belongs on this list only if it echoes THE ANSWER. The mapping
 * step's own status is not here: it reports on a step the reader is standing
 * in, before there is an answer to change.
 */
export const ECHOED_LIVE_REGION_IDS = Object.freeze([
  // "This page is showing your imported analysis" — the same fact the sentence
  // below closes with, on a strip that also carries the page's load state.
  "finops-load-state",
  // The import panel's own outcome pair. Both are rerouted: the visible notice
  // stays exactly where a sighted reader looks for it, and the sentence a
  // screen-reader user hears is composed here instead.
  "local-import-state",
  "local-import-alert",
  // Evidence layers restating the answer's own figure and its next action.
  "finops-headline-live",
  "partial-evidence-live",
  "local-result-notice",
  "spend-per-delivery-live",
  "coverage-live",
  // The journey rail, which re-announces the whole trajectory on every import.
  // The workspace's own switch announcer (`finops-workspace-switch-live`) is
  // untouched, so moving between destinations is still announced.
  "finops-journey-live",
]);

/** A fragment closed off as a sentence, so parts can be read as one line. */
function sentence(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return "";
  return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The one sentence an answer change is announced as.
 *
 * Composed from the same headline record `finops-stand-view.js` paints the
 * visible slots from — never from a second reading of the analysis.
 *
 * `trust` is the rung the reader's own brief just MOVED to (#1104), and it is
 * carried HERE rather than spoken by a second region: the ladder changes on the
 * same tick the answer does, and a polite region of its own would queue a second
 * utterance behind the sentence that answers the question. It sits after the
 * next action and before the source, so the reading order stays question →
 * figure → action → how far it carries → whose figures these are. An answer
 * whose rung did not move — and the bundled example, a cleared import, the boot
 * paint, none of which are on the ladder at all — passes nothing and composes
 * exactly the sentence it composed before. `createTrustAnnouncer` in
 * src/finops-trust-ladder.js is what decides which of those two this is.
 */
export function answerAnnouncement(headline, { trust = "" } = {}) {
  if (!headline) return "";
  const metric = headline.recoverable;
  const action = headline.action;
  return [
    sentence(headline.question),
    sentence(metric?.label && metric?.value ? `${metric.label}: ${metric.value}` : ""),
    sentence(action?.available && action?.label
      ? `Do this next: ${action.label}`
      : `Do this next: ${headline.withheld?.nextStep || action?.label || ""}`),
    sentence(String(trust ?? "").trim()),
    sentence(headline.label ? `Source: ${headline.label}` : ""),
  ].filter(Boolean).join(" ");
}

/**
 * The one sentence a rejected file is announced as: what went wrong, what to do
 * about it, and the fact the reader most needs — that the answer they were
 * reading is still the answer on screen.
 */
export function importFailureAnnouncement(diagnostic) {
  return [
    "This file was not analyzed.",
    sentence(redactDiagnostic(diagnostic?.text ?? "")),
    sentence(redactDiagnostic(diagnostic?.recovery ?? "")),
    "The answer on screen did not change.",
  ].filter(Boolean).join(" ");
}

/**
 * Write the page's one announcement.
 *
 * BLANK, THEN SET, and done here once rather than in each of nine regions. A
 * polite region handed the same string twice is a no-op for the assistive
 * technology reading it, and a reader who imports, clears, and imports the same
 * export again is owed the sentence every time.
 *
 * This is also what serializes the announcer. Two answer changes in one turn —
 * an import that lands and is cleared immediately after — are two writes to the
 * same node, so the reader hears the state they ended up in rather than a stack
 * of the states they passed through.
 *
 * `announce: false` IS FOR THE PAINT THAT IS NOT A CHANGE. The page's boot paint
 * puts the bundled example on screen, and a polite region rewritten on load
 * speaks a figure the reader never asked for, over whatever they were doing. The
 * build seeds this region with that same sentence (scripts/seed-first-screen.mjs)
 * so it is already carrying it when the document is parsed; on the boot paint
 * the sentence is unchanged, nothing is written, and nothing is spoken. A boot
 * that composes a DIFFERENT sentence — a document that was not seeded — still
 * gets it, written once rather than blanked and re-set. Every later paint is a
 * real change and announces normally.
 */
export function announceAnswer(doc, message, { announce = true } = {}) {
  const region = doc?.getElementById?.(ANSWER_ANNOUNCER_ID) ?? null;
  if (!region || !message) return null;
  if (!announce) {
    if (region.textContent !== message) region.textContent = message;
    return message;
  }
  region.textContent = "";
  region.textContent = message;
  return message;
}

/**
 * Take the voice away from every region that only echoes the answer.
 *
 * Called once, at boot, before anything is painted. Attributes only: nothing is
 * hidden, moved, or emptied, so every one of these regions reads exactly as it
 * did to a reader looking at the page.
 */
export function silenceEchoedRegions(doc, ids = ECHOED_LIVE_REGION_IDS) {
  const silenced = [];
  for (const id of ids) {
    const region = doc?.getElementById?.(id) ?? null;
    if (!region) continue;
    region.setAttribute("aria-live", "off");
    silenced.push(id);
  }
  return silenced;
}
