// The portfolio-comparability region, painted from the contract.
//
// One job: answer four questions in one order, and never let the reader reach
// the fourth without having passed the first three. The verdict, the coverage
// benchmark, the evidence line, and the single next action are the region; the
// per-provider detail behind them is one native disclosure, shut on arrival.
//
// This module authors no product wording. Every sentence it writes comes from
// the validated result — the contract owns what the answers say, so a change of
// judgment cannot leave a stale claim in the markup. Every node is built with
// createElement and textContent: the site policy forbids executing
// user-generated markup, and nothing here assembles a markup string.
//
// A refused portfolio is painted, not swallowed. When the contract reports a
// defect — a field outside its declared set — the region says so above the
// answers, in the contract's words, and names the key without quoting a value.

import {
  COMPARABILITY_VERDICT, NO_ACTION_CODE, PORTFOLIO_COMPARABILITY_CONTRACT_ID, PROVIDER_STATE,
} from "./portfolio-comparability.js";
import { PORTFOLIO_SAMPLES } from "./portfolio-comparability-samples.js";

export const PORTFOLIO_SECTION_ID = "portfolio-comparability";
export const PORTFOLIO_BODY_ID = "portfolio-comparability-body";
export const PORTFOLIO_SAMPLE_SELECT_ID = "portfolio-comparability-sample";
export const PORTFOLIO_DEFECT_ID = "portfolio-comparability-contract-defect";

/**
 * The verdict is a word and a shape before it is a tint. A reader who cannot
 * see colour loses nothing, which is why the shape is never the only carrier
 * either — the headline says "Not yet" in words.
 */
const VERDICT_SHAPE = Object.freeze({
  [COMPARABILITY_VERDICT.yes]: "✓",
  [COMPARABILITY_VERDICT.notYet]: "◐",
  [COMPARABILITY_VERDICT.no]: "○",
});

/** How each provider row is described, in the reader's words. */
const STATE_WORD = Object.freeze({
  [PROVIDER_STATE.covered]: "Covered",
  [PROVIDER_STATE.missing]: "No record for this period",
  [PROVIDER_STATE.duplicate]: "Reported more than once",
  [PROVIDER_STATE.overlapping]: "Overlapping second window",
  [PROVIDER_STATE.misaligned]: "Different window",
  [PROVIDER_STATE.incompatibleCurrency]: "Another currency",
  [PROVIDER_STATE.unreadableCount]: "Unreadable delivery count",
  [PROVIDER_STATE.undeclared]: "Not expected in this portfolio",
});

const byId = (doc, id) => doc.getElementById(id);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One answered question: its number, the question, the headline, the detail. */
function answerBlock(doc, answer) {
  const block = element(doc, "li", "portfolio-answer");
  block.dataset.answer = answer.id;
  block.id = `portfolio-comparability-${answer.id}`;
  block.append(
    element(doc, "p", "portfolio-answer-question", `${answer.order}. ${answer.question}`),
    element(doc, "p", "portfolio-answer-headline", answer.headline),
    element(doc, "p", "portfolio-answer-detail", answer.detail),
  );
  return block;
}

function providerRow(doc, provider) {
  const item = element(doc, "li", "portfolio-provider");
  item.dataset.provider = provider.providerId;
  item.dataset.state = provider.state;
  const word = STATE_WORD[provider.state] ?? provider.state;
  const window = provider.periodStart && provider.periodEnd
    ? `${provider.periodStart} to ${provider.periodEnd}`
    : "No record in this period";
  const deliveries = provider.deliveryCount === null
    ? "No readable delivery count"
    : `${provider.deliveryCount.toLocaleString("en-US")} deliveries`;
  item.setAttribute("aria-label", `${provider.providerId}. ${word}. ${window}.`);
  item.append(
    element(doc, "span", "portfolio-provider-name", provider.providerId),
    element(doc, "span", "portfolio-provider-state", word),
    element(doc, "span", "portfolio-provider-window", window),
    element(doc, "span", "portfolio-provider-count", deliveries),
    // The label, never the source. What the record is attributed to is evidence;
    // the material behind it is not this product's to hold or to show.
    element(doc, "span", "portfolio-provider-provenance",
      provider.provenanceLabel ?? "No named source"),
  );
  return item;
}

/**
 * The refusal, stated above the answers rather than inside the disclosure. A
 * contract defect is blocking: nothing below it was measured, so hiding it
 * behind a summary would let a reader skim past the reason the region is empty.
 * Only the first defect is stated here — the rest disclose progressively, with
 * the whole list in the detail below.
 */
function defectNotice(doc, result) {
  const notice = element(doc, "p", "portfolio-contract-defect", result.nextAction.statement);
  notice.id = PORTFOLIO_DEFECT_ID;
  notice.setAttribute("role", "status");
  notice.dataset.defectCode = result.contractDefects[0].code;
  notice.dataset.defectCount = String(result.contractDefects.length);
  return notice;
}

