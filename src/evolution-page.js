// Page wiring for the AI FinOps tab. This is the only layer that knows where the
// data comes from and how it becomes DOM; evolution.js keeps the scoring rules
// pure and testable.
//
// Demo only (PRODUCT.md): the seed is static, hand-authored sample data served
// from this origin. No gateway, HRIS, provider API, or customer prompt is read.
// Every node is built with createElement and textContent; the site policy forbids
// executing user-generated markup, so no markup string is ever assigned here.

import {
  actionPlanFor, benchmarkComparison, departmentPerformance, departmentTrend, evidenceForDepartment,
  QUERY_CATEGORIES, formatCount, formatPercent, formatUsd,
  letterGrade, literacyScore, quartileLabel, rankDepartmentsForHelp,
  recoverableSpendUsd, redactForScoring, summarize,
} from "/evolution.js";
import { formatIntegrationProvenance } from "/integration-contracts.js";
import { createStaticGateway } from "/static-gateway.js";
import { createFinancePortfolio } from "/finance-portfolio.js";
import { mountFinancePortfolio, renderPortfolioUnavailable } from "/finance-portfolio-view.js";

const DATA_URL = "/evolution-demo-data.json";
const CATEGORY_VARS = {
  highValue: "--cat-high-value",
  overProvisioned: "--cat-over-provisioned",
  inefficient: "--cat-inefficient",
  outOfScope: "--cat-out-of-scope",
};

