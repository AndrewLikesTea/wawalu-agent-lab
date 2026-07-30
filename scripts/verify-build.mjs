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
    // The workspace rail is a hard import of the AI FinOps entry. If a narrowed
    // artifact omits it, the browser rejects the entire entry module before any
    // destination can be painted or bound.
    "finops-workspace-nav.js",
    // Organizational artifacts are parsed, minimized, aggregated, and scored in
    // the browser. Treat that chain and its published contracts as one deployable
    // unit: a partial artifact would only fail after a reader selected a file.
    "org-query-source.js", "org-query-aggregate.js", "org-query-scoring.js",
    "org-query-scoring-fixtures.js",
    "contracts/integrations/org-query-source/v1/fixtures/organizational-sample.json",
    "docs/org-query-source-contract.md", "docs/org-query-aggregate.md",
    // The department drill-down is painted by these live views. Both are direct
    // imports of the AI FinOps entry module, so dropping either from a narrowed
    // artifact prevents that entry module from evaluating and leaves the fix
    // pack and its evidence in their static loading states.
    "department-evidence-view.js", "department-fix-pack-view.js",
    // The import guidance in evolution.html is only the static first paint.
    // These modules render the staged picker, recovery actions, load status,
    // and guided result that must use the same input contract after scripts
    // load. Treat the set as one deployable surface so a narrowed copy rule
    // fails before Pages can ship a half-static import flow.
    "local-import-flow.js", "finops-load-status.js",
    // The delivery-history intake: its parser, the substring-run leak detector
    // the parser refuses identifier-derived labels with, and the view that paints
    // the accepted, floor, and refused states. The entry imports all three, so a
    // narrowed artifact would be a rejected entry module rather than one missing
    // panel — and the published contract is what a reader consults before
    // choosing a file.
    "shiplog-delivery-history.js", "shiplog-delivery-history-view.js", "identifier-leak.js",
    "contracts/integrations/shiplog-delivery-history/v1/manifest.json",
    "docs/shiplog-delivery-history-contract.md",
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
    // The briefing's printable surface. The entry imports the contract, the
    // view, and the in-bundle synthetic sample, so any one of these missing is a
    // rejected entry module — a page stuck in its loading state — and the
    // stylesheet is what removes the site chrome from a printed briefing.
    "executive-briefing.html", "executive-briefing-page.js",
    "executive-briefing-view.js", "executive-briefing.css",
    // The empty-state sample now ships as a module the entry imports rather than
    // a file it fetches, so a reader with nothing retained sees a whole briefing
    // on the first screen instead of a request that may never land. A dropped
    // one is a rejected entry module: the common first visit paints nothing.
    "executive-briefing-sample.js",
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
    // The front door leads with one AI FinOps decision summary, so the summary
    // is part of the home page rather than an enhancement on it. Its entry
    // imports the composer, the composer imports the contract and the in-bundle
    // synthetic sample, and the view draws it — a dropped one of these is a
    // rejected entry module and a landing page whose first screen never gets
    // past its building state. The stylesheet is what keeps the rest of the
    // page off the printed sheet.
    "index.html", "landing-decision-page.js", "landing-decision.js", "landing-decision.css",
    // The canonical decision the FinOps front door answers with, and the
    // contract that derives and validates it. The fixture is the published
    // answer — the benchmark, the ranked action, the impact, the confidence, and
    // the provenance a reader quotes — so shipping the region without it is a
    // front door that asks the question and then withdraws its own confidence
    // claim, with nothing on the artifact to say why.
    "finops-decision-contract.js", "finops-decision-fixture.json",
    "finops-first-run.js", "finops-first-run-view.js",
  ]);
  const paths = new Set(actual.map(({ path }) => path));
  for (const path of required) if (!paths.has(path)) throw new Error(`missing required UI asset: ${path}`);

  // Now close the graph itself. The list above names what someone remembered to
  // name; this walks what the artifact actually asks the browser for, so a
  // narrowed copy rule fails here instead of at a reader.
  //
  // The failure it deletes is specific and silent. A module specifier that 404s
  // does not degrade to a missing feature: the browser rejects the whole entry
  // module, no line of it runs, and the page keeps whatever static markup it
  // shipped with. On the executive briefing that is a "Reading this browser's
  // own FinOps figures…" panel with `aria-busy="true"` that never resolves —
  // a page that claims to be working, forever, with the manifest, the health
  // check, and every required-asset assertion above still green.
  const dangling = [];
  for (const { path } of actual) {
    const module = path.endsWith(".js");
    if (!module && !path.endsWith(".html")) continue;
    const text = await readFile(resolve(root, path), "utf8");
    const references = module
      ? [...text.matchAll(/\bfrom\s*"(\/[^"]+)"/g), ...text.matchAll(/\bimport\s*\(\s*"(\/[^"]+)"/g)]
      : [...text.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="(\/[^"#?]+\.(?:js|css|json))"/g)];
    for (const [, reference] of references) {
      if (!paths.has(reference.slice(1))) dangling.push(`${path} -> ${reference}`);
    }
  }
  if (dangling.length > 0) {
    throw new Error(`artifact references files it does not carry: ${dangling.join(", ")}`);
  }

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

  // The empty-state sample is carried in the bundle so the briefing paints
  // without a request. Duplicated data is only safe when a drift is loud, so the
  // built module has to declare the same periods the published fixture does, and
  // has to still produce the published briefing through the same contract.
  const { sampleRetainedPeriods } = await import(
    pathToFileURL(resolve(root, "executive-briefing-sample.js")).href
  );
  const samplePeriods = JSON.parse(JSON.stringify(sampleRetainedPeriods()));
  if (JSON.stringify(samplePeriods) !== JSON.stringify(fixture?.input?.retainedPeriods)) {
    throw new Error("the bundled briefing sample and the published fixture declare different periods");
  }
  if (JSON.stringify(JSON.parse(JSON.stringify(buildExecutiveBriefing(samplePeriods))))
    !== JSON.stringify(fixture?.briefing)) {
    throw new Error("the bundled briefing sample does not rebuild the published briefing");
  }

  // The same probe for the canonical FinOps decision: the artifact's own
  // fixture has to be what the artifact's own contract derives from the
  // artifact's own bundled dataset, and it has to pass validation. A published
  // decision is a figure a director will be asked to act on, so a stale one is
  // not a cosmetic drift — it is a number with no derivation behind it, on the
  // one screen the front door leads with. Local modules and files only: no
  // environment variable, network, storage, or runtime binding is read.
  const decisionFixture = JSON.parse(await readFile(
    resolve(root, "finops-decision-fixture.json"),
    "utf8",
  ));
  const decisionUrl = pathToFileURL(resolve(root, "finops-decision-contract.js"));
  decisionUrl.searchParams.set(
    "sha256",
    actual.find(({ path }) => path === "finops-decision-contract.js").sha256,
  );
  const { deriveDecisionRecord, validateDecisionRecord } = await import(decisionUrl.href);
  const { loadExampleDataset } = await import(
    pathToFileURL(resolve(root, "example-dataset.js")).href
  );
  const { buildFinopsBriefing } = await import(
    pathToFileURL(resolve(root, "finops-briefing-contract.js")).href
  );
  const analysis = loadExampleDataset();
  const derivedDecision = JSON.parse(JSON.stringify(
    deriveDecisionRecord(analysis, buildFinopsBriefing(analysis)),
  ));
  if (JSON.stringify(derivedDecision) !== JSON.stringify(decisionFixture)) {
    throw new Error("canonical FinOps decision fixture does not match its artifact contract");
  }
  const decisionVerdict = validateDecisionRecord(decisionFixture);
  if (!decisionVerdict.valid) {
    throw new Error(`canonical FinOps decision fixture is invalid: ${JSON.stringify(decisionVerdict.errors)}`);
  }

  // Exercise the organizational-artifact path from the exact files Pages will
  // serve. This is intentionally local: the feature promises no request,
  // persistence, binding, or environment variable, so its production smoke
  // test must need none either.
  const orgSampleText = await readFile(resolve(
    root,
    "contracts/integrations/org-query-source/v1/fixtures/organizational-sample.json",
  ), "utf8");
  const { validateOrgQuerySource } = await import(
    pathToFileURL(resolve(root, "org-query-source.js")).href
  );
  const { orgQueryDepartmentLiteracy } = await import(
    pathToFileURL(resolve(root, "org-query-scoring.js")).href
  );
  const {
    assertOrgQueryAggregateRedacted,
    orgQueryAggregateCanonicalForm,
    orgQueryAggregateDigest,
  } = await import(pathToFileURL(resolve(root, "org-query-aggregate.js")).href);
  const orgResult = validateOrgQuerySource(orgSampleText, {
    sourceId: "representative-prompt-batch",
    fileName: "organizational-sample.json",
  });
  if (!orgResult.ok) {
    throw new Error(`organizational sample was refused by artifact parser: ${orgResult.code}`);
  }
  const literacy = orgQueryDepartmentLiteracy({ results: [orgResult] });
  if (!literacy.gradeable || !literacy.aggregate || literacy.aggregateProblem) {
    throw new Error("organizational sample did not produce a gradeable artifact aggregate");
  }
  assertOrgQueryAggregateRedacted(literacy.aggregate);
  const reversed = {
    ...literacy.aggregate,
    cells: [...literacy.aggregate.cells].reverse(),
    unclassifiedCells: [...literacy.aggregate.unclassifiedCells].reverse(),
    intakeCells: [...literacy.aggregate.intakeCells].reverse(),
  };
  if (JSON.stringify(orgQueryAggregateCanonicalForm(reversed))
      !== JSON.stringify(orgQueryAggregateCanonicalForm(literacy.aggregate))
      || orgQueryAggregateDigest(reversed) !== orgQueryAggregateDigest(literacy.aggregate)) {
    throw new Error("organizational aggregate digest is not canonical across cell ordering");
  }

  // Probe the exact first paint that Pages will serve against the modules that
  // repaint it after boot. Source tests can prove each side independently while
  // a narrowed or partially promoted artifact still carries mismatched words.
  // Keep this local and deterministic: no browser, binding, or network is
  // required for the production build to fail before deployment.
  const finopsHtml = await readFile(resolve(root, "evolution.html"), "utf8");
  const { FIRST_RUN_ACTIONS, FIRST_RUN_IDS } = await import(
    pathToFileURL(resolve(root, "finops-first-run.js")).href
  );
  const { HERO_INTRO } = await import(
    pathToFileURL(resolve(root, "finops-load-status.js")).href
  );
  const requiredFirstPaint = [
    [`#finops-intro`, `<p id="finops-intro">${HERO_INTRO}</p>`],
    [`#${FIRST_RUN_IDS.demo}`, `id="${FIRST_RUN_IDS.demo}" type="button" aria-describedby="${FIRST_RUN_IDS.demo}-note">${FIRST_RUN_ACTIONS.demo.label}</button>`],
    [`#${FIRST_RUN_IDS.demo}-note`, `id="${FIRST_RUN_IDS.demo}-note">${FIRST_RUN_ACTIONS.demo.note}</p>`],
    [`#${FIRST_RUN_IDS.import}`, `id="${FIRST_RUN_IDS.import}" type="button" aria-describedby="${FIRST_RUN_IDS.import}-note">${FIRST_RUN_ACTIONS.import.label}</button>`],
    [`#${FIRST_RUN_IDS.import}-note`, `id="${FIRST_RUN_IDS.import}-note">${FIRST_RUN_ACTIONS.import.note}</p>`],
  ];
  for (const [slot, markup] of requiredFirstPaint) {
    if (!finopsHtml.includes(markup)) {
      throw new Error(`AI FinOps first-paint copy drifted from its runtime contract at ${slot}`);
    }
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
