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
// The module builds no links, images, or event handlers from fixture data, so
// there is no URL to scheme-check and no sink to escape into.

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

function measure(label, amount) {
  const node = element("div", "money-measure");
  node.append(element("span", undefined, label), element("strong", undefined, amount));
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

function comparisonText(comparison) {
  if (comparison === null) return "Awaiting a completed measurement.";
  if (comparison.amountUsd === 0) return "Matched projection exactly.";
  const percent = comparison.percent === null ? "" : ` (${Math.abs(comparison.percent)}%)`;
  return comparison.amountUsd > 0
    ? `${formatUsd(comparison.amountUsd)} below projection${percent}.`
    : `${formatUsd(Math.abs(comparison.amountUsd))} above projection${percent}.`;
}

export function renderPortfolioCard(portfolio, action) {
  const item = element("li", "portfolio-card");
  item.dataset.state = action.status;

  const heading = element("div", "portfolio-card-heading");
  const rank = Number.isFinite(action.priorityRank)
    ? String(action.priorityRank).padStart(2, "0") : "--";
  heading.append(
    element("p", "portfolio-rank",
      `Priority ${rank} · ${safeText(action.departmentName, "Department unavailable")}`),
    element("span", "portfolio-state", portfolioStatusLabel(action.status)),
    element("h3", undefined, safeText(action.title, "Untitled action")),
  );

  const money = element("div", "portfolio-money");
  money.append(
    measure("Projected savings", formatUsd(action.estimatedImpactUsd)),
    measure(action.status === "verified" ? "Verified savings" : "Completed savings",
      action.realizedImpact ? formatUsd(action.realizedImpact.value) : "Not measured"),
  );

  const next = element("p", "portfolio-next");
  next.append(element("strong", undefined, "Next action: "),
    element("span", undefined, nextStepText(action)));

  const details = element("details", "portfolio-details");
  details.append(element("summary", undefined,
    "Owner, evidence, confidence & savings comparison"));
  const body = element("div", "portfolio-details-body");
  const facts = element("dl", "portfolio-facts");
  fact(facts, "Accountable owner", safeText(action.accountableRole, "Owner unassigned"));
  fact(facts, "Confidence", confidenceLabel(action.confidence));
  fact(facts, "Savings comparison", comparisonText(portfolio.comparison(action)));
  fact(facts, "Measurement period",
    safeText(portfolio.periodFor(action.target?.periodRef)?.label, "Period unavailable"));

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

  body.append(facts, element("h4", undefined, "Verification evidence"), evidenceList,
    element("p", "portfolio-provenance",
      safeText(action.provenance?.confidence, "Provenance unavailable")));
  details.append(body);
  item.append(heading, money, next, details);
  return item;
}

export function renderPortfolioEmpty() {
  const empty = element("li", "portfolio-empty");
  empty.append(element("h3", undefined, "No matching portfolio actions"),
    element("p", undefined,
      "Change the department or lifecycle filter to see another state."));
  return empty;
}

export function renderPortfolioUnavailable(reason) {
  const item = element("li", "portfolio-empty");
  item.append(element("h3", undefined, "Portfolio unavailable"),
    element("p", undefined,
      safeText(reason, "The bundled action lifecycle could not be read.")));
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
    list.replaceChildren(...(actions.length
      ? actions.map((action) => renderPortfolioCard(portfolio, action))
      : [renderPortfolioEmpty()]));
  };

  for (const control of [department, state]) control.addEventListener("change", render);
  render();
  return render;
}
