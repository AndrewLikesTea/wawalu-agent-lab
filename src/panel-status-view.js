// One visual treatment for every state an executive panel can be in.
//
// THE PROBLEM THIS SOLVES. The AI FinOps page grew a state treatment per panel:
// the KPI cards flag "unmeasured" with a diamond, the score card goes dashed and
// amber under `data-band="review"`, the contract note draws a grey dashed box,
// the import panel has its own green/amber/red family, and the department table
// says "unavailable sample" in prose. Five vocabularies for one idea. A leader
// reading down the page cannot tell whether a panel is quiet because it is still
// reading a file, quiet because nothing was imported, or quiet because something
// broke — and the third reading is the one they act on, because a blank panel
// looks broken by default.
//
// So this module owns the vocabulary and nothing else. It decides no
// eligibility, reads no file, computes no figure, and holds no state. It is
// handed a status and a provenance record and paints them.
//
// ---------------------------------------------------------------------------
// THE RULES IT ENFORCES
// ---------------------------------------------------------------------------
//
// 1. UNAVAILABLE IS NOT BROKEN. `unavailable` and `empty` are drawn in the
//    page's neutral inks — the same family as a caption — and never in
//    `--state-error-*`. Red is reserved for `error`, which is the only status
//    that means something went wrong. An unanswerable panel is a trustworthy
//    panel that is waiting for an input, and it has to look like one, because a
//    leader who reads "broken" stops trusting the panels beside it too.
//
// 2. COLOR NEVER CARRIES MEANING ALONE. Every status ships a word, a shape, and
//    a chip silhouette. Screenshot the page in greyscale and all six states are
//    still distinguishable: the words differ, the glyphs differ, and filled and
//    outlined chips differ. The tone is the fourth channel, never the first.
//
// 3. THE CHIP SILHOUETTE FOLLOWS THE DESIGN SYSTEM. `review-08-foundations`
//    sets the rule: filled wash = dynamic signal, outline = static
//    classification. `loading`, `partial`, and `error` are signals that move
//    while the reader watches or acts, so they are filled. `computed`,
//    `unavailable`, and `empty` are classifications of this panel against this
//    import — stable until the reader brings a new file — so they are outlined.
//
// 4. ASSISTIVE TECHNOLOGY IS NOT INTERRUPTED BY AN ABSENCE. Only `error`
//    carries `role="alert"`. `loading` carries `role="status"` because a wait
//    that ends is worth one polite announcement. Everything else — including
//    every unavailable panel — is a `role="note"`: it is read where it sits, in
//    reading order, and never barges in. Six unanswerable panels on one page
//    would otherwise fire six alerts at a screen-reader user who has done
//    nothing wrong.
//
// 5. NO NEW TOKENS. Every colour, size, and space this module's class names
//    resolve to already ships in `evolution.css` or `styles.css`. The mirror in
//    `design-system/claude-design/` is read, never edited.
//
// Every node is built with createElement and textContent; the site policy
// forbids executing user-generated markup and nothing here assigns any.

/** Bump when a status word, a shape, or a provenance key changes meaning. */
export const PANEL_STATUS_VERSION = "executive-panel-status/1.0.0";

/** The six reading states a panel can be in. There is no seventh. */
export const PANEL_STATUS = Object.freeze({
  loading: "loading",
  computed: "computed",
  partial: "partial",
  unavailable: "unavailable",
  empty: "empty",
  error: "error",
});

const FILLED = "filled";
const OUTLINE = "outline";

/**
 * The presentation of each status: the word a reader sees, the glyph beside it,
 * the chip silhouette, the tone family, and the ARIA role its message takes.
 *
 * `word` is deliberately not the status key. "Unavailable" is a verdict about
 * the product; "Awaiting input" is a statement about the file the reader has not
 * brought yet, and only one of those two is true.
 */
