// Where this browser has got to in the decision-to-release demo (#2500).
//
// The four steps above the recorder used to be a static list: the same four
// sentences whether you had recorded nothing, a decision, or the release that
// carried it. A visitor who came back the next day read step one again and had
// no way to tell, without hunting through the history below, that the thing
// step one asks for was already done. This turns that list into a progress
// indicator derived from the records this browser holds.
//
// ONE SOURCE OF TRUTH, AND IT IS THE STORE. Nothing here remembers a step. The
// state is recomputed from the stored decisions and releases every time it is
// asked for, which is what makes a revisit restore the same picture as the
// visit that left it: the same read, over the same two keys, produces the same
// answer. The seeded example records are deliberately NOT counted — they are a
// read-through layer nobody in this browser recorded (see seed-records.js), and
// a progress indicator that opened on "step one: done" for a first-time visitor
// would be describing somebody else's work.
//
// STATUS IS TEXT, NOT COLOUR AND NOT A MARK. Each item states "Step 2 of 4 ·
// Not started" in its own words, so the list reads the same to a screen reader,
// to a reader who cannot tell the accent colour from the body colour, and to
// anyone whose stylesheet did not load. `aria-current="step"` marks the one
// step to do next, and a polite live region says what changed when the state
// moves without a reload.
//
// ONE ACTION, AND NEVER TWO. The indicator offers exactly one link: the next
// thing to do. It is a plain text link rather than a second call to action,
// because the recorder below already owns the primary button, and it is absent
// entirely in the first state — the action there is the form six inches below
// it, and a link pointing at the form under it is a tab stop that buys nothing.
// This page's first screen has none to spare.

import { recordReleaseHref } from "./decision-entry.js";
import { loadReleases, releaseDetailHref } from "./releases.js";
import { onRecordsChanged } from "./shiplog-records.js";

export const DEMO_PROGRESS_STEP_COUNT = 4;

// The four steps, in the order the demo is done. Step two names what the link
// does rather than describing where the link is: the route is now offered by
// this indicator at every visit, not only in the moment after a save.
export const DEMO_PROGRESS_STEPS = Object.freeze([
  "Record a decision with the form below.",
  "Continue to Releases with that decision ready to link.",
  "Record a release there and link that decision to it.",
  "Open the release you recorded and check its summary and linked decision.",
]);

// Three words, and every one of them says what a reader has to do rather than
// how far along a bar something is. "Done" is a fact about the store.
export const DEMO_PROGRESS_STATUS = Object.freeze({
  done: "Done",
  current: "Do this now",
  todo: "Not started",
});

// The sentence under the list in the state where nothing has been recorded. It
// says where the records live before a visitor has made one, not after, because
// "stays in this browser" is a thing to know before you type into a form.
export const DEMO_PROGRESS_EMPTY_LEAD =
  "Nothing is recorded in this browser yet. Step one is the form below.";

const title = (decision) => {
  const value = typeof decision?.title === "string" ? decision.title.trim() : "";
  return value === "" ? decision?.id ?? "your decision" : value;
};

const version = (release) => {
  const value = typeof release?.version === "string" ? release.version.trim() : "";
  return value === "" ? release?.id ?? "your release" : value;
};

const linkedIds = (release) => (Array.isArray(release?.decisionIds) ? release.decisionIds : []);

/**
 * Which decision this indicator is following, and the release that carries it.
 *
 * The newest decision that already has a release linked to it wins, and the
 * newest decision otherwise. Following the newest decision unconditionally
 * would walk a visitor who finished the demo and then recorded a fifth decision
 * back to step two, which reads as losing progress they did not lose.
 */
export function trackedRecords(decisions = [], releases = []) {
  const stored = Array.isArray(decisions) ? decisions.filter((entry) => entry?.id) : [];
  const log = Array.isArray(releases) ? releases.filter((entry) => entry?.id) : [];
  for (const decision of stored) {
    const release = log.find((entry) => linkedIds(entry).includes(decision.id));
    if (release) return { decision, release };
  }
  return { decision: stored[0] ?? null, release: null };
}

/**
 * The whole state of the indicator, from the records this browser holds.
 *
 * Returns the four steps with their status, the index of the current one, and
 * the single next action (or null, in the state whose action is the form).
 */
