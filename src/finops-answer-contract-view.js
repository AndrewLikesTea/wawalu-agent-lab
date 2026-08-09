// Paints the canonical answer inside the existing AI FinOps analysis region,
// and it is the region's FIRST reading (#1465).
//
// IT DERIVES NO FIGURE. Every number below is a field of the record
// `resolveFinopsAnswer` returned. What this module owns is the reading order —
// one dominant answer, the benchmark that gives it meaning, one action a reader
// can operate, and the provenance that lets them trace it — and the five states
// that answer can actually be in.
//
// THE FIVE STATES, DRAWN AND NOT ASSUMED. A surface that only draws the state
// that demos well is a surface that lies on the other four, so each one is a
// declared row here rather than a branch discovered at runtime:
//
//   loading    the analysis has not resolved yet. The authored markup ships in
//              this state, so the pre-script paint is the state it is really in.
//              Every slot carries a determinate placeholder — what is being
//              resolved, named — so the block occupies the same lines it will
//              occupy once answered and the layout does not jump under a reader.
//   answered   the contract answered. Figure, benchmark, action, provenance.
//   empty      an input the answer is defined from is absent. Says which, and
//              what brings it.
//   withheld   the inputs arrived and a rule refused the figure. Says which rule
//              and what would satisfy it.
//   error      the analysis itself did not load. Says so, and names the retry
//              control the page already ships.
//
// COLOUR IS NEVER THE CHANNEL. Each state paints a word and a glyph from
// `panel-status-view.js`'s published vocabulary, so the five are distinguishable
// in greyscale, in forced colours, and to a reader who sees no hue at all. The
// tone is the fourth channel, never the first.
//
// THE ONE ANSWER, AND IT IS LIVE (#1466). This region is the page's single
// executive briefing for the bundled analysis: the figure, the qualifiers on
// it, and the one next action. Every other presentation of those four things in
// the live analysis is supporting evidence inside a disclosure. It is repainted
// on every scenario change, so `scenarioLabel` names the export it is of — an
// answer that silently outlives the dataset it was computed from is worse than
// no answer. The synthetic-data qualifier is AUTHORED in the markup rather than
// painted here, because it must be true in all five states and a paint that
// took a different branch is a paint that can lose it.
//
// NO NEW TOKEN AND NO NEW CLASS. Type roles are the ones this page already
// ships: `.stand-figure-value` is the largest role on the surface and carries
// the answer; `.stand-answer` is the body role and carries the benchmark;
// `.stand-action` is the page's one call-to-action treatment; and
// `.stand-figure-basis` is the small role provenance is stated in — beside the
// answer, never behind a control.
import { ANSWER_STATUS, WITHHELD } from "./finops-answer-contract.js";
import { PANEL_STATUS, panelStatusPresentation } from "./panel-status-view.js";

/** The five reading states of the answer region. There is no sixth. */
export const ANSWER_STATE = Object.freeze({
  loading: "loading",
  answered: "answered",
  empty: "empty",
  withheld: "withheld",
  error: "error",
});

/**
 * Each state's chip, borrowed from the page's shared status vocabulary rather
 * than invented here, so one glyph never means two things across the page.
 *
 * `withheld` maps to `unavailable` — "Awaiting input", an outline — on purpose.
 * A refused figure is a classification of this scenario, not damage, and only
 * `error` is allowed to reach for the error inks.
 */
const CHIP_STATUS = Object.freeze({
  [ANSWER_STATE.loading]: PANEL_STATUS.loading,
  [ANSWER_STATE.answered]: PANEL_STATUS.computed,
  [ANSWER_STATE.empty]: PANEL_STATUS.empty,
  [ANSWER_STATE.withheld]: PANEL_STATUS.unavailable,
  [ANSWER_STATE.error]: PANEL_STATUS.error,
});

/** The one sentence each state puts beside its chip. */
const STATE_SUMMARY = Object.freeze({
  [ANSWER_STATE.loading]:
    "Resolving one annual figure, the benchmark behind it, and the action it implies.",
  [ANSWER_STATE.answered]:
    "One annual figure, the benchmark it is measured against, and the action it implies.",
  [ANSWER_STATE.empty]: "No answer is stated, because an input it is defined from is absent.",
  [ANSWER_STATE.withheld]: "No answer is stated, because a rule this figure must pass refused it.",
  [ANSWER_STATE.error]: "The bundled analysis did not load, so nothing here was computed.",
});

/** What a reader does next, per state. Never "try again" with no object. */
const STATE_NEXT = Object.freeze({
  [ANSWER_STATE.empty]:
    "Choose a bundled scenario above, or import a provider export, and this answer resolves"
    + " from that analysis.",
  [ANSWER_STATE.withheld]:
    "The signals that did resolve are listed below; the rule named above is what a further"
    + " input has to satisfy.",
  [ANSWER_STATE.error]:
    "Press Retry bundled analysis in the page status strip below. Nothing was uploaded or"
    + " stored, so retrying costs nothing.",
});

