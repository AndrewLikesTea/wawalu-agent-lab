// Paint the "where do we stand?" headline into the slots evolution.html authors.
//
// The markup ships in its pending state and is never replaced: the region, its
// heading, its five headline slots, and all six disclosure controls are in the
// document before any script runs. A reader whose JavaScript failed still meets
// a coherent region with operable, keyboard-reachable disclosures rather than an
// empty box — which for native `details` costs nothing, because the browser
// already implements every part of the interaction.
//
// Nothing here assigns markup. Every string arrives through `textContent` and
// every node is built with `createElement`, because these strings include
// department names and reason sentences taken out of a reader's own import.

import {
  STAND_DISCLOSURE_ORDER, STAND_DISCLOSURE_SUMMARY, STAND_IDS, STAND_MOUNTED_DISCLOSURES,
  STAND_RESOLUTION_ACTION, STAND_SAMPLE_MARKER,
} from "./finops-stand.js";
import { applyFinopsSpine } from "./finops-spine.js";
// The screen contract, executable. Every string in the answer block and every
// door name beside it comes from here rather than from this file, so
// docs/executive-answer-screen-contract.md and the page cannot drift.
import {
  DECISION_SUMMARY, DECISION_SUMMARY_IDS, SCREEN_CONTRACT, answerBlock,
} from "./finops-screen-contract.js";
// The bundled answer, precomputed. `applyAnswerBlock` paints from this by
// default, so the first thing a reader meets needs no panel dataset composed.
import { FINOPS_ANSWER_SUMMARY } from "./finops-answer-summary.js";
// The page's one announcer. Every answer change on /evolution.html is announced
// from here, in one sentence, because it used to be announced from nine regions
// at once and a reader heard a queue instead of an answer.
import { announceAnswer, answerAnnouncement } from "./finops-answer-announcement.js";
// Whether the answer still reproduces from the pinned example, as one sentence.
// Read from the artifact the check writes, never composed here and never dated
// here — see the module for what the sentence may and may not claim.
import { ANSWER_REPRODUCTION } from "./finops-answer-reproduction.js";

/** The state chip, in the same two channels the rest of this page uses. */
export const STAND_DISCLOSURE_STATE = Object.freeze({
  expanded: Object.freeze({ shape: "▾", action: "Hide" }),
  collapsed: Object.freeze({ shape: "▸", action: "Show" }),
});

/** The ids of one disclosure, derived from its key. Authored the same way in HTML. */
export function standDisclosureIds(key) {
  const root = `finops-stand-disclosure-${key}`;
  return Object.freeze({
    details: root, summary: `${root}-summary`, heading: `${root}-heading`,
    state: `${root}-state`, list: `${root}-list`,
  });
}

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/**
 * The ids the answer block owns. Authored in evolution.html, written only here,
 * and DECLARED in the screen contract — `DECISION_SUMMARY` names the one region
 * that may answer on its own and the four parts it answers with, so this map is
 * derived from that declaration rather than restating it. A slot the contract
 * does not declare cannot be painted from this file.
 */
export const ANSWER_BLOCK_IDS = DECISION_SUMMARY_IDS;

/** The figure's authored pending wording per slot, so a paint can fall back to it. */
const FIGURE_AUTHORED = Object.freeze(Object.fromEntries(
  Object.entries(DECISION_SUMMARY.parts.find((part) => part.role === "metric")?.slots ?? {})
    .map(([key, { authored }]) => [key, authored])));

/** The reproduction line's id. Authored in evolution.html, written only here. */
export const ANSWER_REPRODUCTION_ID = "finops-answer-reproduction";

/**
 * Paint the reproduction line: does this answer still come out the same?
 *
 * MOUNTED, NOT AUTHORED, for the reason the provenance disclosure above it is:
 * the decision summary's contract is four parts and nothing else in the shipped
 * document, and this sentence is a qualifier on the third of them rather than a
 * fifth thing to read. It is built once, immediately before the one action, so
 * a reader meets it with the confidence sentence it qualifies and ahead of the
 * step it bounds. Nothing is lost with JavaScript off: the figure it qualifies
 * is painted by this same file, so the number and its qualifier arrive together
 * or neither arrives.
 *
 * Painted from the artifact rather than from the summary — the claim is about
 * the RULES that produced the figure, so it is equally true of the bundled
 * example and of a reader's own import — and unconditional, so a paint that
 * arrived with no payload cannot leave the qualifier off. `data-checked` carries
 * the same fact in the channel a stylesheet, a printed page and a test read, so
 * "we could not confirm this" is never carried by wording alone.
 *
 * `textContent`, on a string the reproduction module authored: no fixture value
 * is interpolated into markup here or anywhere above it.
 */
