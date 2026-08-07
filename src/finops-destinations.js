// The front door of /evolution.html: one question, one number, one next action,
// and the three named places a leader can go from there.
//
// THE PROBLEM THIS SOLVES. The answer region above this one already states the
// page's decision (#1183) and holds itself to one question, one figure, one
// move — `tests/evolution.test.js` fails if a second link appears in it. What
// it does not say is *where to go*, and the page's own ranked destinations were
// authored roughly thirteen hundred lines further down, below the fold, below
// the headline region, below the example result. A CTO opening this page cold
// got the decision and no doors.
//
// So the doors move to the front, and they come from data rather than from
// markup. Every string a reader sees in the front-door region below is written
// once, here, and rendered by `frontDoorMarkup()`. `tests/finops-destinations.test.js`
// compares the region in `src/evolution.html` against that function byte for
// byte, which is the same contract `src/site-nav.js` keeps with every page's
// nav: the document ships the rendered markup so it is readable with no script
// at all, and a drift between the two is a failing test rather than a silent
// disagreement.
//
// ---------------------------------------------------------------------------
// METRIC DEFINITIONS — stated so two engineers compute the same values
// ---------------------------------------------------------------------------
//
// The values below are synthetic constants for the bundled demo. These
// definitions govern how those constants are labelled and how any later
// computation against real data must work.
//
// * RECOVERABLE SPEND (QUARTER). The sum, over the current calendar quarter to
//   date, of AI-infrastructure line-item cost attributed to workloads flagged
//   as addressable by at least one SHIPPED optimisation lever. Denominated in
//   USD, rounded to the nearest thousand, displayed with a leading `$` and a
//   `k`/`M` suffix. It is a SUBSET of total spend. It is never a projection of
//   future savings and never includes spend already recovered. In the bundled
//   example the quarter is Q2 2026, closed, and one workload qualifies — Atlas
//   Platform's short, low-context requests, addressable by the shipped routing
//   lever at 5,200 USD a month. 5,200 x 3 = 15,600, rounded once after the
//   arithmetic to 16,000 and displayed as $16k. The same lever annualised is
//   the $62,400 the answer region above states; one lever, two windows, and
//   neither is a second claim.
//
// * CONFIDENCE. Exactly three levels and no fourth. `high` — every contributing
//   line item is attributed to a NAMED workload. `medium` — at least one
//   contributing line item is attributed by ALLOCATION RULE rather than
//   directly. `low` — any contributing line item is ESTIMATED FROM A SAMPLED
//   RATE. Rendered as the word, never as a percentage: a percentage invites
//   arithmetic on a grade that has none. The bundled figure is `medium` — the
//   workload is named, but its cost is priced by applying the published rate
//   card to counted requests rather than read off an invoice line.
//
// * PROVENANCE. A short human-readable string naming the source of record and
//   its as-of date, e.g. "billing export, as of 2026-08-01". EVERY number shown
//   at the front door carries one, including each destination's own metric. A
//   figure with no provenance does not ship.
//
// * MATERIAL METRIC (per destination). The single figure that would change a
//   leader's decision about that destination, with its own unit and its own
//   provenance. Exactly one per destination. If a destination needs two numbers
//   to be understood it is two destinations, or it is not a destination.
//
// * PRIORITIZED NEXT ACTION. The action with the highest recoverable spend per
//   unit of effort among CURRENTLY ACTIONABLE items, where a destination is
//   actionable when its action addresses positive recoverable spend
//   (`recoverableUsd > 0`) and carries a positive effort estimate
//   (`effortDays > 0`). Ties break on the smaller `effortDays`, then on `slug`,
//   so the ordering is total and reproducible. Exactly one entry in the
//   registry carries `prioritized: true`, and `prioritizedSlug()` recomputes it
//   from the rule rather than reading the flag — the test asserts the two
//   agree, so a flag moved by hand without the numbers behind it fails.
//
// ---------------------------------------------------------------------------
// WHAT THIS REGION DELIBERATELY DOES NOT DO
// ---------------------------------------------------------------------------
//
// It states no second question at headline weight. Each destination's question
// is a subordinate label INSIDE that destination's own link, read after its
// name, which is the demotion the front door is for: three peers each asking a
// headline question is three competing answers.
//
// It repeats no disclaimer. The synthetic-data boundary is stated once, in the
// figure line, and nowhere else in this region.
//
// It ranks three destinations and will never rank more than four. A fourth is
// the ceiling and a fifth is a menu.

