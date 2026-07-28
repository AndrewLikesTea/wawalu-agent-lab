/**
 * The decision preview for `savings-commitment/1.0.0`.
 *
 * The reading order is the order a leader asks the questions in, and it is the
 * order in the DOM, not a visual arrangement a screen reader has to guess at:
 *
 *   1. What should we commit to now?      the headline
 *   2. Who is accountable?                department and owner role
 *   3. What changes?                      current route to proposed route
 *   4. What is it worth, against what?    projected monthly saving, then baseline
 *   5. How sure are we?                   confidence, with its basis
 *   6. Where did this come from?          provenance, progressively disclosed
 *
 * The layer renders only what the contract validated. It computes no money, no
 * saving, and no confidence band; if a figure is not in the payload it is not on
 * the screen. Nothing here reads storage, a clock, or the network.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const DESIGNATION_LABELS = Object.freeze({
  fixture: "Example data — bundled synthetic analysis, not your figures",
  demo: "Demonstration analysis, not your figures",
  imported: "Your imported analysis",
});

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function fact(list, label, value, detail) {
  const item = el("div", "commit-fact");
  item.append(el("dt", undefined, label), el("dd", undefined, value));
  if (detail) item.append(el("dd", "commit-fact-detail", detail));
  list.append(item);
  return item;
}

/** The bundled-versus-yours claim, stated in words rather than a colour. */
function designationChip(designation) {
  const chip = el("p", "commit-designation",
    DESIGNATION_LABELS[designation] ?? "Source of these figures unstated");
  chip.dataset.designation = designation;
  return chip;
}

/**
 * The commitment preview, or the plain sentence saying there is none. Both are
 * an answer; neither is a blank panel.
 */
export function renderSavingsCommitment(preview) {
  if (preview.status === "no_commitment") return renderNoCommitment(preview);

  const { commitment } = preview;
  const article = el("article", "commit-card");
  article.setAttribute("aria-labelledby", "commit-headline");

  const header = el("header", "commit-header");
  const headline = el("h2", undefined, commitment.headline);
  headline.id = "commit-headline";
  header.append(
    el("p", "commit-kicker", `Proposed commitment 1 of 1 · ${preview.question}`),
    headline,
    designationChip(preview.designation),
  );

  const owner = el("dl", "commit-owner");
  fact(owner, "Accountable department", commitment.department.name,
    commitment.department.departmentId);
  fact(owner, "Accountable owner", commitment.accountableOwner.role);
  fact(owner, "Workload scope", commitment.workloadScope.description,
    `${commitment.workloadScope.workloadId} · ${commitment.workloadScope.period}`);

  const routing = el("section", "commit-routing");
  routing.setAttribute("aria-labelledby", "commit-routing-title");
  const routingTitle = el("h3", undefined, "Recommended model-routing change");
  routingTitle.id = "commit-routing-title";
  const route = el("p", "commit-route",
    `${commitment.routing.currentRoute.modelId} → ${commitment.routing.proposedRoute.modelId}`);
  routing.append(routingTitle, route, el("p", "commit-rationale", commitment.routing.rationale));

  const metrics = el("dl", "commit-metrics");
  fact(metrics, "Projected monthly savings",
    USD.format(commitment.projectedMonthlySavings.amountUsd),
    commitment.projectedMonthlySavings.formula);
  fact(metrics, `Baseline monthly cost (${commitment.baseline.period})`,
    USD.format(commitment.baseline.monthlyCostUsd),
    `Imported analysis figure for ${commitment.baseline.workloadId}`);
  fact(metrics, "Projected monthly cost",
    USD.format(commitment.projected.monthlyCostUsd),
    "Same workload and month as the baseline");
  fact(metrics, "Confidence",
    `${commitment.confidence.percent}% · ${commitment.confidence.band}`,
    commitment.confidence.basis);

  article.append(header, owner, routing, metrics,
    renderProvenance(preview), renderBoundaries());
  return article;
}

/** Provenance, second: what a leader opens to check the number, not to read it. */
function renderProvenance(preview) {
  const { provenance } = preview.commitment;
  const details = el("details", "commit-provenance");
  details.append(el("summary", undefined, "Inspect provenance and what was set aside"));

  const body = el("div", "commit-provenance-body");
  const list = el("dl", "commit-context");
  fact(list, "Imported analysis", provenance.sourceId,
    `${provenance.analysisSchemaVersion} · designated ${provenance.designation}`);
  fact(list, "Imported at", provenance.importedAt,
    provenance.analysisPeriod
      ? `Analysis period ${provenance.analysisPeriod}`
      : "The import recorded no analysis period");
  fact(list, `Input records used (${provenance.recordCount})`, provenance.recordIds.join(", "));
  fact(list, "Routing evidence",
    preview.commitment.routing.evidence
      .map((item) => `${item.recordId}: ${item.statement}`).join(" "));

  const setAside = el("ol", "commit-excluded");
  for (const item of preview.excluded) {
    setAside.append(el("li", undefined, `${item.candidateId} — ${item.reason}`));
  }

  body.append(list,
    el("h3", undefined, `Considered and set aside (${preview.excluded.length})`), setAside,
    el("p", "commit-schema", preview.schemaVersion));
  details.append(body);
  return details;
}

/**
 * What this preview is not. Stated on the surface, because the reason a leader
 * cannot click "commit" here is a product fact, not a missing button.
 */
function renderBoundaries() {
  const note = el("section", "commit-boundaries");
  note.setAttribute("aria-labelledby", "commit-boundaries-title");
  const title = el("h3", undefined, "What this preview does not do");
  title.id = "commit-boundaries-title";
  note.append(title, el("p", undefined,
    "Nothing here is saved, sent, or acted on. The figures are read from a local analysis, held "
    + "in this tab, and discarded when it closes: no credential, no prompt text, no customer "
    + "record, and no provider integration is involved. Accepting a commitment and tracking it "
    + "to a measured month is a separate change that depends on this contract."));
  return note;
}

/** A valid analysis that supports no commitment. Still an answer. */
export function renderNoCommitment(preview) {
  const section = el("section", "commit-state");
  section.setAttribute("role", "status");
  section.append(
    el("h2", undefined, "Nothing to commit to from this analysis"),
    el("p", undefined, preview.reason),
    designationChip(preview.designation),
    el("p", "commit-schema",
      `${preview.consideredCount} candidate(s) considered · ${preview.schemaVersion}`),
  );
  return section;
}

/** The analysis could not be read or did not satisfy the contract. */
export function renderSavingsCommitmentError() {
  const section = el("section", "commit-state");
  section.setAttribute("role", "alert");
  section.append(
    el("h2", undefined, "Savings commitment unavailable"),
    el("p", undefined,
      "The local analysis could not be validated against the savings-commitment contract, so no "
      + "commitment is proposed. An incomplete or ambiguous commitment is withheld rather than "
      + "shown with the gaps filled in."),
  );
  return section;
}
