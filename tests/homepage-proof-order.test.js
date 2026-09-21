import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf, pressEnter, pressSpace, tabSequence } from "./support/browser.js";
import { PILOT_SCORECARD_CRITERIA } from "../src/shiplog-pilot-scorecard.js";

const root = process.env.SHIPLOG_E2E_BUILD_ROOT || "src";
const file = (name) => new URL(`../${root}/${name}`, import.meta.url);

test("homepage presents the promise, demo and proof before evaluation material", async (t) => {
  const page = await loadPage(file("index.html"));
  t.after(() => page.restore());
  const doc = page.document;
  const html = await readFile(file("index.html"), "utf8");
  const markers = ['id="top"', 'id="core-demo-link"', 'class="hero-boundary"',
    'id="shiplog-entry"', 'One recorded decision, and the release that shipped it',
    'id="deployment-status"', 'id="record-history"', 'id="shiplog-evaluation-brief"',
    'id="shiplog-pilot-scorecard"', 'id="additional-capability"'];
  let previous = -1;
  for (const marker of markers) {
    const position = html.indexOf(marker);
    assert.ok(position > previous, `${marker} must follow the previous section`);
    previous = position;
  }
  const hero = doc.getElementById("top");
  assert.deepEqual(hero.querySelectorAll("a").map((a) => a.getAttribute("href")),
    ["#record-history-title"]);
  const sections = doc.getElementById("main-content").children.filter((node) => node.tagName === "SECTION");
  assert.deepEqual(sections.slice(0, 5).map((node) => node.id),
    ["top", "shiplog-entry", "record-history", "shiplog-evaluation-brief", "shiplog-pilot-scorecard"]);
});

test("scorecard headings stay visible and native instructions toggle with Enter and Space", async (t) => {
  const page = await loadPage(file("index.html"));
  t.after(() => page.restore());
  const doc = page.document;
  const rows = doc.getElementById("shiplog-pilot-scorecard").querySelectorAll("li");
  assert.equal(rows.length, 4);
  rows.forEach((row, index) => {
    const heading = row.querySelector("h3");
    const details = row.querySelector("details");
    const summary = details.querySelector("summary");
    assert.equal(textOf(heading), PILOT_SCORECARD_CRITERIA[index][0]);
    assert.equal(heading.closest("details"), null, "row name stays outside collapsed content");
    // The intro claims every target, result and owner below is blank, so the
    // fields carrying that claim stay in flow. textOf reads through a closed
    // disclosure, so only this structural check can catch them folding away.
    assert.equal(row.querySelector("dl").closest("details"), null, "blank fields stay outside collapsed content");
    assert.equal(details.hasAttribute("open"), false);
    assert.equal(textOf(summary), `Instructions for ${textOf(heading)}`);
    assert.equal(summary.parentNode, details);
    assert.equal(summary.getAttribute("role"), null);
    assert.equal(summary.getAttribute("tabindex"), null);
    assert.equal(summary.getAttribute("aria-expanded"), null, "native expanded state owns semantics");
    assert.equal(details.querySelectorAll("a,button,input,textarea,select,[tabindex]").length, 0,
      "collapsed instructions contain no extra focus targets");
    assert.ok(tabSequence(doc).includes(summary));
    summary.focus();
    for (const activate of [pressEnter, pressSpace]) {
      activate(doc);
      assert.equal(details.hasAttribute("open"), true);
      assert.equal(textOf(details.querySelector("p")), PILOT_SCORECARD_CRITERIA[index][1]);
      activate(doc);
      assert.equal(details.hasAttribute("open"), false);
      assert.equal(doc.activeElement, summary);
    }
  });
});