// The one interrogative sentence at the top of the page, and the id of the
// heading that carries it. #1325 asked for "How much of our AI spend can we
// recover this quarter?" and the window is deliberately NOT in the question:
// the figure the page states directly beside this heading is the annual form of
// the same lever ($62,400), contracted by the answer block, the seed and half a
// dozen tests. A question about the quarter answered by an annual number is the
// defect the front door exists to remove, so the window lives on the figure it
// qualifies — see the quarter figure below — and the question stays the one the
// page can honestly answer where it is asked. It also lost its second clause:
// "and where do we start?" is now answered by the destinations below rather
// than by a heading that asked two things at once.
export const FRONT_DOOR_QUESTION = "How much of our AI spend can we recover?";

/** The heading in src/evolution.html that carries that question. */
export const FRONT_DOOR_QUESTION_ID = "finops-recoverable-question";

/** The three confidence levels. There is no fourth. */
export const CONFIDENCE_LEVELS = Object.freeze(["high", "medium", "low"]);

/**
 * Why each level is the level, in the reader's words rather than the rubric's
 * (#1327). The grade ships as a WORD beside its reason, never as a hue: a
 * confidence a reader can only get from a colour is a confidence a colour-blind
 * reader, a printout, and a screen reader all lose. Rendered into the
 * `Confidence` row of the front door's evidence list, so the level and the
 * sentence that earns it are read together.
 */
export const CONFIDENCE_BASIS = Object.freeze({
  high: "every contributing line item is attributed to a named workload",
  medium: "at least one contributing line item is attributed by allocation rule rather than read off an invoice line",
  low: "at least one contributing line item is estimated from a sampled rate",
});

/**
 * The four states the front-door finding can be in. `ready` is the one the
 * document ships and the only one with a live number in it; the other three are
 * drawn rather than assumed, because a front door that only has a good state
 * has three states nobody designed.
 */
export const FRONT_DOOR_STATES = Object.freeze(["ready", "loading", "empty", "error"]);

/** At most four destinations ever rank here. */
export const DESTINATION_CEILING = 4;

/**
 * The front-door content: the question, the one number with its confidence and
 * provenance, the synthetic-data boundary said once, and the slug of the one
 * prioritized action.
 */
export const FINOPS_FRONT_DOOR = Object.freeze({
  question: FRONT_DOOR_QUESTION,
  figure: Object.freeze({
    label: "Recoverable spend this quarter",
    valueUsd: 15_600,
    display: "$16k",
    confidence: "medium",
    provenance: "bundled synthetic example, as of 2026-07-01",
  }),
  boundary: "All figures are synthetic demo data.",
  prioritizedSlug: "optimisation-levers",
  // THE HONEST NON-EMPTY STATE (the pattern #1331 landed for the counted-PR
  // block, reused rather than reinvented). When there is no fresh figure the
  // region shows the last real one WITH the date it was taken and says in words
  // that it is not a new measurement — a dash, a spinner or an empty box all
  // tell a reader less than a stale number that admits to being stale.
  lastMeasured: Object.freeze({ display: "$16k", takenAt: "2026-07-01" }),
});

/**
 * The reporting windows a destination may be read at. Two, because the page has
 * two: the month its analyzed figure is stated over, and the quarter the
 * recoverable figure at the front door is stated over. A destination declares
 * which of them it carries; one that declares neither cannot be addressed at a
 * window at all, and saying so is the point.
 */
export const FINOPS_SCOPES = Object.freeze(["month", "quarter"]);

/**
 * The department identifiers the bundled analysis actually holds. Written here
 * because this module is the registry, and pinned against
 * src/evolution-demo-data.json in tests/finops-destinations.test.js so the two
 * cannot drift — a route that addresses a department the seed does not contain
 * is a link to an empty drill-down.
 */
export const FINOPS_DEPARTMENT_IDS = Object.freeze([
  "data-ml", "backend", "frontend", "sre", "mobile", "quality", "security",
]);

/** A destination that carries no addressable qualifier of either kind. */
const NO_QUALIFIERS = Object.freeze({
  scopes: Object.freeze([]),
  departments: Object.freeze([]),
});

/**
 * The ordered destinations. `slug` is a contract: later routing, sharing and
 * provenance work reads these strings, so a rename must be a visible diff in
 * tests/finops-destinations.test.js rather than a silent break.
 *
 * `route` is the other half of that contract, added for #1326: it declares what
 * an ADDRESS for this destination is allowed to say beyond its name. Every
 * value src/destination-route.js will accept on `?scope=` or `?department=` is
 * enumerated here and nowhere else, so a qualifier that means nothing at a
 * destination is dropped from the URL rather than carried around as junk. An
 * empty list is a deliberate statement — "this destination is not read per
 * department" — and not an omission.
 */