export function applyAnswerReproduction(doc, line = ANSWER_REPRODUCTION) {
  const block = byId(doc, ANSWER_BLOCK_IDS.block);
  if (!block || !doc.createElement) return null;
  let node = byId(doc, ANSWER_REPRODUCTION_ID);
  if (!node) {
    node = doc.createElement("p");
    node.className = "answer-reproduction";
    node.id = ANSWER_REPRODUCTION_ID;
    const action = byId(doc, ANSWER_BLOCK_IDS.action);
    if (action && action.parentNode === block) block.insertBefore(node, action);
    else block.append(node);
  }
  node.dataset.checked = String(line?.available === true);
  node.textContent = line?.text ?? "";
  return node;
}

/** The evidence line's own ids. Authored in evolution.html, written only here. */
export const ANSWER_EVIDENCE_IDS = Object.freeze({
  /** The line the answer figure's `aria-describedby` resolves to. */
  line: "finops-answer-evidence",
  chip: "finops-answer-evidence-chip",
  text: "finops-answer-evidence-text",
});

/** The attribute exactly one supporting panel may carry, as a dataset key. */
const EVIDENCE_MARK = "headlineEvidence";

/**
 * WHERE THE ONE NUMBER CAME FROM, one step down from the number.
 *
 * A disclosure key, not a member of `STAND_DISCLOSURE_ORDER`: this one lives
 * INSIDE `#finops-answer` rather than in the disclosure container further down
 * the region, because it explains the answer block's own two figures and a
 * reader who has to scroll past four other layers to find it is being asked to
 * go looking. It is built to the same shape as every other disclosure on this
 * region — same class, same derived ids, same `aria-expanded`/`aria-controls`
 * pair, same state chip painted by `paintStandDisclosureState` — so it is one
 * disclosure mechanism on this page, not two.
 *
 * IT CARRIES NO LINK. tests/finops-page-structure.test.js requires the decision
 * summary to hold exactly one anchor, which is the one next action; a second
 * operable destination in here would be the ranking decision handed back.
 */
export const ANSWER_PROVENANCE_KEY = "answer-provenance";

/** The trigger names what is behind it. "Details" would name nothing. */
export const ANSWER_PROVENANCE_LABEL =
  "Where these numbers came from — inputs, sample size, method, and when";

/** The figures the disclosure explains, in the order the block states them. */
const PROVENANCE_FIGURES = Object.freeze(["headlineMetric", "nextAction"]);

/** The same formatters the rest of this page reads counts and instants with. */
const PROVENANCE_COUNT = new Intl.NumberFormat("en-US");
const PROVENANCE_INSTANT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium", timeStyle: "short",
});

/** An instant a reader can check a meeting against, or null. Never epoch millis. */
function readableInstant(iso) {
  const date = iso ? new Date(iso) : null;
  return date && Number.isFinite(date.getTime()) ? PROVENANCE_INSTANT.format(date) : null;
}

/**
 * One figure's record as `<dt>`/`<dd>` rows.
 *
 * EVERY DEGENERATE CASE IS A SENTENCE. A figure that read no input and no row
 * gets ONE row saying so — not an empty list, not a bare "0", and not a
 * timestamp attached to nothing. A figure that has inputs but read no rows says
 * that in the sample row, in words, and keeps the other three.
 */
function provenanceRows(record) {
  const name = record?.label ?? record?.figure ?? "This figure";
  if (!record || record.empty) {
    return [{ term: name, detail: "Nothing has been read for this figure yet, so there is no "
      + "input, no sample, no method, and no time to report behind it." }];
  }
  const count = record.samples?.count ?? null;
  const unit = record.samples?.unit ?? "record";
  const instant = readableInstant(record.computedAt);
  return [
    { term: `${name} · inputs`,
      detail: record.inputs.length
        ? record.inputs.join(", ")
        : "No named input reached this figure; it was decided from the export's state alone." },
    { term: `${name} · sample`,
      detail: count === null
        ? "No sample count was recorded for this figure."
        : count === 0
          ? `No ${unit}s were read for this figure, so nothing was counted into it.`
          : `${PROVENANCE_COUNT.format(count)} ${unit}${count === 1 ? "" : "s"}` },
    { term: `${name} · method`,
      detail: record.method?.label ?? "No published rule states how this figure was computed." },
    { term: `${name} · computed`,
      detail: instant ?? "No computation time was recorded for this figure." },
  ];
}

