import { decisionDetailHref, releaseDetailHref } from "./releases.js";
import { copyWalkthroughSummary } from "./demo-walkthrough-summary.js";

export const DEMO_EVIDENCE_DISCLAIMER = "This is evidence produced by this browser-based demo, not a customer outcome, benchmark, or testimonial. Records and their links are available only in this browser.";

// One line, at most 120 characters: a title carrying newlines, control or bidi
// characters must not forge extra lines in the shared plain-text summary.
const oneLine = (value) => {
  const text = String(value ?? "").replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim();
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
};

// The same facts feed both the visible proof and the plain-text clipboard.
export function completionProof(progress) {
  const { decision, release } = progress ?? {};
  if (!progress?.complete || !decision?.id || !release?.id
    || !release.decisionIds?.includes(decision.id)) return null;
  const decisionName = oneLine(decision.title) || oneLine(decision.id);
  const releaseName = oneLine(release.version) || oneLine(release.id);
  const lines = [
    `Decision: “${decisionName}”.`,
    `Release: ${releaseName}.`,
    `Release ${releaseName} links to the decision “${decisionName}”.`,
    DEMO_EVIDENCE_DISCLAIMER,
  ];
  return {
    lines,
    text: ["Shiplog completed demo evidence", ...lines].join("\n"),
    links: [
      { label: `Reopen release ${releaseName}`, href: releaseDetailHref(release.id) },
      { label: `Reopen linked decision “${decisionName}”`, href: decisionDetailHref(decision.id) },
    ],
  };
}

export function renderCompletionProof(root, proof) {
  const lines = root.querySelector("#completion-proof-lines");
  const links = root.querySelector("#completion-proof-links");
  if (!lines || !links) return;
  const doc = root.ownerDocument ?? root;
  const node = (tag, text) => {
    const element = doc.createElement(tag);
    element.textContent = text;
    return element;
  };
  lines.replaceChildren(...(proof?.lines ?? []).map((line) => node("p", line)));
  links.replaceChildren(...(proof?.links ?? []).map(({ label, href }) => {
    const link = node("a", label);
    link.setAttribute("href", href);
    link.setAttribute("class", "text-link");
    return link;
  }));
  const status = root.querySelector("#completion-proof-status");
  if (status) status.textContent = "";
}

export function initCompletionCopy(root, read, clipboard = () => globalThis.navigator?.clipboard) {
  const button = root.querySelector("#completion-proof-copy");
  const status = root.querySelector("#completion-proof-status");
  if (!button || !status) return;
  let pending = false;
  button.addEventListener("click", async () => {
    if (pending) return;
    const proof = completionProof(read());
    if (!proof) return;
    pending = true;
    button.setAttribute("aria-busy", "true");
    status.textContent = "Copying demo evidence…";
    let message;
    try {
      message = await copyWalkthroughSummary(proof.text, clipboard());
    } catch {
      message = "Could not access the clipboard. Select the summary above and copy it by hand.";
    } finally {
      pending = false;
      button.removeAttribute("aria-busy");
    }
    // A slow permission prompt must not announce success for deleted/replaced records.
    if (completionProof(read())?.text === proof.text) status.textContent = message;
  });
}
