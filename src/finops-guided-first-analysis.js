// The guided first analysis: the model behind "pick a bundled provider export,
// get one answer, one benchmark and one action for a named team".
//
import {
  BUNDLED_SCENARIO_CATALOGUE, BUNDLED_SCENARIO_IDS, analysisReadiness,
} from "./finops-bundled-scenarios.js";

export const GUIDED_FLOW_CONTRACT = "finops-guided-first-analysis/1.0.0";

export const GUIDED_SCENARIO_PARAM = "scenario";

/** The destination fragments the flow sends a reader to, by name. */
export const GUIDED_DESTINATION = Object.freeze({
  evidence: "#workspace-evidence", department: "#workspace-departments",
});

export const DEFAULT_GUIDED_SCENARIO = BUNDLED_SCENARIO_IDS[0];

export const GUIDED_QUESTION = "Which bundled provider export has the most recoverable AI spend,"
  + " and who should act on it first?";

/** Said before anything is chosen, and never behind a disclosure. */
export const GUIDED_SYNTHETIC_NOTICE = "These are local synthetic demonstrations."
  + " No real data is entered, uploaded or transmitted: every figure below is computed locally"
  + " in this browser from invented provider-export-shaped records.";

export const GUIDED_SCENARIOS = BUNDLED_SCENARIO_CATALOGUE;

/** The four states this flow is drawn in. `ready` is the only one with a model;
 * the other three are authored, each with a shape, a word, a title and a next
 * move, so the state survives greyscale and a screen reader. */
export const GUIDED_STATE = Object.freeze({
  loading: "loading", empty: "empty", ready: "ready", error: "error",
});

export const GUIDED_STATE_COPY = Object.freeze({
  [GUIDED_STATE.loading]: Object.freeze({
    shape: "◐", eyebrow: "Working", title: "Reading the bundled provider export",
    detail: "The finding, its confidence and the one recommended action appear here when the"
      + " local computation finishes. Nothing is uploaded.",
  }),
  [GUIDED_STATE.empty]: Object.freeze({
    shape: "◌", eyebrow: "Nothing chosen", title: "Choose a bundled provider export to analyze",
    detail: "Pick one of the shapes above. Each is a local synthetic demonstration, and"
      + " everything below is computed from that scenario alone.",
  }),
  [GUIDED_STATE.error]: Object.freeze({
    shape: "✕", eyebrow: "Not available", title: "This analysis could not be produced",
    detail: "The scenario named in the address is not a bundled provider export, so no finding"
      + " was computed. Choose one above to continue; nothing needs to be re-entered.",
  }),
});

export const GUIDED_CONFIDENCE_BANDS = Object.freeze([
  Object.freeze({ band: "high", floor: 75, label: "high confidence", shape: "●", state: "full" }),
  Object.freeze({ band: "moderate", floor: 50, label: "moderate confidence", shape: "◑", state: "degraded" }),
  Object.freeze({ band: "low", floor: 0, label: "low confidence", shape: "◌", state: "suppressed" }),
]);

/** The band a 0–100 score falls in. A missing or nonsense score reads low. */
export function guidedConfidenceBand(value) {
  const score = Number.isFinite(value) ? value : -1;
  return GUIDED_CONFIDENCE_BANDS.find((entry) => score >= entry.floor)
    ?? GUIDED_CONFIDENCE_BANDS[GUIDED_CONFIDENCE_BANDS.length - 1];
}

const known = (id) => BUNDLED_SCENARIO_IDS.includes(id);
const usd = (value) => `$${Number(value).toLocaleString("en-US")}`;
const count = (value) => Number(value).toLocaleString("en-US");

/**
 * The scenario an address names, or the default. Never throws and never returns
 * an unregistered id: a hand-typed or outlived link opens the flow rather than
 * a blank one.
 */
export function guidedScenarioFromAddress(search = "") {
  const text = typeof search === "string" ? search : String(search?.search ?? "");
  const withoutHash = text.split("#")[0];
  const query = withoutHash.includes("?")
    ? withoutHash.slice(withoutHash.indexOf("?") + 1) : withoutHash;
  for (const pair of query.split("&")) {
    const [name, value = ""] = pair.split("=");
    if (name !== GUIDED_SCENARIO_PARAM) continue;
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch { decoded = value; }
    if (known(decoded)) return decoded;
  }
  return DEFAULT_GUIDED_SCENARIO;
}

