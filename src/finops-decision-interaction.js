// How the FinOps front-door decision is *read*, as data rather than as prose.
//
// THE PROBLEM THIS SOLVES. `finops-decision-contract.js` decides what a
// complete decision record contains. Nothing decided what a reader has to be
// able to do with it: which order the four parts are read in, what a disclosure
// is called when it is shut, which figure is impossible enough to refuse to
// print, and what the page owes a reader whose engine will not open a `details`
// on paper. Those answers lived in five stylesheets, one view module, and a
// reviewer's memory, so each surface re-derived them and each derived them
// slightly differently.
//
// So they are published here, in the shape this app already uses for a
// contract: frozen data, pure functions over it, and a `validate…` that a test
// can run against the shipped document. The FinOps view consumes this module;
// it does not restate it.
//
// ---------------------------------------------------------------------------
// THE FOUR RULES
// ---------------------------------------------------------------------------
//
// 1. ONE READING ORDER, IN EVERY MEDIUM. Answer, then the benchmark that sizes
//    it, then the action it implies, then the provenance that lets a reader
//    check it — and only then the supporting detail. `READING_ORDER` is that
//    sequence, and it is the DOM order, which is what makes it also the focus
//    order and the print order. No `order`, no `tabindex`, no `flex-direction:
//    column-reverse` may put a screen reader and a sighted reader on different
//    paths through the same block.
//
// 2. COLOUR IS NEVER THE CHANNEL. Every state below ships a word and a shape
//    alongside its tone, because a wash is unreadable to a printer, to a
//    colour-blind reader, and to anyone reading the page as text.
//    `design-system/claude-design/review-08-foundations.html` is the direction
//    here: filled wash = dynamic signal, outline = static classification, and
//    the mono lowercase voice belongs to status.
//
// 3. AN IMPOSSIBLE FIGURE IS REFUSED, NOT PRINTED. A recoverable share above
//    100%, a negative impact, a confidence outside its own scale: each is a
//    number that cannot be true, and drawing it is how a broken input becomes a
//    decision. `auditDecisionFigures` names them; the surface prints the notice
//    where the figure would have been.
//
// 4. THE EVIDENCE PRINTS EVEN WHEN IT IS SHUT. See `PRINT_SPEC` — this is the
//    rule an earlier attempt got wrong, and the comment there is the record of
//    why the obvious fix does not work.
//
// This module builds no nodes, reads no document except through the explicit
// `inspect…`/`validate…` entry points, and holds no state.

/** Bump when a step, a state word, a bound, or the print strategy changes. */
export const INTERACTION_SPEC_VERSION = "finops-decision-interaction/1.0.0";

/** The region this specification governs. */
export const DECISION_REGION_ID = "finops-first-run";

/**
 * The reading order of the front-door decision, and the heading level each step
 * occupies.
 *
 * `level: null` means the step is not a heading — it is the answer sentence or
 * a label under one. The levels that are present must form an unbroken outline
 * under the page `h1`: one `h2` for the question the region answers, `h3` for
 * each part of the answer. A jump from `h2` to `h4` reads to a screen-reader
 * user as a missing section, which on a decision surface means a missing part
 * of the decision.
 *
 * `weight` is the reading rank, not an array index: `supporting` steps may be
 * re-ordered among themselves, but no `supporting` step may precede a
 * `decision` step. `validateReadingOrder` enforces exactly that.
 */
