// The executive FinOps briefing, drawn as a document rather than a dashboard.
//
// It renders the briefing `executive-finops-briefing.js` builds, and it decides
// nothing: every figure, sentence, rule, and limitation arrives on the model.
// `createElement` and `textContent` only: never a markup string, and never an
// assignment of HTML into the document.
//
// READING ORDER IS THE DESIGN
// ---------------------------
// A leader reads five things, in this order, and can stop after any of them:
//
//   1. the question this page answers, and its answer — where to act first;
//   2. the material metric — how much is indicated, against what baseline;
//   3. the priority action — what to do, who owns it, capped at what;
//   4. the trust verdict — how far the figure may be carried;
//   5. what bounds it — the limitation that governs the number above.
//
// Everything else is behind two labelled disclosures, in the order the contract
// declares: level 2 "what this rests on", level 3 "how to recompute it". The
// contract forbids promoting a level-3 field into level 1, so the method stays
// shut by default. Limitations are a level-2 field, so the full list lives
// there; the one limitation that bounds the headline figure (the scenario is not
// a realized saving) is drawn at level 1 beside the figure it qualifies, with a
// count and a route to the rest. That is presentation of a level-2 field at its
// own level, not a promotion of a hidden one.
//
// DISCLOSURES ARE BUTTONS, NOT <details>
// -------------------------------------
// `PRESENTATION_REQUIREMENTS.print` says every disclosure level expands for
// print rather than being dropped. CSS cannot open a closed `<details>` — its
// closed content is not hidden by an author rule any print sheet can beat — so a
// briefing printed from a page whose script never ran would lose its provenance
// and its method. A button plus a `hidden` panel is hidden by an ordinary UA
// rule, which `@media print { .brief-panel[hidden] { display:block } }` beats.
// The print sheet is therefore the fallback and `wirePrintExpansion` is the
// enhancement, rather than the other way round.
//
// LEGIBLE WITHOUT COLOUR, AND WITHOUT SIGHT
// -----------------------------------------
// Every signal is a word plus a value, and colour is the third channel at most:
//   * the benchmark standing is a sentence ("more recoverable than its own
//     baseline") plus the signed variance in percentage points; `data-standing`
//     drives a CSS shape and a wash, never the meaning;
//   * confidence is the level word, its rung ("level 3 of 4"), what it licenses
//     in a sentence, and a shape — `data-confidence` is the fourth channel;
//   * an implausible figure is named in words in its own labelled caution, so a
//     monochrome print says the same thing the screen does.
//
// Claude Design (design-system/claude-design/review-08-foundations.html) applied:
//   * chip silhouette — "filled wash = dynamic signal, outline = static
//     classification". The standing and the confidence verdict are derived per
//     period, so they are filled washes; the dataset designation, the limitation
//     codes and the contract versions are fixed classifications, so they are
//     neutral outlines.
//   * type roles — stat numerals in the sans face, metadata/timestamps/status
//     codes in mono ink-3. The repo already ships that pairing; this sheet reuses
//     it rather than adding a scale.
//   * the summary card's finding 05 ("delta-chip noise") is why the standing chip
//     appears once, beside the figure it qualifies, and never per row.

import {
  BENCHMARK_STANDING, CONFIDENCE_LADDER, PPM,
} from "/executive-finops-briefing.js";

/* -------------------------------- formatting -------------------------------- */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const COUNT = new Intl.NumberFormat("en-US");

const usd = (minor) => (Number.isFinite(minor) ? USD.format(minor / 100) : "—");
const count = (value) => (Number.isFinite(value) ? COUNT.format(value) : "—");

/** ppm as a percentage of the same whole, one decimal. 142326 ppm → "14.2%". */
const percentOfPpm = (ppm) => (Number.isFinite(ppm) ? `${(ppm / 10_000).toFixed(1)}%` : "—");

/** A ppm difference read as percentage points, always signed. */
function pointsOfPpm(ppm) {
  if (!Number.isFinite(ppm)) return "—";
  const points = ppm / 10_000;
  return `${points > 0 ? "+" : points < 0 ? "−" : "±"}${Math.abs(points).toFixed(1)} pts`;
}

/* --------------------------------- wording ---------------------------------- */

/** The standing, in words. Never a colour, an arrow, or a sign on its own. */
export const STANDING_WORD = Object.freeze({
  [BENCHMARK_STANDING.more]: "More recoverable than its own baseline",
  [BENCHMARK_STANDING.inLine]: "In line with its own baseline",
  [BENCHMARK_STANDING.less]: "Less recoverable than its own baseline",
});

export const CONFIDENCE_WORD = Object.freeze({
  high: "High", moderate: "Moderate", low: "Low", insufficient: "Insufficient",
});

/** The slot names a reader knows, used when a slot is absent. */
const SLOT_LABEL = Object.freeze({
  primaryFinding: "Where to act first",
  recoverable: "How much is indicated",
  benchmark: "How it compares",
  nextAction: "What should happen next",
});

const DISCLOSURE = Object.freeze([
  {
    level: 2,
    title: "What this rests on",
    hint: "Benchmark, confidence rule, provenance, and every limitation",
  },
  {
    level: 3,
    title: "How every figure is recomputed",
    hint: "Method, selection and benchmark rules, and the contract versions",
  },
]);

export const PANEL_ID = (level) => `brief-panel-${level}`;
export const TOGGLE_ID = (level) => `brief-toggle-${level}`;

/* ------------------------------- DOM helpers -------------------------------- */

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

