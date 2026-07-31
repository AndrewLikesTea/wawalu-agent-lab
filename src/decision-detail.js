// Decision-detail state model and renderer. State transitions are pure and live
// above the DOM layer so selection rules can be verified independently.

import { createShareControl } from "./share-link.js";
import { canonicalDecisionStatus } from "./decision-status.js";
import { EXAMPLE_LABEL } from "./seed-records.js";
import { indexSupersessions } from "./supersede.js";
import { releaseDetailHref, releaseStatus, releaseTitle } from "./releases.js";

export const MAX_COMPARISON_SELECTION = 2;
export const MAX_LINKED_RELEASES = 100;

const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const list = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
// Stored data can be edited outside the recorder. Keep route identifiers free
// of invisible controls and bound the copy this view will put into the DOM.
const UNSAFE_IDENTIFIER_CHARACTERS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const UNSAFE_DISPLAY_CHARACTERS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu;
const boundedText = (value, max) => {
  const normalized = text(value).replace(UNSAFE_DISPLAY_CHARACTERS, "");
  return normalized.length <= max ? normalized : normalized.slice(0, max);
};

export function normalizeAlternatives(decision) {
  if (Array.isArray(decision?.alternatives)) {
    return decision.alternatives.map((alternative, index) => ({
      id: text(alternative?.id, `alternative-${index + 1}`),
      name: text(alternative?.name, `Alternative ${index + 1}`),
      summary: text(alternative?.summary, "No summary recorded."),
      pros: list(alternative?.pros),
      cons: list(alternative?.cons),
      effort: text(alternative?.effort, "Not assessed"),
      risk: text(alternative?.risk, "Not assessed"),
      selected: alternative?.selected === true,
    }));
  }
  const legacy = text(decision?.alternatives);
  return legacy ? [{ id: "recorded-alternative", name: "Recorded alternative", summary: legacy, pros: [], cons: [], effort: "Not assessed", risk: "Not assessed", selected: false }] : [];
}

export function createComparisonState(alternatives) {
  const validIds = new Set(alternatives.map(({ id }) => id));
  const preferred = alternatives.filter(({ selected }) => selected).map(({ id }) => id);
  const selectedIds = [...new Set(preferred)].filter((id) => validIds.has(id)).slice(0, MAX_COMPARISON_SELECTION);
  return { selectedIds, comparisonVisible: false };
}

export function toggleAlternative(state, id, alternatives) {
  if (!alternatives.some((alternative) => alternative.id === id)) return state;
  const selectedIds = state.selectedIds.includes(id)
    ? state.selectedIds.filter((selectedId) => selectedId !== id)
    : [...state.selectedIds, id].slice(-MAX_COMPARISON_SELECTION);
  return { selectedIds, comparisonVisible: selectedIds.length === 2 && state.comparisonVisible };
}

export function toggleComparison(state) {
  return state.selectedIds.length === 2 ? { ...state, comparisonVisible: !state.comparisonVisible } : { ...state, comparisonVisible: false };
}

export function resolveDecisionDetail(decisions, id) {
  return (decisions ?? []).find((decision) => decision?.id === id) ?? null;
}

export function decisionDetailState({ id = "", decision = null, unavailable = false } = {}) {
  if (decision) return "available";
  if (unavailable) return "error";
  return id ? "not-found" : "empty";
}

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function renderBackLink() {
  const back = el("a", "detail-back", "← Back to Decisions");
  back.href = "/";
  return back;
}

