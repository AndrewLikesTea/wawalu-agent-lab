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
import {
  BRIEFING_SOURCE, SAMPLE_ORIGIN, chooseBriefingSource,
} from "/executive-briefing-source.js";
import {
  SAMPLE_DISCLOSURE, SAMPLE_LABEL, SAMPLE_PROVENANCE_NOTE, sampleRetainedPeriods,
} from "/executive-briefing-sample.js";
import { initFinopsContact } from "/finops-contact.js";
import {
  EXAMPLE_BRIEFING_NOTICE, EXAMPLE_BRIEFING_ORIGIN, EXAMPLE_BRIEFING_PROVENANCE_NOTE,
  EXAMPLE_BRIEFING_SYNTHETIC, exampleBriefingPeriods, readExampleContext,
} from "/finops-example-briefing.js";
import {
  renderBriefingError,
  renderExampleContextNotice,
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
  let briefing;
  let verdict;
  try {
    briefing = buildExecutiveBriefing(periods);
    verdict = validateExecutiveBriefing(briefing);
  } catch {
    briefing = null;
    verdict = null;
  }
  if (!verdict?.valid) {
    const first = verdict?.violations?.[0];
    const failure = renderBriefingError({
      summary: "This browser's own briefing failed its contract",
      detail: first
        ? `The briefing built from the ${periods.length} period(s) retained here broke `
          + `${verdict.violations.length} rule(s); the first is ${first.code} at `
          + `“${first.path || "the briefing itself"}”.`
        : `The ${periods.length} retained period(s) could not be built into a briefing in this tab.`,
      remedy: "Your retained figure is withheld because it cannot be quoted safely. Your retained "
        + "figures were not changed and nothing was uploaded. The explicitly labelled synthetic "
        + "sample remains below so the decision hierarchy is still readable.",
      onRetry: loadExecutiveBriefingPreview,
    });
    return paintSampleBriefing({
      origin: SAMPLE_ORIGIN,
      leadingNodes: [failure],
    });
  }
  const article = renderExecutiveBriefingPreview(briefing, { origin, provenanceNote, followUp: true });
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
function paintSampleBriefing({ absence, origin, leadingNodes = [] }) {
  let briefing;
  let verdict;
  try {
    briefing = buildExecutiveBriefing(sampleRetainedPeriods());
    verdict = validateExecutiveBriefing(briefing);
  } catch {
    briefing = null;
    verdict = null;
  }
  if (!verdict?.valid) {
    const first = verdict?.violations?.[0];
    paint(renderBriefingError({
      summary: "The published sample failed its own contract",
      detail: first
        ? `${verdict.violations.length} violation(s); the first is ${first.code} at `
          + `“${first.path || "the briefing itself"}”.`
        : "The bundled sample could not be built into a briefing in this tab.",
      remedy: "No figure is shown, because a briefing that fails the contract it declares cannot be "
        + "quoted. The contract and the sample it ships with have to agree before this page draws either.",
      onRetry: loadExecutiveBriefingPreview,
    }));
    return null;
  }

  const preview = renderExecutiveBriefingPreview(briefing, {
    origin,
    provenanceNote: SAMPLE_PROVENANCE_NOTE,
    synthetic: { label: SAMPLE_LABEL, disclosure: SAMPLE_DISCLOSURE },
    followUp: true,
  });
  paint(...leadingNodes, renderSourceNotice(absence), preview);
  activate(preview);
  return preview;
}

/**
 * Draw the bundled AI FinOps example, because the reader arrived from it.
 *
 * PINNED, NOT PREFERRED. This path runs *before* the workspace is consulted and
 * the store is never read on it. A reader who followed "open the executive
 * briefing for this example" asked for the example: briefing on their own
 * retained months instead would answer a question they did not ask, under a
 * heading that looks identical. The notice says the omission out loud, and links
 * back to the region they came from.
 *
 * Synchronous and network-free, like both paths above: the periods are derived
 * from the dataset this bundle already carries, through the same contract a
 * reader's own export walks through. A derivation that fails is drawn as the
 * page's error state rather than silently falling back to the published sample —
 * two different synthetic datasets under one label is the confusion this
 * hand-off exists to remove.
 */
function paintExampleBriefing() {
  let briefing;
  try {
    briefing = buildExecutiveBriefing(exampleBriefingPeriods());
  } catch {
    briefing = null;
  }
  const verdict = briefing ? validateExecutiveBriefing(briefing) : null;
  if (!verdict?.valid) {
    const first = verdict?.violations?.[0];
    paint(renderBriefingError({
      summary: "The bundled example could not be built into a briefing",
      detail: first
        ? `The example's periods broke ${verdict.violations.length} rule(s); the first is `
          + `${first.code} at “${first.path || "the briefing itself"}”.`
        : "The bundled example dataset could not be analyzed in this browser.",
      remedy: "No figure is shown, because a briefing that fails the contract it declares cannot be "
        + "quoted. Nothing of yours was read and nothing was stored — the AI FinOps page still holds "
        + "the same example result, and this page briefs on your own retained periods without the "
        + "example link.",
      onRetry: loadExecutiveBriefingPreview,
    }));
    return null;
  }
  const preview = renderExecutiveBriefingPreview(briefing, {
    origin: EXAMPLE_BRIEFING_ORIGIN,
    provenanceNote: EXAMPLE_BRIEFING_PROVENANCE_NOTE,
    synthetic: EXAMPLE_BRIEFING_SYNTHETIC,
    followUp: true,
  });
  paint(renderExampleContextNotice(EXAMPLE_BRIEFING_NOTICE), preview);
  activate(preview);
  return preview;
}

export async function loadExecutiveBriefingPreview() {
  if (!root) return null;
  try {
    // The example context is read from the address bar, so it survives a copied
    // link and a reload — the two ways a reader actually keeps a page.
    if (readExampleContext(globalThis.window?.location ?? null).pinned) {
      return paintExampleBriefing();
    }
    const chosen = chooseBriefingSource(browserFinopsWorkspaceStorage());
    if (chosen.source === BRIEFING_SOURCE.workspace) return paintWorkspaceBriefing(chosen);
    return paintSampleBriefing(chosen);
  } catch (error) {
    // This function is awaited at the top level of a module. Anything that
    // escapes it leaves the markup's own "Reading…" panel and `aria-busy="true"`
    // on screen permanently — a page that claims to be working forever, which is
    // the one outcome this surface exists to not produce. Each path above
    // already handles the failures it can name; this catches the ones it cannot,
    // and fails in words with a control rather than in the console.
    paint(renderBriefingError({
      summary: "The briefing could not be built in this tab",
      detail: `This browser stopped while choosing what to brief on (${error?.name ?? "error"}).`,
      remedy: "Nothing was uploaded, nothing was stored, and your retained figures were not changed. "
        + "Retrying rebuilds from this browser's own periods, and reloading does the same from a "
        + "clean start.",
      onRetry: loadExecutiveBriefingPreview,
    }));
    return null;
  }
}

// The follow-up affordance is wired before the briefing is built and never
// touched again: it sits outside the painted region, so it is usable while the
// document is still loading, and it survives every repaint above it. The AI
// FinOps result runs the same module under its own id family.
initFinopsContact(document, undefined, { prefix: "briefing-contact" });

if (root) await loadExecutiveBriefingPreview();
