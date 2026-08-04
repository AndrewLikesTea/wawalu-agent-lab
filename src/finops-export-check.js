/**
 * "Will my export work?", answered without importing anything (#1064).
 *
 * /evolution.html already has ONE import affordance (#958) and it commits: a
 * file dropped on it is parsed, adapted, analyzed, and painted over whatever the
 * reader was looking at. That is the right behaviour for somebody who has
 * decided. It is the wrong first step for somebody who has not — a reader
 * holding a file they are not sure about has, until now, had to run the whole
 * analysis to find out whether the file was even readable.
 *
 * This is the other affordance: a check that ends in a decision.
 *
 *   ANSWER, DETAIL, ONE ACTION. The verdict is three things in this order — one
 *   line that answers the question in plain words, one line of material detail
 *   (which console, how many rows, how long a period; or the one column that is
 *   missing), and exactly ONE control. Everything else the check knows is behind
 *   a disclosure that ships collapsed. A reader who wanted a yes or a no is not
 *   handed a column report to read first.
 *
 *   A CHECK IS NOT A QUIETER IMPORT. Nothing here writes to the brief, the lead
 *   finding, the workspace, the cohort declaration, or storage. It renders into
 *   its own container and touches no other, on every path including the refusal
 *   — so a reader who has already imported an export and typed their own context
 *   can check a second file and lose neither.
 *
 *   THE FILE IS NOT ASKED FOR TWICE. A recognized check holds the File in module
 *   state and the single action hands THAT object to the page's own import
 *   handler — the same code path the full-analysis picker runs. No second file
 *   selection, and no second import path to keep in step with the first.
 *
 * No provider is named in this file and no recognition happens in it. The
 * verdict is `preflight`'s (#1063), loaded through a dynamic `import()` for the
 * reason finops-import-drop.js loads it that way: the adapters stay out of the
 * page's initial payload, which is measured and gated.
 *
 * WHY THE MARKUP IS BUILT HERE AND NOT AUTHORED IN THE DOCUMENT
 * ------------------------------------------------------------
 * /evolution.html is inside a hard byte budget with a couple of hundred bytes
 * left in it (config/evolution-size-budget.json), and this zone is more than
 * that. So the page mounts it: `mountExportCheck` runs during the page's own
 * import wiring, long before any reader interaction, and every node below —
 * including the live region — is in the document from that moment and is never
 * replaced afterwards. Announcing writes TEXT into a region a screen reader has
 * already been told about; it never creates one with the news in it.
 *
 * The live region is also never empty and never inside the disclosure. It ships
 * with the idle sentence, because `.import-reason:empty` is `display:none` and a
 * region that is display:none until the moment it has something to say is a
 * region no assistive technology was watching.
 *
 * ONE ANSWERABLE QUESTION, ONE ANSWER, ONE NEXT STEP (#1066)
 * ---------------------------------------------------------
 * Three things are the loudest in this zone and they read in this order: the
 * QUESTION (a real one, with a real answer — it used to be the section label
 * "Check an export before you commit to the analysis", which asks nothing), the
 * VERDICT, and exactly ONE action. Everything else — the column breakdown here,
 * the five console errands below — is subordinate by position and by type role,
 * never by being folded out of sight.
 *
 * NEVER COLOUR ALONE. Every state carries a glyph AND a word AND a sentence
 * before the band tint is reached: ○ not checked, ◔ checking, ✓ yes, ✗ no,
 * ! could not run. The glyph is aria-hidden and the sentence is the accessible
 * text, so nothing is said twice; and the zone's own accessible name is the
 * question plus the current verdict, so the state is in words to anything
 * reading the container rather than the line inside it.
 *
 * A CHECK THAT COULD NOT RUN IS NOT A REFUSAL. A file this browser could not
 * read, and a check whose modules did not load, are `blocked` — their own state,
 * their own neutral band, no verdict on the file. Telling a reader their export
 * is bad because a fetch failed is the one wrong answer this zone can give.
 */

