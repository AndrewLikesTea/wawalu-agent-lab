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
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import {
  UNKNOWN_REASONS,
  deploymentVerdict,
  durationText,
  verdictMetricText,
} from "../src/deployment-status.js";
import { parseHealthBody, probeHealth } from "../src/deployment-status-view.js";
import { loadPage, pressEnter, pressTab, textOf } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
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
  initReleasesPage(page.document, page.storage, { seed: NO_SEED, readHealth, now: () => NOW });
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

/* ------------------------------- the verdict ------------------------------ */

test("a running build that equals the newest record reads as a match and offers no action", async (t) => {
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });

  assert.equal(
    verdictText(page),
    "The running deployment matches the newest release record: v2.1.0.",
  );
  assert.equal(metricText(page), "Running v2.1.0 · Newest record v2.1.0 · recorded 2 days ago");
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
    "The running deployment does not match the newest release record: v2.0.0 is running, v2.1.0 is recorded.",
  );
  assert.equal(metricText(page), "Running v2.0.0 · Newest record v2.1.0 · recorded 2 days ago");

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
    "Whether the running deployment matches the newest release record is unknown. "
      + UNKNOWN_REASONS["unexpected-shape"],
  );
  // The comparison it can still make: the recorded build is last-known-good.
  assert.equal(metricText(page), "Running not reported · Newest record v2.1.0 · recorded 2 days ago");
  assert.equal(nextActions(page).length, 1, "unknown must name exactly one next action");
  assert.equal(nextActions(page)[0].href, "/release.html?id=r-2-1-0");
  assert.doesNotMatch(verdictText(page), /Error|error:|at .*\.js/, "a reader was shown an error object");
});

test("an unreachable health check reads as unknown and still reports the last-known-good record", async (t) => {
  const page = await openReleases(t, { readHealth: fails("TypeError") });

  assert.equal(
    verdictText(page),
    "Whether the running deployment matches the newest release record is unknown. "
      + UNKNOWN_REASONS.unreachable,
  );
  assert.equal(metricText(page), "Running not reported · Newest record v2.1.0 · recorded 2 days ago");
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
  assert.equal(verdictMetricText(noRecord), "Running v9 · Newest record none recorded · never recorded");

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
