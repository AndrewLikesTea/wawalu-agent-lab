// Render layer for the finance-leader action portfolio.
//
// It lives apart from the page wiring so the hostile cases can be rendered in a
// test: the fixture is bundled today, but every title, owner, summary, and
// provenance line reaching this file is treated as untrusted text. Two rules
// keep that boring and checkable:
//
//   1. Every node is built with createElement and every value is assigned
//      through textContent. No markup string is ever produced or parsed here,
//      so a caption containing tags stays a caption.
//   2. Every value passes through safeText first, which coerces non-strings,
//      collapses whitespace, strips invisible control and format characters,
//      and bounds the length. A caption cannot silently reorder a currency
//      figure or push the rest of the card off the board.
//
// The one link carries a canonical action id through encodeURIComponent; no
// fixture URL or markup is accepted, so there is no scheme-controlled sink.

import { formatUsd } from "./evolution.js";
import { confidenceLabel, selectPrimaryAction } from "./finance-portfolio.js";

/** The longest fixture string this card renders today is ~260 characters. */
export const MAX_TEXT_LENGTH = 320;

// Cc is the control characters, Cf the invisible formatting ones — including
// the bidi overrides that can make a rendered figure read back to front.
// Whitespace is collapsed first so stripping these cannot run two words
// together.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

const STATE_LABELS = Object.freeze({
  planned: "Projected · planned",
  in_progress: "Projected · in progress",
  completed: "Completed · awaiting verification",
  verified: "Verified · evidence reviewed",
});

const NEXT_STEPS = Object.freeze({
  in_progress: "Complete the target-period measurement.",
  completed: "Review the evidence and verify the result.",
  verified: "Monitor the next equal reporting period.",
});

/**
 * Bounded display text. Anything that is not a usable string becomes the
 * fallback rather than "undefined" or "[object Object]".
 */