export const FINOPS_DESTINATIONS = Object.freeze([
  Object.freeze({
    slug: "spend-attribution",
    name: "Spend attribution",
    question: "Where is the money going?",
    href: "#finops-stand",
    metric: Object.freeze({
      label: "Analyzed AI spend in the reporting month",
      value: 154_500,
      unit: "USD",
      display: "$154,500",
      provenance: "bundled synthetic example, as of 2026-07-01",
    }),
    nextAction: "Read the department breakdown behind the analyzed figure",
    // Attribution recovers nothing on its own: it tells a leader which
    // workloads the recoverable figure is attributed to. Zero, not a small
    // number, so it can never win the ranking by rounding.
    recoverableUsd: 0,
    effortDays: 2,
    prioritized: false,
    // The one destination that is read per department: it IS the breakdown, and
    // the page ranks the same seven identifiers the seed carries.
    route: Object.freeze({
      scopes: FINOPS_SCOPES,
      departments: FINOPS_DEPARTMENT_IDS,
    }),
  }),
  Object.freeze({
    slug: "optimisation-levers",
    name: "Optimisation levers",
    question: "What can we change?",
    href: "/savings-action-center.html",
    metric: Object.freeze({
      label: "Monthly saving from the highest-ranked lever",
      value: 5_200,
      unit: "USD per month",
      display: "$5,200 / month",
      provenance: "bundled synthetic example, as of 2026-07-01",
    }),
    nextAction: "Move Atlas Platform's short, low-context requests to the standard model",
    recoverableUsd: 15_600,
    effortDays: 3,
    prioritized: true,
    // Levers are ranked org-wide and priced at either window; the slate is not
    // a per-department view, so `?department=` means nothing here.
    route: Object.freeze({
      scopes: FINOPS_SCOPES,
      departments: Object.freeze([]),
    }),
  }),
  Object.freeze({
    slug: "commitment-coverage",
    name: "Commitment coverage",
    question: "Are we paying list price for steady-state load?",
    href: "/savings-commitment.html",
    metric: Object.freeze({
      label: "Share of the quarter's analyzed spend priced at published list rates",
      value: 100,
      unit: "percent",
      display: "100%",
      provenance: "published rate card, as of 2026-07-01",
    }),
    nextAction: "Declare contracted rates for the premium and standard text tiers",
    // Declaring contracted rates moves the CONFIDENCE of the figure above, not
    // the figure. It recovers no spend by itself, so it is not actionable under
    // the prioritization rule even though it is the cheapest thing to do.
    recoverableUsd: 0,
    effortDays: 20,
    prioritized: false,
    // Coverage is a quarter question — a month of steady-state load says
    // nothing about whether a commitment is worth signing — and it is not read
    // per department. Both facts are declared, so `?scope=month` here is
    // dropped and reported rather than honoured.
    route: NO_QUALIFIERS,
  }),
]);

/** The prioritized destination record, read from the flag. */
export const prioritizedDestination = () =>
  FINOPS_DESTINATIONS.find((destination) => destination.prioritized) ?? null;

/**
 * Recompute the prioritized slug from the rule stated above, rather than from
 * the flag. Null when nothing is currently actionable — which is an honest
 * front door with no recommendation, not a front door that promotes the least
 * bad option.
 */
export function prioritizedSlug(destinations = FINOPS_DESTINATIONS) {
  const actionable = destinations.filter(
    (destination) => destination.recoverableUsd > 0 && destination.effortDays > 0,
  );
  if (!actionable.length) return null;
  const ranked = [...actionable].sort((a, b) => {
    const rate = (b.recoverableUsd / b.effortDays) - (a.recoverableUsd / a.effortDays);
    if (rate !== 0) return rate;
    if (a.effortDays !== b.effortDays) return a.effortDays - b.effortDays;
    return a.slug < b.slug ? -1 : 1;
  });
  return ranked[0].slug;
}