/**
 * Build and fill the provenance disclosure inside the answer block.
 *
 * Collapsed on every build and never re-opened by a repaint: a reader who opened
 * it keeps it open because the node is built once and only its list is replaced.
 * Keyboard operation is the native `details`/`summary` pair's — Enter and Space
 * both toggle it, and the `toggle` listener mirrors the state into
 * `aria-expanded`, `data-disclosure`, and the visible word, exactly as every
 * other disclosure on this region does.
 */
export function applyAnswerProvenance(doc, summary) {
  const block = byId(doc, ANSWER_BLOCK_IDS.block);
  if (!block || !doc.createElement) return null;
  const ids = standDisclosureIds(ANSWER_PROVENANCE_KEY);
  let details = byId(doc, ids.details);
  if (!details) {
    details = doc.createElement("details");
    details.className = "stand-disclosure answer-provenance";
    details.id = ids.details;
    details.dataset.disclosure = "collapsed";
    details.dataset.mounted = "true";
    const trigger = doc.createElement("summary");
    trigger.id = ids.summary;
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", ids.list);
    // h4: the block's own question is the h3 above it, so this is the level
    // below it rather than a second peer heading inside the same region.
    const heading = doc.createElement("h4");
    heading.className = "stand-disclosure-heading";
    const name = doc.createElement("span");
    name.id = ids.heading;
    name.textContent = ANSWER_PROVENANCE_LABEL;
    const state = doc.createElement("span");
    state.className = "stand-disclosure-state";
    state.id = ids.state;
    state.dataset.disclosure = "collapsed";
    heading.append(name, state);
    trigger.append(heading);
    const list = doc.createElement("dl");
    list.className = "stand-disclosure-list";
    list.id = ids.list;
    details.append(trigger, list);
    block.append(details);
    details.addEventListener("toggle", () => paintStandDisclosureState(doc, ANSWER_PROVENANCE_KEY));
  }
  const list = byId(doc, ids.list);
  const records = summary?.provenance ?? null;
  if (list) {
    const rows = records
      ? PROVENANCE_FIGURES.flatMap((key) => provenanceRows(records[key]))
      : provenanceRows(null);
    list.replaceChildren(...rows.map((row) => definition(doc, row)));
  }
  paintStandDisclosureState(doc, ANSWER_PROVENANCE_KEY);
  return details;
}

/**
 * PROMOTE THE ONE PANEL THAT BACKS THE FIGURE, and only ever one.
 *
 * `summary.evidence.panelId` names it; this resolves that id against the real
 * document and refuses to mark anything when it does not resolve. The marking is
 * cleared from every element that carries it FIRST, so "exactly one" is a
 * property of this function rather than of the order paints happen in — and so a
 * payload that names no panel leaves no half-promoted panel behind.
 *
 * EXPANSION STATE IS NOT TOUCHED HERE. Which panel is the evidence and which
 * panels a reader has opened are two independent facts: the marking lives on
 * `data-headline-evidence` and the open/shut state lives on the native `details`
 * elements, so unfolding a supporting layer cannot move, transfer, or clear it.
 *
 * The association is dropped rather than pointed at a missing node: an
 * `aria-describedby` that resolves to nothing is announced as nothing, and a
 * reader is told the figure has a description they can never reach.
 */
export function applyAnswerEvidence(doc, summary = FINOPS_ANSWER_SUMMARY) {
  const figure = byId(doc, ANSWER_BLOCK_IDS.figure);
  const line = byId(doc, ANSWER_EVIDENCE_IDS.line);
  for (const node of doc?.querySelectorAll?.("[data-headline-evidence]") ?? []) {
    node.dataset[EVIDENCE_MARK] = "false";
  }
  const panelId = summary?.evidence?.panelId ?? null;
  const panel = typeof panelId === "string" && panelId !== "" ? byId(doc, panelId) : null;
  // The line has to be INSIDE the panel it promotes, or the description a reader
  // is sent to is not the evidence panel's own words — and the panel has to be
  // on screen. `supersedeWorkspaceDestinations` hides this section when a reader
  // imports their own export, and `hidden` takes a node out of the accessibility
  // tree, so a description pointing into it is announced as nothing.
  if (!panel || panel.hidden || !line || line.closest?.(`#${panelId}`) !== panel) {
    figure?.removeAttribute("aria-describedby");
    if (line) line.hidden = true;
    return null;
  }
  panel.dataset[EVIDENCE_MARK] = "true";
  setText(doc, ANSWER_EVIDENCE_IDS.chip, summary.evidence.label);
  setText(doc, ANSWER_EVIDENCE_IDS.text, summary.evidence.line);
  line.hidden = false;
  figure?.setAttribute("aria-describedby", ANSWER_EVIDENCE_IDS.line);
  return panel;
}