for (const name of ["releases.html", "coach.html", "social.html", "profile.html", "agents.html"]) {
  test(`${name} still links directly to the visible, focusable relocated brief`, async (t) => {
    const source = await loadPage(file(name));
    t.after(() => source.restore());
    const href = source.document.getElementById("site-footer-assets").getAttribute("href");
    assert.equal(href, "/#shiplog-evaluation-brief");
    const home = await loadPage(file("index.html"), { location: { hash: href.slice(1) } });
    t.after(() => home.restore());
    const target = home.document.getElementById(href.split("#")[1]);
    assert.equal(target.getAttribute("tabindex"), "-1", "native fragment focus without an extra tab stop");
    for (let node = target; node; node = node.parentNode) {
      assert.ok(!node.hidden);
      assert.notEqual(node.tagName, "DETAILS");
    }
    target.focus();
    assert.equal(home.document.activeElement, target);
    assert.ok(!tabSequence(home.document).includes(target));
  });
}

test("evaluation styles retain narrow layouts, wrapping, touch targets and focus outlines", async () => {
  const css = await readFile(file("shiplog-pilot-scorecard.css"), "utf8");
  assert.match(css, /@media\(max-width:520px\).*grid-template-columns:1fr/);
  assert.match(css, /\.pilot-scorecard-criteria summary \{[^}]*min-height:44px/);
  assert.match(css, /summary:focus-visible,[\s\S]*?outline:3px solid var\(--focus-ring\)/);
  assert.match(css, /#shiplog-evaluation-brief \{ overflow-wrap:anywhere/);
  assert.match(css, /#shiplog-pilot-scorecard \{ overflow-wrap:anywhere/);
  assert.match(css, /#shiplog-pilot-scorecard \.share-button \{[^}]*max-width:100%;[^}]*min-height:44px;[^}]*white-space:normal/);
});

test("hero targets a visible native-focus heading before every workspace control", async (t) => {
  const page = await loadPage(file("index.html"));
  t.after(() => page.restore());
  const doc = page.document;
  const hero = doc.getElementById("core-demo-link");
  const heading = doc.getElementById(hero.getAttribute("href").slice(1));
  assert.equal(heading.tagName, "H2");
  assert.equal(textOf(heading), "Decision and release workspace");
  assert.equal(heading.getAttribute("tabindex"), "-1");
  const workspace = doc.getElementById("record-history");
  assert.equal(workspace.getAttribute("aria-labelledby"), heading.id);
  for (let node = heading; node; node = node.parentNode) {
    assert.equal(node.hidden, false);
    assert.notEqual(node.tagName, "DETAILS");
  }
  // The harness records native navigation; real fragment scrolling/focus is
  // the browser's responsibility, with no script interception or load race.
  hero.focus();
  pressEnter(doc);
  hero.click();
  assert.deepEqual(doc.navigations, ["#record-history-title", "#record-history-title"]);
  heading.focus();
  assert.equal(doc.activeElement.id, heading.id);
  const sequence = tabSequence(doc);
  assert.ok(!sequence.includes(heading), "heading adds no sequential tab stop");
  const controls = workspace.querySelectorAll("input,textarea,select,button,a,summary");
  const stops = sequence.filter((node) => controls.includes(node));
  assert.ok(stops.length > 10, "recording and browsing controls remain reachable");
  const briefCopy = sequence.indexOf(doc.getElementById("copy-shiplog-evaluation-brief"));
  for (const control of stops) assert.ok(sequence.indexOf(control) < briefCopy);
  for (const id of ["export-shiplog", "export-shiplog-scope", "import-shiplog-file"]) {
    const control = doc.getElementById(id);
    assert.ok(controls.includes(control), `${id} travels with the workspace`);
    assert.ok(sequence.includes(control), `${id} remains keyboard reachable`);
  }
  assert.ok(workspace.querySelector("#sample-release-list"), "linked release experience travels too");
  const css = await readFile(file("styles.css"), "utf8");
  assert.match(css, /#record-history-title:focus \{ outline:3px solid var\(--focus-ring\)/);
  assert.match(css, /#record-history-title \{ scroll-margin-top:24px/);
});
