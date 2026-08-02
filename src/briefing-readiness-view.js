import { READINESS_STATE } from "./briefing-readiness.js";

const LABEL = Object.freeze({
  [READINESS_STATE.complete]: "Ready to circulate",
  [READINESS_STATE.insufficientEvidence]: "Not ready — insufficient evidence",
  [READINESS_STATE.unsupportedInput]: "Not ready — unsupported input",
});

const put = (root, id, value) => {
  const node = root.getElementById(id);
  if (node) node.textContent = value;
};

export function renderBriefingReadiness(root, decision) {
  const region = root.getElementById("briefing-readiness");
  if (!region || !decision) return null;
  region.dataset.state = decision.state;
  put(root, "briefing-readiness-verdict", LABEL[decision.state]);
  put(root, "briefing-readiness-finding", decision.headlineFinding ?? "Headline finding missing.");
  put(root, "briefing-readiness-benchmark", decision.benchmarkComparison ?? "Benchmark or comparison missing.");
  put(root, "briefing-readiness-action", decision.recommendedAction ?? "Prioritized action missing.");
  put(root, "briefing-readiness-confidence", decision.confidence
    ? `${decision.confidence.level} confidence — ${decision.confidence.basis}`
    : "Confidence and its basis are missing.");
  put(root, "briefing-readiness-period", decision.sourcePeriod
    ? `Source period ${decision.sourcePeriod.start} to ${decision.sourcePeriod.end} — ${decision.sourcePeriod.provenance}`
    : "Source period or provenance is missing.");

  const boundary = decision.state === READINESS_STATE.unsupportedInput
    ? `Unsupported claims: ${decision.unsupportedClaims.join(", ")}. The bundled static model cannot substantiate them.`
    : decision.missingEvidence.length
      ? `Missing required evidence: ${decision.missingEvidence.join(", ")}.`
      : `${decision.exclusions.prompts} ${decision.exclusions.providerRows}`;
  put(root, "briefing-readiness-boundary", boundary);
  return region;
}
