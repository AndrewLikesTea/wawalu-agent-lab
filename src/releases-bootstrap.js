// Focus explicit workspace and evidence destinations before asynchronous loading.
// State updates never move focus; fragment navigation does.
export function bindDeploymentArrival(root, view = globalThis.window) {
  const heading = root.querySelector("#deployment-status-title");
  if (!heading || !view || heading.dataset.arrivalBound === "true") return;
  heading.dataset.arrivalBound = "true";
  const targets = ["main-content", "top", "releases-title", "record-release",
    "shipped-build", "real-deployment", "deployment-status", "deployment-status-title",
    "shiplog-proof", "repository-proof", "evaluation-path", "reasoning-proof"];
  const focusTarget = (hash) => {
    if (!targets.some((id) => hash === `#${id}`)) return;
    root.querySelector(hash)?.focus?.({ preventScroll: true });
  };
  // Native navigation still updates the URL and scrolls; explicit focus also
  // handles repeat activation when the fragment has not changed.
  for (const link of root.querySelectorAll('a')) {
    const hash = link.getAttribute("href");
    if (targets.some((id) => hash === `#${id}`)) {
      link.addEventListener("click", () => focusTarget(hash));
    }
  }
  const arrive = () => focusTarget(view.location?.hash);
  view.addEventListener("hashchange", arrive);
  arrive();
}

// Keep the failure message independent of the page's module graph: a missing
// build-stamp module must not leave a repository-root link posing as evidence.
export async function bootReleases(root, load = () => import("./releases-page.js")) {
  bindDeploymentArrival(root);
  try {
    await load();
  } catch {
    const proof = root.querySelector("#repository-proof");
    if (proof?.dataset.state === "loading") {
      proof.dataset.state = "failed";
      root.querySelector("#repository-proof-status").textContent = "The repository record could not load, so no decision or build from it is shown here. The public Shiplog repository holds every decision and build.";
      const repo = root.querySelector("#repository-proof-repo");
      repo.setAttribute("href", "https://github.com/AndrewLikesTea/wawalu-agent-lab");
      repo.hidden = false;
    }
    const panel = root.querySelector("#shipped-build");
    if (!panel || panel.dataset.shippedBuild !== "loading") return;
    panel.dataset.shippedBuild = "failed";
    root.querySelector("#shipped-build-note").textContent = "The deployment record could not load. Reload this page to try again.";
  }
}

if (typeof document !== "undefined") bootReleases(document);
