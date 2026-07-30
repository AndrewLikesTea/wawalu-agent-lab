// One claim, painted the same way whatever produced it.
//
// The page asks one question — did the savings we projected actually show up? —
// and every state answers it in the same three places: the headline, the one
// material metric, and the one thing to do next. A demonstration claim, an
// imported verdict, an insufficient-evidence state, and a no-commitment state
// all render through this path, so no state is an empty box and none of them
// moves the reader's eye somewhere new.
//
// The import and export controls are NOT painted here. They live in the page's
// own markup, because this region is replaced on every read and a control that
// is replaced while it holds focus takes the visitor's place in the document
// with it.

const VERDICT_TONE = Object.freeze({
  verified: "verified",
  partially_realized: "partial",
  not_realized: "missed",
});

const SOURCE_KICKER = Object.freeze({
  imported: "Imported evidence",
  demo: "Demonstration data",
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fact(list, label, value) {
  const item = el("div", "sac-fact");
  item.append(el("dt", undefined, label), el("dd", undefined, value));
  list.append(item);
}

/** The tone the headline is painted in, from the state rather than from a word. */
function tone(claim) {
  if (claim.source === "demo") return "demo";
  if (claim.status !== "ok") return claim.reason === "insufficient_evidence" ? "provisional" : "none";
  return VERDICT_TONE[claim.verdict] ?? "provisional";
}

/**
 * Paint one claim.
 *
 * @param claim from `importedSavingsClaim` or `demoSavingsClaim`. Both carry
 *   every key this function reads, so there is no shape to branch on beyond the
 *   optional metric and the optional lists.
 */
export function renderSavingsActionCenter(claim) {
  const article = el("article", "sac-focus");
  article.setAttribute("aria-labelledby", "sac-question");
  article.dataset.source = claim.source;
  article.dataset.state = tone(claim);

  const heading = el("header", "sac-heading");
  const question = el("h2", undefined, claim.question);
  question.id = "sac-question";
  heading.append(el("p", "sac-kicker", SOURCE_KICKER[claim.source] ?? "Evidence"), question);
  const headline = el("p", "sac-headline", claim.headline);
  headline.dataset.state = tone(claim);
  heading.append(headline);
  article.append(heading);

  if (claim.metric) {
    const metric = el("p", "sac-metric");
    metric.append(
      el("span", "sac-metric-label", claim.metric.label),
      el("strong", "sac-metric-value", claim.metric.value),
      el("span", "sac-metric-comparison", claim.metric.comparison),
    );
    article.append(metric);
  }

  const decision = el("section", "sac-decision");
  decision.setAttribute("aria-labelledby", "sac-decision-title");
  const decisionTitle = el("h3", undefined, claim.nextAction.label);
  decisionTitle.id = "sac-decision-title";
  decision.append(el("p", "sac-kicker", "Do this next"), decisionTitle,
    el("p", undefined, claim.nextAction.rationale));
  article.append(decision);

  if (claim.facts.length) {
    const facts = el("dl", "sac-facts");
    for (const entry of claim.facts) fact(facts, entry.label, entry.value);
    article.append(facts);
  }

  if (claim.months.length) {
    const monthList = el("ol", "sac-months");
    for (const month of claim.months) {
      const item = el("li", "sac-month");
      item.dataset.verdict = month.verdict;
      item.append(el("span", "sac-month-label", month.label),
        el("span", "sac-month-figure", `${month.realized} realized · ${month.variance} against plan`));
      monthList.append(item);
    }
    const wrapper = el("section", "sac-month-block");
    wrapper.setAttribute("aria-labelledby", "sac-months-title");
    const title = el("h3", undefined, `Counted months (${claim.monthsCounted ?? claim.months.length})`);
    title.id = "sac-months-title";
    wrapper.append(title, monthList);
    article.append(wrapper);
  }

  if (claim.notes.length) {
    const notes = el("ul", "sac-notes");
    notes.setAttribute("aria-label", "What was set aside, and why");
    for (const note of claim.notes) notes.append(el("li", undefined, note));
    article.append(notes);
  }

  article.append(renderCalculation(claim));
  return article;
}

/**
 * Paint the recurring-review contract before any legacy savings reconciliation.
 * Benchmark and prior-result evidence are deliberately contained by `details`;
 * the surface itself carries only readiness and one next action.
 */
export function renderRecurringReviewReadiness(review, { source = "demo" } = {}) {
  const article = el("article", "sac-focus");
  article.setAttribute("aria-labelledby", "sac-question");
  article.dataset.source = source;
  article.dataset.reviewState = review.state;

  const heading = el("header", "sac-heading");
  const question = el("h2", undefined, review.question);
  question.id = "sac-question";
  const answer = review.ready
    ? "Yes. The current period, benchmark, and retained prior outcome are comparable."
    : "No. The review does not yet support an executive recommendation.";
  const headline = el("p", "sac-headline", answer);
  // The headline's tone is set from readiness, not from the words in it: the
  // stylesheet's default is the caution colour, so a ready review painted
  // without this reads as a warning it is not.
  headline.dataset.state = review.ready ? "verified" : "demo";
  heading.append(el("p", "sac-kicker", source === "demo" ? "Demonstration data" : "Local import"),
    question, headline);
  article.append(heading);

  const decision = el("section", "sac-decision");
  decision.setAttribute("aria-labelledby", "sac-decision-title");
  const title = el("h3", undefined, review.nextAction.label);
  title.id = "sac-decision-title";
  decision.append(el("p", "sac-kicker", "Do this next"), title,
    el("p", undefined, review.nextAction.rationale));
  article.append(decision);

  const details = el("details", "sac-details");
  details.append(el("summary", undefined, "Review benchmark and prior result"));
  const body = el("div", "sac-details-body");
  const rows = el("dl", "sac-calculation");
  const value = (number) => number === null ? "Not available" : String(number);
  fact(rows, "Current value", value(review.metrics.currentValue));
  fact(rows, "Benchmark delta", value(review.metrics.benchmarkDelta));
  fact(rows, "Prior-action outcome delta", value(review.metrics.priorActionOutcomeDelta));
  fact(rows, "Improvement direction",
    review.metrics.optimizationDirection ?? "Not declared");
  fact(rows, "Recurring-review verdict", review.verdict.verdict.replaceAll("_", " "));
  fact(rows, "Confidence", review.verdict.confidence);
  fact(rows, "Permitted conclusion", review.verdict.statement);
  fact(rows, "Evidence boundary",
    `Comparable: ${review.verdict.evidenceBoundaries.comparable ? "yes" : "no"} · `
    + `complete sampling: ${review.verdict.evidenceBoundaries.completeSampling ? "yes" : "no"} · `
    + `retained baseline: ${review.verdict.evidenceBoundaries.retainedBaseline ? "yes" : "no"}`);
  body.append(rows);
  body.append(el("p", "sac-caveat", review.recommendation
    ? "Recommendation evidence is available. Positive interpreted deltas mean improvement; negative interpreted deltas mean deterioration."
    : `Recommendation withheld. Missing or mismatched evidence: ${review.evidence.gaps.join(", ")}.`));
  body.append(el("p", "sac-contracts",
    `${review.schemaVersion} · confidence weights `
    + `comparability ${review.verdict.confidenceBasis.policy.weights.comparability}, `
    + `sampling ${review.verdict.confidenceBasis.policy.weights.sampling}, `
    + `baseline ${review.verdict.confidenceBasis.policy.weights.baseline}`));
  details.append(body);
  article.append(details);
  return article;
}

/**
 * The arithmetic, behind a native disclosure.
 *
 * `details`/`summary` is used rather than a scripted panel because it is
 * keyboard operable and announced as expandable without a line of JavaScript,
 * and because it keeps working in the state this page most needs it to: when the
 * page's own module failed to run.
 */
function renderCalculation(claim) {
  const details = el("details", "sac-details");
  details.append(el("summary", undefined, "How this figure was calculated"));
  const body = el("div", "sac-details-body");
  if (claim.calculation.rows.length) {
    const rows = el("dl", "sac-calculation");
    for (const row of claim.calculation.rows) fact(rows, row.label, row.value);
    body.append(rows);
  } else {
    body.append(el("p", undefined, "No figure was computed, so there is no arithmetic to show."));
  }
  if (claim.calculation.caveat) {
    body.append(el("p", "sac-caveat", claim.calculation.caveat));
  }
  if (claim.calculation.versions.length) {
    body.append(el("p", "sac-contracts", claim.calculation.versions.join(" · ")));
  }
  details.append(body);
  return details;
}

/** Files that could not be read, named one by one with the reader's sentence. */
export function renderEvidenceRejections(rejected = []) {
  if (!rejected.length) return null;
  const section = el("section", "sac-rejections");
  section.setAttribute("role", "alert");
  section.append(el("h2", undefined,
    `${rejected.length} file${rejected.length === 1 ? "" : "s"} could not be read`));
  const list = el("ul", "sac-rejection-list");
  for (const entry of rejected) {
    list.append(el("li", undefined, `${entry.name}: ${entry.message}`));
  }
  section.append(list);
  return section;
}

export function renderSavingsActionCenterError() {
  const error = el("section", "sac-state");
  error.setAttribute("role", "alert");
  error.append(el("h2", undefined, "Monthly savings review unavailable"),
    el("p", undefined,
      "The bundled contracts could not be reconciled. No savings decision is shown."));
  return error;
}
