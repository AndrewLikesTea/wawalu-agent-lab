// Contract, fixture, and evaluator tests for the browser-only compatibility
// check (#927). Almost everything here goes at the pure evaluator directly:
// the harness models no layout and its selects accept values a real control
// refuses, so a DOM assertion proves less than a verdict assertion does.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BROWSER_COMPAT_MANIFEST, DEGRADED_CODES, FIELD_ROLES, MANIFEST_VERSION,
  PRIVACY_POLICY, UNSUPPORTED_CODES, contractById,
} from "../src/browser-compat-contracts.js";
import {
  BROWSER_COMPAT_FIXTURES, FIXTURE_REFERENCE_DATE, UNRECOGNIZED_FIXTURE,
  fixturesForProvider,
} from "../src/browser-compat-fixtures.js";
import {
  ELIGIBILITY_STATUS, NO_MATCH_CODE, detectContract, evaluateExport, parseExportText,
} from "../src/browser-compat-eligibility.js";
import {
  VERDICT_EMPTY_COPY, bindBrowserCompatCheck, initBrowserCompatCheck,
  renderBrowserCompatContracts, renderBrowserCompatVerdict,
} from "../src/browser-compat-view.js";
import { createElement, tags } from "./support/dom.js";

const { contracts } = BROWSER_COMPAT_MANIFEST;

const check = (fixture, options = {}) => evaluateExport(
  parseExportText(fixture.text, fixture.fileName),
  { referenceDate: FIXTURE_REFERENCE_DATE, ...options });

const forProvider = (fixture) => check(fixture, { expectedProviderId: fixture.providerId });

// ------------------------------------------------------- manifest invariants

test("every contract carries the whole shape, in one field vocabulary", () => {
  assert.match(MANIFEST_VERSION, /^browser-compatibility-contracts\/\d+\.\d+\.\d+$/);
  assert.equal(contracts.length, 3);
  assert.deepEqual(contracts.map(({ providerId }) => providerId),
    ["bedrock", "vertex-ai", "azure-openai"]);
  const roles = new Set(Object.values(FIELD_ROLES));
  for (const contract of contracts) {
    for (const key of ["providerId", "displayName", "contractVersion", "description",
      "exportShape", "requiredFields", "optionalFields", "unsupportedCases",
      "degradedCases", "localOnlyHandling"]) {
      assert.ok(contract[key], `${contract.providerId} is missing ${key}`);
    }
    // Independent of the manifest version on purpose: one provider's shape must
    // be able to revise without bumping the format everything else is read at.
    assert.match(contract.contractVersion, /^\d+\.\d+\.\d+$/);
    assert.notEqual(contract.contractVersion, MANIFEST_VERSION);
    const { format, topLevelStructure, recordLocation, signatureFields,
      freshnessWindowDays } = contract.exportShape;
    assert.ok(["csv", "json", "jsonl"].includes(format));
    assert.ok(topLevelStructure.length > 20 && recordLocation.length > 10);
    assert.ok(signatureFields.length >= 2);
    assert.ok(Number.isInteger(freshnessWindowDays) && freshnessWindowDays > 0);
    // One vocabulary, not three: every declared role is from the closed set and
    // every role the evaluator reasons about is declared exactly once.
    const declared = contract.requiredFields.map(({ role }) => role);
    assert.deepEqual([...declared].sort(), [...roles].sort());
    for (const field of [...contract.requiredFields, ...contract.optionalFields]) {
      assert.ok(field.path && field.type && field.meaning, `${contract.providerId} field is thin`);
      assert.ok(roles.has(field.role));
    }
    for (const optional of contract.optionalFields) {
      assert.ok(optional.degradesWithout.length > 20,
        `${optional.path} must say what degrades without it`);
    }
    for (const key of ["read", "retained", "discarded"]) {
      assert.ok(contract.localOnlyHandling[key].length > 20);
    }
  }
});

