// Focus only an explicit check destination, before asynchronous data loading.
// The heading persists across verdict updates; those updates never refocus it.
export function bindDeploymentArrival(root, view = globalThis.window) {
  const heading = root.querySelector("#deployment-status-title");
  if (!heading || !view || heading.dataset.arrivalBound === "true") return;
  heading.dataset.arrivalBound = "true";
  const arrive = () => {
    if (view.location?.hash !== "#deployment-status-title") return;
    heading.focus();
  };
  view.addEventListener("hashchange", arrive);
  arrive();
}

// Keep the failure message independent of the page's module graph: the
// authored last-verified record stays, and only its status line says the
// refresh failed (REPOSITORY_PROOF_FAILED, pinned equal by its test).
export async function bootReleases(root, load = () => import("./releases-page.js")) {
  bindDeploymentArrival(root);
  try {
    await load();
  } catch {
    const proof = root.querySelector("#repository-proof");
    if (proof?.dataset.state === "loading") {
      proof.dataset.state = "failed";
      root.querySelector("#repository-proof-status").textContent = "Refreshing this record from the repository failed, so it shows the proof last verified on 25 September 2026.";
    }
    const panel = root.querySelector("#shipped-build");
    if (!panel || panel.dataset.shippedBuild !== "loading") return;
    panel.dataset.shippedBuild = "failed";
    root.querySelector("#shipped-build-note").textContent = "The deployment record could not load. Reload this page to try again.";
  }
}

if (typeof document !== "undefined") bootReleases(document);