// One primary state message per rendered first screen: a chip that names the
// state in words, one heading, and one sentence saying what happened. `tone`
// picks the chip's wash from the semantic set already used by the post detail —
// the word is the signal, the colour only agrees with it.
//
// `recoverable` is the retry rule, held in the model rather than inferred from
// the copy. Retrying is only an answer when a *read* failed and a second attempt
// could succeed. A decision that is not in this browser will not appear because
// the reader pressed a button again, and neither will one that was never named,
// so those states offer the labelled route back and nothing else — a Retry that
// cannot change the outcome is a promise the page cannot keep.
//
// Loading is not in this table. A wait is not a message: three lines of prose
// about what is being read, and about a failure that has not happened, were the
// first words a first-time visitor met, and they said nothing the reader could
// act on. The wait is drawn instead — see renderDecisionDetailSkeleton — and the
// only thing said out loud is the one line a screen reader needs.
export const DETAIL_STATE_COPY = {
  empty: {
    tone: "neutral",
    label: "No decision selected",
    title: "Choose a decision",
    description: "No decision was specified. Use “Back to Decisions” above to choose one from the log.",
    recoverable: false,
  },
  "not-found": {
    tone: "missing",
    label: "Not found",
    title: "Decision not found",
    description: "This decision may have been removed or is not recorded in this browser. Trying again will not find it — use “Back to Decisions” above to choose another record.",
    recoverable: false,
  },
  error: {
    tone: "error",
    label: "Request failed",
    title: "Decision couldn’t be loaded",
    description: "The decision log is temporarily unavailable, so this record didn’t load. Your browser data has not been changed, so trying again is safe.",
    recoverable: true,
  },
};

export const DECISION_RETRY_LABEL = "Retry loading this decision";

// The whole of what the wait says out loud. It names the region, not the
// mechanics, and it is the page's existing live-region convention — one polite
// `role="status"` line — rather than a second thing to read.
export const DECISION_SKELETON_STATUS = "Loading decision record";

export function isRecoverableDecisionState(state) {
  return DETAIL_STATE_COPY[state]?.recoverable === true;
}

const skeletonLine = (modifier) => el("div", modifier ? `skeleton-line ${modifier}` : "skeleton-line");

// The wait, drawn in the record's own layout.
//
// The shapes are built out of the classes the loaded record uses — the header
// grid, the metadata row, the alternatives grid — so the blocks stand where the
// heading, the status/owner line, and the alternative cards are about to be, and
// the panel does not jump when they arrive. They carry no words at all: they are
// `aria-hidden`, and the single visually-hidden status line above them is what a
// screen reader hears, the same way the feed and profile skeletons already work.
export function renderDecisionDetailSkeleton(container) {
  container.replaceChildren(renderBackLink());
  const panel = el("div", "detail-skeleton");
  panel.dataset.state = "loading";
  panel.dataset.recoverable = "false";
  panel.setAttribute("aria-busy", "true");

  // Offscreen, not absent. The record's own <h1> arrives with the record, and a
  // page that has no heading until then is a page a screen-reader user cannot
  // navigate by headings; the live region wraps it rather than repeating it, so
  // the wait is announced once and the document still has its one heading.
  const status = el("div", "visually-hidden");
  status.setAttribute("role", "status");
  const heading = el("h1", undefined, DECISION_SKELETON_STATUS);
  heading.id = "decision-state-title";
  status.append(heading);
  panel.append(status);

  const shapes = el("div", "decision-detail decision-detail-skeleton");
  shapes.setAttribute("aria-hidden", "true");

  const header = el("div", "decision-detail-header");
  header.append(skeletonLine("skeleton-line-eyebrow"), skeletonLine("skeleton-line-title"));
  const meta = el("div", "detail-meta decision-detail-meta");
  // Status, Owner, Recorded: the three rows the loaded header always draws.
  for (let index = 0; index < 3; index += 1) {
    const row = el("div", "detail-meta-row");
    row.append(skeletonLine("skeleton-line-label"), skeletonLine("skeleton-line-value"));
    meta.append(row);
  }
  header.append(meta);

  const alternatives = el("div", "decision-alternatives");
  alternatives.append(skeletonLine("skeleton-line-subtitle"));
  const grid = el("div", "alternative-grid");
  for (let index = 0; index < 2; index += 1) {
    const card = el("div", "alternative-card alternative-card-skeleton");
    card.append(skeletonLine("skeleton-line-subtitle"), skeletonLine(), skeletonLine("skeleton-line-short"));
    grid.append(card);
  }
  alternatives.append(grid);

  shapes.append(header, alternatives);
  panel.append(shapes);
  container.append(panel);
  return panel;
}

