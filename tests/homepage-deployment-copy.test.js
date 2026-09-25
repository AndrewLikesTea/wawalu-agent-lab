// Can a reader take the front door's deployment check away with them? (#2555)
//
// The homepage runs the site's one non-invented claim and, until now, stated it
// in a sentence that evaporated when the tab closed. The releases page has had
// a copy control and an evidence disclosure behind the same check for a while.
// These tests pin the front door to that same behaviour — the SAME control, not
// a second one worded differently — and to the three states the control has to
// be honest about: still reading, answered, and could not answer.
//
// Everything here drives the shipped markup through src/app.js the way the
// browser boots it. The health read, the clock, the build stamp and the
// clipboard are all injected, so the suite opens no socket and reads no clock.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { STORAGE_KEY, initDecisionLog } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import {
  COPY_NO_VERDICT_LINE,
  COPY_PENDING_LINE,
  DEPLOYMENT_IDS,
  pageAddress,
} from "../src/deployment-status-view.js";
import { loadPage, parseHtml, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
const NO_SEED = { decisions: [], releases: [] };

const NOW = "2026-08-06T12:00:00.000Z";
const HOME_SHA = "0123456789abcdef0123456789abcdef01234567";
const HOME_STAMP = Object.freeze({ schemaVersion: 1, commitSha: HOME_SHA, builtAt: "2026-08-04T12:00:00.000Z" });

// The record the check compares against, two days older than NOW so the metric
// reads as a fixed string.
const RECORD = Object.freeze({
  id: "r-2-1-0",
  version: "v2.1.0",
  title: "Queue drain",
  description: "Drain the queue on shutdown.",
  status: "completed",
  notes: "",
  owner: "Ellis",
  createdAt: "2026-08-04T12:00:00.000Z",
  decisionIds: [],
});

const answers = (body) => async () => body;
const fails = () => async () => { throw new Error("this message must never reach the page"); };

const byId = (page, id) => page.document.querySelector(`#${id}`);
const copyButton = (page) => byId(page, DEPLOYMENT_IDS.copy);
const copyStatus = (page) => textOf(byId(page, DEPLOYMENT_IDS.copyStatus));
const availability = (page) => textOf(byId(page, DEPLOYMENT_IDS.copyAvailability));

/**
 * Boot the front door, with the check's four inputs supplied.
 *
 * `settle: false` leaves the page in the state a visitor on a slow connection
 * actually meets: booted, painted, and still waiting on `/healthz`.
 */
async function openHome(t, { readHealth, settle = true, pathname = "/" } = {}) {
  const copied = [];
  const page = await loadPage(HOME_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([RECORD]) },
    // The address the copied result has to name is derived from the live
    // location, so the test states one rather than letting a default stand in.
    location: { pathname },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    seed: NO_SEED,
    readHealth,
    buildStamp: HOME_STAMP,
    deploymentNow: () => NOW,
    deployedRelease: RECORD,
    clipboard: { writeText: async (value) => { copied.push(value); } },
  });
  if (settle) {
    await waitFor(
      () => page.document.documentElement.dataset.shiplogDeployment === "ready",
      "the front door's deployment check never finished its comparison",
    );
  }
  return { page, copied };
}

/* --------------------- one control, one set of words ---------------------- */

test("the front door's copy control is worded exactly as the releases page's", async () => {
  const home = parseHtml(await read("index.html"));
  const releases = parseHtml(await read("releases.html"));
  const label = textOf(home.querySelector(`#${DEPLOYMENT_IDS.copy}`));

  // Byte for byte. Two surfaces offering the same check under two names is the
  // drift this assertion exists to catch, and it compares the two shipped
  // documents rather than each against a literal somebody kept in step by hand.
  assert.equal(label, textOf(releases.querySelector(`#${DEPLOYMENT_IDS.copy}`)));
  assert.equal(label, "Copy the deployment check verdict and both versions");

  // The disclosure behind it is the same shape and the same sentence.
  assert.equal(
    textOf(home.querySelector(`#${DEPLOYMENT_IDS.evidenceSummary}`)),
    textOf(releases.querySelector(`#${DEPLOYMENT_IDS.evidenceSummary}`)),
  );
  assert.equal(home.querySelector(`#${DEPLOYMENT_IDS.evidence}`).tagName, "DETAILS");

  // And it submits nothing: this block reads, it never writes.
  assert.equal(home.querySelector(`#${DEPLOYMENT_IDS.copy}`).getAttribute("type"), "button");
});

