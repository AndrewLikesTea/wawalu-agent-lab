// Paint one department screen model into the slots departments.html ships.
//
// IT ADDS NO MARKUP AND NO STYLE. Every element this file writes into is
// authored in the page, so the document a reader gets before any script runs
// already says what state it is in and why — the pending sentence in the markup
// is `pendingDepartmentScreen`'s own, not a second wording of it. This file only
// changes text, one `data-state`, one `aria-busy`, two `hidden` flags and two
// hrefs.
//
// EVERY VALUE GOES IN AS TEXT. `textContent` only, never markup, so nothing that
// arrives from an address bar can become an element.
//
// ONE LIVE REGION. `#department-status` is the only element on this screen that
// announces, and it sits outside every disclosure on purpose: a live region
// inside a collapsed details element is silent in a real browser, whatever a
// test harness that models no layout reads out of it.

import { DEPARTMENT_SCREEN_STATE } from "./department-screen.js";

function write(doc, id, text) {
  const node = doc.getElementById(id);
  if (node) node.textContent = text;
  return node;
}

function show(doc, id, visible) {
  const node = doc.getElementById(id);
  if (!node) return null;
  if (visible) node.removeAttribute("hidden");
  else node.setAttribute("hidden", "");
  return node;
}

function link(doc, id, href) {
  const node = doc.getElementById(id);
  if (node) node.setAttribute("href", href);
  return node;
}

/**
 * Draw a model.
 *
 * @param {Document} doc the department screen's document.
 * @param {object} model a frozen model from src/department-screen.js.
 */
export function applyDepartmentScreen(doc, model) {
  const root = doc.getElementById("department-answer");
  if (root) {
    root.dataset.state = model.state;
    root.setAttribute("aria-busy", model.state === DEPARTMENT_SCREEN_STATE.pending ? "true" : "false");
  }

  const resolved = model.state === DEPARTMENT_SCREEN_STATE.resolved;
  const unavailable = model.state === DEPARTMENT_SCREEN_STATE.unavailable;

  // The one announcement, and the only sentence that changes on every state.
  write(doc, "department-status", model.status);
  write(doc, "department-subject", model.title);

  show(doc, "department-resolved", resolved);
  show(doc, "department-unavailable", unavailable);

  // The way back to the organization-wide answer carries the selection in both
  // states it exists in: a reader who mistyped one letter keeps the department
  // they were reading about.
  link(doc, "department-org-answer", model.backHref);
  link(doc, "department-unavailable-org-answer", model.backHref);

  // The verdict slots are written on EVERY state, before the early return, so
  // one department's verdict, confidence or evidence count can never survive
  // into the next department's screen — including the states where the block
  // is hidden rather than repainted.
  write(doc, "department-verdict-label", model.verdict?.label ?? "Intervention verdict");
  write(doc, "department-verdict-value", model.verdict?.value ?? "");
  write(doc, "department-verdict-confidence", model.verdict?.confidenceDetail ?? "");
  write(doc, "department-verdict-evidence", model.verdict?.evidence ?? "");
  write(doc, "department-verdict-basis", model.verdict?.basis ?? "");

  // The provenance slots are written on EVERY state too, for the same reason
  // the verdict ones are: one department's declared sources must never survive
  // into the next department's screen.
  write(doc, "department-sources-line", model.sources?.line ?? "");
  for (const [index, id] of ["provider", "hris", "period", "freshness"].entries()) {
    write(doc, `department-sources-${id}`, model.sources?.rows[index].detail ?? "");
  }

  if (!resolved) return root;

  write(doc, "department-metric-label", model.metric.label);
  write(doc, "department-metric-value", model.metric.display);
  write(doc, "department-metric-basis", model.metric.basis);
  write(doc, "department-action-headline", model.action.headline);
  write(doc, "department-action-text", model.action.text);
  write(doc, "department-action-worth", model.action.worth);

  for (const row of model.disclosures.mix) {
    write(doc, `department-mix-${row.key}-share`, `${row.share} · ${row.spend} a month`);
    write(doc, `department-mix-${row.key}-note`, row.note);
  }
  write(doc, "department-trajectory-text", model.disclosures.trajectory);
  write(doc, "department-peer-text", model.disclosures.peer);
  write(doc, "department-training-gap-text", model.disclosures.trainingGap);
  return root;
}