test("case codes are stable, unique within a contract, and complete", () => {
  for (const contract of contracts) {
    const unsupported = contract.unsupportedCases.map(({ code }) => code);
    const degraded = contract.degradedCases.map(({ code }) => code);
    assert.equal(new Set(unsupported).size, unsupported.length, "duplicate unsupported code");
    assert.equal(new Set(degraded).size, degraded.length, "duplicate degraded code");
    assert.deepEqual([...unsupported].sort(), [...Object.values(UNSUPPORTED_CODES)].sort());
    assert.deepEqual([...degraded].sort(), [...Object.values(DEGRADED_CODES)].sort());
    for (const entry of contract.unsupportedCases) {
      assert.ok(entry.reason.length > 20 && entry.remedy.length > 20,
        `${contract.providerId}/${entry.code} needs a reason and a remedy`);
    }
    for (const entry of contract.degradedCases) {
      assert.ok(entry.signal.length > 20 && entry.behavior.length > 20);
      // Reordering is enumerated with the other non-ideal shapes but is NOT a
      // confidence reduction, and the manifest has to say which it is.
      assert.ok([ELIGIBILITY_STATUS.DEGRADED, ELIGIBILITY_STATUS.SUPPORTED]
        .includes(entry.resultStatus));
    }
    assert.equal(contractById(contract.providerId), contract);
  }
});

test("the privacy prohibitions are on the manifest, keyed and stated", () => {
  assert.deepEqual(PRIVACY_POLICY.prohibitions.map(({ key }) => key), [
    "no_credentials", "no_customer_data_transmitted", "no_body_retention",
    "no_live_provider_calls", "local_parse_only",
  ]);
  assert.equal(BROWSER_COMPAT_MANIFEST.privacyPolicy, PRIVACY_POLICY);
  for (const rule of PRIVACY_POLICY.prohibitions) {
    assert.ok(rule.statement.length > 30, `${rule.key} needs a human-readable statement`);
  }
  assert.match(PRIVACY_POLICY.positiveStatement, /parsed in this browser tab/i);
  assert.match(PRIVACY_POLICY.positiveStatement, /leaves this page/i);
  assert.ok(PRIVACY_POLICY.prohibitedFieldNames.includes("prompt"));
  assert.ok(BROWSER_COMPAT_MANIFEST.generatedFor.includes("evolution.html"));
});

test("every declared case has at least one fixture, and every fixture a case", () => {
  for (const contract of contracts) {
    const fixtures = fixturesForProvider(contract.providerId);
    const declared = [...contract.unsupportedCases, ...contract.degradedCases]
      .map(({ code }) => code);
    for (const code of declared) {
      assert.equal(fixtures.filter((fixture) => fixture.caseCode === code).length, 1,
        `${contract.providerId} needs exactly one fixture for ${code}`);
    }
    assert.equal(fixtures.filter((fixture) => fixture.caseCode === null).length, 1,
      `${contract.providerId} needs one representative supported fixture`);
    assert.equal(fixtures.length, declared.length + 1);
  }
  assert.equal(BROWSER_COMPAT_FIXTURES.length, 30);
});

test("fixtures are deterministic and carry no conversation or customer data", () => {
  const forbidden = /Date\.now|Math\.random|new Date\(\)/;
  const source = String(BROWSER_COMPAT_FIXTURES.map((fixture) => fixture.text).join("\n"));
  assert.doesNotMatch(source, forbidden);
  // Every date in every fixture is a written-down calendar day.
  for (const day of source.match(/\d{4}-\d{2}-\d{2}/g) ?? []) {
    assert.match(day, /^2026-0[57]-\d{2}$/, `${day} is not one of the pinned fixture days`);
  }
  // The prompt-content fixtures carry the FIELD, never a body in it.
  for (const fixture of BROWSER_COMPAT_FIXTURES) {
    assert.doesNotMatch(fixture.text, /@|Dear |Please write|Summarize the/,
      `${fixture.id} looks like it carries real content`);
  }
  assert.match(FIXTURE_REFERENCE_DATE, /^\d{4}-\d{2}-\d{2}$/);
});