export function renderDecisionDetailState(container, state, { onRetry } = {}) {
  // One rendering of the wait, whichever door it is reached through: a caller
  // asking for "loading" gets the drawn skeleton, never a paragraph about it.
  if (state === "loading") return renderDecisionDetailSkeleton(container);
  const copy = DETAIL_STATE_COPY[state] ?? DETAIL_STATE_COPY.error;
  container.replaceChildren(renderBackLink());
  const panel = el("section", `detail-state detail-state-${state}`);
  panel.dataset.state = state;
  panel.dataset.recoverable = String(copy.recoverable === true);
  panel.setAttribute("aria-labelledby", "decision-state-title");
  panel.setAttribute("role", state === "error" ? "alert" : "status");
  // Focusable only by script: a retry replaces the control the reader was
  // standing on, and this panel is where they need to land next.
  panel.setAttribute("tabindex", "-1");
  const label = el("p", `detail-state-label detail-state-chip detail-state-chip-${copy.tone}`, copy.label);
  const title = el("h1", "detail-state-title", copy.title);
  title.id = "decision-state-title";
  panel.append(label, title, el("p", "detail-state-guidance", copy.description));
  // Actions come after the words that explain them, so a reader — and a tab
  // sequence — meets the reason before the button.
  if (copy.recoverable === true && typeof onRetry === "function") {
    const actions = el("div", "detail-state-actions");
    const retry = el("button", "empty-action detail-retry", DECISION_RETRY_LABEL);
    retry.type = "button";
    retry.addEventListener("click", onRetry);
    actions.append(retry);
    panel.append(actions);
  }
  container.append(panel);
  return panel;
}

function labelledList(title, values, kind) {
  const section = el("div", `alternative-points alternative-${kind}`);
  section.append(el("h4", undefined, title));
  if (!values.length) section.append(el("p", "detail-muted", "None recorded."));
  else {
    const ul = el("ul");
    for (const value of values) ul.append(el("li", undefined, value));
    section.append(ul);
  }
  return section;
}

function renderAlternative(alternative, checked, onChange, comparable) {
  const article = el("article", `alternative-card${comparable && checked ? " is-selected" : ""}`);
  const heading = el("div", "alternative-heading");
  heading.append(el("h3", undefined, alternative.name));
  // The compare affordance only appears when there is something to compare against.
  // A lone alternative (the shape recorded decisions carry today) would otherwise
  // show a checkbox that can never reach the two-selection threshold.
  if (comparable) {
    const label = el("label", "comparison-check");
    const input = el("input");
    input.type = "checkbox";
    input.checked = checked;
    input.dataset.alternativeId = alternative.id;
    input.setAttribute("aria-label", `Select ${alternative.name} for comparison`);
    input.addEventListener("change", () => onChange(alternative.id, input));
    label.append(input, el("span", undefined, "Compare"));
    heading.append(label);
  }
  article.append(heading, el("p", "alternative-summary", alternative.summary));
  const points = el("div", "alternative-points-grid");
  points.append(labelledList("Advantages", alternative.pros, "pros"), labelledList("Trade-offs", alternative.cons, "cons"));
  article.append(points);
  const facts = el("dl", "alternative-facts");
  for (const [name, value] of [["Effort", alternative.effort], ["Risk", alternative.risk]]) {
    const row = el("div"); row.append(el("dt", undefined, name), el("dd", undefined, value)); facts.append(row);
  }
  article.append(facts);
  return article;
}

function renderComparison(alternatives) {
  const section = el("section", "comparison-view");
  section.id = "alternative-comparison";
  section.tabIndex = -1;
  section.setAttribute("aria-labelledby", "comparison-title");
  section.append(el("h2", undefined, "Side-by-side comparison"));
  section.lastChild.id = "comparison-title";
  section.append(el("p", "comparison-key", "Different values are marked with a blue indicator."));
  const rows = [
    ["Summary", (item) => item.summary],
    ["Effort", (item) => item.effort],
    ["Risk", (item) => item.risk],
    ["Advantages", (item) => item.pros.join("; ") || "None recorded"],
    ["Trade-offs", (item) => item.cons.join("; ") || "None recorded"],
  ];
  const tableWrap = el("div", "comparison-table-wrap");
  const table = el("table", "comparison-table");
  const caption = el("caption", undefined, `${alternatives[0].name} compared with ${alternatives[1].name}`);
  const thead = el("thead"); const header = el("tr"); header.append(el("th", undefined, "Criterion"));
  for (const alternative of alternatives) { const th = el("th", undefined, alternative.name); th.scope = "col"; header.append(th); }
  thead.append(header); table.append(caption, thead);
  const tbody = el("tbody");
  for (const [label, getValue] of rows) {
    const values = alternatives.map(getValue); const differs = values[0] !== values[1]; const row = el("tr", differs ? "comparison-differs" : "");
    const th = el("th", undefined, label); th.scope = "row"; row.append(th);
    values.forEach((value) => { const td = el("td", undefined, value); if (differs) td.dataset.difference = "true"; row.append(td); });
    tbody.append(row);
  }
  table.append(tbody); tableWrap.append(table); section.append(tableWrap);
  return section;
}

