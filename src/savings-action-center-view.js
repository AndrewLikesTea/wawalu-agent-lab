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

import { journeyPaintKey, journeySignals, money } from "./finops-journey-signals.js";
import { journeySnapshotPaintKey } from "./finops-journey-snapshot.js";

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
 * One scannable signal. Colour is the last channel it uses, never the only one:
 * the label names what is being reported, the value states it in words, and the
 * shape repeats the direction — so the chip survives greyscale, a screen reader,
 * and a reader who cannot separate the two washes.
 */
function chip(signal) {
  const item = el("li", "sac-signal");
  const node = el("span", "sac-chip");
  node.dataset.signal = signal.key;
  node.dataset.tone = signal.tone;
  node.dataset.silhouette = signal.silhouette;
  node.dataset.known = String(signal.known);
  const shape = el("span", "sac-chip-shape", signal.shape);
  shape.setAttribute("aria-hidden", "true");
  node.append(shape, el("span", "sac-chip-label", signal.label),
    el("span", "sac-chip-value", signal.value));
  item.append(node);
  return item;
}

/**
 * A disclosure the keyboard can actually work.
 *
 * `details`/`summary` is the cheaper control and this file still uses it for the
 * legacy claim's arithmetic, but the journey's two panels have to report their
 * own state to a test and to assistive technology on both sides of a toggle, so
 * they are a button with `aria-expanded`/`aria-controls` over a named group.
 * Nothing here traps focus: the panel is inline, and a collapsed panel is
 * `hidden`, so it leaves the tab sequence rather than holding it.
 */
