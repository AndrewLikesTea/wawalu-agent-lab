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

/** The one sentence beside the question: the number, its grade, its source. */
export const frontDoorFigureText = ({ figure, boundary } = FINOPS_FRONT_DOOR) =>
  `${figure.label} ${figure.display} · Confidence: ${figure.confidence} · ${figure.provenance}. ${boundary}`;

/** One destination's subordinate line: the question it answers, then its metric. */
export const destinationStateText = (destination) =>
  `${destination.question} · ${destination.metric.label}: ${destination.metric.display} · ${destination.metric.provenance}`;

/**
 * The front-door region, rendered. `indent` is the leading whitespace of the
 * opening tag in the document, so the returned string can be compared with the
 * authored markup without normalising anything away.
 *
 * The classes are `.eyebrow`, `.stand-answer`, `.workspace-nav-list`,
 * `.workspace-nav-item`, `.workspace-dest`, `.workspace-dest-name` and
 * `.workspace-dest-state` — every one of them already shipped and styled on
 * this page. This region adds no rule to any stylesheet.
 *
 * There is no heading: the region carries an eyebrow label and names itself
 * through `aria-labelledby`, because a heading here would be a second question
 * at headline weight directly under the page's one question.
 */
export function frontDoorMarkup(indent = "      ", front = FINOPS_FRONT_DOOR, destinations = FINOPS_DESTINATIONS) {
  const pad = (depth) => `${indent}${"  ".repeat(depth)}`;
  const items = destinations.map((destination) => {
    const attributes = [
      'class="stand-action"',
      `href="${destination.href}"`,
      `data-front-door-slug="${destination.slug}"`,
      `data-front-door-prioritized="${destination.prioritized ? "true" : "false"}"`,
    ].join(" ");
    const recommended = destination.prioritized ? "<em>Recommended first</em>" : "";
    return `${pad(2)}<li class="workspace-nav-item"><a ${attributes}>`
      + `<strong>${escape(destination.name)}</strong> `
      + `<span>${escape(destinationStateText(destination))}</span>`
      + `${recommended}</a></li>`;
  });
  return [
    `${indent}<section class="finops-front-door" id="finops-front-door" data-subordinate="true" data-workspace-frame="true" aria-labelledby="finops-front-door-label">`,
    `${pad(1)}<p class="eyebrow" id="finops-front-door-label">Where to go next · ${destinations.length} destinations</p>`,
    `${pad(1)}<p class="stand-answer" id="finops-front-door-figure">${escape(frontDoorFigureText(front))}</p>`,
    `${pad(1)}<ol class="workspace-nav-list" id="finops-front-door-list">`,
    ...items,
    `${pad(1)}</ol>`,
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
export function applyFinopsFrontDoor(document, front = FINOPS_FRONT_DOOR, destinations = FINOPS_DESTINATIONS) {
  const figure = document?.getElementById?.("finops-front-door-figure");
  if (figure) figure.textContent = frontDoorFigureText(front);
  const list = document?.getElementById?.("finops-front-door-list");
  if (!list) return false;
  for (const item of [...(list.querySelectorAll?.("[data-front-door-slug]") ?? [])]) {
    const destination = destinations.find(
      (entry) => entry.slug === item.dataset?.frontDoorSlug,
    );
    if (!destination) continue;
    item.setAttribute("href", destination.href);
    item.setAttribute("data-front-door-prioritized", destination.prioritized ? "true" : "false");
    const name = item.querySelector?.("strong");
    if (name) name.textContent = destination.name;
    const state = item.querySelector?.("span");
    if (state) state.textContent = destinationStateText(destination);
  }
  return true;
}
