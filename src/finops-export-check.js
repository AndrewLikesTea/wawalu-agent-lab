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
 */

/** Every id this module owns. Nothing outside it writes to these nodes. */
export const EXPORT_CHECK_IDS = Object.freeze({
  zone: "finops-export-check",
  title: "finops-export-check-title",
  instruction: "finops-export-check-instruction",
  input: "finops-export-check-file",
  answer: "finops-export-check-answer",
  detail: "finops-export-check-detail",
  continue: "finops-export-check-continue",
  guidance: "finops-export-check-guidance",
  disclosure: "finops-export-check-columns",
  columns: "finops-export-check-column-list",
  capability: "finops-export-check-capability",
  capabilitySummary: "finops-export-check-capability-summary",
  capabilityList: "finops-export-check-capability-list",
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
  title: "Check an export before you commit to the analysis",
  instruction: "Drop one export here, or browse for it below. It is read in this tab, checked "
    + "against the same recognition pass the analysis runs, and then it stops. Nothing is "
    + "analyzed, nothing is uploaded, and nothing already on this page is cleared or replaced.",
  label: "Choose one export to check",
  idle: "No export checked yet. This answers one question: would this file analyze?",
  reading: "Checking this file in this tab…",
  ready: "Yes — this export will analyze.",
  refused: "No — this export will not analyze as it is.",
  unreadable: "This file could not be read in this browser, so nothing was checked. Choose it "
    + "again, or export it again and retry.",
  unavailable: "This check could not run in this browser. Nothing on this page changed; import "
    + "the file with the picker below to find out what it does with it.",
  continue: "Run the full analysis on this export",
  summary: "What this check read, column by column",
  noColumns: "No column names were read from this file.",
  present: "In this file",
  missing: "Required and missing",
  earnable: "This export earns it",
  withheldPrefix: "Withheld — needs ",
});

/**
 * The counts, in the summary itself.
 *
 * A collapsed disclosure is not read out in a real browser however readable the
 * test harness finds it, so the news — how many of the brief's figures this file
 * earns and how many it does not — is carried by the line that is always
 * visible. What is behind the fold is which ones, and what each is waiting on.
 */
export const capabilitySummary = (counts) =>
  `What this export earns on the brief — ${counts.earnable} earnable, `
  + `${counts.withheld} withheld`;

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
  ? `Open the ${verdict.displayName} export guidance above.`
  : "Open the export guidance above.");

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
 * Which figures of the brief this export earns, and what each withheld one owes.
 *
 * The same present/missing vocabulary and the same list treatment as the column
 * breakdown above it, because it is the same kind of statement about the same
 * file. A withheld row names ONE input — the one the preview ranked — so the
 * row is an errand rather than a list of everything the family could want.
 */
function paintCapability(doc, preview) {
  const disclosure = byId(doc, EXPORT_CHECK_IDS.capability);
  const list = byId(doc, EXPORT_CHECK_IDS.capabilityList);
  const summary = byId(doc, EXPORT_CHECK_IDS.capabilitySummary);
  if (!disclosure || !list || !summary) return;
  const rows = [...(preview ?? [])];
  disclosure.hidden = rows.length === 0;
  if (rows.length === 0) return;
  // A record with no missing input is an earnable one. That is the record's own
  // field rather than a copy of the preview's state words here: this file names
  // no state vocabulary it does not own, on the same grounds it compares no
  // reason code — see the note on `detailLine`.
  const earns = (entry) => !entry.missingInput;
  summary.textContent = capabilitySummary({
    earnable: rows.filter(earns).length,
    withheld: rows.filter((entry) => !earns(entry)).length,
  });
  list.replaceChildren(...rows.map((entry) => {
    const earnable = earns(entry);
    const item = node(doc, "li", "import-slot");
    item.dataset.state = earnable ? "present" : "missing";
    const label = node(doc, "p", "import-slot-label", `${entry.label} · `);
    label.append(node(doc, "span", "import-slot-state", earnable
      ? EXPORT_CHECK_COPY.earnable
      : `${EXPORT_CHECK_COPY.withheldPrefix}${entry.missingInput}`));
    item.append(label);
    return item;
  }));
}

/**
 * Paint one preflight verdict into the check zone, and nothing else anywhere.
 *
 * @param preview the capability preview for THIS verdict (#1065), or null. It is
 *   passed in rather than derived here for the reason the verdict is: this file
 *   loads the adapters on demand, and a module-level import of the preview would
 *   put them back in the page's initial payload.
 * @returns true when the verdict is one the reader can continue from, so a
 *          caller can tell the two outcomes apart without re-reading it.
 */
export function renderExportCheck(doc, verdict, fieldNames = [], preview = null) {
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
  // The answer, into a region that was already in the document. The two states
  // borrow the import reason's own bands, so the tint says the same thing the
  // sentence does and says it fourth.
  answer.dataset.state = ready ? "recognized" : "unrecognized";
  answer.textContent = ready ? EXPORT_CHECK_COPY.ready : EXPORT_CHECK_COPY.refused;
  detail.textContent = detailLine(verdict);
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
  paintCapability(doc, preview);
  // Present from here on, and never opened by this code: a reader who wants the
  // breakdown opens it, and a reader who wanted a yes or a no never meets it.
  disclosure.hidden = false;
  return ready;
}

