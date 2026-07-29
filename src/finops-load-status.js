// The one status region the AI FinOps page loads with, and the vocabulary every
// other slot uses so it does not compete with it.
//
// THE PROBLEM THIS SOLVES. On a cold load this page said "Loading…" in twenty
// places at once: the hero provenance line, four slots in the score card, the
// guided result, the department list and its detail panel, four action facts,
// the trend and benchmark answers, the spend-mix summary, the portfolio count
// and its list, and the evaluation panel — plus a page-level load region at the
// very bottom, below the fold. A reader met a wall of progress messages and no
// answer, and a screen-reader user met several live regions describing the same
// single fetch. Worse, none of the twenty told them the one thing that was
// actually true and actionable: nothing of theirs is imported, and the control
// that changes that is a file picker further down the page.
//
// So the page now has exactly one dominant status region, `#finops-load-state`,
// authored directly under the hero and therefore inside the first viewport. It
// carries a visible label, a status word, a shape, one sentence, and one
// immediately available next action — "Choose files". Everything else on the
// page states what it *does not yet have* rather than narrating a load:
// "Not scored yet" is an answer, "Loading score…" is a progress bar with no bar.
//
// ---------------------------------------------------------------------------
// THE RULES THIS MODULE ENFORCES
// ---------------------------------------------------------------------------
//
// 1. ONE REGION NARRATES THE LOAD. Only `#finops-load-state` may say a load is
//    in progress. `competingLoadMessages` is the executable form of that rule:
//    it walks the document and returns every other slot whose own text reads as
//    progress. A test asserts the list is empty.
//
// 2. ANSWER FIRST, EVIDENCE SECOND. Every placeholder below opens on the state
//    ("Not scored yet") rather than on the machinery ("Reading the bundled
//    sample…"). The reason, the input, and the arithmetic follow it; they never
//    precede it.
//
// 3. A STATE IS NEVER COLOUR ALONE. Each state ships a word and a shape as well
//    as a tone. The shapes are the ones `panel-status-view.js` already
//    publishes — ◌ reading, ▣ computed, ▲ could not compute, ◇ awaiting input,
//    ▢ no records — so one glyph means one thing across the whole page.
//
// 4. THE NEXT ACTION IS ALWAYS OPERABLE. The action is a real `button` in the
//    region's own tab order, not a scroll hint or an anchor into a section. It
//    focuses the file input and opens the picker, so a keyboard and a pointer
//    reach the same next step in the same number of moves.
//
// Every string here is plain text and every node is built with createElement and
// textContent. Nothing in this module assigns markup.

/** Bump when a status word, a shape, or a placeholder changes meaning. */
export const LOAD_STATUS_VERSION = "finops-page-load-status/1.0.0";

/** The element ids this module owns. Nothing else writes them. */
export const LOAD_STATUS_IDS = Object.freeze({
  region: "finops-load-state",
  label: "finops-load-label",
  shape: "finops-load-shape",
  word: "finops-load-word",
  title: "finops-load-title",
  copy: "finops-load-copy",
  choose: "finops-choose-files",
  retry: "finops-data-retry",
});

/** The visible name of the region, so "status" is read rather than inferred. */
export const LOAD_STATUS_LABEL = "Page status";

/**
 * The one next action, available in every state.
 *
 * The label is the words the file field itself uses, so the button and the
 * control it opens are recognisably the same step rather than two.
 */
export const CHOOSE_FILES_ACTION = Object.freeze({
  label: "Choose files",
  targetId: "local-finops-files",
});

/**
 * The three lifecycle states of the page load, and how each one reads without
 * colour: a word, a shape, and the tone family that only repeats them.
 */
export const LOAD_PRESENTATION = Object.freeze({
  loading: Object.freeze({ state: "loading", word: "Reading", shape: "◌", tone: "neutral" }),
  ready: Object.freeze({ state: "ready", word: "Ready", shape: "▣", tone: "resolved" }),
  error: Object.freeze({ state: "error", word: "Could not load", shape: "▲", tone: "error" }),
});

