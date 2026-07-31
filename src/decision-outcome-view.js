// One outcome, painted the same way in all four states.
//
// The region answers one question in the same four places every time: the
// status, the one comparison, what it rests on, and the one thing to do next.
// A verified month, an underperforming one, an unmatched import and a decision
// that has not shipped yet all render through this path, so no state is an
// empty box and none of them moves the reader's eye somewhere new.
//
// WHAT STAYS VISIBLE, AND WHY
// ---------------------------
// The decision, its linked release, and the evidence summary are never inside a
// disclosure. They are what makes the number citable, and a figure whose support
// is one click away is a figure people quote without its support. The two
// `<details>` carry the arithmetic and the month-by-month costs: detail a reader
// asks for, not detail they need to trust the headline.
//
// Native `<details>`/`<summary>` is deliberate. It is keyboard operable, exposed
// to assistive technology, findable by the browser's own in-page search, and
// works with no script at all — none of which a div with a click handler gets
// for free.
//
// Colour is never the carrier: every state names itself in text ("Verified",
// "Unmatched"), carries a decorative glyph, and sets `data-shape` so the
// stylesheet can vary the border treatment.

import { DECISION_OUTCOME_QUESTION } from "./decision-outcome.js";

const KICKER = "Recorded decision outcome";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(list, label, ...values) {
  const item = el("div", "dout-row");
  item.append(el("dt", undefined, label));
  const value = el("dd");
  value.append(...values);
  item.append(value);
  list.append(item);
  return value;
}

function link(href, text, className) {
  const node = el("a", className, text);
  node.setAttribute("href", href);
  return node;
}

/** A closed-by-default disclosure with a named panel. */
function disclosure(name, summaryText, ...content) {
  const details = el("details", "dout-disclosure");
  details.dataset.disclosure = name;
  const summary = el("summary", "dout-summary", summaryText);
  details.append(summary, ...content);
  return details;
}

function statusBanner(outcome) {
  const banner = el("p", "dout-status");
  banner.dataset.status = outcome.status;
  banner.dataset.shape = outcome.cue.shape;
  const glyph = el("span", "dout-cue", outcome.cue.glyph);
  glyph.setAttribute("aria-hidden", "true");
  banner.append(glyph, el("span", "dout-status-label", outcome.cue.label));
  if (outcome.verdict) {
    banner.append(el("span", "dout-verdict", `Verification verdict: ${outcome.verdict.replace(/_/g, " ")}`));
  }
  return banner;
}

// The one material comparison. Its absence is a rendered sentence, never a
// blank: a reader who sees nothing here has no way to tell "not measured" from
// "measured at zero".
function comparisonBlock(outcome) {
  const block = el("section", "dout-comparison");
  block.setAttribute("aria-labelledby", "dout-comparison-title");
  const title = el("h4", "dout-comparison-title", "Observed against projected");
  title.id = "dout-comparison-title";
  block.append(title);

  const { comparison } = outcome;
  if (!comparison) {
    block.dataset.state = "absent";
    block.append(el("p", "dout-comparison-absent",
      "No observed-against-projected figure is stated for this decision yet. The sentence above "
      + "says what is missing, and the next step below is how to supply it."));
    return block;
  }

  block.dataset.state = comparison.direction;
  const figure = el("p", "dout-figure");
  figure.append(
    el("span", "dout-figure-value", comparison.observedText),
    el("span", "dout-figure-unit", "observed monthly saving"),
  );
  block.append(figure);
  block.append(el("p", "dout-figure-against",
    `against ${comparison.projectedText} projected · ${comparison.varianceText} variance · `
    + `${comparison.attainmentText}`));
  block.append(el("p", "dout-figure-scope",
    `${comparison.observedPeriod} observed, measured against the ${comparison.baselinePeriod} `
    + "baseline this decision was priced in."));
  return block;
}

