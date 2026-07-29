import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
    // The imported briefing's peer position is evaluated and qualified across
    // these three modules. If any one is absent, the browser rejects the entry
    // module before painting the unavailable state, so this must fail before a
    // Pages deployment rather than becoming a client-side blank panel.
    "imported-executive-view.js", "imported-peer-benchmark.js", "peer-cohort-contract.js",
    // The coaching workflow's entry and everything it imports. The contract and
    // its preview are listed too: the entry imports them, so an artifact missing
    // either one is an entry the browser refuses and a coaching panel that never
    // comes to life — including the boundary a reader consults before pasting.
    "prompt-coaching-page.js", "prompt-coaching.js", "prompt-coaching-view.js",
    "prompt-coaching-contract.js", "prompt-coaching-contract-view.js",
    "prompt-literacy-rubric.json",
    // The revision loop: the comparison contract, its reading surface, and the
    // words the copy control puts on the clipboard. The coaching entry imports
    // all three, so a missing one is an entry module the browser rejects — and
    // that would take the *single-prompt* grading path down with it, not just
    // the revision step.
    "prompt-revision-comparison.js", "prompt-revision-view.js",
    "prompt-revision-summary.js",
    // The result-presentation primitives and the specimen that reviews them.
    // The entry imports the specimen view, so a missing one of these is a
    // rejected entry module and a coaching panel that never comes to life.
    "coaching-result-presentation.js", "coaching-result-view.js",
    "coaching-specimen.js", "coaching-specimen-view.js",
  ]);
  const paths = new Set(actual.map(({ path }) => path));
  for (const path of required) if (!paths.has(path)) throw new Error(`missing required UI asset: ${path}`);

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
