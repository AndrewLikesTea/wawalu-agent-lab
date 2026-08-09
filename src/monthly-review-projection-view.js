import { validateMonthlyReviewProjection } from "./monthly-review-projection.js";

const percent = (ppm) => Number.isInteger(ppm) ? `${(ppm / 10_000).toFixed(1)}%` : "unavailable";
const money = (value) => Number.isFinite(value) ? `$${value.toLocaleString("en-US")}` : "Unavailable";
const text = (doc, tag, className, value) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
};
const labelled = (doc, label, value, className = "monthly-review-fact") => {
  const item = text(doc, "div", className, "");
  item.append(text(doc, "dt", undefined, label), text(doc, "dd", undefined, value));
  return item;
};

const STATE_COPY = Object.freeze({
  improving: { mark: "▼", label: "Improving", finding: "Recoverable share fell against the retained baseline." },
  worsening: { mark: "▲", label: "Worsening", finding: "Recoverable share rose against the retained baseline." },
  stable: { mark: "●", label: "Stable", finding: "Recoverable share did not move materially against the retained baseline." },
});

function renderState(doc, root, state, title, message, action) {
  root.dataset.state = state;
  root.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  const heading = text(doc, "h2", undefined, title);
  heading.id = "monthly-review-projection-title";
  root.append(
    text(doc, "p", "eyebrow", "Local monthly review · decision"),
    heading,
    text(doc, "p", "monthly-review-state-label", message),
  );
  if (action) root.append(text(doc, "p", "monthly-review-state-action", action));
  return root;
}

function implausible(review) {
  const values = [
    review?.materialBenchmark?.currentSharePpm,
    review?.materialBenchmark?.baselineSharePpm,
  ].filter((value) => value !== null);
  return values.some((value) => !Number.isInteger(value) || value < 0 || value > 1_000_000);
}

function bindDisclosure(details, summary, live) {
  const sync = () => {
    const expanded = details.hasAttribute("open");
    summary.setAttribute("aria-expanded", String(expanded));
    details.dataset.disclosure = expanded ? "expanded" : "collapsed";
    live.textContent = `Evidence and provenance ${expanded ? "expanded" : "collapsed"}.`;
  };
  summary.setAttribute("aria-expanded", String(details.hasAttribute("open")));
  details.dataset.disclosure = details.hasAttribute("open") ? "expanded" : "collapsed";
  details.addEventListener("toggle", sync);
}

function bindDepartmentRoundTrip(doc, link, reviewHeading) {
  const department = doc.getElementById("department-decision-panel");
  if (!department) return;
  link.addEventListener("click", () => {
    let back = doc.getElementById("monthly-review-return");
    if (!back) {
      back = text(doc, "a", "monthly-review-return", "Return to monthly review");
      back.id = "monthly-review-return";
      back.href = "#monthly-review-projection-title";
      department.prepend(back);
    }
  });
  // The shell exposes the review before the fragment focus handler runs. Keeping
  // the target on the heading makes the return announce context, not a card edge.
  reviewHeading.setAttribute("tabindex", "-1");
}

