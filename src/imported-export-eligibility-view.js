// Renders the export-only executive decision inside the existing import
// evidence surface. The block is created only after a reader's export validates,
// leaving the authored bundled-scenario first analysis untouched.

function row(document, term, value, className) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = value;
  if (className) dd.className = className;
  wrapper.append(dt, dd);
  return wrapper;
}

export function renderImportedExportEligibility(document, eligibility) {
  const host = document.getElementById("own-data-evidence-preflight");
  if (!host || !eligibility) return false;
  let region = document.getElementById("imported-export-eligibility");
  if (!region) {
    region = document.createElement("section");
    region.id = "imported-export-eligibility";
    region.className = "imported-export-eligibility";
    region.setAttribute("aria-labelledby", "imported-export-eligibility-question");
    host.append(region);
  }
  region.dataset.state = eligibility.state;
  const question = document.createElement("h4");
  question.id = "imported-export-eligibility-question";
  question.textContent = eligibility.question;
  const answer = document.createElement("p");
  answer.className = "imported-export-eligibility-answer";
  answer.textContent = eligibility.answer;
  const facts = document.createElement("dl");
  if (eligibility.eligible) {
    facts.append(
      row(document, "One decision metric", `${eligibility.metric.display}. ${eligibility.metric.definition}`, "imported-export-eligibility-metric"),
      row(document, "Confidence and provenance", `${eligibility.confidence} ${eligibility.provenance}`),
      row(document, "Prioritized next action", eligibility.nextAction),
    );
  } else {
    facts.append(
      row(document, "Smallest additional export field", eligibility.requiredField, "imported-export-eligibility-required"),
      row(document, "Prioritized next action", eligibility.nextAction),
    );
  }
  const boundary = document.createElement("p");
  boundary.className = "imported-export-eligibility-boundary";
  boundary.textContent = eligibility.boundary;
  region.replaceChildren(question, answer, facts, boundary);
  return true;
}
