import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createManifest, verifyArtifact } from "./verify-build.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const previous = resolve(root, ".shiplog-dist-previous");
const stagingRoot = await mkdtemp(resolve(root, ".shiplog-build-"));
const staging = resolve(stagingRoot, basename(output));
let previousExists = false;

try {
  await mkdir(staging, { recursive: true });
  await cp(resolve(root, "src"), staging, { recursive: true });
  // Ship the reviewed schemas, compatibility metadata, and synthetic fixtures.
  // No integration credential, transport, or live customer/provider data exists.
  for (const integration of ["hris-org", "provider-usage-billing", "query-sample",
    "conversation-export", "provider-export-package"]) {
    await cp(
      resolve(root, "contracts", "integrations", integration, "v1"),
      resolve(staging, "contracts", "integrations", integration, "v1"),
      { recursive: true },
    );
  }
  await cp(
    resolve(root, "contracts", "integrations", "browser-compatibility"),
    resolve(staging, "contracts", "integrations", "browser-compatibility"),
    { recursive: true },
  );
  // The import surface links the contract it consumes, so the contract has to
  // be reachable from the deployed origin rather than only from the repository.
  for (const page of [
    "conversation-export-import-contract.md",
    "provider-export-package-contract.md",
  ]) {
    await cp(resolve(root, "docs", page), resolve(staging, "docs", page));
  }
  await createManifest(staging);
  await verifyArtifact(staging);

  // Promotion happens only after the complete artifact passes its health and
  // integrity checks. Production deployment remains owned by protected CI.
  await rm(previous, { recursive: true, force: true });
  try {
    await rename(output, previous);
    previousExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(staging, output);
  } catch (error) {
    if (previousExists) await rename(previous, output);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
  previousExists = false;
  console.log("built and verified immutable dist/");
} finally {
  if (previousExists) {
    await rm(output, { recursive: true, force: true });
    await rename(previous, output);
  }
  await rm(stagingRoot, { recursive: true, force: true });
}