// ------------------------------------------------------------- the evaluator

test("detection is driven by the manifest's declared shape", () => {
  for (const contract of contracts) {
    const supported = fixturesForProvider(contract.providerId)
      .find((fixture) => fixture.caseCode === null);
    const parsed = parseExportText(supported.text, supported.fileName);
    assert.equal(parsed.format, contract.exportShape.format);
    // No expectedProviderId: attribution comes from format plus signature
    // fields alone, which is the only place provider knowledge lives.
    assert.equal(detectContract(parsed).providerId, contract.providerId);
  }
});

test("each representative export is supported, for the right provider", () => {
  for (const contract of contracts) {
    const supported = fixturesForProvider(contract.providerId)
      .find((fixture) => fixture.caseCode === null);
    const verdict = forProvider(supported);
    assert.equal(verdict.status, ELIGIBILITY_STATUS.SUPPORTED, supported.id);
    assert.equal(verdict.providerId, contract.providerId);
    assert.equal(verdict.contractVersion, contract.contractVersion);
    assert.equal(verdict.code, null);
    assert.equal(verdict.skippedRows, 0);
    assert.equal(verdict.acceptedRows, 3);
    assert.equal(verdict.cases.length, 0);
    assert.equal(verdict.freshnessEvaluated, true);
  }
});

test("every unsupported fixture is rejected with its exact declared code", () => {
  const unsupported = BROWSER_COMPAT_FIXTURES.filter((fixture) =>
    Object.values(UNSUPPORTED_CODES).includes(fixture.caseCode));
  assert.equal(unsupported.length, 15);
  for (const fixture of unsupported) {
    const verdict = forProvider(fixture);
    assert.equal(verdict.status, ELIGIBILITY_STATUS.REJECTED, fixture.id);
    assert.equal(verdict.code, fixture.caseCode, fixture.id);
    assert.equal(verdict.providerId, fixture.providerId, fixture.id);
    const declared = contractById(fixture.providerId).unsupportedCases
      .find(({ code }) => code === fixture.caseCode);
    assert.equal(verdict.reason, declared.reason);
    assert.equal(verdict.remedy, declared.remedy);
  }
});

test("a wrong-provider export names the contract it actually matched", () => {
  const fixture = BROWSER_COMPAT_FIXTURES
    .find(({ id }) => id === `bedrock-${UNSUPPORTED_CODES.WRONG_PROVIDER}`);
  const verdict = forProvider(fixture);
  assert.equal(verdict.detectedProviderId, "vertex-ai");
  assert.equal(verdict.detectedDisplayName, "Google Vertex AI");
  assert.equal(verdict.providerId, "bedrock");
});

test("prompt-carrying exports are refused on privacy grounds, before any row is read", () => {
  for (const providerId of ["bedrock", "vertex-ai", "azure-openai"]) {
    const fixture = BROWSER_COMPAT_FIXTURES
      .find(({ id }) => id === `${providerId}-${UNSUPPORTED_CODES.PROMPT_CONTENT}`);
    const verdict = forProvider(fixture);
    assert.equal(verdict.code, UNSUPPORTED_CODES.PROMPT_CONTENT);
    assert.match(verdict.reason, /privacy grounds/);
    assert.ok(PRIVACY_POLICY.prohibitedFieldNames.includes(verdict.prohibitedField));
    // The offending value is never carried into the verdict.
    assert.doesNotMatch(JSON.stringify(verdict), /withheld/);
  }
});

