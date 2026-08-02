// The provider-native intake surface on the AI FinOps workspace (#930). It
// paints what buildIntake() returned and nothing else: one question, one metric
// sentence, one action, the trust signals under them, and the evidence behind
// a disclosure.
//
// Four constraints this file exists to honour:
//  - THE METRIC SENTENCE IS RESOLVED EXACTLY ONCE, before the provisional and
//    answered paths split. A null metric is its own non-answer with its own
//    sentence; the provisional prefix is applied on top of whichever sentence
//    was resolved. There is therefore no path on which a render reads a field
//    of a metric that is not there, and no path on which some of the three
//    slots paint and the rest do not.
//  - the finding region is a live region and is NEVER inside the disclosure.
//    Folded-away status text is not announced in a real browser however
//    readable a test harness finds it.
//  - no cell value from a reader's file is painted. The rate table carries
//    counts, sums and ranks; the model identity is a grouping key inside
//    provider-native-import.js and never leaves it.
//  - recognition confidence, provenance, recovery guidance and the privacy
//    boundary are signals under the answer, not alerts beside it: one list,
//    plain, no role="alert", so the answer stays the loudest thing on screen.

import { PRIVACY_POLICY } from "./browser-compat-contracts.js";
import { ACCEPTED_MIN_CONFIDENCE } from "./export-recognition.js";
import {
  IMPORT_STATUS, IMPORT_STATUS_CHIPS, classificationChip, importStatusChip, intakeStatus,
  isUnsettled, renderChip,
} from "./import-status-chip.js";
import {
  INTAKE_STATES, NO_RATE_SENTENCE, PROVISIONAL_PREFIX, buildIntake, importableContracts,
} from "./provider-native-import.js";
import {
  NATIVE_IMPORT_EXAMPLES, nativeExampleById, nativeExamplesForProvider,
} from "./provider-native-import-fixtures.js";

// Shared with the eligibility check (#927): one provider chooser on the page,
// not two that can disagree about which provider the reader is working with.
const PROVIDER_ID = "browser-compat-provider";
const DROP_ID = "provider-native-drop";
const FILE_ID = "provider-native-file";
const EXAMPLE_ID = "provider-native-example";
const FINDING_ID = "provider-native-finding";
const TRUST_ID = "provider-native-trust";
const EVIDENCE_ID = "provider-native-evidence";
const EVIDENCE_BODY_ID = "provider-native-evidence-body";
const STATUS_ID = "provider-native-status";
export const RESOLVE_ID = "provider-native-resolve";
export const RESOLVE_LABEL = "Show what is uncertain";

// Said before anything has been read. Deliberately not a finding: an empty
// answer slot must not read as "nothing expensive was found".
export const EMPTY_FINDING_COPY = "No export has been read yet. Choose the provider you "
  + "exported from, then drop a file here, pick one with the file control, or read a "
  + "bundled example.";

// Said when the file was chosen but could not be read at all — a directory, a
// revoked handle, a file the browser refused. It is a state, not a thrown error.
export const UNREADABLE_FILE_COPY = "That file could not be read in this tab. Choose it "
  + "again, or export a fresh copy and drop that.";

// Said when the example chooser holds a value that is not a bundled example. A
// real control refuses an unlisted value and a test harness does not, so the
// refusal lives here, in application code, rather than in the control.
export const UNKNOWN_EXAMPLE_COPY = "That is not one of the bundled examples. "
  + "Choose one from the list to read it.";

// Repeated on every render: it is the claim the whole surface rests on, and it
// is the shared policy statement rather than a fourth wording of it.
export const LOCAL_SCOPE_COPY = PRIVACY_POLICY.positiveStatement;

const node = (doc, tag, className, text) => {
  const created = doc.createElement(tag);
  if (className) created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
};

const integer = (value) => String(Math.round(value));
const usd = (value) => `$${value.toFixed(value >= 1 ? 2 : 4)}`;

// ---------------------------------------------------------------- slots

/**
 * The metric sentence for an intake, whatever state it is in.
 *
 * Resolved in ONE place, and it never dereferences a metric it has not just
 * checked for. The three cases are a computed rate, a recognized export with no
 * rate in it, and a file that was not the chosen provider at all — the last two
 * are different non-answers and are worded differently on purpose.
 */
