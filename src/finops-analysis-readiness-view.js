// Paints the readiness answer. It decides nothing and formats no figure of its
// own: `analysisReadiness` chose the words and the numbers, and the money text
// is the one the shared next-step record already publishes, so the two regions
// that name this action cannot drift apart in a decimal.
const set = (doc, id, value) => { const node = doc.getElementById(id); if (node) node.textContent = value; };

export function renderAnalysisReadiness(doc, model) {
  const region = doc.getElementById("finops-recoverable-how-we-know");
  if (!region || !model) return null;
  region.dataset.level = model.level;
  set(doc, "analysis-readiness-verdict", model.supportedConclusion);
  set(doc, "analysis-readiness-benchmark", `Readiness ${model.score.value}/100 · ${model.score.numerator} of ${model.score.denominator} required evidence categories sufficient.`);
  // The demoted detail's summary carries the score it holds, so a reader who
  // never opens it still knows whether opening it is worth their time (#1465).
  set(doc, "analysis-readiness-evidence", model.currentEvidence);
  set(doc, "analysis-readiness-limit", model.limitation);
  const action = model.recommendation;
  set(doc, "analysis-readiness-action", action ? `${action.action} in ${action.department}` : "No action meets the eligibility rule.");
  set(doc, "analysis-readiness-value", action ? `${action.figure.text} of ${action.figure.metricName} over ${action.figure.period}.` : "No figure: no eligible bundled action.");
  set(doc, "analysis-readiness-action-confidence", action?.confidence === null || !action ? "Action confidence: not published by the fixture." : `Action confidence: ${action.confidence}/100.`);
  set(doc, "analysis-readiness-reason", action?.reason ?? "No eligible bundled action.");
  set(doc, "analysis-readiness-provenance", action?.provenance ?? "Bundled synthetic fixture.");
  set(doc, "analysis-readiness-confidence", `Evidence confidence ${model.confidence.value}/100. ${model.confidence.rule}`);
  const list = doc.getElementById("analysis-readiness-upgrades");
  if (list) list.replaceChildren(...model.upgrades.map((upgrade) => {
    const item = doc.createElement("li");
    item.textContent = `${upgrade.category} — reduces ${upgrade.reduces}; enables ${upgrade.enables}.`;
    return item;
  }));
  return region;
}
