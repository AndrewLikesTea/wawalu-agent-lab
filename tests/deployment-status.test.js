// Does the releases page answer "is what is running what we recorded?" — and
// does it answer honestly when it cannot tell?
//
// Every test drives the shipped page: the real markup from src/releases.html,
// booted through initReleasesPage the way the browser boots it. Nothing here
// opens a socket. The health read is injected as `readHealth` — a function that
// returns a fixture body or throws a fixture failure — so the four cases below
// (match, drift, unexpected shape, unreachable) cost one object each and the
// suite has no network, no timers, and no clock of its own: `now` is injected
// too, so the duration in the metric is an asserted string, not a moving one.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY, initDecisionLog } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import {
  UNKNOWN_REASONS,
  deploymentVerdict,
  durationText,
  verdictMetricText,
  verdictSentence,
} from "../src/deployment-status.js";
import {
  DEPLOYMENT_IDS,
  parseHealthBody,
  probeHealth,
  renderDeploymentStatus,
} from "../src/deployment-status-view.js";
import { loadPage, pressEnter, pressTab, textOf } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

const NOW = "2026-08-06T12:00:00.000Z";

// Two days older than NOW, so the metric's duration is a fixed string.
const NEWEST = {
  id: "r-2-1-0",
  version: "v2.1.0",
  title: "Queue drain",
  description: "Drain the queue on shutdown.",
  status: "completed",
  notes: "",
  owner: "Ellis",
  createdAt: "2026-08-04T12:00:00.000Z",
  decisionIds: [],
};

const OLDER = { ...NEWEST, id: "r-2-0-0", version: "v2.0.0", title: "Read cache", createdAt: "2026-06-01T12:00:00.000Z" };

async function openReleases(t, { releases = [OLDER, NEWEST], readHealth } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify([]),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  // The record the check compares against is injected for the same reason the
  // health reading and the clock are: these cases are about how each outcome
  // reads, not about which record production picks. Which record production
  // picks — the real record of this deployment, derived from the build stamp —
  // is pinned in tests/deployed-release.test.js.
  initReleasesPage(page.document, page.storage, {
    seed: NO_SEED,
    readHealth,
    now: () => NOW,
    deployedRelease: NEWEST,
  });
  await waitFor(
    () => page.document.documentElement.dataset.shiplogDeployment === "ready",
    "the deployment status band never finished its comparison",
  );
  return page;
}

// A reader that answers with a body, as the endpoint would.
const answers = (body) => async () => body;
// A reader that fails, as an unreachable endpoint would. The rejection value
// never reaches the page: only the reason does.
const fails = (name) => async () => {
  const error = new Error("this message must never reach the page");
  error.name = name;
  throw error;
};

const verdictText = (page) => textOf(page.document.querySelector("#deployment-verdict"));
const metricText = (page) => textOf(page.document.querySelector("#deployment-metric"));
const nextActions = (page) => page.document.querySelectorAll("[data-deployment-action]");
const evidenceText = (page) => textOf(page.document.querySelector("#deployment-evidence-body"));

// The evidence list as term/description pairs, read off the rendered nodes.
function evidencePairs(page) {
  const nodes = page.document.querySelector("#deployment-evidence-body").childElements;
  return nodes
    .filter((node) => node.tagName === "DT")
    .map((term, index) => [textOf(term), textOf(nodes.filter((node) => node.tagName === "DD")[index])]);
}

// Every tag inside the band that could change state. Walked rather than
// selected: the harness rejects a descendant selector.
function mutatingControls(node, found = []) {
  for (const child of node.children ?? []) {
    if (["FORM", "BUTTON", "INPUT", "TEXTAREA", "SELECT"].includes(child.tagName)) found.push(child.tagName);
    mutatingControls(child, found);
  }
  return found;
}

/* --------------------------- what the check proves ------------------------ */

