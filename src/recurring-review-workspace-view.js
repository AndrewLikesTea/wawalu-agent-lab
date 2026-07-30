// The recurring review inside the guided result. The assembler owns readiness;
// this view owns reading order and the one explicit completion interaction.

const byId = (doc, id) => doc.getElementById(id);
// Built once. A formatter is expensive to construct and free to reuse, and this
// paint runs it eight times over figures that share one locale and one currency.
const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (value) => Number.isFinite(value) ? MONEY.format(value) : "Not available";

const NEXT_ACTION = Object.freeze({
  analysis_missing: "Analyze a later provider period in this guided flow.",
  verdict_missing: "Recheck the current import so its evidence coverage can be measured.",
  department_changed: "Import a later period that includes the retained department.",
  period_not_later: "Analyze a period later than the retained benchmark.",
  metric_changed: "Track a new action using the current monthly metric.",
  verdict_insufficient: "Improve attribution coverage, then recheck this review.",
});

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fact(doc, list, label, value) {
  const row = element(doc, "div", "recurring-review-fact");
  row.append(element(doc, "dt", undefined, label), element(doc, "dd", undefined, value));
  list.append(row);
}

function disclosure(doc, label, facts) {
  const details = element(doc, "details", "recurring-review-details");
  details.append(element(doc, "summary", undefined, label));
  const list = element(doc, "dl", "recurring-review-facts");
  for (const [name, value] of facts) fact(doc, list, name, value);
  details.append(list);
  return details;
}

const confidenceText = (review) => {
  const parts = [];
  if (review.confidence.theo) parts.push(`${review.confidence.theo} evidence confidence`);
  if (review.confidence.coveragePercent !== null) {
    parts.push(`${review.confidence.coveragePercent.toFixed(1)}% attribution coverage`);
  }
  return parts.length ? parts.join(" · ") : "Confidence unavailable";
};

