// Keep this fallback independent of the app's imports so it can explain a
// failed module load. Never replace evidence that has already rendered.
export async function bootHomepage(root, load = () => import("./app.js")) {
  try {
    await load();
  } catch {
    const status = root.querySelector("#repository-release-pair-status");
    if (status && root.querySelector("#repository-release-pair")?.dataset.state !== "current") {
      status.textContent = "Current verification did not complete: the page script failed to load. The last-verified example above is a recorded build, not a live result.";
    }
    const target = root.querySelector("#repository-evidence-records");
    if (!target || target.dataset.state !== "loading") return;
    const message = root.createElement("p");
    message.setAttribute("class", "release-followup-lead");
    message.textContent = "Repository-backed decisions could not be loaded. Use the ‘Browse all repository-backed Shiplog decisions’ link below to try again.";
    target.replaceChildren(message);
    target.dataset.state = "failed";
  }
}

if (typeof document !== "undefined") bootHomepage(document);