const PRESENTATION = Object.freeze({
  [PANEL_STATUS.loading]: Object.freeze({
    word: "Reading", shape: "◌", silhouette: FILLED, tone: "neutral", role: "status",
    summary: "Reading your file in this tab. Nothing has been uploaded or stored.",
  }),
  [PANEL_STATUS.computed]: Object.freeze({
    word: "Computed", shape: "▣", silhouette: OUTLINE, tone: "resolved", role: "note",
    summary: "Every declared input for this panel is present.",
  }),
  [PANEL_STATUS.partial]: Object.freeze({
    word: "Partly attributed", shape: "◧", silhouette: FILLED, tone: "warn", role: "note",
    summary: "This figure covers part of the imported spend. The uncovered part is not counted against anyone.",
  }),
  [PANEL_STATUS.unavailable]: Object.freeze({
    word: "Awaiting input", shape: "○", silhouette: OUTLINE, tone: "neutral", role: "note",
    summary: "The question is still on the page. One named input answers it.",
  }),
  [PANEL_STATUS.empty]: Object.freeze({
    word: "No records", shape: "▢", silhouette: OUTLINE, tone: "neutral", role: "note",
    summary: "Every row was read and none of them belong to this panel.",
  }),
  [PANEL_STATUS.error]: Object.freeze({
    word: "Could not compute", shape: "▲", silhouette: FILLED, tone: "error", role: "alert",
    summary: "This panel failed to derive its figure. Nothing you selected was uploaded or stored.",
  }),
});

/** The presentation for one status, falling back to the honest neutral state. */
export function panelStatusPresentation(status) {
  const key = PRESENTATION[status] ? status : PANEL_STATUS.unavailable;
  return Object.freeze({ status: key, ...PRESENTATION[key] });
}

// ---------------------------------------------------------------------------
// Provenance: the four facts a computed figure owes its reader.
// ---------------------------------------------------------------------------

/**
 * The bounds past which a provenance fact is reported as suspect rather than
 * printed as fact.
 *
 * A coverage of 137% is not a very good coverage; it is a broken join, and a
 * panel that renders it as a number has told the reader a confident lie. These
 * are display bounds only — nothing here changes what any other module computed.
 */
export const PROVENANCE_LIMITS = Object.freeze({
  /** More rows than any browser parsed in a tab. */
  maxRecords: 50_000_000,
  /** Coverage is a share of dollars; a share outside [0,1] is a defect. */
  minCoverage: 0,
  maxCoverage: 1,
  /** A period longer than a decade is a mis-parsed date, not a long invoice. */
  maxPeriodDays: 3660,
});

/** The confidence words. `unstated` is a real answer; a blank is not. */
const CONFIDENCE_WORDS = Object.freeze({
  high: "High", medium: "Medium", low: "Low", unstated: "Unstated",
});

const groups = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const words = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Normalize whatever the analysis layer holds into the four facts a reader
 * scans, plus the caveats that keep an implausible one from reading as measured.
 *
 * Nothing here is required. A panel that knows its record count and nothing else
 * shows one fact rather than four blanks, because a blank in a provenance row
 * reads as a zero.
 *
 * @param input.records how many rows, prompts, or members fed this panel.
 * @param input.unit what one record is, in this panel's own unit.
 * @param input.period the period the records cover, already formatted.
 * @param input.periodDays the span of that period, when the caller knows it.
 * @param input.coverage attributed share in [0,1].
 * @param input.confidence one of high | medium | low.
 * @param input.detail the secondary sentence, disclosed rather than printed.
 */