/** Paint one browser-local monthly decision, including its non-ideal states. */
export function renderMonthlyReviewProjection(doc, review) {
  const root = doc.getElementById("monthly-review-projection");
  if (!root) return null;
  root.hidden = false;
  root.replaceChildren();

  if (review === undefined || review === null) {
    return renderState(doc, root, "loading", "Building this month’s decision…",
      "◌ Loading · comparing retained browser-local periods.",
      "The recommendation will appear here without moving keyboard focus.");
  }
  const checked = validateMonthlyReviewProjection(review);
  if (!checked.valid) {
    return renderState(doc, root, "error", "This monthly decision is unavailable",
      "× Error · the retained projection did not pass validation.",
      "No recommendation is shown. Re-run the analysis or retain a valid comparable period.");
  }
  if (implausible(review)) {
    return renderState(doc, root, "implausible_extreme", "This monthly decision needs review",
      "× Implausible value · a recoverable share falls outside 0%–100%.",
      "No recommendation is shown. Check the retained period inputs, then rebuild this review.");
  }
  if (review.status === "missing_comparison_evidence" || review.materialBenchmark.status === "unavailable") {
    return renderState(doc, root, "empty", "There is not enough history to compare yet",
      "○ Empty · no immediately preceding comparable month is retained.",
      review.nextAction.statement);
  }

  root.dataset.state = review.status;
  root.setAttribute("aria-busy", "false");
  const state = STATE_COPY[review.status] ?? STATE_COPY.stable;
  const heading = text(doc, "h2", undefined, "What changed this month, and what should we do next?");
  heading.id = "monthly-review-projection-title";
  const status = text(doc, "p", "monthly-review-status", `${state.mark} ${state.label} · retained monthly comparison`);
  status.setAttribute("role", "status");

  const benchmark = text(doc, "section", "monthly-review-benchmark", "");
  benchmark.setAttribute("aria-labelledby", "monthly-review-benchmark-title");
  const benchmarkTitle = text(doc, "h3", undefined, "Headline finding");
  benchmarkTitle.id = "monthly-review-benchmark-title";
  const change = review.materialBenchmark.changeSharePpm;
  const direction = change < 0 ? "down" : change > 0 ? "up" : "unchanged";
  benchmark.append(
    benchmarkTitle,
    text(doc, "p", "monthly-review-finding", state.finding),
    text(doc, "p", "monthly-review-value", percent(review.materialBenchmark.currentSharePpm)),
    text(doc, "p", "monthly-review-comparison",
      `Current recoverable share · ${percent(review.materialBenchmark.currentSharePpm)}. Baseline · ${percent(review.materialBenchmark.baselineSharePpm)}. Change · ${direction} ${percent(Math.abs(change))}.`),
  );

  const action = text(doc, "section", "monthly-review-projection-action", "");
  action.setAttribute("aria-labelledby", "monthly-review-action-title");
  const actionTitle = text(doc, "h3", undefined, `Next action · priority ${review.nextAction.rank}`);
  actionTitle.id = "monthly-review-action-title";
  action.append(actionTitle, text(doc, "p", "monthly-review-action-statement", review.nextAction.statement));
  if (review.strongestDepartmentContributor) {
    const link = text(doc, "a", "monthly-review-department-link",
      `Review ${review.strongestDepartmentContributor.departmentId} department evidence`);
    link.href = "#department-decision-panel";
    action.append(link);
    bindDepartmentRoundTrip(doc, link, heading);
  }

  const details = text(doc, "details", "monthly-review-projection-provenance", "");
  const summary = text(doc, "summary", undefined, "Trend, department, commitment, confidence, and provenance");
  summary.setAttribute("aria-controls", "monthly-review-provenance-content");
  const content = text(doc, "div", "monthly-review-provenance-content", "");
  content.id = "monthly-review-provenance-content";
  // A real `dl`, not a div of loose `dt`/`dd`. Every fact behind this disclosure
  // is a term and its value, and a browser only announces them as a pair — and
  // only lays them out as the responsive grid `.monthly-review-evidence` draws —
  // when a list element encloses them. The boundary sentence is prose about the
  // whole set, so it sits after the list rather than inside it.
  const facts = text(doc, "dl", "monthly-review-evidence", "");
  facts.append(
    labelled(doc, "Compared periods", `${review.comparison.periods.baseline.label ?? "Unavailable"} → ${review.comparison.periods.observed.label ?? "Unavailable"}`),
    labelled(doc, "Savings outcome", review.comparison.status === "available"
      ? `Projected ${money(review.comparison.savings.projectedUsd)}. Realized ${money(review.comparison.savings.realizedUsd)}. Variance ${money(review.comparison.savings.varianceUsd)}.`
      : `Unavailable: ${review.comparison.reason}.`),
    labelled(doc, "Trend", `${state.label}. Change ${direction} ${percent(Math.abs(change))}.`),
    labelled(doc, "Department evidence", review.strongestDepartmentContributor
      ? `${review.strongestDepartmentContributor.departmentId}. ${review.strongestDepartmentContributor.basis}`
      : "No department contributor available."),
    labelled(doc, "Prior commitment", `${review.comparison.priorAction.status}. ${review.priorCommitmentVerification.basis}`),
    labelled(doc, "Confidence", `${review.confidence.level}. ${review.confidence.basis}`),
    labelled(doc, "Source", `${review.schemaVersion} · ${review.inputVersion}`),
    labelled(doc, "Periods", review.provenance.periodIds.join(", ") || "None"),
  );
  content.append(
    facts,
    text(doc, "p", "monthly-review-boundary", "Browser-local retained derived periods only. No raw import is retained, and no causal attribution is claimed."),
  );
  const live = text(doc, "p", "visually-hidden", "");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  details.append(summary, content);
  bindDisclosure(details, summary, live);

  root.append(
    text(doc, "p", "eyebrow", "Local monthly review · decision"), heading,
    status, benchmark, action, details, live,
  );
  return root;
}