export const READING_ORDER = Object.freeze([
  Object.freeze({
    step: 1, key: "state", rank: "decision", level: null,
    id: "finops-first-run-label",
    purpose: "What kind of result this is, in a word and a shape, before any figure.",
  }),
  Object.freeze({
    step: 2, key: "question", rank: "decision", level: 2,
    id: "finops-first-run-title",
    purpose: "The canonical decision question, as the region's own heading.",
  }),
  Object.freeze({
    step: 3, key: "sample", rank: "decision", level: null,
    id: "finops-first-run-sample",
    purpose: "What kind of number follows, stated before the number.",
  }),
  Object.freeze({
    step: 4, key: "answer", rank: "decision", level: null,
    id: "finops-first-run-answer",
    purpose: "The one-sentence answer to the heading. Nothing precedes it but its own caveat.",
  }),
  Object.freeze({
    step: 5, key: "benchmark", rank: "decision", level: 3,
    id: "finops-first-run-benchmark-heading",
    purpose: "The share that sizes the answer, with the two operands behind it.",
  }),
  Object.freeze({
    step: 6, key: "impact", rank: "decision", level: 3,
    id: "finops-first-run-impact-heading",
    purpose: "The modelled money the answer is worth, labelled as a ceiling.",
  }),
  Object.freeze({
    // BEFORE the action, not after it. This region shipped with the position
    // below the recommendation, and read linearly that is an instruction with
    // its evidence behind it: a screen-reader user heard "pilot lower-cost
    // routing" before they heard that the org is in the bottom quartile, and
    // had no way to scan back the way a sighted reader can. The order a
    // decision is *justified* in is the order it is read in — the position and
    // the metric it is based on, then the team that is behind, then what to do.
    step: 7, key: "peer", rank: "decision", level: 3,
    id: "finops-first-run-peer-heading",
    purpose: "Where this org's cost per successful task ranks in its published cohort, "
      + "or the reason no position is claimed.",
  }),
  Object.freeze({
    // The named lagging team, on the same rubric and in the same units as the
    // position above it, and directly after it: "which of my teams is this
    // coming from" is the question the position provokes, and answering it
    // after the action would put the answer past the thing it explains.
    step: 8, key: "internal", rank: "decision", level: 3,
    id: "finops-first-run-internal-heading",
    purpose: "Which of this org's own departments is furthest behind which, on the same "
      + "metric and band boundaries, or the reason no gap is claimed.",
  }),
  Object.freeze({
    step: 9, key: "action", rank: "decision", level: 3,
    id: "finops-first-run-action-heading",
    purpose: "The rank-1 intervention and the role accountable for it.",
  }),
  Object.freeze({
    step: 10, key: "confidence", rank: "decision", level: 3,
    id: "finops-first-run-confidence-heading",
    purpose: "How much of the answer was verified, never a bare decimal.",
  }),
  Object.freeze({
    step: 11, key: "provenance", rank: "decision", level: 3,
    id: "finops-first-run-method-heading",
    purpose: "Where the figures came from and what they cannot tell you. Expandable, never omitted.",
  }),
  Object.freeze({
    step: 12, key: "next", rank: "supporting", level: 3,
    id: "finops-first-run-next-heading",
    purpose: "The two ways on: the example in every panel, or the reader's own export.",
  }),
]);

/** The decision steps, in order, for a caller that only wants the spine. */
export const DECISION_SPINE = Object.freeze(
  READING_ORDER.filter((step) => step.rank === "decision").map((step) => step.key));

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/**
 * Every state the decision region can be in, drawn rather than assumed.
 *
 * `word` and `shape` are the two channels that survive greyscale, a printer,
 * and a screen reader; `tone` only ever repeats what they already said. The
 * shapes are the ones `panel-status-view.js` publishes, so one glyph means one
 * thing across the whole page.
 *
 * `loading` belongs to `#finops-load-state`, not to this region — the front
 * door is composed from a module in the bundle and waits on nothing. It is
 * specified here anyway because the page as a whole has the state, and a
 * specification that only describes the states its own region reaches is how a
 * surface ends up with an undrawn one.
 */
export const DECISION_STATE = Object.freeze({
  loading: Object.freeze({
    state: "loading", word: "Composing the example result", shape: "◷", tone: "neutral",
    owner: "finops-load-state",
    statement: "The page is still reading the Bundled synthetic example. No figure is claimed yet.",
  }),
  pending: Object.freeze({
    state: "pending", word: "Example result pending", shape: "◇", tone: "neutral",
    owner: DECISION_REGION_ID,
    statement: "The Bundled synthetic example has not been composed on this page yet.",
  }),
  ready: Object.freeze({
    state: "ready", word: "Example result", shape: "▣", tone: "resolved",
    owner: DECISION_REGION_ID,
    statement: "Every figure below was composed from the bundled invented dataset.",
  }),
  empty: Object.freeze({
    state: "empty", word: "Example result has no records", shape: "◻", tone: "neutral",
    owner: DECISION_REGION_ID,
    statement: "The Bundled synthetic example carried no spend records in the window, so there is nothing to rank.",
  }),
  error: Object.freeze({
    state: "unavailable", word: "Example result unavailable", shape: "▲", tone: "error",
    owner: DECISION_REGION_ID,
    statement: "The Bundled synthetic example could not be analyzed in this browser, so no figure is shown here.",
  }),
});