export function panelProvenance({
  records = null, unit = "record", period = null, periodDays = null,
  coverage = null, confidence = null, detail = null,
} = {}) {
  const facts = [];
  const caveats = [];

  const count = finite(records);
  if (count !== null) {
    const noun = `${words(unit) ?? "record"}${count === 1 ? "" : "s"}`;
    if (count < 0) {
      caveats.push("The record count came back negative, so it is not shown. This is a defect in the import, not in your file.");
    } else if (count > PROVENANCE_LIMITS.maxRecords) {
      facts.push({ key: "records", label: "Records", value: `${groups.format(count)} ${noun}`, implausible: true });
      caveats.push(`${groups.format(count)} ${noun} is past the ${groups.format(PROVENANCE_LIMITS.maxRecords)} a single tab can honestly parse. Treat this panel as unverified.`);
    } else {
      facts.push({ key: "records", label: "Records", value: `${groups.format(count)} ${noun}`, implausible: false });
    }
  }

  const span = words(period);
  if (span) {
    const days = finite(periodDays);
    const impossible = days !== null && (days <= 0 || days > PROVENANCE_LIMITS.maxPeriodDays);
    facts.push({ key: "period", label: "Period", value: span, implausible: impossible });
    if (impossible) {
      caveats.push(`The period spans ${groups.format(days)} days, which no provider export covers. Check the date column mapping before quoting this panel.`);
    }
  }

  const share = finite(coverage);
  if (share !== null) {
    const clamped = Math.min(PROVENANCE_LIMITS.maxCoverage, Math.max(PROVENANCE_LIMITS.minCoverage, share));
    const outside = share !== clamped;
    facts.push({
      key: "coverage",
      label: "Coverage",
      value: `${percent.format(clamped)} of dollars attributed`,
      implausible: outside,
    });
    if (outside) {
      caveats.push(`Attributed spend came back at ${percent.format(share)} of total, which cannot happen. The figure is shown clamped to ${percent.format(clamped)} and should not be quoted.`);
    }
  }

  const level = words(confidence)?.toLowerCase() ?? null;
  if (level !== null) {
    const known = Object.hasOwn(CONFIDENCE_WORDS, level);
    facts.push({
      key: "confidence",
      label: "Confidence",
      value: CONFIDENCE_WORDS[known ? level : "unstated"],
      implausible: false,
    });
  }

  return Object.freeze({
    facts: Object.freeze(facts.map((fact) => Object.freeze(fact))),
    caveats: Object.freeze(caveats),
    implausible: facts.some((fact) => fact.implausible),
    detail: words(detail),
  });
}

// ---------------------------------------------------------------------------
// Painting.
// ---------------------------------------------------------------------------

const BLOCK = "panel-status";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The chip: a shape, a word, and a silhouette. Read it in greyscale and it still
 * says which of the six states this is.
 */
function chip(doc, presentation) {
  const node = element(doc, "span", `${BLOCK}-chip`);
  node.dataset.silhouette = presentation.silhouette;
  // The glyph is a second visual channel for a sighted reader, not a second
  // reading for a screen reader — the word beside it already says the state.
  const shape = element(doc, "span", `${BLOCK}-shape`, presentation.shape);
  shape.setAttribute("aria-hidden", "true");
  node.append(shape, element(doc, "span", `${BLOCK}-word`, presentation.word));
  return node;
}

/**
 * The facts row: record count, period, coverage, confidence — the four things a
 * leader needs before they will repeat a number in a board meeting, in one line
 * they can take in without stopping.
 *
 * A definition list rather than four spans, so a screen reader reads
 * "Coverage, 82% of dollars attributed" instead of two unlabelled fragments.
 */
function factsList(doc, facts) {
  const list = element(doc, "dl", `${BLOCK}-facts`);
  for (const fact of facts) {
    const pair = element(doc, "div", `${BLOCK}-fact`);
    pair.dataset.fact = fact.key;
    if (fact.implausible) pair.dataset.implausible = "true";
    pair.append(
      element(doc, "dt", undefined, fact.label),
      element(doc, "dd", undefined, fact.implausible ? `${fact.value} · check this` : fact.value),
    );
    list.append(pair);
  }
  return list;
}

const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/**
 * The blocks a panel leads with before it shows anything measured: its eyebrow,
 * its heading, its own label. The status block goes after them and before the
 * first figure, which is where a reader is asking "and can I believe this?".
 */
const LEADING = ["eyebrow", "section-heading", "kpi-label", "portfolio-intro"];

/** Element children only, whether `children` is an array or an HTMLCollection. */
const childElements = (node) => Array.from(node?.children ?? [])
  .filter((child) => child?.nodeType === 1);

function leading(node) {
  if (HEADINGS.has(node.tagName)) return true;
  const names = String(node.className ?? "").split(/\s+/);
  return LEADING.some((name) => names.includes(name));
}

/**
 * The panel's own status block, created once and reused.
 *
 * It is inserted after the panel's heading and before its first figure, so the
 * state is read as part of meeting the panel rather than as a footnote under a
 * number the reader has already believed. Reused rather than recreated so a
 * repaint never moves a focused control or reorders the tab sequence — a page
 * that recalculates on every filter change must not drop the reader's focus.
 */
function blockFor(doc, panel, panelId) {
  const id = `${panelId}-status`;
  const existing = byId(doc, id);
  if (existing && existing.parentNode === panel) return existing;
  const node = element(doc, "div", BLOCK);
  node.id = id;
  const anchor = childElements(panel).find((child) => !leading(child));
  if (anchor) panel.insertBefore(node, anchor);
  else panel.append(node);
  return node;
}

