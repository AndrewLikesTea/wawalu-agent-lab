// Which figures in the bundled example brief were READ, which were COMPUTED,
// and which are NOT IN THE FILES AT ALL (#1025).
//
// THE PROBLEM THIS SOLVES. `#finops-first-run` on /evolution.html publishes
// eight figures — a recoverable share, a routing scenario, a peer band, an
// internal gap, a literacy letter, a ranked action, an accountable role, and a
// confidence score. A finance lead reading it cannot tell which of those eight
// came out of the example's own export files and which the page worked out on
// their behalf. The distinction decides what they can quote: a column you can
// point at survives a challenge from the person who exported it, and a modelled
// ceiling does not. Today they would have to reopen the CSV to find out, and for
// the accountable role they would reopen it and find nothing, because no column
// in these files carries an owner.
//
// So every published figure in that region declares one of three states:
//
//   direct   read straight out of the example's export files
//   derived  computed or modelled by this page from what the files carry
//   missing  not in the files and not derivable from them
//
// DIRECT CARRIES NO CHIP, DELIBERATELY. Eight figures with a chip on each is
// eight chips a reader has to *read past* to reach the numbers, and the brief's
// reading order — one question, one material metric, one next action — is the
// thing this page has spent the most work protecting. The absence is not left to
// be inferred: `FIGURE_SOURCE_LEGEND` states the convention in one caption-sized
// line directly above the first marked figure, and it names what IS direct here
// so "unmarked" is a claim rather than a gap. A figure with no marker and no
// legend beside it would be exactly the ambiguity this issue is about.
//
// COLOUR IS NEVER THE CARRIER, and no new one is introduced. The two marked
// states reuse the `.brief-provenance` chip that `finops-brief-provenance.js`
// already ships for the imported brief, on its own silhouettes:
//
//   derived  SOLID OUTLINE  + the words "Derived here"
//   missing  DASHED OUTLINE + the words "Not in these files"
//
// which is the Claude Design foundations rule ("filled wash = dynamic signal,
// outline = static classification") applied unchanged: where a figure came from
// is a classification of the figure, not a reading that moves. The filled wash
// stays reserved for `FIGURE_SOURCE.file`, which means "computed from the file
// this reader brought" — a state the bundled example can never be in. Solid
// against dashed is the non-colour channel, the words are the whole meaning on
// their own, and the tint is third.
//
// ONE VALUE, ONE STATUS, STATED ONCE. This table covers the bundled example
// region and nothing else. `#finops-brief-completeness` and
// `#finops-stand-withheld` are scoped to the reader's OWN import — the
// completeness score walks the slots a dropped export did or did not satisfy,
// and the withheld surface names the attribute an import is missing — so no
// count on either surface describes a figure in this table, and nothing here
// changes what they say. See the PR body for the walk.
//
// No clock, no storage, no request, and no arithmetic: the states below are
// declared facts about the example's derivation, and the figures themselves stay
// owned by `finops-first-run.js`.

import { FIGURE_SOURCE, PROVENANCE_MARKERS } from "./finops-brief-provenance.js";

/** Bump when a state, a marker word, or what one means changes. */
export const EXAMPLE_FIGURE_SOURCE_VERSION = "finops-example-figure-sources/1.0.0";

/** The three states. There is no fourth, and "unknown" is not one of them. */
export const EXAMPLE_SOURCE = Object.freeze({
  direct: "direct",
  derived: "derived",
  missing: "missing",
});

/**
 * The marker per state.
 *
 * `silhouette` and `tone` are the values `.brief-provenance` already styles, so
 * this table introduces no rule of its own — `outline`/`neutral` and
 * `dashed`/`warn` are the two the imported brief's `reader` and `fallback`
 * states ship on, and `tests/evolution-figure-sources.test.js` fails if either
 * pair drifts away from what `PROVENANCE_MARKERS` publishes.
 *
 * `direct` has no chip. Its entry is here so the state is a first-class member
 * of the vocabulary rather than a hole, and so a surface that ever wants to draw
 * it has the words waiting.
 */
