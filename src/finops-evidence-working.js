// The working behind the recoverable figure, for a reader who does not believe it.
//
// WHAT THIS FIXES (#1524). The evidence destination held panels that each
// checked one part of the page, and none of them answered the question a
// finance director actually arrives with: how did you get this number, and what
// did you assume to get it. The parts of that answer existed — the arithmetic
// was a clause in a basis sentence, the rubric version was quoted in one panel,
// the pricing card was named in another — but a skeptic had to assemble them.
//
// So they are assembled here, once, in the order the reader needs them:
//
//   1. THE CLAIM      — what figure is being defended, over what window.
//   2. THE ARITHMETIC — an ordered list, each step naming its operand, its
//                       operation and the running result, as text. Not a
//                       diagram and not a table that only reads sighted: a
//                       director reading down the list can redo it on paper.
//   3. THE RUBRIC AND THE PRICING — stated ONCE, at one known place. The page
//                       used to sprinkle "which rubric" and "whose prices"
//                       inline beside several figures, where they competed with
//                       the figures rather than qualifying them.
//   4. WHERE EACH INPUT CAME FROM — the source of record and its as-of date,
//                       behind one native disclosure, because it is the layer a
//                       reader opens only when they are checking a specific
//                       operand.
//
// NOTHING LIVE, NOTHING CANONICAL, GOES INSIDE A DISCLOSURE. The figure being
// defended and the state line are siblings of the disclosure, never children:
// a closed details element silences a live region in a real browser even though
// a test harness reads straight through it.
//
// NO COLOUR CARRIES MEANING. The state chip is a word plus a shape plus the
// sentence beside it, which is the chip rule in
// design-system/claude-design/review-08-foundations.html: a filled wash is a
// dynamic signal, an outline is a static classification, and neither is ever
// the only channel. Every class used below is already shipped by evolution.css
// or styles.css — this module adds no rule to either stylesheet and no new
// token, scale or custom property.
//
// DATA AND MARKUP ONLY. No storage, no network, no clock. Every number below is
// the bundled synthetic example's own, authored once here and rendered into the
// document, so the served bytes and the render cannot state two different
// things — the same contract src/finops-destinations.js keeps with its region.

const escape = (text) => String(text)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The figure this region exists to defend, and the window it holds over. */
export const EVIDENCE_CLAIM = Object.freeze({
  label: "Recoverable AI spend per month",
  display: "$51,254",
  window: "2026-06-01 to 2026-07-01",
});

/**
 * The arithmetic, in order. Each step states an OPERAND, an OPERATION and the
 * RUNNING RESULT after it, in words, so the sequence can be redone on paper.
 * A step with no running result is not a step; it is a remark.
 */
export const EVIDENCE_STEPS = Object.freeze([
  Object.freeze({
    operand: "Analyzed AI spend in the reporting month",
    operation: "start from the export's own analyzed total",
    result: "$154,500",
  }),
  Object.freeze({
    operand: "Departments carrying a completed FinOps score",
    operation: "keep only those, at 5 of 5, so nothing is dropped for want of a score",
    result: "$154,500 still in scope",
  }),
  Object.freeze({
    operand: "Each scored department's identified recoverable line",
    operation: "sum them; unscored departments contribute zero and are never extrapolated to",
    result: "$51,254",
  }),
  Object.freeze({
    operand: "The sum above",
    operation: "round once, after the arithmetic, at the unit it is displayed in",
    result: "$51,254 a month — the figure this page states",
  }),
  Object.freeze({
    operand: "The monthly figure",
    operation: "multiply by 12 to state the annual form, with no seasonality or growth adjustment",
    result: "about $615,048 a year if this month holds",
  }),
]);

/**
 * The hedges, stated ONCE. Every term below was previously readable only beside
 * a figure somewhere else on the page; `EVIDENCE_LABELS` is exported so the
 * parity test and this render read the same list and cannot drift apart.
 */
export const EVIDENCE_RUBRIC = Object.freeze([
  Object.freeze({
    term: "Rubric version",
    detail: "literacy-mix/1.0.0, the published rubric every prompt grade on this page is scored against. A quoted grade is arguable against this version and no other.",
  }),
  Object.freeze({
    term: "Pricing card",
    detail: "Published list rates, with nothing contracted. That makes the figure a ceiling at list prices rather than a saving, and it moves the moment contracted input and output rates are declared for the premium and standard text tiers.",
  }),
  Object.freeze({
    term: "Pricing provenance",
    detail: "Not scored for this document: the four per-criterion bands — where the rates came from, how complete the card is, how old it is, how much of the analysis it covers — are read from the declaration's metadata, and this document carries no declaration.",
  }),
  Object.freeze({
    term: "Confidence",
    detail: "Medium — the workloads behind the figure are named, but their cost is priced by applying the published rate card to counted requests rather than read off an invoice line.",
  }),
  Object.freeze({
    term: "As of",
    detail: "Bundled synthetic example, as of 2026-07-01. Invented usage records for an invented company: not your spend, not customer data, and not a realized saving.",
  }),
]);