test("every degraded fixture is degraded, with the expected code and count", () => {
  const expected = {
    [DEGRADED_CODES.PARTIAL]: { missingDays: 1, acceptedRows: 2, skippedRows: 0 },
    [DEGRADED_CODES.STALE]: { ageDays: 90, acceptedRows: 3, skippedRows: 0 },
    [DEGRADED_CODES.MALFORMED_ROWS]: { skippedRows: 1, acceptedRows: 3, missingDays: 0 },
  };
  const degraded = BROWSER_COMPAT_FIXTURES.filter((fixture) =>
    fixture.caseCode !== null && fixture.caseCode !== DEGRADED_CODES.REORDERED
    && Object.values(DEGRADED_CODES).includes(fixture.caseCode));
  assert.equal(degraded.length, 9);
  for (const fixture of degraded) {
    const verdict = forProvider(fixture);
    assert.equal(verdict.status, ELIGIBILITY_STATUS.DEGRADED, fixture.id);
    assert.equal(verdict.code, fixture.caseCode, fixture.id);
    assert.equal(verdict.cases.length, 1, `${fixture.id} fired more than one degradation`);
    for (const [key, value] of Object.entries(expected[fixture.caseCode])) {
      assert.equal(verdict[key], value, `${fixture.id} ${key}`);
    }
  }
});

test("a stale export reports the pinned date, not a wall-clock age", () => {
  const fixture = BROWSER_COMPAT_FIXTURES.find(({ id }) => id === `bedrock-${DEGRADED_CODES.STALE}`);
  const at = (referenceDate) => check(fixture, { referenceDate, expectedProviderId: "bedrock" });
  assert.equal(at(FIXTURE_REFERENCE_DATE).latestRecordDate, "2026-05-03");
  assert.equal(at(FIXTURE_REFERENCE_DATE).ageDays, 90);
  // Inside the 35-day window against an earlier reference date: same file, same
  // parse, different reference, and the verdict follows the reference.
  const fresh = at("2026-05-20");
  assert.equal(fresh.status, ELIGIBILITY_STATUS.SUPPORTED);
  assert.equal(fresh.ageDays, 17);
  // Omitting the reference date evaluates no freshness rather than inventing one.
  const unmeasured = evaluateExport(parseExportText(fixture.text, fixture.fileName),
    { expectedProviderId: "bedrock" });
  assert.equal(unmeasured.freshnessEvaluated, false);
  assert.equal(unmeasured.ageDays, null);
  assert.equal(unmeasured.status, ELIGIBILITY_STATUS.SUPPORTED);
});

test("reordered records reach the same accepted verdict as chronological ones", () => {
  for (const contract of contracts) {
    const fixtures = fixturesForProvider(contract.providerId);
    const chronological = forProvider(fixtures.find((fixture) => fixture.caseCode === null));
    const reordered = forProvider(fixtures
      .find((fixture) => fixture.caseCode === DEGRADED_CODES.REORDERED));
    assert.equal(reordered.status, chronological.status, contract.providerId);
    assert.equal(reordered.status, ELIGIBILITY_STATUS.SUPPORTED);
    assert.equal(reordered.code, null);
    assert.equal(reordered.acceptedRows, chronological.acceptedRows);
    assert.equal(reordered.latestRecordDate, chronological.latestRecordDate);
    assert.equal(reordered.missingDays, 0);
    // Recognized and reported, but as a note rather than a degradation.
    assert.deepEqual(reordered.notes.map(({ code }) => code), [DEGRADED_CODES.REORDERED]);
    assert.equal(reordered.cases.length, 0);
  }
});

test("an export matching no contract says so, and is not attributed by guess", () => {
  const verdict = check(UNRECOGNIZED_FIXTURE);
  assert.equal(verdict.status, ELIGIBILITY_STATUS.NO_MATCH);
  assert.equal(verdict.code, NO_MATCH_CODE);
  assert.equal(verdict.providerId, null);
  assert.match(verdict.reason, /not been attributed to the closest-looking provider/);
  // Naming a provider does not make an unrecognized file that provider's.
  const insisted = check(UNRECOGNIZED_FIXTURE, { expectedProviderId: "bedrock" });
  assert.equal(insisted.status, ELIGIBILITY_STATUS.NO_MATCH);
  assert.equal(insisted.providerId, null);
});

