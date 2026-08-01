import { MONTHLY_FINOPS_REVIEW_VERSION, roundOne } from "./monthly-finops-review.js";

// The fixture is fetched at runtime, so every label, scope, and statement below
// is treated as untrusted text. Two boring rules, the same pair used in
// finance-portfolio-view.js:
//
//   1. Nodes are built with createElement and text is assigned through
//      textContent, so a scope containing tags stays a scope. No markup string
//      is produced or parsed here, and no URL or handler is built from fixture
//      data, so there is no other sink to escape into.
//   2. Every string passes through safeText on its way to the DOM. Cc is the
//      control characters and Cf the invisible formatting ones, including the
//      bidi overrides that can make a currency figure read back to front next
//      to a Confirm button. Whitespace collapses first so stripping them cannot
//      run two words together, and the length bound stops one caption from
//      pushing the action control off the card.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
const MAX_TEXT_LENGTH = 320;

const safeText = (value, fallback = "") => {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").replace(INVISIBLE, "").trim();
  if (!cleaned) return fallback;
  return cleaned.length > MAX_TEXT_LENGTH ? `${cleaned.slice(0, MAX_TEXT_LENGTH - 1)}…` : cleaned;
};

const node = (doc, tag, className, content) => {
  const result = doc.createElement(tag);
  if (className) result.className = className;
  result.textContent = safeText(content);
  return result;
};

const fact = (doc, label, value) => {
  const item = node(doc, "div", "monthly-review-fact", "");
  item.append(node(doc, "dt", "", label), node(doc, "dd", "", value));
  return item;
};

// Whole units stay uncluttered, but minor units are shown when there are any:
// rounding them away prints a $0 variance next to a met-or-missed verdict.
const money = (minor, currency) => {
  const digits = minor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(minor / 100);
};

// roundOne, not toFixed: the contract's rule is half away from zero, and toFixed
// would show an attainment of exactly 100.05% as 100.0% — "landed on target".
const percent = (ratio) => ratio === null
  ? "Not defined (expected savings are zero)"
  : `${roundOne(ratio * 100).toFixed(1)}%`;

export function renderMonthlyFinopsReview(doc, review) {
  const root = doc.getElementById("monthly-review-projection");
  if (!root) return null;
  root.replaceChildren();
  root.dataset.state = review.finding.outcome;
  root.dataset.contractVersion = review.schemaVersion;

  const heading = node(doc, "h2", "", review.question);
  heading.id = "monthly-review-projection-title";

  const finding = node(doc, "section", "monthly-review-benchmark", "");
  const findingTitle = node(doc, "h3", "", "Finding");
  findingTitle.id = "monthly-review-primary-finding";
  finding.setAttribute("aria-labelledby", findingTitle.id);
  const benchmark = node(doc, "dl", "monthly-review-evidence", "");
  benchmark.append(
    fact(doc, "Selected savings action", `${review.selectedAction.name} · ${review.selectedAction.scope}`),
    fact(doc, `Expected savings · ${review.benchmark.verificationPeriodLabel}`,
      money(review.benchmark.expectedSavingsMinor, review.benchmark.currency)),
    fact(doc, `Observed savings · ${review.benchmark.verificationPeriodLabel}`,
      money(review.benchmark.observedSavingsMinor, review.benchmark.currency)),
    fact(doc, "Variance · observed minus expected",
      money(review.benchmark.varianceMinor, review.benchmark.currency)),
    fact(doc, "Attainment · observed ÷ expected", percent(review.benchmark.attainment)),
  );
  finding.append(findingTitle, node(doc, "p", "monthly-review-finding", review.finding.statement), benchmark);

  const confidence = node(doc, "p", "monthly-review-status",
    `Confidence: ${review.confidence.level} · ${review.confidence.basis}`);
  const provenance = node(doc, "p", "monthly-review-comparison",
    `Synthetic provenance: ${review.provenance.periodLabels.join(" → ")} · ${review.provenance.methodVersion}.`);

  const action = node(doc, "section", "monthly-review-projection-action", "");
  const actionTitle = node(doc, "h3", "", "Prioritized follow-up · rank 1");
  actionTitle.id = "monthly-review-action-title";
  action.setAttribute("aria-labelledby", actionTitle.id);
  action.append(actionTitle, node(doc, "p", "monthly-review-action-statement", review.nextAction.statement),
    node(doc, "p", "monthly-review-comparison", review.nextAction.evidence));

  const details = node(doc, "details", "monthly-review-projection-provenance", "");
  const summary = node(doc, "summary", "", "Check supporting signals and metric boundaries");
  summary.setAttribute("aria-controls", "monthly-review-verification-support");
  const support = node(doc, "div", "monthly-review-provenance-content", "");
  support.id = "monthly-review-verification-support";
  const coverage = review.confidence.coveragePercent === null
    ? `No comparable records were expected, so coverage is undefined; threshold ${review.confidence.thresholdPercent.toFixed(1)}%.`
    : `${review.confidence.coveragePercent.toFixed(1)}% comparable; threshold ${review.confidence.thresholdPercent.toFixed(1)}%.`;
  const facts = node(doc, "dl", "monthly-review-evidence", "");
  facts.append(
    fact(doc, "Complete observation", String(review.confidence.signals.observationComplete)),
    fact(doc, "Coverage signal", coverage),
    fact(doc, "Scope match", review.confidence.signals.scopeMatches
      ? `true; observed spend is scoped to ${review.selectedAction.scope}.`
      : `false; observed spend is scoped to ${review.benchmark.observedScope ?? "an unnamed scope"}, not ${review.selectedAction.scope}.`),
    fact(doc, "Observed-savings definition", "Baseline scoped spend minus verification-period scoped spend."),
    fact(doc, "Variance and attainment", "Variance is observed minus expected. Attainment is observed divided by expected; undefined when expected is zero."),
    fact(doc, "Synthetic source period IDs", review.provenance.periodIds.join(" → ")),
  );
  support.append(facts, node(doc, "p", "monthly-review-boundary", review.provenance.boundary));
  details.append(summary, support);

  root.append(node(doc, "p", "eyebrow", "Monthly verification brief · bundled synthetic data"),
    heading, finding, confidence, provenance, action, details);
  return root;
}

