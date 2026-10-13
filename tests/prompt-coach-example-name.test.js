// One name for the prompt Prompt coach grades on arrival: "the example prompt"
// (#2831). The page used to call it the "bundled synthetic example", which is
// how the build describes it, not how a visitor would. This file reads the
// rendered page — the copy that actually paints, not the pre-script markup —
// and holds every place the example is named to the one plain name.
//
// The check is scoped to text a visitor reads or hears inside <main>: text
// nodes, plus the strings the page writes into its status line. Code
// identifiers such as `bundled_sample` and data attributes are not copy and are
// not checked. The footer is shared with every page and is out of scope here.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadPage, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";

const PAGE = fileURLToPath(new URL("../src/coach.html", import.meta.url));
const BUILD_WORDS = /bundled|synthetic/i;

/** Every visible string under `node`, skipping hidden elements and scripts. */
function visibleStrings(node, out = []) {
  if (node.nodeType === 3) {
    const text = node.data.trim();
    if (text) out.push(text);
    return out;
  }
  if (node.nodeType !== 1 || node.hidden) return out;
  if (["SCRIPT", "STYLE", "TEMPLATE"].includes(node.tagName)) return out;
  const label = node.getAttribute("aria-label");
  if (label) out.push(label);
  for (const child of node.children) visibleStrings(child, out);
  return out;
}

test("the example prompt is named one plain way, and no build word paints", async () => {
  const page = await loadPage(PAGE);
  await importPageModule("/prompt-coaching-page.js");
  const { document } = page;
  const byId = (id) => document.getElementById(id);

  const strings = visibleStrings(document.querySelector("main"));
  assert.ok(strings.length > 50, `walked only ${strings.length} strings; the page did not render`);
  // `bundled_sample` is the session's source identifier, shown as a value in
  // the record a reader can inspect; it is code, not copy.
  const leaked = strings.filter((text) => BUILD_WORDS.test(text.replaceAll("bundled_sample", "")));
  assert.deepEqual(leaked, [], "visible coach copy still uses a build word");
  // The loading sentence ships on the node and is written in by script.
  assert.doesNotMatch(byId("prompt-coach-sample-status").getAttribute("data-loading"), BUILD_WORDS);

  // The heading, the sample's heading, its loading sentence, its caveat and the
  // disclosure over its text all use the one name.
  assert.equal(textOf(byId("prompt-coaching-question")), "Example prompt and its score");
  assert.equal(textOf(byId("prompt-coaching-result-guidance")),
    "The example prompt is graded against this page’s prompt rubric.");
  assert.equal(textOf(byId("prompt-coach-sample-title")), "Example prompt, already graded");
  assert.match(byId("prompt-coach-sample-status").getAttribute("data-loading"), /^Loading the example prompt\./);
  const caveat = textOf(document.querySelector(".prompt-coach-sample-static"));
  assert.match(caveat, /the example prompt, written for this page/);
  assert.match(caveat, /not your prompt or anyone else’s real prompt/);
  // The disclosure's markup lead is a pre-script fallback; the contract view
  // replaces it on load, so the painted first block is what is checked here.
  assert.match(textOf(document.querySelector(".prompt-coaching-preview-lead")),
    /the example prompt, written for this page and not anyone's real prompt/);
  page.restore();
});

test("the markup's pre-script heading and guidance say what the script paints", async () => {
  const page = await loadPage(PAGE);
  const { document } = page;
  // Before any script runs: the same name, in the loading state.
  assert.equal(textOf(document.getElementById("prompt-coaching-question")), "Example prompt and its score");
  assert.equal(textOf(document.getElementById("prompt-coaching-result-guidance")),
    "The example prompt is graded against this page’s prompt rubric.");
  assert.equal(textOf(document.getElementById("prompt-coach-sample-title")), "Example prompt, grading now");
  assert.equal(textOf(document.querySelector(".prompt-coaching-preview-lead")),
    "See the example prompt’s own text and the counts read from it.");
  const leaked = visibleStrings(document.querySelector("main")).filter((text) => BUILD_WORDS.test(text));
  assert.deepEqual(leaked, [], "pre-script coach copy still uses a build word");
  page.restore();
});