export const EXAMPLE_SOURCE_MARKERS = Object.freeze({
  [EXAMPLE_SOURCE.direct]: Object.freeze({
    source: EXAMPLE_SOURCE.direct,
    label: "Read from the files",
    marked: false,
    silhouette: null,
    tone: null,
  }),
  [EXAMPLE_SOURCE.derived]: Object.freeze({
    source: EXAMPLE_SOURCE.derived,
    label: "Derived here",
    marked: true,
    silhouette: PROVENANCE_MARKERS[FIGURE_SOURCE.reader].silhouette,
    tone: PROVENANCE_MARKERS[FIGURE_SOURCE.reader].tone,
  }),
  [EXAMPLE_SOURCE.missing]: Object.freeze({
    source: EXAMPLE_SOURCE.missing,
    label: "Not in these files",
    marked: true,
    silhouette: PROVENANCE_MARKERS[FIGURE_SOURCE.fallback].silhouette,
    tone: PROVENANCE_MARKERS[FIGURE_SOURCE.fallback].tone,
  }),
});

/**
 * The marker for one state. An unknown state reads as the absence, never as a
 * reading: labelling something "read from the files" on a guess is the one error
 * this marker is not allowed to make.
 */
export const exampleSourceMarker = (source) =>
  EXAMPLE_SOURCE_MARKERS[source] ?? EXAMPLE_SOURCE_MARKERS[EXAMPLE_SOURCE.missing];

/**
 * The convention, in one line, above the first marked figure.
 *
 * It names what is unmarked rather than only saying that unmarked exists — a
 * legend that says "unmarked means direct" and stops leaves a reader guessing
 * which of the words on screen that covers.
 */
export const FIGURE_SOURCE_LEGEND =
  "Where each figure came from: unmarked values — the department names, the"
  + " reporting period, and the record counts — are read straight out of the"
  + " example's export files. Every marked figure below says whether this page"
  + " derived it or could not find it, and opens to show the working.";

/** The visible words on the control that opens one marker. */
export const FIGURE_SOURCE_DISCLOSURE = Object.freeze({
  collapsed: "Show working",
  expanded: "Hide working",
  shape: "▸",
});

/** The two terms every marker discloses, in this order. Never one without the other. */
export const FIGURE_SOURCE_TERMS = Object.freeze({
  origin: "Where this came from",
  decision: "What it moves",
});

/**
 * EVERY PUBLISHED FIGURE IN THE BUNDLED EXAMPLE REGION, with its state.
 *
 * `host` is the id of the authored slot the marker is painted into; it sits
 * immediately after the figure it qualifies, so the tab order and the reading
 * order are the same order and no marker is reachable before its number.
 *
 * `qualifies` is the figure's own visible label and `value` its own visible
 * figure. Both travel into the marker's accessible name, because "Derived here"
 * heard three stops after the number it belongs to is noise — a screen-reader
 * user landing on the chip is told which figure it is about and what that figure
 * says before they are told anything else.
 *
 * `origin` is the column, the record set, or the rule. `decision` is the one
 * plain sentence saying what the figure moves — not a restatement of it.
 */