/**
 * Paint one panel's status.
 *
 * @param entry.panelId the element id of the panel section.
 * @param entry.status one of `PANEL_STATUS`.
 * @param entry.summary the one sentence describing this state, when the caller
 *   has a better one than the default.
 * @param entry.provenance a `panelProvenance` result, or null.
 * @param entry.action `{ label, text }` — the one thing the reader does next.
 * @param entry.priority "primary" for the single action the page leads with.
 * @param entry.announce false when the page already owns the announcement for
 *   this change. A whole surface going to `error` at once must not fire one
 *   alert per panel: the page has a single load-state region with the retry in
 *   it, and nine alerts for one failed fetch is the interruption rule 4 exists
 *   to prevent. The word, the glyph, and the tone are unchanged — only the
 *   live-region role steps down to `note`.
 * @returns the block that was painted, so a caller can assert on the state it
 *   asked for rather than on the DOM it got.
 */
export function applyPanelStatus(doc, entry = {}) {
  const panel = byId(doc, entry.panelId);
  if (!panel) return null;
  const presentation = panelStatusPresentation(entry.status);
  const provenance = entry.provenance ?? panelProvenance();
  const block = blockFor(doc, panel, entry.panelId);

  panel.dataset.panelStatus = presentation.status;
  // Only a panel that is genuinely mid-read is busy. An unanswerable panel is
  // finished, not working, and telling a screen reader otherwise makes it wait
  // for an update that never comes.
  if (presentation.status === PANEL_STATUS.loading) panel.setAttribute("aria-busy", "true");
  else panel.removeAttribute("aria-busy");

  block.dataset.status = presentation.status;
  block.dataset.tone = presentation.tone;
  if (provenance.implausible) block.dataset.implausible = "true";
  else delete block.dataset.implausible;

  const summary = element(doc, "p", `${BLOCK}-line`);
  summary.setAttribute("role", entry.announce === false ? "note" : presentation.role);
  summary.append(chip(doc, presentation),
    element(doc, "span", `${BLOCK}-summary`, entry.summary ?? presentation.summary));

  const children = [summary];
  if (provenance.facts.length) children.push(factsList(doc, provenance.facts));

  // The caveat sits above the disclosure, never inside it: a number that must
  // not be quoted cannot be the thing behind a control nobody presses.
  for (const caveat of provenance.caveats) {
    children.push(element(doc, "p", `${BLOCK}-caveat`, caveat));
  }

  if (entry.action?.text) {
    const next = element(doc, "p", `${BLOCK}-next`);
    next.dataset.priority = entry.priority === "primary" ? "primary" : "secondary";
    next.append(
      element(doc, "span", `${BLOCK}-next-label`,
        entry.priority === "primary" ? "Start here" : (entry.action.label ?? "Needed next")),
      element(doc, "span", `${BLOCK}-next-text`, entry.action.text),
    );
    children.push(next);
  }

  // Progressive disclosure, and the last thing in the block so the keyboard
  // reaches it after the facts it expands on. `details` is natively focusable
  // and carries its own expanded state, so nothing here adds a tabindex or a
  // handler that a reader's own browser does better.
  if (provenance.detail) {
    const detail = element(doc, "details", `${BLOCK}-detail`);
    detail.append(element(doc, "summary", undefined, "How this panel was derived"),
      element(doc, "p", undefined, provenance.detail));
    children.push(detail);
  }

  block.replaceChildren(...children);
  return block;
}

/**
 * Paint every panel's status, and mark exactly one next action as the page's.
 *
 * Priority is contract order, not severity: the panels are declared in the order
 * a leader meets them, so the first one that is waiting on an input is the one
 * whose file unblocks the most reading. Marking a second would be a backlog, and
 * a board reader with two "start here" labels starts at neither.
 */
export function applyPanelStatuses(doc, entries = []) {
  const waiting = entries.findIndex((entry) => entry?.action?.text
    && (entry.status === PANEL_STATUS.unavailable || entry.status === PANEL_STATUS.partial
      || entry.status === PANEL_STATUS.empty));
  return entries
    .map((entry, index) => applyPanelStatus(doc,
      { ...entry, priority: index === waiting ? "primary" : "secondary" }))
    .filter(Boolean);
}