const decisionHref = (id) => `/decision.html?id=${encodeURIComponent(id)}`;
const longDate = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(value));

// Titles reach the DOM as text nodes, never as markup: the same rule the rest of
// this renderer follows, so a title carrying a script tag or an onerror payload
// renders as the characters the author typed.
function decisionLink(target) {
  const link = el("a", "supersede-link", target.title);
  link.href = decisionHref(target.id);
  return link;
}

// One banner, above the recorded context and alternatives, announcing the state
// this decision is now in. It is the only place that state is stated on this
// page — the successor is reachable from the link inside it.
export function renderSupersededBanner(successor) {
  const banner = el("section", "supersede-banner");
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-labelledby", "supersede-banner-text");
  const line = el("p", "supersede-banner-text");
  line.id = "supersede-banner-text";
  line.append(document.createTextNode("Superseded by "), decisionLink(successor));
  const on = el("time", "supersede-banner-date", longDate(successor.createdAt));
  on.dateTime = successor.createdAt;
  line.append(document.createTextNode(" on "), on);
  banner.append(line);
  return banner;
}

// The other side of the same link is quieter by design: replacing an earlier
// decision is background, not an alert, so it opens closed and carries no status
// role. aria-expanded is kept in step with the native open state.
export function renderReplacesDisclosure(predecessor) {
  const disclosure = el("details", "supersede-disclosure");
  const summary = el("summary", "supersede-disclosure-summary", `Replaces ${predecessor.title}`);
  summary.setAttribute("aria-expanded", "false");
  disclosure.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(disclosure.open === true));
  });
  const body = el("p", "supersede-disclosure-body");
  body.append(decisionLink(predecessor));
  disclosure.append(summary, body);
  return disclosure;
}

// ---------------------------------------------------------------------------
// Linked releases: what shipped because of this decision.
//
// The shape lives above the DOM the same way the comparison state does, so the
// ordering rule and the summary sentence are verifiable without a browser. The
// releases arrive already associated (decision-page.js matches decisionIds);
// this layer only decides what is renderable, in what order, and what the
// section says about it.
// ---------------------------------------------------------------------------

// A release is renderable when it can be named and routed to: an id for the
// existing release detail route, and a version to name the link by. Everything
// else has a stated fallback so one malformed record never empties the section.
// A missing or unparseable date is kept and said out loud rather than dropped —
// the association is still true, only its position in time is unknown.
function normalizeLinkedRelease(release) {
  const id = text(release?.id);
  const version = boundedText(release?.version, 40);
  if (!id || id.length > 200 || UNSAFE_IDENTIFIER_CHARACTERS.test(id) || !version) return null;
  const createdAt = text(release?.createdAt);
  const dated = Boolean(createdAt) && !Number.isNaN(Date.parse(createdAt));
  const title = boundedText(releaseTitle(release), 120);
  return {
    id,
    version,
    // releaseTitle falls back to the version, which the link already shows.
    title: title === version ? "" : title,
    status: releaseStatus(release),
    createdAt: dated ? createdAt : "",
    dated,
    timestamp: dated ? Date.parse(createdAt) : 0,
    href: releaseDetailHref(id),
  };
}

// Newest first, undated last, one entry per release. A release that names this
// decision twice is one association, not two — the same rule the history rows
// follow.
export function normalizeLinkedReleases(releases) {
  const seen = new Set();
  const entries = [];
  for (const release of Array.isArray(releases) ? releases : []) {
    const entry = normalizeLinkedRelease(release);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length === MAX_LINKED_RELEASES) break;
  }
  return entries.sort((a, b) => Number(a.dated !== true) - Number(b.dated !== true) || b.timestamp - a.timestamp);
}

