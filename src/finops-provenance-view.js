// The render layer for the per-panel provenance model.
//
// It takes the document rather than reading a global, exactly like
// `graded-sample-view.js` and `department-evidence-view.js` next to it, so a
// test drives the shipped markup of evolution.html instead of a fixture authored
// for the test. Every node is built with createElement and textContent; there is
// no markup string, no innerHTML, and no template interpolation on any path.
//
// What it will not do:
//
//   * Decide anything. Which panel is the reader's is `finopsProvenanceModel`'s
//     answer; this file paints four panels from one object and holds no flag of
//     its own. There is no path here that swaps one panel's label without the
//     model having said so.
//   * Hold a string a reader sees. Every sentence below arrives on the model,
//     including the example badge — which is why the badge is *hidden* rather
//     than rewritten when a panel becomes the reader's, and handed back
//     untouched when it goes back.
//   * Reach past the model. The model carries numbers, file names, department
//     names and authored copy, so there is no prompt text in this layer to leak.

import { FINOPS_PANEL, finopsProvenanceModel } from "./finops-provenance-model.js";

const HEADLINE_ID = "finops-headline";
const QUESTION_ID = "finops-headline-question";
const METRIC_LABEL_ID = "finops-headline-metric-label";
const METRIC_VALUE_ID = "finops-headline-metric-value";
const ACTION_ID = "finops-headline-action";
const STATUS_ID = "finops-headline-status";
const LIVE_ID = "finops-headline-live";
const RETURN_ID = "finops-return-to-sample";

/**
 * Where each panel's provenance sentence lives.
 *
 * `basis` is the example badge the page has always shipped, authored in the
 * markup and never rewritten. `provenance` is the line that replaces it once the
 * panel is the reader's, authored empty. The KPI row already had this pair; the
 * three headline panels are given the same shape so one function paints all four
 * and no panel can grow a treatment of its own.
 */
