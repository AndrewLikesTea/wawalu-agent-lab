// The guided loop, on the page (#1483).
//
// THE CONTROLS ARE AUTHORED, NOT BUILT. The section, its question, its three
// top-level slots, the disclosure and the recheck button all ship in
// evolution.html, so a visitor whose script never ran meets a complete,
// labelled, keyboard-operable region. This module fills slots and builds list
// items inside them; it authors no control and creates no focusable node.
//
// WHERE IT SITS. Directly below #finops-first-run and nowhere higher. The first
// screen above that region has no spare tab stop — tests/finops-first-viewport.js
// holds the page to meeting no control before its first answer, and
// tests/finops-decision-interaction.js pins the brief's own focus order exactly —
// so both of this change's focusable nodes, the disclosure summary and the
// recheck button, are below it.
//
// IT RE-DERIVES NO FIGURE. Every value in the before-and-after is READ OUT OF A
// SLOT THIS PAGE HAS ALREADY PAINTED, by id, as text. The headline claim, the
// tier marker, the confidence grade, the pricing-provenance chip and the graded
// floor are quoted from the five nodes below rather than recomputed from the
// models behind them, which is the only way this region and the answer at the
// top of the page can be held to one set of words. If a slot has not been
// painted yet its quote is empty and no change is claimed for it.
//
// NOTHING GOES INTO THE DISCLOSURE THAT MUST BE HEARD. #readiness-loop-live is a
// SIBLING of the details element, not a child: folded into a shut disclosure an
// announcement is one nobody is told. It is written LAST in applyReadinessLoop,
// after every slot above it, so an assistive technology reading the status has
// the recomputed region underneath it rather than the previous one.

/** The slots this region authors. */
export const READINESS_LOOP_IDS = Object.freeze({
  region: "finops-readiness-loop",
  metric: "readiness-loop-metric",
  action: "readiness-loop-action",
  change: "readiness-loop-change",
  detail: "readiness-loop-detail",
  steps: "readiness-loop-steps",
  changes: "readiness-loop-changes",
  recheck: "readiness-loop-recheck",
  live: "readiness-loop-live",
});

/**
 * The five already-painted nodes this loop quotes, in the order a reader meets
 * them. `label` is what the before-and-after calls each one; the id is the slot
 * the page paints, and this module never writes to any of them.
 */
export const QUOTED_SLOTS = Object.freeze([
  Object.freeze({ key: "claim", id: "finops-recoverable-value", label: "The claim" }),
  Object.freeze({ key: "tier", id: "finops-recoverable-marker", label: "Tier" }),
  Object.freeze({ key: "confidence", id: "finops-recoverable-grade", label: "Confidence" }),
  Object.freeze({ key: "provenance", id: "finops-recoverable-provenance", label: "Pricing provenance" }),
  Object.freeze({ key: "floor", id: "finops-stand-floor-value", label: "Graded floor" }),
]);

/** The state before the last recompute. Module-scoped, never stored, never sent. */
let previous = null;

/** What this module last painted, so a test can assert on the same record. */
let painted = null;

export const currentLoopClaim = () => previous;
export const currentLoopRender = () => painted;

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);
const textOf = (node) => (typeof node?.textContent === "string" ? node.textContent.trim() : "");

function set(doc, id, value) {
  const node = byId(doc, id);
  if (node) node.textContent = value;
  return node;
}

/** The five quotes, read off the page as it stands right now. */
export function readClaim(doc) {
  const out = {};
  for (const slot of QUOTED_SLOTS) out[slot.key] = textOf(byId(doc, slot.id));
  return Object.freeze(out);
}

/** Which of the five moved, with the words on either side of the move. */
function changesBetween(before, after) {
  if (!before) return [];
  return QUOTED_SLOTS
    .filter((slot) => before[slot.key] !== after[slot.key] && after[slot.key] !== "")
    .map((slot) => Object.freeze({
      key: slot.key, label: slot.label, was: before[slot.key], now: after[slot.key],
    }));
}

/** One list item, built from text and never from markup. */
function item(doc, className, text) {
  const node = doc.createElement("li");
  node.className = className;
  node.textContent = text;
  return node;
}

