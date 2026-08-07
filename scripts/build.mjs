import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createManifest, verifyArtifact } from "./verify-build.mjs";
import { seedFirstScreen } from "./seed-first-screen.mjs";
import { writeBuildStamp } from "./write-build-stamp.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const previous = resolve(root, ".shiplog-dist-previous");
const stagingRoot = await mkdtemp(resolve(root, ".shiplog-build-"));
const staging = resolve(stagingRoot, basename(output));
let previousExists = false;

try {
  // Which commit this build was made from, written before src/ is copied so the
  // artifact and the deployed Pages Function read the same stamp. A checkout
  // with no git metadata stamps `commitSha: null` and the build continues:
  // `/healthz` then reports `unknown` rather than a fabricated sha.
  const stamp = await writeBuildStamp();
  console.log(`stamped build ${stamp.commitSha ?? "unknown (no git metadata)"} at ${stamp.builtAt}`);
  await mkdir(staging, { recursive: true });
  await cp(resolve(root, "src"), staging, { recursive: true });
  // Ship the reviewed schemas, compatibility metadata, and synthetic fixtures.
  // No integration credential, transport, or live customer/provider data exists.
  for (const integration of ["hris-org", "provider-usage-billing", "query-sample",
    "conversation-export", "provider-export-package", "org-query-source",
    "shiplog-delivery-history", "native-provider-exports"]) {
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
    "org-query-source-contract.md",
    // Linked from the source contract above, so it has to travel with it or the
    // deployed copy links into a 404.
    "org-query-aggregate.md",
    // Linked from the delivery-history region on the import panel: the schema,
    // the version rule, and what partial, stale, malformed, reordered, and
    // period-incompatible input does, stated before a reader chooses a file.
    "shiplog-delivery-history-contract.md",
    // Linked from the provider-coverage panel: which providers may be read side
    // by side, each adapter's schema version, and what partial, stale,
    // malformed, reordered, and mixed-currency exports do.
    "multi-provider-intake-contract.md",
    // Linked from the comparability region on the same panel: the metric
    // definitions behind the verdict, the coverage benchmark, the closed field
    // set, and the rule that picks the single next action.
    "portfolio-comparability-contract.md",
    // Linked from the partial-evidence finding on the same panel: what makes a
    // record admissible, how a partial floor is summed, the priority order that
    // picks the single next action, and why no peer comparison is measured there.
    "partial-evidence-policy.md",
  ]) {
    await cp(resolve(root, "docs", page), resolve(staging, "docs", page));
  }
  // The AI FinOps first screen, rendered from the modules that own its figures
  // rather than left as the pending state the source authors (#944). It happens
  // against the staging copy and before the manifest, so what is hashed,
  // verified and served is the seeded document — and `src/evolution.html` stays
  // the authored pending scaffold, which is still what a paint falls back to.
  const seeded = await seedFirstScreen(staging);
  console.log(`seeded ${seeded.slots} first-screen slots into evolution.html `
    + `(${seeded.bytes >= 0 ? "+" : ""}${seeded.bytes} bytes)`);
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