import { LOCAL_PROCESSING_STATEMENT } from "./provider-readiness-contract.js";

/** Every id this module owns. Nothing outside it writes to these nodes. */
export const EXPORT_CHECK_IDS = Object.freeze({
  zone: "finops-export-check",
  title: "finops-export-check-title",
  instruction: "finops-export-check-instruction",
  boundary: "finops-export-check-boundary",
  input: "finops-export-check-file",
  answer: "finops-export-check-answer",
  detail: "finops-export-check-detail",
  continue: "finops-export-check-continue",
  guidance: "finops-export-check-guidance",
  disclosure: "finops-export-check-columns",
  columns: "finops-export-check-column-list",
});

/** The guidance block this check sends a refused reader back into (#1062). */
export const PROVIDER_GUIDANCE_ID = "provider-readiness";

/**
 * The same-page anchor for one provider's guidance entry.
 *
 * A recognized-but-incomplete file goes back to ITS console's entry; a file no
 * published contract claims goes back to the list of all five, because there is
 * no entry to send it to and inventing one would name a console the file never
 * came from.
 */
export const providerGuidanceHref = (provider) =>
  `#${provider ? `${PROVIDER_GUIDANCE_ID}-${provider}` : PROVIDER_GUIDANCE_ID}`;

export const EXPORT_CHECK_COPY = Object.freeze({
  title: "Will this export analyze here?",
  instruction: "Drop one export here, or browse for it below. It is read in this tab, checked "
    + "against the same recognition pass the analysis runs, and then it stops. Nothing is "
    + "analyzed, nothing is uploaded, and nothing already on this page is cleared or replaced.",
  label: "Choose one export to check",
  idle: "Not checked yet — no export has been read, so nothing is claimed about your file.",
  reading: "Checking — reading this file in this tab…",
  ready: "Yes — this export will analyze.",
  refused: "No — this export will not analyze as it is.",
  unreadable: "Could not run — this browser could not read the file, so nothing was checked and "
    + "nothing is claimed about it. Choose it again, or export it again and retry.",
  unavailable: "Could not run — the check itself did not load in this browser, so nothing is "
    + "claimed about your file. Nothing on this page changed; import the file with the picker "
    + "below to find out what it does with it.",
  continue: "Run the full analysis on this export",
  summary: "What this check read, column by column",
  noColumns: "No column names were read from this file.",
  present: "In this file",
  missing: "Required and missing",
});

/**
 * One glyph per state, so the three drawn states differ in shape before they
 * differ in tint. Every one is aria-hidden: the sentence beside it already says
 * the same thing in words, and a screen reader that read both would say the
 * verdict twice.
 */
const STATE_MARKS = Object.freeze({
  idle: "○", reading: "◔", recognized: "✓", refused: "✗", blocked: "!", continued: "✓",
});

/**
 * The longest file name this zone will print. A name is the reader's, not ours,
 * and an export dropped out of a console can carry a hundred characters of
 * account id and date range. Clamped here rather than in the stylesheet so the
 * guarantee holds with no CSS at all: the detail line cannot grow past a
 * sentence, so it can never push the one action out of the zone.
 */
const MAX_NAME = 48;

const shortName = (name) => {
  const text = String(name ?? "").trim();
  return text.length > MAX_NAME ? `${text.slice(0, MAX_NAME - 1)}…` : text;
};

// The picker's own accept list, so the check cannot refuse a file the import
// would have taken (or take one it would not).
const ACCEPT = ".json,.csv,.tsv,.txt,.jsonl,application/json,text/csv,"
  + "text/tab-separated-values,text/plain";

/**
 * The File the last recognized check read, held for exactly one reason: the
 * single action hands it to the page's import handler, so the reader who
 * already chose this file never chooses it again. It is dropped on every path
 * that is not a clean pass — there is nothing to continue into — and on mount,
 * so a re-mounted page can never continue with the previous one's file.
 */
let checkedFile = null;

/** The held File, for a caller that needs to assert on what a continue would run. */
export const checkedExportFile = () => checkedFile;