/**
 * Append inline parts with real whitespace between them.
 *
 * The parts are laid out by flex gap, which ignores a whitespace-only text node
 * between two items — so the separator costs nothing on screen and everything
 * where it matters: copied text, a text-only reader, and a printed line all read
 * "Confidence High level 4 of 4" rather than one run-on word.
 */
function inline(parent, ...parts) {
  for (const [index, part] of parts.entries()) {
    if (index) parent.append(document.createTextNode(" "));
    parent.append(part);
  }
  return parent;
}

/** A description list. Every pair is a term and one value; no bare cells. */
function facts(pairs, className = "brief-facts") {
  const list = el("dl", className);
  for (const [term, value, detail] of pairs) {
    if (value === undefined || value === null || value === "") continue;
    const group = el("div", "brief-fact");
    group.append(el("dt", null, term), el("dd", null, String(value)));
    if (detail) group.append(el("dd", "brief-fact-detail", detail));
    list.append(group);
  }
  return list;
}

function lines(items, { ordered = true, className = "brief-rule", mono = false } = {}) {
  const list = el(ordered ? "ol" : "ul", className);
  for (const item of items ?? []) {
    list.append(el("li", mono ? "brief-mono" : null, String(item)));
  }
  return list;
}

function subheading(text) {
  return el("h4", "brief-subheading", text);
}

/* ------------------------------ implausibility ------------------------------ */

/**
 * A briefing can be internally valid and still describe something nobody should
 * act on. These are the reads that mean "check the input before you quote this",
 * each stated as the sentence a reader is owed rather than as a flag.
 *
 * They are not errors: the figures are still drawn, because hiding a number a
 * reader can see elsewhere is how a tool loses their trust. They are drawn with
 * the caution attached.
 */
export const IMPLAUSIBLE_SHARE_PPM = PPM;
export const IMPLAUSIBLE_VALUE_MINOR = 100_000_000_000;
export const IMPLAUSIBLE_VARIANCE_PPM = 500_000;

export function implausibilities(briefing) {
  const found = [];
  const share = briefing?.recoverable?.sharePpm;
  const value = briefing?.recoverable?.valueMinor;
  const variance = briefing?.benchmark?.varianceSharePpm;
  if (Number.isFinite(share) && share >= IMPLAUSIBLE_SHARE_PPM) {
    found.push(
      `The recoverable scenario is ${percentOfPpm(share)} of the spend that was analyzed. `
      + "A scenario at or above the whole of analyzed spend cannot be recovered from it, so treat "
      + "the attribution as wrong before treating the figure as an opportunity.",
    );
  }
  if (Number.isFinite(value) && value >= IMPLAUSIBLE_VALUE_MINOR) {
    found.push(
      `The recoverable scenario is ${usd(value)} for a single reporting period. That is far outside `
      + "the range this workspace was built to read, so the period's units are the first thing to check.",
    );
  }
  if (Number.isFinite(variance) && Math.abs(variance) >= IMPLAUSIBLE_VARIANCE_PPM) {
    found.push(
      `The reporting period sits ${pointsOfPpm(variance)} from its own trailing baseline. A move that `
      + "large in one month is usually a change in what was imported rather than a change in spend.",
    );
  }
  return found;
}

/* --------------------------------- states ----------------------------------- */

/**
 * The state the page ships in its own markup, rebuilt here so the entry can
 * return to it. `role="status"` rather than an alert: nothing has gone wrong.
 */
export function renderBriefingLoading(message = "Rebuilding the briefing from its retained periods…") {
  const panel = el("section", "brief-state");
  panel.dataset.state = "loading";
  panel.setAttribute("role", "status");
  panel.append(
    el("h2", null, "Reading the canonical briefing"),
    el("p", null, message),
  );
  return panel;
}

/**
 * Something stopped the briefing from being built or trusted. The reader is told
 * what failed, what is *not* wrong, and what to do — never a bare apology.
 */
export function renderBriefingError({
  summary, detail, remedy, retryLabel = "Retry briefing", onRetry,
} = {}) {
  const panel = el("section", "brief-state");
  panel.dataset.state = "error";
  panel.setAttribute("role", "alert");
  const heading = el("h2");
  heading.append(el("span", "brief-state-label", "Error: "), document.createTextNode(
    summary ?? "This briefing could not be shown",
  ));
  panel.append(heading);
  panel.append(el("p", null, detail ?? "The briefing fixture could not be read in this tab."));
  panel.append(el("p", "brief-state-remedy", remedy
    ?? "Nothing was uploaded and nothing was stored. Reload the page to try again; if it keeps "
    + "failing, the published fixture and the contract that validates it disagree, and the figure "
    + "is deliberately withheld rather than shown unverified."));
  // Only where a caller can actually retry. A button that answers a press with
  // nothing is a second dead end on a panel the reader only reached because the
  // first one failed, and this renderer is shared with surfaces whose figure is
  // derived from the bundle — there, a rebuild cannot reach a different answer
  // and the honest panel is the one with no control on it.
  if (typeof onRetry === "function") panel.append(retryControl(retryLabel, onRetry));
  return panel;
}

/**
 * The one recovery control an error panel may carry. Held busy for the length of
 * the attempt only: a retry that fails again leaves a pressable button behind
 * rather than a control stuck in its waiting state with nothing left to press.
 */
function retryControl(label, onRetry) {
  const retry = el("button", "brief-retry-button", label);
  retry.setAttribute("type", "button");
  retry.addEventListener("click", async () => {
    retry.setAttribute("aria-disabled", "true");
    try {
      await onRetry();
    } catch {
      // Whatever this repaints says what failed; the control just becomes
      // pressable again.
    }
    retry.removeAttribute("aria-disabled");
  });
  return retry;
}