const escape = (text) => String(text)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Format recoverable spend for the headline slot, at any magnitude (#1327).
 *
 * THIS IS THE LAYOUT DEFENCE, not a stylesheet rule. A figure region survives an
 * implausible number by never being handed one: every value collapses to at most
 * `-$999.9B` — twelve characters — so the largest thing this slot can ever be
 * asked to draw is one short line, and a negative figure keeps its sign where a
 * reader meets it first rather than losing it to a truncation. Rounded once,
 * after the arithmetic, at the unit it is displayed in.
 */
export function formatRecoverableUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  const sign = number < 0 ? "-" : "";
  const size = Math.abs(number);
  if (size >= 1e9) return `${sign}$${(size / 1e9).toFixed(1)}B`;
  if (size >= 1e6) return `${sign}$${(size / 1e6).toFixed(1)}M`;
  if (size >= 1e3) return `${sign}$${Math.round(size / 1e3)}k`;
  return `${sign}$${Math.round(size)}`;
}

/**
 * The finding, in whichever state the page is in.
 *
 * The contract every state keeps: a LABEL naming what the slot holds, a
 * non-blank VALUE, and a NOTE that says in words why the value is what it is.
 * `available` is false in every state but `ready`, which is what marks the
 * figure as not-a-fresh-measurement in the shipped `.stand-figure-value`
 * treatment — dashed rule, warning ink, smaller type — beside the words that
 * say the same thing. Colour never carries it alone.
 */
export function frontDoorFinding(front = FINOPS_FRONT_DOOR, state = "ready") {
  const label = front.figure.label;
  const last = front.lastMeasured ?? null;
  const carried = last ? `Last measured ${last.display}, taken ${last.takenAt}.` : "";
  const stale = last ? last.display : null;
  if (state === "loading") {
    return Object.freeze({
      state, label, available: false, display: stale ?? "Measuring…",
      note: last
        ? `${carried} That figure is on screen while the current period is recomputed; it is not a new number.`
        : "Nothing measured yet: the analysis behind this figure is still being read.",
    });
  }
  if (state === "empty") {
    return Object.freeze({
      state, label, available: false, display: stale ?? "Nothing measured yet",
      note: last
        ? `${carried} No workload in the current period is addressable by a shipped lever, so nothing newer has been measured.`
        : "No workload here is addressable by a shipped lever yet. Import a provider export and this figure is measured from it.",
    });
  }
  if (state === "error") {
    return Object.freeze({
      state, label, available: false, display: stale ?? "Unavailable",
      note: `${carried || "No figure has ever been measured here."} The source of record could not be read this time, so no new figure was computed.`,
    });
  }
  return Object.freeze({
    state: "ready", label, available: true, display: front.figure.display, note: "",
  });
}

/**
 * The three things a reader needs BESIDE the number, each a labelled row rather
 * than a clause in a sentence: what acting on it is worth, how far to trust it,
 * and whose numbers it is. Every one carries a visible term and a visible value.
 */
export function frontDoorEvidence(front = FINOPS_FRONT_DOOR, destinations = FINOPS_DESTINATIONS) {
  const winner = destinations.find((destination) => destination.prioritized) ?? null;
  const { figure, boundary } = front;
  return Object.freeze([
    Object.freeze({
      term: "Impact",
      detail: winner
        ? `${winner.metric.label}: ${winner.metric.display}. That lever is what the figure above is recoverable through.`
        : "Nothing currently actionable addresses this figure, so acting changes nothing yet.",
    }),
    Object.freeze({
      term: "Confidence",
      detail: `${figure.confidence} — ${CONFIDENCE_BASIS[figure.confidence] ?? "no rubric states this level"}.`,
    }),
    Object.freeze({ term: "Provenance", detail: `${figure.provenance}. ${boundary}` }),
  ]);
}

/**
 * One destination's material metric, with its own source. The question it
 * answers is NOT in here any more (#1327): the question is the door's visible
 * label, read where a reader chooses, and repeating it in the working would be
 * the same sentence twice on one screen.
 */
export const destinationStateText = (destination) =>
  `${destination.metric.label}: ${destination.metric.display} · ${destination.metric.provenance}`;

/** The working behind the number, and the source under each destination. */
export const frontDoorWorking = (front = FINOPS_FRONT_DOOR, destinations = FINOPS_DESTINATIONS) =>
  Object.freeze([
    Object.freeze({
      term: `How ${front.figure.display} was computed`,
      detail: `${front.figure.label} sums the quarter-to-date cost of every workload flagged as addressable by at least one shipped lever. One qualifies, at $5,200 a month: 5,200 x 3 = 15,600, rounded once after the arithmetic and shown as ${front.figure.display}. It is a subset of spend, never a projection, and never spend already recovered.`,
    }),
    ...destinations.map((destination) => Object.freeze({
      term: destination.name,
      detail: destinationStateText(destination),
    })),
  ]);

