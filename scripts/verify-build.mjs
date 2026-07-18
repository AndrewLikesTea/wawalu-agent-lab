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

  const required = new Set(["social.html", "social-page.js", "social.js", "social-demo-data.json"]);
  const paths = new Set(actual.map(({ path }) => path));
  for (const path of required) if (!paths.has(path)) throw new Error(`missing social UI asset: ${path}`);

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