/**
 * Why the reader is looking at the published sample instead of their own months.
 *
 * It sits above the briefing rather than inside it, and it prints: a sheet that
 * carries a figure without saying whose figure it is, is the sheet that gets
 * quoted in a board deck six weeks later. `role="status"` rather than an alert —
 * an empty workspace is a state, not a fault, and the reader did nothing wrong.
 */
export function renderSourceNotice(absence) {
  if (!absence) return null;
  const panel = el("section", "brief-source-notice");
  panel.dataset.absence = absence.code;
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-labelledby", "brief-source-title");
  const heading = el("h2", "brief-source-title");
  heading.id = "brief-source-title";
  heading.append(
    el("span", "brief-source-label", "Not your figures: "),
    document.createTextNode(absence.summary),
  );
  panel.append(heading);
  panel.append(el("p", "brief-source-statement", absence.statement));
  if (absence.remedy) panel.append(el("p", "brief-source-remedy", absence.remedy));
  const actions = el("p", "brief-source-actions");
  const example = el("a", "brief-source-return-link", "Open the Bundled synthetic example");
  example.setAttribute("href", "/executive-briefing.html?example=ai-finops-bundled");
  const own = el("a", "brief-source-return-link", "Analyze your own export");
  own.setAttribute("href", "/evolution.html#local-finops-files");
  inline(actions, example, own);
  panel.append(actions);
  panel.append(el("p", "brief-source-substitute",
    "The published synthetic sample is shown below so the artifact can be read and printed in full. "
    + "Every figure in it is invented, and none of it is a measurement of your spend."));
  return panel;
}

/**
 * Why the reader is looking at the bundled AI FinOps example.
 *
 * The same shape and the same place as the absence notice above — a reader
 * should meet one idiom for "these are not your figures, and here is why" — with
 * one addition it earns: a real anchor back to the region they came from. A
 * hand-off that only goes one way strands a reader on a page whose figures they
 * cannot change, and the browser's back button is not a thing a printed sheet or
 * a copied link can offer.
 *
 * The link is the last thing in the panel and the only focusable node in it, so
 * it never sits between the notice and the briefing in the tab order.
 */
export function renderExampleContextNotice(context) {
  if (!context) return null;
  const panel = el("section", "brief-source-notice brief-example-notice");
  panel.dataset.absence = context.code;
  panel.dataset.exampleContext = "true";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-labelledby", "brief-source-title");
  const heading = el("h2", "brief-source-title");
  heading.id = "brief-source-title";
  heading.append(
    el("span", "brief-source-label", "Not your figures: "),
    document.createTextNode(context.summary),
  );
  panel.append(heading);
  panel.append(el("p", "brief-source-statement", context.statement));
  if (context.remedy) panel.append(el("p", "brief-source-remedy", context.remedy));
  if (context.returnHref) {
    const back = el("p", "brief-source-return");
    const link = el("a", "brief-source-return-link", context.returnLabel ?? "Back");
    link.setAttribute("href", context.returnHref);
    back.append(link);
    panel.append(back);
  }
  return panel;
}

/* ----------------------------------- print ----------------------------------- */

export const PRINT_CONTROL_ID = "brief-print";
export const PRINT_NOTE_ID = "brief-print-note";
export const PRINT_STATUS_ID = "brief-print-status";

export const PRINT_CONTROL_LABEL = "Print or save as PDF";

export const PRINT_CONTROL_NOTE =
  "Both levels open on paper, the site chrome comes off, and the sheet carries its own figure, "
  + "action, confidence, provenance, method, and limitations. Nothing is uploaded and nothing is sent.";

export const PRINT_UNAVAILABLE_MESSAGE =
  "This browser did not offer a print dialog to this page. The briefing is fully expanded now, so "
  + "printing from the browser's own menu produces the same sheet.";

/**
 * The one control this page owns.
 *
 * A real `<button>`, in the tab order, labelled with what it does rather than
 * with an icon — and drawn from script, because a print control on a page whose
 * script never ran is a control that does nothing when pressed. The keyboard
 * route that does not depend on this button at all (the browser's own print
 * command) still works: `wirePrintExpansion` listens for `beforeprint`.
 */
export function renderPrintControl({
  label = PRINT_CONTROL_LABEL, note = PRINT_CONTROL_NOTE,
} = {}) {
  const wrapper = el("div", "brief-print-control");
  const button = el("button", "brief-print-button", label);
  button.setAttribute("type", "button");
  button.id = PRINT_CONTROL_ID;
  button.setAttribute("aria-describedby", PRINT_NOTE_ID);
  const hint = el("p", "brief-print-note", note);
  hint.id = PRINT_NOTE_ID;
  const status = el("p", "brief-print-status");
  status.id = PRINT_STATUS_ID;
  status.setAttribute("role", "status");
  wrapper.append(button, hint, status);
  return wrapper;
}

/**
 * Press the control, get a whole briefing.
 *
 * Expanding before the dialog opens and restoring after it closes is done here
 * as well as on `beforeprint`/`afterprint`, because the pair is not fired by
 * every engine and the reader who pressed a button labelled "print" must not
 * receive a sheet with its provenance missing. Both paths are idempotent:
 * `expandForPrint` skips a level the reader opened, and `restoreAfterPrint`
 * closes only what this code opened.
 */
