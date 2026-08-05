// The five-fact intake, on the page (#1103).
//
// THE CONTROLS ARE AUTHORED, NOT BUILT. Every field, its visible label, its
// option list, and the three answer sentences ship in evolution.html, filled
// with the bundled example's own declared facts. So a visitor whose script
// never ran still meets a complete, labelled, keyboard-operable group and a
// coherent answer beside it; this module repaints the same slots, which is what
// proves the authored copy and the module's copy have not drifted.
//
// NOTHING LEAVES THE BROWSER. The form has no action and no method, submit is
// prevented, and the five declared facts are held in one module value for as
// long as the tab is open and written nowhere else — no request, no storage, no
// cookie. The estimator underneath reads no clock and makes no request either.
//
// EVERY STRING GOES THROUGH textContent. No node here is built from markup and
// no declared value is interpolated into one: the sentences are composed by
// `finops-declared-fact-intake.js` out of figures and authored words.

import { applyDeclaredFactEstimate } from "./finops-first-run-view.js";
import { EXAMPLE_DECLARED_FACTS } from "./finops-declared-fact-fixtures.js";
import {
  INTAKE_IDS, ROSTER_UNCHOSEN, currentDeclaredFacts, currentHeadcountSource, intakeHeadline,
  intakeNextAction, intakeRecoverable, mixChoiceFor, readDeclaredFacts, setDeclaredFacts,
  setHeadcountSource,
} from "./finops-declared-fact-intake.js";
import {
  HEADCOUNT_SOURCE, ROSTER_REFUSAL, parseHeadcountRoster, rosterAcceptedSentence,
  rosterRefusalSentence,
} from "./hris-headcount-roster.js";
// Which rung of the trust ladder the answer below is on (#1104). This module
// only reports what it painted — the ladder decides the rung from the region's
// own state, so the two cannot disagree about whose facts these are.
import {
  currentTrustRung, refreshTrustLadder, rungChangeAnnouncement, seedAnnouncedRung,
  setDeclaredEstimate,
} from "./finops-trust-ladder.js";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/**
 * The roster read this binding last started, so a caller can wait for it.
 *
 * A file arrives on a `change` event, and reading it is asynchronous — the
 * handler cannot return the promise to whoever dispatched the event. Holding the
 * last one here is what lets a test await the same work a reader waits through,
 * rather than assert on a repaint that has not happened yet.
 */
let rosterImport = null;

export const pendingRosterImport = () => rosterImport;

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node && typeof text === "string") node.textContent = text;
  return node;
}

function setValue(doc, id, value) {
  const node = byId(doc, id);
  if (node) node.value = String(value ?? "");
  return node;
}

/** The five control values, mapped into the estimator's input shape. */
export function declaredFactsFromControls(doc) {
  return readDeclaredFacts({
    monthlySpendUsd: byId(doc, INTAKE_IDS.spend)?.value,
    mixChoice: byId(doc, INTAKE_IDS.mix)?.value,
    engineers: byId(doc, INTAKE_IDS.engineers)?.value,
    sizeBand: byId(doc, INTAKE_IDS.size)?.value,
    industry: byId(doc, INTAKE_IDS.industry)?.value,
  });
}

/**
 * Paint the answer spine, and the estimate block above it, from one set of
 * declared facts.
 *
 * THE SPINE IS THREE SENTENCES AND NOTHING ELSE: the headline with the figure
 * and its quartile, the modelled recoverable amount, and one next action. The
 * echoed inputs, the cohort basis, and the arithmetic are already behind the
 * estimate's own disclosure — the same details element this region has always
 * used — and `applyDeclaredFactEstimate` repaints them from these same facts,
 * so no second disclosure idiom enters the page.
 *
 * @returns the estimate it painted, so a caller can assert on it.
 */
export function applyDeclaredFactIntake(doc, facts = EXAMPLE_DECLARED_FACTS) {
  setDeclaredFacts(facts);
  const estimate = applyDeclaredFactEstimate(doc, facts);
  if (!estimate) return null;
  const block = byId(doc, INTAKE_IDS.answer);
  if (block) {
    block.dataset.provenance = estimate.provenance;
    block.dataset.tier = estimate.confidence.tier;
    // The whole estimate stays `estimated` — the spend, the mix and the cohort
    // are still declared. What a roster can move is the denominator, so the
    // per-engineer figures carry their own word (#1105).
    block.dataset.headcountSource = currentHeadcountSource();
  }
  setText(doc, INTAKE_IDS.headline, intakeHeadline(estimate));
  setText(doc, INTAKE_IDS.recoverable, intakeRecoverable(estimate));
  setText(doc, INTAKE_IDS.action, intakeNextAction(estimate));
  // And the rung the three sentences above are on. Painted after them, never
  // before: a ladder that claims Estimated over a spine still showing the
  // example's figures is the exact confusion it exists to remove.
  setDeclaredEstimate(doc, !isExampleFacts(facts));
  refreshTrustLadder(doc);
  return estimate;
}

