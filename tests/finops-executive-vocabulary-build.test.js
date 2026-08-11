import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  checkBuiltFinopsVocabulary, findFinopsVocabularyViolations,
} from "../scripts/check-finops-executive-vocabulary.mjs";

test("visible versioned internal name in a heading fails with an actionable location", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "finops-vocabulary-test-"));
  t.after(async () => (await import("node:fs/promises")).rm(directory, { recursive: true, force: true }));
  await writeFile(resolve(directory, "executive-briefing.html"),
    "<main>\n<h1>finops-peer-cohort/1.0.0 results</h1>\n</main>\n");

  await assert.rejects(
    checkBuiltFinopsVocabulary(directory, ["executive-briefing.html"]),
    /executive-briefing\.html:2: "finops-peer-cohort\/1\.0\.0"; use "the published method"/,
  );
});

test("code, audit disclosure, explicit audit/code, hidden, and non-reader text are excluded", () => {
  const html = `<main>
    <code>finops-peer-cohort/1.0.0</code>
    <section class="audit-disclosure">finops-audit-rule/1.0.0</section>
    <p data-audit>finops-audit-rule/1.0.0</p>
    <p data-code="contract">finops-code-rule/1.0.0</p>
    <p hidden>finops-hidden-rule/1.0.0</p>
    <p aria-hidden="true">finops-decorative-rule/1.0.0</p>
    <script>finops-script-rule/1.0.0</script>
  </main>`;
  assert.deepEqual(findFinopsVocabularyViolations(html), []);
});

test("ordinary visible prose is scanned while similarly named classes are not exemptions", () => {
  const violations = findFinopsVocabularyViolations(
    '<p class="support-disclosure">Use finops-pricing-provenance/2.0.0 here.</p>',
  );
  assert.deepEqual(violations, [{
    line: 1,
    token: "finops-pricing-provenance/2.0.0",
    replacement: "the published method",
  }]);
});