/** The visible terms of the block above, in order. One list, two readers. */
export const EVIDENCE_LABELS = Object.freeze(EVIDENCE_RUBRIC.map((row) => row.term));

/** Where each operand above came from, and when it was taken. */
export const EVIDENCE_INPUTS = Object.freeze([
  Object.freeze({
    term: "Analyzed spend",
    detail: "Bundled synthetic provider export shipped with this page, as of 2026-07-01.",
  }),
  Object.freeze({
    term: "Department scores",
    detail: "Computed in this browser from that export; 5 of 5 departments completed.",
  }),
  Object.freeze({
    term: "Unit prices",
    detail: "Published list rate card, as of 2026-07-01. No contracted or committed-use rate is applied.",
  }),
  Object.freeze({
    term: "Prompt grades",
    detail: "Synthetic prompt corpus scored by literacy-mix/1.0.0, weighted by each department's spend.",
  }),
]);

/**
 * The four states this region can be in, and what each one says.
 *
 * Drawn rather than assumed. `loading` is a LABELLED computing state, not a
 * bare spinner; `empty` says what would populate the region; `error` names what
 * is missing and what to do next. In every state the heading structure and the
 * claim survive, because a reader who cannot see the arithmetic still has to be
 * told which number is being talked about.
 */
export const EVIDENCE_STATES = Object.freeze(["ready", "loading", "empty", "error"]);

const STATE_TEXT = Object.freeze({
  ready: Object.freeze({
    word: "Checked", shape: "✓", silhouette: "outline",
    summary: "Every step below is computed from the bundled synthetic export this page already loaded.",
  }),
  loading: Object.freeze({
    word: "Computing", shape: "◌", silhouette: "filled",
    summary: "Recomputing the arithmetic from the analyzed export. The steps below are the last completed run, not a new one.",
  }),
  empty: Object.freeze({
    word: "Nothing recorded", shape: "○", silhouette: "outline",
    summary: "No evidence has been recorded for this figure yet. Import a provider export, or load the bundled synthetic example, and each step below is computed from it.",
  }),
  error: Object.freeze({
    word: "Input unavailable", shape: "△", silhouette: "outline",
    summary: "An input source could not be read, so no step below was recomputed. The rate card is the source to check first; reload the page once it is readable.",
  }),
});

/** One state's line, never colour alone: a word, a shape and a sentence. */
export function evidenceState(state = "ready") {
  const key = EVIDENCE_STATES.includes(state) ? state : "ready";
  return Object.freeze({ state: key, ...STATE_TEXT[key] });
}

/**
 * A step, as one sentence. Exported so the render and any later summary of the
 * arithmetic read the same string rather than two formattings of it.
 */
export const stepText = (step) =>
  `${step.operand} — ${step.operation}. Running total: ${step.result}.`;

/**
 * The region, rendered. `indent` is the leading whitespace of the opening tag
 * in the document, so the returned string compares against the authored markup
 * with nothing normalised away.
 *
 * THE HEADING HIERARCHY IS THE READING ORDER, and it is DOM order: one h2 that
 * names the destination block, then one h3 per part, no level skipped and
 * nothing reordered visually. A reader listing headings gets the same four
 * steps in the same sequence as a reader scrolling.
 */