/**
 * What the region says once the load has resolved and the question becomes
 * "whose numbers am I looking at?".
 *
 * The example copy is the page's no-import empty state, and it is deliberately
 * the loudest thing under the hero: a visitor must not be able to read a
 * synthetic $7,430 as their own spend because the only marker was a chip
 * further down.
 */
export const IMPORT_PRESENCE = Object.freeze({
  example: Object.freeze({
    title: "Nothing of yours is imported yet",
    detail: "Every figure on this page is bundled synthetic example data, not your spend. "
      + "Choose files to analyze your own provider export in this tab — "
      + "no upload, no credentials, no browser storage.",
  }),
  imported: Object.freeze({
    title: "This page is showing your imported analysis",
    detail: "Every figure below the import panel was computed in this tab from the files you "
      + "chose. Nothing was uploaded or stored. Choose files to add another period or an "
      + "org mapping.",
  }),
});

/**
 * What a slot says while it has no figure.
 *
 * One vocabulary, so a reader learns it once: every line names the measurement
 * that is missing and ends in "yet", which is the difference between a page
 * that has not been given a file and a page that is broken.
 */
export const SECONDARY_PLACEHOLDER = Object.freeze({
  organization: "Bundled example · organization not read yet",
  score: "Not scored yet",
  coverage: "Sampled-spend coverage not measured yet",
  scoreAction: "No action ranked yet",
  rubric: "Rubric and arithmetic not read yet",
  guidedFinding: "No next step ranked yet",
  provenance: "Sample provenance not read yet",
  departmentList: "No department ranked yet",
  actionTitle: "No intervention prioritized yet",
  actionStatus: "Not prioritized yet",
  actionRationale: "No intervention has been prioritized from the bundled example yet.",
  diagnosis: "No diagnosis yet",
  trend: "No comparison yet",
  benchmark: "No peer comparison yet",
  spendMix: "Spend mix not measured yet",
  portfolioCount: "No actions counted yet",
  portfolioTitle: "No action portfolio yet",
  portfolioCopy: "Savings targets and realized results appear once the action lifecycle is read.",
  evaluation: "No fixture scores read yet",
});

/**
 * The flag beside a metric that is not a measurement.
 *
 * A dash, a dashed border, or an amber tint are all one channel. These are the
 * other two: a word a screen reader reads and a shape a greyscale screenshot
 * keeps. The shapes match `panel-status-view.js` so ▲ never means two things.
 */
export const METRIC_FLAG = Object.freeze({
  unmeasured: Object.freeze({ shape: "◇", word: "unmeasured" }),
  notLoaded: Object.freeze({ shape: "▢", word: "not loaded" }),
  needsReview: Object.freeze({ shape: "▲", word: "needs review" }),
});

/**
 * The words that make a slot read as a load in progress.
 *
 * Deliberately narrow: these are the verbs the page actually used, matched as
 * whole words, so ordinary copy about "reading a briefing" is not swept up.
 */
export const LOAD_NARRATION = /\b(loading|counting|computing|connecting)\b|\breading\b[^.]*\b(sample|browser|file|fixture|analysis)\b/i;

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

/** A node's own text — its direct text children, not its descendants'. */
function ownText(node) {
  const children = node?.children ?? [];
  const direct = [];
  for (const child of children) {
    if (child?.nodeType === 3) direct.push(String(child.textContent ?? ""));
  }
  const text = direct.length ? direct.join(" ") : (children.length ? "" : String(node?.textContent ?? ""));
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Every slot outside the dominant region whose own text narrates a load.
 *
 * This is the rule "one region narrates the load" in a form a test can fail on.
 * It reports ids because an id is what a reviewer greps for; a slot with no id
 * is reported by its class instead, and an anonymous one by its tag.
 *
 * @param doc the document to walk.
 * @param options.dominantId the region that is allowed to narrate.
 * @param options.allow ids that are exempt (a genuine progress bar, say).
 */
export function competingLoadMessages(doc, { dominantId = LOAD_STATUS_IDS.region, allow = [] } = {}) {
  const root = doc?.querySelector ? doc.querySelector("body") : null;
  if (!root) return [];
  const exempt = new Set(allow);
  const found = [];
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (child?.nodeType !== 1) continue;
      if (child.id === dominantId) continue;
      const text = ownText(child);
      if (text && !exempt.has(child.id) && LOAD_NARRATION.test(text)) {
        found.push({ id: child.id || "", className: child.className || "", tagName: child.tagName, text });
      }
      visit(child);
    }
  };
  visit(root);
  return found;
}