test("the band opens with what the check proves, ahead of the answer and outside every disclosure", async (t) => {
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  const proof = page.document.querySelector("#deployment-status-proof");
  const sentence = textOf(proof);

  // What the check proves, in the page's own words, before any evidence.
  assert.match(sentence, /does the real record of this deployment, at the top of this page, name the version this site is running right now\?/);
  // And the line the rest of the page draws, kept here: the worked example
  // above is invented, the record this check names and this answer are not.
  assert.match(sentence, /The example decision and release above are invented; that record and this answer are not\./);

  // The harness reads text through a closed disclosure, so "a reader sees this
  // without expanding anything" is asserted on where the node sits: inside the
  // band, hidden by nothing, with no disclosure anywhere above it.
  let inBand = false;
  for (let node = proof; node; node = node.parentNode) {
    assert.notEqual(node.tagName, "DETAILS", "the proof sentence sits behind the evidence disclosure");
    assert.equal(node.hidden ?? false, false, "the proof sentence is hidden from assistive technology");
    if (node.id === DEPLOYMENT_IDS.panel) {
      inBand = true;
      break;
    }
  }
  assert.ok(inBand, "the proof sentence is not inside the deployment status band");

  // It leads: the answer line comes after it, not before.
  const lines = page.document.querySelector("#deployment-status-callout").childElements.map((node) => node.id);
  assert.ok(
    lines.indexOf("deployment-status-proof") < lines.indexOf(DEPLOYMENT_IDS.verdict),
    "the answer is rendered above the sentence saying what the check proves",
  );
});

/* ------------------------------- the verdict ------------------------------ */

test("match, mismatch, and a check that did not complete each read as a different answer", async (t) => {
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  // Rendered into the shipped markup, one state after another, so what is
  // compared is the sentence a reader would actually see.
  const render = (reading) => {
    renderDeploymentStatus(page.document, deploymentVerdict(reading, NEWEST, NOW), { reading, release: NEWEST });
    return verdictText(page);
  };
  const matched = render({ health: { status: "ok", build: "v2.1.0" } });
  const drifted = render({ health: { status: "ok", build: "v2.0.0" } });
  const stalled = render({ failure: "unreachable" });

  assert.equal(new Set([matched, drifted, stalled]).size, 3, "two states told a reader the same thing");
  assert.match(matched, /^Confirmed: this site is running v2\.1\.0/);
  assert.match(drifted, /^Not a match:/);
  assert.match(stalled, /^The check did not complete/);

  // A check that could not finish is not a mismatch, and neither of them may
  // be read as a match.
  assert.notEqual(drifted, stalled);
  for (const sentence of [drifted, stalled]) {
    assert.doesNotMatch(sentence, /Confirmed|is the version|matches/, "a non-matching state hinted at a match");
  }
  // The match reads without the evidence: no endpoint, no sha, no field name.
  assert.doesNotMatch(matched, /healthz|sha|identifier|payload/i);
});

test("a running build that equals the newest record reads as a match and offers no action", async (t) => {
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });

  assert.equal(
    verdictText(page),
    "Confirmed: this site is running v2.1.0, the version the real record of this deployment names.",
  );
  assert.equal(metricText(page), "Running v2.1.0 · Real record v2.1.0 · recorded 2 days ago");
  // The match state's whole claim: there is nothing to do, and nothing to click.
  assert.equal(nextActions(page).length, 0, "a matching deployment offered a next action");
  assert.match(
    textOf(page.document.querySelector("#deployment-next-action")),
    /No action is needed/,
  );
  assert.equal(page.document.querySelector("#deployment-status").dataset.deploymentState, "match");
});

test("a running build that differs from the newest record reads as drift and names one record to reconcile", async (t) => {
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: "v2.0.0" }) });

  assert.equal(
    verdictText(page),
    "Not a match: this site is running v2.0.0, but the real record of this deployment names v2.1.0.",
  );
  assert.equal(metricText(page), "Running v2.0.0 · Real record v2.1.0 · recorded 2 days ago");

  const actions = nextActions(page);
  assert.equal(actions.length, 1, "drift must name exactly one next action");
  assert.equal(actions[0].textContent, "Reconcile release v2.1.0");
  // Linked directly at the record it names, not at the list it lives in.
  assert.equal(actions[0].href, "/release.html?id=r-2-1-0");
  assert.equal(actions[0].getAttribute("aria-describedby"), "deployment-next-action-target");
  assert.equal(page.document.querySelector("#deployment-status").dataset.deploymentState, "drift");
});

