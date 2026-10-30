import { buildReleaseBrief } from "./releases.js";
import { copyText } from "./share-link.js";

// Consume the rendered selection, never re-filter or reorder it.
export function buildReleaseViewSummary(shown, exampleReleaseIds, exampleDecisionIds) {
  return [
    "Release history — current filtered view",
    `${shown.length} release${shown.length === 1 ? "" : "s"}, in displayed order. Includes only releases visible after the active search and filters.`,
    "Example records demonstrate Shiplog; they are not customer or production data. Records added in this browser are local records, not proof of deployment.",
    ...shown.map((release, index) => {
      const brief = buildReleaseBrief(release, (release.decisions ?? []).map((decision) => ({
        ...decision, status: decision.status || "unknown",
      })), { example: exampleReleaseIds.has(release.id) })
        .replace(/^Status: .+$/m, `Status: ${release.status || "Not recorded"}`);
      const sources = (release.associations ?? []).filter(({ missing }) => !missing).map(({ decision }) =>
        `- ${decision.title || decision.id}: ${exampleDecisionIds.has(decision.id) ? "Example record" : "Record added in this browser"}`);
      return `${index + 1}. ${brief}\nSource: ${exampleReleaseIds.has(release.id) ? "Example record" : "Record added in this browser"}`
        + (sources.length ? `\nLinked decision sources:\n${sources.join("\n")}` : "");
    }),
  ].join("\n\n");
}

export function initReleaseViewSummary(root, { shown, provenance, clipboard }) {
  const button = root.querySelector("#release-summary-copy");
  if (!button) return { update() {} };
  const status = root.querySelector("#release-summary-status");
  const availability = root.querySelector("#release-summary-availability");
  const fallback = root.querySelector("#release-summary-fallback");
  const text = root.querySelector("#release-summary-text");
  const select = root.querySelector("#release-summary-select");
  let pending = false;
  let generation = 0;
  const update = () => {
    generation += 1;
    button.disabled = shown().length === 0;
    availability.textContent = button.disabled
      ? "No releases are visible. Change the search or filters before copying; if the log failed to load, retry loading it first."
      : `${shown().length} visible releases will be included.`;
    // Keep the receipt, but identify it as a previous snapshot after edits.
    if (status.textContent && !status.textContent.includes("The view changed.")) {
      status.textContent += " The view changed. Copy again for an updated summary.";
    }
    fallback.hidden = true;
  };
  select.addEventListener("click", () => { text.focus(); text.select(); });
  button.addEventListener("click", async () => {
    if (pending || !shown().length) return;
    pending = true;
    button.setAttribute("aria-disabled", "true");
    const currentGeneration = generation;
    const count = shown().length;
    const summary = buildReleaseViewSummary(shown(), ...provenance());
    status.textContent = "Copying summary…";
    fallback.hidden = true;
    const copied = await copyText(clipboard, summary);
    pending = false;
    button.removeAttribute("aria-disabled");
    const changed = currentGeneration !== generation ? " The view has since changed; copy again for an updated summary." : "";
    if (copied) {
      status.textContent = `Copied a summary of ${count} visible release${count === 1 ? "" : "s"} to the clipboard.${changed}`;
    } else {
      text.value = summary;
      fallback.hidden = false;
      status.textContent = `Clipboard unavailable. Nothing was copied. Select the summary below and copy it manually.${changed}`;
      // Do not steal focus if the user moved elsewhere during the async write.
      if ((root.ownerDocument ?? root).activeElement === button) {
        text.focus();
        text.select();
      }
    }
  });
  return { update };
}