/**
 * Paint the loop.
 *
 * Total: a document missing the region is left alone rather than throwing
 * through the boot of the answer above it. A null model paints the unavailable
 * state, which is what a page with no analysis honestly has to say.
 *
 * @returns the region, so a caller can assert on the same node.
 */
export function applyReadinessLoop(doc, model = null, { announce = true } = {}) {
  const region = byId(doc, READINESS_LOOP_IDS.region);
  if (!region) return null;
  const claim = readClaim(doc);
  // The FIRST paint is not a recomputation, it is the region arriving. Nothing
  // has moved for a reader to be told about, and a status that speaks on boot
  // is one they learn to ignore by the time it has something to say.
  const boot = previous === null;
  const changes = changesBetween(previous, claim);
  region.dataset.state = model?.verdict ?? "unavailable";
  region.dataset.remaining = String(model?.remaining ?? 0);

  set(doc, READINESS_LOOP_IDS.metric,
    model?.metric ?? "No readiness benchmark has been taken for this analysis yet.");
  set(doc, READINESS_LOOP_IDS.action,
    model?.nextAction ?? "Nothing to guide yet: no analysis has been read.");
  // The claim as it stands, quoted, so the top of the loop names the thing it is
  // guiding the reader toward rather than making them look back up the page.
  set(doc, READINESS_LOOP_IDS.change, changes.length === 0
    ? `Claim now: ${claim.claim || "not painted yet"} · ${claim.tier || "no tier"} · `
      + `${claim.confidence || "no grade"}. Nothing moved on the last recheck.`
    : `${changes.length} input${changes.length === 1 ? "" : "s"} moved on the last step: `
      + changes.map((change) => `${change.label} was ${change.was}, now ${change.now}`).join("; ")
      + ".");

  // THE ORDERED STEPS, BEHIND THE DISCLOSURE. Done and not-done alike, in the
  // readiness contract's own order, each carrying which module decided it.
  const steps = byId(doc, READINESS_LOOP_IDS.steps);
  if (steps) {
    steps.replaceChildren(...(model?.steps ?? []).map((step) => {
      const node = item(doc, "readiness-loop-step",
        `Step ${step.ordinal} — ${step.label}: ${step.done ? "done" : "open"}. ${step.state}`
        + `${step.blocker ? ` ${step.blocker}` : ""}`
        + `${step.done || !step.action ? "" : ` Do this: ${step.action}`}`
        + ` Decided by ${step.source}.`);
      node.dataset.step = step.id;
      node.dataset.done = step.done ? "true" : "false";
      return node;
    }));
  }
  // And the itemised before-and-after under them, so a reader who wants the
  // arithmetic of the last step gets every input that moved, not just a summary.
  const list = byId(doc, READINESS_LOOP_IDS.changes);
  if (list) {
    list.replaceChildren(...(changes.length === 0
      ? [item(doc, "readiness-loop-change", "No input of this claim has moved yet.")]
      : changes.map((change) => item(doc, "readiness-loop-change",
        `${change.label}: was ${change.was} → now ${change.now}`))));
  }

  previous = claim;
  painted = Object.freeze({ claim, changes: Object.freeze(changes), model });
  // LAST, AND OUTSIDE THE DISCLOSURE. Everything above is already on the page by
  // the time this line runs, so what is announced is what is there to be read.
  if (announce && !boot) {
    set(doc, READINESS_LOOP_IDS.live, `${model?.metric ?? "Readiness unavailable"}. `
      + `${model?.nextAction ?? ""} `
      + (changes.length === 0 ? "No input of the claim moved."
        : `${changes.map((change) => `${change.label} ${change.was} to ${change.now}`).join(", ")}.`));
  }
  return region;
}

/**
 * Bind the one control this region ships.
 *
 * `recompute` is the page's own paint path, called again — this button starts no
 * second one. A reader who has just declared a rate below presses it, the page
 * repaints the figures it always repaints, and the loop reports what moved.
 */
export function bindReadinessLoop(doc, { recompute } = {}) {
  const button = byId(doc, READINESS_LOOP_IDS.recheck);
  if (!button) return null;
  button.addEventListener("click", () => {
    if (typeof recompute === "function") recompute();
  });
  return button;
}

/** Reset the remembered claim. Tests only; nothing on the page calls it. */
export function resetReadinessLoop() {
  previous = null;
  painted = null;
}