function disclosure(doc, result) {
  const details = element(doc, "details", "portfolio-disclosure");
  const summary = element(doc, "summary");
  summary.append(element(doc, "span", "portfolio-disclosure-label",
    result.contractDefects.length
      ? "Show every field this contract refused"
      : "Show the per-provider detail behind this"));
  details.append(summary);

  if (result.providers.length) {
    const list = element(doc, "ul", "portfolio-provider-list");
    list.setAttribute("aria-label", "Every provider in this portfolio and how it was read");
    list.append(...result.providers.map((provider) => providerRow(doc, provider)));
    details.append(list);
  }

  if (result.errors.length) {
    const errors = element(doc, "ul", "portfolio-errors");
    errors.setAttribute("aria-label", "Why this portfolio cannot be judged");
    errors.append(...result.errors.map((error) => element(doc, "li", null, error)));
    details.append(errors);
  }

  details.append(element(doc, "p", "portfolio-basis",
    `${result.evidence.period} ${result.evidence.currency} `
    + `Judged by ${PORTFOLIO_COMPARABILITY_CONTRACT_ID}.`));
  return details;
}

/**
 * Paint the region.
 *
 * @param evaluated `{ sample, result }` from `evaluateSample`, or null to take
 *   the region off screen.
 * @param onJump called after focus moves to the file chooser, so a caller can
 *   record that the reader took the action offered.
 */
export function applyPortfolioComparability(doc, evaluated, { onJump } = {}) {
  const section = byId(doc, PORTFOLIO_SECTION_ID);
  const body = byId(doc, PORTFOLIO_BODY_ID);
  if (!section || !body) return null;
  if (!evaluated?.result) {
    section.hidden = true;
    section.dataset.verdict = "unavailable";
    body.replaceChildren();
    return null;
  }
  const { sample, result } = evaluated;
  section.hidden = false;
  section.dataset.verdict = result.verdict;
  section.dataset.sample = sample.id;
  section.dataset.contractVersion = result.contractId;
  section.dataset.contractDefects = String(result.contractDefects.length);
  // The coverage share is on the section as well as in the sentence, so a
  // reviewer comparing the panel against the contract compares two stated
  // numbers rather than a number and a paragraph.
  section.dataset.coverage = result.coverage.available ? String(result.coverage.ratio) : "";

  const verdictLine = element(doc, "p", "portfolio-verdict");
  const shape = element(doc, "span", "portfolio-verdict-shape", VERDICT_SHAPE[result.verdict]);
  shape.setAttribute("aria-hidden", "true");
  verdictLine.append(shape, element(doc, "strong", "portfolio-verdict-word",
    result.answers[0].headline));

  const answers = element(doc, "ol", "portfolio-answers");
  answers.setAttribute("aria-label", "What this portfolio answers, in order");
  answers.append(...result.answers.map((answer) => answerBlock(doc, answer)));

  const children = [
    element(doc, "p", "portfolio-sample-teaches", sample.teaches),
    ...(result.contractDefects.length ? [defectNotice(doc, result)] : []),
    verdictLine,
    answers,
  ];

  // The action is a control only when there is something to do in the file
  // chooser. A button that says "no action needed" trains a reader to press past
  // the verdict, and a contract defect is fixed in the fixture, not on the page.
  if (result.nextAction.code !== NO_ACTION_CODE && result.nextAction.focus === "files") {
    const act = element(doc, "button", "portfolio-action-jump", "Choose provider files again");
    act.id = "portfolio-comparability-action-jump";
    act.setAttribute("type", "button");
    act.dataset.actionCode = result.nextAction.code;
    act.setAttribute("aria-label",
      `${result.nextAction.statement} Moves focus to the file chooser.`);
    act.addEventListener("click", () => {
      byId(doc, "local-finops-files")?.focus?.();
      onJump?.(result.nextAction);
    });
    children.push(act);
  }
  children.push(disclosure(doc, result));
  body.replaceChildren(...children);
  return result;
}

/**
 * Fill the sample chooser and paint whichever sample is chosen. The options are
 * built from the sample list, so a fifth sample is an entry in that list and
 * never a line of markup here.
 */
export function bindPortfolioSamples(doc, evaluate, { onSelect, onJump } = {}) {
  const select = byId(doc, PORTFOLIO_SAMPLE_SELECT_ID);
  if (!select) return null;
  select.replaceChildren(...PORTFOLIO_SAMPLES.map((sample) => {
    const option = doc.createElement("option");
    option.value = sample.id;
    option.textContent = sample.label;
    return option;
  }));
  const paint = (id) => {
    const evaluated = evaluate(id);
    applyPortfolioComparability(doc, evaluated, { onJump });
    onSelect?.(evaluated);
    return evaluated;
  };
  select.addEventListener("change", () => paint(select.value));
  const initial = paint(select.value || PORTFOLIO_SAMPLES[0].id);
  if (!select.value) select.value = initial.sample.id;
  return initial;
}