/** The address that carries this choice into that destination. One encoding. */
export function guidedScenarioAddress(scenarioId, destination = "") {
  const id = known(scenarioId) ? scenarioId : DEFAULT_GUIDED_SCENARIO;
  return `?${GUIDED_SCENARIO_PARAM}=${encodeURIComponent(id)}${destination}`;
}

/**
 * Everything the three surfaces render for one scenario, composed once.
 *
 * Returns null for an unregistered id rather than a half-built record: a view
 * that has nothing to say must say so, not paint a scenario nobody chose.
 */
export function guidedAnalysis(scenarioId) {
  const result = analysisReadiness({ scenarioId });
  if (!result.ok) return null;
  const { finding, readiness, providerExportShape: shape, sample } = result;
  const step = readiness.recommendation;
  const department = sample.departments[0];
  const evidence = sample.evidence[0];
  const recoverable = finding.recoverableSpend.amount;
  const share = Math.round((recoverable / department.spendUsd) * 100);
  const figure = step.figure;
  const departments = sample.departments.length;
  return Object.freeze({
    contract: GUIDED_FLOW_CONTRACT, scenarioId: result.scenarioId, label: result.label,
    question: GUIDED_QUESTION,
    // The export shape, so region 1 states what was chosen and not only its name.
    shape: `${shape.providerId} · ${shape.format} · contract ${shape.contractVersion}`,
    // A band, so the chip can carry a word and a shape rather than only a number.
    confidenceBand: guidedConfidenceBand(readiness.confidence.value),
    // A scenario carrying one department says so; it is not a truncated list.
    departmentCount: departments,
    departmentScope: departments === 1
      ? `${department.name} is the only department in this export, so it is both the finding and the owner.`
      : `${department.name} is the highest-recoverable of ${departments} departments in this export.`,
    // Below the floor is a different fact from "small": the action card takes
    // the page's low variant and says so, rather than going quiet.
    material: finding.benchmark.comparison === "meets_or_exceeds",
    // The one material benchmark, said as a sentence a leader can repeat.
    benchmark: `${figure.text} of ${figure.metricName.replace(/_/g, " ")} over ${figure.period}`,
    answer: finding.statement,
    provenance: `Bundled synthetic ${shape.providerId} export, computed locally in this browser:`
      + ` ${finding.provenance.source}.`,
    confidence: `Evidence confidence ${readiness.confidence.value}/100 ·`
      + ` ${readiness.score.numerator} of ${readiness.score.denominator} required evidence`
      + ` categories sufficient · action confidence ${step.confidence}/100.`,
    impact: `${usd(recoverable)} of ${usd(department.spendUsd)} analyzed in ${department.name}`
      + ` — ${share}% of that department's modelled spend.`,
    whyItMatters: `${finding.benchmark.name}: ${figure.text} against the`
      + ` ${usd(finding.benchmark.value)} floor — ${finding.benchmark.comparison === "meets_or_exceeds"
        ? "material enough to act on" : "below the floor"}.`,
    // ONE prioritized action, and the team that takes it, never a list.
    action: Object.freeze({
      rank: finding.nextAction.rank, text: finding.nextAction.action,
      team: department.name, reason: finding.nextAction.reason,
    }),
    evidenceRows: Object.freeze([
      Object.freeze({ term: "Recoverable line", detail: `${figure.text} over ${figure.period}.` }),
      Object.freeze({
        term: "Provider export shape",
        detail: `${shape.providerId} · ${shape.format} · contract ${shape.contractVersion}.`,
      }),
      Object.freeze({
        term: "Departmental usage and cost",
        detail: `${department.name}: ${usd(department.spendUsd)} across`
          + ` ${count(department.queries)} queries in ${figure.period}.`,
      }),
      Object.freeze({
        term: "Classified workload sample",
        detail: `${evidence.sampleId} — ${evidence.category}.`,
      }),
      Object.freeze({ term: "Materiality benchmark", detail: finding.benchmark.rule }),
    ]),
    department: Object.freeze({
      name: department.name, spend: usd(department.spendUsd),
      queries: count(department.queries), recoverable: usd(recoverable), share: `${share}%`,
    }),
    limitation: readiness.limitation,
    assumptions: finding.assumptions,
    // What the live region says. One utterance: what changed, and what it means.
    announcement: `${result.label} selected. ${finding.statement}`
      + ` Recommended first: ${finding.nextAction.action} ${department.name} acts on it.`,
  });
}