function confidenceBlock(outcome) {
  const block = el("section", "dout-confidence");
  block.setAttribute("aria-labelledby", "dout-confidence-title");
  const title = el("h4", "dout-confidence-title", "Confidence");
  title.id = "dout-confidence-title";
  block.append(title);
  if (!outcome.confidence) {
    block.dataset.level = "none";
    block.append(el("p", undefined,
      "No confidence is stated, because there is no measured figure to be confident about."));
    return block;
  }
  block.dataset.level = outcome.confidence.level;
  const stated = outcome.confidence.statedPercent === null
    ? "" : ` · commitment recorded ${outcome.confidence.statedPercent}%`;
  block.append(el("p", "dout-confidence-level", `${outcome.confidence.label}${stated}`));
  const reasons = el("ul", "dout-confidence-reasons");
  for (const reason of outcome.confidence.reasons) reasons.append(el("li", undefined, reason));
  block.append(reasons);
  return block;
}

function evidenceBlock(outcome) {
  const block = el("section", "dout-evidence");
  block.setAttribute("aria-labelledby", "dout-evidence-title");
  const title = el("h4", "dout-evidence-title", "Evidence");
  title.id = "dout-evidence-title";
  block.append(title);
  block.dataset.complete = String(outcome.evidence.complete);

  const { evidence } = outcome;
  block.append(el("p", "dout-evidence-count",
    `${evidence.baselineRecordCount} baseline `
    + `${evidence.baselineRecordCount === 1 ? "record" : "records"} cited by the decision, `
    + `${evidence.observedRecordCount} observed `
    + `${evidence.observedRecordCount === 1 ? "row" : "rows"} read from the opened month.`));

  if (evidence.citations.length > 0) {
    const list = el("ul", "dout-citations");
    for (const citation of evidence.citations) {
      const item = el("li", "dout-citation");
      item.dataset.side = citation.side;
      item.append(el("span", "dout-citation-id", citation.recordId),
        el("span", "dout-citation-statement", citation.statement));
      list.append(item);
    }
    block.append(list);
  }
  if (evidence.gaps.length > 0) {
    const gaps = el("ul", "dout-evidence-gaps");
    gaps.setAttribute("aria-label", "What this evidence is missing");
    for (const gap of evidence.gaps) gaps.append(el("li", undefined, gap));
    block.append(gaps);
  }
  return block;
}

function provenanceList(outcome) {
  const list = el("dl", "dout-provenance");
  const { provenance } = outcome;
  if (!provenance) {
    row(list, "Provenance", el("span", undefined,
      "This decision carries no FinOps commitment metadata, so it cites no analysis."));
    return list;
  }
  row(list, "Analysis source", el("span", undefined,
    `${provenance.sourceId ?? "unnamed source"} (${provenance.designation ?? "unstated"})`
    + `${provenance.importedAt ? `, imported ${provenance.importedAt}` : ""}`));
  row(list, "Baseline month", el("span", undefined, provenance.baselinePeriod ?? "not stated"));
  row(list, "Observed month", el("span", undefined, provenance.observedPeriod
    ? `${provenance.observedPeriod}${provenance.observedFrom ? ` · ${provenance.observedFrom}` : ""}`
      + `${provenance.observedDataset ? ` · ${provenance.observedDataset} dataset` : ""}`
    : "none opened"));
  return list;
}

function calculationDisclosure(outcome) {
  const body = el("div", "dout-disclosure-body");
  if (!outcome.calculation) {
    body.append(el("p", undefined,
      "There is no calculation to show: no observed month has been paired with this decision's "
      + "baseline yet."));
    return disclosure("calculation", "How this would be calculated", body);
  }
  const list = el("ol", "dout-steps");
  for (const step of outcome.calculation.steps) {
    const item = el("li", "dout-step");
    item.append(
      el("p", "dout-step-label", step.label),
      el("p", "dout-step-formula", step.formula),
      el("p", "dout-step-rule", step.rule),
      el("p", "dout-step-assumption", step.assumption),
    );
    list.append(item);
  }
  body.append(list, el("p", "dout-caveat", outcome.calculation.caveat));
  return disclosure("calculation", "How this was calculated", body);
}