// One sentence a reader can take in without walking the list: how much shipped,
// and where the most recent of it stands. Takes normalized entries so the
// sentence can never disagree with the order the list is rendered in.
export function summarizeLinkedReleases(entries = []) {
  const [newest = null] = entries;
  if (!newest) return { count: 0, newest: null, text: "" };
  const count = `${entries.length} linked ${entries.length === 1 ? "release" : "releases"}`;
  const when = newest.dated ? ` on ${longDate(newest.createdAt)}` : " (date not recorded)";
  return { count: entries.length, newest, text: `${count}. Newest: ${newest.version} — ${newest.status}${when}.` };
}

const LINKED_RELEASE_UNDATED = "Date not recorded";

// Native anchors, one per release: keyboard reachability is the browser's job
// here, not a tabindex the view has to keep correct. Status and date sit outside
// the link so the accessible name stays the release itself, and are joined back
// to it with aria-describedby so a screen reader still hears them on focus.
function renderLinkedRelease(entry, index) {
  const item = el("li", `linked-release${index === 0 ? " linked-release-newest" : ""}`);
  const link = el("a", "linked-release-link");
  link.href = entry.href;
  link.append(el("span", "linked-release-version", entry.version));
  // A real separator character, not a gap: the accessible name is computed from
  // text, and flex spacing between two spans is not text. The version and the
  // title would otherwise be announced run together.
  if (entry.title) link.append(document.createTextNode(" · "), el("span", "linked-release-title", entry.title));
  const meta = el("p", "linked-release-meta");
  meta.id = `linked-release-meta-${index + 1}`;
  meta.append(el("span", `badge badge-release-${entry.status}`, entry.status));
  if (entry.dated) {
    const time = el("time", "linked-release-date", longDate(entry.createdAt));
    time.dateTime = entry.createdAt;
    meta.append(time);
  } else {
    meta.append(el("span", "linked-release-date linked-release-undated", LINKED_RELEASE_UNDATED));
  }
  link.setAttribute("aria-describedby", meta.id);
  item.append(link, meta);
  return item;
}

export function renderLinkedReleases(releases) {
  const section = el("section", "proof-relationship linked-releases");
  section.setAttribute("aria-labelledby", "linked-releases-title");
  const heading = el("h2", undefined, "Linked releases");
  heading.id = "linked-releases-title";
  section.append(heading);

  const entries = normalizeLinkedReleases(releases);
  // The absence is stated rather than hidden: a decision with nothing shipped
  // yet is a real answer, and silence reads as a page that failed to load.
  if (!entries.length) {
    section.append(el("p", "detail-muted", "No releases link to this decision yet."));
    return section;
  }

  const summary = el("p", "linked-release-summary", summarizeLinkedReleases(entries).text);
  summary.id = "linked-releases-summary";
  section.append(summary);
  const list = el("ul", "linked-release-list");
  // The order is meaningful, so it is stated, not left to be inferred visually.
  list.setAttribute("aria-label", "Linked releases, newest first");
  entries.forEach((entry, index) => list.append(renderLinkedRelease(entry, index)));
  section.append(list);
  return section;
}