/** The four states the region itself may paint, as `data-state` values. */
export const REGION_STATES = Object.freeze(["pending", "ready", "empty", "unavailable"]);

// ---------------------------------------------------------------------------
// The disclosure
// ---------------------------------------------------------------------------

/**
 * The provenance/evidence disclosure: native `<details>`, and what it is called
 * in each of its two states.
 *
 * WHY NATIVE. A `<details>`/`<summary>` pair is keyboard-operable, focusable,
 * and state-bearing without a line of script, and it stays operable if this
 * page's JavaScript never runs — which for a disclosure that carries the
 * *evidence for a money figure* is not a nicety. The accessible name is
 * therefore the summary's own text, and the state is the element's own `open`.
 *
 * WHY `aria-expanded` IS STILL WRITTEN. Current engines map `summary` to a
 * button with an expanded state, but not every assistive technology in use
 * does. The attribute is mirrored from `open` on every toggle by
 * `finops-first-run-view.js`, so it is either correct or absent — an
 * `aria-expanded` that drifts from `open` is worse than none, which is why the
 * view syncs it in one place rather than at each call site.
 */
export const DISCLOSURE_SPEC = Object.freeze({
  id: "finops-first-run-method",
  element: "details",
  summaryId: "finops-first-run-method-summary",
  headingId: "finops-first-run-method-heading",
  headingLevel: 3,
  stateId: "finops-first-run-method-state",
  listId: "finops-first-run-method-list",
  printId: "finops-first-run-method-print",
  heading: "How this example was calculated and what it cannot tell you",
  /** The state half of the accessible name, and the shape that repeats it. */
  expanded: Object.freeze({ open: true, word: "Showing the evidence", shape: "▾", action: "Hide" }),
  collapsed: Object.freeze({ open: false, word: "Evidence hidden", shape: "▸", action: "Show" }),
});

/**
 * The state half of the summary: the visible chip beside the heading.
 *
 * "Show evidence · 6" and "Hide evidence · 6" — a word for the action, and the
 * size of what is behind the control, which is the difference between a
 * disclosure a reader opens and one they scroll past.
 */
export function disclosureStateLabel(open, entryCount = null) {
  const state = open ? DISCLOSURE_SPEC.expanded : DISCLOSURE_SPEC.collapsed;
  const count = Number(entryCount);
  const entries = Number.isFinite(count) && count > 0 ? ` · ${count}` : "";
  return `${state.action} evidence${entries}`;
}

/**
 * The accessible name of the disclosure in a given state.
 *
 * Deliberately the *concatenation of the visible text*, and deliberately not an
 * `aria-label`. An override would let the spoken name drift from the printed
 * one, and it would break WCAG 2.5.3 the moment they differed: a speech-control
 * user says the words they can see, so the words they can see have to be in the
 * name. The view therefore composes the summary out of the two visible parts
 * and never sets a name attribute; this function is what a test compares the
 * computed name against.
 */
