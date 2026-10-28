// A detail visit is evidence only for the exact local records that were opened.
import { decisionDetailHref, releaseDetailHref } from "./releases.js";
import { retentionDeclined } from "./local-retention.js";

export const DEMO_VISIT_KEY = "shiplog.demo-visit.v1";
export const DEMO_BOUNDARY = "Evidence from this browser-based Shiplog demo, not a customer outcome, benchmark, or testimonial.";
export const DEMO_PROVED = "Opening the release showed the decision behind it.";
export const DEMO_RECORDS = "The records stay in the evaluator's browser; ask them to reopen the release to show it.";
export const DEMO_LOCAL ="These links reopen records in this browser only; they do not share the records with another person or browser.";

export function demoVisit(decision, release) {
  if (!decision?.id || !decision?.title?.trim() || !release?.id || !release?.version?.trim()
    || !release.decisionIds?.includes(decision.id)) return null;
  return JSON.stringify({ version: 1, decision, release });
}

export function readDemoVisit(storage) {
  try { return storage?.getItem(DEMO_VISIT_KEY) ?? null; } catch { return null; }
}

export function rememberDemoVisit(storage, decision, release) {
  const visit = demoVisit(decision, release);
  try {
    if (!visit || retentionDeclined(storage)) return false;
    storage.setItem(DEMO_VISIT_KEY, visit);
    return true;
  } catch { return false; }
}

export function demoEvidence(decision, release) {
  const releaseName = [release.version.trim(), (typeof release.title === "string" ? release.title.trim() : "")].filter(Boolean).join(" — ");
  const statement = `Recorded decision “${decision.title.trim()}” is linked to recorded release “${releaseName}”.`;
  const links = [
    { label: `Reopen release ${releaseName}`, href: releaseDetailHref(release.id) },
    { label: `Reopen decision ${decision.title.trim()}`, href: decisionDetailHref(decision.id) },
  ];
  // The copy goes to someone who has no access to this browser's records, so it
  // carries what was shown and its boundary, never links that would open nothing.
  const shared = [statement, DEMO_PROVED, DEMO_BOUNDARY];
  return { paragraphs: [...shared, DEMO_LOCAL], links,
    text: ["Shiplog demo completed: all four steps done.", ...shared, DEMO_RECORDS].join("\n") };
}

export function renderDemoEvidence(root, evidence, validate = () => true) {
  const box = root.querySelector("#evaluation-path-evidence");
  if (!box) return;
  const doc = root.ownerDocument ?? root;
  const oldText = box.dataset.evidence;
  if (oldText === evidence?.text) return;
  let focused = false;
  for (let node = doc.activeElement; node; node = node.parentNode) {
    if (node === box) focused = true;
  }
  box.replaceChildren();
  box.dataset.evidence = evidence?.text ?? "";
  if (!evidence) {
    if (focused) root.querySelector("#evaluation-path-title")?.focus();
    return;
  }
  const nodes = [];
  for (const text of evidence.paragraphs) {
    const p = doc.createElement("p");
    p.textContent = text;
    nodes.push(p);
  }
  for (const { label, href } of evidence.links) {
    const link = doc.createElement("a");
    link.textContent = label;
    link.setAttribute("href", href);
    link.setAttribute("class", "text-link");
    nodes.push(link);
  }
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = "Copy demo evidence";
  const status = doc.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const fallback = doc.createElement("textarea");
  fallback.readOnly = true;
  fallback.hidden = true;
  fallback.setAttribute("aria-label", "Demo evidence to copy manually");
  fallback.value = evidence.text;
  let copying = false;
  button.addEventListener("click", async () => {
    if (copying || !validate()) return;
    copying = true;
    button.setAttribute("aria-disabled", "true");
    status.textContent = "Copying demo evidence…";
    try {
      await globalThis.navigator.clipboard.writeText(evidence.text);
      if (box.dataset.evidence !== evidence.text) return;
      status.textContent = "Demo evidence copied. Ready to paste into email or chat.";
      fallback.hidden = true;
    } catch {
      if (box.dataset.evidence !== evidence.text) return;
      status.textContent = "Could not copy automatically. Copy the text below manually, or try again.";
      fallback.hidden = false;
      fallback.focus();
      fallback.select?.();
    } finally {
      copying = false;
      button.removeAttribute("aria-disabled");
    }
  });
  box.replaceChildren(...nodes, button, status, fallback);
  if (focused) button.focus();
}
