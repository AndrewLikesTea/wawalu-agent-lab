// Page wiring for the AI FinOps tab. This is the only layer that knows where the
// data comes from and how it becomes DOM; evolution.js keeps the scoring rules
// pure and testable.
//
// Demo only (PRODUCT.md): the seed is static, hand-authored sample data served
// from this origin. No gateway, HRIS, provider API, or customer prompt is read.
// Every node is built with createElement and textContent; the site policy forbids
// executing user-generated markup, so no markup string is ever assigned here.

import {
  actionPlanFor, benchmarkComparison, departmentPerformance, departmentTrend, evidenceForDepartment,
  QUERY_CATEGORIES, formatCount, formatPercent, formatUsd,
  letterGrade, literacyScore, quartileLabel, rankDepartmentsForHelp,
  recoverableSpendUsd, redactForScoring, summarize,
} from "/evolution.js";
import { formatIntegrationProvenance } from "/integration-contracts.js";
import { createStaticGateway } from "/static-gateway.js";
import { createFinancePortfolio } from "/finance-portfolio.js";
import { mountFinancePortfolio, renderPortfolioUnavailable } from "/finance-portfolio-view.js";
import {
  renderFinopsEvaluationPanel, renderFinopsEvaluationUnavailable,
} from "/finops-evaluation-view.js";
import { localFinopsMeetingSummary, normalizeLocalFinopsHistory } from "/local-finops.js";
// The download itself. Every figure decision is inside `briefingFile`; the only
// thing this layer contributes is the clock, because the generator is pure and
// will not read one.
import { briefingFile } from "/finops-briefing-export.js";
// One entry point for a selected file: `.json` keeps the reviewed JSON path
// untouched, `.csv`/`.tsv`/`.txt` route through the delimited normalizer. Both
// return the same parsed v1 envelope, so nothing below this line changes.
import { isDelimitedFileName, parseLocalImportFile } from "/finops-tabular-import.js";
import { readDelimitedText } from "/delimited-text.js";
// Where that one call runs. A module worker when the browser has one, this
// thread when it does not; the ceilings and the messages are the same either
// way, and the worker calls the same `parseLocalImportFile` imported above.
import { CANCELLED_CODE, checkImportCeiling, createImportOffloader } from "/import-offload.js";
// The column-review step. The model owns what every column became; the view
// owns the surface; this layer owns only when the step opens and closes.
import { createColumnMapping, mappingBinding, setColumnTarget, setMappingKind } from "/import-column-mapping.js";
import {
  closeMappingReview, focusMappingReview, renderMappingReview,
} from "/import-mapping-view.js";
import { headlineTrust } from "/finops-display.js";
// Whether the letter may be shown at all is decided before it is drawn: the
// score card is a roll-up of only the departments the rubric actually scored.
import { gradeEligibility } from "/grade-eligibility.js";
import {
  announce as announceStage, applyDatasetProvenance, applyFieldDiagnostic, applyImportLimits,
  applyBriefing, applyImportProgress, applyMetricBasis, applyRequirements, applyRestoreRejection,
  applyRestoredBriefing, applyStage, applyTrustVerdict, diagnosticFor, EXAMPLE_DATASET_PROVENANCE,
  focusStageHeading, importStage, metricBasis, userDatasetProvenance,
} from "/local-import-flow.js";
// A leader's own graded sample. The rubric and the eligibility tier are both
// upstream and unchanged here; `graded-sample-figures.js` only decides which of
// the three states the three panels are in, and `graded-sample-view.js` paints
// them. The one adapter this page adds is the routing below: a selected file
// that the query-sample validator accepts is a sample, not a provider export.
import {
  CLASSIFICATION_FIELDS, REQUIRED_QUERY_SAMPLE_FIELDS,
  classifyQuerySample, parseQuerySample,
} from "/query-sample-contract.js";
import { scorePromptLiteracy } from "/prompt-literacy-scoring.js";
import { gradedSampleFigures, querySampleEligibility } from "/graded-sample-figures.js";
import { promptGradingEligibility, promptGradingSignals } from "/prompt-grading-eligibility.js";
import { applyGradedSample, clearGradedSample } from "/graded-sample-view.js";
import {
  FINOPS_IMPORT_STATUS, finopsProvenanceModel, promptImportFacts,
} from "/finops-provenance-model.js";
import { applyFinopsProvenance, clearFinopsProvenance } from "/finops-provenance-view.js";
import { loadExampleDatasetInputs } from "/example-dataset.js";
import { EXAMPLE_QUERY_SAMPLE_FILE, exampleQuerySampleText } from "/query-sample-example.js";
import {
  CONVERSATION_EXAMPLE_FILES, conversationExampleText,
} from "/conversation-export-example.js";
// The versioned briefing contract. The three slots above the fold — the
// question, the one figure, and the rank-1 action — are selected there and only
// there, so this page, the JSON export, and anything downstream cannot each
// decide them for themselves. The month-over-month arithmetic still lives in
// finops-leading-finding.js; the contract reads it rather than repeating it.
import { buildFinopsBriefing } from "/finops-briefing-contract.js";
// Reopening a briefing this page previously wrote. It consumes the artifact the
// Export JSON button produces and nothing else, re-selects the slots through the
// same contract above, and compares against the analysis on screen only where
// the two are actually comparable.
import { briefingDelta, parseSavedBriefing } from "/finops-briefing-restore.js";
// The published attribution policy: three input states, one classification table,
// two thresholds. Nothing on this page decides any of that for itself.
import {
  analysisEligibility, attributedSpendShare, attributionShareFromTotals, classifyFinding, CONFIDENCE,
  FINDING_CATEGORIES, largestConcentrationLine, providerExportInputState, suppressedSavingsFallback,
} from "/finops-attribution-policy.js";
import {
  applyAttributionNote, applyPreUploadDisclosure, applySuppressedSavings,
} from "/finops-attribution-view.js";
// One confidence treatment for the KPI row, the spend mix, the findings list,
// and the recoverable figure, plus the single ranked upgrade action. Both
// modules read the policy above; neither decides a threshold of its own.
import {
  coverageChangeAnnouncement, coverageChangeSummary, coverageModel,
} from "/attribution-confidence.js";
import {
  announceCoverageChange, applyAttributionSplit, applyChangeSummary, applyCoverageTreatment,
} from "/attribution-confidence-view.js";
import { trustVerdict } from "/finops-trust-verdict.js";
// The per-model overspend finding and its progressively disclosed evidence.
// The panel is fed the bundled synthetic finding while the example dataset is
// on screen: `model-overspend-finding/1.0.0` has no producer in this repository
// yet (the import path carries neither a model identifier nor a request count —
// see docs/model-overspend-finding-contract.md), so an imported file cannot
// honestly fill it and the panel stays hidden for one.
import {
  clearModelOverspendFinding, renderModelOverspendFinding,
} from "/model-overspend-finding-view.js";
// The one thing this page writes down, and it is not analysis state: the
// display labels a leader gives their own opaque org-unit identifiers. The
// store is reached through that module, so this file persists nothing itself.
import { browserOrgUnitLabelStorage as labelStorage } from "/org-unit-labels.js";
// The contact affordance beside the result. It is mounted here and given no
// access to anything above: it reads its own form fields and nothing else, so
// the "only what you type is sent" claim beside it holds by construction.
import { initFinopsContact } from "/finops-contact.js";

const DATA_URL = "/evolution-demo-data.json";
const EVALUATION_URL = "/finops-evaluation-fixtures.json";
const MODEL_OVERSPEND_URL = "/model-overspend-finding-fixture.json";
// Repainting the bundled headline and mix, from the last analysis that loaded.
// "Return to example data" has to put the example figures back into the same
// slots a graded sample borrowed, and re-running the two renderers is the only
// way to do that without a second copy of them.
let repaintBundledAnalysis = () => {};
const CATEGORY_VARS = {
  highValue: "--cat-high-value",
  overProvisioned: "--cat-over-provisioned",
  inefficient: "--cat-inefficient",
  outOfScope: "--cat-out-of-scope",
};

