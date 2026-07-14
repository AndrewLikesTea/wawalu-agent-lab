import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { describeEvent, personaFromRef } from "../src/agents.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("agent observatory is linked, privacy-safe, and policy-protected", async () => {
  const [home, page, script, policy] = await Promise.all([
    read("src/index.html"), read("src/agents.html"), read("src/agents.js"), read(".agent-policy.json"),
  ]);
  assert.match(home, /href="\/agents\.html"/);
  assert.match(page, /public GitHub metadata only/);
  assert.match(script, /api\.github\.com\/repos\/AndrewLikesTea\/wawalu-agent-lab\/events/);
  assert.doesNotMatch(script, /innerHTML|ingest\.wawalu|transcript|prompt.*response/i);
  const forbidden = JSON.parse(policy).forbidden_paths;
  for (const path of ["src/agents.html", "src/agents.js", "src/agents.css", "tests/agent-observatory.test.js"])
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