export function disclosureName(open, entryCount = null) {
  return `${DISCLOSURE_SPEC.heading} ${disclosureStateLabel(open, entryCount)}`;
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

/**
 * What a visible focus indicator has to be on this surface.
 *
 * The values are the ones `styles.css` already ships — this names them so a
 * test can hold a stylesheet to them rather than to a reviewer's eye.
 * `--focus-ring` is #155f9e, which is 5.9:1 against the page (#f3f1eb) and
 * 5.2:1 against the region's own wash (#eef6f2): both clear the 3:1 floor
 * WCAG 2.2 sets for a non-text indicator with room to spare.
 */
export const FOCUS_SPEC = Object.freeze({
  token: "--focus-ring",
  color: "#155f9e",
  minOutlineWidthPx: 3,
  minOffsetPx: 2,
  /** Focus order is DOM order. A positive tabindex is how that stops being true. */
  forbiddenAttributes: Object.freeze(["tabindex=\"1\""]),
  /**
   * Every control in the region that must be reachable, in the order it is
   * reached: the evidence behind the figure, then the two ways to put data into
   * this page, then the one way out of it — the same example, rebuilt as the
   * printable executive sheet. The hand-off is last because leaving the page is
   * the step after deciding whether to, and it is a link rather than a button
   * for the same reason.
   */
  order: Object.freeze([
    "finops-first-run-method-summary",
    "finops-first-run-demo",
    "finops-first-run-import",
    "finops-first-run-briefing",
  ]),
});

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

/**
 * How the evidence reaches paper.
 *
 * THE REJECTED FIX, AND WHY IT COULD NOT WORK. The first attempt printed a shut
 * `<details>` with `::details-content { content-visibility: visible }` and put
 * `details > * { display: revert }` underneath it as the fallback for engines
 * without the pseudo-element. Both halves are wrong in the same way. On an
 * engine that hides the content by giving the shadow slot `display: none`, or
 * by a UA rule carrying `!important`, no author declaration on the *light-DOM
 * children* reaches it: author `!important` loses to UA `!important` by
 * definition, and nothing an author writes styles another element's shadow
 * slot. And `revert` is the worst possible value to reach for, because it
 * reverts to the UA cascade origin — which is precisely the origin that is
 * hiding the content. The "fallback" resolved to the rule it was meant to beat.
 *
 * THE FIX. The evidence is rendered twice: once inside the `<details>` for the
 * screen, and once as a plain sibling block that is author-hidden on screen and
 * `display: block` on paper. A sibling is not inside a `details`, so no
 * `details:not([open])` rule in any origin can suppress it, and it needs no
 * pseudo-element, no script, and no `beforeprint` DOM mutation. In print the
 * `<details>` is hidden outright, so exactly one copy of the evidence prints
 * whether the reader left it open or shut.
 *
 * The print copy is `aria-hidden` and holds no focusable node: it is a second
 * rendering of text that is already in the accessibility tree, and announcing
 * it twice would be the cost of fixing paper by breaking speech.
 */
export const PRINT_SPEC = Object.freeze({
  strategy: "static-print-sibling",
  /** The `<details>` is hidden on paper; its sibling carries the evidence. */
  screenId: DISCLOSURE_SPEC.id,
  printId: DISCLOSURE_SPEC.printId,
  printClass: "first-run-method-print",
  /** True: the fallback must hold with no support for this pseudo-element. */
  independentOfDetailsContent: true,
  /** Values that may never appear as a print fallback for a disclosure. */
  forbiddenDeclarations: Object.freeze(["display:revert", "display: revert"]),
  /** The order the four parts must keep on paper, same as on screen. */
  order: DECISION_SPINE,
});

// ---------------------------------------------------------------------------
// Implausible extremes
// ---------------------------------------------------------------------------

/**
 * The bounds every figure on this surface has to satisfy to be worth drawing.
 *
 * Nothing in the shipped analysis produces a share above 1 or a negative
 * impact — the contract tests pin that. But this region is handed a fixture and
 * an analysis by a caller, and the day one arrives broken the honest thing to
 * draw is "out of range", not a confident percentage that cannot be true. The
 * upper money bound is deliberately absurd rather than tight: it exists to
 * catch a units error or an overflow, not to second-guess a large customer.
 */
export const FIGURE_BOUNDS = Object.freeze({
  share: Object.freeze({ min: 0, max: 1, label: "Recoverable share" }),
  impactUsd: Object.freeze({ min: 0, max: 1e12, label: "Modelled impact" }),
  confidence: Object.freeze({ min: 0, max: 1, label: "Confidence" }),
  rank: Object.freeze({ min: 1, max: 9999, label: "Action rank" }),
});

/** What a slot says in place of a figure that cannot be true. */
export const OUT_OF_RANGE_VALUE = "Out of range";

function bound(key, value, notices) {
  const limits = FIGURE_BOUNDS[key];
  if (value === null || value === undefined) return;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    notices.push(Object.freeze({
      code: `${key}_not_a_number`, key, label: limits.label, value: String(value),
      statement: `${limits.label} is not a number, so it is not shown.`,
    }));
    return;
  }
  if (number < limits.min || number > limits.max) {
    notices.push(Object.freeze({
      code: `${key}_out_of_range`, key, label: limits.label, value: String(number),
      statement: `${limits.label} is outside ${limits.min}–${limits.max}, so it is not shown.`,
    }));
  }
}

/**
 * Audit the figures a decision record carries.
 *
 * Total: any shape of input resolves to a frozen list of notices, empty when
 * every figure present is inside its bounds. A figure that is absent is not a
 * notice — an unavailable value is a different, already-drawn state.
 *
 * The one cross-figure rule is here rather than in `FIGURE_BOUNDS` because it
 * is a relationship, not a range: a scenario cannot recover more money than the
 * analysis found in the first place, and a page that prints one saying it did
 * has stopped describing the data.
 */
