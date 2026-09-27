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
// entirely in the home page's first state — the action there is the form six
// inches below it, and a link pointing at the form under it is a tab stop that
// buys nothing. That page's first screen has none to spare.
//
// TWO PAGES, ONE STEP MODEL (#2578). The guide now also stands on Releases, and
// the thing that must never be copied is everything above: the four sentences,
// their order, the status words, and which step the store says a browser is on.
// A `surface` names the page the reader is standing on, and it changes exactly
// two things — which step arriving has already satisfied (standing on Releases
// IS step two), and the single link offered next, which has to be a control the
// page in question actually carries. Every step sentence, every status word and
// the derivation itself are read from the constants below by both surfaces, so a
// wording change lands on both pages or on neither.

import { recordReleaseHref } from "./decision-entry.js";
import { DETAIL_LINK_TEXT, loadReleases, releaseDetailHref, releaseDetailLinkLabel } from "./releases.js";
import { onRecordsChanged } from "./shiplog-records.js";

export const DEMO_PROGRESS_STEP_COUNT = 4;

// The four steps, in the order the demo is done. Step two names what the link
// does rather than describing where the link is: the route is now offered by
// this indicator at every visit, not only in the moment after a save.
//
// Step one names its page rather than pointing "below" (#2578). The same four
// sentences are now read on Releases, where the form below is the release
// recorder, and a step telling a reader to record a decision in it would be
// false on the page that carries it. Every step names where it happens, so the
// set reads true wherever the guide stands; the home page's own empty-state
// lead still points at the form under it.
export const DEMO_PROGRESS_STEPS = Object.freeze([
  "Record a decision with the decision form on the Home page.",
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

// WHERE EVERY NUMBER AND NAME IN THIS GUIDE COMES FROM, in one sentence, on
// both pages. Reused rather than rewritten: a second wording would be a second
// claim to keep true, and this one already avoids the "no customer or
// production data" caveat that shiplog-proof.test.js counts above the release
// recorder — so carrying the guide onto Releases adds no occurrence of it.
export const DEMO_PROGRESS_SCOPE =
  "Records you add stay in this browser only. This is a demo workflow, not a customer result.";

// The releases recorder's decision picker, by the accessible name its own
// legend gives it in src/releases.html — "Linked decisions" plus the optional
// marking inside the legend — and the address that lands on it. Quoted here so
// the guide directs a reader to the control in the words on its face; a test
// holds this string to that legend, so renaming the control fails there rather
// than leaving the guide naming something the page no longer has.
export const LINKED_DECISIONS_CONTROL = "Linked decisions (optional)";
export const LINKED_DECISIONS_HREF = "#release-decisions-field";

// Step one's page, for the surfaces that do not carry it.
export const DECISION_FORM_HREF = "/index.html#decision-form";

// The prerequisite state, which is its own branch and not a hidden guide: the
// demo starts with a decision, this browser holds none, and the only honest
// next action is on another page. It says so plainly instead of offering the
// release recorder below as if step three were reachable.
export const DEMO_PROGRESS_PREREQUISITE =
  "No decision is recorded in this browser yet, so there is nothing to link to a release here. "
  + "Step one is the decision form on the Home page.";
export const DEMO_PROGRESS_PREREQUISITE_ACTION = "Open the decision form on the Home page";

// Which step arriving on a page has already done. Standing on Releases IS step
// two — "Continue to Releases with that decision ready to link" — so a guide
// there that reported step two as the thing to do next would be asking a reader
// to do what they have just done. Home satisfies nothing by being itself: its
// step one is a record, not an arrival.
const ARRIVED_AT_STEP = Object.freeze({ home: -1, releases: 1 });

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

// The one link the home page offers next: the releases recorder, carrying the
// decision so it arrives already ticked, or the release just recorded.
function homeAction(decision, release) {
  if (release) {
    return {
      href: releaseDetailHref(release.id),
      label: `Open release ${version(release)} and its linked decision`,
      lead: `Release ${version(release)} is recorded in this browser and links “${title(decision)}”.`,
    };
  }
  if (!decision) return null;
  return {
    href: recordReleaseHref(decision.id),
    label: `Record the release for “${title(decision)}” on Releases`,
    lead: `“${title(decision)}” is recorded in this browser. Releases opens with it already ticked `
      + "under Linked decisions.",
  };
}

// The one link the releases page offers next, and every one of them is a control
// that page already ships. NOTHING NEW IS INVENTED HERE: the finished state
// offers the log's own "View release details", in its words and with the
// accessible name that control builds for a release, and the middle state points
// at the recorder's decision picker rather than describing where to scroll.
function releasesAction(decision, release) {
  if (release) {
    return {
      href: releaseDetailHref(release.id),
      label: DETAIL_LINK_TEXT,
      // The same accessible name every row's detail link carries, so "View
      // release details" read out of context still says which release.
      ariaLabel: releaseDetailLinkLabel(release),
      lead: `Release ${version(release)} is recorded in this browser and links “${title(decision)}”.`,
    };
  }
  if (!decision) {
    return { href: DECISION_FORM_HREF, label: DEMO_PROGRESS_PREREQUISITE_ACTION, lead: DEMO_PROGRESS_PREREQUISITE };
  }
  return {
    href: LINKED_DECISIONS_HREF,
    label: `Tick “${title(decision)}” under ${LINKED_DECISIONS_CONTROL} below`,
    lead: `“${title(decision)}” is recorded in this browser and no release in this log links it yet. `
      + `Tick it under ${LINKED_DECISIONS_CONTROL} in the recorder below, then record the release.`,
  };
}

const ACTIONS = Object.freeze({ home: homeAction, releases: releasesAction });

/**
 * The whole state of the indicator, from the records this browser holds.
 *
 * Returns the four steps with their status, the index of the current one, and
 * the single next action (or null, in the state whose action is the form).
 * `surface` is the page the reader is standing on: it moves neither the steps
 * nor their wording, only which one arriving has already satisfied and which
 * control the next action names.
 */
export function demoProgress({ decisions = [], releases = [], surface = "home" } = {}) {
  const { decision, release } = trackedRecords(decisions, releases);
  // Step four has no stored consequence — nothing in this browser records that
  // a detail page was read — so it is the current step once the release exists
  // and is never reported as done. Saying "done" about something we cannot
  // observe is the one claim this indicator must not make.
  // With a decision recorded, step one is done and the next step is whichever
  // of the two that follow arriving here has not left done: the step after the
  // one this page satisfies, and never earlier than step two.
  const arrived = ARRIVED_AT_STEP[surface] ?? ARRIVED_AT_STEP.home;
  const currentIndex = release ? 3 : (decision ? Math.max(1, arrived + 1) : 0);

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

  const action = (ACTIONS[surface] ?? ACTIONS.home)(decision, release);
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
      // Only where the link reuses a control whose visible words are the same
      // on every instance of it: the name then has to say which record, and the
      // page's own control already builds that name.
      if (progress.action.ariaLabel) link.setAttribute("aria-label", progress.action.ariaLabel);
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
export function initDemoProgress(root, storage, { decisions, releases, surface = "home" } = {}) {
  if (!root?.querySelector?.("#evaluation-path-steps")) return null;
  const readDecisions = typeof decisions === "function" ? decisions : () => [];
  const readReleases = typeof releases === "function" ? releases : () => loadReleases(storage);
  let previous = null;
  const update = () => {
    const progress = demoProgress({ decisions: readDecisions(), releases: readReleases(), surface });
    previous = renderDemoProgress(root, progress, { previous });
    return progress;
  };
  const first = update();
  onRecordsChanged(root, update);
  return first;
}
