// THE COVERAGE GAP AS A WORKLIST (#2630).
//
// The block above the release log reports one figure: how many releases link at
// least one decision the decision log holds (release-reasoning-proof.js). When
// that figure is short of the total, the releases it is short BY were nowhere on
// the page — a reader could see "1 of 3" and had no way to learn which two, why,
// or what to do about either. This module is the other half of that figure: the
// list it is short by, each entry saying which kind of gap it is and what the
// next step for that kind actually is.
//
// TWO KINDS OF GAP, NEVER ONE. A release can fail the figure's rule in two
// different ways, and they need different work:
//   - it recorded no association at all — nothing was ever linked;
//   - every association it recorded points at a decision this log does not hold —
//     a link exists but the record behind it is gone (an import that left the
//     decisions behind does this).
// Both are in the list, and each states its own kind IN WORDS. Nothing here
// carries the distinction in a colour, an icon or a chip fill: the reason is a
// sentence, and the only filled chip this block draws is the live coverage status,
// whose colour repeats what its own text and numbers already say.
//
// THE COUNT IS DERIVED, NEVER SUPPLIED. Every number this block shows — the
// button's label, the announced sentence, the worklist's lead — comes from the
// same array that becomes the rendered rows, clamped to the number of releases
// actually loaded. A caller may hand in a figure of its own (`reported`); it is
// carried only so it can be ignored, because a button that says "Show 40
// uncovered releases" above four rows is worse than no button at all.
//
// THE RULE IS THE FIGURE'S RULE. Uncovered means `counts.linked === 0` on the
// same resolveRelease() the rows and the figure are both built from, so this list
// is exactly `total - preserved` long by construction rather than by two
// implementations agreeing.

import { RECORD_DECISION_HREF, releaseTitle, summarizeReleases } from "./releases.js";

/**
 * The worklist's own name: the defined word, not a second way of saying it
 * (#2702). The heading it replaced described one of the two ways a release gets
 * here — a missing link — and left the other unnamed.
 */
export const COVERAGE_GAP_HEADING = "Uncovered releases";

/**
 * Both ways in, directly under that heading, in one sentence.
 *
 * The heading now carries the term, so this says who is on the list instead of
 * restating what the term means: nothing linked, or everything linked pointing
 * at a record this log does not hold. It avoids the word "uncovered" itself —
 * the heading above it is the page's name for the list, and the definition in
 * the coverage block is the page's first use of the word by design.
 */
export const COVERAGE_GAP_MEMBERSHIP =
  "A release is on this list when it links no decision at all, "
  + "or when every decision it links is one this log does not hold.";

// What "covered" and "uncovered" mean, stated once, above the first control
// that uses either word (#2635). Authored in the markup and pinned here so the
// page and this module cannot drift apart. It borrows the figure's own clause —
// "at least one decision the decision log holds" — rather than coining a second
// way to say the rule.
export const COVERAGE_DEFINITION =
  "A release is covered when it links at least one decision the decision log holds; "
  + "every other release is uncovered.";

/** The two kinds of gap, and the words each one is stated in. */
export const COVERAGE_GAP_KINDS = Object.freeze(["unlinked", "dangling"]);

export const NO_LINKED_DECISION_REASON = "No linked decision";

/** The dangling case names the reference itself: it is the thing to go and check. */
export function coverageGapReasonText(gap) {
  if (gap?.kind !== "dangling") return NO_LINKED_DECISION_REASON;
  return `Linked decision not found in the log: ${gap.refs.join(", ")}`;
}

/**
 * The applicable next step, and only the applicable one.
 *
 * Three steps, decided by the kind of gap and — for an unlinked release — by
 * whether this log holds any decision that COULD be linked. Offering "link an
 * existing decision" to a visitor with an empty decision log is a dead end, and
 * offering "record a decision first" to one with four is busywork.
 *
 * Only one of the three is a real destination. Recording a decision is a form
 * that exists (`/#decision-form`), so that step is a link. The other two name
 * work this page cannot do — a release already in the log cannot be edited here,
 * and nothing can repair a reference to a record that is gone — so they are
 * labelled guidance with no control at all rather than a button that looks
 * operable and does nothing when pressed.
 */
export function coverageGapNextStep(gap, options = {}) {
  const linkable = Number(options.linkableDecisions ?? 0);
  if (gap?.kind === "dangling") {
    return {
      kind: "inspect-reference",
      text: `Next step: inspect the missing reference. Look for ${gap.refs.join(", ")} in the decision log, `
        + "or in the export this log was imported from. A reference to a record that is gone cannot be repaired here.",
      href: null,
      label: null,
    };
  }
  if (linkable > 0) {
    return {
      kind: "link-existing",
      text: `Next step: link an existing decision. This log holds ${linkable} `
        + `${linkable === 1 ? "decision" : "decisions"} to link, and “Record a release” below links them as a release `
        + "is recorded; a release already in the log cannot be edited here.",
      href: null,
      label: null,
    };
  }
  return {
    kind: "record-decision",
    text: "Next step: record a decision first — this log holds none to link.",
    href: RECORD_DECISION_HREF,
    label: "Record a decision",
  };
}

