// The import-evidence surface (#931): the same findings, in the same reading
// order, on the import panel and on the review step.
//
// Four constraints this file exists to honour, each of them a way the panel
// could look right on a designer's screen and be unusable off it:
//
//  - ONE ORDER. Provider, confidence, benchmark, impact, provenance, action —
//    in the DOM, so it is also the focus order, the announcement order, and the
//    print order. FINDING_ORDER in import-evidence.js is the single declaration
//    of it and the parts are emitted by walking that array.
//  - NO MEANING IN COLOUR ALONE. Every chip carries a word and a glyph beside
//    its tint, and the confidence chip carries the number as well as the band
//    name, so "ambiguous" is legible as a figure to a reader who cannot see the
//    difference between the three washes.
//  - THE LIVE REGION IS NEVER INSIDE A DISCLOSURE. It is authored in
//    evolution.html, outside every details element and outside every container
//    that ships hidden. A folded-away status is not announced in a real browser
//    however readable a test harness finds it.
//  - EVERY STATE IS DRAWN. Loading, empty, partial, error and per-finding error
//    each paint words a reader can act on. A blank panel is not a state.

import {
  ANNOUNCEMENT_KIND, EVIDENCE_STATE, EVIDENCE_STATUS, FINDING_ORDER,
  announcementFor, orderFindings, summarizeImportEvidence,
} from "./import-evidence.js";

const node = (doc, tag, className, text) => {
  const created = doc.createElement(tag);
  if (className) created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
};

/** Label-then-value, so the value never arrives without the word that names it. */
const line = (doc, part, label, value, detail) => {
  const paragraph = node(doc, "p", "import-evidence-line");
  paragraph.dataset.part = part;
  paragraph.append(node(doc, "span", "import-evidence-label", label));
  if (value !== undefined) paragraph.append(value);
  if (detail) paragraph.append(node(doc, "span", "import-evidence-detail", detail));
  return paragraph;
};

/** A chip: tint, plus a word, plus a glyph, plus — where there is one — a number. */
function chip(doc, { kind, state, presentation, value }) {
  const wrap = node(doc, "span", "import-evidence-chip");
  wrap.dataset.chip = kind;
  wrap.dataset.state = state;
  wrap.dataset.shape = presentation.shape;
  wrap.dataset.silhouette = presentation.silhouette;
  // aria-hidden: the glyph is a second channel for the word beside it, and a
  // screen reader announcing "black circle Trusted 100 of 100" is noise.
  const shape = node(doc, "span", "import-evidence-chip-shape", presentation.shape);
  shape.setAttribute("aria-hidden", "true");
  wrap.append(shape, node(doc, "span", "import-evidence-chip-label", presentation.label));
  if (value) wrap.append(node(doc, "span", "import-evidence-chip-value", value));
  return wrap;
}

const listOf = (doc, className, entries) => {
  const list = node(doc, "ul", className);
  for (const entry of entries) {
    const item = node(doc, "li", null, `${entry.label} — ${entry.statement}`);
    item.dataset.signalId = entry.signalId;
    list.append(item);
  }
  return list;
};

/**
 * The supporting evidence, behind one native disclosure per finding.
 *
 * The summary names what is inside AND how much of it there is, so a reader
 * decides whether to open it without opening it. It is a real summary in a real
 * details element: keyboard operable, in the tab order, with no key handler of
 * ours to get wrong.
 */
function support(doc, finding, ids) {
  const details = node(doc, "details", "import-evidence-support");
  details.dataset.part = "provenance";
  const summary = node(doc, "summary", "import-evidence-support-summary",
    `Supporting evidence — ${finding.signals.count} matched signals, `
    + `${finding.reasons.count} reasons, ${finding.provenance.count} provenance rows`);
  summary.id = ids.summary;
  details.append(summary);
  const rows = node(doc, "dl", "import-evidence-provenance");
  for (const row of finding.provenance.rows) {
    rows.append(node(doc, "dt", null, row.label), node(doc, "dd", null, row.value));
  }
  details.append(node(doc, "p", "import-evidence-support-label", "Where this reading came from"), rows);
  if (finding.signals.count) {
    details.append(node(doc, "p", "import-evidence-support-label", "Recognition signals that matched"),
      listOf(doc, "import-evidence-signals", finding.signals.matched));
  }
  if (finding.reasons.count) {
    details.append(node(doc, "p", "import-evidence-support-label",
      finding.status === EVIDENCE_STATUS.TRUSTED
        ? "What did not count towards the score" : "Why this is not trusted"),
      listOf(doc, "import-evidence-reasons", finding.reasons.entries));
  }
  return details;
}

const findingIds = (rootId, finding) => ({
  item: `${rootId}-${finding.id}`,
  heading: `${rootId}-${finding.id}-provider`,
  summary: `${rootId}-${finding.id}-support`,
});

