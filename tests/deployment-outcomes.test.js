// What does a reader do when the deployment check does not come out "match"?
// (#2681)
//
// The band's authored lead said what a match proves and nothing else, so the
// two outcomes a visitor is most likely to need explained — the versions
// disagree, and the check never answered — arrived as a red callout and a
// sentence with no reading instructions attached. These tests pin the three
// explanations to one set of words, shared by both documents, present before
// any module runs.
//
// WHY THE BYTES AND NOT THE PAINT. The state this copy matters most in is the
// one where the probe never answers. Copy that is rendered has, by then,
// already failed to arrive once. So both assertions below read the shipped
// documents as text and as a cold parse, never a booted page.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEPLOYMENT_OUTCOMES,
  DEPLOYMENT_STATES,
  deploymentVerdict,
  verdictCopyText,
} from "../src/deployment-status.js";
import { renderDeploymentStatus } from "../src/deployment-status-view.js";
import { loadPage, parseHtml, textOf } from "./support/browser.js";

const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

// The two surfaces that mount the check. Both carry every sentence here; the
// pair is the point, so they are driven from one list rather than two tests.
const PAGES = ["index.html", "releases.html"];

const REPOSITORY_LINK_LABEL = "Open the public repository this site is built from";

const NOW = "2026-08-06T12:00:00.000Z";
const RECORD = Object.freeze({
  id: "r-2-1-0",
  version: "v2.1.0",
  title: "Queue drain",
  status: "completed",
  owner: "Ellis",
  createdAt: "2026-08-04T12:00:00.000Z",
  decisionIds: [],
});

/* ------------------- one sentence per reachable outcome ------------------- */

test("the outcome copy covers every state the check can reach, and invents no other", () => {
  assert.deepEqual(Object.keys(DEPLOYMENT_OUTCOMES), [...DEPLOYMENT_STATES]);

  for (const [state, sentence] of Object.entries(DEPLOYMENT_OUTCOMES)) {
    assert.match(sentence, /\.$/, `the ${state} explanation does not read as a full sentence`);
    // It explains an outcome; it does not ask the reader to interpret one.
    assert.doesNotMatch(sentence, /\?/, `the ${state} explanation asks a question`);
    // The band already marks the example records once, in the panel above it.
    assert.doesNotMatch(sentence, /example/i, `the ${state} explanation restates the example caveat`);
    assert.doesNotMatch(
      sentence,
      /customer or production data/,
      `the ${state} explanation makes a second data claim`,
    );
    // One name per thing, and these are two the band retired: the deployment
    // answering the probe is named by the version it reports, and the record is
    // "the deployment record". tests/releases.test.js holds that page to the
    // same list; this holds the shared sentences, so the front door cannot
    // bring a retired name back through them.
    for (const retired of ["the running deployment", "the version this site is running right now"]) {
      assert.equal(
        sentence.includes(retired),
        false,
        `the ${state} explanation says "${retired}"`,
      );
    }
  }

  // A mismatch is a result, not an apology and not an alarm.
  assert.doesNotMatch(DEPLOYMENT_OUTCOMES.drift, /sorry|unfortunately|problem|wrong|error|failed/i);
  // And it names the one thing a reader can do about it from either page.
  assert.ok(
    DEPLOYMENT_OUTCOMES.drift.includes(`Open the public repository this site is built from`),
    "the mismatch explanation names no next step",
  );
});

/* ----------------------- both documents, same words ----------------------- */

test("both documents ship the three outcome explanations before the check runs", async () => {
  for (const file of PAGES) {
    const markup = await read(file);
    const document = parseHtml(markup);

    // What a match proves stays where it has always been: in the lead, beside
    // the sentence saying what is compared.
    assert.ok(
      textOf(document.querySelector("#deployment-status-proof")).includes(DEPLOYMENT_OUTCOMES.match),
      `${file} no longer says what a match means`,
    );

    // The other two stand together, in the shipped bytes, in the module's
    // words. Byte for byte against the constant, so neither document can drift
    // into a second wording of one outcome.
    const outcomes = document.querySelector("#deployment-outcomes");
    assert.ok(outcomes, `${file} ships no outcome explanation`);
    assert.equal(
      textOf(outcomes),
      `${DEPLOYMENT_OUTCOMES.drift} ${DEPLOYMENT_OUTCOMES.unknown}`,
      `${file} words the non-matching outcomes its own way`,
    );

    // Once each, and in the document rather than only in the parse: a second
    // copy of an outcome is a second account of one comparison.
    for (const [state, sentence] of Object.entries(DEPLOYMENT_OUTCOMES)) {
      assert.equal(
        markup.split(sentence).length - 1,
        1,
        `${file} ships the ${state} explanation ${markup.split(sentence).length - 1} times`,
      );
    }

    // Read without expanding anything, and hidden from nobody. The harness
    // reads text through a closed disclosure, so this is asserted on where the
    // node sits rather than on what textOf can reach.
    let inBand = false;
    for (let node = outcomes; node; node = node.parentNode) {
      assert.notEqual(node.tagName, "DETAILS", `${file} hides the outcomes behind a disclosure`);
      assert.equal(node.hidden ?? false, false, `${file} hides the outcomes from assistive technology`);
      if (node.id === "deployment-status") {
        inBand = true;
        break;
      }
    }
    assert.ok(inBand, `${file} puts the outcomes outside the deployment check`);

    // No verdict in the bytes: these sentences say how to read an answer, and
    // must never read as one nobody ran.
    assert.doesNotMatch(
      textOf(outcomes),
      /Confirmed: this site is running|Not a match: this site is running|The check did not complete/,
      `${file} states a verdict the page has not reached`,
    );

    // The next step the mismatch sentence names is a link this document
    // already carries, under the words the sentence uses for it. No new
    // focusable was added to say so: the front door's first screen has no
    // spare tab stop.
    const repositoryLinks = document.querySelectorAll("a")
      .filter((node) => textOf(node) === REPOSITORY_LINK_LABEL);
    assert.ok(repositoryLinks.length >= 1, `${file} names a repository link it does not carry`);
  }
});