const PANEL_SLOTS = Object.freeze({
  [FINOPS_PANEL.headline]: Object.freeze({
    panel: HEADLINE_ID, basis: "finops-headline-basis", provenance: "finops-headline-provenance",
  }),
  [FINOPS_PANEL.kpis]: Object.freeze({
    panel: "kpi-row", basis: "headline-basis", provenance: "graded-provenance",
  }),
  [FINOPS_PANEL.cohort]: Object.freeze({
    panel: "cohort-comparison", basis: "cohort-comparison-basis",
    provenance: "cohort-comparison-provenance",
  }),
  [FINOPS_PANEL.coaching]: Object.freeze({
    panel: "coaching-card", basis: "coaching-card-basis",
    provenance: "coaching-card-provenance",
  }),
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shapeSpan(doc, glyph) {
  const shape = element(doc, "span", "provenance-shape", glyph);
  shape.setAttribute("aria-hidden", "true");
  return shape;
}

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text;
  return node;
}

/**
 * Write the live region only when the sentence actually changed.
 *
 * The surface repaints on every recalculation, and rewriting a status region
 * with the same string is still a change to a screen reader: it would announce
 * the whole provenance a second time because a filter moved. One swap, one
 * announcement — the same rule `graded-sample-view.js` holds.
 */
function announce(doc, text) {
  const node = byId(doc, LIVE_ID);
  if (!node || node.textContent === text) return node;
  node.textContent = text;
  return node;
}

/**
 * Paint one panel's source.
 *
 * The two lines are never both present: whichever one describes this panel is
 * the one the panel is `aria-describedby`, so a screen-reader user meets the
 * provenance as part of the panel rather than as a stray paragraph somewhere
 * after it.
 */
function paintPanel(doc, entry) {
  const slots = PANEL_SLOTS[entry.panel];
  if (!slots) return null;
  const panel = byId(doc, slots.panel);
  const basis = byId(doc, slots.basis);
  const provenance = byId(doc, slots.provenance);
  const user = entry.source === "user";

  if (provenance) {
    if (user) {
      provenance.replaceChildren(
        shapeSpan(doc, entry.shape),
        element(doc, "strong", "provenance-label", entry.label),
        element(doc, "span", "provenance-detail", entry.detail),
      );
    } else {
      provenance.replaceChildren();
    }
    provenance.hidden = !user;
  }
  // Hidden, never rewritten. Handing the example badge back is one flag rather
  // than a second copy of its wording living in this file.
  if (basis) basis.hidden = user;
  if (panel) {
    panel.dataset.source = entry.source;
    if (entry.reason) panel.dataset.sampleReason = entry.reason;
    else delete panel.dataset.sampleReason;
    const describedBy = user ? slots.provenance : slots.basis;
    if (byId(doc, describedBy)) panel.setAttribute("aria-describedby", describedBy);
  }
  return entry;
}

/**
 * Paint the whole surface from one model.
 *
 * Returns the model that was painted so a caller can assert on the state it
 * asked for rather than on the DOM it got.
 */
export function applyFinopsProvenance(doc, model, { onReturnToSample = null } = {}) {
  const section = byId(doc, HEADLINE_ID);
  if (!section || !model) return null;
  // What the surface was before this paint, so a first load does not announce a
  // state nobody changed. A visitor who arrives at the bundled example is not
  // owed a live-region sentence about it; a visitor whose panels just went back
  // to it is.
  const wasUser = section.dataset.provenance === "user";
  section.dataset.provenance = model.anyUserPanel ? "user" : "sample";
  section.dataset.status = model.status;
  section.dataset.state = model.state;
  section.dataset.source = model.panels.headline.source;

  setText(doc, QUESTION_ID, model.headline.question);
  setText(doc, METRIC_LABEL_ID, model.headline.metric.label);
  setText(doc, METRIC_VALUE_ID, model.headline.metric.value);
  setText(doc, ACTION_ID, model.headline.action.text);
  setText(doc, "cohort-comparison-answer", model.cohortAnswer);
  setText(doc, "coaching-card-answer", model.coachingAnswer);

  for (const entry of Object.values(model.panels)) paintPanel(doc, entry);

  // The mid-import and failed sentences share one slot with a reserved line, so
  // a file that is being read, and one that failed, change no panel's height.
  const status = byId(doc, STATUS_ID);
  if (status) {
    status.textContent = model.message ?? "";
    status.dataset.status = model.status;
  }

  const control = byId(doc, RETURN_ID);
  if (control) {
    control.hidden = !model.returnControl.available;
    control.textContent = model.returnControl.label;
    if (!control.dataset.bound) {
      control.dataset.bound = "true";
      control.addEventListener("click", () => {
        // The panels go back here, so the control is honest even if the page's
        // own reset is not wired: one press, four panels, one announcement.
        clearFinopsProvenance(doc);
        byId(doc, QUESTION_ID)?.focus?.();
        onReturnToSample?.();
      });
    }
  }

  if (model.message || model.anyUserPanel || wasUser) {
    announce(doc, model.message ?? announcementFor(model));
  }
  return model;
}

/**
 * What a reader who is not looking at the page is owed after a swap: which
 * panels became theirs, and which did not, in one sentence.
 */
function announcementFor(model) {
  const user = Object.values(model.panels).filter((panel) => panel.source === "user");
  if (!user.length) return "Every panel on this page is the bundled example data.";
  const sample = Object.values(model.panels).filter((panel) => panel.source === "sample");
  const names = { headline: "the grade", kpis: "the headline metrics", cohort: "the cohort comparison", coaching: "the coaching card" };
  const list = (entries) => entries.map((panel) => names[panel.panel]).join(", ");
  return `Your import now feeds ${list(user)}. `
    + (sample.length ? `${list(sample)} remain the bundled example. ` : "")
    + `${model.headline.question} ${model.headline.action.text}`;
}

/**
 * Back to the bundled sample: every slot this module wrote is handed back, and
 * the headline returns to the question a visitor who imported nothing meets.
 *
 * Nothing is persisted anywhere, so this is also exactly what a reload produces.
 */
export function clearFinopsProvenance(doc) {
  // The model with no import in it *is* the sample state, so there is no second
  // definition of "back to the example" for the two to disagree about.
  return applyFinopsProvenance(doc, finopsProvenanceModel());
}
