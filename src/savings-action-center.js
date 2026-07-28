import { createSavingsPortfolio } from "./savings-portfolio.js";
import { createMonthlySavingsReconciliation } from "./monthly-savings-reconciliation.js";
import { adjudicateSavingsVariance } from "./savings-variance-adjudication.js";
import { SUSTAINED_VERIFICATION_QUESTION } from "./commitment-verification.js";
import { EVIDENCE_SOURCE, monthLabel } from "./savings-evidence.js";

const PRIORITY = Object.freeze({
  "measurement-pending": 0,
  "below-projection": 1,
  "matched-projection": 2,
  "above-projection": 3,
  "action-not-started": 4,
});

const DECISIONS = Object.freeze({
  "measurement-pending": (action, record) => ({
    label: "Request the monthly measurement",
    rationale: `${action.accountableOwner.role} needs to provide the ${record.measurementMonth} measurement before this plan can be judged.`,
  }),
  "below-projection": (action) => ({
    label: "Review the measured shortfall",
    rationale: `Ask ${action.accountableOwner.role} whether the measured gap needs a corrective action or a documented explanation.`,
  }),
  "matched-projection": () => ({
    label: "Continue the current action",
    rationale: "The measured month matched plan; preserve the evidence and continue monitoring.",
  }),
  "above-projection": () => ({
    label: "Continue and preserve evidence",
    rationale: "The measured month exceeded plan; keep the evidence available for later verification.",
  }),
  "action-not-started": () => ({
    label: "No monthly decision yet",
    rationale: "The action was not running in this month, so there is no active plan to chase.",
  }),
});

function adjudicationReferences(fixtures) {
  const references = new Map();
  for (const item of fixtures?.cases ?? []) {
    const result = adjudicateSavingsVariance(item.reconciliation);
    if (result.status !== item.expectedStatus)
      throw new TypeError(`Adjudication fixture ${item.fixtureId} disagrees with its expected status.`);
    references.set(result.status, Object.freeze({
      fixtureId: item.fixtureId,
      explanation: item.explanation,
      policyVersion: result.schemaVersion,
    }));
  }
  return references;
}

function priority(record) {
  return PRIORITY[record.availabilityReason ?? record.varianceReason] ?? 99;
}

export function createSavingsActionCenter({
  portfolioFixture, reconciliationFixture, adjudicationFixture,
}) {
  const portfolio = createSavingsPortfolio(portfolioFixture);
  const reconciliation =
    createMonthlySavingsReconciliation(reconciliationFixture, portfolio);
  const references = adjudicationReferences(adjudicationFixture);
  const month = reconciliation.measurementWindow.lastMonth;
  const actions = new Map(portfolio.actions.map((action) => [action.actionId, action]));
  const findings = reconciliation.records
    .filter((record) => record.measurementMonth === month)
    .map((record) => {
      const action = actions.get(record.actionId);
      const adjudication = adjudicateSavingsVariance(action);
      const decisionKey = record.availabilityReason ?? record.varianceReason;
      return Object.freeze({
        action,
        record,
        adjudication,
        decision: Object.freeze(DECISIONS[decisionKey](action, record)),
        adjudicationReference: references.get(adjudication.status) ?? null,
      });
    })
    .sort((left, right) =>
      priority(left.record) - priority(right.record)
      || (left.record.varianceUsd ?? 0) - (right.record.varianceUsd ?? 0)
      || left.action.actionId.localeCompare(right.action.actionId));

  return Object.freeze({
    month,
    finding: findings[0] ?? null,
    findingCount: findings.length,
    schemaVersions: Object.freeze({
      portfolio: portfolio.schemaVersion,
      reconciliation: reconciliation.schemaVersion,
      adjudication: findings[0]?.adjudication.schemaVersion ?? null,
    }),
  });
}

const DEMO_USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

const DEMO_STATUS_HEADLINE = Object.freeze({
  unavailable_measurement: "Not measured yet: the demonstration month carries a projection with no "
    + "measured result beside it, so no saving is claimed for it.",
  ambiguous_variance: "Measured, but the demonstration month's evidence does not support a decision "
    + "on its own.",
  material_shortfall: "Short of plan: the demonstration month realized materially less than it "
    + "projected over the year.",
  verified_delivery: "Delivered: the demonstration month realized what it projected.",
});

/**
 * The bundled fixtures projected into the claim shape the page paints.
 *
 * This is the fallback, and it is labelled as one everywhere it is shown: the
 * figures are a demonstration, not the visitor's own spend. Imported evidence
 * replaces this claim whole rather than merging with it, so no panel ever mixes
 * a fixture month with an imported one.
 */
