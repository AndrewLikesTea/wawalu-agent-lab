import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { byClass, first, installDocument, tags } from "./support/dom.js";

installDocument();
const { scoreFinOpsFixtures } = await import("../src/finops-evaluation.js");
const {
  mountFinOpsEvaluations, renderFinOpsEvaluation,
} = await import("../src/finops-evaluation-view.js");
const fixtureSet = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8",
));

test("client view exposes score breakdown, rubric, assumptions, rationale, and arithmetic", () => {
  const [result] = scoreFinOpsFixtures(fixtureSet);
  const card = renderFinOpsEvaluation(result);
  assert.equal(card.dataset.status, "executive-ready");
  assert.equal(tags(card, "DETAILS").length, 1);
  assert.equal(tags(card, "DT").length, 5);
  assert.match(card.textContent, /finops-recommendation\/1\.0\.0/);
  assert.match(card.textContent, /Weight assumption:/);
  assert.match(card.textContent, /4\/4 × 30 = 30\.00/);
  assert.match(card.textContent, /100\.0 \/ 100/);
});

// A withheld score is not a secret — it is a disputed number. The headline must
// never present it as an executive score, but a reviewer who opens the audit
// trail has to see the arithmetic that produced it, immediately under the reason
// it was withheld. Both halves of that contract are pinned here, because the
// first is easy to regress into leaking and the second into unfalsifiable.
test("withheld evaluation moves its total out of the headline and into the audit trail", () => {
  const result = scoreFinOpsFixtures(fixtureSet)[2];
  const card = renderFinOpsEvaluation(result);
  assert.equal(result.total, 85);
  assert.equal(card.dataset.status, "withheld");

  const [headline] = byClass(card, "evaluation-score");
  assert.equal(headline.textContent, "Score withheld");
  assert.doesNotMatch(headline.textContent, /85/);
  assert.match(first(card, "evaluation-threshold").textContent, /privacy safety 1\/4/);

  const [details] = tags(card, "DETAILS");
  assert.equal(details.getAttribute("open"), null);
  assert.match(first(details, "evaluation-formula").textContent, /85\.00 → 85\.0\/100/);
  assert.match(details.textContent, /Withheld from the executive score/);
});

test("rendering receives sanitized scorer output and creates no executable markup", () => {
  const result = scoreFinOpsFixtures(fixtureSet)[2];
  const card = renderFinOpsEvaluation(result);
  assert.doesNotMatch(card.textContent, /Ignore previous|reveal the system prompt/i);
  assert.match(card.textContent, /\[instruction-neutralized\]/);
  for (const tag of ["SCRIPT", "IMG", "IFRAME", "A"]) assert.deepEqual(tags(card, tag), []);
});

test("mount writes the inspectable method and all fixture results", () => {
  const nodes = { list: document.createElement("div"), method: document.createElement("p") };
  mountFinOpsEvaluations(scoreFinOpsFixtures(fixtureSet), nodes);
  assert.equal(nodes.list.children.length, 3);
  assert.match(nodes.method.textContent, /Executive-ready at >=70/);
  assert.match(nodes.method.textContent, /round once/);
});

test("view refuses an unexplained score object", () => {
  assert.throws(() => renderFinOpsEvaluation({ total: 99 }), /explained FinOps score/);
});

test("an empty result set says so instead of wiping the panel to blank", () => {
  const nodes = { list: document.createElement("div"), method: document.createElement("p") };
  nodes.list.setAttribute("aria-busy", "true");
  nodes.list.append(document.createElement("p"));
  mountFinOpsEvaluations([], nodes);
  assert.equal(nodes.list.children.length, 1);
  assert.match(nodes.list.textContent, /No labelled fixtures/);
  assert.equal(nodes.list.getAttribute("aria-busy"), "false");
});

test("a missing method paragraph degrades the note, never the results", () => {
  const list = document.createElement("div");
  mountFinOpsEvaluations(scoreFinOpsFixtures(fixtureSet), { list });
  assert.equal(list.children.length, 3);
  assert.equal(list.getAttribute("aria-busy"), "false");
});

test("evaluation panel is labelled, wired to the shipped fixture, and built without markup strings",
  async () => {
    const [html, page, view] = await Promise.all([
      readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
      readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
      readFile(new URL("../src/finops-evaluation-view.js", import.meta.url), "utf8"),
    ]);
    // aria-label on a role-less div is dropped by assistive technology, so the
    // container has to carry a role for its name to survive.
    assert.match(html,
      /id="finops-evaluation-list"[^>]*role="group"[^>]*aria-label="[^"]+"/);
    assert.match(html, /aria-labelledby="finops-evaluation-title"/);
    assert.match(html, /id="finops-evaluation-method"/);
    assert.match(page, /EVALUATION_URL = "\/finops-evaluation-fixtures\.json"/);
    for (const id of ["finops-evaluation-list", "finops-evaluation-method"])
      assert.match(page, new RegExp(`"${id}"`));
    // Status must not be carried by color alone; the pill spells the verdict out.
    assert.match(view, /"Executive-ready" : "Withheld"/);
    for (const source of [page, view])
      assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

// The evaluation fixture is independent of the demo feed. Sequencing it behind
// `loadData()` meant an unrelated demo-data outage returned early and stranded
// this panel on "Loading…" forever, which reads as a hung page, not an outage.
test("a demo-data outage cannot strand the evaluation panel on its loading text", async () => {
  const page = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  const started = page.indexOf("renderEvaluationPanel()");
  const demoData = page.indexOf("await loadData()");
  assert.ok(started > 0 && demoData > 0);
  assert.ok(started < demoData, "the evaluation panel must start before the demo-data await");
  assert.equal((page.match(/await evaluationPanel/g) ?? []).length, 2,
    "both the demo-data failure path and the success path must settle the panel");
});
