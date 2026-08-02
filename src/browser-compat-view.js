// The eligibility surface on the AI FinOps workspace. Every provider card here
// is generated from BROWSER_COMPAT_MANIFEST — adding a fourth contract makes a
// fourth card appear with no edit to this file and none to evolution.html.
//
// Two constraints this file exists to honour:
//  - the verdict is announced in a live region that is NEVER inside a collapsed
//    <details>. Content folded away that way is not announced in a real browser
//    even though a test harness can still read its text.
//  - the empty state and the "checked, nothing wrong" state say different
//    things. "No problems found" before anything has been checked is a claim
//    the page has not earned.

import {
  BROWSER_COMPAT_MANIFEST, PRIVACY_POLICY,
} from "./browser-compat-contracts.js";
import { BROWSER_COMPAT_FIXTURES, fixturesForProvider } from "./browser-compat-fixtures.js";
import { ELIGIBILITY_STATUS } from "./browser-compat-eligibility.js";

const CONTRACTS_ID = "browser-compat-contracts";
const PRIVACY_ID = "browser-compat-privacy";
const PROVIDER_ID = "browser-compat-provider";
const EXAMPLE_ID = "browser-compat-example";
const RUN_ID = "browser-compat-run";
const VERDICT_ID = "browser-compat-verdict";

const VERDICT_LABEL = Object.freeze({
  [ELIGIBILITY_STATUS.SUPPORTED]: "Recognized · supported",
  [ELIGIBILITY_STATUS.DEGRADED]: "Recognized · accepted with reduced confidence",
  [ELIGIBILITY_STATUS.REJECTED]: "Recognized · not eligible",
  [ELIGIBILITY_STATUS.NO_MATCH]: "Not recognized · no contract matched",
});

// Said before any file has been checked. Deliberately not "no problems found".
export const VERDICT_EMPTY_COPY = "No export has been checked yet. "
  + "Choose a bundled example or one of your own export files, then run the check.";

const node = (doc, tag, className, text) => {
  const created = doc.createElement(tag);
  if (className) created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
};

function fieldList(doc, fields) {
  const list = node(doc, "ul", "browser-compat-fields");
  for (const field of fields) {
    list.append(node(doc, "li", null, `${field.path} · ${field.type} · ${field.meaning}`));
  }
  return list;
}

function contractCard(doc, contract) {
  const card = node(doc, "article", "browser-compat-card");
  card.dataset.providerId = contract.providerId;
  card.append(node(doc, "h4", null, contract.displayName));
  card.append(node(doc, "p", "browser-compat-version",
    `Contract v${contract.contractVersion} · ${contract.exportShape.format.toUpperCase()} `
    + `· ${contract.exportShape.encoding} · ${contract.exportShape.topLevelStructure}`));
  card.append(node(doc, "p", "browser-compat-records",
    `Records: ${contract.exportShape.recordLocation}`));
  card.append(node(doc, "h5", null, `Required fields (${contract.requiredFields.length})`));
  card.append(fieldList(doc, contract.requiredFields));
  card.append(node(doc, "h5", null, "Not supported, and what to export instead"));
  const rejections = node(doc, "dl", "browser-compat-rejections");
  for (const unsupported of contract.unsupportedCases) {
    rejections.append(node(doc, "dt", null, unsupported.reason));
    const remedy = node(doc, "dd", null, unsupported.remedy);
    remedy.dataset.code = unsupported.code;
    rejections.append(remedy);
  }
  card.append(rejections);
  card.append(node(doc, "p", "browser-compat-local",
    `${contract.localOnlyHandling.read} ${contract.localOnlyHandling.discarded}`));
  return card;
}

/** Paints the per-provider cards and the shared prohibitions. */
export function renderBrowserCompatContracts(doc, manifest = BROWSER_COMPAT_MANIFEST) {
  const root = doc.getElementById(CONTRACTS_ID);
  const privacy = doc.getElementById(PRIVACY_ID);
  if (!root || !privacy) return false;
  root.replaceChildren(...manifest.contracts.map((contract) => contractCard(doc, contract)));
  root.dataset.state = "ready";
  root.dataset.contractCount = String(manifest.contracts.length);
  const count = doc.getElementById("browser-compat-count");
  if (count) count.textContent = `${manifest.contracts.length} versioned contracts`;
  privacy.replaceChildren(
    node(doc, "li", "browser-compat-privacy-positive", manifest.privacyPolicy.positiveStatement),
    ...manifest.privacyPolicy.prohibitions.map((rule) => {
      const item = node(doc, "li", null, rule.statement);
      item.dataset.key = rule.key;
      return item;
    }));
  privacy.dataset.state = "ready";
  return true;
}

