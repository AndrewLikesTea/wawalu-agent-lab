// The front door's decision summary: mount it, give it its behaviour, leave.
//
// This entry does four things and nothing else: compose the summary, paint it,
// wire the two disclosures and the print routes, and draw the print control.
// It reads no storage, makes no request, and never touches the rest of the
// page — the decision log, its forms, its export, and its import are owned by
// `app.js` and are not re-rendered, re-ordered, or unmounted by anything here.
//
// The print control is drawn rather than shipped in the markup for the reason
// the executive briefing page draws its own: a button that calls the browser's
// print dialog does nothing on a page whose script never ran, and a dead
// control is worse than no control. The keyboard route that does not depend on
// it — the browser's own print command — is wired too, and the print
// stylesheet expands every level with no script at all.

import {
  composeLandingDecision, LANDING_DECISION_IDS, LANDING_DECISION_STATE,
  LANDING_DECISION_UNAVAILABLE,
} from "/landing-decision.js";
import {
  renderBriefingError,
  renderExecutiveBriefingPreview,
  renderPrintControl,
  wireDisclosures,
  wirePrintControl,
  wirePrintExpansion,
} from "/executive-briefing-view.js";

const mount = document.getElementById(LANDING_DECISION_IDS.mount);
const actions = document.getElementById(LANDING_DECISION_IDS.actions);

function paint(node) {
  // Never leave a print control pointing at a document an error state has just
  // replaced: the sheet it would produce has no figure on it.
  actions?.replaceChildren();
  mount.replaceChildren(node);
  mount.setAttribute("aria-busy", "false");
}

/**
 * Draw the one summary this page carries, or say plainly why it has none.
 *
 * Returns the painted article, or null when the shipped contract and its own
 * sample disagree. Exported so a test can drive a second paint in the same
 * document without reloading the page.
 */
export function loadLandingDecision() {
  if (!mount) return null;
  const composed = composeLandingDecision();

  if (composed.state !== LANDING_DECISION_STATE.ready) {
    const first = composed.violations[0];
    paint(renderBriefingError({
      summary: LANDING_DECISION_UNAVAILABLE.summary,
      detail: `${composed.violations.length} violation(s); the first is ${first?.code ?? "unknown"} at `
        + `“${first?.path || "the summary itself"}”.`,
      remedy: LANDING_DECISION_UNAVAILABLE.remedy,
    }));
    return null;
  }

  const article = renderExecutiveBriefingPreview(composed.briefing, composed.render);
  paint(article);
  wireDisclosures(article, document);
  wirePrintExpansion(globalThis.window ?? globalThis, article, document);
  if (actions) {
    const control = renderPrintControl();
    actions.replaceChildren(control);
    wirePrintControl(control, article, { scope: globalThis.window ?? globalThis, doc: document });
  }
  return article;
}

if (mount) loadLandingDecision();