test("a health response in an unexpected shape reads as unknown, in plain language and with no error object", async (t) => {
  const page = await openReleases(t, { readHealth: answers(["not", "a", "status", "document"]) });

  assert.equal(
    verdictText(page),
    "The check did not complete, so nothing here says which version this site is running. "
      + UNKNOWN_REASONS["unexpected-shape"],
  );
  // The comparison it can still make: the recorded build is last-known-good.
  assert.equal(metricText(page), "Running not reported · Real record v2.1.0 · recorded 2 days ago");
  assert.equal(nextActions(page).length, 1, "unknown must name exactly one next action");
  assert.equal(nextActions(page)[0].href, "/release.html?id=r-2-1-0");
  assert.doesNotMatch(verdictText(page), /Error|error:|at .*\.js/, "a reader was shown an error object");
});

test("an unreachable health check reads as unknown and still reports the last-known-good record", async (t) => {
  const page = await openReleases(t, { readHealth: fails("TypeError") });

  assert.equal(
    verdictText(page),
    "The check did not complete, so nothing here says which version this site is running. "
      + UNKNOWN_REASONS.unreachable,
  );
  assert.equal(metricText(page), "Running not reported · Real record v2.1.0 · recorded 2 days ago");
  assert.equal(nextActions(page).length, 1, "unknown must name exactly one next action");
  // The thrown message is not a thing a reader is shown.
  assert.doesNotMatch(verdictText(page), /must never reach the page/);
  assert.doesNotMatch(evidenceText(page), /must never reach the page/);
});

test("an aborted health check is reported as a timeout, not as an unreachable endpoint", async (t) => {
  const page = await openReleases(t, { readHealth: fails("AbortError") });
  assert.match(verdictText(page), /did not answer in time/);
});

/* ------------------------------- the evidence ----------------------------- */

test("the evidence disclosure is keyboard-operable and exposes its contents when open", async (t) => {
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: "v2.0.0", storage: "available" }) });
  const details = page.document.querySelector("#deployment-evidence");
  const summary = page.document.querySelector("#deployment-evidence-summary");

  // Closed on arrival, and saying so where assistive technology reads it. The
  // harness reads text through a closed disclosure, so the state is asserted on
  // the wiring rather than on whether the text can be found.
  assert.equal(details.hasAttribute("open"), false);
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(details.dataset.disclosure, "collapsed");
  assert.equal(summary.getAttribute("aria-controls"), "deployment-evidence-body");

  // Reachable by Tab, and operable by Enter, from where a keyboard user stands.
  let reached = false;
  for (let step = 0; step < 200 && !reached; step += 1) {
    reached = pressTab(page.document) === summary;
  }
  assert.ok(reached, "the evidence disclosure is not reachable by keyboard");
  pressEnter(page.document);

  assert.equal(details.hasAttribute("open"), true, "Enter did not open the disclosure");
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(details.dataset.disclosure, "expanded");
  // Open means exposed: nothing between the body and the disclosure is hidden.
  for (let node = page.document.querySelector("#deployment-evidence-body"); node; node = node.parentNode) {
    assert.equal(node.hidden ?? false, false, "the evidence content is hidden from assistive technology");
    if (node === details) break;
  }

  // What is behind the disclosure, as the term/description pairs it renders:
  // when the check ran, every field the health response carried, and the fields
  // of the record it was compared with.
  assert.deepEqual(evidencePairs(page), [
    ["Checked at", "2026-08-06T12:00:00.000Z"],
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

/* ---------------------------- no writes, no HTML -------------------------- */

test("the band writes nothing and executes no supplied markup", async (t) => {
  const hostile = "<img src=x onerror=alert(1)>";
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: hostile }) });

  assert.match(verdictText(page), /<img src=x onerror=alert\(1\)>/, "the build identifier was not shown as text");
  // Inserted as text, so the page holds no element the response asked for.
  assert.equal(page.document.querySelectorAll("img").length, 0, "supplied markup became an element");
  // The band has no control that could submit: the only thing it renders is a
  // link to a record. Walked, because the harness rejects a descendant selector.
  assert.deepEqual(mutatingControls(page.document.querySelector("#deployment-status")), []);
  assert.equal(
    JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY)).length,
    2,
    "the deployment band changed the release log",
  );
});