/**
 * The front-door region, rendered. `indent` is the leading whitespace of the
 * opening tag in the document, so the returned string can be compared with the
 * authored markup without normalising anything away.
 *
 * ---------------------------------------------------------------------------
 * THE READING ORDER (#1327), and it is the DOM order, so the eye and the tab key
 * agree with each other and with a screen reader:
 *
 *   1. THE FINDING — the label and the one number, in `.stand-figure` /
 *      `.stand-figure-value`, the page's largest figure role. It was a clause in
 *      a body-weight sentence; the sentence made a reader parse before they
 *      could read.
 *   2. THE EVIDENCE — Impact, Confidence and Provenance as three labelled rows
 *      of a description list, each with a visible term and a visible value.
 *      Confidence is the WORD plus the rubric line that earns it, never a hue.
 *   3. THE ACTION — the one prioritized destination, and it is the only filled
 *      control in the region. Per the Claude Design foundations card, a filled
 *      wash is a dynamic signal and an outline is a static classification: the
 *      recommendation is the signal, the other two doors are classifications, so
 *      the three stop competing at one weight.
 *   4. THE WORKING — the arithmetic behind the number and each destination's own
 *      material metric and source, behind a native `details`. Keyboard-operable
 *      with no script, and NOTHING LIVE GOES IN: `destination-route-view.js`
 *      inserts its `role="status"` paragraph as this region's first child,
 *      outside the disclosure, because a live region folded into a shut
 *      disclosure is silent for the reader and invisible to a harness that
 *      reads through it.
 *
 * THE DOORS ARE A NAMED `nav` LANDMARK, so a screen-reader user reaches the
 * three destinations by landmark instead of walking the document to find them —
 * and it costs no tab stop at all, because the doors were already the links.
 *
 * There is still no heading here: the region carries an eyebrow label and names
 * itself through `aria-labelledby`, because a heading would be a second question
 * at headline weight directly under the page's one question.
 */
export function frontDoorMarkup(indent = "      ", front = FINOPS_FRONT_DOOR, destinations = FINOPS_DESTINATIONS) {
  const pad = (depth) => `${indent}${"  ".repeat(depth)}`;
  const finding = frontDoorFinding(front, "ready");
  const row = (entry, depth) =>
    `${pad(depth)}<div><dt>${escape(entry.term)}</dt><dd>${escape(entry.detail)}</dd></div>`;
  const items = destinations.map((destination) => {
    const attributes = [
      `class="${destination.prioritized ? "stand-action" : "workspace-dest"}"`,
      `href="${destination.href}"`,
      `data-front-door-slug="${destination.slug}"`,
      `data-front-door-prioritized="${destination.prioritized ? "true" : "false"}"`,
    ].join(" ");
    const recommended = destination.prioritized
      ? '<span class="workspace-dest-state">Recommended first</span>' : "";
    return `${pad(3)}<li class="workspace-nav-item"><a ${attributes}>`
      + `<strong class="workspace-dest-name">${escape(destination.name)}</strong> `
      + `<span class="front-door-question">${escape(destination.question)}</span>`
      + `${recommended}</a></li>`;
  });
  return [
    `${indent}<section class="finops-front-door" id="finops-front-door" data-subordinate="true" data-workspace-frame="true" data-state="${finding.state}" aria-labelledby="finops-front-door-label">`,
    `${pad(1)}<p class="eyebrow" id="finops-front-door-label">Where to go next · ${destinations.length} destinations</p>`,
    `${pad(1)}<p class="stand-figure" id="finops-front-door-figure"><span class="stand-figure-label" id="finops-front-door-figure-label">${escape(finding.label)}</span> <span class="stand-figure-value" id="finops-front-door-value" data-available="${finding.available}">${escape(finding.display)}</span> <span class="stand-figure-basis" id="finops-front-door-note" hidden>${escape(finding.note)}</span></p>`,
    `${pad(1)}<dl class="figure-source-detail" id="finops-front-door-evidence">`,
    ...frontDoorEvidence(front, destinations).map((entry) => row(entry, 2)),
    `${pad(1)}</dl>`,
    `${pad(1)}<nav class="finops-front-door-nav" id="finops-front-door-nav" aria-label="Destinations">`,
    `${pad(2)}<ol class="workspace-nav-list" id="finops-front-door-list">`,
    ...items,
    `${pad(2)}</ol>`,
    `${pad(1)}</nav>`,
    `${pad(1)}<details class="figure-source" id="finops-front-door-working" data-source="derived" data-disclosure="collapsed">`,
    `${pad(2)}<summary class="figure-source-summary" id="finops-front-door-working-summary" aria-expanded="false" aria-controls="finops-front-door-working-detail"><span class="figure-source-state" data-disclosure="collapsed"><span class="figure-source-shape" aria-hidden="true">▸</span> Show the working behind ${escape(front.figure.display)} and each destination's own figure</span></summary>`,
    `${pad(2)}<dl class="figure-source-detail" id="finops-front-door-working-detail">`,
    ...frontDoorWorking(front, destinations).map((entry) => row(entry, 3)),
    `${pad(2)}</dl>`,
    `${pad(1)}</details>`,
    `${indent}</section>`,
  ].join("\n");
}