const ERROR_SENTENCE = "The bundled analysis did not load, so no answer is stated.";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const ID = "finops-canonical-answer";

const set = (doc, id, text) => {
  const node = doc.getElementById(id);
  if (node) node.textContent = text;
  return node;
};

const money = (value, unit) => (unit === "USD" ? USD.format(value) : `${value} ${unit}`);

const named = (ids) => (ids?.length ? ids.join(", ") : "none");

const filled = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Display-only bounds on the figure the contract published.
 *
 * NOTHING HERE CHANGES A NUMBER. A modelled saving larger than the baseline it
 * is a share of cannot happen, and a region that renders it as a headline has
 * told a leader a confident lie; a negative or zero saving is arithmetically
 * fine and reads as a broken sentence if it is poured into "X a year — Y% of".
 * So each is named, and the figure is still shown, because hiding the number a
 * reader can see in the source data is how a surface loses their trust.
 *
 * @returns `{ positive, implausible, caveat }` — `positive` decides which
 *   sentence the figure slot gets, `implausible` marks the region for the
 *   dotted-underline treatment the page already uses, `caveat` is the words.
 */
export function answerPlausibility(answer) {
  const value = answer?.annualSavingsUsd;
  const baseline = answer?.annualBaselineSpendUsd;
  if (!Number.isFinite(value)) return { positive: false, implausible: false, caveat: null };
  if (Number.isFinite(baseline) && value > baseline) {
    return {
      positive: true,
      implausible: true,
      caveat: "Check this: the modelled saving is larger than the analyzed baseline it is a"
        + " share of, which cannot happen. Treat the figure as unverified and check the"
        + " action's monthly figure before quoting it.",
    };
  }
  if (value < 0) {
    return {
      positive: false,
      implausible: true,
      caveat: "Check this: the recommended actions come to a negative annual total, which is"
        + " added cost rather than a saving. Treat the figure as unverified.",
    };
  }
  if (value === 0) {
    return {
      positive: false,
      implausible: false,
      caveat: "No saving is modelled on this scenario. The zero is stated rather than left"
        + " blank so it is not read as a missing figure.",
    };
  }
  return { positive: true, implausible: false, caveat: null };
}

/**
 * The state this record is in, before anything is painted.
 *
 * A null record is the analysis failing to load, which is an error and not an
 * absence: the reader is owed a retry, not a shrug. A record withheld for a
 * missing input is the empty state; every other withholding code is a rule that
 * ran and refused, which is the withheld state.
 */
export function finopsAnswerState(answer, options = {}) {
  if (options.state && Object.hasOwn(CHIP_STATUS, options.state)) return options.state;
  if (!answer) return ANSWER_STATE.error;
  if (answer.status === ANSWER_STATUS.answered) return ANSWER_STATE.answered;
  return answer.withheldReason?.code === WITHHELD.missingInput
    ? ANSWER_STATE.empty : ANSWER_STATE.withheld;
}

/** The chip: glyph, word, silhouette. Three channels before the tone. */
function paintChip(doc, state) {
  const presentation = panelStatusPresentation(CHIP_STATUS[state]);
  const block = doc.getElementById(`${ID}-state`);
  if (block) {
    block.dataset.status = presentation.status;
    block.dataset.tone = presentation.tone;
  }
  const line = doc.getElementById(`${ID}-state-line`);
  // Only a live wait and a genuine failure interrupt. A refused figure is read
  // where it sits: the region's own status region below announces it once.
  if (line) line.setAttribute("role", presentation.role === "alert" ? "alert" : "note");
  const chip = doc.getElementById(`${ID}-chip`);
  if (chip) chip.dataset.silhouette = presentation.silhouette;
  set(doc, `${ID}-shape`, presentation.shape);
  set(doc, `${ID}-word`, presentation.word);
  set(doc, `${ID}-state-summary`, STATE_SUMMARY[state]);
  return presentation;
}

/** The action, as a real link or as nothing at all — never as empty chrome. */
function paintAction(doc, answer, answered) {
  const link = doc.getElementById(`${ID}-action`);
  const action = answered ? answer.primaryAction : null;
  if (link) {
    link.textContent = action
      ? `${action.label}${action.department ? ` in ${action.department}` : ""}` : "";
    link.hidden = !action;
  }
  set(doc, `${ID}-action-basis`, action
    ? `Do this first — ${USD.format(action.monthlySavingsUsd)} a month, the largest single`
      + " recommended move in this analysis."
    : "");
  return link;
}

/**
 * Paint the canonical answer and every state it can be read in.
 *
 * @param doc the document holding `#finops-canonical-answer`.
 * @param answer a `finops-answer-contract/1.0.0` record, or null when the
 *   analysis itself failed to load.
 * @param options.state force a state — `"loading"` is the only one a caller
 *   asks for, because the other four are decided by the record.
 * @param options.scenarioLabel the bundled export this answer is of, so the one
 *   briefing on the page names its own subject as the reader changes it.
 * @returns the region, or null when the page does not carry one.
 */
