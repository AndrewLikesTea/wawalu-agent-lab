// Keep the failure message independent of the page's module graph: a missing
// build-stamp module must not leave a repository-root link posing as evidence.
export async function bootReleases(root, load = () => import("./releases-page.js")) {
  try {
    await load();
  } catch {
    const panel = root.querySelector("#shipped-build");
    if (!panel || panel.dataset.shippedBuild !== "loading") return;
    panel.dataset.shippedBuild = "failed";
    root.querySelector("#shipped-build-marking").textContent = "Commit evidence unavailable";
    root.querySelector("#shipped-build-note").textContent = "Deployment commit evidence could not load. Reload this page to try again. No commit can be verified from this record.";
  }
}

if (typeof document !== "undefined") bootReleases(document);
