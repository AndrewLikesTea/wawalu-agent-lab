// A copyable record of one revision, and the copy itself.
//
// The reader who has just improved a prompt has somewhere to put the result —
// a pull request, a ticket, a message to the colleague who wrote the original.
// Retyping four figures out of a panel is where that stops happening, so the
// panel offers the lines instead. What it offers is a *summary*, not an export:
// it is assembled here, handed to the clipboard, and never written anywhere
// this tab does not already hold it.
//
// TWO RULES THIS MODULE HOLDS.
//
//   1. **Nothing pasted is ever in the summary.** Every line is built from the
//      change model and the contract's own static copy — figures, grades,
//      identifiers, and titles the rubric wrote. The prompt text is not a field
//      this module can reach, and `buildCoachingSummary` takes a change model
//      and a result rather than a session, so it could not reach one.
//   2. **A copy that did not happen never reports success.** Every rung of the
//      fallback returns which one succeeded, and the last rung is honest: it
//      says copying is unavailable and hands the reader selectable text. A
//      button that says "Copied" over an empty clipboard is worse than one that
//      says it could not.

/** How the text reached the clipboard, or that it did not. */
export const COPY_METHOD = Object.freeze({
  asyncClipboard: "async_clipboard",
  execCommand: "exec_command",
  manual: "manual_select",
});

export const COPY_MESSAGE = Object.freeze({
  [COPY_METHOD.asyncClipboard]: "Copied. The summary is on your clipboard.",
  [COPY_METHOD.execCommand]: "Copied. The summary is on your clipboard.",
  [COPY_METHOD.manual]: "Could not copy automatically. The summary is in the box below, "
    + "selected and ready — press Ctrl+C, or Cmd+C on a Mac.",
});

export const SUMMARY_TITLE = "Prompt coaching — did my revised prompt improve?";

/**
 * The last line, always. A pasted summary travels further than the panel it
 * came from, so the boundary travels with it: someone reading it in a ticket
 * has to be able to tell that no prompt text went anywhere.
 */
export const SUMMARY_BOUNDARY = "Both grades ran in this browser tab against a bundled rubric. "
  + "No prompt text was sent, stored, or included in this summary.";

const line = (label, value) => `${label}: ${value}`;

/**
 * Build the copyable summary for a compared revision.
 *
 * @param {{change: object|null, result: object|null}} pair `change` from
 *   `buildRevisionChange`, `result` from `gradeMyPrompt`.
 * @returns {{available: boolean, reason: string|null, text: string, lines: string[]}}
 *   frozen. `available` is false for anything but a graded revision the
 *   contract actually compared: a pending, abstained, or errored change has no
 *   comparison in it to summarise, and a summary of a comparison that was never
 *   made would be the one claim this workflow refuses to print.
 */
export function buildCoachingSummary({ change = null, result = null } = {}) {
  const unavailable = (reason) => Object.freeze({
    available: false, reason, text: "", lines: Object.freeze([]),
  });
  // The status word is compared against a literal rather than against
  // `REVISION_STATUS`, deliberately: importing it here would close the loop
  // prompt-coaching-view → coaching-summary-view → coaching-summary, and a
  // module cycle under a real `<script type="module">` is a debugging afternoon
  // nobody should have to spend over a status string. A test pins the pairing.
  if (!change || change.status !== "compared") return unavailable("not_compared");
  if (!result?.scored) return unavailable("not_graded");

  const [baseline, revised] = change.scores;
  const lines = [SUMMARY_TITLE];
  if (baseline) lines.push(line("Baseline", baseline.value));
  if (revised) lines.push(line("Revised", revised.value));
  if (change.delta) {
    // The label carries the materiality judgement the panel already made, so a
    // reader of the pasted lines ranks the movement the same way the reader of
    // the panel did. A withheld delta keeps its label and loses its direction,
    // exactly as it does on screen.
    const direction = change.delta.direction ? ` · ${change.delta.direction}` : "";
    lines.push(line("Change", `${change.delta.label}${direction} · ${change.delta.value}`));
    lines.push(line("Grade band", change.delta.band));
  }
  lines.push(line("Answer", result.answer));
  lines.push(line("Do this next", `${change.action.title} ${change.action.guidance}`));
  if (change.notices.length) {
    lines.push(line("Withheld", change.notices
      .map((notice) => `${notice.code} (${notice.label}: ${notice.value})`).join("; ")));
  }
  if (change.provenance) lines.push(change.provenance);
  lines.push(SUMMARY_BOUNDARY);

  return Object.freeze({
    available: true,
    reason: null,
    text: lines.join("\n"),
    lines: Object.freeze(lines),
  });
}

/**
 * Put text on the clipboard, or say why it is not there.
 *
 * Three rungs, tried in order, because the first two are each unavailable in
 * conditions a visitor cannot fix and would not understand: the async Clipboard
 * API is absent on an insecure origin and can reject on a denied permission, and
 * `execCommand` is gone in newer engines and refused outside a user gesture in
 * older ones. The third rung is not a failure path so much as the honest floor —
 * the text, selected, and a keystroke to press.
 *
 * @param {string} text the summary.
 * @param {{clipboard?: object, doc?: object}} deps injected rather than read off
 *   globals so the fallback rungs are reachable in a test rather than only on
 *   the machines that happen to lack an API.
 * @returns {Promise<{ok: boolean, method: string, message: string}>} never
 *   throws. A copy control that can throw is a copy control that can leave a
 *   button disabled with no status beside it.
 */
export async function copySummaryText(text, { clipboard, doc } = {}) {
  const outcome = (method) => Object.freeze({
    ok: method !== COPY_METHOD.manual, method, message: COPY_MESSAGE[method],
  });
  if (typeof text !== "string" || text === "") return outcome(COPY_METHOD.manual);

  try {
    // The `typeof` check is inside the guard with the call: reading a property
    // can throw as readily as calling one, and this function's contract is that
    // it settles rather than throws whatever it is handed.
    if (typeof clipboard?.writeText === "function") {
      await clipboard.writeText(text);
      return outcome(COPY_METHOD.asyncClipboard);
    }
  } catch {
    // Denied permission, or an insecure origin. Fall through rather than
    // reporting a failure the next rung may well not have.
  }

  return outcome(copyByCommand(text, doc) ? COPY_METHOD.execCommand : COPY_METHOD.manual);
}

/**
 * The second rung: a staged node and `execCommand("copy")`.
 *
 * The node is staged rather than the visible fallback box being selected,
 * because selecting the box the reader can see would leave a highlight behind on
 * the success path, and a surface that highlights a block of text every time a
 * button works looks broken.
 *
 * @returns {boolean} whether the command reported a copy. Never throws:
 *   `execCommand` is refused outside a user gesture in some engines and removed
 *   outright in others, and both are a "no" rather than an error to surface.
 */
function copyByCommand(text, doc) {
  let staged = null;
  try {
    if (typeof doc?.execCommand !== "function" || typeof doc.createElement !== "function") {
      return false;
    }
    staged = doc.createElement("textarea");
    staged.value = text;
    staged.setAttribute("readonly", "readonly");
    staged.setAttribute("aria-hidden", "true");
    staged.setAttribute("tabindex", "-1");
    // Off-screen rather than `hidden`: a node no engine renders is a node no
    // engine will copy a selection out of.
    staged.className = "prompt-coaching-copy-staging";
    (doc.body ?? doc).append?.(staged);
    staged.select?.();
    staged.setSelectionRange?.(0, text.length);
    return doc.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    staged?.remove?.();
  }
}
