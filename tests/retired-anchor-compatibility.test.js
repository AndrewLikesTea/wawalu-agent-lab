import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  RETIRED_ANCHOR_TARGETS, forwardRetiredAnchor,
} from "../src/retired-anchor-compatibility.js";
import { ANSWER_SPINE, ROLE } from "../src/finops/answer-spine-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url)));
const EVALUATION = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url)));

test("every retired summary-region anchor maps to its live successor", () => {
  const retired = ANSWER_SPINE.filter((entry) => entry.role === ROLE.retired);
  assert.ok(retired.length > 0);
  assert.deepEqual(RETIRED_ANCHOR_TARGETS,
    Object.fromEntries(retired.map((entry) => [entry.id, entry.supersededBy])));
  for (const entry of retired) {
    const win = { location: { hash: `#${entry.id}` }, history: { replaceState(_state, _title, hash) {
      win.location.hash = hash;
    } } };
    assert.equal(forwardRetiredAnchor(win), entry.supersededBy);
    assert.equal(win.location.hash, `#${entry.supersededBy}`);
  }
});

test("a cold deep link is forwarded by the shipped evolution entry", async (t) => {
  const page = await loadPage(PAGE, {
    location: { hash: "#finops-first-run-conversion" },
    routes: {
      "/evolution-demo-data.json": DEMO,
      "/finops-evaluation-fixtures.json": EVALUATION,
    },
  });
  t.after(page.restore);
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready", "page ready");
  await waitFor(() => page.document.getElementById("finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "evaluation settled");
  await waitFor(() => page.document.getElementById("integration-contract-provenance")
    .textContent.trim().startsWith("Gateway completed"), "static gateway settled");
  assert.equal(window.location.hash, "#finops-contact");
  assert.ok(page.document.getElementById("finops-contact"));
});

test("unknown fragments are left untouched", () => {
  const win = { location: { hash: "#local-import" } };
  assert.equal(forwardRetiredAnchor(win), null);
  assert.equal(win.location.hash, "#local-import");
});