/* ------------------------------ the pure core ----------------------------- */

test("the comparison is a pure function of the reading, the record, and the clock", () => {
  const match = deploymentVerdict({ health: { status: "ok", build: "v2.1.0" } }, NEWEST, NOW);
  assert.equal(match.state, "match");
  assert.equal(match.nextAction, null);
  assert.equal(match.deployedBuild, "v2.1.0");
  assert.equal(match.recordedBuild, "v2.1.0");
  assert.equal(match.heldFor, "2 days");

  const noStatus = deploymentVerdict({ health: { version: "v1.9.9" } }, NEWEST, NOW);
  assert.equal(noStatus.state, "unknown", "a body with no status is not a status document");

  const noRecord = deploymentVerdict({ health: { status: "ok", build: "v9" } }, null, NOW);
  assert.equal(noRecord.state, "unknown");
  assert.equal(noRecord.reason, UNKNOWN_REASONS["no-record"]);
  // With nothing recorded there is still exactly one next action, and it points
  // at the recorder rather than at a record that does not exist.
  assert.equal(noRecord.nextAction.href, "/releases.html#record-release");
  assert.equal(verdictMetricText(noRecord), "Running v9 · Real record none recorded · never recorded");

  const noBuild = deploymentVerdict({ health: { status: "ok", storage: "available" } }, NEWEST, NOW);
  assert.equal(noBuild.state, "unknown");
  assert.equal(noBuild.reason, UNKNOWN_REASONS["no-build"]);

  // The failure name is the only thing a failed reading carries forward.
  assert.equal(deploymentVerdict({ failure: "timeout" }, NEWEST, NOW).reason, UNKNOWN_REASONS.timeout);
  assert.equal(deploymentVerdict({ failure: "nonsense" }, NEWEST, NOW).reason, UNKNOWN_REASONS.unreachable);
});

test("durations are stated coarsely and a clock that runs backwards is not a duration", () => {
  assert.equal(durationText(0), "less than a minute");
  assert.equal(durationText(90 * 1000), "1 minute");
  assert.equal(durationText(3 * 60 * 60 * 1000), "3 hours");
  assert.equal(durationText(-1), "an unknown time");
  assert.equal(durationText(Number.NaN), "an unknown time");
});

test("the probe recognises both shipped health bodies and refuses anything else", async () => {
  // The Pages Function answers JSON; the static artifact answers `ok`.
  assert.deepEqual(parseHealthBody('{"status":"ok","build":"v1"}'), { status: "ok", build: "v1" });
  assert.deepEqual(parseHealthBody("ok\n"), { status: "ok" });
  assert.equal(parseHealthBody(""), null);
  assert.equal(parseHealthBody("<html>a proxy error page</html>"), null);

  assert.deepEqual(await probeHealth(answers({ status: "ok" }), NOW), { health: { status: "ok" }, checkedAt: NOW });
  assert.deepEqual(await probeHealth(fails("TypeError"), NOW), { failure: "unreachable", checkedAt: NOW });
  assert.deepEqual(await probeHealth(fails("AbortError"), NOW), { failure: "timeout", checkedAt: NOW });
});