function metricSentence(intake) {
  if (intake.metric) return intake.metric.statement;
  if (intake.state === INTAKE_STATES.UNRECOGNIZED) {
    return `No rate was computed, because this export was not read as the provider you `
      + `chose. ${intake.guidance}`;
  }
  return NO_RATE_SENTENCE;
}

/** Confidence, provenance, recovery guidance, and the privacy boundary. */
export function trustSignals(doc, root, intake) {
  const { recognition, provenance } = intake;
  const signals = [[
    "confidence",
    `Recognition confidence ${recognition.confidence} of ${recognition.maxConfidence}, `
    + `against an accepted gate of ${ACCEPTED_MIN_CONFIDENCE}. Band: ${recognition.band}.`,
  ]];
  // The count clause is the real count or it is absent. It is never a hardcoded
  // zero next to a named contract: a file whose records parsed cleanly being
  // told none of them did is the one thing this surface cannot say.
  const parsedClause = `${provenance.recordCount} record${provenance.recordCount === 1 ? "" : "s"} parsed`;
  const readableClause = provenance.readableRecords === null ? ""
    : `, ${provenance.readableRecords} of them carrying a readable unit count and cost`;
  // The source is named so a reader can tell a finding about their own file
  // from one about a bundled example. It is the label they chose or the name
  // their own file already had — never a value out of the file.
  const source = intake.sourceLabel ? ` · ${intake.sourceLabel}` : "";
  signals.push(["provenance", provenance.providerName
    ? `${provenance.providerName} contract v${provenance.contractVersion} · `
      + `${String(provenance.format ?? "unknown").toUpperCase()} · ${parsedClause}${readableClause}${source}.`
    : `No published contract matched this file · ${parsedClause}${readableClause}${source}.`]);
  if (intake.guidance) signals.push(["guidance", intake.guidance]);
  signals.push(["privacy", LOCAL_SCOPE_COPY]);
  root.dataset.state = "ready";
  root.replaceChildren(...signals.map(([key, statement]) => {
    const item = node(doc, "li", `provider-native-signal provider-native-${key}`, statement);
    item.dataset.signal = key;
    return item;
  }));
  return true;
}

/**
 * Opens the evidence disclosure and puts focus on its own control.
 *
 * Focus lands on the summary rather than inside the body, so the reader who
 * pressed the button can close what they just opened without hunting for it.
 */
export function openEvidence(doc) {
  const evidence = doc.getElementById(EVIDENCE_ID);
  if (!evidence) return false;
  evidence.open = true;
  evidence.dataset.open = "true";
  const summary = evidence.querySelector?.("summary");
  summary?.focus?.();
  return true;
}

/**
 * Provider, then confidence, then what is uncertain, then the control that
 * resolves it — painted ABOVE the finding so the section's DOM order is the
 * reading order an executive actually needs: which provider this is, how sure
 * the workspace is, and only then the figure and the action below.
 *
 * This row is deliberately NOT a live region. The finding under it already
 * announces, and two live regions for one reading interrupt a screen reader
 * twice for one event. It is always rendered and never folded into a
 * disclosure, so the state is reachable without opening anything.
 */
export function renderImportStatus(doc, intake, { status = null } = {}) {
  const root = doc.getElementById(STATUS_ID);
  if (!root) return false;
  const resolved = status
    ?? (intake ? intakeStatus(intake.state, Boolean(intake.metric)) : IMPORT_STATUS.PENDING);
  const chip = importStatusChip(resolved, {
    confidence: intake?.recognition?.confidence ?? null,
    max: intake?.recognition?.maxConfidence,
  });
  const parts = [];
  // The provider is the first thing read, and it is a classification: an
  // outline chip, so it cannot be mistaken for the verdict beside it.
  const provider = intake?.provenance?.providerName;
  if (intake) {
    parts.push(renderChip(doc, provider
      ? classificationChip(provider, `contract v${intake.provenance.contractVersion}`)
      : classificationChip("No contract matched")));
  }
  parts.push(renderChip(doc, chip));
  root.dataset.status = resolved;
  root.dataset.unsettled = String(isUnsettled(resolved));
  if (chip.uncertainty) {
    parts.push(node(doc, "p", "provider-native-uncertainty",
      `${chip.uncertainty} ${chip.next}`));
  }
  // A real control, beside the status rather than under the evidence: an
  // unsettled import is the one state where the reader's next move must be one
  // key away. It opens the evidence and moves focus into it, so the keyboard
  // path from "this is ambiguous" to "here is why" is a single press.
  if (isUnsettled(resolved)) {
    const button = node(doc, "button", "provider-native-resolve", RESOLVE_LABEL);
    button.id = RESOLVE_ID;
    button.type = "button";
    button.addEventListener("click", () => openEvidence(doc));
    parts.push(button);
  }
  root.replaceChildren(...parts);
  return true;
}

