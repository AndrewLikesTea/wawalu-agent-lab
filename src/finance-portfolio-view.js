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
// The module builds no images and no event handlers at all, and its one link —
// the handoff into the commitment workflow — carries a literal href written
// here. No fixture value ever reaches a URL, so there is no scheme to check and
// no sink to escape into.

import { formatUsd } from "./evolution.js";
import { confidenceLabel } from "./finance-portfolio.js";

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

function commitmentLink(opportunityId, label = "Continue to commitment") {
  const link = element("a", "primary-button", label);
  link.href = `/savings-commitment.html?opportunity=${encodeURIComponent(opportunityId)}`;
  return link;
}

/** The first item is the ranked contract's winner; this view never re-scores it. */
export function renderRecommendedAction(portfolio, action) {
  const item = element("li", "portfolio-recommendation");
  item.dataset.state = action.status;
  const article = element("article", "portfolio-recommendation-content");

  const lead = element("div", "portfolio-recommendation-lead");
  lead.append(
    element("p", "portfolio-rank", "Recommended next action"),
    element("h3", undefined, safeText(action.title, "Untitled action")),
    element("p", "portfolio-why", safeText(action.diagnosis, "Why this matters is unavailable.")),
  );
  const facts = element("dl", "portfolio-recommendation-facts");
  fact(facts, "Recoverable spend benchmark", usdOrUnavailable(action.baseline?.value));
  fact(facts, "Projected recovery", usdOrUnavailable(action.estimatedImpactUsd));
  fact(facts, "Confidence", confidenceLabel(action.confidence));
  fact(facts, "Owning department",
    `${safeText(action.departmentName, "Department unavailable")} · ${safeText(action.accountableRole, "Owner unassigned")}`);

  const actionRow = element("div", "portfolio-recommendation-action");
  actionRow.append(commitmentLink(action.commitmentCandidateId ?? action.actionId), element("p", undefined,
    `Next step: ${nextStepText(action)} Then record it in the existing commitment workflow.`));
  // The lead recommendation carries the same evidence disclosure as a card. A
  // recommendation a leader cannot trace back to its evidence is an assertion,
  // and the one action being singled out is the one that most needs sourcing.
  article.append(lead, facts, actionRow, evidenceDisclosure(portfolio, action));
  item.append(article);
  return item;
}

/** The most findings a consolidated line names before it counts the rest. */
const LIST_LIMIT = 3;

/**
 * A joined list that stays bounded. Each element is already length-capped, but
 * a hostile export chooses how many elements there are, so an uncapped join is
 * an uncapped string: one row with 500 evidence refs would otherwise push every
 * other opportunity off the screen.
 */
function joinCapped(values, limit = LIST_LIMIT) {
  const unique = [...new Set(values)];
  const shown = unique.slice(0, limit).join(", ");
  return unique.length > limit ? `${shown}, and ${unique.length - limit} more` : shown;
}

function renderOpportunityGroup(portfolio, actions) {
  const item = element("li", "portfolio-opportunity");
  const departments = joinCapped(actions.map((action) => safeText(action.departmentName)));
  const amount = actions.reduce((total, action) => total
    + (Number.isFinite(action.estimatedImpactUsd) ? action.estimatedImpactUsd : 0), 0);
  const confidence = Math.min(...actions.map((action) => Number(action.confidence?.value))
    .filter(Number.isFinite));
  // Consolidation is stated, never silent: a summed figure that does not say how
  // many findings it sums reads as one finding worth that much.
  const merged = actions.length > 1 ? ` · ${actions.length} related findings` : "";
  item.append(
    element("h4", undefined, safeText(actions[0].title, "Untitled opportunity")),
    element("p", "portfolio-opportunity-summary",
      `${usdOrUnavailable(amount)} projected recovery · ${confidenceLabel({ value: confidence })} confidence · ${departments}${merged}`),
    element("p", undefined, safeText(actions[0].diagnosis, "Why this matters is unavailable.")),
  );
  // Evidence is gathered across every consolidated finding. Reading only the
  // first one's would source a summed figure from a fraction of its rows.
  const evidence = actions.flatMap((action) => portfolio.evidenceFor(action));
  item.append(element("p", "portfolio-opportunity-evidence", evidence.length
    ? `Evidence: ${joinCapped(evidence.map((record) => `${safeText(record.sampleId)} · ${safeText(record.category)}`))}.`
    : "Evidence: unavailable."));
  item.append(element("p", "portfolio-opportunity-provenance",
    `Provenance: ${safeText(actions[0].provenance?.confidence, "unavailable")}`));
  return item;
}

/**
 * Two findings are the same finding only when their titles are identical as
 * authored. Grouping on the displayed string would merge anything sharing a
 * truncated prefix, and would fold every untitled row into one summed heading —
 * either way a real finding disappears into another one's narrative and its
 * dollars are re-attributed. Untitled rows therefore each stand alone, and the
 * two key spaces are prefixed so an authored title cannot collide with the key
 * an untitled row is given.
 */
function consolidate(actions) {
  const groups = new Map();
  for (const [index, action] of actions.entries()) {
    const titled = typeof action.title === "string" && action.title.trim();
    const key = titled ? `title:${action.title}` : `row:${index}`;
    groups.set(key, [...(groups.get(key) ?? []), action]);
  }
  return [...groups.values()];
}