/**
 * Repaint the front door from the registry. The document already ships the same
 * markup, so this changes nothing on an ordinary open — it is what makes the
 * page render FROM the data rather than merely agree with it, and it is the
 * path a later change to the registry travels without an edit to the document.
 *
 * It never throws on a page that does not carry the region.
 */
export function applyFinopsFrontDoor(
  document, front = FINOPS_FRONT_DOOR, destinations = FINOPS_DESTINATIONS, state = "ready",
) {
  applyFrontDoorState(document, front, state);
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
  rows(document?.getElementById?.("finops-front-door-evidence"),
    frontDoorEvidence(front, destinations));
  rows(document?.getElementById?.("finops-front-door-working-detail"),
    frontDoorWorking(front, destinations));

  const list = document?.getElementById?.("finops-front-door-list");
  if (!list) return false;
  for (const item of [...(list.querySelectorAll?.("[data-front-door-slug]") ?? [])]) {
    const destination = destinations.find(
      (entry) => entry.slug === item.dataset?.frontDoorSlug,
    );
    if (!destination) continue;
    item.setAttribute("href", destination.href);
    item.setAttribute("data-front-door-prioritized", destination.prioritized ? "true" : "false");
    // The recommendation is the one filled control; every other door keeps the
    // outline silhouette. The class moves with the flag so a re-ranked registry
    // cannot leave two doors promoted.
    item.className = destination.prioritized ? "stand-action" : "workspace-dest";
    const name = item.querySelector?.("strong");
    if (name) name.textContent = destination.name;
    const question = item.querySelector?.(".front-door-question");
    if (question) question.textContent = destination.question;
  }
  return true;
}

/**
 * Paint one of the four states into the finding slot.
 *
 * Three channels carry it and a reader needs any one of them: the words in the
 * note, the `data-available` treatment on the value, and `data-state` on the
 * region for anything downstream that reads it. The note is unhidden the moment
 * it has something to say and hidden again when it does not, so no state leaves
 * an empty paragraph behind — and no state leaves a bare blank where a number
 * was.
 */
export function applyFrontDoorState(document, front = FINOPS_FRONT_DOOR, state = "ready") {
  const finding = frontDoorFinding(front, state);
  const region = document?.getElementById?.("finops-front-door");
  region?.setAttribute?.("data-state", finding.state);
  const label = document?.getElementById?.("finops-front-door-figure-label");
  if (label) label.textContent = finding.label;
  const value = document?.getElementById?.("finops-front-door-value");
  if (value) {
    value.textContent = finding.display;
    value.setAttribute("data-available", finding.available ? "true" : "false");
  }
  const note = document?.getElementById?.("finops-front-door-note");
  if (note) {
    note.textContent = finding.note;
    note.hidden = finding.note === "";
  }
  return finding;
}

/**
 * Mirror the disclosure's own `open` onto the state channels — the same binding
 * every other disclosure on this page uses. Nothing here intercepts a key: the
 * `<summary>` is the control, Enter and Space stay the browser's, and this only
 * reflects what the browser already did.
 */
export function bindFrontDoorWorking(document) {
  const host = document?.getElementById?.("finops-front-door-working");
  if (!host) return null;
  host.addEventListener?.("toggle", () => {
    const open = Boolean(host.open ?? host.hasAttribute?.("open"));
    host.setAttribute("data-disclosure", open ? "expanded" : "collapsed");
    const summary = document.getElementById("finops-front-door-working-summary");
    summary?.setAttribute?.("aria-expanded", open ? "true" : "false");
    const state = summary?.querySelector?.(".figure-source-state");
    state?.setAttribute?.("data-disclosure", open ? "expanded" : "collapsed");
  });
  return host;
}