export function renderFinopsAnswer(doc, answer, options = {}) {
  const region = doc.getElementById(ID);
  if (!region) return null;
  const state = finopsAnswerState(answer, options);
  const answered = state === ANSWER_STATE.answered;
  const loading = state === ANSWER_STATE.loading;
  const plausibility = answerPlausibility(answered ? answer : null);

  region.dataset.state = state;
  // The two attributes #1464 published keep their meaning: the contract's own
  // status and code, unchanged by how this region chooses to read them.
  region.dataset.status = answered ? ANSWER_STATUS.answered : ANSWER_STATUS.withheld;
  region.dataset.reason = answer?.withheldReason?.code ?? (answer ? "none" : WITHHELD.missingInput);
  if (plausibility.implausible) region.dataset.implausible = "true";
  else delete region.dataset.implausible;

  paintChip(doc, state);

  const figure = doc.getElementById(`${ID}-figure`);
  if (figure) {
    figure.dataset.available = answered ? "true" : "false";
    figure.textContent = loading
      ? "Resolving the annual figure from the analyzed scenario…"
      : (!answered ? ""
        : (plausibility.positive
          ? `${USD.format(answer.annualSavingsUsd)} a year — ${answer.savingsPercent}% of the`
            + ` ${USD.format(answer.annualBaselineSpendUsd)} analyzed baseline.`
          : "No annual saving is modelled: the recommended actions come to"
            + ` ${USD.format(answer.annualSavingsUsd)} a year against the`
            + ` ${USD.format(answer.annualBaselineSpendUsd)} analyzed baseline.`));
  }

  // WHICH scenario this answer is of. The region is now repainted every time the
  // reader changes the bundled export below (#1466), so a briefing that did not
  // name its subject would silently become an answer about a different dataset.
  set(doc, `${ID}-scenario`, filled(options.scenarioLabel)
    ? `Analyzing ${options.scenarioLabel}. Choosing another bundled provider export`
      + " below restates this briefing from that analysis."
    : "Analyzing the bundled provider export selected in the chooser below.");

  // The benchmark slot always says something. An empty line under a figure reads
  // as a benchmark that was forgotten rather than one that does not exist.
  const benchmark = answer?.benchmark;
  set(doc, `${ID}-benchmark`, loading ? "Checking that figure against the analysis benchmark…"
    : (answered && benchmark ? `Supported by ${benchmark.label} at`
      + ` ${money(benchmark.value, benchmark.unit)}.`
      : "No figure is stated here, so there is nothing for a benchmark to support."));

  paintAction(doc, answer, answered);

  set(doc, `${ID}-reason`, answered ? "" : (loading
    ? "The answer is resolved locally, from the analysis this page already loaded."
    : `${state === ANSWER_STATE.error ? ERROR_SENTENCE
      : (answer?.withheldReason?.sentence ?? ERROR_SENTENCE)} ${STATE_NEXT[state] ?? ""}`.trim()));

  const caveat = doc.getElementById(`${ID}-caveat`);
  if (caveat) {
    caveat.textContent = answered ? (plausibility.caveat ?? "") : "";
    caveat.hidden = !(answered && plausibility.caveat);
  }

  const sources = answer?.sources ?? {};
  set(doc, `${ID}-sources`, loading
    ? "Provenance is stated with the figure, from the analysis's own signal names."
    : (answered
      ? `Figure from ${named(sources.annualSavingsUsd)} × 12; share also from`
        + ` ${named(sources.savingsPercent).split(", ").pop()}; benchmark from`
        + ` ${named(sources.benchmark)}; action from ${named(sources.primaryAction)};`
        + ` confidence ${answer.confidence.level} from ${named(sources.confidence)};`
        + ` readiness ${answer.readiness.state} from ${named(sources.readiness)}.`
      : `Signals still trusted — confidence: ${answer?.confidence
        ? `${answer.confidence.level} (${answer.confidence.value}/100) from`
          + ` ${named(sources.confidence)}` : "none"}; readiness: ${answer?.readiness
        ? `${answer.readiness.state} from ${named(sources.readiness)}` : "none"}; benchmark:`
        + ` ${benchmark ? `${benchmark.label} from ${named(sources.benchmark)}` : "none"}.`));

  // The announcement lives OUTSIDE every disclosure on this page. A status
  // region folded inside a shut details element still reads to a test harness
  // and is silent in a browser, which is the worst of both.
  set(doc, `${ID}-live`, loading ? "" : (answered
    ? `Answer resolved: ${USD.format(answer.annualSavingsUsd)} a year, ${answer.savingsPercent}%`
      + ` of the analyzed baseline. ${plausibility.caveat ?? ""}`.trim()
    : `${panelStatusPresentation(CHIP_STATUS[state]).word}: ${STATE_SUMMARY[state]}`));
  return region;
}