/** The rate table and the recognition evidence, behind the disclosure. */
export function evidenceBody(doc, root, intake) {
  const lines = [];
  if (intake.rows.length) {
    lines.push(node(doc, "p", "provider-native-evidence-lead",
      `Rate table · ${intake.rows.length} model${intake.rows.length === 1 ? "" : "s"} with a `
      + "readable rate, highest first. Model identifiers are grouped in this tab and never "
      + "rendered, so the rows are counts and figures only."));
    const table = node(doc, "ol", "provider-native-rates");
    for (const row of intake.rows) {
      const item = node(doc, "li", null,
        `#${row.rank} · ${usd(row.ratePer1k)} per 1,000 units · ${integer(row.units)} units · `
        + `${usd(row.costUsd)} · ${row.records} record${row.records === 1 ? "" : "s"}`);
      item.dataset.rank = String(row.rank);
      table.append(item);
    }
    lines.push(table);
  } else {
    lines.push(node(doc, "p", "provider-native-evidence-lead",
      "No rate table: no record in this export carries both a billed unit count above zero "
      + "and a readable cost, so there is nothing to rank."));
  }
  const evidence = node(doc, "ol", "provider-native-recognition");
  for (const entry of intake.recognition.evidence) {
    const item = node(doc, "li", null,
      `${entry.contribution} of ${entry.weight} · ${entry.label} — ${entry.statement}`);
    item.dataset.signalId = entry.signalId;
    evidence.append(item);
  }
  lines.push(node(doc, "p", "provider-native-evidence-lead",
    `How this file was recognized, one line per signal, adding up to ${intake.recognition.confidence}.`));
  lines.push(evidence);
  root.replaceChildren(...lines);
  return true;
}

// ---------------------------------------------------------------- render

/**
 * Paints the whole finding for one intake, or the empty state for null.
 *
 * Every render runs the same path end to end: three slots, then the trust
 * signals, then the evidence, then the disclosure state. Nothing is skipped for
 * a null metric, which is what an earlier version got wrong — it threw before
 * the trust signals ran, and the region kept the PREVIOUS file's answer with no
 * error anywhere on the page.
 */
export function renderProviderImport(doc, intake, { reason = null } = {}) {
  const finding = doc.getElementById(FINDING_ID);
  const trust = doc.getElementById(TRUST_ID);
  const evidence = doc.getElementById(EVIDENCE_ID);
  const body = doc.getElementById(EVIDENCE_BODY_ID);
  if (!finding || !trust || !evidence || !body) return false;
  if (!intake) {
    renderImportStatus(doc, null,
      { status: reason ? IMPORT_STATUS.REJECTED : IMPORT_STATUS.PENDING });
    finding.dataset.state = "empty";
    finding.dataset.metric = "none";
    finding.replaceChildren(node(doc, "p", "provider-native-question", reason ?? EMPTY_FINDING_COPY));
    trust.dataset.state = "empty";
    trust.replaceChildren();
    body.replaceChildren(node(doc, "p", "provider-native-evidence-lead",
      "The rate table and the recognition evidence appear here once an export has been read."));
    evidence.open = false;
    evidence.dataset.open = "false";
    return true;
  }
  // ONE resolution, BEFORE the split below. The provisional prefix is applied to
  // whichever sentence came back, so the confidence branch never has to know
  // whether there was a metric at all.
  const resolved = metricSentence(intake);
  const sentence = intake.state === INTAKE_STATES.PROVISIONAL
    ? `${PROVISIONAL_PREFIX} ${resolved}` : resolved;
  renderImportStatus(doc, intake);
  finding.dataset.state = intake.state;
  finding.dataset.metric = intake.metric ? "rate" : "none";
  // Reading order is the answer order: the question, then the figure that
  // answers it, then the one thing to do about it.
  finding.replaceChildren(
    node(doc, "p", "provider-native-question", intake.question),
    node(doc, "p", "provider-native-metric", sentence),
    node(doc, "p", "provider-native-action", `Do this next: ${intake.action}`));
  trustSignals(doc, trust, intake);
  evidenceBody(doc, body, intake);
  // Opened when there is no settled figure: the reason a reader is not being
  // given a rate has to be reachable without a second interaction. A settled
  // answer keeps its evidence folded, which is what progressive disclosure is.
  const open = intake.state !== INTAKE_STATES.ANSWERED || !intake.metric;
  evidence.open = open;
  evidence.dataset.open = String(open);
  return true;
}