export function auditDecisionFigures(figures = {}) {
  const notices = [];
  if (!figures || typeof figures !== "object") return Object.freeze([]);
  bound("share", figures.share, notices);
  bound("impactUsd", figures.impactUsd, notices);
  bound("confidence", figures.confidence, notices);
  bound("rank", figures.rank, notices);
  const impact = Number(figures.impactUsd);
  const analyzed = Number(figures.analyzedUsd);
  if (Number.isFinite(impact) && Number.isFinite(analyzed) && analyzed > 0 && impact > analyzed) {
    notices.push(Object.freeze({
      code: "impact_exceeds_analyzed", key: "impactUsd", label: "Modelled impact",
      value: String(impact),
      statement: "Modelled impact is larger than the spend it was measured from, so it is not shown.",
    }));
  }
  return Object.freeze(notices);
}

/** The notice for one figure, or null. */
export function noticeFor(notices, key) {
  return (Array.isArray(notices) ? notices : []).find((notice) => notice.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

const LEVEL = /^h([1-6])$/;

/** Every heading in a subtree, in document order, as `{ level, id, text }`. */
export function headingOutline(root) {
  if (!root?.querySelectorAll) return Object.freeze([]);
  const nodes = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  return Object.freeze(nodes.map((node) => Object.freeze({
    level: Number(LEVEL.exec(node.tagName.toLowerCase())?.[1] ?? 0),
    id: node.id || null,
    text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
  })));
}

/**
 * Check a document against the reading order.
 *
 * Returns a frozen report rather than throwing: a caller painting a page wants
 * to know, and a test wants to say which step is out of place. `missing` is
 * every specified step with no element; `outOfOrder` is every pair that appears
 * in the document in the wrong sequence; `demoted` is a supporting step that
 * precedes a decision step.
 */
export function validateReadingOrder(doc) {
  const region = doc?.getElementById?.(DECISION_REGION_ID) ?? null;
  if (!region) {
    return Object.freeze({
      ok: false, missing: Object.freeze(READING_ORDER.map((step) => step.key)),
      outOfOrder: Object.freeze([]), demoted: Object.freeze([]),
      reason: `No #${DECISION_REGION_ID} in this document.`,
    });
  }
  const positions = new Map();
  const missing = [];
  const flat = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child?.nodeType !== 1) continue;
      flat.push(child);
      walk(child);
    }
  };
  walk(region);
  for (const step of READING_ORDER) {
    const index = flat.findIndex((node) => node.id === step.id);
    if (index < 0) missing.push(step.key);
    else positions.set(step.key, index);
  }
  const outOfOrder = [];
  const present = READING_ORDER.filter((step) => positions.has(step.key));
  for (let i = 1; i < present.length; i += 1) {
    if (positions.get(present[i].key) < positions.get(present[i - 1].key)) {
      outOfOrder.push(`${present[i - 1].key} → ${present[i].key}`);
    }
  }
  const lastDecision = Math.max(-1, ...present
    .filter((step) => step.rank === "decision").map((step) => positions.get(step.key)));
  const demoted = present
    .filter((step) => step.rank === "supporting" && positions.get(step.key) < lastDecision)
    .map((step) => step.key);
  return Object.freeze({
    ok: missing.length === 0 && outOfOrder.length === 0 && demoted.length === 0,
    missing: Object.freeze(missing),
    outOfOrder: Object.freeze(outOfOrder),
    demoted: Object.freeze(demoted),
    reason: null,
  });
}

/**
 * Check that the region's heading outline is unbroken.
 *
 * A level may repeat or step back to any shallower level; what it may never do
 * is skip forward by more than one. That is the whole rule, and it is the one
 * an author breaks by reaching for `h4` because it looked the right size.
 */
export function validateHeadingOutline(root, { startLevel = 2 } = {}) {
  const outline = headingOutline(root);
  const skips = [];
  let previous = startLevel - 1;
  for (const heading of outline) {
    if (heading.level > previous + 1) {
      skips.push(`h${previous} → h${heading.level}${heading.id ? ` (#${heading.id})` : ""}`);
    }
    previous = heading.level;
  }
  return Object.freeze({ ok: skips.length === 0, outline, skips: Object.freeze(skips) });
}
