import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf, tabSequence, pressEnter, pressTab } from "./support/browser.js";
import { PILOT_SCORECARD_TEXT, PILOT_TEAM_HANDOFF } from "../src/shiplog-pilot-scorecard.js";
import { SHIPLOG_ORIGIN } from "../src/shiplog-evaluation-brief.js";
import { EXPORT_BUTTON_LABEL } from "../src/shiplog-export.js";
import { SITE_NAV } from "../src/site-nav.js";

const root = process.env.SHIPLOG_E2E_BUILD_ROOT || "src";
const file = (path) => new URL(`../${root}/${path}`, import.meta.url);
const filename = "shiplog-evaluation-brief.txt";
const HOME_PAGE_NAME = SITE_NAV.find((item) => item.href === "/index.html").label;

test("native brief download is visible beside the brief and scorecard, with keyboard activation and no scripts", async (t) => {
  const page = await loadPage(file("index.html"));
  t.after(() => page.restore());
  const doc = page.document;
  const link = doc.getElementById("download-shiplog-evaluation-brief");
  assert.equal(link.tagName, "A");
  assert.equal(textOf(link), "Download Shiplog evaluation brief");
  assert.equal(link.getAttribute("download"), filename);
  assert.equal(link.getAttribute("href"), `/${filename}`);
  assert.equal(link.getAttribute("type"), "text/plain");
  assert.equal(doc.getElementById("shiplog-evaluation-brief").querySelector("#download-shiplog-evaluation-brief"), link);
  for (let node = link; node?.tagName; node = node.parentNode) assert.equal(node.hidden, false);
  const order = tabSequence(doc);
  assert.ok(order.indexOf(link) > order.indexOf(doc.getElementById("copy-shiplog-evaluation-brief")));
  assert.ok(order.indexOf(link) < order.indexOf(doc.getElementById("copy-pilot-scorecard")));
  const help = textOf(doc.getElementById(link.getAttribute("aria-describedby")));
  assert.match(help, /plain-text file.*blank pilot scorecard.*ready to forward/);
  assert.match(help, /If your browser opens the file, use Save As/);
  link.focus();
  pressEnter(doc);
  assert.equal(doc.downloads[0].filename, filename);
  assert.equal(doc.activeElement, link);
  pressEnter(doc);
  assert.equal(doc.downloads.length, 2, "a retry remains available");
  pressTab(doc);
  assert.notEqual(doc.activeElement, link, "no focus trap");
  // The harness captures native activation; resolve its static href separately
  // because it models Blob downloads, not HTTP or a browser's download manager.
  assert.ok((await readFile(file(link.href.slice(1)), "utf8")).startsWith("Shiplog evaluation brief\n"));
  const css = await readFile(file("styles.css"), "utf8");
  assert.ok(link.classList.contains("share-button"));
  assert.match(css, /\.share-button:focus-visible\s*\{ outline:3px solid/);
  assert.match(css, /@media\(max-width:520px\).*\.share-button\{width:100%\}/);
});

test("the downloadable artifact is exactly the authored brief, a disclosure and the blank scorecard", async (t) => {
  const page = await loadPage(file("index.html"));
  t.after(() => page.restore());
  const text = await readFile(file(filename), "utf8");
  const brief = page.document.getElementById("shiplog-evaluation-brief-text");
  // Whole-file equality, not a phrase denylist: the denylist let "Pilot teams
  // found the reasoning behind a release in under a minute." ship green between
  // the two sections. Any line no authored source owns now fails, however worded.
  assert.equal(text, `${[
    ...Array.from(brief.querySelectorAll("h2, p"), textOf),
    `Public deployment evidence: ${new URL(brief.querySelector("a").getAttribute("href"), SHIPLOG_ORIGIN).href}`,
    "This document contains fixed editorial content and public links only. It includes no visitor records or form entries.",
    PILOT_SCORECARD_TEXT,
  ].join("\n\n")}\n`);
  assert.match(text, /Decisions and releases you add stay in this browser; they are not shared hosted records/);
  assert.match(text, /invented, use no customer or production data, and are not customer results/);
  assert.match(text, /No pilot outcome is claimed/);
  const fields = text.split("\n").filter(line => /^(Buyer target|Observed result|Owner):/.test(line));
  assert.equal(fields.length, 12);
  for (const field of fields) assert.match(field, /^[^:]+: ________$/);
  assert.deepEqual(text.match(/https?:\/\/\S+/g), [
    "https://labs.wawalu.org/releases.html#shipped-build",
    "https://labs.wawalu.org/#site-footer-panel",
    "https://labs.wawalu.org/",
  ]);
  assert.match(text, /To ask about availability and pricing/);
});

test("visitor records, edited editorial DOM and form values never reach the downloaded file", async (t) => {
  const page = await loadPage(file("index.html"));
  t.after(() => page.restore());
  const doc = page.document;
  globalThis.localStorage.setItem("shiplog-decisions", "PRIVATE STORED DECISION");
  globalThis.localStorage.setItem("shiplog-releases", "PRIVATE STORED RELEASE");
  for (const field of doc.querySelectorAll("input,textarea")) field.value = "PRIVATE FORM VALUE";
  doc.getElementById("shiplog-evaluation-brief-text").textContent = "PRIVATE DOM CONTENT";
  doc.getElementById("shiplog-pilot-scorecard-title").textContent = "PRIVATE PILOT RESULT";
  const link = doc.getElementById("download-shiplog-evaluation-brief");
  link.focus();
  pressEnter(doc);
  assert.equal(doc.downloads[0].filename, filename);
  assert.equal(link.href, `/${filename}`, "no visitor-controlled URL parameters");
  // The captured bytes, not a second read of the file on disk: a click handler
  // that swapped in a Blob composed from this page would deliver the edits above.
  assert.doesNotMatch(doc.downloads[0].text, /PRIVATE/);
});

// #2395: the third surface. This file is forwarded to a teammate who never saw
// the page it describes, so "press Download JSON on this page" addressed nobody.
// The bytes are resolved from the href the activation actually names — this link
// is a static file, not a Blob, so the harness captures the filename and the
// destination rather than the content.
test("the forwarded file tells a teammate which page each handoff control is on", async (t) => {
  const page = await loadPage(file("index.html"));
  t.after(() => page.restore());
  const doc = page.document;
  const link = doc.getElementById("download-shiplog-evaluation-brief");
  link.focus();
  pressEnter(doc);
  assert.equal(doc.downloads[0].filename, filename);
  const text = await readFile(file(link.href.slice(1)), "utf8");

  const row = text.split("\n\n").find((block) => block.startsWith("3. Team handoff\n"));
  assert.equal(row, `3. Team handoff\n${PILOT_TEAM_HANDOFF}\nBuyer target: ________\nObserved result: ________\nOwner: ________`);
  assert.ok(row.includes(`“${EXPORT_BUTTON_LABEL}” on the ${HOME_PAGE_NAME} page`));
  assert.ok(row.includes(`“Choose JSON file” on the ${HOME_PAGE_NAME} page`));
  assert.ok(row.includes("the Releases page has a separate “Export releases as JSON” button and no import control."));
  assert.doesNotMatch(row, /\bthis page\b|\bhere\b/);
  // The blanks stay blank and the step still claims no outcome.
  assert.deepEqual(row.split("\n").slice(-3), ["Buyer target: ________", "Observed result: ________", "Owner: ________"]);

  // The three surfaces carry one text, so the page name cannot differ between them.
  const home = doc.getElementById("shiplog-pilot-scorecard").querySelectorAll("li")[2];
  assert.equal(textOf(home.querySelector("p")), PILOT_TEAM_HANDOFF);
  assert.ok(PILOT_SCORECARD_TEXT.includes(row));
});
