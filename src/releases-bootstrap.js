// Keep the failure message independent of the page's module graph: a missing
// build-stamp module must not leave a repository-root link posing as evidence.
export async function bootReleases(root, load = () => import("./releases-page.js")) {
  try {
    await load();
  } catch {
    const panel = root.querySelector("#shipped-build");
    if (!panel || panel.dataset.shippedBuild !== "loading") return;
    panel.dataset.shippedBuild = "failed";
    root.querySelector("#shipped-build-note").textContent = "The deployment record could not load. Reload this page to try again.";
  }
}

if (typeof document !== "undefined") bootReleases(document);
