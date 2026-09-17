// The end of the Releases demo offers the two things a reader forwards (#2403).
//
// A prospect who reaches the bottom of the release log has seen everything the
// page can show them and still has to explain Shiplog to a manager who was never
// here. The evaluation brief and the blank pilot scorecard already exist on the
// home page, so the Releases page links them rather than printing a second copy
// that could drift from the first.
//
// What is held here:
//
//   * the link is in the page's own content, not the shared footer or the nav;
//   * it lands on the brief section itself, not on the top of the home page, and
//     that section id exists, so the anchor cannot rot silently;
//   * its words name both assets and the audience, because a link that says
//     "read more" cannot be forwarded on its own;
//   * the sentence beside it claims no pilot outcome and repeats the site's
//     invented-records caveat, since a scorecard is exactly the shape a reader
//     mistakes for a result;
//   * it sits below the log, the deployment evidence and the export, and above
//     the footer's follow-up form, so the low-friction action is offered where
//     the demo ends without displacing the hand-raise.
//
// No viewport is shimmed: no module on this page reads matchMedia or innerWidth,
// so a shimmed width would assert only itself. The responsive criterion is held
// against the rules in styles.css that the block's classes resolve to.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, textOf } from "./support/browser.js";

const BUILD_ROOT = process.env.SHIPLOG_E2E_BUILD_ROOT || "src";
const read = (file) => readFile(new URL(`../${BUILD_ROOT}/${file}`, import.meta.url), "utf8");

const HREF = "/index.html#shiplog-evaluation-brief";
const LINK_TEXT =
  "Evaluation brief and blank pilot scorecard — for sharing with a manager or procurement stakeholder";

// Ids of the elements a node sits inside, nearest first. Walked by parentNode:
// the harness rejects descendant selectors, and comparing a node with null makes
// it inspect the whole parsed page.
const ancestorIds = (node) => {
  const ids = [];
  for (let current = node?.parentNode; current; current = current.parentNode) {
    const id = current.getAttribute?.("id");
    if (id) ids.push(id);
  }
  return ids;
};

// Direct children that are elements. Text nodes appear in `children` with a
// truthy tagName, so the filter is on the attribute reader, not on tagName.
const childIds = (node) => [...node.children].map((child) => child.getAttribute?.("id")).filter(Boolean);

test("the Releases page carries one link to the home page brief and scorecard", async () => {
  const doc = parseHtml(await read("releases.html"));
  const link = doc.getElementById("evaluation-handoff-link");

  assert.equal(doc.querySelectorAll("#evaluation-handoff-link").length, 1, "the handoff link is rendered twice");
  assert.equal(link.tagName, "A", "the handoff must be a real link, so the platform gives it keyboard operation");
  // The section anchor, not the bare page: a reader who follows this lands on
  // the brief rather than on the hero and scrolls looking for it.
  assert.equal(link.getAttribute("href"), HREF);
  assert.notEqual(link.getAttribute("href"), "/index.html");
  // A plain link is already a tab stop and already picks up the site's focus
  // ring; adding tabindex would only move it out of document order.
  assert.equal(link.getAttribute("tabindex"), null);

  const ancestors = ancestorIds(link);
  assert.ok(ancestors.includes("main-content"), "the link is outside the page's own content");
  assert.equal(ancestors.includes("site-footer"), false, "the link is in the shared footer, not on this page");
  assert.equal(ancestors.includes("evaluation-handoff"), true);
});

test("the link names both assets and the person it is for", async () => {
  const doc = parseHtml(await read("releases.html"));
  const link = doc.getElementById("evaluation-handoff-link");

  assert.equal(textOf(link), LINK_TEXT);
  for (const wording of ["Evaluation brief", "blank pilot scorecard", "manager or procurement stakeholder"]) {
    assert.ok(textOf(link).includes(wording), wording);
  }
});

test("the copy beside the link claims no pilot outcome", async () => {
  const doc = parseHtml(await read("releases.html"));
  const block = doc.getElementById("evaluation-handoff");
  const text = textOf(block);

  assert.ok(text.includes("The scorecard is blank"), "the block never says the scorecard ships blank");
  assert.ok(text.includes("no pilot outcome is claimed"), "the block never withdraws the outcome claim");
  assert.ok(
    text.includes("The example decisions and releases on this site are invented and use no customer or production data."),
    "the block never says the example records are invented",
  );
  // No figure can be true here: nothing on this page ran a pilot. A digit in
  // this block would be a measurement a reader could quote.
  assert.doesNotMatch(text, /\d/, "the block states a number it cannot support");
  assert.doesNotMatch(text, /\b(customers?|teams?) (use|trust|saved)\b/i);
});

test("the handoff sits after the log and the evidence, above the follow-up form", async () => {
  const html = await read("releases.html");
  const doc = parseHtml(html);
  const main = doc.getElementById("main-content");

  // Top-level reading order: the handoff is the last block of the page's own
  // content, after the workspace that holds the log, the export and the recorder.
  const blocks = childIds(main);
  assert.equal(blocks.at(-1), "evaluation-handoff", "the handoff is not the last block of the page content");
  assert.ok(blocks.indexOf("deployment-status") < blocks.indexOf("evaluation-handoff"));

  // The regions inside the workspace are not top-level blocks, so their order is
  // read off the authored document.
  for (const id of ["release-list", "deployment-evidence", "release-export", "record-release"]) {
    assert.ok(
      html.indexOf(`id="${id}"`) < html.indexOf('id="evaluation-handoff"'),
      `${id} is rendered below the handoff block`,
    );
  }
  assert.ok(
    html.indexOf('id="evaluation-handoff"') < html.indexOf('id="site-footer"'),
    "the handoff displaced the footer's follow-up form",
  );

  const heading = doc.getElementById("evaluation-handoff-title");
  assert.equal(doc.getElementById("evaluation-handoff").getAttribute("aria-labelledby"), "evaluation-handoff-title");
  assert.equal(textOf(heading), "Share this evaluation");
});

test("the home page carries the section this link lands on", async () => {
  const [path, fragment] = HREF.split("#");
  assert.equal(path, "/index.html");

  const home = parseHtml(await read("index.html"));
  assert.equal(home.querySelectorAll(`#${fragment}`).length, 1, "the brief anchor does not resolve to one section");

  const brief = home.getElementById(fragment);
  assert.equal(textOf(brief.querySelector("h2")), "Shiplog evaluation brief");
  // Both assets the link promises: the scorecard is its own section, directly
  // below the brief, so one anchor delivers a reader to both.
  assert.equal(home.querySelectorAll("#shiplog-pilot-scorecard").length, 1);
  const sections = childIds(home.getElementById("main-content"));
  assert.equal(sections.indexOf("shiplog-pilot-scorecard") - sections.indexOf(fragment), 1);
});

test("the handoff block reuses the page's existing responsive rules", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  for (const rule of [".release-followup-slot", ".release-followup", ".release-followup-title",
    ".release-followup-lead", ".release-followup-target", ".text-link"]) {
    assert.ok(new RegExp(`\\${rule}[\\s,{:]`).test(css), `${rule} is not a rule this stylesheet ships`);
  }
  // Prose that stays readable on a wide screen, and a callout that narrows with
  // the column rather than at a width a module measured.
  assert.match(css, /\.release-followup-lead \{[^}]*max-width:70ch/);
  assert.match(css, /@media\(max-width:520px\)/);
  // Nothing was added to the stylesheet for this block: it has no size headroom.
  assert.doesNotMatch(css, /evaluation-handoff/);
});