export function renderRemainingOpportunities(portfolio, actions) {
  const item = element("li", "portfolio-more");
  const disclosure = element("details", "portfolio-details portfolio-more-details");
  // Native details owns its expanded state. Do not add a static aria-expanded.
  disclosure.append(element("summary", undefined,
    `Review ${actions.length} remaining ${actions.length === 1 ? "opportunity" : "opportunities"}`));
  const intro = element("p", undefined,
    "Related findings are consolidated by action so the recommendation remains the clear priority.");
  const list = element("ul", "portfolio-opportunity-list");
  list.append(...consolidate(actions).map((group) => renderOpportunityGroup(portfolio, group)));
  disclosure.append(intro, list);
  item.append(disclosure);
  return item;
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

/**
 * Owner, provenance, and evidence for one action, behind native disclosure.
 *
 * Shared by the ranked recommendation and the cards so the recommendation is
 * evidence-backed through the same code path rather than a second copy that can
 * drift. The details element owns its own expanded state, so nothing here sets
 * aria-expanded: a value written once goes stale the moment a reader opens it,
 * and a reader would then be told the evidence is still hidden while it is on
 * screen.
 */
function evidenceDisclosure(portfolio, action) {
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
  const period = safeText(portfolio.periodFor(action.target?.periodRef)?.label, "an unstated period");
  const basePeriod = safeText(portfolio.periodFor(action.baseline?.periodRef)?.label, "an unstated period");
  fact(facts, "Accountable owner", safeText(action.accountableRole, "Owner unassigned"));
  fact(facts, "Baseline recoverable spend",
    `${usdOrUnavailable(action.baseline?.value)} over ${basePeriod}`);
  fact(facts, "Target recoverable spend",
    `${usdOrUnavailable(action.target?.value)} or less over ${period}`);

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
  return details;
}

const OUTCOME_MARKS = Object.freeze({
  short: "↓", met: "✓", "not-usable": "!", unavailable: "—",
});

export function renderPortfolioCard(portfolio, action) {
  const item = element("li", "portfolio-card");
  item.dataset.state = action.status;

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

  article.append(heading, moneyBlock, status, next, comparison,
    evidenceDisclosure(portfolio, action));
  item.append(article);
  return item;
}

export function renderPortfolioEmpty() {
  const empty = element("li", "portfolio-message");
  empty.dataset.state = "empty";
  empty.append(element("h3", undefined, "No matching portfolio actions"),
    element("p", undefined,
      "Change the department or lifecycle filter to see another state."));
  return empty;
}

export function renderNoSupportedOpportunity() {
  const empty = element("li", "portfolio-message");
  empty.dataset.state = "empty";
  empty.append(element("h3", undefined, "No supported savings opportunity"),
    element("p", undefined,
      "This analysis did not find enough evidence for a recommended action. Import another supported period or broaden the evaluated scope."));
  return empty;
}

export function renderPortfolioUnsupported(reason) {
  const item = element("li", "portfolio-message");
  item.dataset.state = "unsupported";
  item.append(element("h3", undefined, "This export cannot be ranked"),
    element("p", undefined, safeText(reason,
      "Its export format or evaluated classes are not supported by this portfolio. Use a supported FinOps export; no recommendation was inferred.")));
  return item;
}

/**
 * Nothing to rank has two causes a leader has to act on differently, so the
 * data decides which one is claimed rather than the call site guessing.
 *
 * Rows the export declared that this analysis could not evaluate are already
 * reported by the portfolio contract; if there are any, the honest answer is
 * that this export could not be ranked, and the rows are named so someone can
 * go and look. With no rejected rows, everything was evaluated and there simply
 * was no opportunity — which is a result, not a failure, and gets no alert.
 */
function nothingToRank(portfolio) {
  const rejected = portfolio.rejectedLifecycle ?? [];
  if (!rejected.length) return renderNoSupportedOpportunity();
  const named = joinCapped(rejected.map((row) =>
    `${safeText(row.actionId, "unnamed row")} (${safeText(row.code, "unstated reason")})`));
  return renderPortfolioUnsupported(`${rejected.length} declared ${rejected.length === 1
    ? "row" : "rows"} could not be evaluated by this analysis: ${named}. No recommendation was inferred from them.`);
}

export function renderPortfolioUnavailable(reason) {
  const item = element("li", "portfolio-message");
  item.dataset.state = "error";
  item.setAttribute("role", "alert");
  item.append(element("h3", undefined, "Portfolio unavailable"),
    element("p", undefined,
      safeText(reason, "The bundled action lifecycle could not be read.")));
  return item;
}

// There is no renderPortfolioLoading(): the loading row is served in the markup
// so it is visible before this module runs, and the page only ever replaces it.
// A second copy here would be user-facing copy maintained in two places.

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
    if (!actions.length) {
      // Which empty this is comes from the data, not from the control values:
      // the portfolio normalizes an unrecognized filter back to "all", so a
      // junk state would otherwise be blamed on a filter the reader never set.
      const hidden = portfolio.select().length > 0;
      list.replaceChildren(hidden ? renderPortfolioEmpty() : nothingToRank(portfolio));
      return;
    }
    const [recommended, ...remaining] = actions;
    list.replaceChildren(renderRecommendedAction(portfolio, recommended),
      ...(remaining.length ? [renderRemainingOpportunities(portfolio, remaining)] : []));
  };

  for (const control of [department, state]) control.addEventListener("change", render);
  render();
  return render;
}