/** The idle and exceptional states, in the same region and with no action beside them. */
function paintStandby(doc, state, sentence) {
  const zone = byId(doc, EXPORT_CHECK_IDS.zone);
  const answer = byId(doc, EXPORT_CHECK_IDS.answer);
  if (!zone || !answer) return false;
  zone.dataset.check = state;
  answer.dataset.state = state === "refused" ? "unrecognized" : "idle";
  answer.textContent = sentence;
  byId(doc, EXPORT_CHECK_IDS.detail).hidden = true;
  byId(doc, EXPORT_CHECK_IDS.continue).hidden = true;
  byId(doc, EXPORT_CHECK_IDS.guidance).hidden = true;
  byId(doc, EXPORT_CHECK_IDS.disclosure).hidden = true;
  byId(doc, EXPORT_CHECK_IDS.capability).hidden = true;
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
    return paintStandby(doc, "refused", EXPORT_CHECK_COPY.unreadable) && false;
  }
  try {
    const [{ preflight }, { parseExportText }, { previewEarnableFigures }] = await Promise.all([
      import("./hyperscaler-export-adapters.js"),
      import("./browser-compat-eligibility.js"),
      // Loaded here for the reason the adapters are: the preview reads the
      // brief's own family list, so a static import would pull that graph into
      // the page's measured initial payload for a panel nobody has used yet.
      import("./finops-export-capability.js"),
    ]);
    const parsed = parseExportText(text, file?.name ?? "");
    const verdict = preflight(parsed);
    const ready = renderExportCheck(doc, verdict,
      Array.isArray(parsed?.fieldNames) ? parsed.fieldNames.map(String) : [],
      previewEarnableFigures(verdict));
    // Held only where there is something to continue into.
    if (ready) checkedFile = file;
    return ready;
  } catch {
    return paintStandby(doc, "unavailable", EXPORT_CHECK_COPY.unavailable) && false;
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
  zone.setAttribute("aria-labelledby", EXPORT_CHECK_IDS.title);

  const title = node(doc, "p", "import-drop-title", EXPORT_CHECK_COPY.title);
  title.id = EXPORT_CHECK_IDS.title;
  const instruction = node(doc, "p", "import-drop-instruction", EXPORT_CHECK_COPY.instruction);
  instruction.id = EXPORT_CHECK_IDS.instruction;

  const field = node(doc, "div", "local-import-field");
  const label = node(doc, "label", null, EXPORT_CHECK_COPY.label);
  label.setAttribute("for", EXPORT_CHECK_IDS.input);
  const input = node(doc, "input");
  input.id = EXPORT_CHECK_IDS.input;
  input.setAttribute("type", "file");
  input.setAttribute("accept", ACCEPT);
  input.setAttribute("aria-describedby", EXPORT_CHECK_IDS.instruction);
  field.append(label, input);

  // The live region, in the document from mount, with a sentence in it from
  // mount. Every later announcement is a write into THIS node.
  const answer = node(doc, "p", "import-reason", EXPORT_CHECK_COPY.idle);
  answer.id = EXPORT_CHECK_IDS.answer;
  answer.dataset.state = "idle";
  answer.setAttribute("role", "status");
  answer.setAttribute("aria-live", "polite");

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

  // The second disclosure, in the idiom of the first and shipping collapsed for
  // the same reason: a reader who wanted a yes or a no is not handed a figure
  // inventory first. Its summary is written with the counts on every paint, so
  // the fold hides which figures rather than how many.
  const capability = node(doc, "details", "export-package-help");
  capability.id = EXPORT_CHECK_IDS.capability;
  capability.hidden = true;
  const capabilitySummaryNode = node(doc, "summary");
  capabilitySummaryNode.id = EXPORT_CHECK_IDS.capabilitySummary;
  const capabilityList = node(doc, "ul", "import-slots");
  capabilityList.id = EXPORT_CHECK_IDS.capabilityList;
  capability.append(capabilitySummaryNode, capabilityList);

  zone.append(title, instruction, field, answer, detail, continueAction, guidance,
    disclosure, capability);
  return zone;
}

/**
 * Mount the check between the provider guidance and the picker that commits.
 *
 * Between, and not inside either: the guidance section is held to carrying no
 * disclosure of its own (a card that folds its own errand away is a card a
 * reader cannot read), and the picker is the path this one exists to be an
 * alternative to. It lands directly under the five console errands, which is
 * where a reader holding a file they are unsure about already is — and which is
 * what makes "the guidance above" the truthful wording on the refusal's link.
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
  // The picker's own field, used as the placement reference so the zone lands
  // after the guidance without this file having to walk sibling lists. A page
  // whose picker moved elsewhere gets the zone appended rather than misplaced.
  const field = byId(doc, "local-finops-files")?.parentNode;
  host.insertBefore(zone, field?.parentNode === host ? field : null);

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
