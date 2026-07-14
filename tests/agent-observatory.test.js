import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { describeEvent, personaFromRef } from "../src/agents.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("agent observatory publishes named demo prompts and remains policy-protected", async () => {
  const [home, page, script, demo, policy] = await Promise.all([
    read("src/index.html"), read("src/agents.html"), read("src/agents.js"),
    read("src/agent-demo-data.json"), read(".agent-policy.json"),
  ]);
  assert.match(home, /href="\/agents\.html"/);
  assert.match(page, /Published prompt trace/);
  assert.match(script, /api\.github\.com\/repos\/AndrewLikesTea\/wawalu-agent-lab\/events/);
  assert.match(script, /Exact.*worker prompt/);
  for (const name of ["Sam", "Priya", "Mina", "Rowan", "Ellis", "Marcus"])
    assert.match(demo, new RegExp(`\\"name\\": \\"${name}\\"`));
  assert.doesNotMatch(`${script}\n${demo}`, /innerHTML|ingest\.wawalu|bearer|token|auth\.json|@gmail\.com/i);
  const forbidden = JSON.parse(policy).forbidden_paths;
  for (const path of ["src/agents.html", "src/agents.js", "src/agents.css", "src/agent-demo-data.json", "tests/agent-observatory.test.js"])
    assert.ok(forbidden.includes(path), `${path} must be protected from personas`);
});

test("agent observatory maps public events to personas without conversation data", () => {
  assert.equal(personaFromRef("refs/heads/agent/frontend/accessibility"), "frontend");
  const item = describeEvent({ type: "PullRequestEvent", payload: {
    action: "opened",
    pull_request: { number: 7, title: "Improve navigation", html_url: "https://github.com/example/pull/7",
      head: { ref: "agent/reviewer/navigation" } },
  }});
  assert.deepEqual(item, {
    persona: "reviewer", title: "Improve navigation",
    detail: "opened pull request #7", url: "https://github.com/example/pull/7",
  });
});