function disclosure(id, label, rows) {
  const wrapper = el("div", "sac-disclosure");
  const trigger = el("button", "sac-disclosure-trigger");
  trigger.type = "button";
  trigger.id = `${id}-trigger`;
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${id}-panel`);
  const shape = el("span", "sac-disclosure-shape", "▸");
  shape.setAttribute("aria-hidden", "true");
  const state = el("span", "sac-disclosure-state", "Show");
  trigger.append(shape, el("span", "sac-disclosure-label", label), state);

  const panel = el("div", "sac-disclosure-panel");
  panel.id = `${id}-panel`;
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-labelledby", `${id}-trigger`);
  panel.hidden = true;
  const list = el("dl", "sac-calculation");
  for (const [name, value] of rows) fact(list, name, value);
  panel.append(list);

  trigger.addEventListener("click", () => {
    const expanded = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", String(!expanded));
    panel.hidden = expanded;
    shape.textContent = expanded ? "▸" : "▾";
    state.textContent = expanded ? "Show" : "Hide";
    wrapper.dataset.disclosure = expanded ? "collapsed" : "expanded";
  });
  wrapper.dataset.disclosure = "collapsed";
  wrapper.append(trigger, panel);
  return wrapper;
}

const stated = (number, unit) =>
  number === null || number === undefined ? "Not available" : `${number}${unit ? ` ${unit}` : ""}`;

// A list that may arrive empty, or with several hundred entries. Both are drawn:
// the count is in the label so the reader knows the size before opening it, and
// the value wraps rather than growing a horizontal scrollbar under the panel.
const listed = (values, empty) => (values?.length ? values.join(", ") : empty);

/**
 * The provenance a restored snapshot adds to the panel, and nothing when there
 * is none: an absent or refused snapshot leaves this disclosure exactly as it
 * reads for a visitor who never imported.
 *
 * The import is named by its own id and its counts. The file names it was hashed
 * from are not in the snapshot and are not reconstructable from it.
 */
function carriedRows(snapshot) {
  const carried = snapshot?.carried;
  if (!carried) return [];
  const { provenance, departmentReferences: departments } = carried;
  return [
    ["Carried from import", `${provenance.importSourceId} · ${provenance.fileCount} file`
      + `${provenance.fileCount === 1 ? "" : "s"}, ${provenance.rows} row`
      + `${provenance.rows === 1 ? "" : "s"} · ${provenance.importedAt}`],
    [`Department references (${departments.length})`, listed(departments, "None")],
    ["Carried verification", carried.verification.state
      ? `${carried.verification.state} · ${stated(carried.verification.rows, "measured rows")}`
      : "Not verified"],
  ];
}

/**
 * Paint the recurring review: one question, one recommended action, one figure,
 * five signals, and everything else grouped and labelled as support.
 *
 * Reading order in the DOM is the reading order on screen — the recommendation
 * is genuinely first, not first-looking through a CSS reorder that would leave
 * the tab sequence somewhere else.
 */
export function renderRecurringReviewReadiness(review, {
  source = "demo", retainedAction = null, snapshot = null,
} = {}) {
  const signals = journeySignals(review, { retainedAction });
  const article = el("article", "sac-focus sac-journey");
  article.setAttribute("aria-labelledby", "sac-question");
  article.dataset.source = source;
  article.dataset.reviewState = review.state;
  article.dataset.reviewKey =
    `${journeyPaintKey(review, retainedAction)} ${journeySnapshotPaintKey(snapshot)}`;

  const heading = el("header", "sac-heading");
  const question = el("h2", undefined, review.question);
  question.id = "sac-question";
  // The transition from the briefing lands the keyboard here, so the heading is
  // programmatically focusable. It is not a tab stop — nobody tabs onto a
  // heading — and the stylesheet keeps the mouse from parking a ring on it.
  question.setAttribute("tabindex", "-1");
  const headline = el("p", "sac-headline", review.headline);
  // The headline's tone is set from readiness, not from the words in it: the
  // stylesheet's default is the caution colour, so a ready review painted
  // without this reads as a warning it is not.
  headline.dataset.state = review.ready ? "verified" : "demo";
  heading.append(el("p", "sac-kicker", source === "demo" ? "Demonstration data" : "Local evidence"),
    question, headline);
  article.append(heading);

  // First in the DOM, first on screen, and the largest thing on the page after
  // the question itself. Everything below this block exists to justify it.
  const decision = el("section", "sac-decision");
  decision.setAttribute("aria-labelledby", "sac-decision-title");
  const title = el("h3", undefined, review.ready
    ? "Review the measured change" : "Resolve the evidence boundary");
  title.id = "sac-decision-title";
  decision.append(el("p", "sac-kicker", "Do this next · priority 1"), title,
    el("p", undefined, review.ready
      ? "Use the benchmark and evidence-bounded current result to decide whether to continue or replace the action."
      : "Supply only the named missing local evidence; no recommendation is available."));
  article.append(decision);

  const metric = el("p", "sac-metric");
  metric.append(
    el("span", "sac-metric-label", "Current vs retained baseline"),
    el("strong", "sac-metric-value", review.current.value === null
      ? "Not comparable"
      : `${money(review.current.value)} vs ${money(review.benchmark.value)}`),
    el("span", "sac-metric-comparison",
      `${review.current.period ?? "current period unavailable"} · baseline `
      + `${review.benchmark.period ?? "unavailable"}`),
  );
  article.append(metric);

  const row = el("ul", "sac-signals");
  row.setAttribute("aria-label", "Signals behind this recommendation");
  for (const signal of signals) row.append(chip(signal));
  article.append(row);

  // Where the evidence above came from, in one line. A discarded snapshot says so
  // in the same place rather than silently: the review is still the reader's own
  // records, and they are entitled to know the carried detail is gone.
  if (snapshot?.notice) {
    const carried = el("p", "sac-snapshot", snapshot.notice);
    carried.dataset.snapshot = snapshot.status;
    carried.dataset.snapshotReason = snapshot.reason ?? "none";
    article.append(carried);
  }

  const support = el("section", "sac-support");
  support.setAttribute("aria-labelledby", "sac-support-title");
  const supportTitle = el("h3", "sac-support-title", "Supporting evidence");
  supportTitle.id = "sac-support-title";
  support.append(supportTitle, el("p", "sac-support-note",
    "Everything in this group supports the recommendation above. None of it is the decision."));

  support.append(disclosure("sac-department", "Department detail", [
    ["Department", review.current.department ?? retainedAction?.department ?? "Not identified in this evidence"],
    ["Tracked action", retainedAction?.actionLabel ?? "No retained action"],
    ["Owner", retainedAction?.ownerLabel ?? "Not available"],
    ["Metric", review.current.definition],
    ["Current value", stated(review.current.value, review.current.unit)],
    ["Retained benchmark", stated(review.benchmark.value, review.benchmark.unit)],
    ["Current period", review.current.period ?? "Not available"],
    ["Comparability", review.ready
      ? "Same department, unit, and a later period. This is measured change, not realized savings."
      : `Comparison withheld: ${listed(review.evidenceBoundary.gaps, "reason not recorded")}.`],
  ]));

  support.append(disclosure("sac-evidence-detail", "Evidence and provenance", [
    ["Attribution coverage", review.confidence.coveragePercent === null
      ? "Not measured" : `${review.confidence.coveragePercent.toFixed(1)}%`],
    ["Recurring verdict", review.verdict.verdict],
    ["Permitted wording", review.verdict.wording],
    ["Verdict confidence", review.verdict.confidence.level],
    ["Confidence basis", listed(review.verdict.confidence.basis, "Not recorded")],
    ["Confidence assumption", review.verdict.confidence.assumption],
    [`Evidence joined (${review.evidenceBoundary.joined.length})`,
      listed(review.evidenceBoundary.joined, "None")],
    [`Evidence excluded (${review.verdict.evidenceBoundary.excluded.length})`,
      listed(review.verdict.evidenceBoundary.excluded, "None")],
    [`Action references (${review.provenance.actionReferences.length})`,
      listed(review.provenance.actionReferences, "None retained")],
    ["Analysis contract", review.provenance.analysisContract ?? "Not recorded"],
    ...carriedRows(snapshot),
  ]));

  support.append(el("p", "sac-caveat", review.recommendation
    ? "A lower current value is improvement under this contract. The verdict describes measured change, not causal attribution."
    : `Recommendation withheld. Missing or mismatched evidence: ${listed(review.evidenceBoundary.gaps, "not recorded")}.`));
  support.append(el("p", "sac-contracts",
    `${review.schemaVersion} · ${review.verdict.schemaVersion}`));
  article.append(support);
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

/**
 * The state between one review and the next.
 *
 * The page's static first paint already says "Reconciling monthly savings"; this
 * is the same region, repainted, for the reads that happen after it — opening
 * evidence files, or clearing them. It keeps a heading in the region so the
 * document never loses the outline level the review occupied.
 */
export function renderSavingsActionCenterLoading(
  message = "Checking the action, measurement, and adjudication records…",
) {
  const loading = el("section", "sac-state");
  loading.setAttribute("role", "status");
  loading.append(el("h2", undefined, "Reconciling monthly savings"),
    el("p", undefined, message));
  return loading;
}
