export function renderIntakeConfidence(doc, result) {
  const root = doc.getElementById("intake-confidence");
  if (!root || !result) return null;
  const node = (tag, className, text) => {
    const item = doc.createElement(tag); item.className = className; item.textContent = text; return item;
  };
  const title = node("h3", "intake-confidence-title",
    "Can this export support a reproducible review?");
  const grade = node("p", "intake-confidence-grade", result.status === "scored"
    ? `Grade ${result.grade} · ${result.score}/100` : result.grade);
  const facts = doc.createElement("dl");
  // The declared period is what tells a reader *which* export this verdict is
  // about: selecting several provider files leaves one finding on screen, and a
  // verdict that cannot name its subject is not evidence.
  for (const [label, value] of [["Benchmark", result.benchmark],
    ["Provenance", result.provenance.label], ...(result.period ? [["Period", result.period]] : [])]) {
    const row = doc.createElement("div");
    row.append(node("dt", "", label), node("dd", "", value)); facts.append(row);
  }
  const remediation = doc.createElement("p");
  remediation.append(node("strong", "", "Prioritized remediation "),
    node("span", "intake-confidence-remediation", result.remediation));
  root.replaceChildren(node("p", "eyebrow", "Intake confidence · deterministic local check"),
    title, grade, facts, node("p", "intake-confidence-explanation", result.explanation), remediation);
  root.hidden = false;
  root.dataset.status = result.status;
  root.setAttribute("aria-labelledby", "intake-confidence-title");
  title.id = "intake-confidence-title";
  return root;
}

export function clearIntakeConfidence(doc) {
  const root = doc.getElementById("intake-confidence");
  if (!root) return null;
  root.hidden = true;
  root.dataset.status = "pending";
  return root;
}