test("the copied result names the verdict, both versions, and the page it was copied from", async (t) => {
  const { page, copied } = await openHome(t, { readHealth: answers({ status: "ok", build: "v2.0.0" }) });

  copyButton(page).click();
  await waitFor(() => copyStatus(page) !== "");
  assert.equal(copied.length, 1, "one press, one write");
  const text = copied[0];

  // (1) the verdict, (2) the running build, (3) the version in the record,
  // (4) where it was read — the four facts a pasted incident note needs to be
  // re-checkable by somebody who was not at the screen.
  assert.match(text, /^Deployment check verdict: Not a match: this site is running v2\.0\.0/);
  assert.match(text, /Running build version: v2\.0\.0\./);
  assert.match(text, /Deployment record version: v2\.1\.0\./);
  assert.match(text, /\nCopied from: https:\/\/labs\.wawalu\.org\/$/);
});

test("the address in the copied result is derived from the live location, not written down", async (t) => {
  // The same control is mounted on two pages. If the address were authored,
  // one of them would name the other, so the derivation is asserted by moving
  // the page and watching the address move with it.
  const { page, copied } = await openHome(t, {
    readHealth: answers({ status: "ok", build: "v2.1.0" }),
    pathname: "/index.html",
  });
  copyButton(page).click();
  await waitFor(() => copyStatus(page) !== "");
  assert.match(copied[0], /\nCopied from: https:\/\/labs\.wawalu\.org\/index\.html$/);
  assert.doesNotMatch(copied[0], /releases\.html/);

  // The query string and fragment a reader happens to be on are not part of
  // where the check ran, and a location this cannot read yields no address at
  // all rather than a guessed one.
  assert.equal(
    pageAddress({ origin: "https://labs.wawalu.org", pathname: "/", search: "?focus=x", hash: "#deployment-status" }),
    "https://labs.wawalu.org/",
  );
  assert.equal(pageAddress({ pathname: "/" }), null);
  assert.equal(pageAddress(null), null);
});

/* ------------------------------ still reading ----------------------------- */

test("while the check is reading, the control is unusable and the page says when it will not be", async (t) => {
  let answer;
  const { page, copied } = await openHome(t, {
    readHealth: () => new Promise((resolve) => { answer = resolve; }),
    settle: false,
  });
  await waitFor(() => typeof answer === "function", "the probe never started");

  // Visibly unavailable, and said in words rather than only in the control's
  // greyed-out state: a disabled button explains nothing on its own.
  assert.equal(copyButton(page).disabled, true, "a verdict was offered for copying before the check produced one");
  assert.equal(availability(page), COPY_PENDING_LINE);
  assert.equal(availability(page), "The copy control becomes available once the check answers.");

  // Pressing it anyway writes nothing and blames nothing.
  copyButton(page).click();
  await Promise.resolve();
  assert.equal(copied.length, 0, "a half-loaded page wrote to the clipboard");
  assert.equal(copyStatus(page), "", "the page reported a clipboard failure while the check was still running");

  // And the waiting line is authored, not painted: a reader whose scripts never
  // ran still meets a true statement about the control in front of them.
  const shipped = parseHtml(await read("index.html"));
  assert.equal(textOf(shipped.querySelector(`#${DEPLOYMENT_IDS.copyAvailability}`)), COPY_PENDING_LINE);
  assert.equal(shipped.querySelector(`#${DEPLOYMENT_IDS.copy}`).disabled, true);

  // Once the check answers, the control becomes usable and the line retires
  // rather than promising something that already happened.
  answer({ status: "ok", build: "v2.1.0" });
  await waitFor(() => page.document.documentElement.dataset.shiplogDeployment === "ready");
  assert.equal(copyButton(page).disabled, false, "the control stayed unusable after the check answered");
  assert.equal(availability(page), "");
});