export function demoProgress({ decisions = [], releases = [] } = {}) {
  const { decision, release } = trackedRecords(decisions, releases);
  // Step four has no stored consequence — nothing in this browser records that
  // a detail page was read — so it is the current step once the release exists
  // and is never reported as done. Saying "done" about something we cannot
  // observe is the one claim this indicator must not make.
  const currentIndex = release ? 3 : (decision ? 1 : 0);

  const steps = DEMO_PROGRESS_STEPS.map((text, index) => {
    const status = index < currentIndex
      ? DEMO_PROGRESS_STATUS.done
      : (index === currentIndex ? DEMO_PROGRESS_STATUS.current : DEMO_PROGRESS_STATUS.todo);
    return {
      index,
      text,
      status,
      current: index === currentIndex,
      label: `Step ${index + 1} of ${DEMO_PROGRESS_STEP_COUNT} · ${status}`,
    };
  });

  let action = null;
  if (release) {
    action = {
      href: releaseDetailHref(release.id),
      label: `Open release ${version(release)} and its linked decision`,
      lead: `Release ${version(release)} is recorded in this browser and links “${title(decision)}”.`,
    };
  } else if (decision) {
    action = {
      href: recordReleaseHref(decision.id),
      label: `Record the release for “${title(decision)}” on Releases`,
      lead: `“${title(decision)}” is recorded in this browser. Releases opens with it already ticked `
        + "under Linked decisions.",
    };
  }

  return { steps, currentIndex, action, decision, release };
}

/** What the live region says when the state moves under a reader's feet. */
export function demoProgressAnnouncement(progress) {
  const step = progress.steps[progress.currentIndex];
  return `Demo progress: step ${progress.currentIndex + 1} of ${DEMO_PROGRESS_STEP_COUNT}. ${step.text}`;
}

// What the painted state is, reduced to a string, so a repaint that changed
// nothing announces nothing. A reader who submits an invalid form, or whose
// save was refused, must not hear the progress read out again.
const signature = (progress) => `${progress.currentIndex}|${progress.action?.href ?? ""}`;

/**
 * Paint `progress` into the evaluation path inside `root`.
 *
 * Returns the signature painted, or null when this document carries no path.
 * `announce` is the previous signature: a different one is announced politely,
 * and the first paint of a page announces nothing, because arriving on a page
 * is not a change to it.
 */
export function renderDemoProgress(root, progress, { previous = null } = {}) {
  const list = root.querySelector("#evaluation-path-steps");
  if (!list) return null;
  const doc = root.ownerDocument ?? root;
  const items = list.querySelectorAll("li");
  const span = (className, text) => {
    const node = doc.createElement("span");
    node.setAttribute("class", className);
    node.textContent = text;
    return node;
  };

  progress.steps.forEach((step, index) => {
    const item = items[index];
    if (!item) return;
    // The space between them is a real text node, not a CSS gap: the status and
    // the instruction are one sentence to anything reading the item's text, and
    // two spans butted together would read them as one run-on word.
    item.replaceChildren(
      span("evaluation-path-status", step.label),
      doc.createTextNode(" "),
      span("evaluation-path-step", step.text),
    );
    if (step.current) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });

  const next = root.querySelector("#evaluation-path-next");
  if (next) {
    const lead = doc.createElement("p");
    lead.setAttribute("id", "evaluation-path-next-lead");
    lead.textContent = progress.action?.lead ?? DEMO_PROGRESS_EMPTY_LEAD;
    if (!progress.action) {
      next.replaceChildren(lead);
    } else {
      const link = doc.createElement("a");
      link.setAttribute("class", "text-link");
      link.setAttribute("id", "evaluation-path-action");
      link.setAttribute("href", progress.action.href);
      // Described by the sentence above it, so the link's own words stay short
      // and the record it acts on is still read with it.
      link.setAttribute("aria-describedby", "evaluation-path-next-lead");
      link.textContent = progress.action.label;
      next.replaceChildren(lead, link);
    }
  }

  const painted = signature(progress);
  const live = root.querySelector("#evaluation-path-announce");
  if (live) live.textContent = previous !== null && previous !== painted ? demoProgressAnnouncement(progress) : "";
  return painted;
}

/**
 * Mount the indicator and keep it current for the life of the page.
 *
 * `decisions` is a reader rather than a list: the store is read again on every
 * change, so the indicator can never describe a record that failed to save.
 * A refused write does not fire the change, and a write that landed re-reads
 * the file rather than trusting what was handed to it.
 */
export function initDemoProgress(root, storage, { decisions, releases } = {}) {
  if (!root?.querySelector?.("#evaluation-path-steps")) return null;
  const readDecisions = typeof decisions === "function" ? decisions : () => [];
  const readReleases = typeof releases === "function" ? releases : () => loadReleases(storage);
  let previous = null;
  const update = () => {
    const progress = demoProgress({ decisions: readDecisions(), releases: readReleases() });
    previous = renderDemoProgress(root, progress, { previous });
    return progress;
  };
  const first = update();
  onRecordsChanged(root, update);
  return first;
}
