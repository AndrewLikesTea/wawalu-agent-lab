import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BriefingProjectionError, EXECUTIVE_BRIEFING_VERSION, projectExecutiveBriefing,
} from "../src/executive-briefing-projection.js";
import {
  renderExecutiveBriefingProjectionError,
} from "../src/executive-briefing-projection-view.js";
import { createElement } from "./support/dom.js";

const fixture = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8")).briefingReadiness;
const fixedClock = () => new Date("2026-08-01T12:34:56.000Z");

test("equivalent bundled selections produce identical briefing payloads", () => {
  const first = projectExecutiveBriefing(structuredClone(fixture), { clock: fixedClock });
  const reordered = Object.fromEntries(Object.entries(structuredClone(fixture)).reverse());
  const second = projectExecutiveBriefing(reordered, { clock: fixedClock });
  assert.deepEqual(second, first);
  assert.equal(first.schemaVersion, EXECUTIVE_BRIEFING_VERSION);
  assert.equal(first.generatedAt, "2026-08-01T12:34:56.000Z");
  assert.deepEqual(first.provenance, {
    inputModel: "bundled-static-analysis/1.0.0",
    selectionVersion: "bundled-briefing-selection/1.0.0",
    fixtureId: "evolution-demo-data",
    fixtureVersion: "2026-07-25.1",
  });
  assert.equal(first.period.start, "2026-06-25");
  assert.equal(first.projectionVersion, "finops-executive-projection/1.0.0");
  // #1017: one label for one team. The bundled dataset's first intervention
  // priority and the AI FinOps brief's driving department are the same invented
  // department, so the seed names it the same way in both.
  assert.equal(first.departmentEvidence[0].department, "Atlas Platform");
});

test("projection is an allowlist and does not carry sensitive source fields", () => {
  const input = structuredClone(fixture);
  input.internalNote = "not selected";
  input.departmentEvidence[0].costCenter = "customer-like identifier";
  const payload = projectExecutiveBriefing(input, { clock: fixedClock });
  assert.equal("internalNote" in payload, false);
  assert.deepEqual(Object.keys(payload.departmentEvidence[0]),
    ["department", "evidence", "provenance"]);
  assert.equal(JSON.stringify(payload).includes("costCenter"), false);
});

test("incomplete, incompatible, forbidden and invalid-clock states fail observably", () => {
  const cases = [
    [{ ...structuredClone(fixture), projectionVersion: "" }, "incomplete-state"],
    [{ ...structuredClone(fixture), inputModel: "provider-analysis/1.0.0" }, "incompatible-state"],
    [{ ...structuredClone(fixture), credentials: { token: "secret" } }, "forbidden-state"],
  ];
  for (const [input, code] of cases) {
    assert.throws(() => projectExecutiveBriefing(input, { clock: fixedClock }),
      (error) => error instanceof BriefingProjectionError && error.code === code);
  }
  assert.throws(() => projectExecutiveBriefing(fixture, { clock: () => "not-a-date" }),
    (error) => error.code === "invalid-clock");

  const nodes = Object.fromEntries([
    "executive-briefing-projection", "executive-briefing-projection-status",
    "executive-briefing-projection-payload",
  ].map((id) => [id, createElement("p")]));
  const root = { getElementById: (id) => nodes[id] ?? null };
  renderExecutiveBriefingProjectionError(root,
    new BriefingProjectionError("incomplete-state", ["fixture.version"]));
  assert.equal(nodes["executive-briefing-projection"].dataset.state, "error");
  assert.match(nodes["executive-briefing-projection-status"].textContent,
    /incomplete-state: fixture\.version/);
});

test("the evolution workspace invokes and exposes the projection", async () => {
  const [page, wiring] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id="executive-briefing-projection-payload"/);
  assert.match(page, /aria-label="Generated executive briefing JSON"/);
  assert.match(wiring, /projectExecutiveBriefing\(data\.briefingReadiness\)/);
  assert.match(wiring, /renderExecutiveBriefingProjectionError/);
});