const CURRENCY_CODE = /^[A-Z]{3}$/;
const isText = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Every field this controller is about to dereference, checked once before the
 * first paint. Failing closed is the boring option: a malformed or tampered
 * fixture that throws halfway through a repaint would leave a half-drawn
 * workspace with a live Confirm button in it, which is worse than showing the
 * unavailable state. The version check alone does not cover that, because the
 * contract validates the figures it computes and passes fixture strings through.
 */
function isRenderable(review) {
  if (review?.schemaVersion !== MONTHLY_FINOPS_REVIEW_VERSION) return false;
  const { benchmark, provenance } = review;
  // Intl.NumberFormat throws on an unrecognized currency code, and after the
  // first paint that throw would land inside a click handler with no catch.
  if (!CURRENCY_CODE.test(benchmark?.currency ?? "")) return false;
  if (!(benchmark.attainment === null || Number.isFinite(benchmark.attainment))) return false;
  if (![benchmark.expectedSavingsMinor, benchmark.observedSavingsMinor].every(Number.isSafeInteger)) return false;
  if (!Array.isArray(provenance?.periodLabels) || provenance.periodLabels.length !== 2) return false;
  return [benchmark.verificationPeriodLabel, ...provenance.periodLabels, provenance.boundary,
    review.selectedAction?.name, review.selectedAction?.scope, review.finding?.statement,
    review.nextAction?.statement, review.nextAction?.evidence, review.confidence?.basis].every(isText);
}

/**
 * The bundled demonstration's continuation, deliberately held in memory.
 * This controller has no storage, file, provider, credential, or prompt input.
 */
