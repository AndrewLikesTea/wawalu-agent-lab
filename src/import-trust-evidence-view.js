function item(doc, fact) {
  const row = doc.createElement("li");
  row.dataset.status = fact.status;
  const label = doc.createElement("strong");
  label.textContent = fact.label;
  row.append(label, doc.createTextNode(` · ${fact.detail}`));
  return row;
}

function syncExpanded(details, summary, state) {
  const expanded = details.open === true;
  summary.setAttribute("aria-expanded", String(expanded));
  state.textContent = expanded ? "Hide" : "Show";
}

/** Paint the sole trust disclosure belonging to a local result. */
export function renderImportTrustEvidence(doc, evidence) {
  const details = doc.getElementById("local-trust-evidence");
  const summary = doc.getElementById("local-trust-evidence-summary");
  const state = doc.getElementById("local-trust-evidence-state");
  const verdict = doc.getElementById("local-trust-evidence-verdict");
  const facts = doc.getElementById("local-trust-evidence-facts");
  const limitations = doc.getElementById("local-trust-evidence-limitations");
  const action = doc.getElementById("local-trust-evidence-action");
  if (![details, summary, state, verdict, facts, limitations, action].every(Boolean)) return false;
  if (!evidence) {
    details.hidden = true;
    details.open = false;
    facts.replaceChildren();
    limitations.replaceChildren();
    return true;
  }
  details.hidden = false;
  details.open = false;
  details.dataset.state = evidence.state;
  verdict.textContent = evidence.state === "success"
    ? "Validated result with bounded trust" : "Partial result — use within the stated limits";
  facts.replaceChildren(...evidence.facts.map((fact) => item(doc, fact)));
  limitations.replaceChildren(...(evidence.limitations.length ? evidence.limitations
    : ["No additional projection limitations were reported."]).map((text) => {
    const row = doc.createElement("li");
    row.textContent = text;
    return row;
  }));
  action.textContent = evidence.nextAction;
  if (details.dataset.bound !== "true") {
    details.dataset.bound = "true";
    details.addEventListener("toggle", () => syncExpanded(details, summary, state));
  }
  syncExpanded(details, summary, state);
  return true;
}