export function evidenceWorkingMarkup(indent = "      ", state = "ready") {
  const pad = (depth) => `${indent}${"  ".repeat(depth)}`;
  const line = evidenceState(state);
  const row = (entry, depth) =>
    `${pad(depth)}<div><dt>${escape(entry.term)}</dt><dd>${escape(entry.detail)}</dd></div>`;
  return [
    `${indent}<section class="finops-panel" id="finops-evidence-working" data-workspace-region="evidence" data-decision-summary="evidence" data-state="${line.state}" aria-labelledby="finops-evidence-working-title">`,
    `${pad(1)}<p class="eyebrow">The working</p>`,
    `${pad(1)}<h2 id="finops-evidence-working-title">How was ${escape(EVIDENCE_CLAIM.display)} computed, and from what?</h2>`,
    `${pad(1)}<p class="stand-answer" id="finops-evidence-working-claim">${escape(EVIDENCE_CLAIM.label)}: ${escape(EVIDENCE_CLAIM.display)}, over ${escape(EVIDENCE_CLAIM.window)}. Every step, source and assumption behind that figure is below.</p>`,
    `${pad(1)}<p class="panel-status-line" id="finops-evidence-working-state"><span class="panel-status-chip" id="finops-evidence-working-chip" data-silhouette="${line.silhouette}"><span class="panel-status-shape" id="finops-evidence-working-shape" aria-hidden="true">${escape(line.shape)}</span><span class="panel-status-word" id="finops-evidence-working-word">${escape(line.word)}</span></span> <span class="panel-status-summary" id="finops-evidence-working-summary">${escape(line.summary)}</span></p>`,
    `${pad(1)}<h3 id="finops-evidence-arithmetic-title">The arithmetic, step by step</h3>`,
    `${pad(1)}<ol class="action-list" id="finops-evidence-arithmetic">`,
    ...EVIDENCE_STEPS.map((step) => `${pad(2)}<li>${escape(stepText(step))}</li>`),
    `${pad(1)}</ol>`,
    `${pad(1)}<h3 id="finops-evidence-rubric-title">Rubric version and pricing provenance</h3>`,
    `${pad(1)}<dl class="figure-source-detail" id="finops-evidence-rubric">`,
    ...EVIDENCE_RUBRIC.map((entry) => row(entry, 2)),
    `${pad(1)}</dl>`,
    `${pad(1)}<h3 id="finops-evidence-inputs-title">Where each input came from</h3>`,
    `${pad(1)}<details class="figure-source" id="finops-evidence-inputs" data-disclosure="collapsed">`,
    `${pad(2)}<summary class="figure-source-summary" id="finops-evidence-inputs-summary" aria-expanded="false"><span class="figure-source-state" data-disclosure="collapsed"><span class="figure-source-shape" aria-hidden="true">▸</span> Source of record and as-of date for each of the ${EVIDENCE_INPUTS.length} inputs</span></summary>`,
    `${pad(2)}<dl class="figure-source-detail" id="finops-evidence-inputs-detail">`,
    ...EVIDENCE_INPUTS.map((entry) => row(entry, 3)),
    `${pad(2)}</dl>`,
    `${pad(1)}</details>`,
    `${indent}</section>`,
  ].join("\n");
}

/**
 * Paint one state into the region. Three channels carry it and a reader needs
 * any one of them: the word in the chip, the shape beside it, and the sentence
 * after it. `data-state` on the region is for anything downstream that reads
 * it, never for a reader.
 *
 * Never throws on a page that does not carry the region.
 */
export function applyEvidenceWorkingState(document, state = "ready") {
  const line = evidenceState(state);
  const region = document?.getElementById?.("finops-evidence-working");
  if (!region) return null;
  region.setAttribute?.("data-state", line.state);
  const chip = document.getElementById?.("finops-evidence-working-chip");
  chip?.setAttribute?.("data-silhouette", line.silhouette);
  const shape = document.getElementById?.("finops-evidence-working-shape");
  if (shape) shape.textContent = line.shape;
  const word = document.getElementById?.("finops-evidence-working-word");
  if (word) word.textContent = line.word;
  const summary = document.getElementById?.("finops-evidence-working-summary");
  if (summary) summary.textContent = line.summary;
  return line;
}

/**
 * Repaint the region from the data above. The document already ships the same
 * markup, so this changes nothing on an ordinary open — it is what makes the
 * page render FROM this module rather than merely agree with it.
 */
export function applyEvidenceWorking(document, state = "ready") {
  const line = applyEvidenceWorkingState(document, state);
  if (!line) return false;
  const steps = document.getElementById?.("finops-evidence-arithmetic");
  steps?.replaceChildren?.(...EVIDENCE_STEPS.map((step) => {
    const item = document.createElement("li");
    item.textContent = stepText(step);
    return item;
  }));
  const rows = (host, entries) => {
    if (!host) return;
    host.replaceChildren?.(...entries.map((entry) => {
      const group = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = entry.term;
      const detail = document.createElement("dd");
      detail.textContent = entry.detail;
      group.append(term, detail);
      return group;
    }));
  };
  rows(document.getElementById?.("finops-evidence-rubric"), EVIDENCE_RUBRIC);
  rows(document.getElementById?.("finops-evidence-inputs-detail"), EVIDENCE_INPUTS);
  return true;
}

/**
 * Mirror the disclosure's own `open` onto the state channels. Nothing here
 * intercepts a key: the summary element is the control, Enter and Space stay
 * the browser's, and this only reflects what the browser already did.
 */
export function bindEvidenceInputs(document) {
  const host = document?.getElementById?.("finops-evidence-inputs");
  if (!host) return null;
  host.addEventListener?.("toggle", () => {
    const open = Boolean(host.open ?? host.hasAttribute?.("open"));
    host.setAttribute("data-disclosure", open ? "expanded" : "collapsed");
    const summary = document.getElementById?.("finops-evidence-inputs-summary");
    summary?.setAttribute?.("aria-expanded", open ? "true" : "false");
    const state = summary?.querySelector?.(".figure-source-state");
    state?.setAttribute?.("data-disclosure", open ? "expanded" : "collapsed");
  });
  return host;
}