export const EXAMPLE_FIGURE_SOURCES = Object.freeze([
  Object.freeze({
    id: "answer",
    host: "finops-first-run-answer-source",
    qualifies: "The answer",
    value: "33% of analyzed AI spend is recoverable AI spend",
    source: EXAMPLE_SOURCE.derived,
    origin: "A ratio this page computes: $51,254 of recoverable spend over"
      + " $154,500 of analyzed spend, both summed from the 15 invented usage"
      + " records, then rounded once to a whole percent. No column in the"
      + " example's files carries a recoverable share.",
    decision: "It sizes the prize before anyone commits time to it. A share this"
      + " large is worth a pilot; the same share of a tenth of the spend is not.",
  }),
  Object.freeze({
    id: "benchmark",
    host: "finops-first-run-benchmark-source",
    qualifies: "Potentially recoverable share",
    value: "33% of analyzed AI spend",
    source: EXAMPLE_SOURCE.derived,
    origin: "The same ratio as the answer above, shown against the figures it"
      + " divides. The $154,500 denominator is the sum of the cost column across"
      + " all five invented departments for 2026-06-01 to 2026-07-01; the"
      + " $51,254 numerator is scored per department by the published"
      + " recoverability rule, not read from any column.",
    decision: "It is the number to hold your own export's share against. If"
      + " yours comes back far lower, the ceiling below is smaller too.",
  }),
  Object.freeze({
    id: "impact",
    host: "finops-first-run-impact-source",
    qualifies: "Potential impact · routing scenario",
    value: "$51,254 in the reporting period",
    source: EXAMPLE_SOURCE.derived,
    origin: "A modelled routing scenario, not an invoice line. Each department's"
      + " baseline spend is multiplied by its normalized waste share and that"
      + " category's recoverable share, then rounded once — the arithmetic the"
      + " example data publishes beside every department.",
    decision: "It is the ceiling on what re-routing could return, so it caps"
      + " what the pilot is allowed to cost before it stops being worth running.",
  }),
  Object.freeze({
    id: "peer",
    host: "finops-first-run-peer-source",
    qualifies: "Rank against similar organizations",
    value: "Bottom quartile · $38.63 per successful task",
    source: EXAMPLE_SOURCE.derived,
    origin: "$38.63 is analyzed spend divided by the successful-task count in"
      + " the same invented records. The quartile it lands in is read off"
      + " hand-authored synthetic cohort boundaries — those boundaries are not"
      + " in the example's export files and no reader's export contains them"
      + " either.",
    decision: "A bottom-quartile cost per task says the problem is efficiency"
      + " rather than volume, which is what makes routing the first move instead"
      + " of a headcount conversation.",
  }),
  Object.freeze({
    id: "internal",
    host: "finops-first-run-internal-source",
    qualifies: "Internal drill-down · widest department gap",
    value: "Atlas Platform is a full band behind Boreal Support",
    source: EXAMPLE_SOURCE.derived,
    origin: "Both department names are read straight from the files. The gap"
      + " between them is computed: cost per successful task per department,"
      + " placed on the same band boundaries as the peer position above, and the"
      + " widest surviving pair is the one named.",
    decision: "It names the department to pilot in. A gap inside your own"
      + " organization is one you can act on this month without waiting for a"
      + " cohort to agree with you.",
  }),
  Object.freeze({
    id: "literacy",
    host: "finops-first-run-literacy-source",
    qualifies: "AI literacy · graded prompt sample",
    value: "B · 85 of 100 · literacy-mix/1.0.0",
    source: EXAMPLE_SOURCE.derived,
    origin: "141 of 144 invented prompts were classified and scored by the"
      + " published literacy-mix rubric, then weighted by each department's"
      + " spend. The letter is the rubric's output; the $143,500 of $154,500"
      + " coverage figure beside it is the spend those scored departments"
      + " account for. Ember Studio carries no prompts in the corpus, so it is"
      + " outside both figures.",
    decision: "It says whether the spend is being wasted on how people ask"
      + " rather than on which model answers — a B over 93% of the budget means"
      + " routing, not training, is the cheaper first move.",
  }),
  Object.freeze({
    id: "role",
    host: "finops-first-run-role-source",
    qualifies: "Accountable role for the recommended action",
    value: "Platform Engineering Lead",
    source: EXAMPLE_SOURCE.missing,
    origin: "The example's export files carry no owner, team-lead, or"
      + " cost-centre column, so nobody accountable for Atlas Platform's spend"
      + " could be read out of them. \"Platform Engineering Lead\" is the role"
      + " this page assigns by rule to a routing pilot — it is not a person,"
      + " a title, or a mapping named anywhere in the data.",
    decision: "Nothing gets piloted until someone owns it. Check this role"
      + " against your own org chart before the meeting, because your export"
      + " will not fill it in either unless it carries an owner column.",
  }),
  Object.freeze({
    id: "confidence",
    host: "finops-first-run-confidence-source",
    qualifies: "Confidence in this answer",
    value: "0.85 of 1.00 · moderate",
    source: EXAMPLE_SOURCE.derived,
    origin: "Scored by this page, not read from anything: all 15 invented"
      + " records were analyzed, which is what holds the figure up, and the score"
      + " is then reduced because the routing call shape the recommendation"
      + " depends on could not be verified in the records.",
    decision: "It is the gap between quoting this number and standing behind it."
      + " At 0.85 the direction is safe to circulate; the exact dollar ceiling is"
      + " not, until the call shape is confirmed.",
  }),
]);