const byId = (doc, id) => doc.getElementById(id);

function node(doc, tag, className, text = "") {
  const created = doc.createElement(tag);
  if (className) created.className = className;
  if (text) created.textContent = text;
  return created;
}

/**
 * The material detail, in one line, from the verdict's own fields.
 *
 * No reason CODE is compared anywhere in this file. The codes live in the
 * adapters module, which this one loads only when a file arrives, and a copy of
 * them here would be a second vocabulary to keep in step with the first. What
 * the verdict already states — a provider or none, a named missing column or
 * none, a row count — answers the same question without one.
 */
function detailLine(verdict) {
  if (verdict.namedColumn) {
    return `${verdict.displayName} was recognized, but the required column `
      + `${verdict.namedColumn} is not in this file.`;
  }
  if (!verdict.provider) {
    return verdict.rowCount === 0
      ? "This file carries no usage rows and no columns any supported console publishes."
      : `${verdict.rowCount} rows were read, and none of the signature columns of a supported `
        + "console are among them.";
  }
  if (verdict.rowCount === 0) {
    return `${verdict.displayName} was recognized from its columns, and the file carries `
      + "0 usage rows over 0 periods.";
  }
  return `${verdict.displayName} · ${verdict.rowCount} rows · `
    + `${verdict.periodCount} dated periods covered.`;
}

/** Where the refusal's one control sends the reader, named so the link says it. */
const guidanceDestination = (verdict) => (verdict.provider
  ? `Open the ${verdict.displayName} export guidance below.`
  : "Open the export guidance below.");

/**
 * Write one state into the verdict line: glyph, then sentence, then band.
 *
 * The glyph node is replaced with the text on every write, so the line can never
 * hold the previous state's mark beside this state's words. `answer` is also the
 * zone's second labelling node, so the container's accessible name states the
 * state in words the moment this returns.
 */
function sayVerdict(doc, answer, state, sentence) {
  const mark = node(doc, "span", "import-drop-mark", STATE_MARKS[state] ?? STATE_MARKS.idle);
  mark.setAttribute("aria-hidden", "true");
  answer.dataset.state = state === "recognized" ? "recognized"
    : state === "refused" ? "unrecognized" : "idle";
  answer.replaceChildren(mark, doc.createTextNode(` ${sentence}`));
}

/**
 * Put the keyboard on the answer the reader just asked for.
 *
 * `tabindex="-1"` and not `0`: the verdict is a destination, not a stop every
 * reader tabs through on every pass. Called only on settled states — moving
 * focus onto "checking…" would take it away again while the reader reads.
 */
function focusVerdict(answer) {
  if (typeof answer?.focus === "function") answer.focus();
}

/**
 * One column per row: what the file carries, then what it owes.
 *
 * This is the breakdown, and it is the ONLY thing behind the disclosure. It
 * reuses the import slots' own present/missing vocabulary rather than a second
 * one — a state word beside the name, with the border treatment as the fourth
 * carrier, never the first.
 */
function paintColumns(doc, list, verdict, fieldNames) {
  const row = (name, present) => {
    const item = node(doc, "li", "import-slot");
    item.dataset.state = present ? "present" : "missing";
    const label = node(doc, "p", "import-slot-label", `${name} · `);
    label.append(node(doc, "span", "import-slot-state",
      present ? EXPORT_CHECK_COPY.present : EXPORT_CHECK_COPY.missing));
    item.append(label);
    return item;
  };
  const rows = [...fieldNames.map((name) => row(name, true)),
    ...verdict.missingColumns.map((name) => row(name, false))];
  list.replaceChildren(...(rows.length ? rows
    : [node(doc, "li", "import-slot", EXPORT_CHECK_COPY.noColumns)]));
}

/**
 * Paint one preflight verdict into the check zone, and nothing else anywhere.
 *
 * @returns true when the verdict is one the reader can continue from, so a
 *          caller can tell the two outcomes apart without re-reading it.
 */
