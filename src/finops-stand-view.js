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
// The page's one announcer. Every answer change on /evolution.html is announced
// from here, in one sentence, because it used to be announced from nine regions
// at once and a reader heard a queue instead of an answer.
import { announceAnswer, answerAnnouncement } from "./finops-answer-announcement.js";

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

  const after = STAND_DISCLOSURE_ORDER
    .slice(STAND_DISCLOSURE_ORDER.indexOf(key) + 1)
    .map((following) => byId(doc, standDisclosureIds(following).details))
    .find(Boolean);
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
 * @returns the region, so a caller can assert on the state it asked for.
 */
export function applyStandHeadline(doc, headline) {
  const region = byId(doc, STAND_IDS.region);
  if (!region || !headline) return null;

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

  setText(doc, STAND_IDS.label, headline.label ?? "");
  setText(doc, STAND_IDS.question, headline.question ?? "");
  setText(doc, STAND_IDS.answer, headline.answer ?? "");

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
  announceAnswer(doc, answerAnnouncement(headline));

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