/**
 * The four named entry points, from the contract, in the contract's order.
 * Painted rather than authored so a door's name and the contract's name are one
 * string. Anchors in source order with no `tabindex`: the keyboard order is the
 * visual order because it is the DOM order. The accessible name is the name plus
 * the question, because "Evidence" alone says nothing about what is behind it.
 */
export function applyAnswerDoors(doc) {
  const host = byId(doc, ANSWER_BLOCK_IDS.doors);
  if (!host) return null;
  const nodes = [];
  for (const entry of SCREEN_CONTRACT) {
    const link = doc.createElement("a");
    link.className = "answer-door";
    link.setAttribute("href", entry.target);
    link.dataset.screenDestination = entry.key;
    link.textContent = `${entry.name} — ${entry.question}`;
    nodes.push(link);
  }
  host.replaceChildren(...nodes);
  return host;
}

/**
 * The answer block: one question, one figure, one confidence sentence, one
 * action. The state goes on the block as an attribute so a stylesheet, a printed
 * page, and a test read one channel.
 *
 * IT COMPOSES NOTHING NOW. It used to take a composed stand headline and call
 * `answerBlock()` on it, which meant the block's first figure could not be
 * painted until every panel dataset the headline reaches had been computed. It
 * takes a summary — the four values and nothing else — and the default is
 * `FINOPS_ANSWER_SUMMARY`, derived straight from the fixture. `applyStandHeadline`
 * passes a summary of its own for the path that matters: a reader's own import,
 * whose figures are theirs and are composed from their file.
 */
export function applyAnswerBlock(doc, summary = FINOPS_ANSWER_SUMMARY) {
  const block = byId(doc, ANSWER_BLOCK_IDS.block);
  if (!block) return null;
  // Before the four values, and unconditionally: a summary that arrived empty or
  // malformed has to take the promotion DOWN, not leave the authored one
  // standing over a figure it no longer describes.
  applyAnswerEvidence(doc, summary);
  // …and the record behind each figure, one step down from it. Unconditional for
  // the same reason: a block with no payload must say it has nothing behind its
  // numbers rather than leave the last payload's provenance standing under them.
  applyAnswerProvenance(doc, summary);
  // …and whether the rules behind the figure still reproduce the pinned example.
  // Also unconditional, and for the same reason: it qualifies the confidence
  // sentence below it, so a payload-less paint must not leave the qualifier off.
  applyAnswerReproduction(doc);
  if (!summary) return null;
  block.dataset.state = summary.state ?? "unavailable";
  block.dataset.available = String(summary.available === true);
  setText(doc, ANSWER_BLOCK_IDS.question, summary.question);
  // THE FIGURE'S FOUR SLOTS FALL BACK TOGETHER. `setText` skips a non-string, so
  // a payload stating no direction leaves the LAST paint's direction standing
  // under THIS paint's number — a reader told which way is better by a sentence
  // that measured something else. Each slot goes back to the contract's authored
  // pending wording instead: saying nothing here is honest, and saying the
  // previous answer is not. Same rule for the label, the value and the basis,
  // which qualify the number in exactly the same way.
  const slot = (key, stated) => setText(doc, ANSWER_BLOCK_IDS[key],
    typeof stated === "string" ? stated : FIGURE_AUTHORED[key]);
  slot("label", summary.metricLabel);
  slot("value", summary.figure);
  slot("direction", summary.direction);
  slot("basis", summary.basis);
  setText(doc, ANSWER_BLOCK_IDS.confidence, summary.confidence);
  // A payload with no action is a malformed payload, not a crash: the authored
  // pending action stays on screen rather than taking the whole block down with
  // a TypeError on the first paint of the page's first figure.
  const action = byId(doc, ANSWER_BLOCK_IDS.action);
  if (action && summary.action) {
    action.textContent = summary.action.label;
    action.setAttribute("href", summary.action.href);
  }
  applyAnswerDoors(doc);
  return block;
}

/**
 * Reveal the blocks a region withholds until it has figures to put in them.
 *
 * The pre-analysis document authors them `hidden` rather than filled with null
 * placeholders, because `hidden` takes a node out of the layout AND out of the
 * accessibility tree, and a `visually-hidden` empty tile is still a screen
 * reader stop on the way to the one action a first-time visitor can take. A
 * paint is the proof that there is something to show, so this is unconditional
 * at the top of one: no state flag, and nothing to get out of step.
 */
export function revealWithheld(region) {
  for (const node of region?.querySelectorAll?.(".pre-analysis-withheld") ?? []) node.hidden = false;
}