// ----------------------------------------------------------------- surface

function fakeDocument(idList) {
  const registry = Object.fromEntries(idList.map((id) => {
    const element = createElement("div");
    element.id = id;
    return [id, element];
  }));
  return { createElement, getElementById: (id) => registry[id] ?? null, registry };
}

const SURFACE_IDS = ["browser-compat-contracts", "browser-compat-privacy",
  "browser-compat-count", "browser-compat-provider", "browser-compat-example",
  "browser-compat-run", "browser-compat-verdict"];

test("the eligibility surface is generated from the manifest, provider by provider", () => {
  const doc = fakeDocument(SURFACE_IDS);
  assert.equal(renderBrowserCompatContracts(doc), true);
  const root = doc.registry["browser-compat-contracts"];
  assert.equal(root.dataset.contractCount, "3");
  assert.equal(root.children.length, contracts.length);
  assert.deepEqual(root.children.map((card) => card.dataset.providerId),
    contracts.map(({ providerId }) => providerId));
  for (const [index, contract] of contracts.entries()) {
    const card = root.children[index];
    const text = card.textContent;
    assert.ok(text.includes(contract.displayName));
    assert.ok(text.includes(`Contract v${contract.contractVersion}`));
    assert.ok(text.includes(contract.exportShape.format.toUpperCase()));
    for (const field of contract.requiredFields) assert.ok(text.includes(field.path));
    // Every rejection is shown with the remedy that goes with it.
    const remedies = tags(card, "DD");
    assert.deepEqual(remedies.map((node) => node.dataset.code),
      contract.unsupportedCases.map(({ code }) => code));
  }
  // A fourth contract appears with no page edit and no edit to the view.
  const extended = { ...BROWSER_COMPAT_MANIFEST,
    contracts: [...contracts, { ...contracts[0], providerId: "fourth" }] };
  renderBrowserCompatContracts(doc, extended);
  assert.equal(root.children.length, 4);
  assert.equal(doc.registry["browser-compat-count"].textContent, "4 versioned contracts");
});

test("the privacy prohibitions are rendered with their stable keys", () => {
  const doc = fakeDocument(SURFACE_IDS);
  renderBrowserCompatContracts(doc);
  const list = doc.registry["browser-compat-privacy"];
  assert.equal(list.children.length, PRIVACY_POLICY.prohibitions.length + 1);
  assert.deepEqual(list.children.slice(1).map((item) => item.dataset.key),
    PRIVACY_POLICY.prohibitions.map(({ key }) => key));
});

test("the untouched verdict state is not a clean bill of health", () => {
  const doc = fakeDocument(SURFACE_IDS);
  assert.equal(initBrowserCompatCheck(doc), true);
  const verdict = doc.registry["browser-compat-verdict"];
  assert.equal(verdict.dataset.state, "empty");
  assert.equal(verdict.dataset.status, "none");
  assert.match(verdict.textContent, /No export has been checked yet/);
  assert.doesNotMatch(verdict.textContent, /no problems|supported|eligible/i);
  assert.equal(VERDICT_EMPTY_COPY, verdict.textContent);
  // Both choosers are filled from data, and the provider chooser from the manifest.
  assert.equal(doc.registry["browser-compat-provider"].children.length, contracts.length);
  assert.equal(doc.registry["browser-compat-example"].children.length,
    fixturesForProvider("bedrock").length);
  assert.equal(doc.registry["browser-compat-example"].value, "bedrock-supported");
});