/**
 * The two hosts that sit OUTSIDE the containers the imported state hides.
 *
 * Six of the eight markers live inside `#finops-first-run-slots`,
 * `.first-run-support`, `#finops-first-run-recommendation`, or
 * `#finops-first-run-confidence`, so they are withheld with the figures they
 * qualify when a reader's own export supersedes the example. The headline
 * answer's marker and the legend are direct children of the region, and the
 * headline IS repainted with the reader's own drill-down — so a marker left
 * behind there would be describing the example's derivation over somebody
 * else's number. `finops-first-run-view.js` hides these two with the rest.
 */
export const EXAMPLE_ONLY_SOURCE_IDS = Object.freeze([
  "finops-first-run-answer-source",
  "finops-first-run-source-legend",
]);

/** One entry by id, or null. Nothing in this module is positional. */
export const exampleFigureSource = (id) =>
  EXAMPLE_FIGURE_SOURCES.find((entry) => entry.id === id) ?? null;

/** Every entry in one state, in the order the region publishes them. */
export const exampleFiguresInState = (source) =>
  EXAMPLE_FIGURE_SOURCES.filter((entry) => entry.source === source);

/**
 * What assistive technology reads on one marker's control: the figure, then what
 * it says, then the state, then the words on the control itself.
 *
 * The figure and its value come first because the marker is meaningless without
 * them — a reader who tabs onto "Not in these files" and is not told what is not
 * in them has been told nothing.
 */