// ---------------------------------------------------------------- wiring

function optionsFor(doc, select, entries) {
  select.replaceChildren(...entries.map(({ value, label }) => {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

export function fillNativeExamples(doc, providerId) {
  const example = doc.getElementById(EXAMPLE_ID);
  if (!example) return false;
  const available = nativeExamplesForProvider(providerId);
  optionsFor(doc, example, available.map((entry) => ({ value: entry.id, label: entry.label })));
  // Taken from the fixture list rather than from select.options: the default has
  // to be a value the read handler can resolve, and a select is the one control
  // a test harness will happily hand back a value a browser would refuse.
  example.value = available[0]?.id ?? "";
  return true;
}

/** Fills both choosers and paints the empty state. */
export function initProviderImport(doc) {
  const provider = doc.getElementById(PROVIDER_ID);
  const example = doc.getElementById(EXAMPLE_ID);
  const finding = doc.getElementById(FINDING_ID);
  if (!provider || !example || !finding) return false;
  // The replace is deliberate and safe: the eligibility check (#927) fills this
  // same control with exactly one option per published contract and nothing
  // else, so replacing them writes back the identical option set and this
  // surface cannot depend on which of the two initialisers ran first. If that
  // control ever gains an option that is not a contract, this line has to
  // become a merge instead — tests/provider-native-import.test.js asserts the
  // option SET, so a new option there fails here rather than vanishing quietly.
  optionsFor(doc, provider, importableContracts().map((contract) => ({
    value: contract.providerId, label: contract.displayName })));
  provider.value = importableContracts()[0].providerId;
  fillNativeExamples(doc, provider.value);
  renderProviderImport(doc, null);
  return true;
}

const readFinding = (doc, providerId, { text, fileName, sourceLabel }) =>
  renderProviderImport(doc, buildIntake({ text, fileName, providerId, sourceLabel }));

/** Wires the drop target, the file control, the example chooser and the provider. */
export function bindProviderImport(doc) {
  const provider = doc.getElementById(PROVIDER_ID);
  const example = doc.getElementById(EXAMPLE_ID);
  const file = doc.getElementById(FILE_ID);
  const drop = doc.getElementById(DROP_ID);
  if (!provider || !example || !file || !drop) return false;

  const readFile = async (chosen) => {
    if (!chosen) return;
    let text = null;
    try {
      text = await chosen.text();
    } catch {
      renderProviderImport(doc, null, { reason: UNREADABLE_FILE_COPY });
      return;
    }
    readFinding(doc, provider.value, {
      text, fileName: chosen.name, sourceLabel: `your file ${chosen.name}`,
    });
  };

  provider.addEventListener("change", () => {
    fillNativeExamples(doc, provider.value);
    renderProviderImport(doc, null);
  });
  example.addEventListener("change", () => {
    const chosen = nativeExampleById(example.value);
    if (!chosen) {
      renderProviderImport(doc, null, { reason: UNKNOWN_EXAMPLE_COPY });
      return;
    }
    readFinding(doc, provider.value, {
      text: chosen.text, fileName: chosen.fileName,
      sourceLabel: `bundled example · ${chosen.label}`,
    });
  });
  file.addEventListener("change", () => readFile(file.files?.[0] ?? null));
  // Drag and drop is an ADDITION to the file control, never a replacement: the
  // control above stays in the tab order and does the same job, so a reader who
  // cannot drag is not locked out of the surface.
  drop.addEventListener("dragover", (event) => {
    event.preventDefault?.();
    drop.dataset.dragging = "true";
  });
  drop.addEventListener("dragleave", () => { drop.dataset.dragging = "false"; });
  drop.addEventListener("drop", (event) => {
    event.preventDefault?.();
    drop.dataset.dragging = "false";
    return readFile(event.dataTransfer?.files?.[0] ?? null);
  });
  return true;
}

/** Every bundled example, for tests and for the page's own smoke checks. */
export const nativeImportExamples = () => NATIVE_IMPORT_EXAMPLES;