/** Grade bands drive the chip and hero color; the letter and number always ship with it. */
function band(score) {
  if (score >= 80) return "good";
  if (score >= 65) return "watch";
  return "poor";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

// The portfolio's DOM lives in finance-portfolio-view.js so its untrusted-text
// handling can be exercised directly by a test; this layer only locates the
// nodes and decides what to show when the data itself will not load.
function renderFinancePortfolio(data) {
  const list = document.getElementById("portfolio-list");
  if (!list) return;
  try {
    mountFinancePortfolio(createFinancePortfolio(data), {
      department: document.getElementById("portfolio-department"),
      state: document.getElementById("portfolio-state"),
      list,
      projected: document.getElementById("portfolio-projected"),
      completed: document.getElementById("portfolio-completed"),
      verified: document.getElementById("portfolio-verified"),
      count: document.getElementById("portfolio-count"),
    });
  } catch (error) {
    // Lifecycle rows are validated one at a time, so reaching here means the
    // action plan itself is unreadable. Say so in the panel instead of leaving
    // the loading copy in place, and keep the reason in the console for review.
    console.error("finance_portfolio_unavailable", { error: error?.message ?? String(error) });
    setText("portfolio-count", "0 actions shown");
    list.replaceChildren(renderPortfolioUnavailable(
      "The bundled action lifecycle could not be read, so no savings figure is shown."));
  }
}

function renderHeadline(organization, totals) {
  const providers = Array.isArray(organization?.providers) ? organization.providers.join(", ") : "";
  setText("finops-provenance",
    `${organization?.name ?? "Organization"} · ${organization?.period ?? "current period"} · `
    + `${organization?.hrisSource ?? "HRIS"} · ${providers}`);

  const card = document.getElementById("score-card");
  if (card) card.dataset.band = band(totals.score);
  setText("score-grade", totals.grade);
  setText("score-value", `${totals.score} / 100 · grade ${totals.grade}`);
  setText("score-peer",
    `${totals.scoreExplanation.version} · ${totals.scoreExplanation.rule} ${totals.scoreExplanation.arithmetic}`);

  setText("kpi-spend-value", formatUsd(totals.spendUsd));
  setText("kpi-spend-note",
    `${formatCount(totals.queries)} scored queries · ${totals.departments} departments · ${formatCount(totals.headcount)} people`);
  setText("kpi-recoverable-value", formatUsd(totals.recoverableUsd));
  setText("kpi-recoverable-note",
    `${formatPercent(totals.recoverableShare)} of spend — down-routing, training, and leakage`);
  setText("kpi-productive-value", formatPercent(totals.mix.highValue));
  setText("kpi-productive-note",
    `${formatUsd(Math.round(totals.spendUsd * totals.mix.highValue))} of scored spend was high-value`);
  setText("kpi-peer-value", `${organization?.peerPercentile ?? "–"}th`);
  setText("kpi-peer-note", `${quartileLabel(organization?.peerPercentile)} · ${organization?.peerCohort ?? "peer cohort"}`);
}

function renderMix(totals) {
  const bar = document.getElementById("mix-bar");
  const legend = document.getElementById("mix-legend");
  if (!bar || !legend) return;
  bar.replaceChildren();
  legend.replaceChildren();

  const summary = [];
  for (const category of QUERY_CATEGORIES) {
    const share = totals.mix[category.key] ?? 0;
    const spend = Math.round(totals.spendUsd * share);
    const color = `var(${CATEGORY_VARS[category.key]})`;

    const segment = element("div", "mix-segment");
    segment.style.flexGrow = String(Math.max(share, 0.004));
    segment.style.background = color;
    // Native tooltip: the same numbers are already visible in the legend, so the
    // hover layer is an accelerator rather than the only way to read a segment.
    segment.title = `${category.label} · ${formatPercent(share)} · ${formatUsd(spend)}`;
    bar.append(segment);
    summary.push(`${category.label} ${formatPercent(share)}`);

    const item = element("li");
    item.style.color = color;
    const head = element("div", "legend-head");
    const label = element("span", "legend-label");
    const swatch = element("span", "legend-swatch");
    swatch.style.background = color;
    label.append(swatch, element("span", undefined, category.label));
    head.append(label, element("span", "legend-share", formatPercent(share)));
    item.append(head,
      element("p", "legend-spend", `${formatUsd(spend)} of spend`),
      element("p", "legend-copy", category.description),
      element("p", "legend-action", category.systemAction));
    legend.append(item);
  }
  setText("mix-summary", `Spend mix: ${summary.join(", ")}.`);
}

function gradeChip(score) {
  const chip = element("span", "grade-chip");
  chip.dataset.band = band(score);
  chip.append(document.createTextNode(letterGrade(score)), element("span", undefined, String(score)));
  return chip;
}

function signed(value, suffix = "") {
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function definitionTerm(label, value) {
  const fragment = document.createDocumentFragment();
  fragment.append(element("dt", undefined, label), element("dd", undefined, value));
  return fragment;
}

function renderUnavailableAction(reason) {
  const actionSurface = document.getElementById("action-result");
  if (actionSurface) {
    actionSurface.dataset.status = "unavailable";
    actionSurface.setAttribute("aria-busy", "false");
  }
  setText("action-status", "Result unavailable");
  setText("action-title", "No prioritized intervention available");
  setText("action-rationale", reason);
  setText("action-impact", "Unavailable");
  setText("action-confidence", "Unavailable");
  setText("action-owner", "Unassigned");
  setText("action-provenance", "Bundled static fixture · no live fallback");
  setText("action-baseline", "Unavailable");
  setText("action-target", "Unavailable");
  setText("action-estimate", "Unavailable");
  setText("action-realized", "Not available");
  setText("action-diagnosis", reason);
}

function renderDecisionDetail(department, data) {
  const performance = departmentPerformance(department);
  const trend = departmentTrend(department);
  const comparison = benchmarkComparison(department, data.benchmark ?? {});
  const sampling = department.sampling ?? {};
  const provenance = data.provenance ?? {};
  const action = actionPlanFor(department);

  setText("detail-name", department.name ?? "Unnamed department");
  setText("detail-score", performance.available ? `${performance.score}/100` : "Unavailable");
  setText("detail-sample", performance.available
    ? `${performance.rubricVersion} · ${sampling.sampledQueries} sampled queries · through ${sampling.sampledThrough} (${sampling.freshnessLabel}) · 95% sampling uncertainty ±${performance.uncertaintyPoints} points · ${provenance.label}`
    : `${performance.rubricVersion} · Sampling unavailable: ${performance.reason} · ${provenance.label}`);

  const actionSurface = document.getElementById("action-result");
  if (actionSurface) {
    actionSurface.dataset.status = action.status;
    actionSurface.setAttribute("aria-busy", "false");
  }
  setText("action-status", action.statusLabel);
  if (!action.available) {
    renderUnavailableAction(performance.available
      ? "A score is available, but this fixture does not contain a reviewed intervention."
      : `No action conclusion: ${performance.reason}`);
  } else {
    setText("action-title", action.title);
    setText("action-rationale", action.rationale);
    setText("action-impact", action.impact);
    setText("action-confidence", action.confidence);
    setText("action-owner", action.accountableRole);
    setText("action-provenance", action.provenance);
    setText("action-baseline", formatUsd(action.baselineUsd));
    setText("action-target", formatUsd(action.targetUsd));
    setText("action-estimate", formatUsd(action.estimatedSavingsUsd));
    setText("action-realized", action.realizedSavingsUsd === null
      ? "Not yet simulated" : formatUsd(action.realizedSavingsUsd));
    setText("action-diagnosis", action.diagnosis);
  }

  setText("trend-answer", trend.worsening === true
    ? "Yes. Cost rose while performance fell."
    : trend.worsening === false ? "No. Cost and performance are not jointly worsening."
      : "Unavailable. The equal-period comparison is incomplete.");
  const trendList = document.getElementById("trend-comparison");
  trendList?.replaceChildren(
    definitionTerm("Cost", trend.costAvailable ? signed(trend.costChangePercent, "%") : "Unavailable"),
    definitionTerm("Performance", trend.performanceAvailable
      ? signed(trend.performanceChangePoints, " points") : "Unavailable"),
    definitionTerm("Periods", trend.period && trend.comparisonPeriod
      ? `${trend.period} vs ${trend.comparisonPeriod} · ${trend.equalLengthDays}-day periods`
      : "Equal-period dates unavailable"),
  );

  setText("benchmark-answer", comparison.available
    ? `${signed(comparison.deltaPoints, " points")} versus the cohort median of ${data.benchmark.medianScore}.`
    : `Unavailable. ${comparison.reason}`);
  const benchmark = data.benchmark ?? {};
  setText("benchmark-method",
    `${benchmark.name ?? "Benchmark unavailable"} · ${benchmark.organizationCount ?? "–"} synthetic organizations · `
    + `${benchmark.segment ?? "segment unavailable"} · snapshot ${benchmark.snapshotDate ?? "unavailable"} · `
    + `${benchmark.rubricVersion ?? "rubric unavailable"} · ${benchmark.provenance ?? provenance.label ?? "provenance unavailable"}`);

  const list = document.getElementById("department-evidence");
  list?.replaceChildren();
  if (!performance.available) {
    list?.append(element("li", "evidence-empty",
      `No evidence conclusion: ${performance.reason}`));
    return;
  }
  const evidence = evidenceForDepartment(data.evidence, department.id);
  if (!evidence.length) {
    list?.append(element("li", "evidence-empty",
      "No scored evidence was retained for this department in the bundled sample."));
    return;
  }
  for (const record of evidence) {
    const item = element("li", "evidence-item");
    item.append(
      element("p", "evidence-label", `${record.category} · ${record.sampleId}`),
      element("p", "evidence-summary", record.summary),
      element("p", "evidence-meta",
        `${performance.rubricVersion} · scored ${record.scoredAt} · ${sampling.freshnessLabel} · synthetic redacted fixture`),
    );
    list?.append(item);
  }
}

function renderDecisionSurface(data, departments) {
  const provenance = data.provenance ?? {};
  setText("decision-provenance",
    `${provenance.label ?? "Synthetic bundled fixture"} · generated ${provenance.generatedAt ?? "date unavailable"} · `
    + `${provenance.billingSource ?? "billing source unavailable"} · ${provenance.orgSource ?? "org source unavailable"}`);
  const list = document.getElementById("department-priority");
  list?.replaceChildren();
  const ranked = rankDepartmentsForHelp(departments);
  if (!ranked.length) {
    list?.append(element("li", "evidence-empty", "No departments are present in this bundled period."));
    setText("detail-name", "No department result");
    setText("detail-score", "Unavailable");
    setText("detail-sample", "The bundled period contains no department records.");
    renderUnavailableAction("No department records are available in this bundled period.");
    return;
  }
  ranked.forEach((department, index) => {
    const performance = departmentPerformance(department);
    const item = element("li");
    const button = element("button", "department-choice");
    button.type = "button";
    button.dataset.departmentId = department.id;
    button.setAttribute("aria-pressed", String(index === 0));
    button.append(
      element("span", "priority-rank", performance.available ? String(index + 1).padStart(2, "0") : "—"),
      element("span", "priority-name", department.name),
      element("span", "priority-score", performance.available
        ? `${performance.score}/100 · ±${performance.uncertaintyPoints}`
        : "Sampling unavailable"),
    );
    button.addEventListener("click", () => {
      list.querySelectorAll("button").forEach((candidate) =>
        candidate.setAttribute("aria-pressed", String(candidate === button)));
      renderDecisionDetail(department, data);
    });
    item.append(button);
    list?.append(item);
  });
  renderDecisionDetail(ranked[0], data);
}

function renderRedaction(samples) {
  const list = document.getElementById("redaction-list");
  if (!list) return;
  list.replaceChildren();

  for (const sample of Array.isArray(samples) ? samples : []) {
    const item = element("li", "redaction-item");
    item.append(element("p", "redaction-label", sample.label ?? "Prompt"));
    const pair = element("div", "redaction-pair");

    const raw = element("div", "redaction-side");
    raw.append(element("h3", undefined, "As submitted"),
      element("p", "redaction-text redaction-raw", sample.raw ?? ""));
    const clean = element("div", "redaction-side");
    clean.append(element("h3", undefined, "As scored"),
      element("p", "redaction-text redaction-clean", redactForScoring(sample.raw ?? "")));

    pair.append(raw, clean);
    item.append(pair);
    list.append(item);
  }
}

async function loadData() {
  const response = await fetch(DATA_URL, { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Demo data returned ${response.status}`);
  return response.json();
}

async function init() {
  if (!document.getElementById("department-priority")) return;
  const gateway = createStaticGateway();
  const refreshGateway = document.getElementById("integration-gateway-refresh");
  gateway.subscribe(({ status, inspection, metadata }) => {
    if (refreshGateway) refreshGateway.disabled = status === "pending";
    if (status === "pending") {
      setText("integration-contract-provenance",
        `Gateway pending · ${metadata.sourceType} · sample ${metadata.sampleWindow} · freshness ${metadata.freshness} · failure none`);
      return;
    }
    if (status === "completed") {
      setText("integration-contract-provenance",
        `Gateway completed · ${formatIntegrationProvenance(inspection)} · sample ${metadata.sampleWindow} · freshness ${metadata.freshness} · failure ${metadata.failureState}`);
      return;
    }
    setText("integration-contract-provenance",
      `Gateway unavailable · ${metadata.sourceType} · sample ${metadata.sampleWindow} · freshness ${metadata.freshness} · failure ${metadata.failureState} · no live fallback`);
  });
  refreshGateway?.addEventListener("click", () => gateway.refresh());
  gateway.refresh();

  let data;
  try {
    data = await loadData();
  } catch {
    setText("finops-provenance", "Demo data unavailable — the executive view will populate once the feed returns.");
    setText("score-value", "Score unavailable");
    const list = document.getElementById("department-priority");
    list?.replaceChildren(element("li", "evidence-empty",
      "Bundled demo data could not be loaded. No live fallback was attempted."));
    setText("detail-name", "Demo result unavailable");
    setText("detail-score", "Unavailable");
    setText("detail-sample", "The bundled static fixture could not be read.");
    renderUnavailableAction("The bundled static fixture could not be read. No live analysis was attempted.");
    return;
  }

  const departments = Array.isArray(data.departments) ? data.departments : [];
  const totals = summarize(departments);
  renderFinancePortfolio(data);
  renderHeadline(data.organization ?? {}, totals);
  renderDecisionSurface(data, departments);
  renderMix(totals);
  renderRedaction(data.redactionSamples);

  document.documentElement.dataset.shiplogEvolution = "ready";
}

init();