/** A fragment closed off as a sentence, so four of them can be read as one line. */
function sentence(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return "";
  return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The whole claim as one sentence: question, answer, confidence, evidence class.
 *
 * WHY IT EXISTS. Those four things are four separate nodes on the surface, and
 * the two entitlement indicators sit after the sentence they qualify. A reader
 * using a screen reader therefore met the claim first and the two things that
 * bound it some moments later, as unattached badges — which is exactly the
 * reading a figure gets quoted out of. The region names this node in
 * `aria-describedby`, so arriving at the headline announces the claim WITH what
 * it rests on, once.
 *
 * It composes; it computes nothing. Every part is a string the visible slots are
 * painted from, so the announcement cannot drift from what is on screen, and a
 * part that is missing is dropped rather than rendered as an empty gap. The
 * markup ships a pending sentence, so the description is never empty.
 */
export function standClaimSentence(headline) {
  return [headline?.question, headline?.answer, headline?.entitlement?.confidence,
    headline?.entitlement?.evidence].map(sentence).filter(Boolean).join(" ");
}

function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node && typeof text === "string") node.textContent = text;
  return node;
}

/** One `<dt>`/`<dd>` pair, built rather than assigned. */
function definition(doc, item) {
  const row = doc.createElement("div");
  const term = doc.createElement("dt");
  term.textContent = item.term;
  const detail = doc.createElement("dd");
  detail.textContent = item.detail;
  row.append(term, detail);
  return row;
}

/**
 * Build the disclosures the document does not author, in the place the reading
 * order puts them.
 *
 * WHY ANY OF THEM ARE BUILT HERE. `STAND_MOUNTED_DISCLOSURES` names them and
 * says why: `src/evolution.html` is under a byte budget on the initial payload,
 * and these carry nothing a reader could use before the modules that fill them
 * have run anyway. Everything else on this region still ships as markup.
 *
 * The node is built to the SAME shape the document authors — same classes, same
 * derived ids, same `aria-expanded`/`aria-controls` pair, same state chip — so
 * `paintStandDisclosureState`, the stylesheet, the deep-link handler and the
 * tests cannot tell a mounted disclosure from an authored one. It is inserted
 * before the first authored disclosure that follows it in `STAND_DISCLOSURE_ORDER`
 * rather than appended, so the reading order is the declared one.
 *
 * Idempotent: called on every paint, builds at most once, and binds its own
 * `toggle` listener at creation because `bindStandDisclosures` may already have
 * run past a container this node was not in yet.
 */
export function ensureStandDisclosure(doc, key) {
  const ids = standDisclosureIds(key);
  const existing = byId(doc, ids.details);
  if (existing) return existing;
  if (!STAND_MOUNTED_DISCLOSURES.includes(key)) return null;
  const container = byId(doc, STAND_IDS.disclosures);
  if (!container || !doc.createElement) return null;

  const details = doc.createElement("details");
  details.className = "stand-disclosure";
  details.id = ids.details;
  details.dataset.disclosure = "collapsed";
  // Which disclosures the document did not author, on the node itself: a
  // printed page, a test and a support conversation read the same channel.
  details.dataset.mounted = "true";

  const summary = doc.createElement("summary");
  summary.id = ids.summary;
  summary.setAttribute("aria-expanded", "false");
  summary.setAttribute("aria-controls", ids.list);
  const heading = doc.createElement("h3");
  heading.className = "stand-disclosure-heading";
  const name = doc.createElement("span");
  name.id = ids.heading;
  name.textContent = STAND_DISCLOSURE_SUMMARY[key] ?? "";
  const state = doc.createElement("span");
  state.className = "stand-disclosure-state";
  state.id = ids.state;
  state.dataset.disclosure = "collapsed";
  heading.append(name, state);
  summary.append(heading);

  const list = doc.createElement("dl");
  list.className = "stand-disclosure-list";
  list.id = ids.list;
  details.append(summary, list);

  // What this one mounts in front of: the next disclosure in the declared order
  // that is already in the container — or, when this key is the LAST of them,
  // the first follow-on question. #832 moved the two follow-ons into this same
  // group, below every evidence disclosure, so a bare `append()` would mount the
  // last evidence layer underneath the two questions it is evidence for. The
  // class is read off `className` rather than through `classList`/`matches` for
  // the reason the note at the top of this file gives about the element API.
  const isFollowOn = (node) => typeof node?.className === "string"
    && node.className.split(" ").includes("support-disclosure");
  const after = STAND_DISCLOSURE_ORDER
    .slice(STAND_DISCLOSURE_ORDER.indexOf(key) + 1)
    .map((following) => byId(doc, standDisclosureIds(following).details))
    .find(Boolean)
    ?? [...(container.children ?? [])].find(isFollowOn);
  if (after) container.insertBefore(details, after);
  else container.append(details);

  details.addEventListener("toggle", () => paintStandDisclosureState(doc, key));
  details.dataset.bound = "true";
  paintStandDisclosureState(doc, key);
  return details;
}