function periodDisclosure(outcome) {
  const body = el("div", "dout-disclosure-body");
  if (!outcome.periodComparison) {
    body.append(el("p", undefined,
      "Two months are needed to compare: the month this decision was priced in, and the month "
      + "after it."));
    return disclosure("periods", "Compare the two months", body);
  }
  // A definition list rather than a table: three labelled amounts read the same
  // in a narrow column as in a wide one, and none of them is a cell in a grid a
  // reader has to track across.
  const list = el("dl", "dout-periods");
  for (const entry of outcome.periodComparison.rows) {
    const value = row(list, `${entry.role}${entry.period ? ` · ${entry.periodLabel}` : ""}`,
      el("span", "dout-period-cost", entry.costText),
      el("span", "dout-period-note", entry.note));
    value.dataset.period = entry.period ?? "projection";
  }
  body.append(list);
  return disclosure("periods", "Compare the two months", body);
}

function nextActionBlock(outcome) {
  const block = el("section", "dout-next");
  block.setAttribute("aria-labelledby", "dout-next-title");
  const title = el("h4", "dout-next-title", "Do this next");
  title.id = "dout-next-title";
  block.append(title);
  if (!outcome.nextAction) {
    block.append(el("p", undefined, "Nothing is queued for this decision."));
    return block;
  }
  const label = outcome.nextAction.href
    ? link(outcome.nextAction.href, outcome.nextAction.label, "dout-next-link")
    : el("p", "dout-next-label", outcome.nextAction.label);
  block.append(label, el("p", "dout-next-rationale", outcome.nextAction.rationale));
  return block;
}

/**
 * Paint one outcome into `container`.
 *
 * @param container the region element; its children are replaced.
 * @param outcome a `decisionOutcome` model. Every state carries every key this
 *   function reads, so there is no shape to branch on beyond the optional
 *   comparison, confidence, and disclosures.
 */
export function renderDecisionOutcome(container, outcome) {
  const article = el("article", "dout");
  article.dataset.status = outcome.status;
  article.dataset.shape = outcome.cue.shape;
  if (outcome.reason) article.dataset.reason = outcome.reason;
  article.setAttribute("aria-labelledby", "dout-question");

  const header = el("header", "dout-header");
  // h3: the panel that hosts this region owns the h2, and the decision detail
  // above it owns the page's only h1.
  const question = el("h3", "dout-question", outcome.question ?? DECISION_OUTCOME_QUESTION);
  question.id = "dout-question";
  header.append(el("p", "dout-kicker", KICKER), question, statusBanner(outcome));
  if (outcome.statement) header.append(el("p", "dout-statement", outcome.statement));
  article.append(header);

  // Decision and linked release, above the fold of the disclosures and never
  // inside one: the outcome is a claim about these two records, and a claim
  // whose subject is hidden is not reviewable.
  const links = el("dl", "dout-links");
  if (outcome.decision) {
    row(links, "Decision",
      link(`/decision.html?id=${encodeURIComponent(outcome.decision.id)}`,
        outcome.decision.title ?? outcome.decision.id, "dout-decision-link"),
      el("span", "dout-meta",
        `${outcome.decision.owner ?? "unassigned"} · ${outcome.decision.status ?? "unstated"}`
        + `${outcome.decision.createdAt ? ` · recorded ${outcome.decision.createdAt.slice(0, 10)}` : ""}`));
  } else {
    row(links, "Decision", el("span", "dout-meta", "None open."));
  }
  if (outcome.linkedRelease) {
    const release = outcome.linkedRelease;
    row(links, "Linked release",
      release.href
        ? link(release.href, release.title ?? release.version ?? release.id, "dout-release-link")
        : el("span", undefined, release.title ?? release.id),
      el("span", "dout-meta",
        `${release.owner ?? "unassigned"}`
        + `${release.createdAt ? ` · recorded ${release.createdAt.slice(0, 10)}` : ""}`));
  } else {
    row(links, "Linked release", el("span", "dout-meta dout-release-absent",
      "None. No release links to this decision, so nothing records it as having shipped."));
  }
  article.append(links);

  article.append(comparisonBlock(outcome), confidenceBlock(outcome), evidenceBlock(outcome),
    provenanceList(outcome), calculationDisclosure(outcome), periodDisclosure(outcome),
    nextActionBlock(outcome));

  container.replaceChildren(article);
  container.setAttribute("aria-busy", "false");
  container.dataset.state = outcome.status;
  return article;
}