/** One finding, emitted by walking the declared reading order. */
function paintFinding(doc, finding, { rootId, level }) {
  const ids = findingIds(rootId, finding);
  const item = node(doc, "li", "import-evidence-finding");
  item.id = ids.item;
  item.dataset.status = finding.status;
  item.dataset.scale = finding.impact.scale;
  item.dataset.error = finding.error ? "true" : "false";
  item.setAttribute("aria-labelledby", ids.heading);
  const parts = {
    provider: () => {
      const heading = node(doc, `h${level}`, "import-evidence-provider");
      heading.id = ids.heading;
      heading.append(
        node(doc, "span", "import-evidence-provider-name", finding.provider.name),
        chip(doc, { kind: "source", state: "source", presentation: finding.source }),
      );
      return heading;
    },
    confidence: () => line(doc, "confidence", "Confidence",
      chip(doc, {
        kind: "status", state: finding.status, presentation: finding.presentation,
        // The number beside the band name: "ambiguous" is a word AND a figure,
        // so a reader who cannot tell the washes apart still sorts the list.
        value: finding.confidence.known ? finding.confidence.display : "not scored",
      }),
      finding.presentation.meaning),
    benchmark: () => line(doc, "benchmark", "Benchmark",
      node(doc, "span", "import-evidence-value", finding.benchmark.display),
      finding.benchmark.sentence),
    impact: () => {
      const paragraph = line(doc, "impact", "Impact",
        node(doc, "span", "import-evidence-figure", finding.impact.display),
        finding.impact.sentence);
      paragraph.className = "import-evidence-line import-evidence-impact";
      paragraph.dataset.scale = finding.impact.scale;
      // The unit, named rather than symbolised: a currency code is a cell of the
      // reader's file and no cell of it is painted here.
      paragraph.insertBefore(
        node(doc, "span", "import-evidence-unit", "in the export's own billing currency"),
        paragraph.lastChild);
      return paragraph;
    },
    provenance: () => support(doc, finding, ids),
    action: () => {
      const paragraph = line(doc, "action", "Do this next",
        node(doc, "span", "import-evidence-action-text", finding.action.sentence));
      paragraph.className = "import-evidence-line import-evidence-action";
      paragraph.dataset.required = finding.action.required ? "true" : "false";
      return paragraph;
    },
  };
  for (const part of FINDING_ORDER) item.append(parts[part]());
  if (finding.error) {
    const failure = node(doc, "p", "import-evidence-failure", finding.error.message);
    failure.dataset.part = "error";
    item.insertBefore(failure, item.children[1] ?? null);
  }
  return item;
}

const EMPTY_COPY = "No findings yet. Nothing here has been recognized as a provider export, "
  + "so there is nothing to compare and nothing to act on.";
// "Scoring", not "reading": #finops-load-state is the one region on this page
// that narrates a load, and a second slot saying the same thing competes with it.
const LOADING_COPY = "Scoring the selected exports. Each finding appears with its confidence, "
  + "the money it puts at stake, and one action.";

/**
 * Paints the whole surface into `rootId` and announces the outcome.
 *
 * @param rootId    the section that holds the list; it also carries the state.
 * @param findings  built by import-evidence.js. Order is re-derived here, so a
 *                  caller cannot accidentally paint them in arrival order.
 * @param level     heading level for each finding, so the surface nests under
 *                  whatever heading the host section already ships.
 */
export function renderImportEvidence(doc, rootId, { findings = [], loading = false, level = 4 } = {}) {
  const root = doc.getElementById(rootId);
  if (!root) return false;
  const list = doc.getElementById(`${rootId}-list`);
  const summaryLine = doc.getElementById(`${rootId}-summary`);
  const live = doc.getElementById(`${rootId}-live`);
  if (!list || !summaryLine) return false;

  const ordered = orderFindings(findings);
  const summary = summarizeImportEvidence(ordered, { loading });
  const announcement = announcementFor(summary, ordered);
  root.dataset.state = summary.state;
  root.dataset.findings = String(summary.counts.total);
  root.dataset.trusted = String(summary.counts.trusted);

  // What the reader has open survives the repaint: a list that closes every
  // disclosure on every paint takes the reader back to where they started.
  // Array.from, not the NodeList: a real browser's NodeList has no filter, and
  // the harness's array-shaped one would hide that.
  const open = new Set(Array.from(list.querySelectorAll("details"))
    .filter((entry) => entry.hasAttribute("open")).map((entry) => entry.dataset.for));
  const standingOn = doc.activeElement?.id ?? null;

  list.replaceChildren(...ordered.map((finding) => {
    const item = paintFinding(doc, finding, { rootId, level });
    const details = item.querySelectorAll("details")[0];
    if (details) {
      details.dataset.for = findingIds(rootId, finding).summary;
      if (open.has(details.dataset.for)) details.setAttribute("open", "");
    }
    return item;
  }));

  summaryLine.textContent = summary.state === EVIDENCE_STATE.LOADING ? LOADING_COPY
    : summary.state === EVIDENCE_STATE.EMPTY ? EMPTY_COPY
      : announcement.text;
  if (live) {
    live.textContent = announcement.text;
    live.dataset.kind = announcement.kind;
  }
  if (standingOn) doc.getElementById(standingOn)?.focus?.();
  return true;
}

/** The loading state, drawn before anything has been parsed. */
export const renderImportEvidenceLoading = (doc, rootId, options = {}) =>
  renderImportEvidence(doc, rootId, { ...options, findings: [], loading: true });

export { ANNOUNCEMENT_KIND };