const provenanceText = (review) => {
  const parts = [
    review.provenance.analysisContract,
    review.provenance.verdictState && `Theo verdict: ${review.provenance.verdictState}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Current local evidence is missing";
};

function findingText(review) {
  if (!review.ready) return review.headline;
  const change = review.recommendation.change;
  if (change < 0) {
    return `Recoverable spend is ${money(Math.abs(change))} lower than the retained baseline.`;
  }
  if (change > 0) {
    return `Recoverable spend is ${money(change)} higher than the retained baseline.`;
  }
  return "Recoverable spend is unchanged from the retained baseline.";
}

function readyAction(review) {
  return review.recommendation.change <= 0
    ? "Continue the tracked action and review it again next month."
    : "Revise or replace the tracked action before the next review.";
}

// Everything this view draws, in one comparable string. `joined` and `excluded`
// are contract constants and the recommended change is the difference of two
// figures already named here, so neither adds anything a repaint could differ on.
const paintKey = (review, action) => [
  review.schemaVersion, review.state, review.code,
  review.current.value, review.current.period, review.current.department,
  review.benchmark.value, review.benchmark.period,
  review.confidence.theo, review.confidence.coveragePercent,
  review.provenance.analysisContract, review.provenance.verdictState,
  review.provenance.actionReferences.join(","), review.evidenceBoundary.gaps.join(","),
  action?.actionLabel, action?.ownerLabel, action?.department,
  action?.target?.value, action?.target?.deadline,
].join("");

/**
 * Paint into the shipped guided-result section.
 *
 * An absent action hides this slice: a first-time analysis remains the existing
 * guided review, rather than being led by an unrelated retention prompt.
 */
export function renderRecurringReviewWorkspace(doc, review, retainedAction = null) {
  const root = byId(doc, "recurring-review-workspace");
  if (!root || review.code === "absent_action") {
    if (root) {
      root.hidden = true;
      root.replaceChildren();
    }
    return null;
  }

  // Every panel sync repaints this, including two bundle fetches that resolve
  // after first paint and race the reader's first interaction. Rebuilding a
  // review that has not changed would throw away their completion, the
  // disclosures they opened, and wherever the keyboard was — so an unchanged
  // review is left standing. A review that genuinely moved on does rebuild, and
  // resetting completion is then the honest outcome: it is a different review.
  const key = paintKey(review, retainedAction);
  if (!root.hidden && root.dataset.reviewKey === key) return root;

  root.hidden = false;
  root.dataset.reviewKey = key;
  root.dataset.state = review.state;
  root.dataset.completed = "false";
  root.replaceChildren();

  const heading = element(doc, "header", "recurring-review-heading");
  const title = element(doc, "h2", undefined, review.question);
  title.id = "recurring-review-question";
  heading.append(element(doc, "p", "eyebrow", "Recurring review"), title);
  root.append(heading);

  const metric = element(doc, "div", "recurring-review-metric");
  metric.append(
    element(doc, "p", "recurring-review-label", "Current vs retained baseline"),
    element(doc, "p", "recurring-review-value",
      review.current.value === null
        ? `Not comparable · baseline ${money(review.benchmark.value)}`
        : review.ready
          ? `${money(review.current.value)} vs ${money(review.benchmark.value)}`
          : `Current ${money(review.current.value)} · baseline ${money(review.benchmark.value)} · not comparable`),
    element(doc, "p", "recurring-review-period",
      `${review.current.period ?? "Current period unavailable"} · baseline ${review.benchmark.period ?? "unavailable"}`),
  );
  root.append(metric);

  const finding = element(doc, "section", "recurring-review-finding");
  finding.setAttribute("aria-labelledby", "recurring-review-finding-title");
  const findingTitle = element(doc, "h3", undefined, "Finding");
  findingTitle.id = "recurring-review-finding-title";
  finding.append(
    findingTitle,
    element(doc, "p", "recurring-review-finding-text", findingText(review)),
    element(doc, "p", "recurring-review-confidence", confidenceText(review)),
    element(doc, "p", "recurring-review-provenance", provenanceText(review)),
  );
  root.append(finding);

  const action = element(doc, "section", "recurring-review-action");
  action.setAttribute("aria-labelledby", "recurring-review-action-title");
  const actionTitle = element(doc, "h3", undefined, "Prioritized next action");
  actionTitle.id = "recurring-review-action-title";
  action.append(actionTitle, element(doc, "p", undefined,
    review.ready ? readyAction(review) : NEXT_ACTION[review.code] ?? "Resolve the named evidence gap."));

  if (review.ready) {
    const complete = element(doc, "button", "recurring-review-complete", "Complete this review");
    complete.type = "button";
    complete.setAttribute("aria-describedby", "recurring-review-complete-note");
    const note = element(doc, "p", "recurring-review-complete-note",
      "Marks this review complete in this tab. Your retained action and local evidence stay available.");
    note.id = "recurring-review-complete-note";
    const status = element(doc, "p", "recurring-review-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    complete.addEventListener("click", () => {
      root.dataset.completed = "true";
      complete.disabled = true;
      complete.textContent = "Review completed";
      status.textContent = "Review completed. The retained action and evidence were not changed.";
    });
    action.append(complete, note, status);
  }
  root.append(action);

  root.append(
    disclosure(doc, "Prior action outcome", [
      ["Tracked action", retainedAction?.actionLabel ?? "Retained action"],
      ["Owner", retainedAction?.ownerLabel ?? "Not available"],
      ["Review target", retainedAction?.target
        ? `${money(retainedAction.target.value)} by ${retainedAction.target.deadline}` : "Not available"],
    ]),
    disclosure(doc, "Scope and comparability limits", [
      ["Department", review.current.department ?? retainedAction?.department ?? "Not available"],
      ["Metric", review.current.definition],
      ["Comparability", review.ready
        ? "Same department, unit, and a later period. This is measured change, not realized savings."
        : `Comparison withheld: ${review.evidenceBoundary.gaps.join(", ")}.`],
    ]),
    disclosure(doc, "Supporting evidence and provenance", [
      ["Evidence joined", review.evidenceBoundary.joined.join(", ")],
      ["Excluded", review.evidenceBoundary.excluded.join(", ")],
      ["Action references", review.provenance.actionReferences.join(", ") || "None retained"],
      ["Contract", review.schemaVersion],
    ]),
  );
  return root;
}