export function renderMonthlyFinopsContinuation(doc, review) {
  const root = doc.getElementById("monthly-review-projection");
  if (!root) return null;
  if (!isRenderable(review)) {
    root.replaceChildren(
      node(doc, "p", "eyebrow", "Monthly action loop · bundled synthetic data"),
      Object.assign(node(doc, "h2", "", "The bundled monthly review is unavailable"),
        { id: "monthly-review-projection-title" }),
      node(doc, "p", "monthly-review-state-action",
        "No action was selected or stored. Reset the demo from its preview control to try again."),
    );
    root.dataset.state = "empty";
    return root;
  }

  let phase = "recommended";
  let disclosureOpen = false;

  // Built once and never detached. A status region that is removed and
  // re-inserted on each repaint is announced unreliably, because screen readers
  // report changes to regions that were already in the accessibility tree; the
  // repaint below therefore clears its siblings and leaves this node alone.
  const live = node(doc, "p", "visually-hidden", "");
  live.id = "monthly-review-live";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  root.replaceChildren(live);

  const button = (id, label, className = "secondary-button") => {
    const control = node(doc, "button", className, label);
    control.id = id;
    control.type = "button";
    return control;
  };

  const paint = ({ focus = null, message = "" } = {}) => {
    [...root.children].forEach((child) => { if (child !== live) child.remove(); });
    root.dataset.state = phase;
    root.dataset.contractVersion = review.schemaVersion;

    const heading = node(doc, "h2", "", phase === "verified"
      ? review.question : "Which savings action should we take into next month?");
    heading.id = "monthly-review-projection-title";
    if (phase === "verified") heading.tabIndex = -1;

    const benchmark = node(doc, "section", "monthly-review-benchmark", "");
    const benchmarkTitle = node(doc, "h3", "", phase === "verified"
      ? "Material benchmark" : "Material benchmark · next eligible bundled period");
    benchmarkTitle.id = "monthly-review-primary-finding";
    benchmark.setAttribute("aria-labelledby", benchmarkTitle.id);
    const figures = node(doc, "dl", "monthly-review-evidence", "");
    figures.append(
      fact(doc, "Expected savings", money(review.benchmark.expectedSavingsMinor,
        review.benchmark.currency)),
      fact(doc, "Verification period", review.benchmark.verificationPeriodLabel),
    );
    if (phase === "verified") {
      figures.append(
        fact(doc, "Observed savings", money(review.benchmark.observedSavingsMinor,
          review.benchmark.currency)),
        fact(doc, "Attainment", percent(review.benchmark.attainment)),
      );
    }
    benchmark.append(benchmarkTitle, figures);

    const action = node(doc, "section", "monthly-review-projection-action", "");
    const actionTitle = node(doc, "h3", "", phase === "verified"
      ? `Prioritized follow-up · ${review.finding.outcome === "met" ? "continue" : "adjust"}`
      : "Recommended action · rank 1");
    actionTitle.id = "monthly-review-action-title";
    action.setAttribute("aria-labelledby", actionTitle.id);
    action.append(actionTitle);

    if (phase === "verified") {
      action.append(
        node(doc, "p", "monthly-review-finding", review.finding.statement),
        node(doc, "p", "monthly-review-action-statement", review.nextAction.statement),
        node(doc, "p", "monthly-review-comparison", review.nextAction.evidence),
      );
    } else {
      action.append(
        node(doc, "p", "monthly-review-action-statement",
          `${review.selectedAction.name} · ${review.selectedAction.scope}`),
        node(doc, "p", "monthly-review-comparison",
          `Prioritized because its bundled one-period expectation is ${money(review.benchmark.expectedSavingsMinor, review.benchmark.currency)}.`),
      );
      if (phase === "recommended") {
        const select = button("monthly-review-select", "Select recommended action", "primary-button");
        select.setAttribute("aria-describedby", "monthly-review-action-title");
        select.addEventListener("click", () => {
          phase = "confirming";
          paint({ focus: "monthly-review-confirm",
            message: `${review.selectedAction.name} selected. Confirm it for the next bundled period.` });
        });
        action.append(select);
      } else {
        const confirm = button("monthly-review-confirm", "Confirm for next bundled period", "primary-button");
        confirm.addEventListener("click", () => {
          phase = "verified";
          paint({ focus: "monthly-review-projection-title",
            message: `${review.selectedAction.name} confirmed. Next-period verification is now visible.` });
        });
        action.append(confirm, node(doc, "p", "monthly-review-comparison",
          "Confirming advances this synthetic demo only. It does not save or send anything."));
      }
    }

    const reset = button("monthly-review-reset", phase === "recommended" ? "Reset demo" : "Reset selection");
    reset.disabled = phase === "recommended";
    reset.addEventListener("click", () => {
      phase = "recommended";
      paint({ focus: "monthly-review-select", message: "Bundled action selection reset." });
    });

    // Reading the assumptions is part of deciding, so an open disclosure
    // survives the repaint that selecting or confirming causes.
    const details = node(doc, "details", "monthly-review-projection-provenance", "");
    if (disclosureOpen) details.setAttribute("open", "");
    details.addEventListener("toggle", () => { disclosureOpen = details.hasAttribute("open"); });
    const summary = node(doc, "summary", "", "Assumptions and supporting period detail");
    summary.setAttribute("aria-controls", "monthly-review-verification-support");
    const support = node(doc, "div", "monthly-review-provenance-content", "");
    support.id = "monthly-review-verification-support";
    const facts = node(doc, "dl", "monthly-review-evidence", "");
    facts.append(
      fact(doc, "Baseline period", review.provenance.periodLabels[0]),
      fact(doc, "Verification period", review.provenance.periodLabels[1]),
      fact(doc, "Confidence assumption", review.confidence.basis),
      fact(doc, "Observed-savings definition", "Baseline scoped spend minus verification-period scoped spend; association is not causation."),
    );
    support.append(facts, node(doc, "p", "monthly-review-boundary", review.provenance.boundary));
    details.append(summary, support);

    root.append(node(doc, "p", "eyebrow", "Monthly action loop · bundled synthetic data"),
      heading, benchmark, action, reset, details);
    if (message) live.textContent = safeText(message);
    doc.getElementById(focus)?.focus?.();
  };

  paint();
  return root;
}