export function safeText(value, fallback = "Unavailable", max = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").replace(INVISIBLE, "").trim();
  if (!cleaned) return fallback;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fact(list, label, value) {
  list.append(element("dt", undefined, label), element("dd", undefined, value));
}

/**
 * A dollar figure that is missing reads as missing. formatUsd answers "$0" for
 * anything non-finite, which on this board would be a claim — that the action
 * saved nothing — rather than an absence.
 */
function usdOrUnavailable(value, fallback = "Unavailable") {
  return Number.isFinite(value) ? formatUsd(value) : fallback;
}

/**
 * One labelled figure. dt/dd because the label and the amount are a pair, and a
 * pair announced as a pair is the whole point of reading a number out loud.
 * `absent` marks the figure as not-a-number so it is not styled like one.
 */
function measure(label, amount, absent = false) {
  const node = element("div", "money-measure");
  if (absent) node.dataset.value = "none";
  node.append(element("dt", undefined, label), element("dd", undefined, amount));
  return node;
}

export function portfolioStatusLabel(status) {
  return STATE_LABELS[status] ?? "State unavailable";
}

function nextStepText(action) {
  if (action.status === "planned")
    return `Start with ${safeText(action.accountableRole, "the department leader")}.`;
  return NEXT_STEPS[action.status] ?? "Confirm this action's lifecycle state.";
}

// Did this action meet its savings target? One definition, used everywhere.
//
// The plan states a target as a recoverable-spend ceiling for the measurement
// period (`target.value`, comparison `less_than_or_equal`) and derives the
// savings figure from it: estimatedImpactUsd === baseline.value - target.value.
// So "realized savings reached the target" and "recoverable spend landed at or
// under the ceiling" are the same sentence, and this card only ever says it the
// first way. `comparison.amountUsd` is target minus realized, so a positive
// amount is a shortfall.
//
// Every figure on a card covers one 31-day measurement period. Nothing here is
// annualized, and nothing may be labelled as if it were: a monthly figure read
// as a yearly one overstates the result by roughly twelve times.
//
// The states, in the order a leader asks for them:
//   unavailable  no realized measurement exists yet — no verdict is claimed
//   not-usable   a realized figure exists but cannot be savings, because it
//                exceeds the baseline spend it was measured against
//   met          realized >= target
//   short        realized < target, by the dollar gap stated on the card
//
// There is deliberately no tolerance band. The plan defines none, so inventing
// one here would be this view's opinion presented as the plan's. Any shortfall
// reads as a shortfall and the dollar gap carries the materiality.
function outcomeState(action, comparison) {
  if (comparison === null) return {
    code: "unavailable",
    label: "Not yet measured",
    text: "No realized savings have been recorded for this action.",
  };

  const baseline = action?.baseline?.value;
  const realized = action?.realizedImpact?.value;
  if (!Number.isFinite(baseline) || !Number.isFinite(realized)) return {
    code: "not-usable",
    label: "Result not usable",
    text: "The baseline spend for this action is unavailable, so the recorded result cannot be checked against it.",
  };
  if (realized > baseline) return {
    code: "not-usable",
    label: "Result not usable",
    text: `The recorded result is larger than the ${formatUsd(baseline)} of recoverable spend it was measured against, so it cannot be read as savings. Confirm the units and the reporting period.`,
  };

  const target = usdOrUnavailable(action?.estimatedImpactUsd, "stated");
  const gap = formatUsd(Math.abs(comparison.amountUsd));
  const percent = comparison.percent === null ? "" : ` (${Math.abs(comparison.percent)}%)`;
  if (comparison.amountUsd > 0) return {
    code: "short",
    label: "Short of target",
    text: `${gap}${percent} below the ${target} savings target.`,
  };
  return {
    code: "met",
    label: "Target met",
    text: comparison.amountUsd === 0
      ? `Matched the ${target} savings target exactly.`
      : `${gap}${percent} above the ${target} savings target.`,
  };
}

const OUTCOME_MARKS = Object.freeze({
  short: "↓", met: "✓", "not-usable": "!", unavailable: "—",
});

export function renderPortfolioCard(portfolio, action, { primary = false } = {}) {
  const item = element("li", "portfolio-card");
  item.dataset.state = action.status;
  if (primary) item.dataset.priority = "highest";

  const article = element("article", "portfolio-card-content");
  const rank = Number.isFinite(action.priorityRank)
    ? String(action.priorityRank).padStart(2, "0") : "--";
  const heading = element("header", "portfolio-card-heading");
  heading.append(
    element("p", "portfolio-rank",
      `Priority ${rank} · ${safeText(action.departmentName, "Department unavailable")}`),
    element("h3", undefined, safeText(action.title, "Untitled action")),
  );

  // The measurement period travels with the figures. A dollar amount with no
  // period attached is the one number on this board a leader can misread by an
  // order of magnitude without noticing.
  const moneyBlock = element("div", "portfolio-money-block");
  const money = element("dl", "portfolio-money");
  const realizedUsd = action.realizedImpact?.value;
  money.append(
    measure("Savings target", usdOrUnavailable(action.estimatedImpactUsd)),
    measure(action.status === "verified" ? "Verified savings" : "Realized savings",
      Number.isFinite(realizedUsd) ? formatUsd(realizedUsd) : "Not yet measured",
      !Number.isFinite(realizedUsd)),
  );
  const period = safeText(portfolio.periodFor(action.target?.periodRef)?.label, "");
  moneyBlock.append(money, element("p", "portfolio-period",
    period ? `Measured over ${period}.` : "Measurement period unavailable."));

  const status = element("div", "portfolio-status-line");
  status.append(
    element("span", "portfolio-state", portfolioStatusLabel(action.status)),
    element("span", "portfolio-confidence",
      `Confidence · ${confidenceLabel(action.confidence)}`),
  );

  const next = element("p", "portfolio-next");
  next.append(element("strong", undefined, "Next action: "),
    element("span", undefined, nextStepText(action)));

  // Why it matters is the plan's own diagnosis of this action, not a sentence
  // this view writes about it. A card that has to invent its own justification
  // is asserting something no evidence behind it says.
  const why = element("p", "portfolio-why");
  why.append(element("strong", undefined, "Why it matters: "),
    element("span", undefined, safeText(action.diagnosis,
      "No diagnosis was retained for this action.")));

  // The verdict is carried by the visible words, not by the colour and not by
  // an aria-label. An aria-label on a plain element is routinely dropped, so
  // anything said only there is said to nobody; the mark is decoration on top
  // of text that already reads correctly, and is hidden from the reading order.
  const outcome = outcomeState(action, portfolio.comparison(action));
  const comparison = element("p", "portfolio-comparison");
  comparison.dataset.outcome = outcome.code;
  const comparisonMark = element("span", "portfolio-comparison-mark",
    OUTCOME_MARKS[outcome.code] ?? "—");
  comparisonMark.setAttribute("aria-hidden", "true");
  comparison.append(
    comparisonMark,
    element("strong", undefined, `Savings outcome: ${outcome.label}.`),
    element("span", undefined, outcome.text),
  );

  const details = element("details", "portfolio-details");
  const title = safeText(action.title, "Untitled action", 80);
  const summary = element("summary", undefined, "Review owner, provenance, and evidence");
  summary.setAttribute("aria-label", `Review owner, provenance, and evidence for ${title}`);
  details.append(summary);
  // Supporting evidence answers "where did this target come from?", so it shows
  // the two spend figures the savings target is the difference between. Status,
  // confidence, and the period are on the face of the card and are not repeated
  // here; a disclosure that restates the summary is surface, not evidence.
  const body = element("div", "portfolio-details-body");
  const facts = element("dl", "portfolio-facts");
  const basePeriod = safeText(portfolio.periodFor(action.baseline?.periodRef)?.label, "an unstated period");
  fact(facts, "Accountable owner", safeText(action.accountableRole, "Owner unassigned"));
  fact(facts, "Baseline recoverable spend",
    `${usdOrUnavailable(action.baseline?.value)} over ${basePeriod}`);
  fact(facts, "Target recoverable spend",
    `${usdOrUnavailable(action.target?.value)} or less over ${period || "an unstated period"}`);

  const evidenceList = element("ul", "portfolio-evidence");
  const records = portfolio.evidenceFor(action);
  if (!records.length)
    evidenceList.append(element("li", undefined, "Verification evidence unavailable."));
  for (const record of records)
    evidenceList.append(element("li", undefined, [
      safeText(record.sampleId, "Unidentified sample"),
      safeText(record.category, "Uncategorized"),
      safeText(record.summary, "No summary retained"),
    ].join(" · ")));

  const provenance = element("p", "portfolio-provenance");
  provenance.append(element("strong", undefined, "Confidence provenance: "),
    element("span", undefined,
      safeText(action.provenance?.confidence, "Provenance unavailable")));
  body.append(facts, element("h4", undefined, "Verification evidence"), evidenceList, provenance);
  details.append(body);
  article.append(heading, moneyBlock, status, why, next, comparison);
  if (primary) {
    // Why this action and not one of the others. The rank printed at the top of
    // every card is a within-department rank, so it cannot carry a promotion on
    // its own; the basis the promotion was actually made on is stated here, with
    // the figure it was made on, so a reader can check it against the disclosure
    // below rather than take it. Provenance is not restated here — it has one
    // home, in the disclosure, under one name.
    const basis = element("p", "portfolio-primary-basis");
    basis.append(element("strong", undefined, "Recommended first: "),
      element("span", undefined, `Largest supported savings target in this view, at ${
        usdOrUnavailable(action.estimatedImpactUsd)} over ${period || "an unstated period"}.`));
    const benchmark = element("p", "portfolio-primary-benchmark");
    benchmark.append(element("strong", undefined, "Recoverable-spend benchmark: "),
      element("span", undefined,
        `${usdOrUnavailable(action.target?.value)} or less, from a ${usdOrUnavailable(action.baseline?.value)} baseline.`));
    const cta = element("a", "primary-button", "Review this commitment");
    cta.href = `/savings-commitment.html?portfolioAction=${encodeURIComponent(action.actionId)}`;
    cta.setAttribute("aria-label", `Review commitment for ${title}`);
    const actions = element("div", "portfolio-primary-actions");
    actions.append(cta);
    article.append(basis, benchmark, actions);
  }
  article.append(details);
  item.append(article);
  return item;
}

export function renderPortfolioEmpty() {
  const empty = element("li", "portfolio-message");
  empty.dataset.state = "empty";
  empty.append(element("h3", undefined, "No supported opportunity"),
    element("p", undefined,
      "No opportunity meets the evidence requirements in this view. Change a filter or import supported cost and routing data."));
  return empty;
}

export function renderPortfolioUnavailable(reason) {
  const item = element("li", "portfolio-message");
  item.dataset.state = "error";
  item.setAttribute("role", "alert");
  item.append(element("h3", undefined, "Unsupported export or data class"),
    element("p", undefined,
      safeText(reason, "The bundled action lifecycle could not be read.")));
  return item;
}

// There is no renderPortfolioLoading(): the loading row is served in the markup
// so it is visible before this module runs, and the page only ever replaces it.
// A second copy here would be user-facing copy maintained in two places.

/**
 * Everything that was not recommended, behind one disclosure. Folded rather
 * than dropped: an opportunity that lost the ranking is still the answer for a
 * reader who disagrees with the ranking, and it keeps its full card so the
 * comparison is like for like.
 */
function renderRemaining(portfolio, actions) {
  const item = element("li", "portfolio-remaining");
  const disclosure = element("details", "portfolio-details portfolio-remaining-disclosure");
  const summary = element("summary", undefined,
    `Review ${actions.length} more ranked ${actions.length === 1 ? "opportunity" : "opportunities"}`);
  const nested = element("ol", "portfolio-list portfolio-list-secondary");
  nested.setAttribute("aria-label", "Remaining ranked savings opportunities");
  nested.append(...actions.map((action) => renderPortfolioCard(portfolio, action)));
  disclosure.append(summary, nested);
  item.append(disclosure);
  return item;
}

/** Departments are rebuilt from the data so a stale option cannot dead-end. */
function fillDepartmentOptions(select, portfolio) {
  const all = element("option", undefined, "All departments");
  all.value = "all";
  const options = portfolio.departments().map((department) => {
    const option = element("option", undefined, safeText(department.name, department.id));
    option.value = department.id;
    return option;
  });
  select.replaceChildren(all, ...options);
  select.value = "all";
}

/**
 * @param {ReturnType<import("./finance-portfolio.js").createFinancePortfolio>} portfolio
 * @param {{department: object, state: object, list: object, projected: object,
 *   completed: object, verified: object, count: object}} nodes
 */
export function mountFinancePortfolio(portfolio, nodes) {
  const { department, state, list, projected, completed, verified, count } = nodes;
  if (!department || !state || !list) return null;
  fillDepartmentOptions(department, portfolio);

  const render = () => {
    const filters = { department: department.value, state: state.value };
    const actions = portfolio.select(filters);
    const totals = portfolio.summarize(filters);
    if (projected) projected.textContent = formatUsd(totals.projectedUsd);
    if (completed) completed.textContent = formatUsd(totals.completedUsd);
    if (verified) verified.textContent = formatUsd(totals.verifiedUsd);
    if (count) {
      count.textContent =
        `${totals.actionCount} ${totals.actionCount === 1 ? "action" : "actions"} shown`;
    }
    list.setAttribute("aria-busy", "false");
    // Four states, one shape: a recommendation if the selection supports one,
    // the "no supported opportunity" message if it does not, and whatever is
    // left folded behind the single disclosure. Nothing is promoted on evidence
    // that is not there, and nothing is dropped for failing to be promoted.
    const recommended = selectPrimaryAction(actions);
    const rest = actions.filter((action) => action !== recommended);
    const lead = recommended
      ? renderPortfolioCard(portfolio, recommended, { primary: true })
      : renderPortfolioEmpty();
    list.replaceChildren(...(rest.length
      ? [lead, renderRemaining(portfolio, rest)]
      : [lead]));
  };

  for (const control of [department, state]) control.addEventListener("change", render);
  render();
  return render;
}
