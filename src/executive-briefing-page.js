// The executive briefing preview: one static document, rebuilt in the reader's
// own tab from the canonical synthetic fixture.
//
// The page is inspectable on purpose. It does not render the `briefing` block
// the fixture publishes — it reads the fixture's *input* periods, rebuilds the
// briefing through the shipped contract, validates the result, and only then
// compares it to the published block. A reader who opens the fixture and the
// contract sees exactly the arithmetic this page performed, and a drift between
// the two is reported as an error rather than painted as a figure.
//
// It reads one file, from this origin, and writes nothing: no storage, no clock,
// no import, no credential, no shareable link. That is the same boundary the
// briefing's own safety statement makes, which is why this entry can honestly
// render it.

import {
  buildExecutiveBriefing, validateExecutiveBriefing,
} from "/executive-finops-briefing.js";
import {
  renderBriefingError,
  renderExecutiveBriefingPreview,
  wireDisclosures,
  wirePrintExpansion,
} from "/executive-briefing-view.js";

export const FIXTURE_PATH = "/executive-finops-briefing-fixture.json";

const ORIGIN =
  "Published synthetic sample — no import, no customer data, and not your workspace's figures.";

const root = document.getElementById("executive-briefing");

function paint(node) {
  root.replaceChildren(node);
  root.setAttribute("aria-busy", "false");
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

export async function loadExecutiveBriefingPreview() {
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
    origin: ORIGIN,
    provenanceNote: published
      ? "Rebuilt in this tab from the periods above and matched, field for field, against the briefing "
        + "the published sample carries. No clock, no random value, and no network call beyond reading "
        + "that one file took part."
      : "Rebuilt in this tab from the periods above. No clock, no random value, and no network call "
        + "beyond reading that one file took part.",
  });
  paint(preview);
  wireDisclosures(preview, document);
  wirePrintExpansion(globalThis.window ?? globalThis, preview, document);
  return preview;
}

if (root) await loadExecutiveBriefingPreview();
