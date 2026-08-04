/**
 * The decision preview for `savings-commitment/1.0.0`, and the one action it
 * offers.
 *
 * The reading order is the order a leader asks the questions in, and it is the
 * order in the DOM, not a visual arrangement a screen reader has to guess at:
 *
 *   1. What is the decision?               one question, asked once
 *   2. What is it worth?                   the projected monthly savings benchmark
 *   3. What do I do about it?              one prioritized action: record it
 *   4. Who is accountable, and what changes?  department, owner, and route
 *   5. How sure are we, and how was it computed?  disclosed, not headline
 *   6. Where did this come from?           disclosed, not headline
 *
 * Confidence, provenance, and the supporting calculations sit inside native
 * `details` elements: keyboard-operable, exposed to assistive technology as
 * disclosures with their own state, and readable with scripting unavailable.
 * Nothing is hidden behind a hover, an icon, or a widget of this file's
 * invention.
 *
 * The layer renders only what the contract validated. It computes no money, no
 * saving, and no confidence band; if a figure is not in the payload it is not on
 * the screen. Nothing here reads storage, a clock, or the network — recording a
 * decision is the page entry's job, and this file only draws the control and the
 * states that follow it.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const DESIGNATION_LABELS = Object.freeze({
  fixture: "Example data — bundled synthetic analysis, not your figures",
  demo: "Demonstration analysis, not your figures",
  imported: "Your imported analysis",
});

/** The one control this page offers, named once so page and test agree. */
export const RECORD_BUTTON_ID = "commit-record-submit";
export const RECORD_OWNER_ID = "commit-record-owner";
export const RECORD_REGION_CLASS = "commit-record";

/** Where a recorded decision lives, and what to do with it next. */
export const DECISION_PATH = "/decision.html";
export const RELEASE_FORM_HREF = "/releases.html#release-form";
export const NEXT_IMPORT_HREF = "/evolution.html#local-import";

