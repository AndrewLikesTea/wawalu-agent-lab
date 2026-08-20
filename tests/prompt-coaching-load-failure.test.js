// Independent recovery for the two optional bundled regions on Prompt coach.
// The real page entry and renderers are used; only the request outcome is
// controlled so failure, retry, and recovery can be driven deterministically.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { applyCoachingFirstRun } from "../src/prompt-coaching-entry-view.js";
import { applyCoachingSpecimen } from "../src/coaching-specimen-view.js";

const PAGE = fileURLToPath(new URL("../src/coach.html", import.meta.url));

async function openWithFailedRegions() {
  const page = await loadPage(PAGE);
  const { initPromptCoaching } = await importPageModule("/prompt-coaching-page.js");
  let exampleRequests = 0;
  let resultsRequests = 0;

  initPromptCoaching(page.document, {
    loadBundledExample(document) {
      exampleRequests += 1;
      if (exampleRequests === 1) return Promise.reject(new Error("example unavailable"));
      return applyCoachingFirstRun(document);
    },
    loadPossibleResults(document) {
      resultsRequests += 1;
      if (resultsRequests === 1) return Promise.reject(new Error("results unavailable"));
      return applyCoachingSpecimen(document);
    },
  });

  await waitFor(() => page.document.querySelectorAll(".prompt-coaching-load-error").length === 2,
    "both bundled regions to report failure");
  return { page, requests: () => ({ exampleRequests, resultsRequests }) };
}

test("each failed bundled region has concise accessible fallback copy and its own retry", async () => {
  const { page, requests } = await openWithFailedRegions();
  const { document } = page;
  const sample = document.getElementById("prompt-coach-sample-body");
  const results = document.getElementById("coaching-specimen-body");

  assert.equal(sample.dataset.loadState, "error");
  assert.equal(results.dataset.loadState, "error");
  assert.match(textOf(sample), /bundled example could not be loaded/i);
  assert.match(textOf(results), /possible results could not be loaded/i);
  for (const region of [sample, results]) {
    const announced = region.querySelector("[role=alert]");
    assert.match(textOf(announced), /still paste and grade your own prompt/i);
    assert.equal(announced.querySelectorAll("button").length, 0,
      "the retry control belongs beside the live region, not announced inside it");
    assert.equal(region.querySelectorAll("button").length, 1);
  }
  assert.deepEqual(requests(), { exampleRequests: 1, resultsRequests: 1 });
  page.restore();
});

// A loader is trusted to paint; it is not trusted to have painted. A region
// that reports "ready" over the sentence it was meant to replace is a state
// attribute contradicting the only thing a visitor actually reads.
test("a loader that settles without painting leaves no loading line behind it", async () => {
  const page = await loadPage(PAGE);
  const { initPromptCoaching } = await importPageModule("/prompt-coaching-page.js");
  initPromptCoaching(page.document, {
    loadBundledExample: () => Promise.resolve(null),
    loadPossibleResults: applyCoachingSpecimen,
  });

  const sample = page.document.getElementById("prompt-coach-sample-body");
  await waitFor(() => sample.dataset.loadState === "ready", "the bundled example to settle");
  assert.doesNotMatch(textOf(sample), /Loading the bundled example/i);
  assert.equal(textOf(sample).trim(), "");
  page.restore();
});

test("retries recover independently and preserve an in-progress prompt and tier", async () => {
  const { page, requests } = await openWithFailedRegions();
  const { document } = page;
  const prompt = document.getElementById("prompt-coaching-input");
  const tier = document.getElementById("prompt-coaching-model");
  prompt.value = "Draft a rollback note for the service owner.";
  tier.value = "economy";

  document.getElementById("prompt-coach-sample-body").querySelector("button").click();
  await waitFor(() => document.getElementById("prompt-coach-sample-body").dataset.loadState === "ready",
    "the bundled example retry to recover");
  assert.ok(document.getElementById("prompt-coach-sample-result"));
  assert.equal(document.getElementById("coaching-specimen-body").dataset.loadState, "error",
    "retrying the example must not retry possible results");
  assert.deepEqual(requests(), { exampleRequests: 2, resultsRequests: 1 });
  assert.equal(prompt.value, "Draft a rollback note for the service owner.");
  assert.equal(tier.value, "economy");

  document.getElementById("coaching-specimen-body").querySelector("button").click();
  await waitFor(() => document.getElementById("coaching-specimen-body").dataset.loadState === "ready",
    "the possible-results retry to recover");
  assert.ok(document.querySelectorAll(".coaching-specimen-case").length > 1);
  assert.equal(document.getElementById("prompt-coach-sample-body").dataset.loadState, "ready");
  assert.deepEqual(requests(), { exampleRequests: 2, resultsRequests: 2 });
  assert.equal(prompt.value, "Draft a rollback note for the service owner.");
  assert.equal(tier.value, "economy");
  page.restore();
});