export function renderExportCheck(doc, verdict, fieldNames = [], fileName = "") {
  const zone = byId(doc, EXPORT_CHECK_IDS.zone);
  const answer = byId(doc, EXPORT_CHECK_IDS.answer);
  const detail = byId(doc, EXPORT_CHECK_IDS.detail);
  const continueAction = byId(doc, EXPORT_CHECK_IDS.continue);
  const guidance = byId(doc, EXPORT_CHECK_IDS.guidance);
  const disclosure = byId(doc, EXPORT_CHECK_IDS.disclosure);
  const columns = byId(doc, EXPORT_CHECK_IDS.columns);
  if (!zone || !answer || !detail || !continueAction || !guidance || !disclosure) return false;
  if (!columns) return false;

  const ready = Boolean(verdict?.provider) && !verdict.namedColumn && verdict.rowCount > 0;
  zone.dataset.check = ready ? "recognized" : "refused";
  zone.setAttribute("aria-busy", "false");
  // The answer, into a region that was already in the document. The two states
  // borrow the import reason's own bands, so the tint says the same thing the
  // glyph and the sentence do — and says it fourth.
  sayVerdict(doc, answer, ready ? "recognized" : "refused",
    ready ? EXPORT_CHECK_COPY.ready : EXPORT_CHECK_COPY.refused);
  // Which file this verdict is about, then what was read from it. Named first
  // because a reader checking a second export has two candidates in hand, and
  // clamped so the longest name a console can produce is still one line of
  // detail rather than a wall the action sits below.
  const named = shortName(fileName);
  detail.textContent = named ? `${named} · ${detailLine(verdict)}` : detailLine(verdict);
  detail.hidden = false;

  // Exactly one control. The other is not merely unstyled or disabled — it is
  // hidden, so it is out of the tab sequence too and a keyboard reader meets one
  // next step rather than two, one of which does nothing.
  continueAction.hidden = !ready;
  guidance.hidden = ready;
  if (!ready) {
    // The instruction preflight already wrote, and the entry it belongs to. One
    // control carries both: the thing to go and do, and the way back to the
    // console errand that says how.
    guidance.href = providerGuidanceHref(verdict.provider);
    guidance.textContent = `${verdict.nextAction} ${guidanceDestination(verdict)}`;
  }
  paintColumns(doc, columns, verdict, fieldNames);
  // Present from here on, and never opened by this code: a reader who wants the
  // breakdown opens it, and a reader who wanted a yes or a no never meets it.
  disclosure.hidden = false;
  focusVerdict(answer);
  return ready;
}

/** The idle and exceptional states, in the same region and with no action beside them. */
function paintStandby(doc, state, sentence) {
  const zone = byId(doc, EXPORT_CHECK_IDS.zone);
  const answer = byId(doc, EXPORT_CHECK_IDS.answer);
  if (!zone || !answer) return false;
  zone.dataset.check = state;
  zone.setAttribute("aria-busy", String(state === "reading"));
  sayVerdict(doc, answer, state, sentence);
  byId(doc, EXPORT_CHECK_IDS.detail).hidden = true;
  byId(doc, EXPORT_CHECK_IDS.continue).hidden = true;
  byId(doc, EXPORT_CHECK_IDS.guidance).hidden = true;
  byId(doc, EXPORT_CHECK_IDS.disclosure).hidden = true;
  // Checking keeps the keyboard where the reader left it — focus that lands on
  // "reading…" is focus taken away again a moment later. A check that could not
  // run is settled, and a settled state is where focus goes.
  if (state === "blocked") focusVerdict(answer);
  return true;
}

/**
 * Check one file: read it, preflight it, paint the verdict. No import runs.
 *
 * The adapters and the parser are loaded on demand, together, and a load that
 * fails says so rather than passing a file off as unrecognized — a check that
 * could not run and a file that failed the check are different answers.
 */