/**
 * Write one disclosure's state into the three channels it is owed: the
 * `aria-expanded` mirror assistive technology reads, the `data-disclosure`
 * attribute the stylesheet and the tests read, and the visible word beside the
 * summary. A chevron that only rotates is a state a reader cannot hear, cannot
 * print, and cannot see in greyscale — so the word is always there, and the
 * count travels with it.
 */
export function paintStandDisclosureState(doc, key) {
  const ids = standDisclosureIds(key);
  const details = byId(doc, ids.details);
  const summary = byId(doc, ids.summary);
  if (!details || !summary) return null;
  const open = Boolean(details.open ?? details.hasAttribute?.("open"));
  const spec = open ? STAND_DISCLOSURE_STATE.expanded : STAND_DISCLOSURE_STATE.collapsed;
  summary.setAttribute("aria-expanded", open ? "true" : "false");
  details.dataset.disclosure = open ? "expanded" : "collapsed";
  const state = byId(doc, ids.state);
  if (state) {
    state.dataset.disclosure = open ? "expanded" : "collapsed";
    const count = byId(doc, ids.list)?.querySelectorAll?.("dt")?.length ?? 0;
    const shape = doc.createElement("span");
    shape.className = "stand-disclosure-shape";
    // Decoration beside a word, never the word itself, so it stays out of the
    // name the visible text composes.
    shape.setAttribute("aria-hidden", "true");
    shape.textContent = spec.shape;
    state.replaceChildren(shape,
      doc.createTextNode(` ${spec.action}${count > 0 ? ` · ${count}` : ""}`));
  }
  return summary;
}

/**
 * Build every mounted disclosure, and nothing else.
 *
 * Called before `installDeepLinkDisclosure` on the page entry: a boardroom link
 * that points straight at one of these has to find it in the document, and the
 * cold-load reveal runs at install time. Binding and painting still happen
 * later, on the ordinary path.
 */
export function mountStandDisclosures(doc) {
  // The four named entry points come up with the region, not with the first
  // figure: they are wayfinding, and they are true before anything is read.
  applyAnswerDoors(doc);
  return STAND_MOUNTED_DISCLOSURES.map((key) => ensureStandDisclosure(doc, key)).filter(Boolean);
}

/**
 * Keep every disclosure's state channels in step with its own `open`.
 *
 * Bound to `toggle`, which fires for a click, for Enter, for Space, and for a
 * programmatic open — so the keyboard path and the pointer path go through one
 * piece of code rather than two that can disagree. Nothing here intercepts a
 * key: the native control already handles all of them, and re-handling them is
 * how a disclosure stops being operable in the browser's own way.
 */
export function bindStandDisclosures(doc) {
  const bound = [];
  for (const key of STAND_DISCLOSURE_ORDER) {
    // Mounted disclosures are built here rather than found, so the keyboard path
    // reaches them on the same pass as the authored ones. `ensureStandDisclosure`
    // binds what it builds; this loop must not bind it a second time.
    const details = ensureStandDisclosure(doc, key);
    if (!details) continue;
    if (details.dataset.bound !== "true") {
      details.addEventListener("toggle", () => paintStandDisclosureState(doc, key));
      details.dataset.bound = "true";
    }
    paintStandDisclosureState(doc, key);
    bound.push(details);
  }
  return bound;
}

/**
 * Delegate the withheld-state action to the control that already owns it.
 *
 * There is exactly one file picker on this page, and this button does not
 * become a second one: it focuses and clicks `#local-finops-files`, the same
 * delegate the first-run import choice uses. Focus moves first, so a browser
 * that declines to open a file dialog from a synthetic event leaves the reader
 * standing on the control that does.
 */
export function bindStandResolution(doc) {
  const button = byId(doc, STAND_IDS.withheldAction);
  if (!button) return null;
  button.dataset.target = STAND_RESOLUTION_ACTION.targetId;
  button.addEventListener("click", () => {
    const target = byId(doc, STAND_RESOLUTION_ACTION.targetId);
    if (!target) return;
    target.focus?.({ preventScroll: true });
    target.click?.();
    target.scrollIntoView?.({ block: "center" });
  });
  return button;
}

/**
 * Apply a composed headline to the document.
 *
 * `announce: false` is the boot paint's option and nothing else's: the answer it
 * puts on screen is the bundled example the shipped document was already seeded
 * with, so it is not a change and must not be spoken. See `announceAnswer`.
 *
 * @returns the region, so a caller can assert on the state it asked for.
 */
