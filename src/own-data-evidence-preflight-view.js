function node(document, tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  result.textContent = text;
  return result;
}

export function renderOwnDataEvidencePreflight(document, assessment) {
  const region = document.getElementById("own-data-evidence-preflight");
  const finding = document.getElementById("own-data-preflight-finding");
  const benchmark = document.getElementById("own-data-preflight-benchmark");
  const provenance = document.getElementById("own-data-preflight-provenance");
  const confidence = document.getElementById("own-data-preflight-confidence");
  const action = document.getElementById("own-data-preflight-action");
  const boundary = document.getElementById("own-data-preflight-boundary");
  if (!region || !finding || !benchmark || !provenance || !confidence || !action
    || !boundary) return false;

  region.dataset.outcome = assessment.outcome;
  finding.replaceChildren(
    node(document, "strong", "own-data-preflight-verdict", assessment.verdict),
    node(document, "span", undefined, assessment.finding),
  );
  benchmark.textContent = `${assessment.benchmark.label} · ${assessment.coverage.coveredRows} of ${assessment.coverage.totalRows} rows covered. ${assessment.benchmark.rule}`;
  provenance.replaceChildren(...assessment.provenance.map((source) => {
    const item = node(document, "li", undefined, "");
    item.dataset.available = String(source.available);
    item.append(node(document, "strong", undefined, source.source),
      document.createTextNode(` · ${source.available ? "Available" : "Absent"} · ${source.detail}`));
    return item;
  }));
  confidence.textContent = assessment.confidence;
  action.textContent = assessment.nextAction;
  boundary.replaceChildren(...assessment.boundary
    .map((rule) => node(document, "li", undefined, rule)));
  return true;
}