async function runCheck(doc, file) {
  checkedFile = null;
  paintStandby(doc, "reading", EXPORT_CHECK_COPY.reading);
  let text = null;
  try {
    text = await file.text();
  } catch {
    // NOT a refusal: the file was never checked, so no verdict on it exists to
    // report. `blocked` has its own state, its own glyph and the neutral band.
    return paintStandby(doc, "blocked", EXPORT_CHECK_COPY.unreadable) && false;
  }
  try {
    const [{ preflight }, { parseExportText }] = await Promise.all([
      import("./hyperscaler-export-adapters.js"),
      import("./browser-compat-eligibility.js"),
    ]);
    const parsed = parseExportText(text, file?.name ?? "");
    const verdict = preflight(parsed);
    const ready = renderExportCheck(doc, verdict,
      Array.isArray(parsed?.fieldNames) ? parsed.fieldNames.map(String) : [], file?.name ?? "");
    // Held only where there is something to continue into.
    if (ready) checkedFile = file;
    return ready;
  } catch {
    return paintStandby(doc, "blocked", EXPORT_CHECK_COPY.unavailable) && false;
  }
}

/**
 * The zone itself: a labelled group, a real file input behind a real label, and
 * the four verdict slots. The whole group is also a drop target, which is an
 * additive layer over the input in the same sense #958 means it — remove every
 * drag event from the browser and the control still completes the same check.
 */
function buildZone(doc) {
  const zone = node(doc, "section", "import-drop");
  zone.id = EXPORT_CHECK_IDS.zone;
  zone.dataset.check = "idle";
  zone.dataset.dragging = "false";
  zone.setAttribute("role", "group");
  // The container's accessible name is the QUESTION plus the CURRENT VERDICT, so
  // the state is in words to anything reading the group rather than the line
  // inside it — never a shape or a tint on its own. It updates itself, because
  // the second node is the live region the verdict is written into.
  zone.setAttribute("aria-labelledby", `${EXPORT_CHECK_IDS.title} ${EXPORT_CHECK_IDS.answer}`);
  zone.setAttribute("aria-busy", "false");

  // The leading question, at the type role this zone's title already had and at
  // the heading level the panel around it already uses. No new size, no new
  // level — the guidance below it keeps its own smaller role and sits under it.
  const title = node(doc, "h3", "import-drop-title", EXPORT_CHECK_COPY.title);
  title.id = EXPORT_CHECK_IDS.title;
  const instruction = node(doc, "p", "import-drop-instruction", EXPORT_CHECK_COPY.instruction);
  instruction.id = EXPORT_CHECK_IDS.instruction;

  // The boundary (#1067), in the reading flow and never behind anything: not a
  // summary, not a tooltip, not a disclosure. It carries the contract module's
  // own sentence rather than a second wording of it, and it reuses the
  // instruction's class — no new rule, because styles.css has no headroom to pay
  // for one. It is a sibling of the answer region rather than a child, so it is
  // never rewritten by a verdict and never announced as news.
  const boundary = node(doc, "p", "import-drop-instruction", LOCAL_PROCESSING_STATEMENT);
  boundary.id = EXPORT_CHECK_IDS.boundary;

  const field = node(doc, "div", "local-import-field");
  const label = node(doc, "label", null, EXPORT_CHECK_COPY.label);
  label.setAttribute("for", EXPORT_CHECK_IDS.input);
  const input = node(doc, "input");
  input.id = EXPORT_CHECK_IDS.input;
  input.setAttribute("type", "file");
  input.setAttribute("accept", ACCEPT);
  input.setAttribute("aria-describedby", EXPORT_CHECK_IDS.instruction);
  field.append(label, input);

  // The live region, in the document from mount, with a neutral sentence in it
  // from mount — it states that nothing has been checked, so first paint is not
  // an announcement. Every later announcement is a write into THIS node, which
  // is a SIBLING of the disclosure below and of the drop zone's own controls,
  // never a child of either.
  const answer = node(doc, "p", "import-reason");
  answer.id = EXPORT_CHECK_IDS.answer;
  answer.setAttribute("role", "status");
  answer.setAttribute("aria-live", "polite");
  // Focusable by script, never by Tab: the check moves the keyboard here when
  // the answer arrives, and the reader tabs on from it to the one action.
  answer.setAttribute("tabindex", "-1");
  sayVerdict(doc, answer, "idle", EXPORT_CHECK_COPY.idle);

  const detail = node(doc, "p", "import-drop-instruction");
  detail.id = EXPORT_CHECK_IDS.detail;
  detail.hidden = true;

  const continueAction = node(doc, "button", "field-recovery-action", EXPORT_CHECK_COPY.continue);
  continueAction.id = EXPORT_CHECK_IDS.continue;
  continueAction.setAttribute("type", "button");
  continueAction.hidden = true;
  const guidance = node(doc, "a", "import-drop-instruction");
  guidance.id = EXPORT_CHECK_IDS.guidance;
  guidance.href = providerGuidanceHref(null);
  guidance.hidden = true;

  const disclosure = node(doc, "details", "export-package-help");
  disclosure.id = EXPORT_CHECK_IDS.disclosure;
  disclosure.hidden = true;
  const columns = node(doc, "ul", "import-slots");
  columns.id = EXPORT_CHECK_IDS.columns;
  disclosure.append(node(doc, "summary", null, EXPORT_CHECK_COPY.summary), columns);

  zone.append(title, instruction, boundary, field, answer, detail, continueAction, guidance,
    disclosure);
  return zone;
}

