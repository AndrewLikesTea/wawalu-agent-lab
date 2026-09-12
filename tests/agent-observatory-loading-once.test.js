// The observatory while nothing has answered yet, and once everything has failed.
//
// Each region used to say "Loading" twice: a chip word beside a heading that
// already began with it, so the page read "Loading Loading persona profiles" and
// a screen reader announced it that way. The hero card read "Loading the GitHub
// signal Loading…". These tests hold the shipped page, with its requests held
// open, to one loading line per live region that names its subject. Once every
// request has failed, each region must offer a Retry that names what it asks for.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEMO_DATA_PANELS, MERGED_FIGURE_COPY } from "../src/agents.js";
import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE_URL = new URL("../src/agents.html", import.meta.url);

// Each live region, and the one loading line it may carry.
const REGIONS = [
  { name: "personas", live: "#persona-status", loading: "Loading persona profiles" },
  { name: "public GitHub activity", live: "#activity-status", loading: "Loading public GitHub activity" },
  { name: "prompt trace", live: "#trace-status", loading: "Loading the prompt trace" },
  { name: "merged pull requests", live: "#merged-figure-readout", loading: "Loading the merged pull request count" },
];

const RETRIES = [
  ["#retry-personas", "Retry persona profiles"],
  ["#refresh-activity", "Retry public GitHub activity"],
  ["#retry-trace", "Retry the prompt trace"],
];

async function shippedPage(fetcher) {
  const page = await loadPage(PAGE_URL, { storage: {} });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0; // The page's 90-second poll must not outlive the test.
  globalThis.fetch = fetcher;
  await importPageModule("/agents.js");
  return {
    document: page.document,
    restore() { globalThis.setInterval = savedInterval; page.restore(); },
  };
}

test("the served markup opens on the loading lines the script paints, with no chip", async () => {
  const page = parseHtml(await readFile(PAGE_URL, "utf8"));
  for (const panel of DEMO_DATA_PANELS) {
    assert.equal(textOf(page.querySelector(panel.status).querySelector(".activity-state-title")),
      panel.copy.loading.title, panel.key);
  }
  assert.equal(textOf(page.querySelector(".merged-figure-value")), MERGED_FIGURE_COPY.loading.value);
  assert.equal(page.querySelectorAll(".activity-state-chip").length, 0, "no served region opens on a second Loading");
});

test("while nothing has answered, each live region says Loading once and names its subject", async () => {
  const page = await shippedPage(() => new Promise(() => {}));
  const { document } = page;
  try {
    // The banner above the rows exists only once agents.js has painted.
    await waitFor(() => document.querySelector("#activity-list").querySelectorAll(".activity-fallback").length === 1,
      "the script painted the loading state");

    const main = textOf(document.querySelector("#main-content"));
    assert.doesNotMatch(main, /Loading Loading/);
    assert.doesNotMatch(main, /Loading…/, "no region adds a bare Loading… under its named line");
    assert.doesNotMatch(textOf(document.querySelector(".observatory-signal")), /signal/i);
    assert.equal(textOf(document.querySelector("#connection-label")), "Loading GitHub events");

    for (const region of REGIONS) {
      const live = document.querySelector(region.live);
      const text = textOf(live);
      assert.equal(live.getAttribute("role"), "status", `${region.name}: is a live region`);
      assert.equal((text.match(/Loading/g) ?? []).length, 1, `${region.name}: announced once: ${text}`);
      assert.ok(text.startsWith(region.loading), `${region.name}: names its subject: ${text}`);
      assert.equal(live.querySelectorAll(".activity-state-chip").length, 0, `${region.name}: no chip`);
    }
  } finally {
    page.restore();
  }
});

test("once every request has failed, each Retry names what it retries", async () => {
  const page = await shippedPage(async () => { throw new Error("offline"); });
  const { document } = page;
  try {
    for (const status of ["#persona-status", "#activity-status", "#trace-status"]) {
      await waitFor(() => document.querySelector(status).dataset.state === "error", `${status} reports the failure`);
    }
    await waitFor(() => document.querySelector("#merged-figure").dataset.state === "unavailable",
      "the merged pull request count settles");

    for (const [selector, name] of RETRIES) {
      const control = document.querySelector(selector);
      assert.ok(!control.parentNode.hidden, `${name}: is offered`);
      assert.equal(control.dataset.recovery, "retry", name);
      // No aria-label, so the visible words are the accessible name.
      assert.equal(control.getAttribute("aria-label"), null, name);
      assert.equal(textOf(control), name);
    }
    assert.doesNotMatch(textOf(document.querySelector(".observatory-signal")), /signal/i);
    assert.doesNotMatch(textOf(document.querySelector("#main-content")), /Loading/);
  } finally {
    page.restore();
  }
});