/**
 * The uncovered releases, in the order the log draws them (newest first), each
 * with its kind, its reason and its one next step already decided.
 *
 * Built from summarizeReleases so the entries are the same resolved records the
 * rows are, and so an entry can never describe a release the log orders
 * elsewhere.
 */
export function coverageGaps(releases = [], decisions = [], options = {}) {
  const linkableDecisions = options.linkableDecisions ?? (decisions ?? []).length;
  return summarizeReleases(releases ?? [], decisions ?? [])
    .filter((release) => release.counts.linked === 0)
    .map((release) => {
      const kind = release.counts.total === 0 ? "unlinked" : "dangling";
      const gap = { id: release.id, title: releaseTitle(release), kind, refs: [...release.missingIds] };
      return { ...gap, reason: coverageGapReasonText(gap), step: coverageGapNextStep(gap, { linkableDecisions }) };
    });
}

/**
 * The count every number in this block is taken from.
 *
 * Derived from the list that becomes the rows, and clamped to the releases
 * actually present. `reported` is accepted so a caller cannot claim it was never
 * offered the chance to supply one, and discarded so the three numbers on screen
 * cannot disagree.
 */
export function coverageGapCount(gaps = [], releases = [], reported) {
  void reported;
  return Math.min(gaps.length, (releases ?? []).length);
}

/** "Show 4 uncovered releases" — the count is in the accessible name. */
export function revealGapsLabel(count) {
  return `Show ${count} uncovered ${count === 1 ? "release" : "releases"}`;
}

export const SHOW_ALL_RELEASES_LABEL = "Show all releases";

/**
 * What the reveal changed, with both numbers in it, for the polite region.
 *
 * Both states are announced, because returning to the whole log is a change to
 * what is on screen too and a reader who only hears the narrowing is left to
 * guess whether the widening took.
 */
export function coverageGapAnnouncement({ count = 0, total = 0, uncoveredOnly = false } = {}) {
  const noun = (value) => (value === 1 ? "release" : "releases");
  if (!uncoveredOnly) return `Showing all ${total} ${noun(total)}.`;
  return `Showing ${count} of ${total} ${noun(total)}: uncovered only.`;
}

/**
 * The live coverage status, as a chip.
 *
 * The one filled chip this block draws, because it is the one thing here that
 * changes as the log does. Its colour is never the message: the text names which
 * state it is in AND carries both values, so the chip read with no colour at all
 * says the same thing.
 */
export function coverageStatusChip({ linked = 0, total = 0 } = {}) {
  if (total === 0) return null;
  return linked === total
    ? { text: `All linked: ${linked} of ${total}`, className: "badge badge-accepted" }
    : { text: `Uncovered: ${total - linked} of ${total}`, className: "badge badge-missing" };
}

/**
 * The worklist's own lead sentence: what the rows below it are, in numbers.
 *
 * It uses the defined term rather than restating the rule a third time: the
 * coverage block above states what uncovered means before any control says the
 * word, so by the time a reader reaches these rows the term is theirs.
 */
export function coverageGapLead({ count = 0, total = 0 } = {}) {
  return `${count} of ${total} ${total === 1 ? "release" : "releases"} in this log `
    + `${count === 1 ? "is" : "are"} uncovered. `
    + "Each one states why below, with the next step for that reason.";
}

/**
 * The whole view, from the loaded log: one object, so the button, the chip, the
 * announcement, the lead and the rows are all read off one computation.
 *
 * `total` is the releases loaded. `count` is the derived, clamped gap count.
 * `linked` is `total - count`, which is the figure above this block by
 * construction rather than by a second count of the same thing.
 */
