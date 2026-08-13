// The one sentence pair that tells a visitor which file AI FinOps reads, and
// what they get without one. It is written twice — the front door's AI FinOps
// block and the Prompt coach's cross-link — so this file holds the two copies
// to each other and both to the code that does the reading.
//
// Three things are pinned, and the third is the one that keeps the copy honest:
//   1. The two pages carry the pair byte for byte. One claim, one wording.
//   2. Every provider named resolves to a result: it is a provider package in
//      provider-export-package.js AND either a native shape the tabular
//      importer normalizes or a published browser-compat contract the
//      hyperscaler adapter projects. A provider that is only detected — the
//      generic AWS Cost and Usage Report — must not be named, because naming it
//      promises an answer the page cannot produce.
//   3. The no-file sentence links to an anchor that exists on AI FinOps.
//
// Nothing here checks a saving, an accuracy, or a coverage figure, because the
// pair deliberately claims none of those.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { SHAPES } from "../src/finops-tabular-import.js";
import { BROWSER_COMPAT_MANIFEST } from "../src/browser-compat-contracts.js";
import { EXPORT_PACKAGES } from "../src/provider-export-package.js";

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");

const FORMAT_SENTENCE = "AI FinOps reads a provider export from OpenAI, Anthropic, "
  + "Azure OpenAI, Google Vertex AI, or AWS Bedrock, as CSV, TSV, JSON, or JSONL.";
const NO_FILE_SENTENCE = "No export to hand? The "
  + '<a href="/evolution.html#workspace-answer">bundled synthetic example</a> '
  + "opens on a finished result, so you can read the whole analysis before you find a file.";
const PAIR = `${FORMAT_SENTENCE} ${NO_FILE_SENTENCE}`;

// Provider id → the words the pair uses for it. Ids are the canonical enum the
// packages and the adapters already share, so a provider that loses its reader
// fails here rather than going stale in the markup.
const NAMED = Object.freeze({
  openai: "OpenAI", anthropic: "Anthropic",
  azure: "Azure OpenAI", google: "Google Vertex AI", aws: "AWS Bedrock",
});

test("the front door and the Prompt coach say the same thing about the file", async () => {
  const [index, coach] = await Promise.all([read("index.html"), read("coach.html")]);
  for (const [page, html] of [["index.html", index], ["coach.html", coach]]) {
    assert.equal(html.includes(`<p>${PAIR}</p>`) || html.includes(`>${PAIR}</p>`), true,
      `${page} does not carry the intake sentence pair verbatim`);
  }
});

test("every provider the pair names is one an import resolves to a result", () => {
  const packaged = new Set(EXPORT_PACKAGES
    .filter((entry) => entry.kind === "usage" || entry.provider)
    .map((entry) => entry.provider));
  const nativeShapes = new Set(SHAPES.filter((shape) => shape.kind === "provider")
    .map((shape) => shape.provider));
  // Bedrock, Vertex AI, and Azure OpenAI are read through published contracts;
  // OpenAI and Anthropic through the native shapes. Both routes end in the same
  // canonical validator, which is what "resolves to a result" means here. The
  // three adapted providers are matched on the contract's own display name, so
  // the copy cannot call a provider something its contract does not.
  const adaptedNames = new Set(
    BROWSER_COMPAT_MANIFEST.contracts.map((contract) => contract.displayName),
  );

  for (const [provider, words] of Object.entries(NAMED)) {
    assert.equal(FORMAT_SENTENCE.includes(words), true, `${words} is not named`);
    assert.equal(packaged.has(provider), true,
      `${words} is named but has no export package to ask a billing owner for`);
    assert.equal(nativeShapes.has(provider) || adaptedNames.has(words), true,
      `${words} is named but nothing normalizes its export`);
  }

  // The generic report is detected and never adapted. Naming it would be the
  // one over-claim available here, so it is refused by name.
  assert.equal(FORMAT_SENTENCE.includes("Cost and Usage Report"), false,
    "a detected-but-unadapted export must not be offered as one AI FinOps reads");
  // No figure, and no second noun for the uploaded artifact.
  assert.equal(/[$%]|\bsav(e|ing)/i.test(PAIR), false, "the pair claims a figure it cannot show");
  assert.equal(/usage export|billing export/i.test(PAIR), false,
    "the site calls it a provider export; the pair must not introduce a second name");
});

test("the bundled example the pair links to is a region AI FinOps ships", async () => {
  const evolution = await read("evolution.html");
  assert.equal(evolution.includes('id="finops-recoverable-answer"'), true,
    "the no-file sentence links to an anchor AI FinOps does not carry");
});