export function wirePrintControl(control, article, { scope = globalThis, doc = document } = {}) {
  const button = control.querySelector(".brief-print-button");
  const status = control.querySelector(".brief-print-status");
  if (!button) return () => {};
  const onClick = () => {
    expandForPrint(article, doc);
    if (typeof scope.print !== "function") {
      status.textContent = PRINT_UNAVAILABLE_MESSAGE;
      return;
    }
    status.textContent = "";
    try {
      scope.print();
    } finally {
      restoreAfterPrint(article, doc);
    }
  };
  button.addEventListener("click", onClick);
  return () => button.removeEventListener("click", onClick);
}

/* --------------------------------- sections ---------------------------------- */

/**
 * The one thing a reader must not be able to miss on a sample.
 *
 * First element of the masthead, above the question: a chip whose word is
 * "sample" and a sentence that says what that means, so a sheet photographed off
 * a screen or pulled out of a drawer cannot be mistaken for a measurement. It
 * carries no colour of its own on paper — the word is the signal.
 */
function syntheticBanner({ label, disclosure }) {
  const banner = el("aside", "brief-synthetic");
  banner.dataset.synthetic = "true";
  banner.setAttribute("aria-labelledby", "brief-synthetic-title");
  const title = el("p", "brief-synthetic-title");
  title.id = "brief-synthetic-title";
  title.append(el("span", "brief-synthetic-tag", label));
  banner.append(title, el("p", "brief-synthetic-statement", disclosure));
  return banner;
}

/** The container a shared sheet is read through. Pinned: the page hooks it. */
export const SHARED_SHEET_ID = "brief-shared-sheet";

/**
 * The first screen of a sheet that arrived in somebody else's link.
 *
 * A colleague opening a pasted URL has one question before every other question
 * on this page: can I quote this. So the sheet answers it in the order a reader
 * actually needs it — the figure, then the grade and the provenance one level
 * under it — using the answer region's own type roles and nothing new:
 * `.brief-figure` and `.brief-figure-label` are the metric section's, the grade
 * is `confidenceVerdict` verbatim, and the origin sentence is the
 * `.brief-provenance-line` the bounds section already reads in. No second
 * grammar, no token, and no control: this block is prose, so the reader crosses
 * it without spending a tab stop.
 *
 * THE FIGURE IS TWO DIFFERENT KINDS OF NUMBER and a shared sheet is exactly
 * where that stops being obvious — the sender knew which half was counted and
 * which half was modelled, and the recipient has only the sheet. So the parts
 * are split out and each carries a word ("Measured", "Estimated") and its own
 * value; `data-silhouette` follows the chip rule in
 * design-system/claude-design/review-08-foundations.html — outline for a static
 * classification, a filled wash for a derived signal — and is the third channel,
 * never the first. A monochrome print says the same thing the screen does.
 */
function sharedSheet(briefing, origin) {
  const sheet = el("aside", "brief-shared");
  sheet.id = SHARED_SHEET_ID;
  sheet.dataset.source = "shared";
  sheet.setAttribute("aria-labelledby", "brief-shared-title");
  const title = el("p", "brief-shared-title");
  title.id = "brief-shared-title";
  title.append(el("span", "brief-shared-tag", "Shared link · the sender’s own figures"));
  sheet.append(title);

  const recoverable = briefing.recoverable;
  if (recoverable) {
    sheet.append(el("p", "brief-figure", usd(recoverable.valueMinor)));
    sheet.append(el("p", "brief-figure-label", recoverable.label));
  } else {
    sheet.append(el("p", "brief-figure", "—"));
    sheet.append(el("p", "brief-figure-label", briefing.absent?.recoverable?.statement
      ?? "No recoverable figure could be computed from the periods in this link."));
  }

  sheet.append(confidenceVerdict(briefing.confidence ?? {}));

  const provenance = briefing.provenance ?? {};
  const parts = el("ul", "brief-shared-components");
  parts.append(
    sharedComponent({
      basis: "measured", silhouette: "outline", word: "Measured",
      value: `${usd(recoverable?.analyzedSpendMinor)} analyzed spend`,
      note: `Summed from ${count(provenance.recordsAnalyzed)} of `
        + `${count(provenance.recordsTotal)} records in the sender’s own export.`,
    }),
    sharedComponent({
      basis: "estimated", silhouette: "filled", word: "Estimated",
      value: `${usd(recoverable?.valueMinor)} recoverable`,
      note: "A modelled scenario over that spend, not an invoice line and not a realized saving.",
    }),
  );
  sheet.append(parts);

  if (origin) sheet.append(el("p", "brief-provenance-line", origin));
  return sheet;
}

function sharedComponent({ basis, silhouette, word, value, note }) {
  const item = el("li", "brief-shared-component");
  item.dataset.basis = basis;
  item.dataset.silhouette = silhouette;
  return inline(
    item,
    el("span", "brief-component-shape"),
    el("span", "brief-component-tag", word),
    el("span", "brief-component-value", value),
    el("span", "brief-component-note", note),
  );
}