/** Grade bands drive the chip and hero color; the letter and number always ship with it. */
function band(score) {
  if (score >= 80) return "good";
  if (score >= 65) return "watch";
  return "poor";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function setLoadState(state, title, copy) {
  const region = document.getElementById("finops-load-state");
  const retry = document.getElementById("finops-data-retry");
  if (region) region.dataset.state = state;
  setText("finops-load-title", title);
  setText("finops-load-copy", copy);
  if (retry) {
    retry.hidden = state !== "error";
    retry.disabled = state === "loading";
  }
}

function fillTextList(id, values, emptyText) {
  const list = document.getElementById(id);
  if (!list) return;
  list.replaceChildren();
  const items = values.length ? values : [emptyText];
  for (const value of items) list.append(element("li", undefined, value));
}

function setSampleVisibility(visible) {
  document.querySelectorAll("[data-sample-analysis]")
    .forEach((node) => { node.hidden = !visible; });
}

function downloadLocalExport(content, type, fileName) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function mountLocalFinopsImport() {
  const input = document.getElementById("local-finops-files");
  if (!input) return;
  const stateNode = document.getElementById("local-import-state");
  const resultsNode = document.getElementById("local-results");
  const clear = document.getElementById("clear-local-analysis");
  const remap = document.getElementById("remap-local-import");
  const loaded = { providers: [] };
  // Every accepted input, in selection order. A JSON envelope is parsed on
  // sight; a delimited file keeps its text and the mapping the reader confirmed,
  // so the step can be re-entered without re-selecting the file. All of it lives
  // in this closure for as long as the tab does and no longer.
  const imports = [];
  // Query samples, kept apart from the provider/HRIS pair above: they answer a
  // different question and are graded by a different module. Same lifetime as
  // everything else here — this closure, and no longer.
  const samples = [];
  let queue = [];
  let review = null;
  let result = null;
  // The briefing the live analysis last produced, kept so a restored briefing
  // can be compared against exactly what is on screen rather than against a
  // second selection made from the same envelope.
  let currentBriefing = null;
  // A briefing reopened from a file. Same lifetime as everything else in this
  // closure: this tab, and no longer. Nothing about it is written to storage,
  // the URL, or the network.
  let restored = null;
  // The coverage the reader was last shown, so a recalculation can say what
  // moved. Null before the first analysis, which is what keeps the polite region
  // silent on initial load.
  let coverageState = null;
  // One offloader for the life of the page. It builds its worker lazily, retires
  // it for good if the browser cannot load a module worker, and builds a fresh
  // one after a cancel — so a cancelled import leaves nothing to clean up here.
  const offloader = createImportOffloader({
    scope: window,
    workerUrl: new URL("./import-worker.js", import.meta.url).href,
  });
  const showProgress = (progress) => applyImportProgress(document, progress);
  /**
   * Run one import across the offload seam.
   *
   * The caller passes the same synchronous call it would otherwise have made.
   * Exactly one of the two runs: the worker reconstructs it from `options` and
   * runs `parseLocalImportFile` out of the same module this file imports, or —
   * when there is no worker — `sync` is invoked here. There is no second parser.
   */
  const runImport = (file, options, sync) => offloader.run({
    text: file.text, fileName: file.fileName, mediaType: file.mediaType,
    byteSize: file.byteSize, options, sync,
  }, { onProgress: showProgress });
  // One flag decides everything the reader is told about where these numbers
  // came from: the badge, the metric basis, every provenance note, and the two
  // download artifacts. Nothing else in this file gets to have an opinion.
  let exampleActive = false;
  const MAX_DISPLAY_USD = 1_000_000_000_000;
  const plausibleUsd = (value) => Number.isFinite(value) && value >= 0 && value <= MAX_DISPLAY_USD;
  const moneyText = (value) => plausibleUsd(value) ? `${value.toFixed(2)} USD` : "Needs review · value withheld";

  // One announcement per commit. A file input only commits on change, so there
  // is no keystroke to debounce; what matters is that a single message goes to
  // exactly one region, chosen by severity.
  const announce = (state, title, copy) => announceStage(document, {
    severity: state === "error" ? "assertive" : "polite", state, title, copy,
  });

  /**
   * Repaint the restored briefing against whatever is on screen right now.
   *
   * Called after every analysis change as well as after a load, because the
   * delta is a statement about a pair: the moment either side moves, the line
   * either changes or has to disappear. With no restored briefing this clears
   * the region, which is also how a rejected file leaves nothing behind.
   */
  function syncRestored() {
    applyRestoredBriefing(document, restored && {
      saved: restored,
      delta: briefingDelta(restored, result
        ? { dataset: exampleActive ? "example" : "user", result, briefing: currentBriefing }
        : null),
    });
  }

  // The stage indicator and the requirement rows are the same fact told twice:
  // where the flow is, and what is still missing. Both repaint together so they
  // can never disagree, and focus only moves when the stage actually changed.
  let stage = "select";
  // The last ranked upgrade set, so a requirement row can state the coverage the
  // reader's own file would actually gain rather than the standing sentence.
  let coverageUpgrades = null;
  const syncRequirements = () => applyRequirements(document, {
    providers: loaded.providers.length, hris: Boolean(loaded.hris),
    samples: samples.length, upgrades: coverageUpgrades,
  });
  const syncStage = ({ hasResult = false, focus = false } = {}) => {
    const next = importStage({
      providers: loaded.providers.length, hris: Boolean(loaded.hris), hasResult,
      reviewing: Boolean(review),
    });
    const changed = next !== stage;
    stage = next;
    applyStage(document, stage);
    syncRequirements();
    if (changed && focus) focusStageHeading(document, stage);
    return changed;
  };
  const setMode = (mode, label) => {
    const badge = document.getElementById("analysis-mode");
    if (badge) badge.dataset.mode = mode;
    setText("analysis-mode-label", label);
  };
  const showMetricBasis = (basis) => applyMetricBasis(document, metricBasis({
    ...basis, providers: loaded.providers.length, hris: Boolean(loaded.hris),
  }));
  // While example numbers are on screen, a mid-import state must not relabel
  // them: a partial or failed selection changes nothing about what the visible
  // result is, and swapping the label would leave example figures under a
  // non-example word.
  // A result the reader already has is not relabelled by what happened to the
  // *next* file. "Import failed" under a real, surviving figure would describe
  // the number as absent while it is on screen; the error owns the field it came
  // from, and the standing basis keeps describing the number it is under.
  const showTransientBasis = (mode) => (result && !exampleActive
    ? null
    : showMetricBasis({ mode: exampleActive ? "example-dataset" : mode }));
  const departmentFacts = (department) => {
    const trend = department.trendAvailable
      ? `${department.spendChangePercent > 0 ? "↑ Increase " : department.spendChangePercent < 0 ? "↓ Decrease " : "→ No change "}`
        + `${department.spendChangePercent > 0 ? "+" : ""}${department.spendChangePercent}% `
        + `(${department.spendChangeUsd >= 0 ? "+" : "−"}${Math.abs(department.spendChangeUsd).toFixed(2)} USD)`
      : `Unavailable · ${department.trendReason}`;
    const facts = element("dl");
    facts.replaceChildren(
      definitionTerm("Quantified impact", `${moneyText(department.spendUsd)} observed · ${moneyText(department.recoverableUsd)} scenario`),
      definitionTerm("Like-for-like trend", trend),
      definitionTerm("Confidence", `${result.confidence} · coarse billing category scenario`),
      definitionTerm("Provenance", `${department.records} joined aggregate${department.records === 1 ? "" : "s"} · ${result.period}`),
    );
    return facts;
  };
  const renderDepartments = (next) => {
    const list = document.getElementById("local-department-list");
    list?.replaceChildren();
    next.rankedDepartments.forEach((department, index) => {
      const item = element("li", "local-department-item");
      const button = element("button", "local-department-choice");
      const panel = element("div", "local-department-detail");
      const panelId = `local-department-panel-${index}`;
      button.type = "button";
      button.dataset.departmentId = department.id;
      button.setAttribute("aria-expanded", String(index === 0));
      button.setAttribute("aria-controls", panelId);
      button.setAttribute("aria-label",
        `${index === 0 ? "Collapse" : "Expand"} finding for ${department.name}, `
        + `${moneyText(department.recoverableUsd)} recoverable scenario`);
      button.append(
        element("span", "local-department-rank", String(index + 1).padStart(2, "0")),
        element("strong", undefined, department.name),
        element("span", "local-department-amount", moneyText(department.recoverableUsd)),
        element("span", "local-department-chevron"),
      );
      button.lastElementChild?.setAttribute("aria-hidden", "true");
      panel.id = panelId;
      panel.hidden = index !== 0;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", `${department.name} finding evidence`);
      panel.append(
        element("p", undefined,
          `${moneyText(department.recoverableUsd)} is the disclosed routing scenario. `
          + "It can be bounded and checked without inspecting prompt content."),
        departmentFacts(department),
      );
      button.addEventListener("click", () => {
        const expanded = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!expanded));
        button.setAttribute("aria-label",
          `${expanded ? "Expand" : "Collapse"} finding for ${department.name}, `
          + `${moneyText(department.recoverableUsd)} recoverable scenario`);
        panel.hidden = expanded;
      });
      item.append(button, panel);
      list?.append(item);
    });
    // Coverage rides on the ranking, because a ranked list over two-fifths of
    // the money is a different claim from the same list over all of it. A
    // degraded or suppressed ranking says which threshold fired and what share
    // was observed, so the reader never faces a panel that simply went quiet.
    const figure = next.attribution?.rankedRecoverable;
    const observed = figure?.coverage.attributedShare === null ? null
      : Math.round((figure?.coverage.attributedShare ?? 0) * 1000) / 10;
    if (figure && (figure.threshold.suppressed || figure.threshold.degraded
      || figure.coverage.unattributedSpend > 0)) {
      list?.prepend(element("li", "evidence-empty",
        `${moneyText(figure.coverage.unattributedSpend)} of `
        + `${moneyText(figure.totalSpendUsd)} carries no grouping value and is ranked as one `
        + `unattributed unit${observed === null ? "" : ` — ${observed}% attributed`}. `
        + (figure.threshold.suppressed
          ? `This ranking is not shown as actionable. ${figure.threshold.reason.rule}`
          : figure.threshold.degraded
            ? `This ranking is provisional. ${figure.threshold.reason.rule}`
            : "")));
    }
    if (!next.rankedDepartments.length)
      list?.append(element("li", "evidence-empty",
        "No department findings. No active HRIS unit matched a provider aggregate."));
  };
  // ---------------------------------------------------------------------
  // The attribution policy's inputs, read off what this page already holds.
  // Nothing is re-parsed and no grouping column is re-detected: the line items
  // are the parsed provider records, and whether the export carries a grouping
  // column is the versioned answer `native-grouping.js` already published.
  // ---------------------------------------------------------------------
  const providerLineItems = () => imports
    .filter((entry) => entry.parsed?.type === "provider")
    .flatMap((entry) => (entry.parsed.document?.records ?? []).map((record) => ({
      // One unit everywhere below: major USD, the unit `moneyText` prints.
      cost: (record.cost?.amount_minor ?? 0) / 100,
      groupingKey: record.org_unit_id ?? null,
      provider: record.provider ?? null,
      service: record.service_category ?? null,
    })));
  // A delimited export publishes `nativeGrouping`; a v1 JSON envelope carries
  // `org_unit_id` as a declared contract field, which is the same fact stated by
  // the contract instead of by detection. Either one is a grouping column.
  const hasGroupingColumn = () => imports.some((entry) => entry.parsed?.type === "provider"
    && (entry.state?.nativeGrouping?.status === "native"
      || (entry.parsed.document?.records ?? [])
        .some((record) => String(record.org_unit_id ?? "").trim())));
  /**
   * One place decides what the recoverable figure may claim. The share is
   * measured; `classifyFinding` decides the rest from the published table, and
   * a suppressed classification withholds the figure rather than hedging it.
   */
  const applyAttributionPolicy = (share) => {
    const inputState = providerExportInputState({
      hasProviderExport: loaded.providers.length > 0,
      hasGroupingColumn: hasGroupingColumn(),
      hasOrgMapping: Boolean(loaded.hris),
    });
    if (!inputState) {
      applyAttributionNote(document, null);
      applySuppressedSavings(document, null);
      applyCoverageTreatment(document, null);
      applyAttributionSplit(document, null);
      applyChangeSummary(document, null);
      coverageState = null;
      return null;
    }
    const measured = share?.share ?? null;
    const classification = classifyFinding(
      FINDING_CATEGORIES.RECOVERABLE_SAVINGS, inputState, measured,
    );
    applyAttributionNote(document, classification);
    const items = providerLineItems();
    // The same measured share the note above carries, spoken identically on the
    // KPI row, the spend mix, and the findings list. `knownGroups` is left null
    // on purpose: this page resolves every non-empty grouping value the export
    // carries, so restricting the known set here would invent a gap the analysis
    // does not actually have.
    const model = coverageModel({
      inputState, share: measured, lineItems: items, knownGroups: null,
    });
    applyCoverageTreatment(document, model);
    // Both halves of the money, beside the number they qualify — built from the
    // *same* two totals the classification above read, not from a second count
    // of the same rows. A split measured a different way would print "100%
    // attributed" beside a coverage line that says 0%.
    applyAttributionSplit(document,
      share?.defined ? { total: share.totalCost, attributed: share.attributedCost } : null,
      { formatMoney: moneyText });
    // The requirement rows now carry the projected coverage this reader's own
    // file would gain, so the optional upgrades stop being a standing sentence
    // and start being a number they can weigh.
    coverageUpgrades = model?.upgrade ?? null;
    syncRequirements();
    // Announced only when something moved. Focus is not taken here: a rendered
    // result already ends on `focusStageHeading(document, "read")`, which lands
    // on the same result heading, and two moves for one change is one too many.
    const nextState = { inputState, share: measured };
    announceCoverageChange(document,
      coverageChangeAnnouncement({ previous: coverageState, next: nextState }),
      { moveFocus: false });
    // The same movement, kept on the page. A live region is spoken once; a
    // reader who added a file and looked away is owed the figures that moved.
    applyChangeSummary(document,
      coverageChangeSummary({ previous: coverageState, next: nextState }));
    coverageState = nextState;
    if (classification.confidence !== CONFIDENCE.SUPPRESSED) {
      applySuppressedSavings(document, null);
      return classification;
    }
    applySuppressedSavings(document, suppressedSavingsFallback({
      inputState,
      share: measured,
      lineItems: items,
      totalCost: share?.totalCost ?? null,
      concentration: largestConcentrationLine(items),
    }), {
      formatMoney: moneyText,
      // The fallback's own "what would raise confidence" sentence is the per
      // missing-input messaging this issue collapses. The ranked upgrade action
      // above says the same thing once, with the file named and the coverage it
      // would buy, so the second copy is withheld rather than repeated.
      includeRaiseSentence: false,
    });
    return classification;
  };
  // What the reader's own result is labelled with, everywhere the example
  // caption used to sit: their file names, the rows that were read, and the
  // shape each delimited file was read as.
  const importProvenance = () => userDatasetProvenance({
    files: imports.map((entry) => entry.fileName),
    rows: imports.reduce((sum, entry) => sum + entry.rows, 0),
    shapes: imports.map((entry) => entry.state?.shapeLabel ?? null),
  });
  // The three panels above the import, once the reader has a sample of their
  // own. Nothing is computed here: the rubric scores, `grade-eligibility.js`
  // decides the tier and the one action, and the model below only assembles
  // what they returned. A sample graded against the bundled example totals
  // would be a claim about the wrong organization, so the example path skips it.
  //
  // Whether the page is looking at the bundled sample or at the reader's own
  // corpus is one question with one answer, and `prompt-grading-eligibility.js`
  // owns it. This surface reads `hasOwnImport` rather than counting files, so
  // the comparison exists once; the same verdict carries the state, the named
  // gaps, and the one next action for the headline that reads it next.
  // The reader's own prompt samples, parsed once and paired with the classifier
  // output every consumer below needs. The bundled example is never one of
  // these: an example dataset graded as the reader's own would be the exact
  // mislabelling the per-panel provenance exists to end.
  const classifiedSamples = () => (exampleActive ? [] : samples.map((entry) => ({
    fileName: entry.fileName,
    parsed: entry.parsed,
    classified: classifyQuerySample(entry.parsed),
  })));
  /**
   * The composite each department's own prompts scored, keyed by org unit.
   * Handed to the eligibility rule so its `own_grade` action can name the team
   * to coach rather than saying it has no way to choose one.
   */
  const departmentScores = (entries) => {
    const byUnit = new Map();
    for (const entry of entries) {
      for (const record of entry.classified.records) {
        if (!record.orgUnitId) continue;
        const bucket = byUnit.get(record.orgUnitId) ?? [];
        bucket.push(record);
        byUnit.set(record.orgUnitId, bucket);
      }
    }
    return Object.fromEntries([...byUnit].map(([unit, records]) =>
      [unit, scorePromptLiteracy(records).composite]));
  };
  const promptGrading = (entries = classifiedSamples()) => promptGradingEligibility(
    promptGradingSignals(entries), { departmentScores: departmentScores(entries) },
  );
  /**
   * The one place four panels learn whose numbers they are showing.
   *
   * Every input below is a count, a file name, or an already-decided verdict:
   * `promptImportFacts` is the boundary where a parsed sample becomes five
   * scalars, so nothing downstream of this call holds prompt text to leak.
   */
  const paintPanelProvenance = ({ status = FINOPS_IMPORT_STATUS.ready } = {}) => {
    const entries = status === FINOPS_IMPORT_STATUS.ready ? classifiedSamples() : [];
    const verdict = promptGrading(entries);
    const provenance = exampleActive ? null : importProvenance();
    return applyFinopsProvenance(document, finopsProvenanceModel({
      status,
      promptGrading: verdict,
      promptFacts: promptImportFacts(entries,
        [...REQUIRED_QUERY_SAMPLE_FIELDS, ...CLASSIFICATION_FIELDS]),
      usage: provenance && result
        ? { fileName: provenance.files.join(", "), rows: provenance.rows } : null,
      coaching: verdict.nextAction?.kind === "coach_department" && verdict.nextAction.department
        ? { department: verdict.nextAction.department, score: verdict.nextAction.score } : null,
    }), { onReturnToSample: () => reset() });
  };
  const gradedModel = () => {
    if (!promptGrading().hasOwnImport) return null;
    const classified = samples.map((entry) => classifyQuerySample(entry.parsed));
    const records = classified.flatMap((entry) => entry.records);
    const scored = scorePromptLiteracy(records);
    return gradedSampleFigures({
      scored,
      eligibility: querySampleEligibility({
        orgUnitIds: records.map((record) => record.orgUnitId),
        departments: result?.rankedDepartments ?? [],
        totalUsd: result?.spendUsd ?? null,
      }),
      recordCounts: {
        total: records.length + classified.reduce((sum, entry) => sum + entry.unclassified.length, 0),
        unclassified: classified.reduce((sum, entry) => sum + entry.unclassified.length, 0),
      },
      files: samples.map((entry) => entry.fileName),
      spendUsd: result?.spendUsd ?? null,
      recoverableUsd: result?.recoverableUsd ?? null,
      period: result?.period ?? null,
      cohort: result?.benchmark ?? null,
    });
  };
  const paintGradedSample = () => {
    const model = gradedModel();
    if (!model) return null;
    // The same rule the bundled surfaces have always followed: a local import
    // hides the example analysis. The graded view then re-opens exactly the two
    // panels it has the reader's own figures for, and no others.
    setSampleVisibility(false);
    return applyGradedSample(document, model);
  };
  const renderResult = (next, { example = false, inputs = loaded } = {}) => {
    result = next;
    exampleActive = example;
    resultsNode.setAttribute("aria-busy", "false");
    applyDatasetProvenance(document, example, example ? null : importProvenance());
    if (remap) remap.hidden = example || !imports.some((entry) => entry.source === "delimited");
    setMode(example ? "example-dataset" : "local", example ? "Example data" : "Local import");
    setText("finops-intro", example
      ? `${EXAMPLE_DATASET_PROVENANCE.detail} It walks the same translator and analysis an `
        + `imported file walks, so the finding below is computed, not written. `
        + EXAMPLE_DATASET_PROVENANCE.swap
      : "This decision brief uses only the provider and HRIS exports selected in this tab. "
      + "It makes a bounded routing estimate and refuses unsupported benchmark or prompt-quality claims.");
    setText("finops-provenance", `${next.period} · ${next.provenance}`);
    const resultPlausible = plausibleUsd(next.spendUsd) && plausibleUsd(next.recoverableUsd)
      && next.recoverableUsd <= next.spendUsd;
    const notice = document.getElementById("local-result-notice");
    if (notice) {
      notice.hidden = resultPlausible && next.rankedDepartments.length > 0;
      notice.dataset.state = resultPlausible ? "empty" : "error";
      // The notice now sits with the number it qualifies and is reachable via
      // the finding's aria-describedby, so leaving it live would read the same
      // outcome twice on one commit. The polite import status owns the
      // announcement; this element owns the visible sentence.
      notice.setAttribute("aria-live", "off");
    }
    setText("local-result-notice-title", resultPlausible
      ? "No department finding available." : "Imported totals need review.");
    setText("local-result-notice-copy", resultPlausible
      ? "No provider aggregate joined an active HRIS unit. Resolve the mapping gaps before choosing an action."
      : "A total is outside the supported 0–1 trillion USD display range, or recoverable spend exceeds observed spend. Values are withheld; inspect the source export.");
    setText("local-recoverable", resultPlausible ? moneyText(next.recoverableUsd) : "Needs review");
    // The number and the sentence that says what kind of number it is are
    // written together; neither can ship without the other.
    const basis = showMetricBasis(example ? { mode: "example-dataset" } : {
      mode: "local", plausible: resultPlausible,
      departments: next.rankedDepartments.length,
      joinedRecords: next.quality.joinedRecords,
    });
    // Whether the number is trustworthy is answered before the finding built on
    // it. The verdict reads the parsed rows and roster the import already holds,
    // plus the export ids reconciliation quarantined; it keeps no state of its
    // own and does not re-parse anything.
    const verdict = trustVerdict({
      providers: inputs.providers ?? [],
      hris: inputs.hris ?? null,
      quarantinedExportIds: next.validation?.quarantinedExportIds ?? [],
    });
    applyTrustVerdict(document, verdict);
    // How much of this spend is attributed decides what the recoverable figure
    // above may claim. The verdict has already summed both sides of that ratio;
    // summing them again here is how two numbers on one screen start
    // disagreeing, so the share is assembled from its totals.
    const attribution = applyAttributionPolicy(attributionShareFromTotals({
      attributedCost: (verdict.headline?.attributedMinor ?? 0) / 100,
      totalCost: (verdict.headline?.totalMinor ?? 0) / 100,
    }));
    // Below the floor the figure itself is withheld. A dollar amount with a
    // caveat under it is the same unsupported claim with an asterisk on it.
    if (attribution?.confidence === CONFIDENCE.SUPPRESSED) {
      setText("local-recoverable", "Not shown · attribution below floor");
      const figure = document.getElementById("local-recoverable");
      if (figure) figure.dataset.real = "false";
    }
    // The landing surface. It is drawn from the same envelope for example data
    // and for a real import; there is no example-only branch below this line.
    // The attribution decision made three lines up is handed to the contract
    // rather than re-derived by it: a figure this page withheld must not
    // reappear in the briefing built from the same analysis.
    currentBriefing = buildFinopsBriefing(next, {
      attributionWithheld: attribution?.confidence === CONFIDENCE.SUPPRESSED,
    });
    applyBriefing(document, currentBriefing);
    // A restored briefing on screen gains — or loses — its delta line the
    // moment the live analysis changes underneath it. Repainting here is what
    // stops a delta from outliving the analysis it was computed against.
    syncRestored();
    setText("local-department", next.topDepartment?.name ?? "Unavailable");
    // A withheld figure cannot carry the analysis's own confidence word beside
    // it: the attribution policy has already decided the number is not shown, so
    // the label says withheld rather than contradicting the slot next to it.
    setText("local-confidence-label", attribution?.confidence === CONFIDENCE.SUPPRESSED
      ? "Withheld confidence"
      : `${resultPlausible ? next.confidence : "Withheld"} confidence`);
    setText("local-action", resultPlausible ? next.action : "Review imported totals before selecting a department action.");
    setText("local-provenance",
      next.provenance);
    const trend = next.history;
    const trendState = document.getElementById("local-trend-state");
    if (trendState) trendState.dataset.state = trend.state;
    setText("local-trend-shape", trend.organizationTrendAvailable
      ? trend.organizationSpendChangePercent > 0 ? "↑" : trend.organizationSpendChangePercent < 0 ? "↓" : "→"
      : "—");
    setText("local-trend-answer", trend.organizationTrendAvailable
      ? `${trend.organizationSpendChangePercent > 0 ? "+" : ""}${trend.organizationSpendChangePercent}% organization spend`
      : trend.state === "incompatible" ? "Incompatible periods"
        : trend.state === "missing" ? "Missing history" : "Trend unavailable");
    setText("local-trend-why", trend.organizationTrendAvailable
      ? `${trend.currentPeriod} versus ${trend.previousPeriod}. ${trend.message}`
      : trend.state === "available"
        ? "The preceding organization period has no positive spend, so percentage change is undefined."
        : trend.message);
    setText("local-benchmark-answer", "Unavailable benchmark");
    setText("local-benchmark-summary", "Unavailable · no compatible cohort");
    setText("local-benchmark-why", next.benchmark.message);
    fillTextList("local-periods", trend.periods.map((period) =>
      `${period.period} · ${period.spendUsd.toFixed(2)} USD observed · `
      + `${period.recoverableUsd.toFixed(2)} USD scenario · ${period.completeness} export · ${period.exportId}`),
    "No provider periods available.");
    renderDepartments(next);
    setText("local-warning-count", `(${next.warnings.length})`);
    fillTextList("local-assumptions", next.assumptions, "No mapping assumptions.");
    fillTextList("local-warnings", next.warnings, "No declared data-quality warnings.");
    fillTextList("local-limits", next.limits, "No declared limits.");
    fillTextList("local-evidence", next.evidence, "No recommendation evidence.");
    setSampleVisibility(false);
    resultsNode.hidden = false;
    clear.hidden = false;
    clear.textContent = example ? "Clear example data" : "Return to example data";
    applyFieldDiagnostic(document, null);
    announce("ready", example
      ? `Example finding ready · ${basis.label}.`
      : `Local analysis ready · ${basis.label}.`,
      `${basis.detail} ${example
        ? "Select your own exports, or clear the example data, at any time."
        : "Example analysis replaced until refresh or “Return to example data.”"}`);
    // Focus lands on the new stage's heading, not on the section wrapper, so a
    // screen reader reads the brief's title rather than a nameless region. A
    // re-import redraws the same stage, and the reader is still owed the move.
    syncStage({ hasResult: true });
    focusStageHeading(document, "read");
    void paintModelOverspend(example);
    paintGradedSample();
    // Last, so the four panels are labelled from the result that is actually on
    // screen. Focus is not taken here: `focusStageHeading` above already moved
    // it to the brief's own heading, and two moves for one import is one too
    // many.
    paintPanelProvenance();
  };
  // Fetched once and reused, like the evaluation fixtures above it. A fixture
  // that cannot be read leaves the panel hidden rather than half-painted: this
  // finding's whole point is that a withheld number is a sentence, and an empty
  // panel is not one.
  let overspendFinding = null;
  const paintModelOverspend = async (example) => {
    const section = document.getElementById("model-overspend");
    if (!example) {
      // A leader's own import cannot feed this contract yet. Hiding the panel
      // keeps their labels — those are cleared only by the reset control.
      if (section) section.hidden = true;
      return null;
    }
    try {
      if (!overspendFinding) {
        const response = await fetch(MODEL_OVERSPEND_URL, {
          cache: "no-store", headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Overspend fixture returned ${response.status}`);
        overspendFinding = (await response.json()).finding;
      }
      return renderModelOverspendFinding(document, overspendFinding, { storage: labelStorage() });
    } catch {
      if (section) section.hidden = true;
      return null;
    }
  };
  const reset = () => {
    const wasExample = exampleActive;
    // A run still in flight is stopped before anything else is dropped, so its
    // result cannot land on a surface that has already been cleared.
    offloader.cancel();
    applyImportProgress(document, null);
    loaded.providers.length = 0;
    delete loaded.hris;
    // Abandoning is total: the queued files, the retained delimited text, and
    // the mapping choices go with the result. Nothing was written down, so a
    // fresh import afterwards starts from the file picker with no residue.
    imports.length = 0;
    queue = [];
    review = null;
    samples.length = 0;
    closeMappingReview(document);
    if (remap) remap.hidden = true;
    result = null;
    currentBriefing = null;
    exampleActive = false;
    coverageUpgrades = null;
    // The restored briefing survives a clear — it is a file the visitor opened,
    // not a product of the analysis — but its delta cannot: there is no longer
    // anything on screen to compare it against.
    syncRestored();
    // The attribution pair and the "what changed" summary go with the result
    // they described. A stale split beside a cleared figure is a claim about a
    // file that is no longer loaded.
    applyAttributionSplit(document, null);
    applyChangeSummary(document, null);
    input.value = "";
    resultsNode.hidden = true;
    clear.hidden = true;
    clear.textContent = "Return to example data";
    setSampleVisibility(true);
    setMode("example", "Example data");
    applyFieldDiagnostic(document, null);
    // Nothing survives the clear: the example result, its provenance labels, and
    // the finding are all discarded together. Nothing was ever written to
    // storage or the URL, so a reload is already a fresh visit.
    applyDatasetProvenance(document, false);
    const trust = document.getElementById("local-trust");
    if (trust) {
      trust.hidden = true;
      trust.dataset.state = "empty";
    }
    const lead = document.getElementById("local-lead-finding");
    if (lead) {
      lead.hidden = true;
      lead.dataset.state = "unavailable";
      for (const id of ["local-lead-question", "local-lead-metric", "local-lead-coverage", "local-lead-action"])
        setText(id, "—");
      setText("local-lead-arithmetic", "");
      const arithmetic = document.getElementById("local-lead-arithmetic");
      if (arithmetic) arithmetic.hidden = true;
    }
    // The one reset. The per-model panel goes with everything else, and so do
    // the org-unit labels this browser was holding — they are the only thing on
    // this page that outlives a reload, so "start over" has to include them.
    clearModelOverspendFinding(document, { storage: labelStorage() });
    // The graded panels hand their slots back with everything else, so the
    // example badge, the example mix and the bundled KPI figures are exactly
    // what a visitor who imports nothing has always seen.
    clearGradedSample(document);
    // All four panels together, from the model with no import in it. A reload
    // produces exactly this, because nothing here was ever written down.
    clearFinopsProvenance(document);
    repaintBundledAnalysis();
    showMetricBasis({ mode: "example" });
    setText("finops-intro",
      "Every prompt is scored for intent, efficiency, and model fit, then attributed to the org chart. "
      + "One number tells you whether the spend is working; the rows below tell you where it is not.");
    announce("ready", wasExample ? "Example data cleared." : "Returned to example data.",
      wasExample
        ? "The example export, its computed finding, and every provenance label were discarded. "
          + "Nothing was stored, so a reload starts fresh."
        : "The selected file references and local result were discarded.");
    // Returning to the first stage is a stage change too: focus goes back to the
    // control that starts it rather than being dropped on the discarded button.
    syncStage({ focus: true });
  };

  // Every input that survived to this point, folded back into the two the
  // analysis takes. Rebuilding rather than mutating in place means a re-mapped
  // file replaces its own earlier reading and nothing accumulates.
  const rebuildLoaded = () => {
    loaded.providers.length = 0;
    delete loaded.hris;
    for (const entry of imports) {
      if (entry.parsed.type === "provider") loaded.providers.push(entry.parsed);
      else loaded.hris = entry.parsed;
    }
  };

  // The diagnostic belongs to the control that produced it: the input goes
  // aria-invalid, the message is described-by it, and the recovery sits beside
  // it. The failing file is named by its position in the selection — never by
  // file name, path, or any value read out of it.
  const failFile = (error, file) => {
    queue = [];
    applyImportProgress(document, null);
    const diagnostic = diagnosticFor({
      code: error?.code, message: error?.message, ordinal: file.ordinal, total: file.total,
    });
    applyFieldDiagnostic(document, diagnostic);
    showTransientBasis("failed");
    // Every panel goes back to the sample together. A surface with the KPI row
    // swapped and the grade stale would be a half-import nobody asked for, and
    // a blank headline would strand the reader on nothing at all.
    paintPanelProvenance({ status: FINOPS_IMPORT_STATUS.failed });
    syncStage();
    announce("error", "This file was not analyzed.",
      `${diagnostic.text} ${diagnostic.recovery} Existing analysis was not replaced.`);
    input.focus?.();
  };

  const closeReview = () => {
    review = null;
    closeMappingReview(document);
  };

  // --- step 2: check the mapping --------------------------------------------
  // The step owns no state of its own. Every correction produces a new mapping
  // state, the surface is repainted from it, and the analysis is only ever run
  // from a binding the model agreed to produce.
  const paintReview = () => renderMappingReview(document, review.state, {
    onTarget: (index, target) => {
      review.state = setColumnTarget(review.state, index, target);
      paintReview();
    },
    onKind: (kind) => {
      review.state = setMappingKind(review.state, kind);
      paintReview();
    },
    onConfirm: () => confirmReview(),
    onCancel: () => reset(),
  });

  const openReview = (file, entry = null) => {
    const reading = readDelimitedText(file.text);
    if (!reading.ok) {
      failFile({ code: reading.problem.code, message: reading.problem.code }, file);
      return false;
    }
    review = {
      file,
      entry,
      // Re-entering keeps the reader's own choices. Resetting to the detected
      // proposal would silently undo the correction they came back to change.
      state: entry?.state ?? createColumnMapping({ reading, fileName: file.fileName }),
    };
    paintReview();
    // Reviewing is the "check the mapping" stage the indicator already names, so
    // the step arrives with the flow's own step 2 marked current.
    syncStage();
    focusMappingReview(document);
    announce("ready", "Check the column mapping.",
      "Every column in the selected file is listed with what it becomes and one value from it. "
      + "Nothing is computed until you confirm.");
    return true;
  };

  const confirmReview = async () => {
    const binding = mappingBinding(review?.state);
    // The confirm control is disabled while a blocker stands; this is the second
    // lock, so a stale click can never reach the parser with a half-mapping.
    if (!binding) return;
    const { file, entry, state } = review;
    let parsed;
    try {
      // The reviewed mapping runs across the offload seam. The thunk below is
      // the shipped synchronous call, unchanged, and it is what runs when the
      // browser has no module worker.
      parsed = await runImport(file, { mapping: binding },
        () => parseLocalImportFile(file.text, file.fileName, file.mediaType, { mapping: binding }));
    } catch (error) {
      applyImportProgress(document, null);
      // A cancel is the reader's own decision, already announced where they made
      // it. It is not a file defect and never paints a diagnostic.
      if (error?.code === CANCELLED_CODE) return;
      closeReview();
      failFile(error, file);
      return;
    }
    applyImportProgress(document, null);
    const stored = entry ?? { source: "delimited", fileName: file.fileName, mediaType: file.mediaType, text: file.text };
    stored.state = state;
    stored.parsed = parsed;
    stored.rows = state.dataRowCount;
    if (!entry) imports.push(stored);
    closeReview();
    await processQueue();
  };

  const finishSelection = (total) => {
    rebuildLoaded();
    // The one gate, and it is the policy's. `analysisEligibility` reads the same
    // three input states that classify every finding, so a provider export on
    // its own is a complete run and only genuinely ineligible input — no file,
    // or nothing the parser recognized as an export — is refused. The refusal
    // sentence travels on the verdict; nothing here writes one.
    const eligibility = analysisEligibility({
      hasProviderExport: loaded.providers.length > 0,
      hasGroupingColumn: hasGroupingColumn(),
      hasOrgMapping: Boolean(loaded.hris),
    });
    if (!eligibility.eligible) {
      showTransientBasis("partial");
      syncStage({ focus: true });
      // A provider export whose rows carry no grouping value at all is the
      // PROVIDER_ONLY state: it can still answer where the money is concentrated,
      // and it must say so rather than leaving the reader at a dead end. The
      // share is measured over the reader's own line items, and the policy
      // decides whether anything is shown in place of the savings figure.
      applyAttributionPolicy(attributedSpendShare(providerLineItems()));
      // A query sample with no billing beside it has no spend denominator, so
      // eligibility withholds the grade and says why. That is a state worth
      // showing, and it is the one the reader is now in.
      const graded = paintGradedSample();
      announce("ready", `${total} compatible file${total === 1 ? "" : "s"} ready.`,
        graded?.message
          ? `${graded.message.label}. ${graded.nextAction.text}`
          : `${eligibility.reason} Example analysis remains visible.`);
      return;
    }
    renderResult(normalizeLocalFinopsHistory({
      providers: loaded.providers,
      hris: loaded.hris ?? null,
    }));
  };

  const processQueue = async () => {
    let total = imports.length + queue.length;
    while (queue.length) {
      const file = queue.shift();
      total = file.total;
      // What a file *is* comes from its bytes, not its name. The query-sample
      // validator is the only thing that accepts a query sample, so asking it
      // first is the whole of the routing: a provider export or roster carries
      // none of the required fields and is refused here, then read below
      // exactly as before. Nothing about the provider path changes.
      const sample = parseQuerySample(file.text);
      if (sample.ok) {
        samples.push({ fileName: file.fileName, parsed: sample });
        continue;
      }
      // A delimited file is never analyzed on sight: it goes through the review
      // step, and the rest of the selection waits behind it.
      if (isDelimitedFileName(file.fileName)) {
        // Whether the reader is now reviewing it or it failed to read at all,
        // this selection stops here: the step, or the diagnostic, owns the flow.
        openReview(file);
        return;
      }
      try {
        const parsed = await runImport(file, undefined,
          () => parseLocalImportFile(file.text, file.fileName, file.mediaType));
        imports.push({
          source: "json", fileName: file.fileName, parsed, state: null,
          rows: parsed.document?.records?.length ?? 0,
        });
      } catch (error) {
        applyImportProgress(document, null);
        if (error?.code === CANCELLED_CODE) return;
        failFile(error, file);
        return;
      }
    }
    applyImportProgress(document, null);
    finishSelection(total || imports.length);
  };

  input.addEventListener("change", async () => {
    const files = [...input.files];
    if (!files.length) return;
    stateNode.setAttribute("aria-busy", "true");
    resultsNode.setAttribute("aria-busy", "true");
    applyFieldDiagnostic(document, null);
    announce("loading", "Reading files in this tab…",
      "Parsing and validation are running locally; no file contents are being transferred.");
    // While a file is being read the panels stay exactly what they were and say
    // so in a reserved line. Relabelling them now would caption figures that
    // have not changed with a source that does not yet exist.
    paintPanelProvenance({ status: FINOPS_IMPORT_STATUS.pending });
    try {
      // The size ceiling is checked from `File.size`, before a byte is decoded
      // and before a worker exists. An oversized file costs one comparison and
      // yields one message; nothing partial is ever built from it.
      const chosen = files.map((file, index) => ({
        file, fileName: file.name, mediaType: file.type, byteSize: file.size,
        ordinal: index + 1, total: files.length,
      }));
      const oversize = chosen.map((entry) => ({ entry, error: checkImportCeiling(entry.byteSize) }))
        .find((checked) => checked.error);
      if (oversize) {
        failFile(oversize.error, oversize.entry);
        return;
      }
      // `file.text()` is the local Blob text API. Nothing here transfers,
      // stores, or persists the bytes; the text lives in this closure for as
      // long as the tab does and no longer.
      queue = await Promise.all(chosen.map(async ({ file, ...entry }) => ({
        ...entry, text: await file.text(),
      })));
      await processQueue();
    } finally {
      stateNode.setAttribute("aria-busy", "false");
      resultsNode.setAttribute("aria-busy", "false");
      input.value = "";
    }
  });
  // Back into the step from a rendered result, with the file already in hand and
  // the reader's own choices intact — no second trip through the file picker.
  remap?.addEventListener("click", () => {
    const entry = [...imports].reverse().find((candidate) => candidate.source === "delimited");
    if (!entry) return;
    applyFieldDiagnostic(document, null);
    openReview({
      fileName: entry.fileName, mediaType: entry.mediaType, text: entry.text,
      ordinal: 1, total: 1,
    }, entry);
  });
  clear?.addEventListener("click", reset);
  // One click, one computed finding. Translating the bundled export and running
  // the analysis is the same synchronous pair of calls the file input makes, so
  // there is no intermediate state to show and nothing to confirm.
  document.getElementById("try-example-dataset")?.addEventListener("click", () => {
    try {
      const inputs = loadExampleDatasetInputs();
      renderResult(normalizeLocalFinopsHistory(inputs), { example: true, inputs });
    } catch (error) {
      // Unreachable while the bundled export matches the contract. If the
      // contract moves under it, say so rather than showing a stale surface.
      const diagnostic = diagnosticFor({ code: error?.code, message: error?.message });
      applyFieldDiagnostic(document, diagnostic);
      announce("error", "The example data could not be analyzed.",
        `${diagnostic.text} No analysis is shown.`);
    }
  });
  // Both recoveries live at the control. "Choose files again" reopens the same
  // picker; "Discard this selection" drops what was accepted so a half-loaded
  // pair cannot silently outlive the error that interrupted it.
  // Sharpening a result from the result itself. It opens the same picker the
  // panel above uses; the selection already in hand is untouched, so the
  // provider export is never re-requested and the brief below stays mounted
  // while the added file is read.
  document.getElementById("add-optional-file")?.addEventListener("click", () => {
    applyFieldDiagnostic(document, null);
    input.focus?.();
    input.click?.();
  });
  document.getElementById("local-file-repick")?.addEventListener("click", () => {
    applyFieldDiagnostic(document, null);
    input.focus?.();
    input.click?.();
  });
  // Cancel stops the work rather than hiding it: the worker is terminated, the
  // partial text dies with the thread, and the queue behind it is dropped. The
  // picker is cleared so the very same file can be chosen again immediately —
  // a file input does not fire `change` for an unchanged value.
  document.getElementById("local-import-cancel")?.addEventListener("click", () => {
    const stopped = offloader.cancel();
    queue = [];
    applyImportProgress(document, null);
    closeReview();
    applyFieldDiagnostic(document, null);
    input.value = "";
    syncStage();
    announce("ready", stopped ? "Import cancelled." : "Nothing was running.",
      "No rows were kept and no total was produced. Choose the same file again, or a different one.");
    input.focus?.();
  });
  document.getElementById("local-file-discard")?.addEventListener("click", reset);
  // The query-sample template, generated from the same module the contract's
  // tests validate and handed to the same local blob download every other
  // artifact on this page uses. Nothing is uploaded, and nothing is imported:
  // this contract has no consumer here yet, so the file leaves the tab and the
  // reader's gateway owner fills it in.
  document.getElementById("download-query-sample-example")?.addEventListener("click", () => {
    downloadLocalExport(exampleQuerySampleText(),
      EXAMPLE_QUERY_SAMPLE_FILE.mediaType, EXAMPLE_QUERY_SAMPLE_FILE.fileName);
  });
  // The conversation-export examples, one per dialect the profile registry
  // declares. The chooser is painted from that registry rather than authored in
  // the markup, so a dialect can never ship without an example behind it, and
  // the file is generated by the same module the contract's tests parse.
  const conversationExampleChooser = document.getElementById("conversation-example-dialect");
  if (conversationExampleChooser) {
    conversationExampleChooser.replaceChildren(
      ...CONVERSATION_EXAMPLE_FILES.map((entry) => new Option(entry.label, entry.dialectId)));
  }
  document.getElementById("download-conversation-example")?.addEventListener("click", () => {
    const chosen = CONVERSATION_EXAMPLE_FILES
      .find((entry) => entry.dialectId === conversationExampleChooser?.value)
      ?? CONVERSATION_EXAMPLE_FILES[0];
    downloadLocalExport(conversationExampleText(chosen.dialectId), chosen.mediaType, chosen.fileName);
  });
  // The briefing file, not the raw envelope it used to be. `briefingFile` is
  // pure — it has no clock — so the one ambient value the file records is passed
  // in from here, and everything else in the artifact is a function of the
  // analysis alone. Two clicks on one result therefore differ in exactly one
  // field, and two page loads of the same import produce the same bytes.
  document.getElementById("export-local-json")?.addEventListener("click", () => {
    if (!result) return;
    const file = briefingFile(result, {
      dataset: exampleActive ? "example" : "user",
      exportedAt: new Date().toISOString(),
    });
    downloadLocalExport(file.text, file.mediaType, file.fileName);
  });
  document.getElementById("export-local-summary")?.addEventListener("click", () => {
    if (result) downloadLocalExport(
      localFinopsMeetingSummary(result, { exampleDataset: exampleActive }),
      "text/plain",
      exampleActive ? "example-finops-meeting-summary.txt" : "local-finops-meeting-summary.txt");
  });
  // The reopen side of that same JSON file. It reads the selected file in this
  // tab through the File API — no fetch, no XHR — parses it with the reader in
  // finops-briefing-restore.js, and either paints a read-only region below the
  // imported result or says in one calm sentence why it did not. Nothing is
  // written to storage or the URL on either path, and the region is cleared
  // before every attempt so a rejection can never leave half a briefing behind.
  const reopenInput = document.getElementById("reopen-briefing-file");
  reopenInput?.addEventListener("change", async () => {
    const file = reopenInput.files?.[0];
    restored = null;
    applyRestoreRejection(document, null);
    syncRestored();
    if (!file) return;
    // Size is checked against the ceiling before the bytes are read, so an
    // oversized file is refused rather than pulled into memory to be refused.
    let outcome = parseSavedBriefing(null, { byteSize: file.size });
    if (outcome.code !== "file_too_large") {
      let text = null;
      try {
        text = await file.text();
      } catch {
        text = null;
      }
      outcome = parseSavedBriefing(text, { byteSize: file.size });
    }
    // The picker is cleared either way, so choosing the same file twice is a
    // second attempt rather than a silent no-op.
    reopenInput.value = "";
    if (!outcome.ok) {
      applyRestoreRejection(document, outcome);
      announce("error", "That briefing was not opened.", outcome.message);
      // Same move the Shiplog importer makes: focus lands on the sentence that
      // says what to do next, not past it.
      document.getElementById("restored-briefing-error")?.focus?.({ preventScroll: true });
      return;
    }
    restored = outcome.saved;
    syncRestored();
    announce("ready", "Saved briefing reopened.",
      `It is shown read-only below the imported result and observes ${outcome.saved.period.label}. `
      + "It was read in this tab, nothing was uploaded, and nothing on this page was replaced.");
    document.getElementById("restored-briefing-title")?.focus?.({ preventScroll: true });
  });
  document.getElementById("restored-briefing-close")?.addEventListener("click", () => {
    restored = null;
    applyRestoreRejection(document, null);
    syncRestored();
    announce("ready", "Restored briefing closed.",
      "The reopened file was discarded. Nothing about the imported result changed.");
    reopenInput?.focus?.({ preventScroll: true });
  });

  // Cold load: draw the first stage and the unresolved requirements before any
  // interaction, so the idle surface is a state rather than a blank.
  applyFieldDiagnostic(document, null);
  applyDatasetProvenance(document, false);
  // The enforced ceilings, painted from the one place they are defined.
  applyImportLimits(document);
  // What one provider export will answer, said before a byte is selected.
  applyPreUploadDisclosure(document);
  applySuppressedSavings(document, null);
  applyAttributionSplit(document, null);
  applyChangeSummary(document, null);
  applyImportProgress(document, null);
  // The four panels start where the authored markup already has them, painted
  // from the model rather than trusted to it — and the return control is bound
  // on this pass, so it exists the moment a panel becomes the reader's.
  paintPanelProvenance();
  showMetricBasis({ mode: "example" });
  syncStage();
}

// The portfolio's DOM lives in finance-portfolio-view.js so its untrusted-text
// handling can be exercised directly by a test; this layer only locates the
// nodes and decides what to show when the data itself will not load.
function renderFinancePortfolio(data) {
  const list = document.getElementById("portfolio-list");
  if (!list) return;
  try {
    mountFinancePortfolio(createFinancePortfolio(data), {
      department: document.getElementById("portfolio-department"),
      state: document.getElementById("portfolio-state"),
      list,
      projected: document.getElementById("portfolio-projected"),
      completed: document.getElementById("portfolio-completed"),
      verified: document.getElementById("portfolio-verified"),
      count: document.getElementById("portfolio-count"),
    });
    list.setAttribute("aria-busy", "false");
  } catch (error) {
    // Lifecycle rows are validated one at a time, so reaching here means the
    // action plan itself is unreadable. Say so in the panel instead of leaving
    // the loading copy in place, and keep the reason in the console for review.
    console.error("finance_portfolio_unavailable", { error: error?.message ?? String(error) });
    setText("portfolio-count", "0 actions shown");
    list.setAttribute("aria-busy", "false");
    list.replaceChildren(renderPortfolioUnavailable(
      "The bundled action lifecycle could not be read, so no savings figure is shown."));
  }
}

function renderHeadline(organization, totals, eligibility) {
  const trust = headlineTrust(totals, organization);
  // Two independent gates on one letter, and both must pass. `headlineTrust`
  // asks whether the number is inside the supported range; eligibility asks
  // whether enough of the money was scored for the number to mean anything.
  const gradeVisible = trust.score.plausible && eligibility.showGrade;
  const providers = Array.isArray(organization?.providers) ? organization.providers.join(", ") : "";
  setText("finops-provenance",
    `${organization?.name ?? "Organization"} · ${organization?.period ?? "current period"} · `
    + `${organization?.hrisSource ?? "HRIS"} · ${providers}`);

  const card = document.getElementById("score-card");
  if (card) {
    card.dataset.band = gradeVisible ? band(totals.score) : "review";
    card.dataset.metricState = gradeVisible ? "available" : "needs-review";
    card.dataset.coverageTier = eligibility.tier;
    card.dataset.gradeState = eligibility.state;
  }
  setText("score-grade", gradeVisible ? totals.grade : "!");
  setText("score-value", gradeVisible
    ? `${totals.score} / 100 · grade ${totals.grade}`
    : trust.score.plausible ? eligibility.label : "Needs review · score unavailable");
  // Coverage and the one action are the only words this card gains, and both
  // come from the eligibility model; nothing here writes a sentence of its own.
  setText("score-coverage", eligibility.coverage === null
    ? eligibility.label
    : `${formatPercent(eligibility.coverage, { digits: 1 })} of spend scored · ${eligibility.label}`);
  setText("score-action", eligibility.nextAction.text);
  const action = document.getElementById("score-action");
  if (action) action.dataset.available = String(eligibility.nextAction.available);
  setText("score-peer", trust.score.plausible
    ? `${totals.scoreExplanation.version} · ${totals.scoreExplanation.rule} ${totals.scoreExplanation.arithmetic}`
    : "The calculated score fell outside the supported 0–100 range and is not presented as reliable.");

  setText("kpi-spend-value", trust.spend.plausible ? formatUsd(totals.spendUsd) : "Needs review");
  setText("kpi-spend-note",
    trust.queries.plausible && trust.departments.plausible && trust.headcount.plausible
      ? `${formatCount(totals.queries)} scored queries · ${totals.departments} departments · ${formatCount(totals.headcount)} people`
      : "Supporting counts are unavailable pending data review");
  setText("kpi-recoverable-value", trust.recoverable.plausible
    ? formatUsd(totals.recoverableUsd) : "Needs review");
  setText("kpi-recoverable-note",
    trust.recoverable.plausible && Number.isFinite(totals.recoverableShare)
      && totals.recoverableShare >= 0 && totals.recoverableShare <= 1
      ? `${formatPercent(totals.recoverableShare)} of spend — down-routing, training, and leakage`
      : "Unavailable · recoverable spend must not exceed total spend");
  setText("kpi-productive-value", trust.highValue.plausible
    ? formatPercent(totals.mix.highValue) : "Needs review");
  setText("kpi-productive-note",
    trust.spend.plausible && trust.highValue.plausible
      ? `${formatUsd(Math.round(totals.spendUsd * totals.mix.highValue))} of scored spend was high-value`
      : "Unavailable until spend and share pass review");
  setText("kpi-peer-value", trust.percentile.plausible ? `${organization.peerPercentile}th` : "Unavailable");
  setText("kpi-peer-note", trust.percentile.plausible
    ? `${quartileLabel(organization.peerPercentile)} · ${organization?.peerCohort ?? "peer cohort"}`
    : "Needs review · percentile must be between 0 and 100");
}

function renderMix(totals) {
  const bar = document.getElementById("mix-bar");
  const legend = document.getElementById("mix-legend");
  if (!bar || !legend) return;
  bar.replaceChildren();
  legend.replaceChildren();

  const summary = [];
  for (const category of QUERY_CATEGORIES) {
    const share = totals.mix[category.key] ?? 0;
    const spend = Math.round(totals.spendUsd * share);
    const color = `var(${CATEGORY_VARS[category.key]})`;

    const segment = element("div", "mix-segment");
    segment.style.flexGrow = String(Math.max(share, 0.004));
    segment.style.background = color;
    // Native tooltip: the same numbers are already visible in the legend, so the
    // hover layer is an accelerator rather than the only way to read a segment.
    segment.title = `${category.label} · ${formatPercent(share)} · ${formatUsd(spend)}`;
    bar.append(segment);
    summary.push(`${category.label} ${formatPercent(share)}`);

    const item = element("li");
    item.style.color = color;
    const head = element("div", "legend-head");
    const label = element("span", "legend-label");
    const swatch = element("span", "legend-swatch");
    swatch.style.background = color;
    label.append(swatch, element("span", undefined, category.label));
    head.append(label, element("span", "legend-share", formatPercent(share)));
    item.append(head,
      element("p", "legend-spend", `${formatUsd(spend)} of spend`),
      element("p", "legend-copy", category.description),
      element("p", "legend-action", category.systemAction));
    legend.append(item);
  }
  setText("mix-summary", `Spend mix: ${summary.join(", ")}.`);
}

function gradeChip(score) {
  const chip = element("span", "grade-chip");
  chip.dataset.band = band(score);
  chip.append(document.createTextNode(letterGrade(score)), element("span", undefined, String(score)));
  return chip;
}

function signed(value, suffix = "") {
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function definitionTerm(label, value) {
  const fragment = document.createDocumentFragment();
  fragment.append(element("dt", undefined, label), element("dd", undefined, value));
  return fragment;
}

function renderUnavailableAction(reason) {
  const actionSurface = document.getElementById("action-result");
  if (actionSurface) {
    actionSurface.dataset.status = "unavailable";
    actionSurface.setAttribute("aria-busy", "false");
  }
  setText("action-status", "Result unavailable");
  setText("action-title", "No prioritized intervention available");
  setText("action-rationale", reason);
  setText("action-impact", "Unavailable");
  setText("action-confidence", "Unavailable");
  setText("action-owner", "Unassigned");
  setText("action-provenance", "Bundled static fixture · no live fallback");
  setText("action-baseline", "Unavailable");
  setText("action-target", "Unavailable");
  setText("action-estimate", "Unavailable");
  setText("action-realized", "Not available");
  setText("action-diagnosis", reason);
}

function renderDecisionDetail(department, data) {
  const performance = departmentPerformance(department);
  const trend = departmentTrend(department);
  const comparison = benchmarkComparison(department, data.benchmark ?? {});
  const sampling = department.sampling ?? {};
  const provenance = data.provenance ?? {};
  const action = actionPlanFor(department);

  setText("detail-name", department.name ?? "Unnamed department");
  setText("detail-score", performance.available ? `${performance.score}/100` : "Unavailable");
  setText("detail-sample", performance.available
    ? `${performance.rubricVersion} · ${sampling.sampledQueries} sampled queries · through ${sampling.sampledThrough} (${sampling.freshnessLabel}) · 95% sampling uncertainty ±${performance.uncertaintyPoints} points · ${provenance.label}`
    : `${performance.rubricVersion} · Sampling unavailable: ${performance.reason} · ${provenance.label}`);

  const actionSurface = document.getElementById("action-result");
  if (actionSurface) {
    actionSurface.dataset.status = action.status;
    actionSurface.setAttribute("aria-busy", "false");
  }
  setText("action-status", action.statusLabel);
  if (!action.available) {
    renderUnavailableAction(performance.available
      ? "A score is available, but this fixture does not contain a reviewed intervention."
      : `No action conclusion: ${performance.reason}`);
  } else {
    setText("action-title", action.title);
    setText("action-rationale", action.rationale);
    setText("action-impact", action.impact);
    setText("action-confidence", action.confidence);
    setText("action-owner", action.accountableRole);
    setText("action-provenance", action.provenance);
    setText("action-baseline", formatUsd(action.baselineUsd));
    setText("action-target", formatUsd(action.targetUsd));
    setText("action-estimate", formatUsd(action.estimatedSavingsUsd));
    setText("action-realized", action.realizedSavingsUsd === null
      ? "Not yet simulated" : formatUsd(action.realizedSavingsUsd));
    setText("action-diagnosis", action.diagnosis);
  }

  setText("trend-answer", trend.worsening === true
    ? "Yes. Cost rose while performance fell."
    : trend.worsening === false ? "No. Cost and performance are not jointly worsening."
      : "Unavailable. The equal-period comparison is incomplete.");
  const trendList = document.getElementById("trend-comparison");
  trendList?.replaceChildren(
    definitionTerm("Cost", trend.costAvailable ? signed(trend.costChangePercent, "%") : "Unavailable"),
    definitionTerm("Performance", trend.performanceAvailable
      ? signed(trend.performanceChangePoints, " points") : "Unavailable"),
    definitionTerm("Periods", trend.period && trend.comparisonPeriod
      ? `${trend.period} vs ${trend.comparisonPeriod} · ${trend.equalLengthDays}-day periods`
      : "Equal-period dates unavailable"),
  );

  setText("benchmark-answer", comparison.available
    ? `${signed(comparison.deltaPoints, " points")} versus the cohort median of ${data.benchmark.medianScore}.`
    : `Unavailable. ${comparison.reason}`);
  const benchmark = data.benchmark ?? {};
  setText("benchmark-method",
    `${benchmark.name ?? "Benchmark unavailable"} · ${benchmark.organizationCount ?? "–"} synthetic organizations · `
    + `${benchmark.segment ?? "segment unavailable"} · snapshot ${benchmark.snapshotDate ?? "unavailable"} · `
    + `${benchmark.rubricVersion ?? "rubric unavailable"} · ${benchmark.provenance ?? provenance.label ?? "provenance unavailable"}`);

  const list = document.getElementById("department-evidence");
  list?.replaceChildren();
  if (!performance.available) {
    list?.append(element("li", "evidence-empty",
      `No evidence conclusion: ${performance.reason}`));
    return;
  }
  const evidence = evidenceForDepartment(data.evidence, department.id);
  if (!evidence.length) {
    list?.append(element("li", "evidence-empty",
      "No scored evidence was retained for this department in the bundled sample."));
    return;
  }
  for (const record of evidence) {
    const item = element("li", "evidence-item");
    item.append(
      element("p", "evidence-label", `${record.category} · ${record.sampleId}`),
      element("p", "evidence-summary", record.summary),
      element("p", "evidence-meta",
        `${performance.rubricVersion} · scored ${record.scoredAt} · ${sampling.freshnessLabel} · synthetic redacted fixture`),
    );
    list?.append(item);
  }
}

function renderDecisionSurface(data, departments) {
  const provenance = data.provenance ?? {};
  setText("decision-provenance",
    `${provenance.label ?? "Synthetic bundled fixture"} · generated ${provenance.generatedAt ?? "date unavailable"} · `
    + `${provenance.billingSource ?? "billing source unavailable"} · ${provenance.orgSource ?? "org source unavailable"}`);
  const list = document.getElementById("department-priority");
  list?.replaceChildren();
  const ranked = rankDepartmentsForHelp(departments);
  if (!ranked.length) {
    list?.append(element("li", "evidence-empty", "No departments are present in this bundled period."));
    setText("detail-name", "No department result");
    setText("detail-score", "Unavailable");
    setText("detail-sample", "The bundled period contains no department records.");
    renderUnavailableAction("No department records are available in this bundled period.");
    return;
  }
  ranked.forEach((department, index) => {
    const performance = departmentPerformance(department);
    const item = element("li");
    const button = element("button", "department-choice");
    button.type = "button";
    button.dataset.departmentId = department.id;
    button.setAttribute("aria-pressed", String(index === 0));
    button.append(
      element("span", "priority-rank", performance.available ? String(index + 1).padStart(2, "0") : "—"),
      element("span", "priority-name", department.name),
      element("span", "priority-score", performance.available
        ? `${performance.score}/100 · ±${performance.uncertaintyPoints}`
        : "Sampling unavailable"),
    );
    button.addEventListener("click", () => {
      list.querySelectorAll("button").forEach((candidate) =>
        candidate.setAttribute("aria-pressed", String(candidate === button)));
      renderDecisionDetail(department, data);
    });
    item.append(button);
    list?.append(item);
  });
  renderDecisionDetail(ranked[0], data);
}

function renderRedaction(samples) {
  const list = document.getElementById("redaction-list");
  if (!list) return;
  list.replaceChildren();

  for (const sample of Array.isArray(samples) ? samples : []) {
    const item = element("li", "redaction-item");
    item.append(element("p", "redaction-label", sample.label ?? "Prompt"));
    const pair = element("div", "redaction-pair");

    const raw = element("div", "redaction-side");
    raw.append(element("h3", undefined, "As submitted"),
      element("p", "redaction-text redaction-raw", sample.raw ?? ""));
    const clean = element("div", "redaction-side");
    clean.append(element("h3", undefined, "As scored"),
      element("p", "redaction-text redaction-clean", redactForScoring(sample.raw ?? "")));

    pair.append(raw, clean);
    item.append(pair);
    list.append(item);
  }
}

async function loadData() {
  const response = await fetch(DATA_URL, { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Demo data returned ${response.status}`);
  return response.json();
}

async function renderEvaluationDemo() {
  const target = document.getElementById("finops-evaluation-result");
  if (!target) return;
  try {
    const response = await fetch(EVALUATION_URL, {
      cache: "no-store", headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Evaluation fixture returned ${response.status}`);
    // Every bundled fixture renders, including the rejected one: the gate is
    // only defensible if a reviewer can read the score it overrode.
    target.replaceChildren(renderFinopsEvaluationPanel(await response.json()));
  } catch {
    target.replaceChildren(renderFinopsEvaluationUnavailable(
      "The bundled evaluation fixtures are unavailable. "
      + "No score was produced, and no live provider or customer record was contacted."));
  }
  target.setAttribute("aria-busy", "false");
}

async function init() {
  if (!document.getElementById("department-priority")) return;
  mountLocalFinopsImport();
  initFinopsContact(document);
  const gateway = createStaticGateway();
  const refreshGateway = document.getElementById("integration-gateway-refresh");
  gateway.subscribe(({ status, inspection, metadata }) => {
    if (refreshGateway) refreshGateway.disabled = status === "pending";
    if (status === "pending") {
      setText("integration-contract-provenance",
        `Gateway pending · ${metadata.sourceType} · sample ${metadata.sampleWindow} · freshness ${metadata.freshness} · failure none`);
      return;
    }
    if (status === "completed") {
      setText("integration-contract-provenance",
        `Gateway completed · ${formatIntegrationProvenance(inspection)} · sample ${metadata.sampleWindow} · freshness ${metadata.freshness} · failure ${metadata.failureState}`);
      return;
    }
    setText("integration-contract-provenance",
      `Gateway unavailable · ${metadata.sourceType} · sample ${metadata.sampleWindow} · freshness ${metadata.freshness} · failure ${metadata.failureState} · no live fallback`);
  });
  refreshGateway?.addEventListener("click", () => gateway.refresh());
  gateway.refresh();
  renderEvaluationDemo();

  const retryData = document.getElementById("finops-data-retry");
  retryData?.addEventListener("click", () => loadAndRender());
  let hasRenderedAnalysis = false;

  async function loadAndRender() {
    setLoadState("loading", "Loading bundled analysis…",
      "Previously rendered content stays visible while the synthetic fixture is refreshed.");
    let data;
    try {
      data = await loadData();
    } catch {
      setLoadState("error", "Bundled analysis unavailable",
        hasRenderedAnalysis
          ? "The refresh failed. The last successful synthetic analysis remains visible; retry when ready."
          : "The synthetic fixture could not be loaded. Local import and inspectable evaluation remain available.");
      if (hasRenderedAnalysis) return;
      setText("finops-provenance", "Demo data unavailable — the executive view will populate once the feed returns.");
      setText("score-value", "Score unavailable");
      // A failed load has no spend denominator, which is the same honest state
      // as an import with none: the coverage line says so rather than sitting
      // on its loading copy under a card that has already given up.
      const noData = gradeEligibility([]);
      setText("score-coverage", noData.label);
      setText("score-action", noData.nextAction.text);
      setText("score-peer", "No metric is inferred from a failed load.");
      for (const id of ["kpi-spend-value", "kpi-recoverable-value", "kpi-productive-value", "kpi-peer-value"])
        setText(id, "Unavailable");
      const portfolioList = document.getElementById("portfolio-list");
      portfolioList?.setAttribute("aria-busy", "false");
      portfolioList?.replaceChildren(renderPortfolioUnavailable(
        "The bundled analysis could not be loaded. Retry to restore the action portfolio."));
      setText("portfolio-count", "Portfolio unavailable");
      const list = document.getElementById("department-priority");
      list?.replaceChildren(element("li", "evidence-empty",
        "Bundled demo data could not be loaded. No live fallback was attempted."));
      setText("detail-name", "Demo result unavailable");
      setText("detail-score", "Unavailable");
      setText("detail-sample", "The bundled static fixture could not be read.");
      renderUnavailableAction("The bundled static fixture could not be read. No live analysis was attempted.");
      return;
    }

    const departments = Array.isArray(data.departments) ? data.departments : [];
    const totals = summarize(departments);
    renderFinancePortfolio(data);
    repaintBundledAnalysis = () => {
      renderHeadline(data.organization ?? {}, totals, gradeEligibility(departments));
      renderMix(totals);
    };
    repaintBundledAnalysis();
    renderDecisionSurface(data, departments);
    renderRedaction(data.redactionSamples);

    setLoadState("ready", "Bundled analysis ready",
      "Synthetic headline metrics, decisions, and action portfolio are available.");
    hasRenderedAnalysis = true;
    document.documentElement.dataset.shiplogEvolution = "ready";
  }

  await loadAndRender();
}

init();