/* ---------------------------- the confirmation ---------------------------- */

test("the confirmation says the verdict was copied without restating it", async (t) => {
  for (const build of ["v2.1.0", "v2.0.0"]) {
    const { page } = await openHome(t, { readHealth: answers({ status: "ok", build }) });
    copyButton(page).click();
    await waitFor(() => copyStatus(page) !== "");

    // Verdict-neutral on purpose. A confirmation reading "Match copied" would
    // be a second, unchecked claim about the comparison — and it would be wrong
    // on one of these two runs while looking right on the other.
    assert.equal(copyStatus(page), "Deployment check verdict and both version values copied to clipboard.");
    assert.doesNotMatch(copyStatus(page), /\bmatch|mismatch|drift|confirmed\b/i);
  }
});

/* ------------------------------ the evidence ------------------------------ */

test("the evidence disclosure is reachable by keyboard and names both sides of the comparison", async (t) => {
  const { page } = await openHome(t, { readHealth: answers({ status: "ok", build: "v2.0.0", storage: "available" }) });
  const details = byId(page, DEPLOYMENT_IDS.evidence);
  const summary = byId(page, DEPLOYMENT_IDS.evidenceSummary);

  // Closed on arrival, and saying so where assistive technology reads it. The
  // harness reads text through a closed disclosure, so the state is asserted on
  // the wiring rather than on whether the text can be found.
  assert.ok(!details.open, "the evidence opens the page already expanded");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(summary.getAttribute("aria-controls"), DEPLOYMENT_IDS.evidenceBody);

  // Reached by Tab alone, bounded by the page's own stops so a focusable added
  // above it fails this rather than looping.
  let reached = null;
  for (let step = 0; step < tabSequence(page.document).length && reached !== summary; step += 1) {
    reached = pressTab(page.document);
  }
  assert.ok(reached === summary, "the evidence disclosure is not reachable from the keyboard");
  pressEnter(page.document);
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(details.dataset.disclosure, "expanded");

  // What the running build answered, and the record it was compared with. Read
  // off the term/description nodes rather than out of the collapsed text: the
  // pairing is the evidence, and a flat string cannot tell which value belongs
  // to which field.
  const nodes = byId(page, DEPLOYMENT_IDS.evidenceBody).childElements;
  const descriptions = nodes.filter((node) => node.tagName === "DD");
  const pairs = nodes
    .filter((node) => node.tagName === "DT")
    .map((term, index) => [textOf(term), textOf(descriptions[index])]);

  assert.deepEqual(pairs, [
    ["Checked at", NOW],
    ["status", "ok"],
    ["build", "v2.0.0"],
    ["storage", "available"],
    ["Record id", "r-2-1-0"],
    ["Version", "v2.1.0"],
    ["Title", "Queue drain"],
    ["Status", "completed"],
    ["Owner", "Ellis"],
    ["Recorded at", "2026-08-04T12:00:00.000Z"],
  ]);
});

/* --------------------------- no verdict to copy --------------------------- */

test("a check that cannot answer offers no copy control and says there is nothing to copy", async (t) => {
  const { page, copied } = await openHome(t, { readHealth: fails() });
  const button = copyButton(page);

  // Withdrawn, not merely greyed out, and out of the tab order with it: a
  // control whose only possible result is "nothing was established" is not a
  // control. Asserted on counts and attributes — comparing a harness node
  // against null walks the whole page.
  assert.equal(button.hidden, true, "a copy control was offered for a verdict that does not exist");
  assert.equal(button.disabled, true);
  assert.equal(button.dataset.copyText, "", "the withdrawn control still carried something to copy");
  assert.equal(tabSequence(page.document).filter((node) => node === button).length, 0);

  // And the page says so in plain words, where the control used to be.
  assert.equal(availability(page), COPY_NO_VERDICT_LINE);
  assert.equal(availability(page), "The check did not answer, so there is no verdict to copy yet.");

  // The verdict line still states the failure, and nothing reached a clipboard.
  assert.match(textOf(byId(page, DEPLOYMENT_IDS.verdict)), /^The check did not complete/);
  assert.equal(copied.length, 0);
});
