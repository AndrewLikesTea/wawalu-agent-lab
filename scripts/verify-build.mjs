import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MANIFEST = "build-manifest.json";

async function artifactFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await artifactFiles(root, path));
    else if (entry.isFile() && relative(root, path) !== MANIFEST) files.push(path);
  }
  return files;
}

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function inventory(root) {
  return Promise.all((await artifactFiles(root)).map(async (path) => {
    const content = await readFile(path);
    return { path: relative(root, path).replaceAll("\\", "/"), bytes: content.length, sha256: digest(content) };
  }));
}

export async function createManifest(root) {
  const manifest = { schemaVersion: 1, algorithm: "sha256", files: await inventory(root) };
  await writeFile(resolve(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

export async function verifyArtifact(root) {
  const manifest = JSON.parse(await readFile(resolve(root, MANIFEST), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.algorithm !== "sha256") throw new Error("unsupported build manifest");
  const actual = await inventory(root);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error("artifact does not match build manifest");

  const health = await readFile(resolve(root, "healthz"), "utf8");
  if (health.trim() !== "ok") throw new Error("healthz must return exactly ok");

  // Every guarded page ships with the modules that make it usable: a
  // half-published set is a blank panel in production, which the manifest alone
  // would happily attest to. Keep newly introduced entry dependencies here so
  // a build-rule change fails before Pages receives an incomplete artifact.
  const required = new Set([
    "social.html", "social-page.js", "social.js", "social-demo-data.json", "social-identity.js",
    "profile.html", "profile-page.js", "profile.js",
    "post.html", "post-page.js", "post-detail.js",
    "evolution.html", "evolution-page.js", "evolution.css",
    "finops-panel-contract.js", "finops-panel-contract-view.js", "panel-status-view.js",
    // The import guidance in evolution.html is only the static first paint.
    // These modules render the staged picker, recovery actions, load status,
    // and guided result that must use the same input contract after scripts
    // load. Treat the set as one deployable surface so a narrowed copy rule
    // fails before Pages can ship a half-static import flow.
    "local-import-flow.js", "finops-load-status.js",
    "finops-guided-result.js", "finops-guided-result-view.js",
    // The imported briefing's peer position is evaluated and qualified across
    // these three modules. If any one is absent, the browser rejects the entry
    // module before painting the unavailable state, so this must fail before a
    // Pages deployment rather than becoming a client-side blank panel.
    "imported-executive-view.js", "imported-peer-benchmark.js", "peer-cohort-contract.js",
    // The prompt coach is a destination of its own, so the page itself is an
    // asset the artifact can drop: a nav link and a home-page card that both
    // point at a route Pages does not serve is a 404 on the one surface a
    // visitor can finish something on.
    "coach.html",
    // The coaching workflow's entry and everything it imports. The contract and
    // its preview are listed too: the entry imports them, so an artifact missing
    // either one is an entry the browser refuses and a coaching panel that never
    // comes to life — including the boundary a reader consults before pasting.
    "prompt-coaching-page.js", "prompt-coaching.js", "prompt-coaching-view.js",
    "prompt-coaching-contract.js", "prompt-coaching-contract-view.js",
    // The front-door journey contract and the surface it paints. The entry
    // imports both, so a missing one is a rejected entry module — and the
    // zero-input path a visitor with nothing to paste depends on.
    "prompt-coaching-entry.js", "prompt-coaching-entry-view.js",
    "prompt-grading-eligibility.js", "prompt-literacy-scoring.js",
    "prompt-literacy-rubric.json",
    // The revision contract is a client import even before its dedicated
    // surface lands. Fail artifact verification if build selection drops it.
    "prompt-revision-comparison.js",
    // The result-presentation primitives and the specimen that reviews them.
    // The entry imports the specimen view, so a missing one of these is a
    // rejected entry module and a coaching panel that never comes to life.
    "coaching-result-presentation.js", "coaching-result-view.js",
    "coaching-specimen.js", "coaching-specimen-view.js",
    // The copyable revision summary and its control. The entry imports the view
    // and the coaching view imports it too, so a missing one of these is a
    // rejected entry module — the whole coaching panel, not just the copy
    // button, would fail to come to life.
    "coaching-summary.js", "coaching-summary-view.js",
    // This issue ships an executable contract and its canonical briefing as a
    // pair. Later presentation work consumes both from the deployed artifact;
    // silently dropping either file would leave preview/source checks green
    // while production no longer carries the reviewed contract.
    "executive-finops-briefing.js", "executive-finops-briefing-fixture.json",
    // The briefing's printable surface. The entry imports the contract and the
    // view and fetches the fixture above by path, so any one of these missing is
    // either a rejected entry module or a page stuck in its loading state — and
    // the stylesheet is what removes the site chrome from a printed briefing.
    "executive-briefing.html", "executive-briefing-page.js",
    "executive-briefing-view.js", "executive-briefing.css",
    // The entry now decides between this browser's own retained periods and the
    // published sample before it draws anything, and it imports both the chooser
    // and the workspace reader to do it. A dropped one is a rejected entry
    // module — a page stuck on its loading state with no briefing at all.
    "executive-briefing-source.js", "finops-workspace.js",
    // The personal AI-history reader is a destination of its own, and its entry
    // imports the contract, the reader, the canonical synthetic export, the
    // entry rules, and the view. A dropped one of these is a rejected entry
    // module — a page whose privacy guidance, eligibility list, and result
    // states never paint at all, on the one surface that asks a person for
    // their own history.
    "personal-history.html", "personal-history-page.js", "personal-history-view.js",
    "personal-history-entry.js", "personal-history-contract.js", "personal-history-report.js",
    "personal-history-fixture.js", "personal-history.css",
    // The bring-your-own-export intake: the archive reader the entry opens a
    // chosen ZIP with, and the source contract the "where to ask for your
    // history" panel is painted from. A dropped archive reader is a rejected
    // entry module — every chosen file refused; a dropped source contract is the
    // same, and the step before the picker gone with it.
    "personal-archive.js", "personal-export-sources.js",
    // The entry also imports the carry-forward module: it is the only module in
    // the workflow that names a storage API, so a dropped one is both a rejected
    // entry module and the page losing the comparison it promises on its own
    // published boundary.
    "personal-history-carry-forward.js",
    // The trajectory finding and the handoff that follows it. The view imports
    // both, so a dropped one is a rejected view module — a page that reads a
    // file, names a move, and then silently loses the before/after and the one
    // control that carries the move anywhere.
    "personal-history-trajectory.js", "personal-history-trajectory-view.js",
  ]);
  const paths = new Set(actual.map(({ path }) => path));
  for (const path of required) if (!paths.has(path)) throw new Error(`missing required UI asset: ${path}`);

  // Probe the artifact itself, not the source tree: the canonical sample must
  // still be reproducible and valid after the exact build selection that Pages
  // will receive. This uses no environment variables, network, storage, or
  // runtime binding.
  const fixture = JSON.parse(await readFile(
    resolve(root, "executive-finops-briefing-fixture.json"),
    "utf8",
  ));
  const contractUrl = pathToFileURL(resolve(root, "executive-finops-briefing.js"));
  contractUrl.searchParams.set(
    "sha256",
    actual.find(({ path }) => path === "executive-finops-briefing.js").sha256,
  );
  const { buildExecutiveBriefing, validateExecutiveBriefing } = await import(contractUrl.href);
  const built = JSON.parse(JSON.stringify(
    buildExecutiveBriefing(fixture?.input?.retainedPeriods),
  ));
  if (JSON.stringify(built) !== JSON.stringify(fixture?.briefing)) {
    throw new Error("executive FinOps fixture does not match its artifact contract");
  }
  const verdict = validateExecutiveBriefing(fixture.briefing);
  if (!verdict.valid) {
    throw new Error(`executive FinOps fixture is invalid: ${JSON.stringify(verdict.violations)}`);
  }

  const headers = await readFile(resolve(root, "_headers"), "utf8");
  if (!headers.includes("default-src 'none'") || !headers.includes("Permissions-Policy: camera=(), geolocation=(), microphone=()")) {
    throw new Error("least-privilege security headers are missing");
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? "dist");
  await verifyArtifact(root);
  console.log(`verified ${root}`);
}