function masthead(briefing, origin, synthetic, shared) {
  const header = el("header", "brief-masthead");
  const question = briefing.questions?.[0]?.question ?? "Where should we act first?";
  if (synthetic) header.append(syntheticBanner(synthetic));
  if (shared) header.append(sharedSheet(briefing, origin));
  header.append(el("p", "eyebrow", "Executive FinOps briefing"));

  const title = el("h2", "brief-question");
  title.id = "brief-question";
  title.textContent = question;
  header.append(title);

  const period = briefing.reportingPeriod;
  if (briefing.primaryFinding) {
    const answer = el("p", "brief-answer");
    answer.append(
      el("span", "brief-org-unit", briefing.primaryFinding.orgUnitId),
      document.createTextNode(` — ${briefing.primaryFinding.statement}`),
    );
    header.append(answer);
    header.append(el("p", "brief-answer-basis", `Basis: ${briefing.primaryFinding.basis}.`));
  } else {
    header.append(el("p", "brief-answer", "No org unit can be named to act on first."));
  }

  // Outline chips: dataset designation and period are static classifications of
  // this document, not derived signals (Claude Design foundations, chip rules).
  const stamp = inline(
    el("p", "brief-stamp"),
    el("span", "brief-tag", period ? `Reporting period ${period.period}` : "No reporting period"),
    el("span", "brief-tag", `Dataset: ${period?.dataset ?? "none"}`),
    el("span", "brief-tag", `Derived ${period?.derivedAt ?? "—"}`),
    el("span", "brief-tag", briefing.contractVersion),
  );
  header.append(stamp);
  if (origin) header.append(el("p", "brief-origin", origin));
  return header;
}

function metricSection(briefing) {
  const section = el("section", "brief-section brief-metric");
  section.dataset.role = "material-metric";
  section.setAttribute("aria-labelledby", "brief-metric-title");
  const heading = el("h3", "brief-section-title", "How much is indicated");
  heading.id = "brief-metric-title";
  section.append(heading);

  const recoverable = briefing.recoverable;
  if (!recoverable) {
    section.append(el("p", "brief-absent", briefing.absent?.recoverable?.statement
      ?? "No recoverable figure could be computed."));
    return section;
  }

  const figure = el("p", "brief-figure", usd(recoverable.valueMinor));
  section.append(figure, el("p", "brief-figure-label", recoverable.label));
  section.append(el("p", "brief-figure-share",
    `${percentOfPpm(recoverable.sharePpm)} of ${usd(recoverable.analyzedSpendMinor)} analyzed spend`
    + `${briefing.reportingPeriod ? ` in ${briefing.reportingPeriod.period}` : ""}.`));

  // Modelled potential is not money in the bank, and a figure this size is read
  // as money in the bank unless the sheet says otherwise where the figure is —
  // not four sections later. The statement is the contract's own
  // `scenario_not_realized_saving` limitation, drawn at level 1 beside the
  // figure it qualifies rather than restated in this file's words.
  const notRealized = (briefing.limitations ?? [])
    .find((entry) => entry?.code === "scenario_not_realized_saving");
  if (notRealized) {
    const basis = el("p", "brief-figure-basis");
    basis.dataset.basis = "modelled_potential";
    inline(
      basis,
      el("span", "brief-basis-tag", "Modelled potential, not realized savings"),
      el("span", "brief-basis-statement", notRealized.statement),
    );
    section.append(basis);
  }

  const benchmark = briefing.benchmark;
  if (benchmark?.eligible) {
    const standing = el("p", "brief-standing");
    standing.dataset.standing = benchmark.standing;
    inline(
      standing,
      el("span", "brief-standing-shape"),
      el("span", "brief-standing-word", STANDING_WORD[benchmark.standing] ?? benchmark.standing),
      el("span", "brief-standing-value",
        `${pointsOfPpm(benchmark.varianceSharePpm)} against ${percentOfPpm(benchmark.baselineSharePpm)}`
        + ` over ${count(benchmark.priorPeriodCount)} prior period${benchmark.priorPeriodCount === 1 ? "" : "s"}`),
    );
    section.append(standing);
  } else {
    const standing = el("p", "brief-standing");
    standing.dataset.standing = "unavailable";
    inline(
      standing,
      el("span", "brief-standing-shape"),
      el("span", "brief-standing-word", "No baseline to compare against"),
      el("span", "brief-standing-value", benchmark?.reason
        ? `Reason: ${benchmark.reason}`
        : "This workspace has no eligible trailing history."),
    );
    section.append(standing);
  }

  const cautions = implausibilities(briefing);
  if (cautions.length) {
    const caution = el("aside", "brief-caution");
    caution.dataset.implausible = "true";
    caution.setAttribute("aria-labelledby", "brief-caution-title");
    const title = el("h4", "brief-caution-title", "Check the input before quoting this figure");
    title.id = "brief-caution-title";
    caution.append(title, lines(cautions, { ordered: false, className: "brief-caution-list" }));
    section.append(caution);
  }
  return section;
}

function actionSection(briefing) {
  const section = el("section", "brief-section brief-action");
  section.dataset.role = "priority-action";
  section.setAttribute("aria-labelledby", "brief-action-title");
  const heading = el("h3", "brief-section-title", "What should happen next");
  heading.id = "brief-action-title";
  section.append(heading);

  const action = briefing.nextAction;
  if (!action) {
    section.append(el("p", "brief-absent", briefing.absent?.nextAction?.statement
      ?? "No action is recommended."));
    return section;
  }

  section.append(el("p", "brief-action-statement", action.statement));
  section.append(facts([
    ["Accountable", action.accountableRole],
    ["Capped at", usd(action.capMinor), `${action.capCurrency} · the reporting period's own scenario`],
    ["Precondition", action.precondition],
  ]));
  if (action.evidence?.length) {
    section.append(subheading("Evidence this action rests on"));
    section.append(lines(action.evidence, { ordered: false, className: "brief-evidence" }));
  }
  return section;
}

