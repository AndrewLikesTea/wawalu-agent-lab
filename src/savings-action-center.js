import { createSavingsPortfolio } from "./savings-portfolio.js";
import { createMonthlySavingsReconciliation } from "./monthly-savings-reconciliation.js";
import { adjudicateSavingsVariance } from "./savings-variance-adjudication.js";

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