test("running the check on a bundled example paints a distinguishable verdict", () => {
  const doc = fakeDocument(SURFACE_IDS);
  initBrowserCompatCheck(doc);
  assert.equal(bindBrowserCompatCheck(doc, ({ text, fileName, providerId, bundled }) => {
    assert.equal(bundled, true);
    return evaluateExport(parseExportText(text, fileName),
      { referenceDate: FIXTURE_REFERENCE_DATE, expectedProviderId: providerId });
  }), true);
  const verdict = doc.registry["browser-compat-verdict"];
  doc.registry["browser-compat-example"].value = `bedrock-${UNSUPPORTED_CODES.ROLLUP_ONLY}`;
  doc.registry["browser-compat-run"].dispatch("click");
  assert.equal(verdict.dataset.state, "checked");
  assert.equal(verdict.dataset.status, ELIGIBILITY_STATUS.REJECTED);
  assert.equal(verdict.dataset.code, UNSUPPORTED_CODES.ROLLUP_ONLY);
  assert.match(verdict.textContent, /not eligible/);
  assert.match(verdict.textContent, /bundled example/);
  // The remedy travels with the rejection, not just the reason.
  assert.match(verdict.textContent, /resource level/);

  doc.registry["browser-compat-example"].value = `bedrock-${DEGRADED_CODES.MALFORMED_ROWS}`;
  doc.registry["browser-compat-run"].dispatch("click");
  assert.equal(verdict.dataset.status, ELIGIBILITY_STATUS.DEGRADED);
  assert.match(verdict.textContent, /reduced confidence/);
  assert.match(verdict.textContent, /1 record\(s\) skipped/);

  // A value a real select would refuse paints nothing rather than a wrong verdict.
  doc.registry["browser-compat-example"].value = "not-a-fixture";
  doc.registry["browser-compat-run"].dispatch("click");
  assert.equal(verdict.dataset.status, ELIGIBILITY_STATUS.DEGRADED);
});

test("the verdict region is a live region and is never inside the disclosure", async () => {
  const page = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const section = page.slice(page.indexOf('id="browser-compat"'), page.indexOf('id="intake-confidence"'));
  const verdictAt = section.indexOf('id="browser-compat-verdict"');
  const disclosureEnd = section.indexOf("</details>", section.indexOf('id="browser-compat-disclosure"'));
  assert.ok(verdictAt > disclosureEnd,
    "the verdict must sit after the disclosure closes, not inside it");
  assert.match(section.slice(verdictAt - 200, verdictAt + 200), /role="status"/);
  assert.match(section.slice(verdictAt - 200, verdictAt + 200), /aria-live="polite"/);
  // The markup ships the empty state, so a reader with JavaScript off is not
  // told the check found nothing wrong.
  assert.ok(section.includes("No export has been checked yet"));
  assert.equal(section.includes("no problems found"), false);
  // Nothing in the markup names a provider: the cards are all manifest-painted.
  for (const contract of contracts) {
    assert.equal(section.includes(`>${contract.displayName}<`), false,
      `${contract.displayName} is hardcoded in evolution.html`);
  }
});

test("renderBrowserCompatVerdict states the degradation and the supported case differently", () => {
  const doc = fakeDocument(SURFACE_IDS);
  const supported = forProvider(BROWSER_COMPAT_FIXTURES.find(({ id }) => id === "vertex-ai-supported"));
  renderBrowserCompatVerdict(doc, supported, { sourceLabel: "bundled example" });
  const node = doc.registry["browser-compat-verdict"];
  assert.equal(node.dataset.state, "checked");
  assert.match(node.textContent, /Recognized · supported/);
  assert.match(node.textContent, /3 of 3 records read cleanly/);

  const stale = forProvider(BROWSER_COMPAT_FIXTURES
    .find(({ id }) => id === `vertex-ai-${DEGRADED_CODES.STALE}`));
  renderBrowserCompatVerdict(doc, stale, { sourceLabel: "bundled example" });
  assert.match(node.textContent, /latest record 2026-05-03, 90 days/);
  assert.match(node.textContent, /freshness window 35 days/);
});