/**
 * Paint the dominant region for one lifecycle state.
 *
 * The retry control belongs to the failure state only; the "Choose files"
 * action belongs to all three, because a reader whose bundled example failed to
 * load can still analyze their own file and that is the more useful next step.
 *
 * @returns the region, so a caller asserts on the state it asked for.
 */
export function applyPageLoadStatus(doc, { state = "loading", title = "", detail = "" } = {}) {
  const region = byId(doc, LOAD_STATUS_IDS.region);
  if (!region) return null;
  const presentation = LOAD_PRESENTATION[state] ?? LOAD_PRESENTATION.loading;

  region.dataset.state = presentation.state;
  region.dataset.tone = presentation.tone;
  setText(doc, LOAD_STATUS_IDS.shape, presentation.shape);
  setText(doc, LOAD_STATUS_IDS.word, presentation.word);
  if (title) setText(doc, LOAD_STATUS_IDS.title, title);
  if (detail) setText(doc, LOAD_STATUS_IDS.copy, detail);

  const retry = byId(doc, LOAD_STATUS_IDS.retry);
  if (retry) {
    retry.hidden = presentation.state !== "error";
    retry.disabled = presentation.state === "loading";
  }
  return region;
}

/**
 * Say whose numbers the page is showing, once the load has resolved.
 *
 * A no-op while the region is still reading or has failed: those two states own
 * the region and must not be overwritten by a panel repaint that happens to run
 * after them. That guard is why this is a separate call rather than a fourth
 * lifecycle state.
 */
export function applyImportPresence(doc, imported = false) {
  const region = byId(doc, LOAD_STATUS_IDS.region);
  if (!region || region.dataset.state !== "ready") return null;
  const copy = imported ? IMPORT_PRESENCE.imported : IMPORT_PRESENCE.example;
  region.dataset.import = imported ? "imported" : "example";
  setText(doc, LOAD_STATUS_IDS.title, copy.title);
  setText(doc, LOAD_STATUS_IDS.copy, copy.detail);
  return region;
}

/**
 * Wire the one next action.
 *
 * Focus first, then the picker: if the browser declines to open a file dialog
 * the reader is still standing on the control that does, which is the whole
 * point of naming one action rather than describing a place to scroll to.
 */
export function bindChooseFiles(doc, { targetId = CHOOSE_FILES_ACTION.targetId } = {}) {
  const button = byId(doc, LOAD_STATUS_IDS.choose);
  if (!button) return null;
  button.dataset.target = targetId;
  button.addEventListener("click", () => {
    const target = byId(doc, targetId);
    if (!target) return;
    target.focus?.({ preventScroll: true });
    target.click?.();
  });
  return button;
}

/**
 * Flag a metric slot that holds no measurement — or clear the flag.
 *
 * Clearing restores the default "unmeasured" wording rather than leaving the
 * last state's words in a hidden node, so a later surface that only toggles
 * `hidden` cannot reveal a stale verdict.
 *
 * @param key a key of `METRIC_FLAG`, or null to hide the flag.
 */
export function applyMetricFlag(doc, flagId, key = null) {
  const flag = byId(doc, flagId);
  if (!flag) return null;
  const copy = METRIC_FLAG[key] ?? METRIC_FLAG.unmeasured;
  const shape = element(doc, "span", "kpi-flag-shape", copy.shape);
  shape.setAttribute("aria-hidden", "true");
  flag.dataset.flag = METRIC_FLAG[key] ? key : "unmeasured";
  flag.replaceChildren(shape, doc.createTextNode(` ${copy.word}`));
  flag.hidden = !METRIC_FLAG[key];
  return flag;
}
