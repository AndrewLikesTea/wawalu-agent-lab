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
// words, in its own labelled state, and *then* draws the published synthetic
// sample beneath it so the artifact can still be read and printed in full. The
// sample is labelled as a sample in the notice, in the masthead, and on paper.
//
// The sample path is inspectable on purpose. It does not render the `briefing` block
// the fixture publishes — it reads the fixture's *input* periods, rebuilds the
// briefing through the shipped contract, validates the result, and only then
// compares it to the published block. A reader who opens the fixture and the
// contract sees exactly the arithmetic this page performed, and a drift between
// the two is reported as an error rather than painted as a figure.
//
// It reads at most one file, from this origin, and writes nothing: no clock, no
// import, no credential, no shareable link, and never a write back to the store
// it read. That is the same boundary the briefing's own safety statement makes,
// which is why this entry can honestly render it.

import {
  buildExecutiveBriefing, validateExecutiveBriefing,
} from "/executive-finops-briefing.js";
import { browserFinopsWorkspaceStorage } from "/finops-workspace.js";
import { BRIEFING_SOURCE, chooseBriefingSource } from "/executive-briefing-source.js";
import {
  renderBriefingError,
  renderExecutiveBriefingPreview,
  renderPrintControl,
  renderSourceNotice,
  wireDisclosures,
  wirePrintControl,
  wirePrintExpansion,
} from "/executive-briefing-view.js";

export const FIXTURE_PATH = "/executive-finops-briefing-fixture.json";

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
 * Structural equality over JSON-shaped values. Written here rather than through
 * a stringify comparison because key order is not part of the claim: "the same
 * briefing" means the same fields with the same values, whatever order the
 * builder emitted them in.
 */
function sameValue(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => sameValue(entry, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => sameValue(left[key], right[key]));
}

async function readFixture() {
  const response = await fetch(FIXTURE_PATH);
  if (response.ok === false) throw new Error(`fixture request failed: ${response.status ?? "no status"}`);
  return response.json();
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

export async function loadExecutiveBriefingPreview() {
  const chosen = chooseBriefingSource(browserFinopsWorkspaceStorage());
  if (chosen.source === BRIEFING_SOURCE.workspace) return paintWorkspaceBriefing(chosen);

  const notice = renderSourceNotice(chosen.absence);
  let fixture;
  try {
    fixture = await readFixture();
  } catch (error) {
    paint(renderBriefingError({
      summary: "The published briefing could not be read",
      detail: `This tab could not load ${FIXTURE_PATH} from this site (${error.message}).`,
      remedy: "Nothing was uploaded and nothing was stored. Reload the page; if it keeps failing, the "
        + "published sample is missing from this build and the briefing is withheld rather than guessed.",
    }));
    return null;
  }

  const periods = fixture?.input?.retainedPeriods;
  if (!Array.isArray(periods)) {
    paint(renderBriefingError({
      summary: "The published briefing carries no retained periods",
      detail: "The fixture was read, but it does not declare the derived periods a briefing is built "
        + "from, so there is nothing to rebuild.",
    }));
    return null;
  }

  const briefing = buildExecutiveBriefing(periods);
  const verdict = validateExecutiveBriefing(briefing);
  if (!verdict.valid) {
    const first = verdict.violations[0];
    paint(renderBriefingError({
      summary: "The rebuilt briefing failed its own contract",
      detail: `${verdict.violations.length} violation(s); the first is ${first.code} at `
        + `“${first.path || "the briefing itself"}”.`,
      remedy: "No figure is shown, because a briefing that fails the contract it declares cannot be "
        + "quoted. The contract and the published sample have to agree before this page draws either.",
    }));
    return null;
  }

  const published = fixture.briefing;
  if (published && !sameValue(briefing, published)) {
    paint(renderBriefingError({
      summary: "The rebuilt briefing does not match the published one",
      detail: "Rebuilding the fixture's own retained periods produced a briefing that differs from the "
        + "briefing the fixture publishes, so the two disagree about the same period.",
      remedy: "The figure is withheld rather than shown, because there is no way to tell from here "
        + "which of the two is right. Nothing was uploaded and nothing was stored.",
    }));
    return null;
  }

  const preview = renderExecutiveBriefingPreview(briefing, {
    origin: chosen.origin,
    provenanceNote: published
      ? "Rebuilt in this tab from the periods above and matched, field for field, against the briefing "
        + "the published sample carries. No clock, no random value, and no network call beyond reading "
        + "that one file took part."
      : "Rebuilt in this tab from the periods above. No clock, no random value, and no network call "
        + "beyond reading that one file took part.",
  });
  paint(notice, preview);
  activate(preview);
  return preview;
}

if (root) await loadExecutiveBriefingPreview();
