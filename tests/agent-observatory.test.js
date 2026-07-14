import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { describeEvent, personaFromRef, personaIdentity } from "../src/agents.js";

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
  assert.deepEqual(personaIdentity("frontend"), { name: "Mina", role: "Frontend engineer" });
  const item = describeEvent({ type: "PullRequestEvent", payload: {
    action: "opened",
    pull_request: { number: 7, title: "Improve navigation", html_url: "https://github.com/example/pull/7",
      head: { ref: "agent/frontend/navigation" } },
  }});
  assert.deepEqual(item, {
    persona: "Mina · Frontend engineer", title: "Improve navigation",
    detail: "Mina opened pull request #7", url: "https://github.com/example/pull/7",
  });
});

test("agent observatory names pull-request authors and reviewers", () => {
  const opened = describeEvent({ type: "PullRequestEvent", payload: {
    action: "opened", pull_request: { number: 16, title: "Filter decisions",
      html_url: "https://github.com/example/pull/16", head: { ref: "agent/staff/filters" } },
  }});
  assert.equal(opened.persona, "Priya · Staff engineer");
  assert.equal(opened.detail, "Priya opened pull request #16");

  const approved = describeEvent({ type: "PullRequestReviewEvent", payload: {
    pull_request: { number: 16, title: "Filter decisions", html_url: "https://github.com/example/pull/16" },
    review: { state: "approved", html_url: "https://github.com/example/pull/16#review" },
  }});
  assert.equal(approved.persona, "Marcus · Reviewer");
  assert.equal(approved.detail, "Marcus approved pull request #16");
});

test("agent observatory maps autonomous lifecycle comments", () => {
  const item = describeEvent({ type: "IssueCommentEvent", payload: {
    issue: { number: 12, title: "Add release export", labels: [{ name: "persona:backend" }],
      html_url: "https://github.com/example/issues/12" },
    comment: { body: "<!-- wawalu-agent-state -->\n**Synthetic team · planning**", html_url: "https://github.com/example/issues/12#comment" },
  }});
  assert.deepEqual(item, { persona: "Rowan · Backend engineer", title: "Add release export",
    detail: "Rowan: planning on issue #12", url: "https://github.com/example/issues/12#comment" });
});

test("agent observatory exposes named review discussions", () => {
  const item = describeEvent({ type: "IssueCommentEvent", payload: {
    issue: { number: 22, title: "Add social profiles", html_url: "https://github.com/example/pull/22" },
    comment: { body: "<!-- wawalu-review-debate -->\n**Mina**\n\nThe empty state needs work.",
      html_url: "https://github.com/example/pull/22#comment" },
  }});
  assert.deepEqual(item, { persona: "Mina · Frontend engineer", title: "Add social profiles",
    detail: "Mina joined the review discussion on pull request #22",
    url: "https://github.com/example/pull/22#comment" });
});

test("activity links only accept http(s) URLs", async () => {
  const { safeActivityUrl } = await import("../src/agents.js");
  assert.equal(safeActivityUrl("https://github.com/x/y/pull/1"), "https://github.com/x/y/pull/1");
  assert.equal(safeActivityUrl("javascript:alert(1)"), null);
  assert.equal(safeActivityUrl("data:text/html,<script>1</script>"), null);
  assert.equal(safeActivityUrl("not a url"), null);
  assert.equal(safeActivityUrl(null), null);
});
