const text = (value) => typeof value === "string" && value.trim().length > 0;

function el(doc, tag, className, content) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

export function validatePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return ["payload"];
  for (const field of ["headlineAnswer", "materialBenchmarkOrTrend",
    "prioritizedNextAction", "generatedAt"]) {
    if (!text(payload[field])) errors.push(field);
  }
  if (!text(payload.confidence?.level) || !text(payload.confidence?.basis)) errors.push("confidence");
  if (!text(payload.period?.start) || !text(payload.period?.end) || !text(payload.period?.provenance)) errors.push("period");
  if (!payload.auditAppendix || !text(payload.auditAppendix.label)
    || !text(payload.auditAppendix.schemaVersion) || !text(payload.auditAppendix.fixtureId)
    || !text(payload.auditAppendix.fixtureVersion) || !text(payload.auditAppendix.selectionVersion)) {
    errors.push("auditAppendix");
  }
  if (!Array.isArray(payload.departmentEvidence) || payload.departmentEvidence.length === 0) {
    errors.push("departmentEvidence");
  } else {
    payload.departmentEvidence.forEach((row, index) => {
      if (!text(row?.department) || !text(row?.evidence) || !text(row?.provenance)) {
        errors.push(`departmentEvidence[${index}]`);
      }
    });
  }
  return errors;
}

function disclosure(doc, title, summary, body) {
  const details = el(doc, "details", "payload-disclosure");
  const toggle = el(doc, "summary", "payload-disclosure-toggle", title);
  toggle.append(el(doc, "span", "payload-disclosure-hint", summary));
  details.append(toggle, body);
  return details;
}

export function renderPayloadBriefing(doc, payload) {
  const errors = validatePayload(payload);
  if (errors.length) throw new TypeError(`Malformed executive briefing payload: ${errors.join(", ")}`);
  const article = el(doc, "article", "payload-brief");
  article.setAttribute("aria-labelledby", "payload-question");

  const header = el(doc, "header", "payload-header");
  header.append(el(doc, "p", "eyebrow", "Leadership question"));
  const question = el(doc, "h2", "payload-question", "Where should we act first?");
  question.id = "payload-question";
  header.append(question, el(doc, "p", "payload-answer", payload.headlineAnswer));
  article.append(header);

  const decision = el(doc, "div", "payload-decision");
  const benchmark = el(doc, "section", "payload-card");
  benchmark.append(el(doc, "h3", "payload-label", "Material benchmark or trend"),
    el(doc, "p", "payload-benchmark", payload.materialBenchmarkOrTrend));
  const action = el(doc, "section", "payload-card payload-action");
  action.append(el(doc, "h3", "payload-label", "Prioritized next action"),
    el(doc, "p", "payload-action-copy", payload.prioritizedNextAction));
  decision.append(benchmark, action);
  article.append(decision);

  // Why it matters says what the three lines above do NOT say. Restating the
  // answer and the benchmark here — they are two inches up on a one-page sheet
  // — spends a third of the page on a re-read and explains nothing. What a
  // reader cannot see from the figures is how much was folded into them and how
  // far the answer travels, so that is what this block carries.
  const signals = payload.departmentEvidence.length;
  const why = el(doc, "section", "payload-why");
  why.append(el(doc, "h3", "payload-label", "Why it matters"),
    el(doc, "p", "", `Consolidated from ${signals} department ${signals === 1 ? "signal" : "signals"}, `
      + `this is the single answer and the one action this analysis ranks first. Confidence is `
      + `${payload.confidence.level.toLowerCase()}, and the answer is bounded by the selected period `
      + `below: it is a decision aid for where to look next, not a full financial report.`));
  article.append(why);

  const metadata = el(doc, "dl", "payload-meta");
  for (const [term, value] of [
    ["Confidence", `${payload.confidence.level} — ${payload.confidence.basis}`],
    ["Selected period", `${payload.period.start} to ${payload.period.end}`],
    ["Period provenance", payload.period.provenance],
    ["Generated", payload.generatedAt],
  ]) metadata.append(el(doc, "dt", "", term), el(doc, "dd", "", value));
  article.append(metadata);

  const evidence = el(doc, "ul", "payload-evidence");
  for (const row of payload.departmentEvidence) {
    const item = el(doc, "li");
    item.append(el(doc, "strong", "", row.department), doc.createTextNode(` — ${row.evidence}`),
      el(doc, "small", "", `Provenance: ${row.provenance}`));
    evidence.append(item);
  }
  article.append(disclosure(doc, "Department evidence", "Supporting department-level observations", evidence));

  const method = el(doc, "div", "payload-method");
  method.append(el(doc, "p", "", "This sheet states the finding, comparison, action, confidence, period, and supporting department observations selected in this browser. It does not read provider rows, prompts, credentials, or customer data."));
  const versions = el(doc, "dl", "payload-method-versions");
  for (const [term, value] of Object.entries(payload.auditAppendix)) {
    if (term !== "label") versions.append(el(doc, "dt", "", term), el(doc, "dd", "", value));
  }
  method.append(versions);
  article.append(disclosure(doc, payload.auditAppendix.label,
    "Internal identifiers for technical audit; not part of the briefing claims", method));

  article.append(el(doc, "p", "payload-signoff",
    `This briefing claims the finding, comparison, next action, confidence, and source period shown above. Generated ${payload.generatedAt}.`));
  return article;
}

export function renderPayloadState(doc, kind, title, detail) {
  const section = el(doc, "section", "payload-state");
  section.dataset.state = kind;
  section.setAttribute("role", kind === "error" ? "alert" : "status");
  section.setAttribute("tabindex", "-1");
  section.append(el(doc, "h2", "", title), el(doc, "p", "", detail));
  const link = el(doc, "a", "", "Return to the AI FinOps analysis");
  link.setAttribute("href", "/evolution.html#briefing-readiness");
  section.append(link);
  return section;
}