export function applyStandHeadline(doc, headline, { announce = true } = {}) {
  const region = byId(doc, STAND_IDS.region);
  if (!region || !headline) return null;

  // THE FIGURES ARRIVE WITH THEIR FIRST VALUES, NOT BEFORE. Each block is
  // authored `hidden` so a visitor who has composed nothing meets one drawn
  // empty state rather than a grid of null placeholders — see the note in
  // evolution.html. Reaching this line means a headline exists, so every one of
  // them is revealed here and the populated state is exactly what it was.
  revealWithheld(region);

  region.dataset.state = headline.available ? "ready" : "partial";
  // The withheld path is a state on the region, not a style: a printed page, a
  // screenshot, and a test all read the same attribute the stylesheet does.
  region.dataset.position = headline.positioned ? "placed" : "withheld";
  region.dataset.source = headline.source ?? "example";
  // Which finding won, on the region itself. An attribute, not a panel: the
  // runners-up are returned by the resolver and rendered nowhere, and this is
  // how a test, a printed page, and a support conversation can say which claim
  // the reader was actually shown.
  region.dataset.finding = headline.finding?.signalKind ?? "none";
  region.dataset.findingConfidence = headline.finding?.confidence?.level ?? "unavailable";
  // What the claim rests on, on the region itself, beside the tier. The words
  // are painted below; this is the same state in the channel a stylesheet, a
  // printed page, and a test can all read.
  region.dataset.evidenceClass = headline.entitlement?.evidenceClass ?? "none";

  // THE ANSWER BLOCK FIRST, because it is what a reader meets first. It shares
  // this region's paint rather than owning a second one: one paint means the
  // block and the figures under it can never be as of two different datasets.
  // The block takes a summary, so this headline is reduced to one here — the
  // same three fields `FINOPS_ANSWER_SUMMARY` is built from, through the same
  // composer, so the bundled paint and an imported one cannot disagree.
  applyAnswerBlock(doc, answerBlock(headline));

  setText(doc, STAND_IDS.label, headline.label ?? "");
  setText(doc, STAND_IDS.question, headline.question ?? "");
  setText(doc, STAND_IDS.answer, headline.answer ?? "");

  // CAN THIS EXPORT BE GRADED — stated in the answer block above, whose
  // confidence sentence is this verdict's coverage, tier, rule and residue, and
  // at length in the "Can this export be graded?" disclosure below. It no longer
  // has a question, a figure and a next step of its own beside the answer: two
  // renderings of one verdict were two decision summaries (#831).

  // THE FIGURES THAT VERDICT GOVERNS. Assigned from the state on every
  // paint, never latched: an import far below the bar takes the figures and the
  // named department off the screen, and the next export that clears the bar —
  // or a cleared import returning to the bundled example — puts them back. A
  // one-way `hidden = true` here is how a repainted region ends up asserting
  // "this export can be graded" over a gutted headline.
  for (const node of region.querySelectorAll?.(".stand-figures, .stand-team") ?? []) {
    node.hidden = Boolean(headline.figuresSuppressed);
  }

  // The entitlement line: two indicators, both words, immediately under the
  // claim. Neither is a colour and neither is behind a disclosure — a lead who
  // is about to repeat this sentence should not have to open anything to learn
  // that it rests on invented peers.
  const entitlement = byId(doc, STAND_IDS.entitlement);
  if (entitlement) {
    entitlement.dataset.available = headline.entitlement?.available ? "true" : "false";
    entitlement.dataset.evidence = headline.entitlement?.evidenceClass ?? "none";
    entitlement.dataset.confidence = headline.entitlement?.confidenceTier ?? "unavailable";
  }
  setText(doc, STAND_IDS.evidence, headline.entitlement?.evidence ?? "");
  setText(doc, STAND_IDS.confidence, headline.entitlement?.confidence ?? "");

  // …and the same four values as one sentence, for the one announcement the
  // region is described by. Only written when there is something to say: a
  // headline that composed nothing leaves the authored pending sentence in
  // place rather than blanking the region's description.
  const claim = standClaimSentence(headline);
  if (claim) setText(doc, STAND_IDS.claim, claim);

  const position = setText(doc, STAND_IDS.positionValue, headline.position?.value ?? "");
  if (position) position.dataset.available = headline.position?.available ? "true" : "false";
  setText(doc, STAND_IDS.positionBasis, headline.position?.basis ?? "");

  const recoverable = setText(doc, STAND_IDS.recoverableValue, headline.recoverable?.value ?? "");
  if (recoverable) recoverable.dataset.available = headline.recoverable?.available ? "true" : "false";
  setText(doc, STAND_IDS.recoverableBasis, headline.recoverable?.basis ?? "");
  // …and the one sentence that holds this figure against the coverage verdict
  // the answer block states (#1019). Composed, never assembled here, and hidden
  // only when the composer produced none — an empty paragraph in the flow of
  // the block would be a stop through nothing.
  const reconciliation = setText(doc, STAND_IDS.recoverableReconciliation,
    headline.recoverable?.reconciliation ?? "");
  if (reconciliation) reconciliation.hidden = !headline.recoverable?.reconciliation;

  // The named team is text in both channels — the name in its own element and
  // the evidence sentence beside it. Nothing about which department it is is
  // carried by colour or by position in a grid.
  const team = byId(doc, STAND_IDS.team);
  if (team) team.dataset.available = headline.team?.available ? "true" : "false";
  setText(doc, STAND_IDS.teamName, headline.team?.name ?? "");
  setText(doc, STAND_IDS.teamDetail, headline.team?.detail ?? "");

  const action = byId(doc, STAND_IDS.action);
  if (action) {
    action.textContent = headline.action?.label ?? "";
    action.hidden = !headline.action?.available;
    if (headline.action?.href) action.setAttribute("href", headline.action.href);
  }
  setText(doc, STAND_IDS.actionBasis, headline.action?.basis ?? "");
  const basis = byId(doc, STAND_IDS.actionBasis);
  if (basis) basis.hidden = !headline.action?.available;

  // The withheld path: what is missing, and one control that resolves it. The
  // bare word "Unavailable" is never painted into this region in any state.
  const withheld = byId(doc, STAND_IDS.withheld);
  if (withheld) withheld.hidden = Boolean(headline.positioned);
  setText(doc, STAND_IDS.withheldMissing, headline.withheld?.missing ?? "");
  setText(doc, STAND_IDS.withheldNext, headline.withheld?.nextStep ?? "");
  setText(doc, STAND_IDS.withheldAction,
    headline.withheld?.actionLabel ?? STAND_RESOLUTION_ACTION.label);

  for (const item of headline.disclosures ?? []) {
    const ids = standDisclosureIds(item.id);
    // Built before it is filled, for the disclosures the document does not
    // author. A no-op for every authored one.
    ensureStandDisclosure(doc, item.id);
    setText(doc, ids.heading, item.summary ?? "");
    const list = byId(doc, ids.list);
    if (list) list.replaceChildren(...item.entries.map((row) => definition(doc, row)));
    paintStandDisclosureState(doc, item.id);
  }

  // WHOSE FIGURES THESE ARE, repainted with them. The marker ships in its
  // example state and used to stay there: a lead who imported their own export
  // read their own recoverable figure under a block saying every figure on the
  // page was invented. Word, shape, and sentence are all repainted together, so
  // the marker is never half-true, and `data-source` is what the stylesheet
  // tints — the colour is the third carrier of the fact, never the first.
  const marker = byId(doc, STAND_IDS.sample);
  if (marker) {
    const copy = STAND_SAMPLE_MARKER[headline.source] ?? STAND_SAMPLE_MARKER.example;
    marker.dataset.source = headline.source === "import" ? "import" : "example";
    const [shape, word] = [marker.children?.[0] ?? null, marker.children?.[1] ?? null];
    if (shape) shape.textContent = copy.shape;
    if (word) word.textContent = copy.word;
    // The sentence is the marker's own last child, a bare text node authored
    // beside the two elements above. Rebuilding the trio keeps it a text node.
    marker.replaceChildren(...[shape, word].filter(Boolean), doc.createTextNode(` ${copy.detail}`));
  }

  // Spoken once, from the page's one announcer, and it carries the three things
  // a reader who cannot see this region needs in order to decide whether to
  // keep listening: the question, the metric with its unit, and the one next
  // action. Every other region that used to echo this change was silenced at
  // boot by `silenceEchoedRegions`.
  announceAnswer(doc, answerAnnouncement(headline), { announce });

  // THE SPINE, LAST, so it is what the region ends up carrying. It writes the
  // page's one question into this region's heading, the headline metric's name
  // into the label for it, the classification of every top-level region, and
  // which of the spine's two states — nothing imported, or the reader's own
  // export read — this paint is in. Everything above composed figures; this
  // line is where the page says what it is answering and what everything else
  // on it is for. `headline.source` is the only input it needs: "import" means
  // the figures just painted are the reader's own.
  applyFinopsSpine(doc, { imported: headline.source === "import" });
  return region;
}
