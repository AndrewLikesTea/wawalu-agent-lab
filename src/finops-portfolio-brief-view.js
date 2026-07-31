// The render layer for the portfolio-primary brief.
//
// It takes the document rather than reading a global, like the view modules
// beside it, so a test drives the shipped markup of evolution.html instead of a
// fixture authored for the test. Every node is built with createElement and
// textContent: no markup string, no innerHTML, no template interpolation.
//
// WHAT IT WILL NOT DO.
//
//   * Decide anything. Which providers were combined, which single benchmark the
//     answer rests on, and whether a figure may be printed at all are
//     `portfolioBrief`'s answers. This layer paints slots and holds no flag.
//   * Author a sentence a reader acts on. Every value and every reason arrives on
//     the brief.
//   * Leave two answers on screen. A portfolio brief supersedes the
//     single-provider one the same way the reader's own result already supersedes
//     the bundled example: the superseded region is marked and hidden. Neither is
//     the page's complete summary any more — src/finops-answer-spine.js gives
//     that role to #finops-stand and this region role `evidence` — but two
//     visible answers to the same question are still two too many. Restored —
//     unhidden, mark cleared — the moment a portfolio stops being available, so
//     clearing an import cannot strand the page on an answer for evidence it no
//     longer holds.
//
// ACCESSIBILITY, STATED RATHER THAN IMPLIED.
//
//   * Every state is a word before it is a tint: the region's state word is in
//     text, and `data-state` carries the machine-readable copy of it.
//   * The four disclosures are native `details`/`summary`, so they are reachable
//     and operable from the keyboard with no key handler of this module's own, and
//     a screen reader announces them as the expandable groups they are. `summary`
//     carries `aria-expanded` synced on `toggle`, matching the disclosures already
//     on this page, and each `details` names its own content with `aria-label`.
//   * A disclosure with nothing in it says so in its own body instead of opening
//     onto an empty list.
//   * The blocked state keeps its headings and prints "Withheld" in the value
//     slots, so the layout does not collapse and the reason is read in place.

import { portfolioBrief } from "./finops-portfolio-brief.js";

const REGION_ID = "finops-portfolio-brief";
/** The single-provider answer this brief stands in front of when it is present. */
const SUPERSEDED_ID = "guided-result";

/** The state word a reader sees, paired with the machine-readable state. */
export const PORTFOLIO_STATE_WORD = Object.freeze({
  trusted: "Combined and complete",
  partial: "Combined and bounded",
  blocked: "Combined figures withheld",
});