export function decisionHref(id) {
  return `${DECISION_PATH}?id=${encodeURIComponent(id)}`;
}

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function link(href, text, className) {
  const node = el("a", className, text);
  node.setAttribute("href", href);
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
function designationChip(designation, origin) {
  const chip = el("p", "commit-designation",
    DESIGNATION_LABELS[designation] ?? "Source of these figures unstated");
  chip.dataset.designation = designation;
  if (origin) chip.append(el("span", "commit-origin", ` · ${origin}`));
  return chip;
}

/**
 * The decision, as a question with one answer. The commitment's own headline is
 * the answer sentence; the question is assembled from the same three fields, so
 * the two cannot describe different changes.
 */
function decisionQuestion(commitment) {
  return `Should ${commitment.department.name} move ${commitment.workloadScope.description} `
    + `from ${commitment.routing.currentRoute.modelId} to `
    + `${commitment.routing.proposedRoute.modelId}?`;
}

/**
 * The commitment preview, or the plain sentence saying there is none. Both are
 * an answer; neither is a blank panel.
 *
 * @param preview a validated `savings-commitment/1.0.0` payload.
 * @param options.origin one line naming the briefing these figures came from.
 */
export function renderSavingsCommitment(preview, { origin = null } = {}) {
  if (preview.status === "no_commitment") return renderNoCommitment(preview, { origin });

  const { commitment } = preview;
  const article = el("article", "commit-card");
  article.setAttribute("aria-labelledby", "commit-question");

  const header = el("header", "commit-header");
  const question = el("h2", undefined, decisionQuestion(commitment));
  question.id = "commit-question";
  header.append(
    el("p", "commit-kicker", `Proposed commitment 1 of 1 · ${preview.question}`),
    question,
    designationChip(preview.designation, origin),
    el("p", "commit-answer", commitment.headline),
  );

  article.append(header, renderBenchmark(commitment), renderRecordAction(commitment),
    renderAccountability(commitment), renderRouting(commitment),
    renderBasis(preview), renderProvenance(preview), renderBoundaries());
  return article;
}

/** The one number the decision is worth, before any of the working. */
function renderBenchmark(commitment) {
  const section = el("section", "commit-benchmark");
  section.setAttribute("aria-labelledby", "commit-benchmark-title");
  const title = el("h3", undefined, "Projected monthly savings");
  title.id = "commit-benchmark-title";
  const figure = el("p", "commit-benchmark-figure",
    `${USD.format(commitment.projectedMonthlySavings.amountUsd)} a month`);
  section.append(title, figure, el("p", "commit-benchmark-basis",
    `Against a ${USD.format(commitment.baseline.monthlyCostUsd)} `
    + `${commitment.baseline.period} baseline for the same workload, at `
    + `${commitment.confidence.percent}% confidence (${commitment.confidence.band}). `
    + "A projection from an imported analysis, not a measured reduction."));
  return section;
}

/**
 * The single prioritized action, and the only control on this page.
 *
 * The button is rendered inert: the page entry attaches the listener, because
 * writing to the decision log needs storage and a clock and this layer has
 * neither. The owner field is prefilled with the accountable role the analysis
 * itself names, so the common case is one click.
 */
function renderRecordAction(commitment) {
  const section = el("section", RECORD_REGION_CLASS);
  section.setAttribute("aria-labelledby", "commit-record-title");
  const title = el("h3", undefined, "Record this decision in your Shiplog");
  title.id = "commit-record-title";

  const note = el("p", "commit-record-note",
    "One decision is written to this browser's own log, with the money claim, the confidence, and "
    + "the imported records it was computed from. Nothing is uploaded, and the same commitment "
    + "never records twice.");
  note.id = "commit-record-note";

  const field = el("div", "commit-record-field");
  const label = el("label", undefined, "Recorded by");
  label.setAttribute("for", RECORD_OWNER_ID);
  const input = el("input");
  input.id = RECORD_OWNER_ID;
  input.setAttribute("type", "text");
  input.setAttribute("name", "recordedBy");
  input.setAttribute("maxlength", "80");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-describedby", "commit-record-note");
  input.value = commitment.accountableOwner.role.slice(0, 80);
  field.append(label, input);

  const button = el("button", "commit-record-button", "Record this decision");
  button.id = RECORD_BUTTON_ID;
  button.setAttribute("type", "button");

  const outcome = el("div", "commit-record-outcome");
  outcome.id = "commit-record-outcome";

  section.append(title, note, field, button, outcome);
  return section;
}

/** Who owns it. Visible, because a decision with no owner is not a decision. */
function renderAccountability(commitment) {
  const owner = el("dl", "commit-owner");
  fact(owner, "Accountable department", commitment.department.name,
    commitment.department.departmentId);
  fact(owner, "Accountable owner", commitment.accountableOwner.role);
  fact(owner, "Workload scope", commitment.workloadScope.description,
    `${commitment.workloadScope.workloadId} · ${commitment.workloadScope.period}`);
  return owner;
}

function renderRouting(commitment) {
  const routing = el("section", "commit-routing");
  routing.setAttribute("aria-labelledby", "commit-routing-title");
  const routingTitle = el("h3", undefined, "Recommended model-routing change");
  routingTitle.id = "commit-routing-title";
  const route = el("p", "commit-route",
    `${commitment.routing.currentRoute.modelId} → ${commitment.routing.proposedRoute.modelId}`);
  routing.append(routingTitle, route, el("p", "commit-rationale", commitment.routing.rationale));
  return routing;
}

/**
 * How sure the analysis is and how the figure was reached — the working behind
 * the benchmark, one disclosure below it rather than four numbers beside it.
 */
function renderBasis(preview) {
  const { commitment } = preview;
  const details = el("details", "commit-basis");
  details.append(el("summary", undefined,
    "Inspect confidence and the supporting calculation"));

  const body = el("div", "commit-basis-body");
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

  body.append(metrics, el("p", "commit-basis-note",
    `${preview.consideredCount} candidate(s) considered · ${preview.eligibleCount} eligible · `
    + "every figure is carried from the imported analysis, never recomputed here."));
  details.append(body);
  return details;
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
 * What this page is, and is not. Recording a decision is a local write to this
 * browser's log — it is not an approval anybody else can see, and it does not
 * change a provider, a route, or a bill.
 */
function renderBoundaries() {
  const note = el("section", "commit-boundaries");
  note.setAttribute("aria-labelledby", "commit-boundaries-title");
  const title = el("h3", undefined, "What recording does, and does not, do");
  title.id = "commit-boundaries-title";
  note.append(title, el("p", undefined,
    "Recording writes one decision to this browser's own Shiplog log and nothing else. Nothing is "
    + "sent, no provider is contacted, and no route is changed: implementing the change is a "
    + "release somebody still has to ship. The figures are read from a local analysis — no "
    + "credential, no prompt text, no customer record, and no provider integration is involved."));
  return note;
}

/* ------------------------------- the verdict ------------------------------- */

/** Where the scored commitment is painted, named once so page and test agree. */
export const VERDICT_REGION_ID = "commit-verdict";

/** The grade in a reader's words. `not_enough_evidence` is one of the four. */
const GRADE_LABELS = Object.freeze({
  met: "Met",
  partially_met: "Partially met",
  missed: "Missed",
  not_enough_evidence: "Not enough evidence",
});

const figureValue = (figure) => (figure.unit === "percent"
  ? `${figure.value}%` : USD.format(figure.value / 100));

/** The headline figures, or the sentence that says why there are none. */
function verdictFigureLine(verdict) {
  if (verdict.grade === "not_enough_evidence") {
    return verdict.committedSavingUsd === null
      ? "No figure: this commitment could not be read, so nothing was scored against it."
      : `No figure yet: ${USD.format(verdict.committedSavingUsd)} a month was committed, and `
        + "nothing has been measured against it.";
  }
  const sign = verdict.relativeDeltaPercent > 0 ? "+" : "";
  return `${USD.format(verdict.realizedSavingUsd)} realized against `
    + `${USD.format(verdict.committedSavingUsd)} committed · `
    + `${sign}${verdict.relativeDeltaPercent}% against the commitment`;
}

/**
 * The verdict for a stored commitment: the grade, the two figures, and the
 * sentence behind them.
 *
 * The grade, the figures and the explanation are painted OUTSIDE any disclosure,
 * because the region they land in is the live one and a grade folded into a
 * collapsed details element is a grade nobody is told about. The working — which
 * two periods, which commitment, which figure was supplied and which was derived
 * — is the disclosure below it, on the same pattern as the commitment card's own
 * provenance.
 *
 * Every string here comes from imported data or a stored record and is inserted
 * as text, never as markup.
 *
 * @param verdict a `committed-saving-verdict/1.0.0` payload.
 */
export function renderCommitmentVerdict(verdict) {
  const section = el("section", "commit-benchmark");
  section.setAttribute("aria-labelledby", "commit-verdict-title");
  section.dataset.grade = verdict.grade;

  const title = el("h3", undefined, "Your stored commitment, scored");
  title.id = "commit-verdict-title";
  const chip = el("p", "commit-kicker", GRADE_LABELS[verdict.grade] ?? "Ungraded");
  chip.dataset.grade = verdict.grade;

  section.append(title, chip,
    el("p", "commit-benchmark-figure", verdictFigureLine(verdict)),
    el("p", "commit-answer", verdict.explanation));
  if (verdict.gradeRule) {
    section.append(el("p", "commit-benchmark-basis",
      `${verdict.gradeRule} ${verdict.gradeAssumption}`));
  }
  section.append(renderVerdictProvenance(verdict));
  return section;
}

/** What was compared, what it was compared for, and where each figure came from. */
function renderVerdictProvenance(verdict) {
  const { provenance } = verdict;
  const details = el("details", "commit-provenance");
  details.append(el("summary", undefined,
    "Inspect the periods compared, the commitment scored, and every figure"));

  const body = el("div", "commit-provenance-body");
  const list = el("dl", "commit-context");
  fact(list, "Periods compared",
    `${provenance.comparedPeriods.committedFrom ?? "not found in this series"} → `
    + `${provenance.comparedPeriods.followUp ?? "not found in this series"}`,
    `Expected follow-up ${provenance.comparedPeriods.expectedFollowUp ?? "unknown"} · this series `
    + `holds ${provenance.periodCount} month(s)`
    + `${provenance.periodCount ? `: ${provenance.seriesPeriods.join(", ")}` : ""}`);
  fact(list, "Commitment scored", provenance.commitmentId ?? "not readable",
    `Committed under scope ${provenance.scope.commitment ?? "unstated"}, series read under scope `
    + `${provenance.scope.series ?? "unstated"} — `
    + `${provenance.scope.matched ? "the same books" : "not the same books"}`);
  for (const figure of provenance.figures) {
    fact(list, figure.name, `${figureValue(figure)} · ${figure.origin}`,
      figure.origin === "supplied"
        ? `Supplied by the import: ${figure.source}`
        : `Derived here from ${figure.derivedFrom.join(" and ")} — ${figure.rule}`);
  }
  if (provenance.missing.length) {
    fact(list, "Evidence missing", provenance.missing.join(", "));
  }

  body.append(list, el("p", "commit-schema", verdict.schemaVersion));
  details.append(body);
  return details;
}

/* ------------------------------ after recording ---------------------------- */

/**
 * The confirmation, and the two things that come after it.
 *
 * It is a labelled region the page moves focus to, so a keyboard reader lands on
 * the outcome rather than hunting for it, and the next steps are links from that
 * landing point rather than instructions to go and find a page.
 *
 * @param outcome `{ created, decision }` as `recordCommitmentDecision` returns.
 */
export function renderRecordConfirmation({ created, decision }) {
  const section = el("section", "commit-recorded");
  section.setAttribute("aria-labelledby", "commit-recorded-title");
  section.setAttribute("tabindex", "-1");
  section.dataset.created = String(Boolean(created));

  const title = el("h3", undefined, created
    ? "Decision recorded in your Shiplog"
    : "This commitment is already recorded");
  title.id = "commit-recorded-title";

  const summary = el("p", "commit-recorded-summary", created
    ? `“${decision.title}” is now in this browser's decision log, owned by ${decision.owner}, `
      + `status ${decision.status}.`
    : `“${decision.title}” was recorded earlier and is still in this browser's decision log. A `
      + "commitment links to one decision, so nothing was written again.");

  const open = link(decisionHref(decision.id), "Open the decision", "commit-recorded-link");

  const steps = el("ol", "commit-next-steps");
  const associate = el("li");
  associate.append(
    el("span", "commit-next-label", "Associate the release that implements it. "),
    link(RELEASE_FORM_HREF, "Record a release and tick this decision"),
    el("span", undefined,
      ". A decision with no release is a plan; the link is what makes the change traceable."),
  );
  const revisit = el("li");
  revisit.append(
    el("span", "commit-next-label", "Revisit after the next import. "),
    link(NEXT_IMPORT_HREF, "Import next month's usage on the AI FinOps page"),
    el("span", undefined,
      ", export that briefing, and open it here to check the projected saving against what the "
      + "month actually cost."),
  );
  steps.append(associate, revisit);

  section.append(title, summary, open,
    el("h4", "commit-next-title", "Next steps"), steps);
  return section;
}

/** A refusal from the record path, stated where the button was. */
export function renderRecordError(message) {
  const note = el("p", "commit-record-error", message);
  note.setAttribute("role", "alert");
  return note;
}

/* ------------------------------- other states ------------------------------ */

/**
 * The files that were opened and not used. Rendered beside the commitment rather
 * than in place of it: a rejected file replaces nothing, so whatever briefing
 * was already on screen is still the one being decided about.
 */
export function renderHandoffRejections(rejections = []) {
  if (!rejections.length) return null;
  const section = el("section", "commit-rejections");
  section.setAttribute("role", "status");
  section.append(el("h2", "commit-rejections-title",
    `${rejections.length} file${rejections.length === 1 ? " was" : "s were"} not used`));
  const list = el("ul", "commit-rejection-list");
  for (const item of rejections) {
    const entry = el("li");
    entry.append(el("span", "commit-rejection-file", item.name), el("span", undefined, ` — ${item.message}`));
    entry.dataset.code = item.code ?? "unreadable";
    list.append(entry);
  }
  section.append(list, el("p", "commit-rejections-note",
    "The commitment shown above is unchanged. Nothing from a file that was not read reaches this "
    + "page or your decision log."));
  return section;
}

/** A valid analysis that supports no commitment. Still an answer. */
export function renderNoCommitment(preview, { origin = null } = {}) {
  const section = el("section", "commit-state");
  section.setAttribute("role", "status");
  section.append(
    el("h2", undefined, "Nothing to commit to from this analysis"),
    el("p", undefined, preview.reason),
    designationChip(preview.designation, origin),
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