export function figureSourceText(entry, { expanded = false } = {}) {
  const marker = exampleSourceMarker(entry?.source);
  const control = expanded
    ? FIGURE_SOURCE_DISCLOSURE.expanded : FIGURE_SOURCE_DISCLOSURE.collapsed;
  return [
    entry?.qualifies ? `${entry.qualifies},` : "",
    entry?.value ? `${entry.value}:` : "",
    marker.label, `· ${control}`,
  ].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// PAINTING. The markers are AUTHORED in evolution.html, with these exact words,
// so the provenance of a money figure survives a page whose script never ran —
// which for the one signal saying "we made this number up from other numbers" is
// not a nicety. What the functions below do is REPAINT them from this module, on
// the same principle the region's sample marker is repainted: the authored copy
// and the module's copy are the same sentence, and repainting is what proves it.
// A drift becomes a visible change on the page instead of two paragraphs nobody
// compared.

/** Build one marker's contents. The host is authored; only its children are ours. */
function markerParts(doc, entry) {
  const marker = exampleSourceMarker(entry.source);
  const chip = doc.createElement("span");
  chip.className = "brief-provenance";
  chip.dataset.provenance = marker.source;
  chip.dataset.silhouette = marker.silhouette;
  chip.dataset.tone = marker.tone;
  // The figure and its value, spoken but not drawn: a sighted reader already has
  // the label and the number two lines up, and a screen-reader user landing on
  // the chip does not.
  const scope = doc.createElement("span");
  scope.className = "visually-hidden";
  scope.textContent = `${entry.qualifies}, ${entry.value}: `;
  const label = doc.createElement("span");
  label.className = "brief-provenance-label";
  label.textContent = marker.label;
  chip.replaceChildren(scope, label);

  const state = doc.createElement("span");
  state.className = "figure-source-state";
  state.dataset.disclosure = "collapsed";
  const shape = doc.createElement("span");
  shape.className = "figure-source-shape";
  shape.setAttribute("aria-hidden", "true");
  shape.textContent = FIGURE_SOURCE_DISCLOSURE.shape;
  state.replaceChildren(shape, doc.createTextNode(` ${FIGURE_SOURCE_DISCLOSURE.collapsed}`));
  return [chip, state];
}

/** The two disclosed terms, built rather than assigned. */
function markerDetail(doc, entry) {
  const list = doc.createElement("dl");
  list.className = "figure-source-detail";
  list.id = `${entry.host}-detail`;
  for (const [term, detail] of [
    [FIGURE_SOURCE_TERMS.origin, entry.origin],
    [FIGURE_SOURCE_TERMS.decision, entry.decision],
  ]) {
    const item = doc.createElement("div");
    const dt = doc.createElement("dt");
    dt.textContent = term;
    const dd = doc.createElement("dd");
    dd.textContent = detail;
    item.append(dt, dd);
    list.append(item);
  }
  return list;
}

/**
 * Repaint every authored marker in the bundled example region.
 *
 * COLLAPSED IS THE DEFAULT AND STAYS THE DEFAULT. This never writes `open`: a
 * repaint that shut a disclosure the reader had opened would take the working
 * away from them mid-sentence, and one that opened eight would replace the
 * brief with its own footnotes.
 *
 * @returns the hosts it painted, so a caller can assert on what it asked for.
 */
export function applyExampleFigureSources(doc) {
  const painted = [];
  for (const entry of EXAMPLE_FIGURE_SOURCES) {
    const host = doc.getElementById?.(entry.host) ?? null;
    if (!host) continue;
    const summary = doc.createElement("summary");
    summary.className = "figure-source-summary";
    summary.id = `${entry.host}-summary`;
    summary.setAttribute("aria-expanded", host.open ? "true" : "false");
    summary.setAttribute("aria-controls", `${entry.host}-detail`);
    summary.replaceChildren(...markerParts(doc, entry));
    host.dataset.source = entry.source;
    host.dataset.disclosure = host.open ? "expanded" : "collapsed";
    host.replaceChildren(summary, markerDetail(doc, entry));
    painted.push(host);
  }
  return painted;
}

/**
 * Keep each marker's exposed state and its visible words in step with `open`.
 *
 * The native `summary` is the control, so Enter, Space, and the click are the
 * browser's and no key is intercepted here. `toggle` only mirrors what already
 * happened: `aria-expanded` on the control, `data-disclosure` on the element the
 * stylesheet keys off, and the one word that changes from Show to Hide.
 */
export function bindExampleFigureSources(doc) {
  const bound = [];
  for (const entry of EXAMPLE_FIGURE_SOURCES) {
    const host = doc.getElementById?.(entry.host) ?? null;
    if (!host) continue;
    const sync = () => {
      const open = Boolean(host.open);
      host.dataset.disclosure = open ? "expanded" : "collapsed";
      const summary = host.querySelector?.("summary");
      if (summary) summary.setAttribute("aria-expanded", open ? "true" : "false");
      const state = host.querySelector?.(".figure-source-state");
      if (!state) return;
      state.dataset.disclosure = open ? "expanded" : "collapsed";
      const shape = state.querySelector?.(".figure-source-shape");
      const word = open ? FIGURE_SOURCE_DISCLOSURE.expanded : FIGURE_SOURCE_DISCLOSURE.collapsed;
      if (shape) state.replaceChildren(shape, doc.createTextNode(` ${word}`));
    };
    host.addEventListener?.("toggle", sync);
    sync();
    bound.push(host);
  }
  return bound;
}