/**
 * Whether these five facts are still the bundled example's.
 *
 * Compared field by field rather than by identity, because the facts painted
 * here are read back out of five controls and are therefore a fresh object every
 * time. A reader whose org matches the example on all five reads as the example,
 * which is the honest answer: nothing they typed distinguishes the two.
 */
function isExampleFacts(facts) {
  return facts?.monthlySpendUsd === EXAMPLE_DECLARED_FACTS.monthlySpendUsd
    && facts?.engineers === EXAMPLE_DECLARED_FACTS.engineers
    && facts?.sizeBand === EXAMPLE_DECLARED_FACTS.sizeBand
    && facts?.industry === EXAMPLE_DECLARED_FACTS.industry
    && mixChoiceFor(facts?.providerMix) === mixChoiceFor(EXAMPLE_DECLARED_FACTS.providerMix);
}

/** Repaint from whatever the five controls currently hold. */
export function applyDeclaredFactIntakeFromControls(doc) {
  return applyDeclaredFactIntake(doc, declaredFactsFromControls(doc));
}

/**
 * Put the five controls back to the bundled example's declared facts and
 * repaint from the example itself.
 *
 * Repainting from `EXAMPLE_DECLARED_FACTS` rather than from the controls it just
 * filled is deliberate: the state this restores is the one a first-time visitor
 * meets, and reading it back out of the controls would make that claim depend on
 * the fill above having been exact.
 */
/**
 * A ROSTER INSTEAD OF A TYPED HEADCOUNT (#1105).
 *
 * The typed field is untouched by this path until a roster is ACCEPTED, and on a
 * refusal it is not written at all: the brief a reader already had is left whole
 * rather than half-updated, and the refusal says so in its own last sentence.
 *
 * `file.text()` is the browser's own local Blob text API. There is no request,
 * no credential, and no copy: the string is handed to a pure parser, the parser
 * returns counts, and the string goes out of scope with this function.
 *
 * @param {*} doc the document.
 * @param {{text: () => Promise<string>}} file the chosen file.
 * @param {{period?: string}} [options] the period the brief is estimating, if a
 *   caller knows it. With none, the roster's own latest month is counted.
 * @returns the parser's result, so a caller can assert on it.
 */
export async function importHeadcountRoster(doc, file, { period = null } = {}) {
  if (!file) return null;
  let result;
  try {
    result = parseHeadcountRoster(await file.text(), { period });
  } catch {
    // A file the browser could not hand us text for is the same outcome as an
    // unreadable one, and it reaches the reader as a sentence rather than a
    // silence with a stale headcount above it.
    result = {
      ok: false,
      code: ROSTER_REFUSAL.UNREADABLE,
      message: "This file could not be read in this browser, so nothing was parsed.",
    };
  }
  if (!result.ok) {
    setText(doc, INTAKE_IDS.rosterStatus, rosterRefusalSentence(result));
    byId(doc, INTAKE_IDS.rosterStatus)?.setAttribute("data-state", "refused");
    return result;
  }
  setValue(doc, INTAKE_IDS.engineers, result.headcount);
  setHeadcountSource(HEADCOUNT_SOURCE.supplied);
  setText(doc, INTAKE_IDS.rosterStatus, rosterAcceptedSentence(result));
  byId(doc, INTAKE_IDS.rosterStatus)?.setAttribute("data-state", "accepted");
  applyDeclaredFactIntakeFromControls(doc);
  return result;
}

export function resetDeclaredFactIntake(doc) {
  setHeadcountSource(HEADCOUNT_SOURCE.estimated);
  setText(doc, INTAKE_IDS.rosterStatus, ROSTER_UNCHOSEN);
  byId(doc, INTAKE_IDS.rosterStatus)?.setAttribute("data-state", "unchosen");
  fillControls(doc, EXAMPLE_DECLARED_FACTS);
  const estimate = applyDeclaredFactIntake(doc, EXAMPLE_DECLARED_FACTS);
  announce(doc, estimate);
  return estimate;
}

