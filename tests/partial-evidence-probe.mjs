// The page probe this suite drives the shipped AI FinOps front door with.
//
// It lives beside `partial-evidence.test.js` rather than inside it because both
// the "supported" and the "partial" surface cases boot the same real page entry
// and select files through the same real `input.files` seam. Two copies of that
// boot sequence is how one of them quietly stops matching the page.
//
// Nothing here asserts. It opens the tab, hands the file input a selection, and
// gets out of the way.

import { readFile } from "node:fs/promises";

import { DomEvent, loadPage } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { exampleDatasetFiles } from "../src/example-dataset.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

/** Load the tab and boot its real entry module, exactly as the page tag does. */
export async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

/**
 * Hand the file input a selection. This is the browser's File API and nothing
 * else: a name, a media type, and a `text()` promise over the real bytes.
 */
export function chooseFiles(document, files) {
  const input = document.getElementById("local-finops-files");
  input.files = files.map(({ fileName, text }) => ({
    name: fileName, type: "application/json", text: async () => text,
  }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

/** The bundled example exports, imported as a reader's own selection. */
export const exampleSelection = () => exampleDatasetFiles();

/** Wait for the partial-evidence region to be painted at all. */
export const evidencePainted = (document) =>
  waitFor(() => !document.getElementById("partial-evidence").hidden,
    "the partial-evidence finding to be painted");
