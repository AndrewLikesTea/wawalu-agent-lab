// Page wiring for the AI FinOps tab. This is the only layer that knows where the
// data comes from and how it becomes DOM; evolution.js keeps the scoring rules
// pure and testable.
//
// Demo only (PRODUCT.md): the seed is static, hand-authored sample data served
// from this origin. No gateway, HRIS, provider API, or customer prompt is read.
// Every node is built with createElement and textContent; the site policy forbids
// executing user-generated markup, so no markup string is ever assigned here.

import {
  QUERY_CATEGORIES, formatCount, formatPercent, formatUsd,
  letterGrade, literacyScore, quartileLabel, rankDepartments, recommendationFor,
  recoverableSpendUsd, redactForScoring, summarize, valuePerThousandUsd,
} from "/evolution.js";

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
    `${quartileLabel(organization?.peerPercentile)} · cohort median ${organization?.peerMedianScore ?? "–"}`);

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

function trendLine(score, previous) {
  const before = Number(previous);
  if (!Number.isFinite(before)) return null;
  const delta = score - before;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const sign = delta > 0 ? "+" : "";
  return element("span", `trend trend-${direction}`,
    delta === 0 ? "no change" : `${sign}${delta} vs prior period`);
}

function renderDepartments(departments, sortKey) {
  const body = document.getElementById("department-rows");
  if (!body) return;
  body.replaceChildren();

  for (const department of rankDepartments(departments, sortKey)) {
    const score = literacyScore(department.mix);
    const row = element("tr");

    const nameCell = element("td");
    const name = element("div", "dept-name");
    name.append(element("strong", undefined, department.name),
      element("span", undefined, `${department.costCenter ?? "—"} · ${department.leader ?? "—"}`));
    nameCell.append(name);

    const peopleCell = element("td", "numeric", `${department.headcount}`);
    const spendCell = element("td", "numeric", formatUsd(department.spendUsd));

    const scoreCell = element("td");
    scoreCell.append(gradeChip(score));
    const trend = trendLine(score, department.previousScore);
    if (trend) scoreCell.append(trend);

    const valueCell = element("td", "numeric", formatCount(valuePerThousandUsd(department)));
    const recoverableCell = element("td", "numeric recoverable", formatUsd(recoverableSpendUsd(department)));
    const peerCell = element("td", "numeric", quartileLabel(department.peerPercentile));

    row.append(nameCell, peopleCell, spendCell, scoreCell, valueCell, recoverableCell, peerCell);
    body.append(row);
  }

  if (!body.children.length) {
    const row = element("tr");
    row.append(element("td", "table-empty", "No departments in this period."));
    row.firstChild.colSpan = 7;
    body.append(row);
  }
}

function renderActions(departments) {
  const list = document.getElementById("action-list");
  if (!list) return;
  list.replaceChildren();

  const ranked = rankDepartments(departments, "recoverableUsd").slice(0, 3);
  for (const department of ranked) {
    const recommendation = recommendationFor(department);
    const item = element("li", "action-card");
    const copy = element("div", "action-copy");
    copy.append(
      element("p", "action-team", department.name),
      element("p", "action-headline", recommendation.headline),
      element("p", "action-step", recommendation.action));
    const amount = element("div", "action-amount");
    amount.append(element("strong", undefined, formatUsd(recommendation.lostUsd)),
      element("span", undefined, "recoverable / period"));
    item.append(copy, amount);
    list.append(item);
  }

  if (!list.children.length) list.append(element("li", "table-empty", "No recommendations for this period."));
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
  if (!document.getElementById("department-rows")) return;
  let data;
  try {
    data = await loadData();
  } catch {
    setText("finops-provenance", "Demo data unavailable — the executive view will populate once the feed returns.");
    setText("score-value", "Score unavailable");
    return;
  }

  const departments = Array.isArray(data.departments) ? data.departments : [];
  const totals = summarize(departments);
  renderHeadline(data.organization ?? {}, totals);
  renderMix(totals);
  renderActions(departments);
  renderRedaction(data.redactionSamples);

  const sort = document.getElementById("department-sort");
  const draw = () => renderDepartments(departments, sort?.value ?? "recoverableUsd");
  sort?.addEventListener("change", draw);
  draw();

  document.documentElement.dataset.shiplogEvolution = "ready";
}

init();