/**
 * The states that are not an outcome: waiting for records, or failing to read
 * them. `src/decision.html` ships the loading state as static markup so the
 * region is never empty before this module runs, so the two copies of that
 * sentence — including its typographic apostrophe — have to stay identical.
 */
export const DECISION_OUTCOME_STATE_COPY = Object.freeze({
  loading: {
    word: "Checking records",
    glyph: "◌",
    shape: "dashed",
    title: "Checking this decision’s outcome",
    body: "Checking what this decision projected and whether a release recorded it as shipped. "
      + "No file is needed for this step.",
    recoverable: false,
  },
  reading: {
    word: "Reading your file",
    glyph: "◍",
    shape: "dotted",
    title: "Reading the decision export you opened",
    body: "Checking that this file is a decision export Shiplog can compare with this decision.",
    recoverable: false,
  },
  error: {
    word: "Could not read",
    glyph: "▲",
    shape: "double",
    title: "This outcome could not be read",
    body: "The stored records could not be read, so no outcome is stated rather than one computed "
      + "from a partial read. Nothing in your browser was changed, so reading them again is safe.",
    recoverable: true,
  },
});

export const DECISION_OUTCOME_RETRY_LABEL = "Retry reading this outcome";

/** The id the state's own sentence carries, so the retry can be described by it. */
export const DECISION_OUTCOME_DETAIL_ID = "dout-state-detail";

/**
 * Whether trying again could change this state's answer.
 *
 * Only a *read* that failed is worth retrying. Waiting for records and reading a
 * file the visitor just opened are both in progress, and offering a Retry beside
 * them would promise a recovery from something that has not gone wrong yet.
 */
export function isRecoverableOutcomeState(state) {
  return DECISION_OUTCOME_STATE_COPY[state]?.recoverable === true;
}

/**
 * Paint a non-outcome state. Kept in this module so the loading and error
 * states are the same shape as the outcome they precede, rather than markup a
 * page author reinvents.
 *
 * The blocks read in the order the reader needs them: the region's label, the
 * heading that says which state this is, one compact status chip, the single
 * thing to do next, and only then the sentence that explains it. The retry is
 * described by that sentence through `aria-describedby`, so a reader who tabs
 * straight onto the button still hears the reason before pressing it.
 *
 * The chip carries a word and a glyph and the section carries `data-shape`, so
 * the three states stay distinguishable in greyscale: colour is the last cue
 * here, never the only one.
 */
export function renderDecisionOutcomeState(container, state, { onRetry } = {}) {
  const copy = DECISION_OUTCOME_STATE_COPY[state] ?? DECISION_OUTCOME_STATE_COPY.error;
  const name = DECISION_OUTCOME_STATE_COPY[state] ? state : "error";
  const section = el("section", "dout-state");
  section.dataset.state = name;
  section.dataset.shape = copy.shape;
  section.dataset.recoverable = String(copy.recoverable === true);
  section.setAttribute("role", name === "error" ? "alert" : "status");
  // Focusable by script only: a retry replaces the button the reader was
  // standing on, and this panel is where they need to land next.
  section.setAttribute("tabindex", "-1");
  const title = el("h3", "dout-state-title", copy.title);
  title.id = "dout-question";
  const status = el("p", "dout-status");
  status.dataset.status = name;
  status.dataset.shape = copy.shape;
  const glyph = el("span", "dout-cue", copy.glyph);
  glyph.setAttribute("aria-hidden", "true");
  status.append(glyph, el("span", "dout-status-label", copy.word));
  const body = el("p", "dout-state-body", copy.body);
  body.id = DECISION_OUTCOME_DETAIL_ID;
  section.append(el("p", "dout-kicker", KICKER), title, status);
  if (copy.recoverable === true && typeof onRetry === "function") {
    const actions = el("div", "dout-state-actions");
    const retry = el("button", "empty-action dout-retry", DECISION_OUTCOME_RETRY_LABEL);
    retry.type = "button";
    retry.setAttribute("aria-describedby", DECISION_OUTCOME_DETAIL_ID);
    retry.addEventListener("click", onRetry);
    actions.append(retry);
    section.append(actions);
  }
  section.append(body);
  container.replaceChildren(section);
  container.setAttribute("aria-busy", name === "error" ? "false" : "true");
  container.dataset.state = name;
  return section;
}