/* -------------------------------- follow-up ---------------------------------- */

// The one buyer-facing invitation this sheet carries, drawn where the decision
// is made rather than at the bottom of the page.
//
// A leader has just read the figure and the action directly above it; that is
// the moment they either act or ask, and asking should not require scrolling
// past the trust verdict, the bounds, and two disclosures to find a form. It is
// a control, not a section of the document: it opens the page's own follow-up
// form (`briefing-contact`, wired by src/finops-contact.js) in place, below,
// with the cursor in the field.
//
// It is the *only* invitation in the sheet, and the page it sits on carries one
// work-email form — the briefing's own. A second, generic "talk to us" form on
// the same screen asks a reader who has just made a decision to pick which of
// two identical fields belongs to it.
//
// It never prints, and it carries no `data-role`: the reading order the contract
// pins is the document's, and a control is not a part of the document.
//
// It is drawn only when the caller asks for it (`followUp: true`). This view is
// mounted on the front door as well, by landing-decision-page.js, and that page
// ships no follow-up panel for the control to open — a button that opens nothing
// is worse than no button, so the surface that owns the form is the surface that
// asks for the invitation.
export const FOLLOW_UP_PREFIX = "briefing-contact";
export const FOLLOW_UP_CTA_ID = "brief-followup-cta";
export const FOLLOW_UP_NOTE_ID = "brief-followup-note";
// The one CTA label every follow-up form on this site uses. It carries no
// page-specific qualification, so the heading and lead above it are what say
// which decision a request is about.
export const FOLLOW_UP_CTA_LABEL = "Request a follow-up";

export const FOLLOW_UP_LEAD =
  "Want to go through this decision — the figure, the action, or your own months — with a person?";

/**
 * Said at the invitation, before a reader commits to opening anything: the form
 * below it repeats the same claim in full. Both are true by construction —
 * `postLeadEmail` builds the whole request body from the typed address.
 */
export const FOLLOW_UP_NOTE =
  "Only the work email address you type is sent. No figure, period, limitation, imported file, or prompt "
  + "text from this briefing is attached — everything above stays in this browser, and this sheet does not "
  + "change when you send it.";

function followUpInvitation() {
  const section = el("section", "brief-followup");
  section.setAttribute("aria-labelledby", "brief-followup-title");
  const heading = el("h3", "brief-followup-title", "Take this decision to a person");
  heading.id = "brief-followup-title";
  section.append(heading, el("p", "brief-followup-lead", FOLLOW_UP_LEAD));

  const button = el("button", "brief-followup-button", FOLLOW_UP_CTA_LABEL);
  button.id = FOLLOW_UP_CTA_ID;
  button.setAttribute("type", "button");
  // The disclosure this opens lives outside the painted region, so it survives
  // every repaint of the sheet and this control can name it without ever
  // pointing at a node that has been replaced.
  button.setAttribute("data-follow-up-cta", FOLLOW_UP_PREFIX);
  button.setAttribute("aria-controls", `${FOLLOW_UP_PREFIX}-panel`);
  button.setAttribute("aria-describedby", FOLLOW_UP_NOTE_ID);
  const note = el("p", "brief-followup-note", FOLLOW_UP_NOTE);
  note.id = FOLLOW_UP_NOTE_ID;
  section.append(button, note);
  return section;
}

/**
 * The grade, in the one form this sheet announces it in.
 *
 * Extracted rather than restated so the shared sheet's copy of it is the same
 * element, in the same words, with the same rung sentence — a second phrasing of
 * a confidence level is a second grade as far as a reader is concerned, and as
 * far as a screen reader is concerned it is a different announcement entirely.
 */
function confidenceVerdict(confidence) {
  const rung = CONFIDENCE_LADDER.indexOf(confidence.level) + 1;
  const verdict = el("p", "brief-verdict");
  verdict.dataset.confidence = confidence.level;
  return inline(
    verdict,
    el("span", "brief-verdict-label", "Confidence"),
    el("strong", "brief-verdict-word", CONFIDENCE_WORD[confidence.level] ?? String(confidence.level)),
    el("span", "brief-verdict-rung", `level ${rung || 0} of ${CONFIDENCE_LADDER.length}`),
    el("span", "brief-verdict-shape"),
  );
}

function trustSection(briefing) {
  const section = el("section", "brief-section brief-trust");
  section.dataset.role = "trust-verdict";
  section.setAttribute("aria-labelledby", "brief-trust-title");
  const heading = el("h3", "brief-section-title", "How far this may be trusted");
  heading.id = "brief-trust-title";
  section.append(heading);

  const confidence = briefing.confidence ?? {};
  section.append(confidenceVerdict(confidence));
  if (confidence.meaning) section.append(el("p", "brief-verdict-meaning", confidence.meaning));
  if (confidence.ceiling) {
    section.append(el("p", "brief-verdict-ceiling",
      `Capped at ${CONFIDENCE_WORD[confidence.ceiling] ?? confidence.ceiling}: ${confidence.ceilingReason}.`));
  }
  if (confidence.source) section.append(el("p", "brief-verdict-source", `Source: ${confidence.source}.`));
  return section;
}

/**
 * The bound on the headline figure, at the level the figure is read.
 *
 * One statement — the limitation the contract requires every briefing to carry —
 * and an honest count of the rest, which names where they are rather than
 * implying there are none.
 */