/** Non-color state cues, so the word is never the only signal or the shape alone. */
const PORTFOLIO_STATE_SHAPE = Object.freeze({
  trusted: "●", partial: "◐", blocked: "○",
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text;
  return node;
}

function setSlot(doc, id, { text, detail, available }) {
  const value = byId(doc, id);
  if (value) {
    value.textContent = text;
    value.dataset.available = String(Boolean(available));
  }
  const note = byId(doc, `${id}-detail`);
  if (note) {
    note.textContent = detail ?? "";
    note.hidden = !detail;
  }
  return value;
}

/**
 * One native disclosure per evidence group.
 *
 * Rebuilt on every paint rather than diffed: the groups are small, and a
 * disclosure that kept a row from a previous import would be showing a provider
 * that is no longer in the total. Open state is not carried over for the same
 * reason — the content behind it is different content.
 */
function paintDisclosures(doc, disclosures) {
  const host = byId(doc, "finops-portfolio-brief-disclosures");
  if (!host) return [];
  const built = disclosures.map((group) => {
    const details = element(doc, "details", "portfolio-brief-disclosure");
    details.dataset.disclosure = group.id;
    details.setAttribute("aria-label", group.summary);
    const summary = element(doc, "summary", "portfolio-brief-disclosure-summary");
    summary.setAttribute("aria-expanded", "false");
    const shape = element(doc, "span", "portfolio-brief-disclosure-shape", "▸");
    shape.setAttribute("aria-hidden", "true");
    summary.append(shape, element(doc, "span", "portfolio-brief-disclosure-label", group.summary));
    details.append(summary);
    details.append(element(doc, "p", "portfolio-brief-disclosure-note", group.note));
    if (group.rows.length === 0) {
      // A group with no rows still opens onto a sentence. An empty list behind a
      // triangle reads as a rendering failure.
      details.append(element(doc, "p", "portfolio-brief-disclosure-empty",
        "Nothing to list here."));
    } else {
      const rows = element(doc, "dl", "portfolio-brief-disclosure-rows");
      for (const row of group.rows) {
        rows.append(
          element(doc, "dt", "portfolio-brief-disclosure-term", row.term),
          element(doc, "dd", "portfolio-brief-disclosure-detail", row.detail),
        );
      }
      details.append(rows);
    }
    details.addEventListener("toggle", () => {
      summary.setAttribute("aria-expanded", String(Boolean(details.open)));
      details.dataset.open = String(Boolean(details.open));
    });
    details.dataset.open = "false";
    return details;
  });
  host.replaceChildren(...built);
  return built;
}

function paintProvenance(doc, provenance) {
  setText(doc, "finops-portfolio-brief-provenance", provenance.text);
  const list = byId(doc, "finops-portfolio-brief-provenance-list");
  if (!list) return;
  const rows = [
    ["Processing", provenance.processing.replace(/_/g, " ")],
    ["Intake contract", provenance.contract ?? "not declared"],
    ["Adapters", provenance.adapters.length ? provenance.adapters.join(", ") : "none declared"],
    ["Accepted exports", provenance.exportIds.length
      ? provenance.exportIds.join(", ") : "none recorded"],
  ];
  list.replaceChildren(...rows.flatMap(([term, detail]) => [
    element(doc, "dt", "portfolio-brief-provenance-term", term),
    element(doc, "dd", "portfolio-brief-provenance-detail", detail),
  ]));
}

/**
 * Mark the single-provider answer as superseded, or give it back.
 *
 * The same two attributes the page already uses for the example summary, so one
 * rule about "exactly one complete answer" covers both hand-offs.
 */
function supersede(doc, superseded) {
  const region = byId(doc, SUPERSEDED_ID);
  if (!region) return null;
  if (superseded) {
    region.dataset.superseded = "true";
    // Remembered, so the release below only gives back a region this module took.
    // Whether the single-provider answer should be visible at all is the guided
    // result's own decision, and un-hiding one it had deliberately hidden would
    // overrule it.
    region.dataset.portfolioHid = String(region.hidden !== true);
    region.hidden = true;
    return region;
  }
  region.dataset.superseded = "false";
  if (region.dataset.portfolioHid === "true") region.hidden = false;
  delete region.dataset.portfolioHid;
  return region;
}

/**
 * Paint the portfolio brief for an analysis, or take it off screen.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null when an
 *   import has been cleared.
 * @returns the brief that was painted, including the unavailable one.
 */
export function applyPortfolioBrief(doc, analysis) {
  const region = byId(doc, REGION_ID);
  const brief = portfolioBrief(analysis);
  if (!region) return brief;
  if (!brief.available) {
    // No portfolio: the region leaves the page entirely and the single-provider
    // answer is handed back untouched. This is the path a one-provider import and
    // a cleared import both take.
    region.hidden = true;
    region.dataset.state = "unavailable";
    delete region.dataset.contractVersion;
    setText(doc, "finops-portfolio-brief-reason", brief.reason ?? "");
    supersede(doc, false);
    return brief;
  }

  region.hidden = false;
  region.dataset.state = brief.state;
  region.dataset.contractVersion = brief.contractVersion ?? brief.version;
  setText(doc, "finops-portfolio-brief-reason", "");
  setText(doc, "finops-portfolio-brief-question", brief.question);
  setText(doc, "finops-portfolio-brief-state-shape", PORTFOLIO_STATE_SHAPE[brief.state] ?? "○");
  setText(doc, "finops-portfolio-brief-state", PORTFOLIO_STATE_WORD[brief.state] ?? "Combined");

  setSlot(doc, "finops-portfolio-brief-total", {
    text: brief.alignedSpend.text,
    detail: brief.alignedSpend.detail,
    available: brief.alignedSpend.available,
  });
  setText(doc, "finops-portfolio-brief-benchmark-heading", brief.benchmark.label);
  setSlot(doc, "finops-portfolio-brief-benchmark", {
    text: brief.benchmark.value,
    // The comparison that was passed over is stated with the one that won, so a
    // reader who expected the peer cohort is told why it is not the basis here.
    detail: [brief.benchmark.detail, brief.benchmark.passedOver].filter(Boolean).join(" "),
    available: brief.benchmark.available,
  });
  setSlot(doc, "finops-portfolio-brief-impact", {
    text: brief.impact.text,
    detail: brief.impact.detail,
    available: brief.impact.available,
  });
  setSlot(doc, "finops-portfolio-brief-confidence", {
    text: brief.confidence.level,
    detail: [brief.confidence.basis.length ? `Basis: ${brief.confidence.basis.join("; ")}.` : "",
      ...brief.confidence.bounds].filter(Boolean).join(" "),
    available: brief.confidence.available,
  });
  setSlot(doc, "finops-portfolio-brief-action", {
    text: brief.nextAction.text,
    detail: brief.nextAction.accountable
      ? `Rank ${brief.nextAction.rank} · accountable: ${brief.nextAction.accountable}`
      : "",
    available: brief.nextAction.available,
  });
  paintProvenance(doc, brief.provenance);
  paintDisclosures(doc, brief.disclosures);
  supersede(doc, true);

  const live = byId(doc, "finops-portfolio-brief-live");
  if (live) {
    live.textContent = `${PORTFOLIO_STATE_WORD[brief.state]}. `
      + `${brief.alignedSpend.label}: ${brief.alignedSpend.text}. `
      + `Next action: ${brief.nextAction.text}`;
  }
  return brief;
}

/** Take the brief off screen and hand the single-provider answer back. */
export function clearPortfolioBrief(doc) {
  return applyPortfolioBrief(doc, null);
}
