// The executive briefing: one printable document, rebuilt in the reader's own
// tab from the figures that are already in their browser.
//
// SOURCE ORDER
// ------------
// The reader's own retained FinOps periods come first. They are read from this
// browser's local workspace — the same aggregates the AI FinOps page already
// keeps there, with the reader's own consent — and the briefing is built from
// them by the shipped contract. Nothing is uploaded, fetched, or sent to derive
// them: the whole computation happens between `localStorage` and this tab.
//
// When this browser holds nothing to brief on — retention was never chosen, was
// declined, is on but empty, or the store cannot be read — the page says so in
// words, in its own labelled state, and *immediately* draws the published
// synthetic sample beneath it so the artifact can be read and printed in full on
// the first screen. The sample is labelled as a sample in the notice, in the
// masthead, beside the figure, and on paper.
//
// NOTHING IS FETCHED, ON EITHER PATH
// ----------------------------------
// The sample's three periods are carried in the bundle by
// `executive-briefing-sample.js` and rebuilt through the shipped contract in the
// same synchronous pass as the workspace path. That is a deliberate change from
// fetching the published fixture: an empty workspace is the common first visit,
// and it used to pay for a network round-trip before the reader saw a figure —
// and got an error state with no artifact at all when the request failed. Parity
// with the published fixture is enforced by the test suite and by
// `scripts/verify-build.mjs` instead, where a drift fails the build rather than
// stalling a reader's page.
//
// This entry now reads no file at all, and writes nothing: no clock, no import,
// no credential, no shareable link, and never a write back to the store it read.
// That is the same boundary the briefing's own safety statement makes, which is
// why this entry can honestly render it.

import {
  buildExecutiveBriefing, validateExecutiveBriefing,
} from "/executive-finops-briefing.js";
import { browserFinopsWorkspaceStorage } from "/finops-workspace.js";
import { BRIEFING_SOURCE, chooseBriefingSource } from "/executive-briefing-source.js";
import {
  SAMPLE_DISCLOSURE, SAMPLE_LABEL, SAMPLE_PROVENANCE_NOTE, sampleRetainedPeriods,
} from "/executive-briefing-sample.js";
import { initFinopsContact } from "/finops-contact.js";
import {
  renderBriefingError,
  renderExecutiveBriefingPreview,
  renderPrintControl,
  renderSourceNotice,
  wireDisclosures,
  wirePrintControl,
  wirePrintExpansion,
} from "/executive-briefing-view.js";

const root = document.getElementById("executive-briefing");
const actions = document.getElementById("briefing-actions");

function paint(...nodes) {
  // `loadExecutiveBriefingPreview` is public and may be retried in the same
  // document. Never leave a print control pointing at a briefing that an error
  // state has just replaced.
  actions?.replaceChildren();
  root.replaceChildren(...nodes.filter(Boolean));
  root.setAttribute("aria-busy", "false");
}

/**
 * Hand the finished document its behaviour: the two disclosures, the browser's
 * own print command, and this page's print control. The control is drawn only
 * beside a briefing — a print button over an error state offers a sheet with no
 * figure on it.
 */
function activate(article) {
  wireDisclosures(article, document);
  wirePrintExpansion(globalThis.window ?? globalThis, article, document);
  if (!actions) return;
  const control = renderPrintControl();
  actions.replaceChildren(control);
  wirePrintControl(control, article, { scope: globalThis.window ?? globalThis, doc: document });
}

/**
 * Draw the briefing this browser's own retained periods produce.
 *
 * A contract violation here is withheld rather than painted, exactly as it is on
 * the sample path: a briefing that fails the contract it declares cannot be
 * quoted, and the reader is told their figures are untouched.
 */
function paintWorkspaceBriefing({ periods, origin, provenanceNote }) {
  const briefing = buildExecutiveBriefing(periods);
  const verdict = validateExecutiveBriefing(briefing);
  if (!verdict.valid) {
    const first = verdict.violations[0];
    paint(renderBriefingError({
      summary: "This browser's own briefing failed its contract",
      detail: `The briefing built from the ${periods.length} period(s) retained here broke `
        + `${verdict.violations.length} rule(s); the first is ${first.code} at `
        + `“${first.path || "the briefing itself"}”.`,
      remedy: "No figure is shown, because a briefing that fails the contract it declares cannot be "
        + "quoted. Your retained figures were not changed, and nothing was uploaded.",
    }));
    return null;
  }
  const article = renderExecutiveBriefingPreview(briefing, { origin, provenanceNote });
  paint(article);
  activate(article);
  return article;
}

/**
 * Draw the published synthetic sample, immediately.
 *
 * Synchronous on purpose: the periods are already in this bundle, so a reader
 * with nothing retained here sees a complete briefing — decision, figure,
 * action, verdict, bounds, and both levels — on the first screen rather than a
 * "building…" panel that may never resolve.
 */
function paintSampleBriefing({ absence, origin }) {
  const briefing = buildExecutiveBriefing(sampleRetainedPeriods());
  const verdict = validateExecutiveBriefing(briefing);
  if (!verdict.valid) {
    const first = verdict.violations[0];
    paint(renderBriefingError({
      summary: "The published sample failed its own contract",
      detail: `${verdict.violations.length} violation(s); the first is ${first.code} at `
        + `“${first.path || "the briefing itself"}”.`,
      remedy: "No figure is shown, because a briefing that fails the contract it declares cannot be "
        + "quoted. The contract and the sample it ships with have to agree before this page draws either.",
    }));
    return null;
  }

  const preview = renderExecutiveBriefingPreview(briefing, {
    origin,
    provenanceNote: SAMPLE_PROVENANCE_NOTE,
    synthetic: { label: SAMPLE_LABEL, disclosure: SAMPLE_DISCLOSURE },
  });
  paint(renderSourceNotice(absence), preview);
  activate(preview);
  return preview;
}

export async function loadExecutiveBriefingPreview() {
  const chosen = chooseBriefingSource(browserFinopsWorkspaceStorage());
  if (chosen.source === BRIEFING_SOURCE.workspace) return paintWorkspaceBriefing(chosen);
  return paintSampleBriefing(chosen);
}

// The follow-up affordance is wired before the briefing is built and never
// touched again: it sits outside the painted region, so it is usable while the
// document is still loading, and it survives every repaint above it. The AI
// FinOps result runs the same module under its own id family.
initFinopsContact(document, undefined, { prefix: "briefing-contact" });

if (root) await loadExecutiveBriefingPreview();
