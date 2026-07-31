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
// Which executive panel may show a figure, and what a panel that may not says
// instead. One declared question, one declared input list, and one threshold per
// input live there; this page holds no opinion about panel visibility beyond
// counting the facts the contract reads.
import {
  MIN_SCORED_PROMPTS, examplePanelFacts, importedPanelFacts, panelStates,
} from "/finops-panel-contract.js";
import {
  applyPanelContract, applyPanelLifecycle, applyProofPointBasis,
} from "/finops-panel-contract-view.js";
// The guided-result composition. One leadership question, one grade-backed
// benchmark, one prioritized action, the required trust verdict, and the
// ordered list of panels a leader may open to check it. The contract selects
// all five and enforces that an import outranks the bundled seed; this page
// hands it already-computed figures and paints what comes back.
import { composeGuidedResult } from "/finops-guided-result.js";
import { applyDisclosureRoles, applyGuidedResult } from "/finops-guided-result-view.js";
// Supporting panels live behind disclosures, and the index above links straight
// into them. Without this a copied `#recommendation-evidence` lands a reader at
// the top of the page with the evidence still collapsed.
import { installDeepLinkDisclosure } from "/deep-link-disclosure.js";
// Disclosure-only method prose, fetched from a static fragment on first expand
// rather than shipped in this page's initial payload. It carries no figure and
// gates nothing: the panels it fills are readable before it runs and readable
// again if its fetch never lands.
import { installDeferredDetails } from "/finops-deferred-detail.js";
import { PANEL_STATUS } from "/panel-status-view.js";
import { formatIntegrationProvenance } from "/integration-contracts.js";
import { createStaticGateway } from "/static-gateway.js";
import { createFinancePortfolio } from "/finance-portfolio.js";
import { mountFinancePortfolio, renderPortfolioUnavailable } from "/finance-portfolio-view.js";
import {
  renderFinopsEvaluationPanel, renderFinopsEvaluationUnavailable,
} from "/finops-evaluation-view.js";
import { localFinopsMeetingSummary, normalizeLocalFinopsHistory } from "/local-finops.js";
// The portfolio-primary answer. It reads the intake plan the analysis already
// carries, so it cannot disagree with the coverage list painted from the same
// object, and it hands the page back to the single-provider brief when no
// portfolio exists.
import { applyPortfolioBrief, clearPortfolioBrief } from "/finops-portfolio-brief-view.js";
// The download itself. Every figure decision is inside `briefingFile`; the only
// thing this layer contributes is the clock, because the generator is pure and
// will not read one.
import { briefingFile, buildBriefing } from "/finops-briefing-export.js";
// The opt-in workspace consumes the canonical briefing and analysis only after
// both have been composed. This page does not know the storage shape or consent
// rules; the adapter owns projection, refusal, and the write/no-write decision.
import {
  browserFinopsWorkspaceStorage, retainDerivedPeriod,
} from "/finops-workspace.js";
// The read half of the same opt-in store. A visitor who granted retention and
// comes back later gets their last derived period, the movement between the
// retained months, and the commitments approved against them without opening a
// file. Without consent this returns nothing and the region stays hidden.
import { restoreFinopsWorkspace } from "/finops-workspace-restore.js";
import { applyWorkspaceRestore } from "/finops-workspace-restore-view.js";
// "Check the math" reads the briefing payload — never the analysis envelope and
// never the imported file — so the derivation on screen is a check of exactly
// the artifact a leader forwards.
import { briefingDerivation } from "/finops-briefing-derivation.js";
// One entry point for a selected file: `.json` keeps the reviewed JSON path
// untouched, `.csv`/`.tsv`/`.txt` route through the delimited normalizer. Both
// return the same parsed v1 envelope, so nothing below this line changes.
import { isDelimitedFileName, parseLocalImportFile } from "/finops-tabular-import.js";
import { readDelimitedText } from "/delimited-text.js";
// Where that one call runs. A module worker when the browser has one, this
// thread when it does not; the ceilings and the messages are the same either
// way, and the worker calls the same `parseLocalImportFile` imported above.
import { CANCELLED_CODE, checkImportCeiling, createImportOffloader } from "/import-offload.js";
import {
  checkFileSelectionCeiling, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, safeDisplayFileName,
} from "/import-limits.js";
// The column-review step. The model owns what every column became; the view
// owns the surface; this layer owns only when the step opens and closes.
import { createColumnMapping, mappingBinding, setColumnTarget, setMappingKind } from "/import-column-mapping.js";
import {
  closeMappingReview, focusMappingReview, renderMappingReview,
} from "/import-mapping-view.js";
import { headlineTrust } from "/finops-display.js";
import {
  assembleRecurringReview, clearCurrentReviewEvidence, readCurrentReviewEvidence,
  retainCurrentReviewEvidence,
} from "/recurring-review-readiness.js";
import { readMonthlyAction } from "/monthly-department-action-store.js";
import {
  captureJourneySnapshot, clearJourneySnapshot, restoreJourneySnapshot,
} from "/finops-journey-snapshot.js";
// The whole journey on one surface: the evidence this browser carries, the one
// prioritized step, and the checkpoint that will later say whether it worked.
// It composes the contracts below rather than recomputing any of them, and it is
// painted on this page and on the Savings Action Center from the same module.
import { consolidateJourney } from "/finops-journey-consolidated.js";
import { renderConsolidatedJourney } from "/finops-journey-consolidated-view.js";
import { renderRecurringReviewWorkspace } from "/recurring-review-workspace-view.js";
// The returning lead's question — "where do I start this month?" — and the one
// answer to it. The contract is pure and clock-free; the clock is injected at
// the call sites below, which is what makes the same records give one answer.
import { selectNextStep } from "/finops-next-step.js";
import { SAMPLE_LABEL, chooseJourneyState } from "/finops-next-step-source.js";
import { renderNextStep } from "/finops-next-step-view.js";
// Whether the letter may be shown at all is decided before it is drawn: the
// score card is a roll-up of only the departments the rubric actually scored.
import { gradeEligibility } from "/grade-eligibility.js";
// The drill-down's fallback answer to "so what do I do". A fixture that carries
// no reviewed intervention used to leave the whole action surface saying
// "Result unavailable"; the scorer fills the same twelve fields by rule instead,
// from the department's aggregate record and nothing else.
import { scoreDepartmentIntervention } from "/department-intervention-scoring.js";
import { interventionActionFields } from "/department-intervention-view.js";
// The other half of the drill-down: the evidence behind the grade and the fix
// pack that rides on the same model, painted into the two sections
// `evolution.html` ships empty for them.
import { EVIDENCE_PROVENANCE, departmentEvidenceModel } from "/department-evidence.js";
import { applyDepartmentEvidence } from "/department-evidence-view.js";
// The reader's own organizational query sample, graded. `orgQuerySampleResult`
// adapts the single parse the import path already made — with no grouping unit,
// because a reader with a query sample and no billing export has none to give —
// and the scoring module turns it into the same per-unit rows the drill-down's
// evidence panel and fix pack already consume.
import { orgQuerySampleResult, validateOrgQuerySource } from "/org-query-source.js";
// Coverage over that same sample, decided on the five structural signal
// families rather than on English keywords alone, plus the unclassified residue
// ranked by how much coverage resolving it would return.
import { familyCoverage, residueClusterKey } from "/corpus-family-coverage.js";
// The lead's own labels for that residue, applied through the same aggregation
// rather than beside it: `residueReview` re-invokes `familyCoverage` with the
// labels written into the records, so coverage keeps one definition.
import { isResidueLabel, residueReview } from "/residue-labeling.js";
// The only thing on this page that survives a reload of a lead's own reading:
// a digest of each labelled cluster and the class they chose, under one key,
// scoped to a digest of the corpus it was stated about. Nothing it stores can be
// read back into a query, a vendor name or a dollar.
import {
  OVERRIDE_CLEARED_ANNOUNCEMENT, OVERRIDE_CLEAR_LABEL, OVERRIDE_RETENTION_TEXT,
  OVERRIDE_UNAVAILABLE_NOTICE, browserQueryOverrideStorage, clearOverrides, hashText,
  readOverrides, writeOverrides,
} from "/query-override-store.js";
import {
  orgQueryDecisionData, orgQueryDecisionDepartments, orgQueryDepartmentLiteracy,
  orgQueryDepartmentRows,
} from "/org-query-scoring.js";
// The one leadership question that sample answers, assembled once. The scorer
// publishes fourteen fields of evidence; this pair selects the decision out of
// them — the answer, the grade and benchmark it rests on, the confidence, the
// provenance, one prioritized action, and the four disclosures a leader checks it
// with — and paints them. An ungradeable sample keeps the same block and says
// which floor it missed instead of publishing a letter.
import { orgQueryCoachingDecision } from "/org-query-decision.js";
import { applyOrgQueryDecision, clearOrgQueryDecision } from "/org-query-decision-view.js";
// The bundled synthetic sample behind that surface. The downloadable template is
// nine rows and every publishable floor refuses it, so it demonstrates the
// refusal and never the reading; this one is large enough to grade and goes
// through the same validator, scorer and view a reader's own file does.
import {
  EXAMPLE_ORG_QUERY_SAMPLE_FILE, loadExampleOrgQuerySample,
} from "/org-query-example.js";
// The second question this page can answer once an analysis exists: is the spend
// keeping pace with what was shipped? The contract owns the ratio, its three
// publishable states and the framing that keeps it an observation; this page owns
// only the pairing — which spend periods and which release log — and hands both
// sides to it.
import { deliveryEfficiencyFinding } from "/delivery-efficiency-finding.js";
import {
  deliveriesFromReleases, spendPerDeliveryDecision, spendPerDeliveryInput,
} from "/spend-per-delivery.js";
// The same figure asked of two aligned windows instead of a trailing mean, so the
// panel can answer "and did it move since the last comparable window?".
import { alignedSpendPerRelease } from "/aligned-spend-per-release.js";
import {
  applySpendPerDelivery, applySpendPerDeliveryPhase, clearSpendPerDelivery,
  SPEND_PER_DELIVERY_PHASE, SPEND_PER_DELIVERY_SECTION_ID,
} from "/spend-per-delivery-view.js";
// Delivery evidence is the release log this site already keeps, read through its
// own loader so the shape it validates is the shape counted here.
import { browserReleaseStorage, loadReleases } from "/releases.js";
// …or a Shiplog delivery history a leader was handed as a file, for the common
// case where the releases live in another install. The parser owns the schema,
// the version allowlist, and what partial, stale, malformed, reordered, and
// period-incompatible input does; this page owns only the routing and the pairing.
import {
  claimsDeliveryHistory, deliveriesFromDeliveryHistory, parseDeliveryHistory,
} from "/shiplog-delivery-history.js";
import { applyDeliveryHistory, clearDeliveryHistory } from "/shiplog-delivery-history-view.js";
// The bundled example dataset's release evidence, synthetic on both sides: an
// example analysis paired with a reader's real release log would put one
// organization's spend over another's deliveries.
import { EXAMPLE_DELIVERY_RELEASES } from "/spend-per-delivery-fixtures.js";
// No panel on this page writes its own "nothing here" sentence. Every empty,
// partial-coverage and failed-load string is authored in one module, so a
// reader meets one vocabulary for absence instead of one per branch.
import {
  ACTION_UNAVAILABLE_FIELD, ACTION_UNAVAILABLE_REASON, applyDepartmentDetailState,
  BUNDLED_LOAD_STATE, DEPARTMENT_LIST_MESSAGE, EVALUATION_BUNDLE_UNAVAILABLE,
  EVIDENCE_LIST_MESSAGE, HEADLINE_BUNDLE_UNAVAILABLE,
  KPI_NEEDS_REVIEW, KPI_NOT_LOADED, NO_COMPARABLE_PERIOD, NOT_GRADED,
  sampledCoverageLine,
} from "/briefing-strings.js";
// One status region narrates the load; every other slot states what it lacks.
// This module owns that division, the shape-and-word flags a metric with no
// measurement carries, and the single next action the region always offers.
import {
  applyImportPresence, applyMetricFlag, applyPageLoadStatus, bindChooseFiles, HERO_INTRO,
} from "/finops-load-status.js";
// The populated synthetic result a first-time visitor with no export meets in
// the first viewport. Composed from the bundled invented dataset through the
// real analysis path, so it needs no network and survives a failed fixture.
import { buildFirstRunResult } from "/finops-first-run.js";
import {
  applyExampleBriefingCta,
  applyFirstRunResult, applyFirstRunSupersession, bindFirstRunActions, bindFirstRunDisclosure,
} from "/finops-first-run-view.js";
// Where the reader goes once they have read that result. The contract owns which
// three destinations exist, which one is prioritized, and the clause that
// promoted it; this page hands the loaded record to the view and paints it.
import { loadWorkspaceDestinations } from "/finops-destination-contract.js";
import {
  applyWorkspaceDestinations, supersedeWorkspaceDestinations,
} from "/finops-destination-view.js";
// And the rail that says where the reader currently is. It consumes the same
// contract — the hrefs and the promoted door come from that record, not from a
// second list — but it is navigation rather than a recommendation, so it survives
// the supersession that retires the ranking.
import {
  applyWorkspaceNav, bindWorkspaceNav, supersedeWorkspaceNavRanking,
} from "/finops-workspace-nav.js";
// The question one level above the import panel: not "what did you read?" but
// "may these providers be put in one number at all?" The contract owns the
// verdict, the coverage benchmark, and the single next action; the samples are
// invented locally so the judgment is readable before a reader has any files.
import { evaluateSample } from "/portfolio-comparability-samples.js";
import { bindPortfolioSamples } from "/portfolio-comparability-view.js";
// The finding the reader's own partial evidence supports. The policy is fed the
// analysis envelope through its own adapter — the page never assembles the
// policy's input by hand — so a field added upstream cannot reach a rule until
// the adapter names it.
import { evaluatePartialEvidence, partialEvidenceFromAnalysis } from "/partial-evidence.js";
import { applyPartialEvidence, clearPartialEvidence } from "/partial-evidence-view.js";
import { initWorkspaceShell } from "/finops-workspace-shell.js";
// What each region of this page is for, declared in reading order. It writes
// attributes and no copy, so it cannot change what a reader sees today; what it
// changes is that "headline or support?" has an answer in the repository.
import { applyAnswerSpine } from "/finops/answer-spine-view.js";
// The answer spine itself — one question, one metric, one action, one artifact,
// and the classification of every other top-level region as evidence or gone.
import { applyFinopsSpine } from "/finops-spine.js";
// The page's one announcer, and the list of regions that had to stop echoing it.
import {
  announceAnswer, importFailureAnnouncement, silenceEchoedRegions,
} from "/finops-answer-announcement.js";
import {
  announce as announceStage, applyDatasetProvenance, applyExportPackageGuidance,
  applyFieldDiagnostic, applyImportLimits, applyOrgQuerySources, applyOrgQuerySourceStatus,
  applyBriefing, applyBriefingState, applyImportProgress, applyMetricBasis, applyProviderCoverage,
  applyRequirements, applyRestoreRejection,
  applyRestoredBriefing, applyStage, applySupportingDisclosures, applyTrustVerdict, diagnosticFor,
  EXAMPLE_DATASET_PROVENANCE,
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
// The question asked before any of the grading above: of the columns later
// structural grading depends on, which ones does the reader's own export
// actually carry? Contract and dialect tables in one module, painting in the
// other, both local-only.
import { parseCorpusStructure } from "/corpus-structure.js";
import { applyCorpusStructure } from "/corpus-structure-view.js";
import { gradedSampleFigures, querySampleEligibility } from "/graded-sample-figures.js";
import { promptGradingEligibility, promptGradingSignals } from "/prompt-grading-eligibility.js";
import { applyGradedSample, clearGradedSample } from "/graded-sample-view.js";
// The reader's own figures, in the executive slots above the import panel. The
// panel contract decides which of those slots may show a figure at all; this
// pair decides what the figure says once it may. Without them an import leaves
// the hero grade, the KPI row and the mix holding the BUNDLED sample's numbers
// under a provenance line that reads "Your data".
// The corrections seam. Every grade, coverage share and recoverable figure this
// page publishes off the reader's own import goes through `applyOverrides`, so
// a human label lands on the headline by the same path the classifier's does
// rather than through a second, quieter one.
import { applyOverrides } from "/query-label-overrides.js";
// …and the rest of that one seam. The review panel writes a correction, counts
// what is actually inside the numbers, reverts, and ranks the next action
// through these rather than through arithmetic of its own — extending the model
// is the only way this page is allowed to grow a correction feature.
import {
  OVERRIDE_LABELS, applyCorrection, correctionProvenance, prioritizedRecovery, revertToClassifier,
} from "/query-label-overrides.js";
// The rows a human is handed, and the panel that shows them. The sampler is the
// model's own; this pair only pairs a row with the key the model files it under
// and renders the reader's own text as text.
import { reviewSample } from "/query-review-sample.js";
import { REVIEW_COPY, bindQueryReview, renderQueryReview, reviewPassSummary } from "/query-review-view.js";
import {
  applyImportedExecutive, clearImportedExecutive, importedExecutiveFigures,
} from "/imported-executive-view.js";
import { importedPeerBenchmark } from "/imported-peer-benchmark.js";
import { PEER_COHORT_PROVENANCE } from "/peer-cohort-contract.js";
// The declared half of the peer comparison. `importedPeerBenchmark` above can
// only ever see the size of an import; the two attributes that select a
// *specific* cohort are declared by the reader in their own file, and this pair
// decides whether what they declared is enough — or says which value is missing
// or unrecognized, in the reader's own words.
import {
  mergeCohortSources, projectCohortSource, validateCohortAttribution,
} from "/cohort-attribution.js";
import { applyCohortAttribution } from "/cohort-attribution-view.js";
// The headline answer this view leads with, and the module that paints it.
import {
  applyStandHeadline, bindStandDisclosures, bindStandResolution, mountStandDisclosures,
} from "/finops-stand-view.js";
// …and the one owner of WHICH source that answer came from. The page used to
// choose between the bundled example and the reader's import at each call site;
// it now reads a single held answer, so the headline, the action, the position
// and the department drill-down can never come from two different sources.
import { createAnswerState } from "/answer-state.js";
import {
  FINOPS_IMPORT_STATUS, finopsProvenanceModel, promptImportFacts,
} from "/finops-provenance-model.js";
import { applyFinopsProvenance, clearFinopsProvenance } from "/finops-provenance-view.js";
import { loadExampleDatasetInputs } from "/example-dataset.js";
import { EXAMPLE_QUERY_SAMPLE_FILE, exampleQuerySampleText } from "/query-sample-example.js";
import {
  CONVERSATION_EXAMPLE_FILES, conversationExampleText,
} from "/conversation-export-example.js";
// One imported-analysis state, and the four linked disclosures composed from
// it: the leading finding, the benchmark card, the recommendation evidence, and
// the quantified-impact figure with the action it sizes. Four call sites reading
// three different inputs is how one analysis said four different things about
// itself, so this page composes the state once and paints what it is handed.
//
// The leading finding is still the versioned briefing contract's — the three
// slots above the fold are selected in finops-briefing-contract.js and only
// there, so this page, the JSON export, and anything downstream cannot each
// decide them for themselves — but the adapter is what calls it now, and this
// page reads `guided.finding.briefing` rather than building a second briefing
// beside the other three disclosures. The month-over-month arithmetic still
// lives in finops-leading-finding.js; the contract reads it rather than
// repeating it.
import {
  DISCLOSURE_SOURCE, guidedDisclosures, importedAnalysisState,
} from "/imported-analysis-disclosures.js";
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
// The agreement figure is COMPUTED HERE, in this browser, on every visit — the
// corpus is fetched and scored rather than a recorded number being read out of
// a file. That is deliberate: it makes drift between the published figure and
// the shipped classifier impossible, because there is no stored figure to
// drift. The scorer is pure and the corpus is the same public file the basis
// line links to, so a reader who runs it themselves gets these bytes.
import { scoreAgreementCorpus } from "/finops-classifier-agreement.js";
import { renderClassifierAgreement } from "/finops-classifier-agreement-view.js";

const DATA_URL = "/evolution-demo-data.json";
const EVALUATION_URL = "/finops-evaluation-fixtures.json";
const AGREEMENT_CORPUS_URL = "/finops-classifier-agreement-corpus.json";
const MODEL_OVERSPEND_URL = "/model-overspend-finding-fixture.json";
// Repainting the bundled headline and mix, from the last analysis that loaded.
// "Return to example data" has to put the example figures back into the same
// slots a graded sample borrowed, and re-running the two renderers is the only
// way to do that without a second copy of them.
let repaintBundledAnalysis = () => {};
// The page's one answer. Module scope because the import flow and `init()` are
// two closures that must agree on what is currently on screen; nothing is
// composed until something reads it, and nothing here touches storage.
const answerState = createAnswerState();
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

// The lifecycle half of the one status region. Title and copy are optional: on
// the way to "ready" the region's sentence is not "the fetch finished" but
// "these numbers are/are not yours", and `applyImportPresence` writes that.
function setLoadState(state, title = "", copy = "") {
  return applyPageLoadStatus(document, { state, title, detail: copy });
}

/**
 * Flag the five bundled metric slots that are not measurements.
 *
 * Every one of them already carried the right words — "Needs review", "Not
 * loaded" — under a dashed border and an amber tint. What they lacked was the
 * second non-colour channel, so a greyscale print or a colour-blind reader met
 * a figure-shaped slot and no way to tell it apart from a figure. The flag adds
 * a shape and repeats the state as a lowercase word beside it.
 */
function applyBundledMetricFlags({ score = null, spend = null, recoverable = null,
  highValue = null, percentile = null } = {}) {
  applyMetricFlag(document, "score-flag", score);
  applyMetricFlag(document, "kpi-spend-flag", spend);
  applyMetricFlag(document, "kpi-recoverable-flag", recoverable);
  applyMetricFlag(document, "kpi-productive-flag", highValue);
  applyMetricFlag(document, "kpi-peer-flag", percentile);
}

/**
 * This browser's release log, or an empty log where storage refuses to be read.
 *
 * The store is acquired through `releases.js`, which owns both the key and the
 * shape it validates, so this page names no storage API of its own. An unreadable
 * store is an empty release log — which the contract already answers with
 * `no_delivery_evidence` and the action that fixes it — not an error state.
 */
function storedDeliveryReleases() {
  const store = browserReleaseStorage();
  return store ? loadReleases(store) : [];
}

/**
 * Paint "is AI spend keeping pace with shipped delivery?" from an analysis, or
 * hand the section back when there is no analysis to pair.
 *
 * The pairing is the only decision made here, and it is symmetric: the bundled
 * example dataset is paired with the bundled example release log, a reader's own
 * import with a reader's own release log. Which of the three states appears is the
 * contract's call — including the common one, where an analysis exists and no
 * release has ever been recorded, and the prioritized action is to record one.
 */
/**
 * An accepted delivery-history file, or null. Module-level for the same reason
 * `importedLiteracyRows` is: the file is read inside the import closure and the
 * pairing above happens outside it, and a second copy of this fact is a second
 * chance for the panel and the file to disagree.
 */
let importedDeliveryHistory = null;
/**
 * The bytes behind that outcome, retained only in this tab. A delivery file can
 * arrive before the provider period in a multi-file selection; keeping the bytes
 * lets `renderResult` validate the pair once that period exists instead of
 * treating an unchecked history as compatible.
 */
let selectedDeliveryHistoryText = null;

function spendWindowFromPeriod(period) {
  const match = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(String(period ?? ""));
  return match ? { start: match[1], end: match[2] } : null;
}

/**
 * Swap a delivery-history file's releases in for this browser's release log.
 *
 * The file is authoritative when one was accepted rather than merged with the
 * local log: the same release recorded in both would otherwise be counted twice,
 * and a denominator that double-counts is worse than either source alone. The
 * provenance says which of the two answered, so the ratio on screen can never be
 * read as the local log's when it is not.
 */
function withDeliveryHistory(input, history) {
  const { deliveries, statusDeclared } = deliveriesFromDeliveryHistory(history);
  return {
    ...input,
    deliveries,
    provenance: {
      ...input.provenance,
      source: history.provenance.source,
      derivedFromFields: [
        ...input.provenance.derivedFromFields.filter((field) =>
          !field.startsWith("local.shiplog.release.")),
        ...(deliveries.length ? ["local.shiplog.release.created_at"] : []),
        ...(statusDeclared ? ["local.shiplog.release.status"] : []),
      ],
    },
  };
}

/**
 * The releases a portfolio's delivery efficiency is divided by, in the one
 * precedence this page already uses: an accepted delivery-history file answers
 * for the whole log when there is one, and this browser's release log otherwise.
 * The example dataset is never paired with a reader's own releases, so the
 * example path supplies none and the aggregate reports the absence.
 */
function portfolioDeliveries() {
  if (importedDeliveryHistory?.usable) {
    return deliveriesFromDeliveryHistory(importedDeliveryHistory).deliveries;
  }
  return deliveriesFromReleases(storedDeliveryReleases()).deliveries;
}

function paintSpendPerDelivery(analysis, { example = false } = {}) {
  if (!analysis) return clearSpendPerDelivery(document);
  // One input, read once, and both derivations take it. Assembling it twice would
  // be two chances for the two records on screen to describe different releases.
  const base = spendPerDeliveryInput({
    analysis,
    releases: example ? EXAMPLE_DELIVERY_RELEASES : storedDeliveryReleases(),
    origin: example ? "example" : "import",
  });
  // The example dataset is never paired with a reader's own file, in either
  // direction: synthetic spend over real releases is the same mislabelling as
  // real spend over synthetic releases.
  const input = !example && importedDeliveryHistory?.usable
    ? withDeliveryHistory(base, importedDeliveryHistory) : base;
  const decision = spendPerDeliveryDecision(input);
  // The scoring layer runs on the production path, not beside it: the classified,
  // prioritized, caveated finding is generated from the same decision this page
  // paints, so a reading and its classification cannot disagree, and the panel
  // has no state in which the figure appears without them.
  //
  // The period-aligned pair is derived on the same path for the same reason. It
  // answers the question the trailing baseline cannot — did this move since the
  // last comparable window — and it is the only place a mismatched pair of
  // reporting windows or a release outside the compared pair is reported.
  return applySpendPerDelivery(document, decision, deliveryEfficiencyFinding(decision),
    alignedSpendPerRelease(input));
}

/**
 * The two phases of the delivery panel that are not a reading.
 *
 * Both are captions over whatever the panel already holds, never a repaint of
 * it: a leader who watches the figure they were reading disappear mid-import
 * concludes the product broke, which is a worse answer than "the reading below
 * is the previous one". `announce: false` on both, because this page has one
 * status region and one retry for a failed read, and a second alert for the
 * same event interrupts a screen-reader user twice for one thing.
 */
const spendPerDeliveryPhase = (phase, detail) =>
  applySpendPerDeliveryPhase(document, phase, { detail, announce: false });

/** Take the "reading…" caption down on any path that never painted a reading. */
function endSpendPerDeliveryLoading() {
  const section = document.getElementById(SPEND_PER_DELIVERY_SECTION_ID);
  if (section?.dataset.phase !== SPEND_PER_DELIVERY_PHASE.loading) return;
  spendPerDeliveryPhase(SPEND_PER_DELIVERY_PHASE.ready);
}

function fillTextList(id, values, emptyText) {
  const list = document.getElementById(id);
  if (!list) return;
  list.replaceChildren();
  const items = values.length ? values : [emptyText];
  for (const value of items) list.append(element("li", undefined, value));
}

// What the bundled seed and the two bundled fixtures actually contain, so the
// contract counts them rather than trusting that they loaded. Before they
// arrive everything they would supply is genuinely zero, which is a state the
// contract already has a sentence for.
let bundledSeed = null;
let bundledEvaluationRecords = 0;
// The import closure owns the imported half of the facts, so it publishes the
// repaint the same way the bundled analysis does. Assigned in
// `mountLocalFinopsImport`; a no-op until then.
let syncExecutivePanels = () => {};
// The graded rows of the reader's own organizational query sample, keyed by org
// unit, or null while the drill-down is describing the bundled sample. It is the
// one thing that decides whether the decision detail below is about a reader's
// unit or about synthetic data, so it is a single flag rather than an inference
// from counting files, and the two provenance labels follow it.
let importedLiteracyRows = null;

/**
 * Repaint every declared panel from one fact record.
 *
 * This is the only function on the page that decides whether an executive panel
 * shows figures, and it decides nothing itself: `panelStates` is pure and the
 * view only paints what it returns.
 */
function applyPanelFacts(facts, { imported = false } = {}) {
  applyProofPointBasis(document, { imported });
  // Whose numbers these are, said in the one region a reader meets first. It is
  // a no-op while that region is still reading or has failed: the load
  // lifecycle owns it in those two states, and a panel repaint that happens to
  // run afterwards must not overwrite a failure notice with a data-provenance
  // sentence.
  applyImportPresence(document, imported);
  return applyPanelContract(document, panelStates(facts));
}

/**
 * The bundled seed's own literacy roll-up, in the shape the guided-result
 * contract reads a grade in.
 *
 * This is not a second scoring pass. `summarize` already publishes the
 * spend-weighted composite and its letter, and the scored-record count is the
 * seed's own declared sampling; both are repeated here. What is added is the
 * eligibility envelope the contract needs in order to decide whether the letter
 * may be published at all, and the floor it is decided against is the hero
 * panel's published one rather than a number invented here.
 *
 * No confidence level is claimed. The composition already stamps this basis
 * synthetic, and a named confidence over invented records would be a second,
 * softer claim about the same thing.
 */
function bundledBenchmarkGrade(seed) {
  const departments = Array.isArray(seed?.departments) ? seed.departments : [];
  const scored = departments.reduce((sum, department) => sum + (
    department?.sampling?.status === "available"
      && Number.isFinite(department.sampling.sampledQueries)
      ? department.sampling.sampledQueries : 0), 0);
  const totals = summarize(departments);
  const gradeable = departments.length > 0 && scored >= MIN_SCORED_PROMPTS;
  return {
    version: "bundled-seed-grade/1.0.0",
    rubricVersionId: totals.scoreExplanation.version,
    gradeable,
    grade: gradeable ? totals.grade : null,
    composite: gradeable ? totals.score : null,
    reason: gradeable ? null : "scored_records_below_eligibility_floor",
    reasonRule: gradeable ? null
      : `The bundled seed declares fewer than ${MIN_SCORED_PROMPTS} sampled queries, which is the `
        + "floor the hero grade panel publishes.",
    confidence: { level: null, basis: { arithmetic: totals.scoreExplanation.rule } },
    records: { source: scored, scored, unclassified: 0 },
    eligibility: { minScoredRecords: MIN_SCORED_PROMPTS, observed: scored, met: gradeable },
  };
}

function downloadLocalExport(content, type, fileName) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Repaint the "what this browser remembered" region from the opt-in store.
 *
 * Called on cold load and again after every retention write, so the region a
 * returning visitor reads is never one import behind. Storage is the only input
 * and a refusal is silent here: the workspace page is the single surface that
 * reports what this browser did or did not keep.
 */
function syncWorkspaceRestore() {
  try {
    applyWorkspaceRestore(document, restoreFinopsWorkspace(browserFinopsWorkspaceStorage()));
  } catch {
    applyWorkspaceRestore(document, null);
  }
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
  // Conversation or audit archives, kept apart from `samples` above because they
  // are a different kind of evidence: they place and count queries and carry no
  // token counts or rubric category, so every consumer that grades a *prompt
  // sample* must not see them. Only the organizational literacy path reads them.
  const archives = [];
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
  // The attributed share the trust verdict last measured, kept so the panel
  // contract reads the same ratio the coverage headline printed rather than
  // summing the same two totals a second time.
  let attributedShare = 0;
  // The same ratio, kept undefined rather than zeroed when no spend was read.
  // The panel contract wants a counted fact and reads an absent one as 0; a
  // provenance block must not, because "0% of the dollars resolved to an org
  // unit" is a measurement and "there were no dollars" is not.
  let attributedFraction = null;
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
  const boundedDelimitedOptions = (extra = {}) => ({
    maxBytes: MAX_IMPORT_BYTES,
    maxRows: MAX_IMPORT_ROWS,
    sampleOversized: true,
    ...extra,
  });
  // One flag decides everything the reader is told about where these numbers
  // came from: the badge, the metric basis, every provenance note, and the two
  // download artifacts. Nothing else in this file gets to have an opinion.
  let exampleActive = false;
  // The last trust verdict this page computed, held for the guided-result
  // composition. It is the verdict `renderResult` already built from the parsed
  // rows and roster; recomputing it here would be a second reading of the same
  // files and a second chance for two coverage figures to disagree.
  let lastVerdict = null;
  const MAX_DISPLAY_USD = 1_000_000_000_000;
  const plausibleUsd = (value) => Number.isFinite(value) && value >= 0 && value <= MAX_DISPLAY_USD;
  const moneyText = (value) => plausibleUsd(value) ? `${value.toFixed(2)} USD` : "Needs review · value withheld";

  // One announcement per commit. A file input only commits on change, so there
  // is no keystroke to debounce; what matters is that a single message goes to
  // exactly one region, chosen by severity.
  const announce = (state, title, copy) => {
    const painted = announceStage(document, {
      severity: state === "error" ? "assertive" : "polite", state, title, copy,
    });
    // The two regions this paints were silenced at boot, because every OUTCOME
    // they carry is said again by the answer's own sentence a moment later and a
    // reader should hear it once. An import that is still reading is not an
    // outcome and has no answer sentence behind it, so that one message is
    // forwarded to the same announcer rather than lost: one region, one message,
    // one per event.
    if (state === "loading") announceAnswer(document, `${title} ${copy}`);
    return painted;
  };

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
   * The facts every executive panel is decided from.
   *
   * Two sources, never mixed. A leader's own import governs its own panels: the
   * bundled seed can no longer answer for them, so nothing it holds is counted
   * once their file is on screen. That is the whole reason a panel goes
   * unavailable rather than quietly continuing to show synthetic figures under
   * an imported heading.
   *
   * Nothing is measured here that some other module has already measured: the
   * attributed share is the trust verdict's, the two prompt counts are the
   * prompt-grading verdict's, and the provider rows are counted inside the
   * contract out of the same parsed envelopes the analysis read.
   */
  const importedRowFacts = () => {
    const verdict = promptGrading();
    return importedPanelFacts({
      providers: loaded.providers,
      result,
      attributedShare,
      scoredPrompts: verdict.classifiedPrompts,
      gradedDepartments: verdict.departmentsCovered,
      // The published cohort this import selected, if any. The panel and the KPI
      // card read the same evaluation, so one cannot publish a percentile while
      // the other says no cohort applies.
      peerCohortRecords: (() => {
        const peer = importedPeer();
        return peer.available ? peer.cohort.memberCount : 0;
      })(),
    });
  };
  const executivePanelFacts = () => {
    if (result && !exampleActive) return importedRowFacts();
    return examplePanelFacts(bundledSeed, {
      evaluationRecords: bundledEvaluationRecords,
      // One row is enough to make the per-model question answerable, and the
      // bundled finding is either read or it is not. A fixture that failed to
      // load is counted as absent, so the panel says so instead of standing
      // open and empty.
      modelFindingRows: overspendFinding ? 1 : 0,
    });
  };
  /**
   * The two sides the guided-result contract chooses between.
   *
   * A leader's own import is handed over as `imported` and the bundled seed is
   * not passed at all — the contract enforces precedence on its side too, but
   * building one side per state is what makes it impossible for a synthetic
   * figure to be sitting in scope when an import is on screen.
   *
   * On the bundled side `analysis` is the example dataset's envelope when the
   * visitor opened it and null otherwise, so a first paint composes a benchmark
   * and the one action a page showing invented numbers may honestly prioritize.
   */
  const guidedInputs = () => {
    if (result && !exampleActive) {
      return {
        imported: {
          grade: importedCorpus(),
          analysis: result,
          verdict: lastVerdict,
          facts: importedRowFacts(),
        },
      };
    }
    return {
      bundled: {
        grade: bundledBenchmarkGrade(bundledSeed),
        analysis: exampleActive ? result : null,
        facts: executivePanelFacts(),
      },
    };
  };
  const syncGuidedResult = () => {
    const composed = composeGuidedResult(guidedInputs());
    const storage = browserFinopsWorkspaceStorage();
    const retained = readMonthlyAction(storage);
    const evidence = readCurrentReviewEvidence(storage);
    renderRecurringReviewWorkspace(document, assembleRecurringReview({
      retainedAction: retained.record,
      currentAnalysis: evidence.currentAnalysis,
      theoVerdict: evidence.theoVerdict,
    }), retained.record);
    // The same retained record decides the next step, so committing, clearing,
    // or importing over one moves both surfaces in the same pass rather than
    // leaving a recommendation standing over evidence that has changed.
    paintNextStep();
    // The demotion is written onto the panels themselves, so "support, not
    // primary" is a fact on one element rather than a claim in a document.
    applyDisclosureRoles(document, composed.disclosures);
    return applyGuidedResult(document, composed);
  };
  const syncPanels = () => {
    // The first-run block answers "what would this tell me?". Any analysis on
    // screen — the reader's import, or the example loaded into every panel —
    // closes that question, so the block retires rather than sitting beside a
    // fuller result with a second synthetic headline in it.
    // The reader's own briefing heading is where this block's question is
    // answered next, and it already takes focus programmatically, so it is
    // where a keyboard user is put if the region retires under their focus ring.
    applyFirstRunSupersession(document, Boolean(result),
      { focusFallbackId: "local-results-title" });
    // The destination ranking belongs to that block: the doors stay true, but the
    // order they are in was ranked from the invented dataset, so it retires with
    // the example rather than recommending a first step off data nobody imported.
    supersedeWorkspaceDestinations(document, Boolean(result));
    // The rail keeps its doors — they are places, and a reader who has just
    // imported their own export needs them more than anyone — and loses only the
    // "Recommended first" chip, which was ranked from the invented dataset.
    supersedeWorkspaceNavRanking(document, Boolean(result));
    const painted = applyPanelFacts(executivePanelFacts(), {
      imported: Boolean(result) && !exampleActive,
    });
    // After the panels, never before: the composition names which of them are
    // permitted as support, and it must read the states the contract just
    // decided rather than the ones from the previous paint.
    syncGuidedResult();
    return painted;
  };
  syncExecutivePanels = syncPanels;
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
      peer: provenance && result ? importedPeer() : null,
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
  /**
   * The reader's own corpus, graded against the declared hero-panel floor.
   *
   * Every row the query sample handed over is counted as a source record —
   * including the ones no rubric category could be assigned to, which are passed
   * as an empty record so they land in `unclassified` rather than quietly
   * shrinking the denominator. Nothing from an unreadable row is copied.
   */
  /**
   * The human corrections standing over the classifier, in this tab only.
   *
   * A `Map`, empty until a reviewer disagrees with a class, and never persisted:
   * a correction is a claim about a row in the file currently on screen, and a
   * restored one would attach a label to a row that may not be there. The
   * headline reads it on every recomputation, so the number moves the moment an
   * entry lands here rather than on a later refresh.
   */
  const queryLabelOverrides = new Map();
  const overriddenCorpus = (entries = classifiedSamples()) => applyOverrides(
    entries.flatMap(({ classified }) => [
      ...classified.records,
      ...classified.unclassified.map(() => ({ category: null })),
    ]),
    queryLabelOverrides,
    { spendUsd: result?.spendUsd ?? null },
  );
  const importedCorpus = (entries = classifiedSamples()) => overriddenCorpus(entries).corpusGrade;
  /**
   * The review panel, painted from the same `applyOverrides` result the hero
   * grade above it is painted from.
   *
   * Nothing is recomputed here: the grade, the coverage share, the recoverable
   * figure, the count of corrections actually folded in and the one prioritized
   * action all come off the model. `classifiedSamples()` is empty on the bundled
   * example path, so this reduces to "no panel" there and the demo numbers are
   * untouched.
   */
  let reviewAnnouncement = null;
  /**
   * Whether a correction has landed that no consolidated message has covered.
   *
   * One message per pass, not one per row: the panel used to announce every
   * figure on every correction, which is twenty-five interruptions for a
   * twenty-five row sample. The row's own state chip carries the per-item change
   * — it is part of the row's accessible name, under the reader's focus — and
   * this flag is what makes the end of the pass, or leaving it, say the one
   * thing worth saying.
   */
  let unannouncedCorrections = false;
  const reviewPassLine = (corrected) => reviewPassSummary(corrected.overridesApplied,
    { grade: corrected.grade, coverage: corrected.coverage });
  const syncQueryReview = () => {
    const entries = classifiedSamples();
    const corrected = overriddenCorpus(entries);
    const sample = reviewSample(entries);
    if (sample.rows.length > 0 && unannouncedCorrections
      && sample.rows.every((row) => queryLabelOverrides.has(row.key))) {
      unannouncedCorrections = false;
      reviewAnnouncement = reviewPassLine(corrected);
    }
    const painted = renderQueryReview(document, {
      available: entries.length > 0,
      sample,
      grade: corrected.grade,
      coverage: corrected.coverage,
      recoverableSpend: corrected.recoverableSpend,
      included: corrected.overridesApplied,
      provenance: correctionProvenance(corrected.overridesApplied),
      nextAction: prioritizedRecovery(corrected.mix, { spendUsd: result?.spendUsd ?? null }),
      labels: OVERRIDE_LABELS,
      selected: queryLabelOverrides,
      announcement: reviewAnnouncement,
    }, { onCorrect: correctQueryLabel });
    reviewAnnouncement = null;
    return painted;
  };
  /**
   * One correction, and every figure it moves.
   *
   * The model validates the label — a value the control never offered is refused
   * there rather than trusted here — and then the executive slots above are
   * repainted from the same corpus call they always used, so a human label lands
   * on the headline by the classifier's own path.
   */
  function correctQueryLabel(key, label) {
    const outcome = applyCorrection(queryLabelOverrides, key, label);
    if (!outcome.ok && outcome.reason === "unknown_label") return outcome;
    unannouncedCorrections = true;
    repaintCorrectedFigures();
    return outcome;
  }
  /** Closing the panel with the pass unfinished still earns the one message. */
  function announceReviewPass() {
    if (!unannouncedCorrections) return;
    unannouncedCorrections = false;
    reviewAnnouncement = reviewPassLine(overriddenCorpus());
    syncQueryReview();
  }
  function revertQueryLabels() {
    revertToClassifier(queryLabelOverrides);
    unannouncedCorrections = false;
    reviewAnnouncement = REVIEW_COPY.reverted;
    repaintCorrectedFigures();
  }
  /** The reader's own figures, redrawn. Nothing else on the page is touched. */
  let lastFigureSync = null;
  function repaintCorrectedFigures() {
    if (lastFigureSync) syncImportedFigures(lastFigureSync);
    paintGradedSample();
    syncQueryReview();
  }
  /**
   * The executive figures above the import panel, filled from that corpus.
   *
   * Called after the graded surface, because when a sample clears the
   * spend-coverage tier that surface owns the KPI row and the mix and publishes
   * a richer reading of both. When it does not — the common case for a leader's
   * first import — those slots would otherwise still hold the bundled sample's
   * numbers under the reader's own provenance line, which is the mislabelling
   * this wiring exists to end.
   */
  /**
   * This import's own peer comparison.
   *
   * Both inputs are the reader's own — the graded corpus and the local analysis
   * — and the cohort is published reference data. The bundled seed's
   * organization block and its hand-authored percentile are not read here, on
   * either side.
   */
  const importedPeer = (analysis = result) => importedPeerBenchmark({
    grade: importedCorpus(), analysis,
  });
  const syncImportedFigures = ({ analysis = null, plausible = true, withheld = false, gradedMix = false } = {}) => {
    const figures = importedExecutiveFigures(importedCorpus(), {
      spendUsd: analysis?.spendUsd ?? null,
      recoverableUsd: analysis?.recoverableUsd ?? null,
      departments: analysis?.rankedDepartments?.length ?? 0,
      period: analysis?.period ?? null,
      plausible,
      recoverableWithheld: withheld,
      // Both are the reader's own, and both are absent rather than zero when
      // there is no analysis to read them off: the money cards' provenance is
      // counted from the parsed provider envelopes, and the fraction is the one
      // the trust verdict measured a few lines above. Neither may fall back to
      // the bundled seed's facts, which is what `examplePanelFacts` would give.
      facts: analysis ? importedRowFacts() : null,
      attributedShare: analysis ? attributedFraction : null,
      // Evaluated from this import against the published cohorts. Null when
      // there is no analysis to derive a segment from, so the card says no
      // comparison was evaluated rather than inventing a refusal for one.
      peer: analysis ? importedPeer(analysis) : null,
    });
    applyImportedExecutive(document, figures, { band });
    // One painter per state. The graded surface has already drawn its own mix
    // into these nodes; drawing a second one over it would be the same chart
    // twice with two different captions. What must not survive underneath an
    // unavailable mix is the bundled sample's chart, so the empty shares are
    // painted with the refusal's own caption and basis.
    if (!gradedMix) {
      renderMix({
        mix: figures.mix.available ? figures.mix.shares : {},
        spendUsd: figures.mix.available ? (analysis?.spendUsd ?? 0) : 0,
      }, { captionFor: figures.mix.captionFor, basis: figures.mix.basis });
    }
    return figures;
  };
  const paintGradedSample = () => {
    const model = gradedModel();
    if (!model) return null;
    // The graded view fills exactly the panels it has the reader's own figures
    // for. Which panels those are is the contract's decision, applied after this
    // call in `renderResult`; nothing is hidden here.
    return applyGradedSample(document, model);
  };
  const renderResult = (next, { example = false, inputs = loaded } = {}) => {
    result = next;
    exampleActive = example;
    // Selection order cannot weaken period validation. If the delivery file was
    // read before the provider file, parse it again against the now-known spend
    // window before any ratio is painted. This is replacement, not accumulation,
    // so replay detection is neither needed nor safe without retaining a source
    // identifier to scope the sequence to.
    if (!example && selectedDeliveryHistoryText !== null) {
      const window = spendWindowFromPeriod(next.period);
      const outcome = parseDeliveryHistory(selectedDeliveryHistoryText, {
        asOf: window ? `${window.end}T00:00:00Z` : null,
        spendWindow: window,
      });
      applyDeliveryHistory(document, outcome);
      importedDeliveryHistory = outcome.usable ? outcome : null;
    }
    resultsNode.setAttribute("aria-busy", "false");
    // Which providers are inside this number, and what the intake contract held
    // out of it. Painted from the plan the analysis carries rather than from a
    // second read of the selection, so the panel and the total cannot disagree.
    applyProviderCoverage(document, next.multiProvider ?? null);
    // The answer a portfolio deserves, from the same plan the coverage list is
    // painted from. It leads the answer destination when — and only when — the
    // intake contract actually combined two or more providers; a single-provider
    // import returns `available: false` and the page renders exactly as before.
    applyPortfolioBrief(document, next);
    applyDatasetProvenance(document, example, example ? null : importProvenance());
    // Where this organization ranks, decided from the same selection this
    // result was analyzed from. The bundled example declares no cohort
    // attributes and gets no position: a synthetic file must not be given a
    // place among real organizations' peers.
    syncCohortPosition(next);
    if (remap) remap.hidden = example || !imports.some((entry) => entry.source === "delimited");
    setMode(example ? "example-dataset" : "local", example ? "Bundled synthetic example" : "Local import");
    setText("finops-intro", example
      ? `${EXAMPLE_DATASET_PROVENANCE.detail} It walks the same translator and analysis an `
        + `imported file walks, so the finding below is computed, not written. `
        + EXAMPLE_DATASET_PROVENANCE.swap
      : "This FinOps briefing uses only the provider and HRIS exports selected in this tab. "
      + "It makes a bounded routing estimate and refuses unsupported peer benchmark or prompt-quality claims.");
    setText("finops-provenance", `${next.period} · ${next.provenance}`);
    // The delivery comparison, from the same envelope. It is painted here rather
    // than at the two call sites above it because every analysis this page renders
    // — bundled example or reader's own import — has spend periods, and a section
    // that answered for one and not the other would leave a stale window on
    // screen. Whether a ratio is publishable at all is the contract's decision.
    paintSpendPerDelivery(next, { example });
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
    // The quantified impact is painted below, from the disclosure adapter, once
    // the attribution decision it depends on has been made. It used to be
    // written here and then overwritten a few lines later, which is two call
    // sites deciding one figure.
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
    // Held for the guided-result composition, which requires a trust verdict
    // and will not publish a decision-ready result without one. The example
    // dataset's verdict is deliberately not held: a synthetic dataset cannot
    // earn one, and the composition refuses it on that side anyway.
    lastVerdict = example ? null : verdict;
    if (!example) {
      const reviewStorage = browserFinopsWorkspaceStorage();
      retainCurrentReviewEvidence(reviewStorage, {
        currentAnalysis: next,
        theoVerdict: verdict,
      });
      // Derived from the record written on the line above and from whatever
      // tracked action this browser already holds — never from the analysis in
      // scope here, so the snapshot can only ever reference evidence that was
      // actually retained. A refusal is silent: the analysis is unaffected, and
      // the journey view falls back to reading those same records itself.
      captureJourneySnapshot(reviewStorage, { importSource: importProvenance() });
    }
    // How much of this spend is attributed decides what the recoverable figure
    // above may claim. The verdict has already summed both sides of that ratio;
    // summing them again here is how two numbers on one screen start
    // disagreeing, so the share is assembled from its totals.
    const share = attributionShareFromTotals({
      attributedCost: (verdict.headline?.attributedMinor ?? 0) / 100,
      totalCost: (verdict.headline?.totalMinor ?? 0) / 100,
    });
    // Held for the panel contract, which decides whether a department may be
    // ranked at all from the same ratio this line prints.
    attributedShare = share?.share ?? 0;
    attributedFraction = share?.defined ? share.share : null;
    const attribution = applyAttributionPolicy(share);
    // The landing surface. It is drawn from the same envelope for example data
    // and for a real import; there is no example-only branch below this line.
    // The attribution decision made three lines up is handed to the adapter
    // rather than re-derived by it: a figure this page withheld must not
    // reappear in the briefing built from the same analysis.
    const attributionWithheld = attribution?.confidence === CONFIDENCE.SUPPRESSED;
    // What this evidence supports, given what is missing from it. Painted here
    // and not earlier because the policy's last input is the attributed share
    // decided three lines up: the panel must ask for attribution against the
    // same ratio the coverage headline printed rather than a second reading of
    // the same two totals. Peer availability is passed, never a peer figure —
    // the policy has no branch that can measure one.
    applyPartialEvidence(document, evaluatePartialEvidence(partialEvidenceFromAnalysis({
      analysis: next,
      peer: example ? null : importedPeer(next),
      attributedShare: attributedFraction,
      source: example ? "example" : "import",
    })));
    // One state, four disclosures. The leading finding, the benchmark card, the
    // recommendation evidence and the quantified impact are composed together,
    // from this analysis and the two decisions above it, so a change to an
    // imported department or to the ranked recommendation cannot move one of
    // them without moving the rest.
    const disclosures = guidedDisclosures(importedAnalysisState({
      analysis: next,
      source: example ? DISCLOSURE_SOURCE.example : DISCLOSURE_SOURCE.import,
      plausible: resultPlausible,
      attributionWithheld,
      attributedShare: attributedFraction,
      files: example ? [] : importProvenance()?.files ?? [],
    }));
    const guided = disclosures.guided;
    // Below the floor — or outside the display range — the figure itself is
    // withheld. A dollar amount with a caveat under it is the same unsupported
    // claim with an asterisk on it. Painted once, from the one decision the
    // adapter made, rather than written and then overwritten.
    setText("local-recoverable", guided.savings.value);
    const impactFigure = document.getElementById("local-recoverable");
    if (impactFigure) impactFigure.dataset.real = String(guided.savings.real);
    // The briefing is the adapter's, selected through the same briefing contract
    // as before. The page no longer builds one of its own beside the other three
    // disclosures — that was how the leading finding drifted from them.
    currentBriefing = guided.finding.briefing;
    // Example data remains ephemeral even when retention is enabled: retaining
    // it would make a later real import appear to have a historical baseline.
    // For a reader's own import, the workspace adapter checks consent and
    // projects only allowlisted aggregates. A refusal is intentionally silent
    // here—the analysis remains usable and the workspace surface is the single
    // place that reports what this browser retained.
    if (!example) {
      retainDerivedPeriod(browserFinopsWorkspaceStorage(), {
        briefing: currentBriefing,
        analysis: next,
        dataset: "user",
      });
      // Read straight back, so the restored region reflects the write that just
      // happened rather than the state this tab loaded with.
      syncWorkspaceRestore();
    }
    // The derivation is taken from the same payload the export button writes, so
    // the arithmetic a director checks on screen is byte-for-byte the arithmetic
    // in the file they were sent. `buildBriefing` refuses to build a payload that
    // would carry forbidden content; if it refuses, the briefing still paints and
    // the check is simply absent rather than half-shown.
    let derivation = null;
    try {
      derivation = briefingDerivation(buildBriefing(next, {
        dataset: exampleActive ? "example" : "user",
        attributionWithheld,
      }));
    } catch {
      derivation = null;
    }
    applyBriefing(document, currentBriefing, derivation);
    // A restored briefing on screen gains — or loses — its delta line the
    // moment the live analysis changes underneath it. Repainting here is what
    // stops a delta from outliving the analysis it was computed against.
    syncRestored();
    setText("local-department", guided.savings.department);
    // A withheld figure cannot carry the analysis's own confidence word beside
    // it: the attribution policy has already decided the number is not shown, so
    // the label says withheld rather than contradicting the slot next to it.
    setText("local-confidence-label", attribution?.confidence === CONFIDENCE.SUPPRESSED
      ? "Withheld confidence"
      : `${resultPlausible ? next.confidence : "Withheld"} confidence`);
    // The recommendation is the one the savings figure sizes, so both are read
    // off the same disclosure: an action that outlives a withheld figure is a
    // next step for a number the page just refused to print.
    setText("local-action", guided.savings.action);
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
    // The benchmark card is the analysis's own cohort, or the analysis's own
    // reason for having none. It used to be two constants written over whatever
    // the envelope said, so an import that did establish an intra-tenant cohort
    // was told it had none.
    const benchmarkState = document.getElementById("local-benchmark-state");
    if (benchmarkState) {
      benchmarkState.dataset.state = guided.benchmark.available ? "available" : "unavailable";
      benchmarkState.dataset.source = guided.benchmark.provenance.source;
    }
    // The shape is the non-colour channel this card was missing: it shipped as a
    // hard-coded mark that read "unavailable" over a cohort that was available,
    // so the one signal a greyscale reader had was the wrong one. ● / ○ is the
    // filled-versus-empty circle ramp every status chip on this page now uses —
    // the diamonds it used to draw belong to provenance — and the answer line
    // beside it says the state in words either way.
    setText("local-benchmark-shape", guided.benchmark.available ? "●" : "○");
    setText("local-benchmark-answer", guided.benchmark.answer);
    setText("local-benchmark-summary", guided.benchmark.summary);
    setText("local-benchmark-why", guided.benchmark.why);
    fillTextList("local-periods", trend.periods.map((period) =>
      `${period.period} · ${period.spendUsd.toFixed(2)} USD observed · `
      + `${period.recoverableUsd.toFixed(2)} USD scenario · ${period.completeness} export · ${period.exportId}`),
    "No provider periods available.");
    renderDepartments(next);
    fillTextList("local-assumptions", next.assumptions, "No mapping assumptions.");
    fillTextList("local-warnings", next.warnings, "No declared data-quality warnings.");
    fillTextList("local-limits", next.limits, "No declared limits.");
    // The evidence list names the same department the savings figure is on,
    // because both are read off the one disclosure state rather than off the
    // envelope twice.
    fillTextList("local-evidence", guided.evidence.items, guided.evidence.emptyText);
    // …and every one of those five controls now says what is behind it before it
    // is pressed. The counts are the lengths just painted, not a second read of
    // the envelope, so a summary cannot claim a row the list does not hold.
    applySupportingDisclosures(document, {
      periods: trend.periods.length,
      assumptions: next.assumptions.length,
      warnings: next.warnings.length,
      limits: next.limits.length,
      evidence: guided.evidence.items.length,
    });
    resultsNode.hidden = false;
    clear.hidden = false;
    clear.textContent = example
      ? "Clear the Bundled synthetic example"
      : "Return to the Bundled synthetic example";
    applyFieldDiagnostic(document, null);
    announce("ready", example
      ? `Example finding ready · ${basis.label}.`
      : `Local analysis ready · ${basis.label}.`,
      `${basis.detail} ${example
        ? "Analyze your own exports, or clear the Bundled synthetic example, at any time."
        : "The Bundled synthetic example is replaced until refresh or “Return to the Bundled synthetic example.”"}`);
    // Focus lands on THE ANSWER, which is the thing that just changed. It used
    // to land on the decision brief's own heading, most of a page below — so a
    // keyboard or screen-reader user who imported an export to change the
    // answer was moved past the answer to the evidence for it, and had to
    // shift-tab back up to read what they came for. The region already ships
    // `tabindex="-1"`, is labelled by the question and described by the claim
    // sentence, and is never added to the tab order. The stage still advances;
    // it just does not take the focus with it.
    syncStage({ hasResult: true });
    document.getElementById("finops-stand")?.focus?.({ preventScroll: true });
    void paintModelOverspend(example).then(syncPanels);
    const graded = paintGradedSample();
    // The reader's own grade, confidence, record count, KPI figures and query
    // mix, written into the executive slots before the contract decides which of
    // them may be read. The example path is left alone: it is the bundled seed's
    // own analysis and `repaintBundledAnalysis` already owns those slots.
    // …and on the example path the reader's own slots are handed back first.
    // The bundled painter owns the four KPI values and the peer percentile among
    // them, but it never wrote the qualifiers beside that percentile — the
    // comparability, the comparator segment, the cohort version and the one
    // prioritized action are only ever an import's. Without this, a visitor who
    // imported and then opened the example dataset read the bundled seed's rank
    // under their own cohort's snapshot.
    if (example) clearImportedExecutive(document);
    else {
      // Retained so a correction can redraw these slots from the same inputs
      // rather than from a second, differently-argued call.
      lastFigureSync = {
        analysis: next,
        plausible: resultPlausible,
        withheld: attributionWithheld,
        gradedMix: graded?.state === "graded",
      };
      syncImportedFigures(lastFigureSync);
    }
    // The review panel follows the corpus it corrects. On the example path
    // `classifiedSamples()` is empty, so this takes the panel off the page.
    syncQueryReview();
    // After the graded view, and after every slot above it: the panels a leader
    // may read are decided once, from the contract, out of what this import
    // actually contains. Nothing before this line hides an executive panel.
    syncPanels();
    // Last, so the four panels are labelled from the result that is actually on
    // screen. Focus is not taken here: `focusStageHeading` above already moved
    // it to the brief's own heading, and two moves for one import is one too
    // many.
    paintPanelProvenance();
  };
  // Fetched once and reused, like the evaluation fixtures above it. It is also
  // the fact the contract reads for this panel: held means the bundled finding
  // is on hand, null means the per-model question has no rows behind it and the
  // panel says which two fields would supply them.
  let overspendFinding = null;
  const paintModelOverspend = async (example) => {
    if (!example) {
      // A leader's own import carries neither `usage.model_raw` nor
      // `usage.request_count` on this path, so the panel has nothing to draw.
      // It is not hidden: the contract leaves it on the page and names the two
      // fields that would fill it. Their org-unit labels are untouched — those
      // are cleared only by the reset control.
      overspendFinding = null;
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
      // A fixture that cannot be read is an input this page does not have, so
      // it is counted as absent and the contract writes the sentence. An empty
      // panel is not a sentence.
      overspendFinding = null;
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
    archives.length = 0;
    // The detected-columns summary is a statement about a file that no longer
    // exists here, so it goes with it rather than captioning the next import.
    applyCorpusStructure(document, null);
    // The drill-down goes back to the bundled sample with everything else. A
    // graded unit outliving the file it was graded from is the same mislabelling
    // the clear exists to prevent, in the other direction.
    paintImportedDecisionSurface(null);
    // Including the bundled example's own reading: the button that opened it is
    // still there, and a decision block outliving the clear would be answered
    // about a sample the reader can no longer see the source of.
    paintCoachingDecision(null);
    // The delivery history goes with the files it came in as, sequence included:
    // a reader who starts over is owed a tab that has read no release evidence,
    // and a retained high-water mark would make the very same file a replay.
    importedDeliveryHistory = null;
    selectedDeliveryHistoryText = null;
    clearDeliveryHistory(document);
    // And the delivery comparison, for the same reason: its window came from the
    // analysis being discarded, and a ratio with no visible source is exactly the
    // figure this section exists to avoid publishing.
    paintSpendPerDelivery(null);
    closeMappingReview(document);
    if (remap) remap.hidden = true;
    result = null;
    // The corrections go with the file they were corrections about. A label
    // outliving its corpus would attach a human's judgement to a row that is no
    // longer loaded, which is the mislabelling this whole seam exists to end.
    revertToClassifier(queryLabelOverrides);
    lastFigureSync = null;
    syncQueryReview();
    clearCurrentReviewEvidence(browserFinopsWorkspaceStorage());
    // The snapshot references the evidence cleared on the line above. Leaving it
    // behind would only make the next journey view read a stale snapshot and say
    // so; discarding it with its referents keeps the clear total.
    clearJourneySnapshot(browserFinopsWorkspaceStorage());
    currentBriefing = null;
    exampleActive = false;
    // The reader's own coverage figure goes with the reader's own analysis. A
    // verdict outliving the import it was measured from is the mislabelling the
    // clear exists to prevent, in the other direction.
    lastVerdict = null;
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
    // The ranked position goes with the files it was declared in. A cohort
    // placement outliving the import is a claim about an export that is no
    // longer loaded, and `imports` has just been emptied, so there is nothing
    // left to derive one from either.
    applyCohortAttribution(document, null);
    // And the headline goes back to the bundled example with it. A cleared
    // import must not leave a withheld-position path on screen for a file that
    // is no longer loaded. The state restores the synthetic answer — marker
    // included — and every slot painted below comes from that one restore.
    answerState.clearImport();
    applyStandHeadline(document, answerState.getHeadline());
    input.value = "";
    resultsNode.hidden = true;
    clear.hidden = true;
    clear.textContent = "Return to the Bundled synthetic example";
    attributedShare = 0;
    attributedFraction = null;
    setMode("example", "Bundled synthetic example");
    applyFieldDiagnostic(document, null);
    // Nothing survives the clear: the example result, its provenance labels, and
    // the finding are all discarded together. Nothing was ever written to
    // storage or the URL, so a reload is already a fresh visit.
    applyDatasetProvenance(document, false);
    // The supporting rail hands its counts back too. Passing nothing repaints
    // every summary as "not analyzed", which is the truth after a clear — a
    // stale "12 warnings" over an emptied list is a count for a file that is no
    // longer loaded, and a "0" would be a claim nothing has measured.
    applySupportingDisclosures(document, {});
    // The coverage list belongs to one import. Leaving it painted through a
    // clear would name providers for a total that is no longer on screen.
    applyProviderCoverage(document, null);
    // Same rule for the portfolio brief, one step earlier in the reading order:
    // clearing the import gives the single-provider answer back rather than
    // leaving a combined total leading the page.
    clearPortfolioBrief(document);
    const trust = document.getElementById("local-trust");
    if (trust) {
      trust.hidden = true;
      trust.dataset.state = "empty";
    }
    const lead = document.getElementById("local-lead-finding");
    if (lead) {
      // The briefing returns to its empty state first — the one that says what
      // will appear here and how to make it appear — and only then goes off
      // screen, so nothing but a husk is ever left behind it.
      applyBriefingState(document, "empty");
      for (const id of ["local-lead-question", "local-lead-metric", "local-lead-coverage", "local-lead-action"])
        setText(id, "—");
      lead.hidden = true;
    }
    // The one reset. The per-model panel goes with everything else, and so do
    // the org-unit labels this browser was holding — they are the only thing on
    // this page that outlives a reload, so "start over" has to include them.
    clearModelOverspendFinding(document, { storage: labelStorage() });
    // The graded panels hand their slots back with everything else, so the
    // example badge, the example mix and the bundled KPI figures are exactly
    // what a visitor who imports nothing has always seen.
    clearGradedSample(document);
    // The executive slots hand their caption and their per-card markers back
    // before the bundled analysis repaints the numbers into them, so nothing of
    // the reader's own import outlives the clear.
    clearImportedExecutive(document);
    // All four panels together, from the model with no import in it. A reload
    // produces exactly this, because nothing here was ever written down.
    clearFinopsProvenance(document);
    // The finding about the reader's own evidence goes with the evidence. There
    // is no bundled fallback for it on purpose: a visitor who imported nothing
    // has no partial evidence, and a synthetic answer to "what do my exports
    // support" would be the one claim this region exists to refuse.
    clearPartialEvidence(document);
    repaintBundledAnalysis();
    // The bundled seed answers for the panels again, so they are re-decided from
    // it rather than restored by a flag. A visitor who imports nothing and a
    // visitor who imported and cleared see the same page because they are
    // reading the same fact record.
    syncPanels();
    showMetricBasis({ mode: "example" });
    // The authored hero sentence, from the module that owns it, so a reader who
    // clears an import lands back on the words the page shipped with.
    setText("finops-intro", HERO_INTRO);
    announce("ready", wasExample
      ? "Bundled synthetic example cleared."
      : "Returned to the Bundled synthetic example.",
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
    // The delivery comparison says so in its own words, beside its own question:
    // a reader looking at "is spend keeping pace?" has to know the file that
    // would have answered it was rejected, without scrolling back to the notice.
    spendPerDeliveryPhase(SPEND_PER_DELIVERY_PHASE.error,
      `${diagnostic.recovery} No reading here was replaced.`);
    syncStage();
    announce("error", "This file was not analyzed.",
      `${diagnostic.text} ${diagnostic.recovery} Existing analysis was not replaced.`);
    // A rejection does not repaint the answer, so it does not reach the answer
    // region's own announcer — this is the one path that has to speak for
    // itself. One sentence: what went wrong, what to do about it, and the fact
    // that the answer they were reading is still the answer on screen. Focus
    // stays on the picker below, which is a control they can act from and is
    // not about to be removed.
    announceAnswer(document, importFailureAnnouncement(diagnostic));
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
    const reading = readDelimitedText(file.text, boundedDelimitedOptions());
    if (!reading.ok) {
      failFile({ code: reading.problem.code, message: reading.problem.code }, file);
      return false;
    }
    review = {
      file,
      entry,
      // The file's own data rows, header-keyed, kept for the cohort projection
      // on confirm. This is the one reading of the bytes: the projection below
      // allowlists them down to a department key and the two declared cohort
      // attributes before anything else on this page can see them.
      reading,
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

  /**
   * One delimited reading, as header-keyed row objects.
   *
   * The header names are the file's own, unchanged, because the cohort contract
   * resolves a column by normalizing its name rather than by position: a
   * re-ordered export declares the same attributes.
   */
  const rowObjects = (reading) => (reading?.rows ?? []).map((row) => Object.fromEntries(
    (reading.header ?? []).map((name, index) => [name, row.values?.[index] ?? ""])));

  /**
   * Every cohort source in this selection, derived rather than accumulated.
   *
   * Derived from `imports` for the same reason `rebuildLoaded` is: a re-mapped
   * file replaces its own earlier projection instead of merging with it, and a
   * cleared import takes its projection with it. A standing array here could
   * carry a previous selection's rows — and, because the merge is first-wins,
   * its declaration too — into the next analysis.
   */
  const cohortSources = () => imports.map((entry) => entry.cohortSource).filter(Boolean);

  /**
   * Paint the ranked-position panel for whatever is loaded right now.
   *
   * `asOf` is the analysed period's own end when there is one, never a clock
   * read: an eligibility answer has to be reproducible from the same files.
   */
  const syncCohortPosition = (analysis = null) => {
    const eligibility = exampleActive || !cohortSources().length
      ? null
      : validateCohortAttribution({
        ...mergeCohortSources(cohortSources()),
        asOf: spendWindowFromPeriod(analysis?.period)?.end ?? null,
      });
    applyCohortAttribution(document, eligibility);
    // The headline follows the file the reader is actually looking at. One
    // eligibility decision feeds both surfaces, so the panel below and the
    // headline above can never disagree about whether this import may be
    // placed — and when it may not, the headline carries that contract's own
    // sentence and its own next step rather than a second opinion.
    // …and the answer state decides the source once. A rejected export is a
    // no-op on it: the answer already on screen stays exactly as it was, and
    // the reason is announced through the affordance every other file defect
    // uses rather than a second, cleverer one.
    if (!eligibility) {
      answerState.clearImport();
    } else {
      const outcome = answerState.setImport({ analysis, eligibility });
      if (!outcome.committed) {
        announce("error", "This export did not replace the answer on screen.", outcome.message);
      }
    }
    applyStandHeadline(document, answerState.getHeadline());
    return eligibility;
  };

  const confirmReview = async () => {
    const binding = mappingBinding(review?.state);
    // The confirm control is disabled while a blocker stands; this is the second
    // lock, so a stale click can never reach the parser with a half-mapping.
    if (!binding) return;
    const { file, entry, state, reading } = review;
    let parsed;
    try {
      // The reviewed mapping runs across the offload seam. The thunk below is
      // the shipped synchronous call, unchanged, and it is what runs when the
      // browser has no module worker.
      const options = boundedDelimitedOptions({ mapping: binding });
      parsed = await runImport(file, options,
        () => parseLocalImportFile(file.text, file.fileName, file.mediaType, options));
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
    // The cohort projection travels on the entry, so re-mapping this file
    // replaces it rather than adding a second reading of the same bytes.
    stored.cohortSource = projectCohortSource({ objects: rowObjects(reading) });
    if (!entry) imports.push(stored);
    closeReview();
    await processQueue();
  };

  /**
   * The reader's own query samples, graded per organization unit.
   *
   * One parse, reused: `orgQuerySampleResult` adapts what `processQueue` already
   * read, so nothing is parsed twice and no caller has to supply a grouping unit
   * this surface does not have. A file whose dialect no declared source reads
   * yields null and is filtered out rather than guessed at.
   */
  const importedOrgResults = () => ((samples.length || archives.length) && !exampleActive
    ? [
      ...samples.map((entry) => orgQuerySampleResult(entry.parsed)),
      ...archives.map((entry) => entry.result),
    ].filter(Boolean)
    : []);
  const importedOrgLiteracy = () => {
    const results = importedOrgResults();
    return results.length ? orgQueryDepartmentLiteracy({ results }) : null;
  };

  /**
   * The coaching decision from a local sample, or the surface handed back.
   *
   * Two callers, one paint: the import path passes the reader's own literacy, the
   * example button passes the bundled sample's, and the `origin` it carries is
   * what every provenance line and the announcement are labelled from. Null hands
   * the section back to the example surface rather than leaving a stale answer
   * about a file that is no longer loaded.
   */
  /**
   * The lead's own labels for the unclassified clusters, by cluster key.
   *
   * A plain Map in this closure, which is the same place the parsed samples,
   * the archives and the mapping choices already live: in memory, in this tab,
   * for the session. `reset()` empties it with the files it belongs to, and a
   * different corpus empties it too, because a label is a statement about the
   * corpus it was made on.
   *
   * What outlives the tab is a digest of each key in it and the class chosen —
   * see `/query-override-store.js` for the whole artifact. The map here is still
   * the only thing the arithmetic reads: storage restores into it, never past it.
   */
  const leadResidueLabels = new Map();
  /** The last coaching input, so a label can re-run the same paint it came from. */
  let lastCoachingInput = null;
  /**
   * What this browser refused, per corpus. Two flags rather than one sentence:
   * a browser that reads but will not write, and one that writes but will not
   * read back, both leave the reader with corrections that do not survive a
   * reload, and a successful write must not clear a notice the failed read
   * earned. Re-probed when the corpus changes.
   */
  const residueStorageRefusals = { read: false, write: false };
  const residueStorageNotice = () =>
    (residueStorageRefusals.read || residueStorageRefusals.write
      ? OVERRIDE_UNAVAILABLE_NOTICE : null);
  /** One-shot: the clear control's result, spoken by the region that recomputed. */
  let residueClearAnnouncement = null;

  const paintCoachingDecision = (literacy,
    { origin = "import", fileNames = [], records = [] } = {}) => {
    if (!literacy) {
      lastCoachingInput = null;
      leadResidueLabels.clear();
      residueClearAnnouncement = null;
      return clearOrgQueryDecision(document);
    }
    // A label is a statement about one corpus. The moment the corpus changes —
    // a different file, a different set of files, the bundled example — the
    // labels go, so no figure is ever assisted by an answer given about an
    // export that is no longer loaded.
    const corpus = `${origin}::${fileNames.join("|")}::${records.length}`;
    const changed = lastCoachingInput?.corpus !== corpus;
    if (changed) {
      leadResidueLabels.clear();
      residueClearAnnouncement = null;
      residueStorageRefusals.read = false;
      residueStorageRefusals.write = false;
    }
    lastCoachingInput = { literacy, origin, fileNames, records, corpus };
    // A new corpus asks this browser whether it is holding labels for THIS one.
    // Asynchronous because the digest is: the paint below happens now, with no
    // labels, and a restore repaints on top of it if any matched. Nothing here
    // rejects, so a refusing store cannot escape as an unhandled rejection.
    if (changed) restoreResidueLabels(corpus, records);
    // The review runs the same aggregation the coverage line already reads —
    // `familyCoverage` — once on the records as imported and once with the
    // lead's labels written in, so there is still exactly one definition of
    // coverage on this page. With no label set the two are the same object and
    // the surface is exactly what it was.
    const review = records.length
      ? residueReview(records, leadResidueLabels) : null;
    return applyOrgQueryDecision(document, orgQueryCoachingDecision(literacy, {
      origin,
      fileNames,
      // The same records the literacy model was built from, classified a
      // second way: on the five structural signal families rather than on
      // English keywords alone. That is what decides the coverage number and
      // the residue clusters this surface now leads with. In memory, in this
      // tab, and nothing derived from an excerpt comes back out.
      familyCoverage: review ? review.assisted : (records.length ? familyCoverage(records) : null),
    }), {
      review,
      onAssign: assignResidueLabel,
      // What this browser keeps, said in the panel the labels are made in, with
      // the one control that empties it. The strings are the store's own, so the
      // claim on screen and the bytes under the key are written down once.
      retention: {
        text: OVERRIDE_RETENTION_TEXT,
        notice: residueStorageNotice(),
        clearLabel: OVERRIDE_CLEAR_LABEL,
        announcement: residueClearAnnouncement,
        onClear: clearResidueLabels,
      },
    });
  };

  /**
   * One cluster labelled, and the whole decision recomposed from it.
   *
   * The label is validated against the published choices before it is kept: the
   * control offers exactly those, and a value from anywhere else is dropped
   * rather than carried into the arithmetic.
   */
  function assignResidueLabel(clusterKey, value) {
    if (!lastCoachingInput || typeof clusterKey !== "string" || !clusterKey) return;
    if (isResidueLabel(value)) leadResidueLabels.set(clusterKey, value);
    else leadResidueLabels.delete(clusterKey);
    // The figures move now; the write happens after, and its only visible effect
    // is the notice a refusal turns on. A correction that cannot be stored is
    // still a correction.
    residueClearAnnouncement = null;
    paintCoachingDecision(lastCoachingInput.literacy, lastCoachingInput);
    persistResidueLabels(lastCoachingInput.corpus);
  }

  /**
   * The digest of the corpus on screen, and of every cluster key in it.
   *
   * One helper for both directions, so the string a label is filed under on the
   * way out is the string it is looked up by on the way back — including which
   * hash mode produced it. `hashText` never rejects.
   */
  async function residueDigests(corpus, keys) {
    const fingerprint = await hashText(corpus);
    const pairs = await Promise.all([...keys].map(async (key) => [key, (await hashText(key)).hex]));
    return { fingerprint, pairs };
  }

  /** The labels this browser holds for this corpus, if it is holding any. */
  function restoreResidueLabels(corpus, records) {
    const clusters = new Set((Array.isArray(records) ? records : []).map(residueClusterKey));
    return residueDigests(corpus, clusters).then(({ fingerprint, pairs }) => {
      // The reader may have moved on — discarded the files, read another export
      // — while the digest was computing. Their corpus wins over this answer.
      if (lastCoachingInput?.corpus !== corpus) return;
      const stored = readOverrides(browserQueryOverrideStorage(), {
        fingerprint: fingerprint.hex, mode: fingerprint.mode,
      });
      residueStorageRefusals.read = !stored.available;
      let applied = 0;
      for (const [key, digest] of pairs) {
        const label = stored.entries.get(digest);
        // A label the reader has already given in this tab is not overwritten by
        // a stored one, and a digest that names no cluster in this corpus is
        // simply not found — never matched to the nearest thing.
        if (leadResidueLabels.has(key) || !isResidueLabel(label)) continue;
        leadResidueLabels.set(key, label);
        applied += 1;
      }
      if (applied || residueStorageRefusals.read) {
        paintCoachingDecision(lastCoachingInput.literacy, lastCoachingInput);
      }
    }).catch(() => {
      // Nothing above throws by design. If something does, the page keeps the
      // reading it already painted rather than losing it to a storage feature.
      residueStorageRefusals.read = true;
    });
  }

  /** Every label now held, written under this corpus's fingerprint. */
  function persistResidueLabels(corpus) {
    return residueDigests(corpus, leadResidueLabels.keys()).then(({ fingerprint, pairs }) => {
      if (lastCoachingInput?.corpus !== corpus) return;
      const outcome = writeOverrides(browserQueryOverrideStorage(), {
        fingerprint: fingerprint.hex,
        mode: fingerprint.mode,
        entries: pairs.map(([key, digest]) => [digest, leadResidueLabels.get(key)]),
      });
      const before = residueStorageNotice();
      residueStorageRefusals.write = !outcome.ok;
      if (residueStorageNotice() === before) return;
      paintCoachingDecision(lastCoachingInput.literacy, lastCoachingInput);
    }).catch(() => {
      residueStorageRefusals.write = true;
    });
  }

  /**
   * The lead's own erase. The only destructive path in this feature: a corpus
   * that does not match its fingerprint is ignored, never deleted, because the
   * reader may go back to the export it belongs to.
   */
  function clearResidueLabels() {
    if (!lastCoachingInput) return;
    leadResidueLabels.clear();
    const outcome = clearOverrides(browserQueryOverrideStorage());
    residueStorageRefusals.write = !outcome.ok;
    residueClearAnnouncement = OVERRIDE_CLEARED_ANNOUNCEMENT;
    paintCoachingDecision(lastCoachingInput.literacy, lastCoachingInput);
  }

  const finishSelection = (total) => {
    rebuildLoaded();
    // Before either branch below, because it holds in both: a gradeable query
    // sample grades the drill-down whether or not a billing export came with it.
    // An invoice with no supported query source leaves it exactly as it was.
    const literacy = importedOrgLiteracy();
    paintImportedDecisionSurface(literacy);
    // The same model, read as a decision rather than as a priority list. This one
    // takes the ungradeable model too: "no department has enough classified
    // queries yet" is the answer a reader has to act on, and the drill-down above
    // is right to publish no letters for it.
    paintCoachingDecision(literacy, {
      origin: "import",
      fileNames: [...samples, ...archives].map((entry) => entry.fileName),
      records: importedOrgResults().flatMap((entry) => entry.records ?? []),
    });
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
      // A selection that cannot be analyzed can still have declared its cohort
      // attributes, and a reader owed "your export declares an industry we do
      // not publish" should not have to fix the mapping first to be told.
      syncCohortPosition(null);
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
      // A query sample with no invoice beside it still grades: the hero says so,
      // and the two money cards say plainly that no provider export was
      // selected rather than keeping the bundled sample's totals.
      if (samples.length) {
        lastFigureSync = { gradedMix: graded?.state === "graded" };
        syncImportedFigures(lastFigureSync);
      }
      // A query sample with no invoice beside it is exactly the withheld verdict
      // this panel exists to move, so it is painted on this branch too.
      syncQueryReview();
      announce("ready", `${total} compatible file${total === 1 ? "" : "s"} ready.`,
        graded?.message
          ? `${graded.message.label}. ${graded.nextAction.text}`
          : `${eligibility.reason} Example analysis remains visible.`);
      return;
    }
    renderResult(normalizeLocalFinopsHistory({
      providers: loaded.providers,
      hris: loaded.hris ?? null,
      // The same denominator the spend-per-delivery panel divides by, under the
      // same precedence: an accepted delivery-history file is authoritative and
      // replaces this browser's release log rather than being merged with it, so
      // the portfolio's delivery efficiency and the panel's ratio can never be
      // counting different releases.
      deliveries: portfolioDeliveries(),
    }));
  };

  /**
   * The billing period a delivery history will be divided into, if one has been
   * analyzed in this tab yet. It is the analysis's own window string, parsed
   * rather than re-derived, so the pair the contract compares is the pair on
   * screen. Null before any provider export has been read, and the contract
   * treats that as "no compatibility claim to make" rather than as a mismatch.
   */
  const currentSpendWindow = () => {
    return spendWindowFromPeriod(result?.period);
  };

  /**
   * Read one delivery-history file and paint what it turned out to be.
   *
   * The three outcomes are all rendered — accepted, accepted-as-a-floor, and not
   * read — and only a usable one is retained. `asOf` is the analysed period's own
   * end rather than a clock read: freshness has to be reproducible, and a
   * delivery export generated long before the period being analyzed is exactly
   * what the staleness target is for.
   */
  const readDeliveryHistory = (text) => {
    selectedDeliveryHistoryText = text;
    const window = currentSpendWindow();
    const outcome = parseDeliveryHistory(text, {
      asOf: window ? `${window.end}T00:00:00Z` : null,
      spendWindow: window,
    });
    applyDeliveryHistory(document, outcome);
    // A refused replacement must not leave an older accepted history silently
    // active under a "Not read" verdict.
    importedDeliveryHistory = outcome.usable ? outcome : null;
    // A repaint of whatever reading is already on screen, so an added file
    // changes the ratio in place instead of waiting for the next import.
    if (result) paintSpendPerDelivery(result, { example: exampleActive });
    return outcome;
  };

  const processQueue = async () => {
    let total = imports.length + queue.length;
    while (queue.length) {
      const file = queue.shift();
      total = file.total;
      // Before anything is graded on a file, say which structural columns it
      // actually carries. Pure and in memory: it reads the same text the
      // parsers below read, retains no cell of it, and needs no credential.
      // It paints only when a supported assistant-export dialect matched from
      // the header row, so a provider billing export is not captioned with a
      // summary about turn ordering it was never going to have; a file that
      // matched nothing says so in its own result and leaves the region alone.
      const structure = parseCorpusStructure(file.text);
      if (structure.status === "matched") applyCorpusStructure(document, structure);
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
      // The third declared source, read the same way: from the file's own
      // header, never from its name. A conversation dialect matches only on the
      // identifier columns it declares, and a provider export or roster carries
      // none of them, so this asks and moves on rather than claiming a file the
      // mapping step below was going to read. Its records reach the
      // organizational literacy path and nothing else.
      const archive = validateOrgQuerySource(file.text,
        { sourceId: "local-conversation-archive", fileName: file.fileName });
      if (archive.ok) {
        archives.push({ fileName: file.fileName, result: archive });
        continue;
      }
      // The fourth declared source: a Shiplog delivery history, claimed from its
      // own `kind` rather than its name. A file that claims this contract is
      // reported against this contract even when it fails it — an unsupported
      // version or a malformed record has to reach the reader as "this delivery
      // history was not read, and here is why", not as an unrecognized file. It
      // is optional evidence, so a refusal states itself in its own region and
      // leaves the rest of the selection to be analyzed.
      if (claimsDeliveryHistory(file.text)) {
        readDeliveryHistory(file.text);
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

  // The disclosure and the one revert control, bound once. Both are operable
  // before any file is read; the button stays hidden until there is a sample to
  // review, so a visitor on the bundled example never meets either.
  bindQueryReview(document, { onRevert: revertQueryLabels, onLeave: announceReviewPass });

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
    spendPerDeliveryPhase(SPEND_PER_DELIVERY_PHASE.loading);
    try {
      const selectionProblem = checkFileSelectionCeiling(files);
      if (selectionProblem) {
        failFile(selectionProblem, { ordinal: 1, total: 1 });
        return;
      }
      // The size ceiling is checked from `File.size`, before a byte is decoded
      // and before a worker exists. An oversized file costs one comparison and
      // yields one message; nothing partial is ever built from it.
      const chosen = files.map((file, index) => ({
        file, fileName: safeDisplayFileName(file.name), mediaType: file.type, byteSize: file.size,
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
      // A path that ended without painting a reading — a cancelled import, a
      // file that carried no provider period — must not leave "reading…" on a
      // panel that has stopped reading.
      endSpendPerDeliveryLoading();
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
      spendPerDeliveryPhase(SPEND_PER_DELIVERY_PHASE.error,
        "The Bundled synthetic example could not be analyzed, so no ratio was derived from it."
        + " Your own provider export is still the way to answer this question.");
      announce("error", "The Bundled synthetic example could not be analyzed.",
        `${diagnostic.text} No analysis is shown.`);
    }
  });
  // Both recoveries live at the control. "Choose files again" reopens the same
  // picker and keeps what already loaded; "Discard all files and results" drops
  // everything accepted so a half-loaded pair cannot silently outlive the error
  // that interrupted it. The note beside them says which is which.
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
  // The same contract, read rather than downloaded. One click grades the bundled
  // synthetic organizational sample through `parseQuerySample`, the registry
  // adapter and the scorer — the identical path a chosen file takes — so the
  // coaching decision is reachable with no file, no network and no fixture
  // fetch. Only this section is painted: the ranked department list above belongs
  // to the bundled *billing* seed, and replacing it from a different example
  // would put two unrelated synthetic organizations in one comparison. Every
  // line it paints is labelled as the example it is.
  document.getElementById("grade-example-org-query-sample")?.addEventListener("click", () => {
    const parsed = loadExampleOrgQuerySample();
    const sample = orgQuerySampleResult(parsed);
    if (!sample) {
      // Unreachable while the bundled example matches the contract. If the
      // contract moves under it, say so rather than showing a stale surface.
      paintCoachingDecision(null);
      announce("error", "The bundled example query sample could not be read.",
        "No grade is shown. The published query-sample contract no longer accepts it.");
      return;
    }
    paintCoachingDecision(orgQueryDepartmentLiteracy({ results: [sample] }), {
      origin: "example",
      fileNames: [EXAMPLE_ORG_QUERY_SAMPLE_FILE.fileName],
      records: sample.records ?? [],
    });
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
      `It is shown read-only below the current briefing and observes ${outcome.saved.period.label}. `
      + "It was read in this tab, nothing was uploaded, and nothing on this page was replaced.");
    document.getElementById("restored-briefing-title")?.focus?.({ preventScroll: true });
  });
  document.getElementById("restored-briefing-close")?.addEventListener("click", () => {
    restored = null;
    applyRestoreRejection(document, null);
    syncRestored();
    announce("ready", "Reopened briefing closed.",
      "The reopened file was discarded. Nothing about the current briefing changed.");
    reopenInput?.focus?.({ preventScroll: true });
  });

  // Cold load: draw the first stage and the unresolved requirements before any
  // interaction, so the idle surface is a state rather than a blank.
  applyFieldDiagnostic(document, null);
  applyDatasetProvenance(document, false);
  // What an earlier visit left in this browser, before anything is imported. It
  // is the whole point of the opt-in store: a returning visitor reads their last
  // derived period without re-uploading the export it came from.
  syncWorkspaceRestore();
  // The enforced ceilings, painted from the one place they are defined.
  applyImportLimits(document);
  // Where the export comes from, painted from the versioned package contract.
  applyExportPackageGuidance(document);
  // Which local query sources may stand beside it, painted from the versioned
  // source registry. Changing the chooser repaints the compatibility sentence
  // and the guidance rows and does nothing else: no file is selected, nothing
  // is read, and the provider-export path above is untouched by it.
  applyOrgQuerySources(document);
  document.getElementById("org-query-source-select")?.addEventListener("change", (event) => {
    applyOrgQuerySourceStatus(document, event.target?.value ?? null);
  });
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

/**
 * The departments the rubric did not score, largest unscored spend first.
 *
 * The coverage line names them, so the order has to be the order that matters
 * to the reader: the team with the most unscored money is the one whose absence
 * moves the grade most, and it is named before a rounding-error department is.
 */
function ungradedDepartmentNames(departments) {
  return (Array.isArray(departments) ? departments : [])
    .filter((department) => !departmentPerformance(department).available)
    .map((department) => ({
      name: String(department?.name ?? department?.id ?? "").trim(),
      spendUsd: summarize([department]).spendUsd,
    }))
    .filter((entry) => entry.name)
    .sort((left, right) => right.spendUsd - left.spendUsd || left.name.localeCompare(right.name))
    .map((entry) => entry.name);
}

function renderHeadline(organization, totals, eligibility, departments = []) {
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
  // Coverage and the one action are the only words this card gains. The tier
  // label and the action come from the eligibility model, the sentence that
  // names the ungraded departments comes from `briefing-strings.js`, and
  // nothing here writes a sentence of its own.
  setText("score-coverage", sampledCoverageLine({
    coverageText: eligibility.coverage === null
      ? "" : formatPercent(eligibility.coverage, { digits: 1 }),
    label: eligibility.label,
    ungradedNames: ungradedDepartmentNames(departments),
  }));
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
  // "Needs review", like every other KPI value that failed its check — the note
  // beneath it already says the same words, and one vocabulary per state means
  // a reader scanning the four cards never has to ask if two words differ.
  setText("kpi-peer-value", trust.percentile.plausible
    ? `${organization.peerPercentile}th` : KPI_NEEDS_REVIEW);
  // The cohort behind the bundled percentile is published synthetic reference
  // data, and the note says so beside the figure rather than only in a method
  // disclosure a reader has to open. One vocabulary with the imported card,
  // which states the same provenance from the same contract.
  setText("kpi-peer-note", trust.percentile.plausible
    ? `${quartileLabel(organization.peerPercentile)} · ${organization?.peerCohort ?? "peer cohort"}`
      + ` · ${PEER_COHORT_PROVENANCE.label}`
    : "Needs review · percentile must be between 0 and 100");

  // The same five verdicts the words above already carry, in a shape and a
  // second word. A slot that passed its check clears its flag rather than
  // hiding a stale one, so a surface that later only toggles `hidden` cannot
  // reveal last render's verdict.
  const review = (plausible) => (plausible ? null : "needsReview");
  applyBundledMetricFlags({
    // Two different absences, and the flag tells them apart: a score outside
    // 0–100 is a figure that failed its check, while a score the rubric was not
    // allowed to publish is a figure nobody measured.
    score: trust.score.plausible ? (gradeVisible ? null : "unmeasured") : "needsReview",
    spend: review(trust.spend.plausible),
    recoverable: review(trust.recoverable.plausible),
    highValue: review(trust.highValue.plausible),
    percentile: review(trust.percentile.plausible),
  });
}

/**
 * The four-slice mix, for the bundled seed and for a reader's own import alike.
 *
 * `captionFor` is the one thing the two sources disagree about. The bundled seed
 * publishes a share of SPEND, so each slice is captioned in dollars. A query
 * sample carries no per-query cost, so an imported mix is a share of QUERIES and
 * is captioned in records — printing dollars over it would be a number nobody
 * measured. The basis sentence beside the chart says which one is on screen.
 */
function renderMix(totals, { captionFor = null, basis = null } = {}) {
  const bar = document.getElementById("mix-bar");
  const legend = document.getElementById("mix-legend");
  if (!bar || !legend) return;
  bar.replaceChildren();
  legend.replaceChildren();

  const caption = captionFor
    ?? ((category, share) => `${formatUsd(Math.round(totals.spendUsd * share))} of spend`);
  const summary = [];
  for (const category of QUERY_CATEGORIES) {
    const share = totals.mix[category.key] ?? 0;
    const color = `var(${CATEGORY_VARS[category.key]})`;

    const segment = element("div", "mix-segment");
    segment.style.flexGrow = String(Math.max(share, 0.004));
    segment.style.background = color;
    // Native tooltip: the same numbers are already visible in the legend, so the
    // hover layer is an accelerator rather than the only way to read a segment.
    segment.title = `${category.label} · ${formatPercent(share)} · ${caption(category, share)}`;
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
      element("p", "legend-spend", caption(category, share)),
      element("p", "legend-copy", category.description),
      element("p", "legend-action", category.systemAction));
    legend.append(item);
  }
  setText("mix-summary", basis
    ? `Your scored query mix: ${summary.join(", ")}. ${basis}`
    : `Spend mix: ${summary.join(", ")}.`);
  const basisNode = document.getElementById("mix-basis");
  if (basisNode) {
    basisNode.textContent = basis ?? "";
    basisNode.hidden = !basis;
  }
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
  setText("action-status", ACTION_UNAVAILABLE_FIELD.status);
  setText("action-title", ACTION_UNAVAILABLE_FIELD.title);
  setText("action-rationale", reason);
  setText("action-impact", ACTION_UNAVAILABLE_FIELD.impact);
  setText("action-confidence", ACTION_UNAVAILABLE_FIELD.confidence);
  setText("action-owner", ACTION_UNAVAILABLE_FIELD.owner);
  setText("action-provenance", ACTION_UNAVAILABLE_FIELD.provenance);
  setText("action-baseline", ACTION_UNAVAILABLE_FIELD.baseline);
  setText("action-target", ACTION_UNAVAILABLE_FIELD.target);
  setText("action-estimate", ACTION_UNAVAILABLE_FIELD.estimate);
  setText("action-realized", ACTION_UNAVAILABLE_FIELD.realized);
  setText("action-diagnosis", reason);
}

/**
 * Paint a computed recommendation into the reviewed-intervention surface.
 *
 * Same twelve slots, same order, same labels. What changes is the content: the
 * status says it was computed and not reviewed, the provenance carries the
 * scorer version and the input digest that produced these numbers, and the
 * realized field says plainly that nothing has been simulated. A reader is never
 * left unable to tell a rule's proposal from a reviewed result.
 */
function renderComputedAction(fields) {
  const actionSurface = document.getElementById("action-result");
  if (actionSurface) {
    actionSurface.dataset.status = fields.dataStatus;
    actionSurface.setAttribute("aria-busy", "false");
  }
  setText("action-status", fields.status);
  setText("action-title", fields.title);
  setText("action-rationale", fields.rationale);
  setText("action-impact", fields.impact);
  setText("action-confidence", fields.confidence);
  setText("action-owner", fields.owner);
  setText("action-provenance", fields.provenance);
  setText("action-baseline", fields.baseline);
  setText("action-target", fields.target);
  setText("action-estimate", fields.estimate);
  setText("action-realized", fields.realized);
  setText("action-diagnosis", fields.diagnosis);
}

/**
 * The bundled department as the evidence panel's own input.
 *
 * The panel and the fix pack below it are built from
 * `aggregateConversationLiteracy` rows, which only a conversation export
 * produces. The bundled record carries spend, mix and sampling — and not one
 * classified prompt — so this row carries the department's name and the fact
 * that nothing is classified against it, and nothing else. `gradeable: false`
 * is that fact rather than a placeholder: it is what makes the fix pack publish
 * its withheld reading, in which all three interventions are still named and
 * each says why it is not offered. Assembling a grade out of figures nobody
 * classified would be the one thing this drill-down must never do.
 */
function unclassifiedDepartmentRow(department) {
  return {
    department: department?.name ?? null,
    gradeable: false,
    reasonCode: "department_not_graded",
    prompts: { total: 0, classified: 0, unclassified: 0 },
    coverage: 0,
    confidence: null,
    signals: [],
    subscores: [],
    distribution: [],
    sketches: { signatures: [], signatureCount: 0, retainedShare: 0, truncated: false },
  };
}

function renderDecisionDetail(department, data) {
  const performance = departmentPerformance(department);
  const trend = departmentTrend(department);
  const comparison = benchmarkComparison(department, data.benchmark ?? {});
  const sampling = department.sampling ?? {};
  const provenance = data.provenance ?? {};
  const action = actionPlanFor(department);

  setText("detail-name", department.name ?? "Unnamed department");
  // The drill-down's prompt-literacy half: the evidence behind this
  // department's grade, and the fix pack that rides on the same model so the
  // two can never describe different departments.
  //
  // With a gradeable organizational query sample imported, that row is the
  // reader's own — a real letter, a real mix, a real coaching gap — and the
  // provenance says so. Without one it is the bundled record's, which carries no
  // classified prompt and publishes its withheld reading. There is no third
  // state: a row is one reader's file or it is the bundled sample, never both.
  const importedRow = importedLiteracyRows?.get(department.id) ?? null;
  applyDepartmentEvidence(document, departmentEvidenceModel({
    department: importedRow ?? unclassifiedDepartmentRow(department),
    provenance: importedRow ? EVIDENCE_PROVENANCE.own.kind : EVIDENCE_PROVENANCE.sample.kind,
  }), { storage: browserFinopsWorkspaceStorage() });
  setText("detail-score", performance.available ? `${performance.score}/100` : NOT_GRADED);
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
    // No reviewed intervention for this department. Rather than an empty
    // surface, run the deterministic scorer over the aggregate record the
    // drill-down already holds — it either names one prioritized action with its
    // arithmetic, or names exactly why it will not.
    renderComputedAction(interventionActionFields(scoreDepartmentIntervention(department)));
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
    definitionTerm("Cost", trend.costAvailable
      ? signed(trend.costChangePercent, "%") : NO_COMPARABLE_PERIOD),
    definitionTerm("Performance", trend.performanceAvailable
      ? signed(trend.performanceChangePoints, " points") : NO_COMPARABLE_PERIOD),
    definitionTerm("Periods", trend.period && trend.comparisonPeriod
      ? `${trend.period} vs ${trend.comparisonPeriod} · ${trend.equalLengthDays}-day periods`
      : "Equal-period dates unavailable"),
  );

  setText("benchmark-answer", comparison.available
    ? `${signed(comparison.deltaPoints, " points")} versus the cohort median of ${data.benchmark.medianScore}.`
    : `No peer comparison. ${comparison.reason}`);
  const benchmark = data.benchmark ?? {};
  setText("benchmark-method",
    `${benchmark.name ?? "Peer benchmark unavailable"} · ${benchmark.organizationCount ?? "–"} synthetic organizations · `
    + `${benchmark.segment ?? "segment unavailable"} · snapshot ${benchmark.snapshotDate ?? "unavailable"} · `
    + `${benchmark.rubricVersion ?? "rubric unavailable"} · ${benchmark.provenance ?? provenance.label ?? "provenance unavailable"}`
    + ` · ${PEER_COHORT_PROVENANCE.version} · ${PEER_COHORT_PROVENANCE.statement}`);

  const list = document.getElementById("department-evidence-list");
  list?.replaceChildren();
  if (!performance.available) {
    list?.append(element("li", "evidence-empty",
      EVIDENCE_LIST_MESSAGE.ungraded(performance.reason)));
    return;
  }
  const evidence = evidenceForDepartment(data.evidence, department.id);
  if (!evidence.length) {
    list?.append(element("li", "evidence-empty", EVIDENCE_LIST_MESSAGE.noneRetained));
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

/**
 * Repaint the decision surface from the reader's own organizational query
 * sample, or hand it back to the bundled seed.
 *
 * This is the wiring the registry deliberately shipped without: a validated,
 * gradeable local query source now reaches the drill-down a leader actually
 * clicks, as its own priority list and its own graded detail. Nothing is mixed —
 * the imported units replace the synthetic ones rather than joining them, so a
 * reader is never comparing their own team against a fixture in the same list.
 *
 * @param literacy an `orgQueryDepartmentLiteracy` model, or null to return to
 *   the bundled sample. A model with no gradeable unit is treated as null: the
 *   drill-down publishes letters, and units with nothing to grade belong in the
 *   graded-sample panel that already reports their shortfalls.
 */
function paintImportedDecisionSurface(literacy) {
  if (!literacy?.gradeable) {
    if (!importedLiteracyRows) return null;
    importedLiteracyRows = null;
    if (bundledSeed) renderDecisionSurface(bundledSeed, bundledSeed.departments ?? []);
    return null;
  }
  importedLiteracyRows = orgQueryDepartmentRows(literacy);
  renderDecisionSurface(orgQueryDecisionData(literacy), orgQueryDecisionDepartments(literacy));
  return literacy;
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
    list?.append(element("li", "evidence-empty", DEPARTMENT_LIST_MESSAGE.noDepartments));
    applyDepartmentDetailState(document, "noDepartments");
    renderUnavailableAction(ACTION_UNAVAILABLE_REASON.noDepartments);
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

async function renderAgreementFigure() {
  try {
    const response = await fetch(AGREEMENT_CORPUS_URL, {
      cache: "no-store", headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Agreement corpus returned ${response.status}`);
    renderClassifierAgreement(document, scoreAgreementCorpus(await response.json()));
  } catch {
    // No corpus, no figure. There is nothing to estimate from and nothing
    // cached to fall back on, and a number this page cannot recompute is one
    // it has no business showing.
    renderClassifierAgreement(document, null);
  }
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
    const fixtures = await response.json();
    // What the panel is decided from as well as what it draws: a fixture set
    // that loaded is the input this question needs, and one that did not is an
    // input the page does not have.
    bundledEvaluationRecords = Array.isArray(fixtures) ? fixtures.length
      : Array.isArray(fixtures?.evaluations) ? fixtures.evaluations.length : 1;
    target.replaceChildren(renderFinopsEvaluationPanel(fixtures));
    syncExecutivePanels();
  } catch {
    bundledEvaluationRecords = 0;
    syncExecutivePanels();
    target.replaceChildren(renderFinopsEvaluationUnavailable(EVALUATION_BUNDLE_UNAVAILABLE));
  }
  target.setAttribute("aria-busy", "false");
}

/**
 * The one next step, painted from whichever local source this browser has.
 *
 * The reader's own retained monthly action when there is one, the bundled
 * synthetic journey otherwise, and the region says which either way. No fetch
 * is involved on either path, so this answers in the first viewport on the run
 * where the bundled fixture never arrives.
 *
 * `new Date()` is read HERE and nowhere else in the chain: `selectNextStep` is
 * a pure function of its two arguments, and keeping the clock at the call site
 * is what lets a test pin every state to a day.
 */
function paintNextStep() {
  const chosen = chooseJourneyState({
    retainedAction: readMonthlyAction(browserFinopsWorkspaceStorage()).record,
  });
  const painted = renderNextStep(document, selectNextStep(chosen.journeyState, new Date()), {
    sample: SAMPLE_LABEL[chosen.source],
  });
  // And, in the same pass, the consolidated journey directly under it. It reads
  // the same records through the snapshot the import path already writes, so the
  // two regions cannot disagree about which step is next; what it adds is the
  // evidence behind that step and the checkpoint that will judge it, on this
  // surface rather than one page away.
  paintConsolidatedJourney();
  return painted;
}

/**
 * The consolidated journey, from whatever this browser holds.
 *
 * `new Date()` is read HERE and nowhere else in the chain, for the same reason
 * it is above: `consolidateJourney` is a pure function of its arguments, and a
 * clock at the call site is what lets a test pin every phase to a day. A refused
 * or absent snapshot costs the carried provenance line and nothing else — the
 * journey still reads this browser's own records.
 */
function paintConsolidatedJourney() {
  return renderConsolidatedJourney(document, consolidateJourney({
    restored: restoreJourneySnapshot(browserFinopsWorkspaceStorage()),
    now: new Date(),
    surface: "briefing",
  }));
}

async function init() {
  if (!document.getElementById("department-priority")) return;
  // Before anything else touches the document: every top-level region is
  // stamped with the question it answers and its place in the reading order, so
  // the classification is true of the DOM a reader receives rather than only of
  // a manifest beside it. Attributes only, and it tolerates a region that is
  // not there — nothing below it may depend on this line, because everything
  // below it would be lost if this line ever threw.
  applyAnswerSpine(document);
  // And with it, the answer spine's own classification: which single region is
  // the answer, which are evidence beneath it and in what order a lead needs
  // them, and the state the page is in — nothing imported, at this point. Read
  // from src/finops-spine.js at runtime rather than authored into the markup,
  // so the page cannot hold an order the spine no longer declares. Attributes
  // and one label; it tolerates every region being absent.
  applyFinopsSpine(document);
  // …and, before a single region is painted, the voice is taken away from every
  // one that only echoes the answer. Nine polite regions used to be repainted on
  // the tick an import lands, so a screen-reader user was read a queue where a
  // sighted reader saw one page settle. They keep their text and their place;
  // the announcement moves to the answer region's own announcer, which is the
  // only region on this page that speaks about the answer now.
  silenceEchoedRegions(document);
  // First, before any panel is painted: a fragment already in the address bar
  // has to open its way out of the disclosures it points into, and the handlers
  // that keep doing so have to be attached before the reader can click one.
  // …and before THAT, the disclosures finops-stand-view.js mounts rather than
  // the document authoring. The cold-load reveal below runs at install time, so
  // a link that points straight into one has to find it already in the DOM.
  mountStandDisclosures(document);
  installDeepLinkDisclosure(document, window);
  // Immediately after it, and for the same reason: a deep link may have already
  // opened a deferred panel, and the read for that panel is taken at install.
  // Nothing below this line waits on it — the returned promises are the tests'
  // handle, not a gate on the boot.
  installDeferredDetails(document);
  mountLocalFinopsImport();
  // The page's one next action, operable before any fixture resolves: it stands
  // the reader on the file input and opens the picker. Bound here rather than
  // inside the import closure so it exists even if that closure never mounts.
  bindChooseFiles(document);
  // The first viewport's populated result, painted before the bundled fixture
  // is even requested. It is composed from a module in this bundle rather than
  // fetched, so a visitor with no export meets a complete example — a headline
  // benchmark, an impact, a labelled unavailable value, and one ranked action —
  // whether or not the request below ever resolves. Both next actions are bound
  // first, so they are operable in the unavailable state too.
  bindFirstRunActions(document);
  applyFirstRunResult(document, buildFirstRunResult());
  // The headline answer, painted BEFORE the fixture request and from a module in
  // the bundle rather than from storage: a lead who lands with cleared storage,
  // no import, and a failed fetch still reads the complete "where do we stand?"
  // answer. The disclosures and the resolving control are bound first, so they
  // are operable in the withheld state too.
  bindStandDisclosures(document);
  bindStandResolution(document);
  // Nothing has been imported at boot, so the held answer is the bundled
  // synthetic example with its marker intact — composed on this first read.
  applyStandHeadline(document, answerState.getHeadline());
  // The way out of the region, repainted from the module that owns the link so
  // the authored href and the hand-off contract cannot drift apart. It needs no
  // binding: it is an anchor, and it worked before this line ran.
  applyExampleBriefingCta(document);
  // After the paint: the disclosure's state chip counts the evidence entries
  // the paint just wrote, and binding it afterwards is what makes the first
  // chip agree with the list under it.
  bindFirstRunDisclosure(document);
  // Then the returning lead's question, in the same synchronous pass and for
  // the same reason: a leader who opens this page once a month is not asking
  // what the example would tell them, they are asking which single thing to do
  // first out of what this journey is already holding.
  paintNextStep();
  // And immediately after it, the one place to go next. Painted from the bundled
  // contract in the same synchronous pass as the brief above — it waits on no
  // fetch, so the prioritized destination is actionable in the first viewport
  // even on the run where the bundled fixture never arrives.
  const destinations = loadWorkspaceDestinations();
  applyWorkspaceDestinations(document, destinations);
  // The wayfinding rail, from the same loaded record and in the same synchronous
  // pass. Its four doors are authored anchors that already work; this corrects
  // their hrefs from the contract, marks the promoted one, and binds the part a
  // plain anchor cannot do — unfolding the panel the target sits inside, moving
  // the keyboard there, and saying so once.
  applyWorkspaceNav(document, destinations, { hash: window.location?.hash ?? "" });
  // The shell goes up before the rail is bound, so the destination a door points
  // into is on screen by the time the rail moves focus into it: the shell's own
  // click listener is registered in the capture phase, and a region that is still
  // hidden cannot take focus.
  initWorkspaceShell(document, { win: window, loaded: destinations });
  bindWorkspaceNav(document);
  // The comparability judgment on the import panel. Same synchronous pass and
  // the same reason: it depends on no fetch, no file, and no adapter, so the
  // question "may these be combined at all?" is readable and its next action is
  // reachable by keyboard before a reader has chosen anything.
  bindPortfolioSamples(document, evaluateSample);
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
  renderAgreementFigure();

  const retryData = document.getElementById("finops-data-retry");
  retryData?.addEventListener("click", () => loadAndRender());
  let hasRenderedAnalysis = false;

  async function loadAndRender() {
    setLoadState("loading", BUNDLED_LOAD_STATE.loading.title, BUNDLED_LOAD_STATE.loading.detail);
    // Only on a first load. A refresh over panels that already hold figures must
    // not blank their state back to "reading": the copy above says the previous
    // analysis stays visible, and a status chip that contradicts it is worse
    // than no chip.
    if (!hasRenderedAnalysis) applyPanelLifecycle(document, PANEL_STATUS.loading);
    let data;
    try {
      data = await loadData();
    } catch {
      const failure = hasRenderedAnalysis
        ? BUNDLED_LOAD_STATE.refreshFailure : BUNDLED_LOAD_STATE.firstFailure;
      setLoadState("error", failure.title, failure.detail);
      // The delivery panel is deliberately NOT captioned here. Its two inputs are
      // the example-dataset analysis and the reader's own import, neither of
      // which this fetch feeds; an error over a question this failure did not
      // touch is a false alarm, and the panel is still honestly hidden.
      if (hasRenderedAnalysis) return;
      setText("finops-provenance", HEADLINE_BUNDLE_UNAVAILABLE.provenance);
      setText("score-value", HEADLINE_BUNDLE_UNAVAILABLE.score);
      // A failed load has no spend denominator, which is the same honest state
      // as an import with none: the coverage line says so rather than sitting
      // on its loading copy under a card that has already given up.
      const noData = gradeEligibility([]);
      setText("score-coverage", noData.label);
      setText("score-action", noData.nextAction.text);
      setText("score-peer", HEADLINE_BUNDLE_UNAVAILABLE.peer);
      for (const id of ["kpi-spend-value", "kpi-recoverable-value", "kpi-productive-value", "kpi-peer-value"])
        setText(id, KPI_NOT_LOADED);
      // "Not loaded" is a different claim from "needs review", and the shape
      // beside it says so without the reader having to parse two words.
      applyBundledMetricFlags({
        score: "notLoaded", spend: "notLoaded", recoverable: "notLoaded",
        highValue: "notLoaded", percentile: "notLoaded",
      });
      const portfolioList = document.getElementById("portfolio-list");
      portfolioList?.setAttribute("aria-busy", "false");
      portfolioList?.replaceChildren(
        renderPortfolioUnavailable(HEADLINE_BUNDLE_UNAVAILABLE.portfolioReason));
      setText("portfolio-count", HEADLINE_BUNDLE_UNAVAILABLE.portfolioCount);
      const list = document.getElementById("department-priority");
      list?.replaceChildren(element("li", "evidence-empty", DEPARTMENT_LIST_MESSAGE.bundleUnavailable));
      applyDepartmentDetailState(document, "bundleUnavailable");
      renderUnavailableAction(ACTION_UNAVAILABLE_REASON.bundleUnavailable);
      // A seed that never arrived supplies nothing, so every panel it would
      // have answered says which input is missing rather than sitting on a
      // loading line under a heading that promises a figure.
      bundledSeed = null;
      syncExecutivePanels();
      // After the contract, not before it: a seed that never arrived leaves
      // every bundled panel unanswerable, and the contract is right to say so —
      // but the reason is a failed fetch, not a file the reader forgot. Left as
      // "awaiting input" the page sends them to the import panel for nothing.
      applyPanelLifecycle(document, PANEL_STATUS.error);
      return;
    }

    const departments = Array.isArray(data.departments) ? data.departments : [];
    const totals = summarize(departments);
    bundledSeed = data;
    renderFinancePortfolio(data);
    repaintBundledAnalysis = () => {
      renderHeadline(data.organization ?? {}, totals, gradeEligibility(departments), departments);
      renderMix(totals);
    };
    repaintBundledAnalysis();
    renderDecisionSurface(data, departments);
    renderRedaction(data.redactionSamples);

    // Ready is the lifecycle; "are these numbers mine?" is the question. The
    // region answers the second one, first from here so it is never blank and
    // then from the panel contract below, which knows about an import.
    setLoadState("ready");
    applyImportPresence(document, false);
    // The seed is loaded, so the panels are re-decided from what it actually
    // contains. This is also the first paint of the contract on a fresh visit.
    syncExecutivePanels();
    hasRenderedAnalysis = true;
    document.documentElement.dataset.shiplogEvolution = "ready";
  }

  await loadAndRender();
}

init();
