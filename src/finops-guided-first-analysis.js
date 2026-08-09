// The guided first analysis: the model behind "pick a bundled provider export,
// get one answer, one benchmark and one action for a named team".
//
// THE DEFECT THIS CLOSES. A chooser that only marked its choice on a node —
// writing the id onto a fragment target and stopping — moved nobody anywhere:
// Google and Azure opened the same generic evidence and the same generic
// department list. So the unit of work here is not the choice, it is what the
// choice CHANGES. Everything a destination renders comes out of `guidedAnalysis`
// for one scenario id, and two scenarios cannot produce the same text: the
// figure, the provenance line, the evidence rows, the department and the team
// that acts are all read from that scenario's own bundled records.
//
// It reads only Rowan's closed boundary (`analysisReadiness`), holds no DOM and
// keeps no state — src/finops-guided-first-analysis-view.js owns the one
// selected id and every node. A pure model is what lets a test say "Azure says
// something different from Google" without standing up a page.
import {
  BUNDLED_SCENARIO_CATALOGUE, BUNDLED_SCENARIO_IDS, analysisReadiness,
} from "./finops-bundled-scenarios.js";

export const GUIDED_FLOW_CONTRACT = "finops-guided-first-analysis/1.0.0";

/** The query parameter the choice travels in. The hash is spent twice over on
 * this page — shared briefs and the workspace destinations — so a fourth
 * claimant there would drop somebody's brief. */
export const GUIDED_SCENARIO_PARAM = "scenario";

/** The destination fragments the flow sends a reader to, by name. */
export const GUIDED_DESTINATION = Object.freeze({
  evidence: "#workspace-evidence", department: "#workspace-departments",
});

export const DEFAULT_GUIDED_SCENARIO = BUNDLED_SCENARIO_IDS[0];

/** ONE answerable question. Not one per section — one for the flow. */
export const GUIDED_QUESTION = "Which bundled provider export has the most recoverable AI spend,"
  + " and who should act on it first?";

/** Said before anything is chosen, and never behind a disclosure. */
export const GUIDED_SYNTHETIC_NOTICE = "These are local synthetic demonstrations."
  + " No real data is entered, uploaded or transmitted: every figure below is computed locally"
  + " in this browser from invented provider-export-shaped records.";

export const GUIDED_SCENARIOS = BUNDLED_SCENARIO_CATALOGUE;

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
  const { finding, readiness, providerExportShape: shape, sample, eligibility } = result;
  const step = readiness.recommendation;
  const department = sample.departments[0];
  const evidence = sample.evidence[0];
  const recoverable = finding.recoverableSpend.amount;
  const share = Math.round((recoverable / department.spendUsd) * 100);
  const figure = step.figure;
  return Object.freeze({
    contract: GUIDED_FLOW_CONTRACT, scenarioId: result.scenarioId, label: result.label,
    eligibility,
    question: GUIDED_QUESTION,
    // The one material benchmark, said as a sentence a leader can repeat.
    benchmark: `${figure.text} of ${figure.metricName.replace(/_/g, " ")} over ${figure.period}`,
    answer: finding.statement,
    provenance: `Bundled synthetic ${shape.providerId} export, computed locally in this browser:`
      + ` ${finding.provenance.source}.`,
    eligibilityText: `Benchmark eligible · ${eligibility.snapshotId} · validated on the client`
      + " · no network, provider, or HRIS connection required.",
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