function boundsSection(briefing, { level2Title, level3Title, provenanceNote }) {
  const section = el("section", "brief-section brief-bounds");
  section.dataset.role = "limitations";
  section.setAttribute("aria-labelledby", "brief-bounds-title");
  const heading = el("h3", "brief-section-title", "What bounds this");
  heading.id = "brief-bounds-title";
  section.append(heading);

  const limitations = briefing.limitations ?? [];
  const governing = limitations[0];
  if (governing) section.append(el("p", "brief-bound-statement", governing.statement));
  const remaining = Math.max(limitations.length - 1, 0);
  section.append(el("p", "brief-bound-more", remaining
    ? `${remaining} further limitation${remaining === 1 ? "" : "s"} apply to this briefing, listed in `
      + `“${level2Title}” below. All ${limitations.length} print.`
    : "This briefing carries no further limitation."));
  section.append(el("p", "brief-bound-safety", briefing.safety?.statement ?? ""));
  section.append(provenanceSummary(briefing, { level2Title, level3Title, provenanceNote }));
  return section;
}

/**
 * How this sheet was produced, said once on the first screen.
 *
 * A reader who is going to carry a figure into a room needs "where did this come
 * from" answered before they leave, not after they find and open a disclosure —
 * and a printed sheet that only proves its provenance on page three proves it to
 * nobody. This is the level-2 provenance record summarised at the level it is
 * read at, plus the route to the full record and the method, which is the same
 * treatment the governing limitation already gets above it. No level-3 field is
 * quoted here: the method stays behind its own level, named rather than opened.
 */
function provenanceSummary(briefing, { level2Title, level3Title, provenanceNote }) {
  const block = el("section", "brief-provenance-summary");
  block.setAttribute("aria-labelledby", "brief-provenance-summary-title");
  const heading = el("h4", "brief-subheading", "Where this came from, and how to check it");
  heading.id = "brief-provenance-summary-title";
  block.append(heading);

  const provenance = briefing.provenance ?? {};
  const periods = provenance.retainedPeriodCount;
  block.append(el("p", "brief-provenance-line",
    `${count(periods)} retained period${periods === 1 ? "" : "s"} of the `
    + `${provenance.dataset ?? "none"} dataset, derived ${provenance.derivedAt ?? "—"}, `
    + `fingerprint ${provenance.sourceFingerprint ?? "—"}; `
    + `${count(provenance.recordsAnalyzed)} of ${count(provenance.recordsTotal)} records analyzed.`));
  if (provenanceNote) block.append(el("p", "brief-provenance-note-lead", provenanceNote));
  block.append(el("p", "brief-provenance-route",
    `The full provenance record and every limitation are in “${level2Title}”; the method that recomputes `
    + `each figure is in “${level3Title}”. Both open on paper, so a printed sheet carries them whether or `
    + "not they were opened on screen."));
  return block;
}

/* ------------------------------- disclosures --------------------------------- */

function disclosure({ level, title, hint }, build) {
  const section = el("section", "brief-disclosure");
  section.dataset.level = String(level);
  const heading = el("h3", "brief-disclosure-heading");
  const button = el("button", "brief-toggle");
  button.setAttribute("type", "button");
  button.id = TOGGLE_ID(level);
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", PANEL_ID(level));
  inline(
    button,
    el("span", "brief-toggle-mark"),
    el("span", "brief-toggle-label", title),
    el("span", "brief-toggle-hint", hint),
  );
  heading.append(button);

  const panel = el("div", "brief-panel");
  panel.id = PANEL_ID(level);
  panel.setAttribute("hidden", "");
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-labelledby", TOGGLE_ID(level));
  build(panel);

  section.append(heading, panel);
  return section;
}

function supportingPanel(briefing, provenanceNote) {
  return (panel) => {
    const benchmark = briefing.benchmark;
    panel.append(subheading("Benchmark · this workspace’s own trailing baseline"));
    panel.append(facts([
      ["Kind", benchmark?.kind ?? "own_trailing_baseline",
        "This workspace's own trailing history. No peer or industry cohort."],
      ["Eligible", benchmark ? (benchmark.eligible ? "Yes" : "No") : "No", benchmark?.reason ?? undefined],
      ["Baseline share", percentOfPpm(benchmark?.baselineSharePpm)],
      ["Variance", pointsOfPpm(benchmark?.varianceSharePpm)],
      ["Standing", benchmark ? (STANDING_WORD[benchmark.standing] ?? "—") : "—"],
      ["Prior periods", benchmark?.priorPeriods?.join(", ") || "none"],
    ]));

    panel.append(subheading("How the confidence level was reached"));
    panel.append(lines(briefing.confidence?.rule ?? []));

    panel.append(subheading("Provenance"));
    const provenance = briefing.provenance ?? {};
    panel.append(facts([
      ["Dataset", provenance.dataset ?? "none"],
      ["Derived at", provenance.derivedAt ?? "—"],
      ["Source fingerprint", provenance.sourceFingerprint ?? "—"],
      ["Retained periods", count(provenance.retainedPeriodCount)],
      ["Period ids", provenance.periodIds?.join(", ") || "none"],
      ["Records analyzed", `${count(provenance.recordsAnalyzed)} of ${count(provenance.recordsTotal)}`],
    ]));
    if (provenanceNote) panel.append(el("p", "brief-provenance-note", provenanceNote));

    panel.append(subheading(`Limitations (${(briefing.limitations ?? []).length})`));
    const list = el("ol", "brief-limitations");
    for (const limitation of briefing.limitations ?? []) {
      const item = inline(
        el("li"),
        el("span", "brief-code", limitation.code),
        el("span", "brief-limitation-statement", limitation.statement),
      );
      list.append(item);
    }
    panel.append(list);
  };
}