export function coverageGapView(releases = [], decisions = [], options = {}) {
  const list = releases ?? [];
  const gaps = coverageGaps(list, decisions, options);
  const count = coverageGapCount(gaps, list, options.reported);
  const total = list.length;
  return {
    gaps: gaps.slice(0, count),
    count,
    total,
    linked: total - count,
    // No action while there is nothing to reveal: an empty log has no coverage to
    // be short of, and a complete one has nothing to show that is not on screen.
    actionable: count > 0,
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderGapRow(gap) {
  const item = el("li", "coverage-gap-item");
  item.dataset.gapKind = gap.kind;
  item.append(el("p", "coverage-gap-name", gap.title));
  // The reason, in words, in the row's own ink. No chip and no glyph: this is
  // the distinction the block exists to draw, and it is never drawn in colour.
  const reason = el("p", "coverage-gap-reason", gap.reason);
  reason.dataset.gapReason = gap.kind;
  item.append(reason);
  const step = el("p", "coverage-gap-step", gap.step.text);
  step.dataset.gapStep = gap.step.kind;
  item.append(step);
  // The one step that goes somewhere real gets a control. The other two do not,
  // so nothing here can be pressed to no effect.
  if (gap.step.href) {
    const link = el("a", "text-link coverage-gap-action", gap.step.label);
    link.setAttribute("href", gap.step.href);
    item.append(link);
  }
  return item;
}

/**
 * Write the view into the page: the chip and the reveal action in the coverage
 * block, the worklist beside the rows it annotates.
 *
 * `uncoveredOnly` is the page's own filter state, passed in rather than read back
 * out of the button: the log and this block are narrowed by one flag, and a
 * second copy of it in the DOM is a second thing that can be wrong.
 */
export function renderCoverageGaps(root, view, uncoveredOnly = false) {
  const section = root.querySelector("#reasoning-proof");
  const chip = root.querySelector("#coverage-gap-chip");
  const toggle = root.querySelector("#coverage-gap-toggle");
  const status = root.querySelector("#coverage-gap-status");
  const worklist = root.querySelector("#coverage-gap-worklist");
  const lead = root.querySelector("#coverage-gap-worklist-lead");
  const list = root.querySelector("#coverage-gap-list");
  // The log has answered, so the skeleton's work is done whatever the answer was.
  section?.setAttribute("aria-busy", "false");
  if (chip) {
    const state = coverageStatusChip(view);
    chip.className = state ? state.className : "badge";
    chip.textContent = state ? state.text : "";
    chip.hidden = !state;
  }
  if (toggle) {
    toggle.hidden = !view.actionable;
    // Stripped back to a bare control rather than merely hidden, the way the log's
    // own state action is: a page with nothing to reveal that still held "Show 0
    // uncovered releases" in its markup would answer a search for that text, and
    // "0 uncovered" is a figure posing as a finding.
    toggle.textContent = !view.actionable ? ""
      : uncoveredOnly ? SHOW_ALL_RELEASES_LABEL : revealGapsLabel(view.count);
    toggle.setAttribute("aria-pressed", String(uncoveredOnly));
  }
  // Announced only while the reveal is in play. A page that never narrowed has
  // nothing to announce, and saying so on every render would read out the whole
  // sentence for every keypress in the search box above.
  if (status) {
    const said = uncoveredOnly || status.textContent !== "" ? coverageGapAnnouncement({ ...view, uncoveredOnly }) : "";
    if (status.textContent !== said) status.textContent = said;
  }
  if (worklist) worklist.hidden = !(uncoveredOnly && view.actionable);
  // "0 of 0 releases have no decision" is a fraction posing as a finding, and an
  // empty log has no gap to lead into: the lead exists only where rows do.
  if (lead) lead.textContent = view.actionable ? coverageGapLead(view) : "";
  if (list) list.replaceChildren(...view.gaps.map((gap) => renderGapRow(gap)));
}

/**
 * Mount the reveal.
 *
 * The control is a real <button type="button"> in the markup, so activation,
 * role and the pressed state come from the platform; this only flips the page's
 * filter and moves focus. Focus lands on the worklist, which carries
 * `tabindex="-1"`: it is the head of the uncovered view, inside the release-log
 * panel and directly above the rows the press just narrowed. The panel's own h2
 * was the other candidate and is the wrong one — it stands above the count, the
 * search, four filters and the export, so a keyboard reader would land a dozen
 * tab stops from the thing that changed.
 *
 * A document without the control gets an inert handle back, so a surface that
 * mounts the releases page without this markup is unaffected.
 */
export function initReleaseCoverageGaps(root, options = {}) {
  const toggle = root.querySelector("#coverage-gap-toggle");
  let uncoveredOnly = false;
  let view = coverageGapView([], []);
  if (toggle) {
    toggle.addEventListener("click", () => {
      uncoveredOnly = !uncoveredOnly;
      // The page re-renders the log and calls back through update(), which is
      // what writes this block; the focus move happens after that so the region
      // being focused is holding the rows the press produced.
      options.onFilter?.(uncoveredOnly);
      root.querySelector("#coverage-gap-worklist")?.focus?.({ preventScroll: true });
    });
  }
  return {
    uncoveredOnly: () => uncoveredOnly,
    // Ids the log is narrowed to while the reveal is pressed.
    uncoveredIds: () => view.gaps.map((gap) => gap.id),
    update(releases, decisions, updateOptions = {}) {
      view = coverageGapView(releases, decisions, updateOptions);
      // A log that lost its last gap — a release recorded with a decision linked,
      // or a retry that restored the decision log — cannot stay narrowed to a
      // list that no longer exists.
      if (uncoveredOnly && !view.actionable) uncoveredOnly = false;
      renderCoverageGaps(root, view, uncoveredOnly);
      return view;
    },
  };
}
