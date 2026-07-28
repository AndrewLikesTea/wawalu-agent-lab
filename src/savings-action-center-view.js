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