function methodPanel(briefing) {
  return (panel) => {
    const method = briefing.method ?? {};
    panel.append(el("p", "brief-method-note", method.note ?? ""));
    panel.append(subheading("Operations"));
    panel.append(lines(method.operations, { mono: true }));
    panel.append(subheading("How the reporting period was selected"));
    panel.append(lines(briefing.selection?.rule ?? method.selectionRule ?? []));
    panel.append(facts([
      ["Candidates", count(briefing.selection?.candidateCount)],
      ["Tie-break applied", briefing.selection?.tieBreakApplied ?? "none"],
    ]));
    panel.append(subheading("How the trailing-baseline benchmark was decided"));
    panel.append(lines(method.benchmarkRule ?? []));
    panel.append(subheading("Fields read from each retained period"));
    panel.append(lines(method.readFields ?? [], { ordered: false, className: "brief-fields", mono: true }));
    panel.append(subheading("Contract versions"));
    panel.append(facts(
      Object.entries(briefing.contractVersions ?? {}).map(([name, version]) => [name, version ?? "—"]),
    ));
  };
}

/* ------------------------------- the briefing -------------------------------- */

/**
 * Draw one briefing. `origin` names where the model came from — a preview of a
 * published synthetic fixture is not the reader's own spend, and says so in the
 * masthead rather than in a footnote.
 */
export function renderExecutiveBriefingPreview(
  briefing, { origin, provenanceNote, synthetic, shared = false, followUp = false } = {},
) {
  const article = el("article", "brief");
  article.dataset.state = briefing?.reportingPeriod ? "briefing" : "absent";
  if (synthetic) article.dataset.synthetic = "true";
  // Named in the DOM so the sheet's own source is a state a test can assert on
  // rather than infer from the sentence in its masthead.
  if (shared) article.dataset.source = "shared";
  article.setAttribute("aria-labelledby", "brief-question");

  article.append(masthead(briefing, origin, synthetic, shared));

  if (!briefing?.reportingPeriod) {
    const absent = el("section", "brief-section brief-absent-slots");
    absent.setAttribute("aria-labelledby", "brief-absent-title");
    const heading = el("h3", "brief-section-title", "Nothing here can be briefed on yet");
    heading.id = "brief-absent-title";
    absent.append(heading);
    absent.append(facts(
      Object.entries(SLOT_LABEL).map(([slot, label]) => [label, briefing?.absent?.[slot]?.statement]),
      "brief-facts brief-facts-stacked",
    ));
    article.append(absent);
  } else {
    // The invitation closes the decision summary: figure, action, then the one
    // way to ask about them. Nothing can be briefed on in the branch above, so
    // there is no decision there to discuss — that page still carries the form
    // at the end of the document.
    article.append(metricSection(briefing), actionSection(briefing));
    if (followUp) article.append(followUpInvitation());
  }

  article.append(trustSection(briefing));
  article.append(boundsSection(briefing, {
    level2Title: DISCLOSURE[0].title, level3Title: DISCLOSURE[1].title, provenanceNote,
  }));
  article.append(disclosure(DISCLOSURE[0], supportingPanel(briefing, provenanceNote)));
  article.append(disclosure(DISCLOSURE[1], methodPanel(briefing)));
  return article;
}

/* ------------------------- disclosure and print wiring ----------------------- */

export function setDisclosureExpanded(button, expanded, doc = document) {
  const panel = doc.getElementById(button.getAttribute("aria-controls"));
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  if (!panel) return;
  if (expanded) panel.removeAttribute("hidden");
  else panel.setAttribute("hidden", "");
}

/** Wire every disclosure in `root`. Returns the buttons, in document order. */
export function wireDisclosures(root, doc = document) {
  const buttons = [...root.querySelectorAll(".brief-toggle")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      setDisclosureExpanded(button, button.getAttribute("aria-expanded") !== "true", doc);
    });
  }
  return buttons;
}

/** Marks a panel this code opened, so restoring cannot close one the reader did. */
export const PRINT_EXPANDED_ATTRIBUTE = "data-print-expanded";

export function expandForPrint(root, doc = document) {
  for (const button of root.querySelectorAll(".brief-toggle")) {
    if (button.getAttribute("aria-expanded") === "true") continue;
    button.setAttribute(PRINT_EXPANDED_ATTRIBUTE, "");
    setDisclosureExpanded(button, true, doc);
  }
}

export function restoreAfterPrint(root, doc = document) {
  for (const button of root.querySelectorAll(".brief-toggle")) {
    if (!button.hasAttribute(PRINT_EXPANDED_ATTRIBUTE)) continue;
    button.removeAttribute(PRINT_EXPANDED_ATTRIBUTE);
    setDisclosureExpanded(button, false, doc);
  }
}

/**
 * Open every level for print and put the reader's own state back afterwards.
 *
 * `scope` is the window. The print stylesheet already expands a hidden panel on
 * paper, so this exists for the one thing CSS cannot do: keep `aria-expanded`
 * truthful while the print dialog is open, and hand the page back unchanged.
 */
export function wirePrintExpansion(scope, root, doc = document) {
  const before = () => expandForPrint(root, doc);
  const after = () => restoreAfterPrint(root, doc);
  scope.addEventListener?.("beforeprint", before);
  scope.addEventListener?.("afterprint", after);
  return () => {
    scope.removeEventListener?.("beforeprint", before);
    scope.removeEventListener?.("afterprint", after);
  };
}