/* ------------------- the same check, on the front door (#1791) ------------- */
//
// The homepage's decision-and-release section runs the SAME check, not a second
// one: src/index.html carries the ids deployment-status-view.js fills, and
// src/app.js boots it from the log it has already composed. So these tests boot
// src/index.html the way the browser boots it and assert the block's answer,
// and the wording tests below assert against verdictSentence() — the one
// function both pages render through — rather than against a copy of its
// output, because a copy is exactly what would drift.

const WAITING_LINE = "Checking the running deployment now…";

async function openHome(t, { releases = [OLDER, NEWEST], readHealth } = {}) {
  const page = await loadPage(HOME_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify([]),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    seed: NO_SEED,
    readHealth,
    deploymentNow: () => NOW,
    deployedRelease: NEWEST,
  });
  await waitFor(
    () => page.document.documentElement.dataset.shiplogDeployment === "ready",
    "the front door's deployment check never finished its comparison",
  );
  return page;
}

// The three readings the block has to answer, in the order the wording tests
// compare them: a match, a drift, and a check that could not complete.
const READINGS = [
  { health: { status: "ok", build: "v2.1.0" } },
  { health: { status: "ok", build: "v2.0.0" } },
  { failure: "unreachable" },
];

// Paint one reading into a page that is already booted and read the sentence
// back, so what is compared is the text a reader would see rather than a
// return value.
const paintedSentences = (page) => READINGS.map((reading) => {
  renderDeploymentStatus(page.document, deploymentVerdict(reading, NEWEST, NOW), { reading, release: NEWEST });
  return verdictText(page);
});

// The ids of every ancestor of a node, walked: the harness rejects a descendant
// selector, so "inside the block" and "inside the section" are read off the
// chain rather than selected.
function ancestorIds(node) {
  const ids = [];
  for (let current = node; current; current = current.parentNode) ids.push(current.id ?? null);
  return ids;
}

test("the front door's log section carries the check, its question, and the way to the evidence", async (t) => {
  const page = await openHome(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });

  assert.equal(
    page.document.querySelectorAll(`#${DEPLOYMENT_IDS.panel}`).length,
    1,
    "the front door must mount the deployment check exactly once",
  );
  const panel = page.document.querySelector(`#${DEPLOYMENT_IDS.panel}`);
  assert.equal(
    textOf(page.document.querySelector("#deployment-status-title")),
    "Is this log tracking the running deployment?",
  );
  assert.equal(panel.getAttribute("aria-labelledby"), "deployment-status-title");
  assert.ok(
    ancestorIds(panel).includes("shiplog-entry"),
    "the block is not inside the decision and release section",
  );

  // The link names its destination, and the destination is a block that exists:
  // the releases page's deployment band carries that id and the evidence
  // disclosure inside it.
  const link = page.document.querySelectorAll("a")
    .find((node) => node.getAttribute("href") === "/releases.html#deployment-status");
  assert.ok(link, "the block must link to the deployment check on Releases");
  assert.equal(textOf(link), "See the deployment check on Releases");
  assert.ok(ancestorIds(link).includes(DEPLOYMENT_IDS.panel), "the link sits outside the block it belongs to");

  // Reachable by Tab, and in reading order: after the example records the block
  // draws its contrast with, before the section's own call to action.
  let reachedLink = -1;
  let reachedAction = -1;
  for (let step = 0; step < 400; step += 1) {
    const focused = pressTab(page.document);
    if (reachedLink === -1 && focused === link) reachedLink = step;
    if (reachedAction === -1 && focused?.getAttribute?.("href") === "#record-history") reachedAction = step;
    if (reachedLink !== -1 && reachedAction !== -1) break;
  }
  assert.notEqual(reachedLink, -1, "the block's link is not reachable by keyboard");
  assert.notEqual(reachedAction, -1, "the section's call to action is not reachable by keyboard");
  assert.ok(reachedLink < reachedAction, "the block is out of reading order with the section around it");
});

