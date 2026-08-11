import test from "node:test";
import assert from "node:assert/strict";
import {
  formatReaderVocabularyViolations, readerVocabularyViolations,
} from "../scripts/check-finops-reader-vocabulary.mjs";

test("a reader-visible name/version heading fails with its location and replacement", () => {
  const html = "<main>\n<h1>Use executive-briefing/1.0.0 today</h1>\n</main>";
  const violations = readerVocabularyViolations(html, "evolution.html");
  assert.deepEqual(violations, [{
    file: "evolution.html",
    line: 2,
    token: "executive-briefing/1.0.0",
    replacement: "Executive briefing payload",
  }]);
  assert.equal(formatReaderVocabularyViolations(violations),
    'evolution.html:2: reader-visible internal token "executive-briefing/1.0.0"; use "Executive briefing payload"');
});

test("audit disclosures and explicitly marked audit or code elements are excluded", () => {
  const html = `<main>
    <details data-audit-disclosure><summary>Audit</summary><p>executive-briefing/1.0.0</p></details>
    <p data-reader-copy="audit">finops-executive-projection/1.0.0</p>
    <samp data-reader-copy="code">bundled-briefing-selection/1.0.0</samp>
    <code>literacy-mix/1.0.0</code><pre>unknown-contract/1.0.0</pre>
  </main>`;
  assert.deepEqual(readerVocabularyViolations(html, "evolution.html"), []);
});

test("markup, attributes, comments, and hidden fallback text are not reader-visible", () => {
  const html = `<main data-contract="executive-briefing/1.0.0">
    <!-- finops-executive-projection/1.0.0 -->
    <p hidden>bundled-briefing-selection/1.0.0</p>
    <p>Executive briefing payload</p>
    <script>const contract = "literacy-mix/1.0.0";</script>
  </main>`;
  assert.deepEqual(readerVocabularyViolations(html, "executive-briefing.html"), []);
});