export function demoSavingsClaim(center) {
  if (!center?.finding) {
    return Object.freeze({
      source: EVIDENCE_SOURCE.demo,
      question: SUSTAINED_VERIFICATION_QUESTION,
      status: "demo",
      reason: "no_finding",
      headline: "The bundled demonstration records contain no reconciled action for the current "
        + "reporting window, so there is no monthly claim to show.",
      metric: null,
      nextAction: Object.freeze({
        label: "Open a saved briefing to review your own months",
        rationale: "The demonstration has nothing to reconcile in this window. A briefing exported "
          + "from AI FinOps carries a commitment and the months to check it against.",
      }),
      facts: Object.freeze([]),
      calculation: Object.freeze({ rows: Object.freeze([]), versions: Object.freeze([]) }),
      notes: Object.freeze([DEMO_NOTE]),
      months: Object.freeze([]),
      exportable: false,
    });
  }

  const { action, record, adjudication, decision, adjudicationReference } = center.finding;
  const projected = record.projectionBaseline.monthlySavingsUsd;
  const realized = record.simulatedRealizedSavingsUsd;
  const measured = Number.isFinite(realized);
  return Object.freeze({
    source: EVIDENCE_SOURCE.demo,
    question: SUSTAINED_VERIFICATION_QUESTION,
    status: "demo",
    reason: adjudication.status,
    verdict: null,
    headline: DEMO_STATUS_HEADLINE[adjudication.status]
      ?? "The demonstration month's review status is not one this page can state.",
    metric: Object.freeze({
      label: `Realized in ${monthLabel(record.measurementMonth)}`,
      value: measured ? DEMO_USD.format(realized) : "Not measured",
      comparison: `against ${DEMO_USD.format(projected)} projected a month`
        + (measured && projected ? ` (${Math.round((realized * 100) / projected)}% of plan)` : ""),
    }),
    monthsCounted: measured ? 1 : 0,
    monthsRequired: 1,
    nextAction: Object.freeze({ label: decision.label, rationale: decision.rationale }),
    facts: Object.freeze([
      { label: "Accountable department", value: `${action.department.name} · ${action.accountableOwner.role}` },
      { label: "Expected effect", value: `${DEMO_USD.format(projected)} a month · ${action.title}` },
      { label: "Confidence", value: `${Math.round(action.confidence * 100)}% · ${adjudication.confidenceLevel}` },
      {
        label: "Provenance",
        value: `${record.evidenceProvenance.source} · `
          + `${record.evidenceProvenance.evidenceRefs.join(", ") || "no evidence reference"} · `
          + "bundled demonstration fixture",
      },
    ]),
    calculation: Object.freeze({
      rows: Object.freeze([
        {
          label: "Monthly availability",
          value: record.availabilityReason === "measurement-pending"
            ? "Measurement pending from accountable owner" : record.availabilityState,
        },
        {
          label: "Measured variance",
          value: Number.isFinite(record.varianceUsd)
            ? `${record.varianceUsd >= 0 ? "+" : "−"}${DEMO_USD.format(Math.abs(record.varianceUsd))}`
            : "Not available",
        },
        { label: "Annual lifecycle adjudication", value: adjudication.varianceReason },
        {
          label: "Decision-policy fixture",
          value: adjudicationReference
            ? `${adjudicationReference.fixtureId} · ${adjudicationReference.explanation}`
            : "No matching adjudication fixture",
        },
        {
          label: "Lifecycle history",
          value: action.lifecycleTransitions
            .map((transition) => `${transition.state.replace("-", " ")} · ${transition.transitionedDate}`)
            .join(" → "),
        },
      ]),
      caveat: "These figures are simulated for demonstration. Nothing here was measured from a "
        + "provider account, and no figure on this page is your organisation's spend until you "
        + "open your own briefing.",
      versions: Object.freeze([
        center.schemaVersions.portfolio,
        center.schemaVersions.reconciliation,
        center.schemaVersions.adjudication,
      ].filter(Boolean)),
    }),
    notes: Object.freeze([DEMO_NOTE]),
    months: Object.freeze([]),
    exportable: false,
  });
}

const DEMO_NOTE = "Demonstration data. Open a briefing you exported from AI FinOps to replace it "
  + "with your own months.";

export async function loadSavingsActionCenter(fetcher = fetch) {
  const urls = [
    "/savings-portfolio-fixture.json",
    "/monthly-savings-reconciliation-fixture.json",
    "/savings-variance-fixtures.json",
  ];
  const responses = await Promise.all(urls.map((url) => fetcher(url)));
  const failed = responses.find((response) => !response?.ok);
  if (failed) throw new Error("The bundled monthly savings records could not be loaded.");
  const [portfolioFixture, reconciliationFixture, adjudicationFixture] =
    await Promise.all(responses.map((response) => response.json()));
  return createSavingsActionCenter({
    portfolioFixture, reconciliationFixture, adjudicationFixture,
  });
}