/** Put one set of declared facts into the five controls. */
function fillControls(doc, facts) {
  setValue(doc, INTAKE_IDS.spend, facts.monthlySpendUsd);
  setValue(doc, INTAKE_IDS.mix, mixChoiceFor(facts.providerMix));
  setValue(doc, INTAKE_IDS.engineers, facts.engineers);
  setValue(doc, INTAKE_IDS.size, facts.sizeBand);
  setValue(doc, INTAKE_IDS.industry, facts.industry);
}

/**
 * Speak the headline once, on a deliberate act — and the rung only if it moved.
 *
 * ONE LIVE REGION, NOT TWO. The rung rides on the announcement the headline is
 * already making rather than in a second polite region beside it: two regions
 * written on one submit is a screen reader reading a figure and a ladder over
 * each other, and this page has already decided it announces through one region
 * plus the import reason beside it.
 *
 * `rungChangeAnnouncement` returns null when the rung has not moved, and null
 * means NOTHING IS ADDED. A reader who revises their spend by a hundred dollars
 * is still Estimated; being told so again is noise they cannot skip.
 */
function announce(doc, estimate) {
  if (!estimate) return null;
  const moved = rungChangeAnnouncement(doc, currentTrustRung(doc));
  const headline = intakeHeadline(estimate);
  setText(doc, INTAKE_IDS.live, moved ? `${headline} ${moved}` : headline);
  return moved;
}

/**
 * Bind the intake.
 *
 * SUBMIT IS PREVENTED and repaints in place: this page navigates nowhere and
 * sends nothing. `input` and `change` are both bound because a number field
 * reports a keystroke on one and a select reports a choice on the other; a
 * browser that fires both simply repaints the same sentences twice, which is
 * why the paint is a repaint of authored slots rather than a rebuild.
 *
 * Nothing here intercepts a key. Enter inside a field is the browser's own
 * implicit submission, Enter and Space on either button are the button's, and
 * the arrow keys inside a select are the select's.
 */
export function bindDeclaredFactIntake(doc, { onEstimate = null } = {}) {
  const form = byId(doc, INTAKE_IDS.form);
  if (!form) return null;
  form.addEventListener("submit", (event) => {
    event?.preventDefault?.();
    const estimate = applyDeclaredFactIntakeFromControls(doc);
    announce(doc, estimate);
    // ON SUBMIT ONLY (#1106). The region repaints on every keystroke, and a
    // record written on every keystroke is a record of typing rather than of a
    // reader's declared position. Submitting is the moment they stand behind
    // the five facts, so that is the moment the estimate goes on the record.
    onEstimate?.(estimate);
  });
  // TYPING WINS BACK. A reader who edits the headcount after an accepted roster
  // is declaring a number again, so the figure goes back to `estimated` in the
  // same keystroke. A supplied marker that outlived the file it came from would
  // be the one claim on this region nobody could check.
  const revise = (event) => {
    if (event?.target?.id === INTAKE_IDS.engineers
      && currentHeadcountSource() === HEADCOUNT_SOURCE.supplied) {
      setHeadcountSource(HEADCOUNT_SOURCE.estimated);
      setText(doc, INTAKE_IDS.rosterStatus, ROSTER_UNCHOSEN);
      byId(doc, INTAKE_IDS.rosterStatus)?.setAttribute("data-state", "unchosen");
    }
    return applyDeclaredFactIntakeFromControls(doc);
  };
  form.addEventListener("input", revise);
  form.addEventListener("change", revise);
  byId(doc, INTAKE_IDS.roster)?.addEventListener("change", (event) => {
    const file = event?.target?.files?.[0];
    if (file) rosterImport = importHeadcountRoster(doc, file);
  });
  byId(doc, INTAKE_IDS.clear)?.addEventListener("click", () => resetDeclaredFactIntake(doc));
  // The controls are filled from the facts the region is estimating from rather
  // than left to the authored `selected` attributes alone. The authored ones are
  // what a visitor whose script never ran gets, and they say the same thing;
  // setting them here means the value this module reads back is the value it
  // wrote, on every engine, instead of whatever a defaulting rule decided.
  fillControls(doc, currentDeclaredFacts());
  // The rung the reader ARRIVES on, recorded without speaking it. A polite
  // region written at page load reads the ladder out over whatever they were
  // already hearing; seeding the comparison here is what makes the first thing
  // they hear the first thing that actually changed.
  setDeclaredEstimate(doc, !isExampleFacts(currentDeclaredFacts()));
  seedAnnouncedRung(doc, refreshTrustLadder(doc));
  return form;
}
