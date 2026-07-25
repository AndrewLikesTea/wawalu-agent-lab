// The synthetic team's roster is declared in nine places: prompt files, the
// provisioning template, behavior traits, the planner's schema, the manager's
// display names, the GitHub label map, peer-review pairings, the reviewer focus
// map, and the public observatory. Adding a persona to some of them produces a
// worker that is assignable but unlabelled, or named but never assigned — and the
// failure surfaces hours later inside a run. This test keeps them in agreement.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { personaIdentity } from "../src/agents.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Personas that take assigned implementation work. The manager and the reviewer
// are deliberately excluded: they are never assignees.
const ASSIGNABLE = ["backend", "frontend", "infrastructure", "staff",
  "product", "design", "evaluation", "integrations"];
const NON_ASSIGNABLE = ["manager", "reviewer"];

test("every assignable persona is declared everywhere the runner looks", async () => {
  const [template, behaviors, autonomous, layers, simulation, orchestrator, observatory] =
    await Promise.all([
      read("config/personas.example.json"), read("config/team-behaviors.json"),
      read("runner/autonomous.py"), read("runner/layers.py"), read("runner/simulation.py"),
      read("runner/orchestrator.py"), read("src/agent-demo-data.json"),
    ]);

  const registry = JSON.parse(template).personas;
  const traits = JSON.parse(behaviors).personas;
  const names = JSON.parse(observatory).personas.map((persona) => persona.name);
  const plannerEnum = autonomous.slice(autonomous.indexOf("PERSONA_NAMES = {"));
  const focusMap = orchestrator.slice(orchestrator.indexOf('"frontend": "interaction states'));
  const complements = simulation.slice(simulation.indexOf("complements = {"));

  for (const persona of ASSIGNABLE) {
    assert.ok(registry[persona], `${persona} missing from the provisioning template`);
    assert.equal(registry[persona].prompt_file, `personas/${persona}.md`);
    assert.ok((await read(`personas/${persona}.md`)).trim().length > 80,
      `${persona} needs a real prompt file`);

    const trait = traits[persona];
    assert.ok(trait, `${persona} missing behavior traits`);
    for (const field of ["name", "work_style", "blind_spot", "error_proneness"])
      assert.ok(trait[field] !== undefined, `${persona} traits missing ${field}`);

    // The planner may only propose a persona the runner can actually execute.
    assert.match(layers, new RegExp(`"${persona}"`), `${persona} missing from the planner schema`);
    assert.match(plannerEnum, new RegExp(`"${persona}": "${trait.name}"`),
      `${persona} missing from PERSONA_NAMES`);
    assert.match(autonomous, new RegExp(`"persona:${persona}": \\("[0-9a-f]{6}", "Assigned to ${trait.name}"\\)`),
      `${persona} missing a GitHub label`);
    assert.match(complements, new RegExp(`"${persona}": \\(`), `${persona} has no peer-review pairing`);
    assert.match(focusMap, new RegExp(`"${persona}": "`), `${persona} has no peer-review focus`);

    // The observatory publishes who is on the floor; a hidden persona would ship
    // work to the site under a name the public page cannot explain.
    assert.equal(personaIdentity(persona).name, trait.name, `${persona} missing from the observatory map`);
    assert.ok(names.includes(trait.name), `${trait.name} missing from the observatory roster`);
  }

  for (const persona of NON_ASSIGNABLE) {
    assert.ok(registry[persona], `${persona} missing from the provisioning template`);
    assert.doesNotMatch(layers, new RegExp(`enum": \\[[^\\]]*"${persona}"`),
      `${persona} must never be an assignable persona`);
  }

  // Names are how the team is read on the public page and in PR comments; a
  // duplicate would make two personas indistinguishable there.
  const allNames = [...ASSIGNABLE, ...NON_ASSIGNABLE]
    .map((persona) => traits[persona]?.name)
    .filter(Boolean);
  assert.equal(new Set(allNames).size, allNames.length, "persona names must be unique");
});

test("the peer reviewer is never the author, and always a real persona", async () => {
  const simulation = await read("runner/simulation.py");
  const block = simulation.slice(simulation.indexOf("complements = {"),
    simulation.indexOf("choices = complements.get"));
  const pairs = [...block.matchAll(/"(\w+)": \(([^)]+)\)/g)];
  assert.ok(pairs.length >= ASSIGNABLE.length, "every assignable persona needs a pairing");

  for (const [, author, reviewers] of pairs) {
    const listed = [...reviewers.matchAll(/"(\w+)"/g)].map((match) => match[1]);
    assert.ok(listed.length >= 2, `${author} needs at least two candidate reviewers`);
    assert.ok(!listed.includes(author), `${author} must not review its own work`);
    for (const reviewer of listed)
      assert.ok(ASSIGNABLE.includes(reviewer), `${reviewer} is not an assignable persona`);
  }
});