test("the two documents word each outcome identically", async () => {
  const [home, releases] = await Promise.all(PAGES.map(async (file) => parseHtml(await read(file))));
  assert.equal(
    textOf(home.querySelector("#deployment-outcomes")),
    textOf(releases.querySelector("#deployment-outcomes")),
  );
});

// Each page is closed before the next is opened, in a `finally` rather than a
// `t.after`: per-test teardown runs oldest first, so two pages left open would
// restore the first page's globals last and leave the harness holding the
// wrong document.
test("no settled state rewrites the outcome explanations on either page", async () => {
  const expected = `${DEPLOYMENT_OUTCOMES.drift} ${DEPLOYMENT_OUTCOMES.unknown}`;
  const readings = [
    { health: { status: "ok", build: "v2.1.0" } },
    { health: { status: "ok", build: "v2.0.0" } },
    { failure: "unreachable" },
  ];

  for (const file of [HOME_PAGE, RELEASES_PAGE]) {
    const page = await loadPage(file);
    try {
      // Before the check answers, and after each way it can answer: these
      // sentences are how to read the verdict, so they have to outlive it.
      assert.equal(textOf(page.document.querySelector("#deployment-outcomes")), expected);
      for (const reading of readings) {
        renderDeploymentStatus(page.document, deploymentVerdict(reading, RECORD, NOW), {
          reading,
          release: RECORD,
          location: { origin: "https://labs.wawalu.org", pathname: "/", search: "", hash: "" },
        });
        assert.equal(
          textOf(page.document.querySelector("#deployment-outcomes")),
          expected,
          `a settled state rewrote the outcome explanations on ${file.pathname}`,
        );
      }
    } finally {
      page.restore();
    }
  }
});

/* --------------------- the result a reader takes away --------------------- */

test("a copied result states the verdict in words, not two bare versions", () => {
  const readings = {
    match: { health: { status: "ok", build: "v2.1.0" } },
    drift: { health: { status: "ok", build: "v2.0.0" } },
    unknown: { failure: "unreachable" },
  };

  for (const [state, reading] of Object.entries(readings)) {
    const verdict = deploymentVerdict(reading, RECORD, NOW);
    assert.equal(verdict.state, state, `the reading for ${state} produced ${verdict.state}`);
    const copied = verdictCopyText(verdict, "https://labs.wawalu.org/releases.html");

    // The verdict leads, in the same sentence the band paints, so a pasted
    // note and the page it came from make the same claim in the same words.
    assert.match(copied, /^Deployment check verdict: /);
    const [first] = copied.split("\n");
    assert.ok(
      first.replace("Deployment check verdict: ", "").split(" ").length > 4,
      `the copied ${state} result is not a sentence`,
    );
    // Both compared values survive beside it, whichever way it came out.
    assert.match(copied, /Running build version: /);
    assert.match(copied, /Deployment record version: v2\.1\.0\./);
  }

  const drifted = verdictCopyText(deploymentVerdict(readings.drift, RECORD, NOW));
  assert.match(drifted, /^Deployment check verdict: Not a match: this site is running v2\.0\.0, but the deployment record names v2\.1\.0\./);
});

test("the releases page hands over a worded result even when the check could not complete", async (t) => {
  const page = await loadPage(RELEASES_PAGE, { location: { pathname: "/releases.html" } });
  t.after(() => page.restore());

  renderDeploymentStatus(page.document, deploymentVerdict({ failure: "unreachable" }, RECORD, NOW), {
    reading: { failure: "unreachable" },
    release: RECORD,
    location: { origin: "https://labs.wawalu.org", pathname: "/releases.html", search: "", hash: "" },
  });

  const copied = page.document.querySelector("#deployment-copy").dataset.copyText;
  assert.match(copied, /^Deployment check verdict: The check did not complete, so nothing here says which version this site is running\./);
  assert.match(copied, /Running build version: not reported\. Deployment record version: v2\.1\.0\./);
});