/**
 * Mount the check ABOVE the provider guidance and above the picker that commits.
 *
 * It used to land between them, under the five console errands. #1066 moves it
 * up one place, because the question this zone asks is the one the section is
 * for and the errands are what a reader does about ONE of its answers. Leading
 * with them puts a five-card list of consoles in front of a reader who is
 * holding a file and wants a yes or a no.
 *
 * The guidance keeps its position under this zone and keeps standing in the
 * open — it is NOT folded into a disclosure. A collapsed errand is one a reader
 * cannot see, which is the defect #1062 closed, and the refusal's own link
 * deep-links into it. Subordinate here is by ORDER and by TYPE ROLE: the
 * question leads at 15px, the guidance follows at the eyebrow role, and the
 * refusal's link now truthfully says "below".
 *
 * @param onContinue the page's OWN import handler, called with the one File a
 *        recognized check already read. This module never imports anything
 *        itself; it hands the file back to the path that always ran it.
 */
export function mountExportCheck(doc, { onContinue } = {}) {
  const guidance = byId(doc, PROVIDER_GUIDANCE_ID);
  const host = guidance?.parentNode;
  if (!host || byId(doc, EXPORT_CHECK_IDS.zone)) return false;
  checkedFile = null;
  const zone = buildZone(doc);
  // The guidance section itself is the placement reference: the zone goes
  // directly in front of it, so the question leads and the errands follow.
  host.insertBefore(zone, guidance);

  const input = byId(doc, EXPORT_CHECK_IDS.input);
  const check = (chosen) => {
    // One file. A check answers for one export; a batch would need a verdict per
    // file, which is a column report by another name.
    const [file] = [...(chosen ?? [])];
    if (file) void runCheck(doc, file);
  };
  input.addEventListener("change", () => check(input.files));

  // Both drag events stop here. Without that the page-wide drop target from
  // #958 would take a file dropped ON THE CHECK ZONE and run the full import
  // with it — the one thing a reader who came here to check has not agreed to.
  const dragging = (event, active) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    zone.dataset.dragging = String(active);
  };
  zone.addEventListener("dragover", (event) => dragging(event, true));
  zone.addEventListener("dragleave", (event) => dragging(event, false));
  zone.addEventListener("drop", (event) => {
    dragging(event, false);
    check(event.dataTransfer?.files ?? null);
  });

  byId(doc, EXPORT_CHECK_IDS.continue).addEventListener("click", () => {
    if (!checkedFile || typeof onContinue !== "function") return;
    byId(doc, EXPORT_CHECK_IDS.zone).dataset.check = "continued";
    onContinue(checkedFile);
  });
  return true;
}