export function renderDecisionDetail(container, decision, options = {}) {
  container.replaceChildren(renderBackLink());
  if (!decision) {
    renderDecisionDetailState(container, decisionDetailState(options), options);
    return;
  }

  const alternatives = normalizeAlternatives(decision);
  let state = createComparisonState(alternatives);
  const view = el("article", "decision-detail");
  // Where focus lands when a retry finally resolves the record. Script-only, so
  // it never adds a stop to the reader's own tab sequence.
  view.setAttribute("tabindex", "-1");
  const header = el("header", "decision-detail-header");
  const heading = el("div", "detail-heading");
  heading.append(el("p", "eyebrow", "Engineering decision"), el("h1", undefined, decision.title));
  // The list row says this too, but a reader who pasted the URL never saw the
  // list. Same badge, same words, in the record's own header.
  if (options.example === true) heading.append(el("span", "badge badge-example", EXAMPLE_LABEL));
  if (options.shareable) {
    const share = createShareControl({ type: "decision", id: decision.id });
    if (share) heading.append(share);
  }
  header.append(heading);
  const meta = el("dl", "detail-meta decision-detail-meta");
  const created = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(decision.createdAt));
  // The detail page shows the same word the list row does, so the legacy
  // "approved" is read as "accepted" here too.
  const statusWord = canonicalDecisionStatus(decision.status);
  for (const [label, value, className] of [["Status", statusWord, `badge badge-${statusWord}`], ["Owner", decision.owner], ["Recorded", created]]) {
    const row = el("div", "detail-meta-row"); row.append(el("dt", "detail-meta-label", label), el("dd", `detail-meta-value ${className ?? ""}`, value)); meta.append(row);
  }
  header.append(meta); view.append(header);

  // Both directions of the supersede link are derived from the surrounding log
  // (options.decisions), never read off this record: only `supersedes` is
  // stored, and it points the other way.
  const { supersededBy, replaces } = indexSupersessions(
    Array.isArray(options.decisions) ? options.decisions : [decision],
  );
  const successor = supersededBy.get(decision.id) ?? null;
  const predecessor = replaces.get(decision.id) ?? null;
  if (successor) view.append(renderSupersededBanner(successor));
  if (predecessor) view.append(renderReplacesDisclosure(predecessor));

  if (normalizeLinkedReleases(options.linkedReleases).length) {
    view.append(renderLinkedReleases(options.linkedReleases));
  }
  const context = el("section", "decision-context"); context.setAttribute("aria-labelledby", "context-title");
  context.append(el("h2", undefined, "Context and rationale"), el("p", undefined, decision.context)); context.firstChild.id = "context-title"; view.append(context);
  const alternativesSection = el("section", "decision-alternatives"); alternativesSection.setAttribute("aria-labelledby", "alternatives-title");
  const sectionHead = el("div", "decision-section-heading"); sectionHead.append(el("div"));
  sectionHead.firstChild.append(el("p", "eyebrow", `${alternatives.length} ${alternatives.length === 1 ? "option" : "options"}`), el("h2", undefined, "Alternatives considered"));
  sectionHead.querySelector("h2").id = "alternatives-title";
  const comparable = alternatives.length >= MAX_COMPARISON_SELECTION;
  let status, button;
  if (comparable) {
    const controls = el("div", "comparison-controls");
    status = el("p", "comparison-status", "Select two alternatives to compare."); status.id = "comparison-status"; status.setAttribute("aria-live", "polite");
    button = el("button", "comparison-toggle", "Compare selected"); button.type = "button"; button.disabled = true; button.setAttribute("aria-controls", "alternative-comparison"); button.setAttribute("aria-expanded", "false");
    controls.append(status, button); sectionHead.append(controls);
  }
  alternativesSection.append(sectionHead);
  const cards = el("div", "alternative-grid"); const comparisonSlot = el("div");
  const update = ({ focusComparison = false, focusAlternative = "" } = {}) => {
    cards.replaceChildren();
    if (!alternatives.length) cards.append(el("p", "detail-empty-copy", "No alternatives were recorded for this decision."));
    for (const alternative of alternatives) cards.append(renderAlternative(alternative, state.selectedIds.includes(alternative.id), (id) => { state = toggleAlternative(state, id, alternatives); update({ focusAlternative: id }); }, comparable));
    if (comparable) {
      button.disabled = state.selectedIds.length !== 2;
      button.textContent = state.comparisonVisible ? "Hide comparison" : "Compare selected";
      button.setAttribute("aria-expanded", String(state.comparisonVisible));
      status.textContent = state.selectedIds.length === 2 ? "Two alternatives selected. Ready to compare." : `${state.selectedIds.length} of 2 alternatives selected.`;
      comparisonSlot.replaceChildren();
      if (state.comparisonVisible) {
        const selected = state.selectedIds.map((id) => alternatives.find((alternative) => alternative.id === id));
        const comparison = renderComparison(selected); comparisonSlot.append(comparison); if (focusComparison) comparison.focus();
      }
    }
    if (focusAlternative) cards.querySelector(`[data-alternative-id="${CSS.escape(focusAlternative)}"]`)?.focus();
  };
  if (comparable) button.addEventListener("click", () => { state = toggleComparison(state); update({ focusComparison: state.comparisonVisible }); });
  alternativesSection.append(cards, comparisonSlot); view.append(alternativesSection); container.append(view); update();
}
