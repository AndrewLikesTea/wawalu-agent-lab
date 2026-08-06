// "Open a shared brief" — a colleague's brief, read off disk, in this tab only.
//
// THE PROBLEM THIS SOLVES. #1206 made a brief shareable as a link. A link is not
// always the thing a recipient has: it gets cut short by a chat client, it is
// awkward to attach to a ticket, and it cannot be filed. The remaining ask is a
// FILE — one a recipient opens read-only, reads, and closes, WITHOUT it becoming
// one of their own retained records. A brief that quietly lands in the reader's
// workspace is a brief they will re-share next quarter as their own figures.
//
// FIVE RULES THIS MODULE HOLDS.
//
//   1. **NO NETWORK, EITHER DIRECTION.** The file is read with the browser's own
//      `File.text()` — the local read a file input already performed — with a
//      `FileReader` fallback for the same. There is no upload, no fetch, and no
//      URL built from anything the file said. The module imports nothing that
//      can reach the network.
//
//   2. **NO WRITE.** Nothing here imports storage. Opening a brief cannot touch
//      the reader's own retained records, and `tests/finops-brief-envelope.test.js`
//      asserts the workspace export is byte-identical across an open rather than
//      taking this paragraph's word for it.
//
//   3. **ALL OR NOTHING.** The WHOLE envelope is validated before the caller is
//      handed anything. A refusal calls `onBrief` never — not with a partial
//      brief, not with a null — so a recipient view cannot be painted with a
//      figure whose caveats did not survive the file.
//
//   4. **EVERY REFUSAL IS NAMED WHERE THE READER IS.** The status paragraph gets
//      the envelope contract's own three sentences, as TEXT, and
//      `data-outcome` carries the code so a state this surface can reach is a
//      state a test can name. It is a paragraph in the open, never inside a
//      disclosure element: the test harness reads through a shut one and a real
//      browser does not.
//
//   5. **THE FILE IS HOSTILE.** Every string it supplies reaches the DOM through
//      `textContent` and nothing else. This module writes no `innerHTML`, builds
//      no `href` or `src`, and passes on only the projected envelope — the
//      contract dropped the unknown fields before this module saw them.

import {
  BRIEF_ENVELOPE_REASON, readBriefEnvelopeText,
} from "./finops-brief-envelope.js";

/** The ids this control owns. Authored in executive-briefing.html, written here. */
export const OPEN_BRIEF_IDS = Object.freeze({
  block: "open-shared-brief",
  input: "open-shared-brief-file",
  status: "open-shared-brief-status",
});

/** The control's accessible name. It says what it opens, not "Choose file". */
export const OPEN_BRIEF_LABEL = "Open a shared brief file";

/** Empty until a file is chosen: this page allows one voice per change. */
export const OPEN_BRIEF_IDLE = "";

/** What a brief that opened says. Names the source, and what did NOT happen. */
export const OPEN_BRIEF_ACCEPTED =
  "Opened from the file you chose, read in this tab. It is shown read-only and was not added to this "
  + "browser's own retained figures.";

/** What the file that opened is called on screen. Never a path. */
export const OPEN_BRIEF_OUTCOME = Object.freeze({
  accepted: "opened",
  unreadable: "file_unreadable",
});

/** The reader could not hand over the bytes at all — permission, or a vanished file. */
export const OPEN_BRIEF_UNREADABLE = Object.freeze({
  summary: "That file could not be read",
  statement: "The browser did not hand this page the file's text. Nothing was uploaded — the read is "
    + "local — so this is the browser refusing the file, not a transfer that failed.",
  remedy: "Nothing of yours was read or changed. Choosing the file again, or copying it somewhere this "
    + "browser can reach, is what makes it readable.",
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/**
 * Get a file's text without a network and without trusting either API to exist.
 *
 * `File.text()` where the browser has it, `FileReader` where it does not. Both
 * are local reads of a handle the reader themselves chose; neither transmits.
 */
export function readFileText(file) {
  if (!file) return Promise.reject(new TypeError("no file"));
  if (typeof file.text === "function") return Promise.resolve(file.text());
  return new Promise((resolve, reject) => {
    const Reader = globalThis.FileReader;
    if (typeof Reader !== "function") {
      reject(new TypeError("no FileReader"));
      return;
    }
    const reader = new Reader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

/**
 * Read one chosen file into a verdict. No DOM, no store, no network.
 *
 * @returns the envelope contract's own frozen result, or the `unreadable`
 *   refusal when the browser would not give up the bytes. Total: it never
 *   rejects, because a control that has to say why cannot catch an exception in
 *   the middle of a paint.
 */
export async function openSharedBriefFile(file, { read = readFileText } = {}) {
  let text;
  try {
    text = await read(file);
  } catch {
    return Object.freeze({
      ok: false,
      reason: OPEN_BRIEF_OUTCOME.unreadable,
      envelope: null,
      periods: Object.freeze([]),
      ...OPEN_BRIEF_UNREADABLE,
    });
  }
  return readBriefEnvelopeText(text);
}

/**
 * Say what happened, in the reader's own words, as text.
 *
 * `textContent` on every path. A file's own strings never reach this function —
 * the sentences are this build's, keyed by a code from a closed set — but the
 * assignment is text either way, so a later edit cannot make it markup.
 */
export function announceSharedBrief(doc, result) {
  const status = byId(doc, OPEN_BRIEF_IDS.status);
  if (!status) return null;
  if (!result) {
    status.textContent = OPEN_BRIEF_IDLE;
    delete status.dataset.outcome;
    return status;
  }
  status.textContent = result.ok
    ? OPEN_BRIEF_ACCEPTED
    : `${result.summary}. ${result.statement} ${result.remedy}`;
  status.dataset.outcome = result.ok ? OPEN_BRIEF_OUTCOME.accepted : result.reason;
  return status;
}

/**
 * Wire the file input, once.
 *
 * @param onBrief called with the validated envelope, and ONLY on acceptance.
 *   A refusal never calls it, so a caller cannot paint half a brief by
 *   forgetting to check a flag — see rule 3.
 * @returns the input, or null when this page does not carry the control.
 */
export function bindOpenSharedBrief(doc = globalThis.document, { onBrief, read } = {}) {
  const input = byId(doc, OPEN_BRIEF_IDS.input);
  if (!input || input.dataset.wired === "true") return input;
  input.dataset.wired = "true";

  input.addEventListener("change", async () => {
    const file = input.files?.[0] ?? null;
    if (!file) {
      announceSharedBrief(doc, null);
      return;
    }
    const result = await openSharedBriefFile(file, read ? { read } : {});
    // The verdict lands before the paint. A refusal returns here, so nothing
    // downstream of this line can be reached with a brief that failed.
    announceSharedBrief(doc, result);
    if (!result.ok) return;
    onBrief?.(result.envelope);
  });

  return input;
}

/** Re-exported so a page can branch on a refusal without a second import. */
export { BRIEF_ENVELOPE_REASON };