function optionsFor(doc, select, entries) {
  select.replaceChildren(...entries.map(({ value, label }) => {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

/** Fills both choosers from manifest and fixture data, and paints the empty state. */
export function initBrowserCompatCheck(doc, manifest = BROWSER_COMPAT_MANIFEST) {
  const provider = doc.getElementById(PROVIDER_ID);
  const example = doc.getElementById(EXAMPLE_ID);
  const verdict = doc.getElementById(VERDICT_ID);
  if (!provider || !example || !verdict) return false;
  optionsFor(doc, provider, manifest.contracts.map((contract) => ({
    value: contract.providerId, label: contract.displayName })));
  provider.value = manifest.contracts[0].providerId;
  fillExamples(doc, provider.value);
  renderBrowserCompatVerdict(doc, null);
  return true;
}

export function fillExamples(doc, providerId) {
  const example = doc.getElementById(EXAMPLE_ID);
  if (!example) return false;
  const available = fixturesForProvider(providerId);
  optionsFor(doc, example, available.map((fixture) => ({ value: fixture.id, label: fixture.label })));
  // Taken from the fixture list rather than from select.options: the default has
  // to be a value the run handler can actually resolve, and a select is the one
  // control the test harness will happily hand back a value a browser refuses.
  example.value = available[0]?.id ?? "";
  return true;
}

/**
 * @param verdict  an evaluateExport() result, or null for the untouched state.
 * @param context  { sourceLabel } — what was checked, so the reader can tell a
 *                 verdict about their file from one about a bundled example.
 */
export function renderBrowserCompatVerdict(doc, verdict, context = {}) {
  const root = doc.getElementById(VERDICT_ID);
  if (!root) return false;
  if (!verdict) {
    root.dataset.state = "empty";
    root.dataset.status = "none";
    root.replaceChildren(node(doc, "p", "browser-compat-verdict-line", VERDICT_EMPTY_COPY));
    return true;
  }
  root.dataset.state = "checked";
  root.dataset.status = verdict.status;
  root.dataset.code = verdict.code ?? "none";
  const lines = [node(doc, "p", "browser-compat-verdict-line",
    `${VERDICT_LABEL[verdict.status]} — ${context.sourceLabel ?? "selected export"}`)];
  if (verdict.providerId) {
    lines.push(node(doc, "p", null,
      `Matched ${verdict.displayName} contract v${verdict.contractVersion}.`));
  }
  lines.push(node(doc, "p", "browser-compat-verdict-reason", verdict.reason));
  if (verdict.remedy) lines.push(node(doc, "p", "browser-compat-verdict-remedy", verdict.remedy));
  if (verdict.status === ELIGIBILITY_STATUS.DEGRADED) {
    lines.push(node(doc, "p", "browser-compat-verdict-detail", degradationDetail(verdict)));
  }
  if (verdict.status === ELIGIBILITY_STATUS.SUPPORTED) {
    lines.push(node(doc, "p", "browser-compat-verdict-detail",
      `${verdict.acceptedRows} of ${verdict.recordCount} records read cleanly. `
      + (verdict.notes.length
        ? `${verdict.notes[0].statement}` : "No skipped rows and no gap in the period.")));
  }
  root.replaceChildren(...lines);
  return true;
}

function degradationDetail(verdict) {
  const parts = verdict.cases.map((fired) => {
    if (fired.skippedRows !== undefined) return `${fired.skippedRows} record(s) skipped`;
    if (fired.ageDays !== undefined) {
      return `latest record ${fired.latestRecordDate}, ${fired.ageDays} days before the reference date `
        + `(freshness window ${fired.windowDays} days)`;
    }
    if (fired.missingDays !== undefined) return `${fired.missingDays} day(s) missing from the period`;
    return fired.code;
  });
  return `${verdict.acceptedRows} of ${verdict.recordCount} records accepted · ${parts.join(" · ")}.`;
}

/**
 * Wires the two choosers, the file input, and the run control.
 * @param evaluate  ({ text, fileName, providerId, bundled }) => verdict, supplied
 *                  by the page so this module stays free of parsing and of any
 *                  decision about which reference date freshness is measured at.
 */
export function bindBrowserCompatCheck(doc, evaluate) {
  const provider = doc.getElementById(PROVIDER_ID);
  const example = doc.getElementById(EXAMPLE_ID);
  const run = doc.getElementById(RUN_ID);
  if (!provider || !example || !run) return false;
  provider.addEventListener("change", () => {
    fillExamples(doc, provider.value);
    renderBrowserCompatVerdict(doc, null);
  });
  run.addEventListener("click", async () => {
    run.disabled = true;
    try {
      // Bundled examples only. The reader's own export has ONE way in (#958) —
      // the drop-anywhere import, which recognizes the provider from the file
      // rather than asking this section's chooser about it.
      const fixture = BROWSER_COMPAT_FIXTURES.find((entry) => entry.id === example.value);
      // The harness's select accepts a value a real control would refuse, so the
      // lookup is guarded rather than trusted: an unknown id paints nothing.
      if (!fixture) return;
      renderBrowserCompatVerdict(doc, evaluate({ text: fixture.text,
        fileName: fixture.fileName, providerId: provider.value, bundled: true }),
      { sourceLabel: `bundled example · ${fixture.label}` });
    } finally {
      run.disabled = false;
    }
  });
  return true;
}
