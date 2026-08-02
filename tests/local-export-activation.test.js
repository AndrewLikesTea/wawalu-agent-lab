import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, pressKey, tabSequence, textOf } from "./support/browser.js";
import {
  activationState, LOCAL_EXPORT_CHOICE, mountLocalExportActivation,
} from "../src/local-export-activation.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = new URL("../src/evolution.css", import.meta.url);
const page = async () => parseHtml(await readFile(PAGE, "utf8"));

test("one answer controls one next action without hiding either established path", async () => {
  const document = await page();
  assert.equal(mountLocalExportActivation(document), true);
  const region = document.getElementById("local-export-activation");
  const action = document.getElementById("local-export-next-action");
  const choices = region.querySelectorAll('input[name="local-export-ready"]');

  assert.equal(choices.length, 2);
  assert.equal(region.querySelectorAll("legend").length, 1);
  assert.match(textOf(region.querySelector("legend")), /Do you have a provider billing export ready/);
  assert.equal(action.dataset.target, "local-finops-files");
  action.click();
  assert.equal(document.activeElement?.id, "local-finops-files");

  choices[1].click();
  assert.equal(region.dataset.choice, LOCAL_EXPORT_CHOICE.EXAMPLE);
  assert.equal(action.dataset.target, "try-example-dataset");
  assert.match(textOf(action), /Bundled synthetic example/);
  action.click();
  assert.equal(document.activeElement?.id, "try-example-dataset");

  // The old paths remain real controls: no-file use and a later own-file swap
  // work in the same tab without a reload or replacement navigation.
  assert.ok(document.getElementById("local-finops-files"));
  assert.ok(document.getElementById("try-example-dataset"));
  assert.ok(document.getElementById("clear-local-analysis"));
});

test("radio arrow navigation updates the action and keeps a single tab stop", async () => {
  const document = await page();
  mountLocalExportActivation(document);
  const choices = document.querySelectorAll('input[name="local-export-ready"]');
  choices[0].focus();
  pressKey(document, "ArrowRight");
  assert.equal(document.activeElement, choices[1]);
  assert.equal(document.getElementById("local-export-next-action").dataset.target,
    "try-example-dataset");
  assert.equal(tabSequence(document).filter((node) => node.name === "local-export-ready").length, 1);
});

test("activation copy is explicit about local processing and the state model is closed", () => {
  const own = activationState("unexpected");
  const example = activationState(LOCAL_EXPORT_CHOICE.EXAMPLE);
  assert.equal(own.choice, LOCAL_EXPORT_CHOICE.READY);
  assert.match(own.note, /only in this browser tab/);
  assert.equal(example.targetId, "try-example-dataset");
  assert.match(example.note, /switch to your own export at any time/);
});

test("the finding consolidates provenance and limitations in one native disclosure", async () => {
  const document = await page();
  const finding = document.getElementById("own-data-evidence-preflight");
  const detail = finding.querySelector("details");
  assert.ok(detail);
  assert.equal(detail.hasAttribute("open"), false);
  assert.match(textOf(detail.querySelector("summary")), /Field provenance and limitations/);
  assert.ok(detail.querySelector("#own-data-preflight-provenance"));
  assert.ok(detail.querySelector("#own-data-preflight-boundary"));
});

test("the focused intake collapses to full-width controls at the phone breakpoint", async () => {
  const css = await readFile(CSS, "utf8");
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.local-export-activation\s*\{\s*grid-template-columns:1fr/);
  assert.match(css, /\.local-export-choices label,\.local-export-next button\s*\{\s*width:100%/);
  assert.match(css, /\.local-export-choices input:focus-visible\s*\{\s*outline:3px solid var\(--focus-ring\)/);
});