test("the front door ships one waiting line, and no settled state stays on it", async (t) => {
  const html = await readFile(HOME_PAGE, "utf8");
  assert.equal(
    (html.match(/Checking the running deployment now…/g) ?? []).length,
    1,
    "the cold document must carry exactly one waiting line",
  );
  // And no verdict at all: a sentence in these bytes would be a comparison
  // nobody ran.
  assert.doesNotMatch(html, /Confirmed: this site is running|Not a match: this site is running|The check did not complete/);

  const page = await openHome(t, { readHealth: fails("TypeError") });
  // The state a visitor most often meets in production — the endpoint names no
  // build, or does not answer — still resolves to a sentence.
  const settled = verdictText(page);
  assert.notEqual(settled, WAITING_LINE, "the block stayed on its waiting line after the check settled");
  assert.match(settled, /\.$/, "the settled block does not read as a full sentence");

  for (const sentence of paintedSentences(page)) {
    assert.notEqual(sentence, WAITING_LINE);
    assert.doesNotMatch(sentence, /^\s*$|^[-–—]$|^Loading/, "a settled state read as a placeholder");
    assert.match(sentence, /\.$/);
  }
});

test("each outcome names both the running version and the recorded one", async (t) => {
  const page = await openHome(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  const read = (reading) => {
    renderDeploymentStatus(page.document, deploymentVerdict(reading, NEWEST, NOW), { reading, release: NEWEST });
    return { verdict: verdictText(page), metric: metricText(page) };
  };
  const matched = read(READINGS[0]);
  const drifted = read(READINGS[1]);
  const stalled = read(READINGS[2]);

  assert.equal(
    new Set([matched.verdict, drifted.verdict, stalled.verdict]).size,
    3,
    "two outcomes told a reader the same thing",
  );
  // Both sides of the comparison are named in every outcome, including the one
  // where the running side could not be read: "not reported" is an answer.
  assert.equal(matched.metric, "Running v2.1.0 · Real record v2.1.0 · recorded 2 days ago");
  assert.equal(drifted.metric, "Running v2.0.0 · Real record v2.1.0 · recorded 2 days ago");
  assert.equal(stalled.metric, "Running not reported · Real record v2.1.0 · recorded 2 days ago");
  assert.match(matched.verdict, /v2\.1\.0/);
  assert.match(drifted.verdict, /v2\.0\.0[\s\S]*v2\.1\.0/);
  assert.match(stalled.verdict, /The check did not complete/);
});

test("the front door's section states the example-records caveat once", async (t) => {
  const page = await openHome(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  const section = textOf(page.document.querySelector("#shiplog-entry"));

  // The records' own caveat keeps its words, and the block does not repeat
  // them: it states the one thing that caveat cannot say, which is that this
  // answer is not an example.
  assert.equal((section.match(/These invented records demonstrate Shiplog\./g) ?? []).length, 1);
  assert.equal((section.match(/no customer or production data/g) ?? []).length, 1);
  assert.match(
    section,
    /The decision and release above are examples; this check is not — it reads the running deployment when this page loads\./,
  );
  assert.equal((section.match(/this check is not/g) ?? []).length, 1);
});

test("the front door words each outcome with the shared sentence, byte for byte", async (t) => {
  const page = await openHome(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  // The criterion that protects against drift: the painted sentence IS the one
  // verdictSentence() returns, not a copy of what it returned once.
  assert.deepEqual(
    paintedSentences(page),
    READINGS.map((reading) => verdictSentence(deploymentVerdict(reading, NEWEST, NOW))),
    "the front door has its own vocabulary for a deployment verdict",
  );
});

test("the releases page words those same outcomes from that same sentence", async (t) => {
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  // The other half of the parity: both pages equal the shared source, so they
  // equal each other, and neither can be edited alone.
  assert.deepEqual(
    paintedSentences(page),
    READINGS.map((reading) => verdictSentence(deploymentVerdict(reading, NEWEST, NOW))),
  );
  // The id the front door's link points at is on this page.
  assert.equal(page.document.querySelectorAll("#deployment-status").length, 1);
});
