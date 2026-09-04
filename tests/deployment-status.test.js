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
  MAX_IDENTIFIER_LENGTH,
  UNKNOWN_REASONS,
  deploymentVerdict,
  durationText,
  readableIdentifier,
  verdictMetricText,
  verdictCopyText,
  verdictSentence,
} from "../src/deployment-status.js";
import {
  DEPLOYMENT_IDS,
  parseHealthBody,
  probeHealth,
  renderDeploymentStatus,
} from "../src/deployment-status-view.js";
import { REPOSITORY_URL, commitLinkText, commitUrl } from "../src/deployed-release.js";
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

async function openReleases(t, { releases = [OLDER, NEWEST], readHealth, deployedRelease = NEWEST } = {}) {
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
    deployedRelease,
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
//
// A `type="button"` control submits nothing, so the copy control is judged on
// its type rather than exempted by its tag: a `<button>` that omits the type
// defaults to submit and is still caught here, and so is one swapped in for the
// copy control later.
function mutatingControls(node, found = []) {
  for (const child of node.children ?? []) {
    if (["FORM", "INPUT", "TEXTAREA", "SELECT"].includes(child.tagName)) found.push(child.tagName);
    if (child.tagName === "BUTTON" && child.getAttribute("type") !== "button") found.push("BUTTON");
    mutatingControls(child, found);
  }
  return found;
}

/* --------------------------- what the check proves ------------------------ */

test("the band leads with what it compares, then answers, outside every disclosure", async (t) => {
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  const proof = page.document.querySelector("#deployment-status-proof");
  const sentence = textOf(proof);

  // One name for the check, and it is the name the front door's link uses.
  assert.equal(textOf(page.document.querySelector("#deployment-status-title")), "Deployment check");

  // What the check proves, in the page's own words, before any evidence. The
  // question is one sentence and the front door renders the same one, so a
  // reader who follows the link from there meets the words they arrived on.
  assert.match(sentence, /^Does the real record of this deployment name the running build’s version\?/);
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

  // The question leads; the machinery that answers it follows. That is the
  // order the front door's copy of this band reads in, so a reader arriving
  // from there meets the same shape rather than a status line, a caveat and a
  // copy control ahead of the sentence saying what is being compared.
  const lines = page.document.querySelector("#deployment-status-callout").childElements.map((node) => node.id);
  assert.ok(
    lines.indexOf("deployment-status-proof") < lines.indexOf(DEPLOYMENT_IDS.verdict),
    "the answer machinery is rendered above the question it answers",
  );
  assert.ok(
    lines.indexOf("deployment-status-proof") < lines.indexOf(DEPLOYMENT_IDS.identifiers),
    "the compared identifiers are rendered above the question they answer",
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

test("the visible copy control copies the verdict plus both compared version values and announces success", async (t) => {
  let copied = "";
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify([]),
      [RELEASE_STORAGE_KEY]: JSON.stringify([OLDER, NEWEST]),
    },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    seed: NO_SEED,
    deployedRelease: NEWEST,
    readHealth: answers({ status: "ok", build: "v2.0.0" }),
    now: () => NOW,
    clipboard: { writeText: async (value) => { copied = value; } },
  });
  await waitFor(() => page.document.documentElement.dataset.shiplogDeployment === "ready");

  const button = page.document.querySelector("#deployment-copy");
  assert.equal(textOf(button), "Copy verdict and both versions");
  assert.equal(button.getAttribute("aria-describedby"), "deployment-copy-status");
  button.click();
  await waitFor(() => textOf(page.document.querySelector("#deployment-copy-status")) !== "");

  const verdict = deploymentVerdict({ health: { status: "ok", build: "v2.0.0" } }, NEWEST, NOW);
  assert.equal(copied, verdictCopyText(verdict));
  assert.match(copied, /^Deployment check verdict: Not a match:/);
  assert.match(copied, /Running build version: v2\.0\.0/);
  assert.match(copied, /Real deployment-record version: v2\.1\.0/);
  assert.equal(
    textOf(page.document.querySelector("#deployment-copy-status")),
    "Deployment verdict and both version values copied to clipboard.",
  );
});

test("the copy control offers nothing until the check has answered, and never blames the clipboard for that", async (t) => {
  // A visitor on a slow connection reaches the band before `/healthz` does.
  // The control is bound at boot, so without this the click copies the empty
  // `data-copy-text` and reports a clipboard failure that never happened —
  // pointing at an identifiers line that has not been written yet.
  let answer;
  let copied = null;
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([OLDER, NEWEST]) },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    seed: NO_SEED,
    deployedRelease: NEWEST,
    readHealth: () => new Promise((resolve) => { answer = resolve; }),
    now: () => NOW,
    clipboard: { writeText: async (value) => { copied = value; } },
  });
  const button = page.document.querySelector("#deployment-copy");
  const status = page.document.querySelector("#deployment-copy-status");

  await waitFor(() => typeof answer === "function", "the probe never started");
  assert.equal(button.disabled, true, "a result was offered for copying before the check produced one");
  assert.equal(textOf(page.document.querySelector("#deployment-identifiers")), "", "the identifiers line was written early");
  button.click();
  await Promise.resolve();
  assert.equal(copied, null, "a half-loaded page wrote to the clipboard");
  assert.equal(textOf(status), "", "the page reported a clipboard failure while the check was still running");

  // The match path, once the probe answers: the control becomes usable and
  // copies the verdict a buyer came for.
  answer({ status: "healthy", version: "v2.1.0" });
  await waitFor(() => page.document.documentElement.dataset.shiplogDeployment === "ready");
  assert.equal(button.disabled, false, "the control stayed unusable after the check answered");
  button.click();
  await waitFor(() => textOf(status) !== "");
  assert.match(copied, /^Deployment check verdict: Confirmed: this site is running v2\.1\.0/);
  assert.match(copied, /Running build version: v2\.1\.0\. Real deployment-record version: v2\.1\.0\./);
});

test("copy preserves an unavailable running value and gives recoverable feedback when clipboard access fails", async (t) => {
  const page = await openReleases(t, { readHealth: fails("TypeError") });
  const button = page.document.querySelector("#deployment-copy");
  button.click();
  await waitFor(() => textOf(page.document.querySelector("#deployment-copy-status")) !== "");
  assert.match(button.dataset.copyText, /Running build version: not reported/);
  assert.match(button.dataset.copyText, /Real deployment-record version: v2\.1\.0/);
  assert.equal(
    textOf(page.document.querySelector("#deployment-copy-status")),
    "Clipboard unavailable. Select the verdict and both version values above to copy them.",
  );
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
  // The band has no control that could submit: it renders a link to a record
  // and one control that only reads the verdict back out. Walked, because the
  // harness rejects a descendant selector.
  assert.deepEqual(mutatingControls(page.document.querySelector("#deployment-status")), []);
  assert.equal(
    JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY)).length,
    2,
    "the deployment band changed the release log",
  );
});

// Written as an escape so this source file stays plain text: a right-to-left
// override in a build identifier must not survive into the proof a buyer reads.
const BIDI_OVERRIDE = String.fromCharCode(0x202e);

test("an identifier the page cannot show whole is refused, never stripped into a match", async (t) => {
  // The two sides differ. Deleting the override rather than refusing the value
  // would leave "v2.1.0" on both sides and report a match this deployment never
  // earned — which is why the rule is reject, and why this case exists.
  const spoofed = `v2.1.${BIDI_OVERRIDE}0`;
  const verdict = deploymentVerdict({ health: { status: "ok", build: spoofed } }, NEWEST, NOW);
  assert.equal(verdict.state, "unknown", "an unreadable identifier was compared anyway");
  assert.equal(verdict.deployedBuild, null);
  assert.equal(verdict.reason, UNKNOWN_REASONS["no-build"]);
  assert.doesNotMatch(verdictSentence(verdict), /^Confirmed/);

  // Length is the same rule for the same reason: one answer from the endpoint
  // may not become the whole proof area.
  const longest = "9".repeat(MAX_IDENTIFIER_LENGTH);
  assert.equal(readableIdentifier(longest), longest, "a full-length identifier is still readable");
  assert.equal(readableIdentifier(`${longest}9`), null);
  assert.equal(deploymentVerdict({ health: { status: "ok", build: `${longest}9` } }, NEWEST, NOW).deployedBuild, null);

  // And none of it reaches the rendered page.
  const page = await openReleases(t, { readHealth: answers({ status: "ok", build: spoofed }) });
  const identifiers = textOf(page.document.querySelector("#deployment-identifiers"));
  assert.equal(identifiers.includes(BIDI_OVERRIDE), false, "an invisible override reached the proof line");
  assert.equal(identifiers, "Running build version: not reported. Real deployment-record version: v2.1.0.");
  assert.match(verdictText(page), /The check did not complete/);
  // Nor into the copy, which is the one thing here that leaves the page: a
  // refused identifier must not ride an override into a document elsewhere.
  const copyText = page.document.querySelector("#deployment-copy").dataset.copyText;
  assert.equal(copyText.includes(BIDI_OVERRIDE), false, "an invisible override reached the copied result");
  assert.equal(copyText.endsWith(identifiers), true, "the copy and the band worded the comparison differently");
});

test("a record this band cannot route to is not linked, on either link it draws", async (t) => {
  // A record can be edited outside the recorder, and both of these hrefs are
  // assigned straight to an anchor. Neither may choose a scheme.
  const hostile = { ...NEWEST, detailHref: "javascript:alert(1)" };
  const drift = deploymentVerdict({ health: { status: "ok", build: "v9.9.9" } }, hostile, NOW);
  assert.equal(drift.state, "drift");
  assert.equal(drift.nextAction.href, "/release.html?id=r-2-1-0", "the record chose the next action's destination");

  const page = await openReleases(t, {
    deployedRelease: hostile,
    readHealth: answers({ status: "ok", build: "v9.9.9" }),
  });
  assert.equal(nextActions(page)[0].getAttribute("href"), "/release.html?id=r-2-1-0");
  // A link is a claim about where it goes, so a record with no usable
  // destination is not offered as one rather than offered pointing elsewhere.
  assert.equal(page.document.querySelector("#deployment-release-record").hidden, true);
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

const WAITING_LINE = "Checking the running build now…";

// The stamp both pages are driven from below. Injected for the same reason the
// clock is: what is asserted is that the link is derived from the stamp, not
// which commit this checkout happens to have been built from.
const HOME_SHA = "0123456789abcdef0123456789abcdef01234567";
const HOME_STAMP = Object.freeze({ schemaVersion: 1, commitSha: HOME_SHA, builtAt: "2026-08-04T12:00:00.000Z" });
const UNSTAMPED_STAMP = Object.freeze({ schemaVersion: 1, commitSha: null, builtAt: null });

async function openHome(
  t,
  { releases = [OLDER, NEWEST], readHealth, buildStamp = HOME_STAMP, settle = true } = {},
) {
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
    buildStamp,
    deploymentNow: () => NOW,
    deployedRelease: NEWEST,
  });
  if (settle) {
    await waitFor(
      () => page.document.documentElement.dataset.shiplogDeployment === "ready",
      "the front door's deployment check never finished its comparison",
    );
  }
  return page;
}

const commitLink = (page) => page.document.querySelector(`#${DEPLOYMENT_IDS.source}`);

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
    "Deployment check",
  );
  // The name the releases page's band heads itself with, so the link below and
  // its destination are one thing with one name.
  assert.equal(
    textOf(page.document.querySelector("#deployment-status-proof")),
    "Does the real record of this deployment name the running build’s version?",
  );
  assert.equal(
    (textOf(panel).match(/name the running build’s version\?/g) ?? []).length,
    1,
    "the question the check answers is asked more than once",
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
    (html.match(/Checking the running build now…/g) ?? []).length,
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
  // Said in the words the releases page says it in, so the two pages do not
  // draw the same line two ways.
  assert.match(
    section,
    /It reads the running build when the page loads\. The example decision and release above are invented; this answer is not\./,
  );
  assert.equal((section.match(/this answer is not/g) ?? []).length, 1);
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

/* ------ checking the claim without leaving the front door (#1857) ---------- */
//
// The block states that its answer is not invented. Until now the only way to
// check that statement was to leave for the releases page, which is where the
// commit the running build was made from is linked. These tests pin that same
// commit link onto the front door's block — one derivation, one name, and on
// the page in every state the check can be in, including the state where the
// check could not answer at all.

// The releases page, booted with a stamp, so the two links can be compared as
// rendered rather than as two literals somebody kept in step by hand.
async function openReleasesWithStamp(t, buildStamp) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([]) },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    seed: NO_SEED,
    buildStamp,
    readHealth: answers({ status: "healthy", version: buildStamp.commitSha }),
    now: () => NOW,
  });
  await waitFor(
    () => page.document.documentElement.dataset.shiplogDeployment === "ready",
    "the releases page's deployment check never finished its comparison",
  );
  return page;
}

test("the front door's check links the commit this build was made from", async (t) => {
  const page = await openHome(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  const link = commitLink(page);

  assert.equal(page.document.querySelectorAll(`#${DEPLOYMENT_IDS.source}`).length, 1);
  // A real anchor with a real destination, derived from the stamp rather than
  // written out: the sha in these bytes is the fixture's, and the href is
  // whatever the shared derivation makes of it.
  assert.equal(link.tagName, "A");
  assert.equal(link.getAttribute("href"), commitUrl(HOME_SHA));
  assert.equal(link.hidden, false);
  assert.ok(ancestorIds(link).includes(DEPLOYMENT_IDS.panel), "the commit link sits outside the block it belongs to");
  // Not announced with the answer: the verdict owns the live region, and the
  // link is a sibling of it, so a state change does not read the link out again.
  assert.equal(page.document.querySelector(`#${DEPLOYMENT_IDS.verdict}`).getAttribute("role"), "status");
  assert.equal(link.getAttribute("role"), null);
  assert.ok(!ancestorIds(link).includes(DEPLOYMENT_IDS.verdict));

  // Reachable by Tab and in reading order: inside the block, ahead of the
  // section's own call to action.
  let reachedCommit = -1;
  let reachedAction = -1;
  for (let step = 0; step < 400; step += 1) {
    const focused = pressTab(page.document);
    if (reachedCommit === -1 && focused === link) reachedCommit = step;
    if (reachedAction === -1 && focused?.getAttribute?.("href") === "#record-history") reachedAction = step;
    if (reachedCommit !== -1 && reachedAction !== -1) break;
  }
  assert.notEqual(reachedCommit, -1, "the commit link is not reachable by keyboard");
  assert.ok(reachedCommit < reachedAction, "the commit link is out of reading order with the section around it");
});

test("the front door and the releases page name that one commit the same way", async (t) => {
  const home = await openHome(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  const releases = await openReleasesWithStamp(t, HOME_STAMP);
  const homeLink = commitLink(home);
  const releasesLink = releases.document.querySelector("#shipped-build-source");

  // Same destination and same accessible name, byte for byte — and both equal
  // the shared derivation, so neither page can be edited alone.
  assert.equal(homeLink.getAttribute("href"), releasesLink.getAttribute("href"));
  assert.equal(textOf(homeLink), textOf(releasesLink));
  assert.equal(textOf(homeLink), commitLinkText(HOME_SHA));
  assert.equal(homeLink.getAttribute("href"), `${REPOSITORY_URL}/commit/${HOME_SHA}`);
});

test("the front door's two links do different jobs and read as different things", async (t) => {
  const page = await openHome(t, { readHealth: answers({ status: "ok", build: "v2.1.0" }) });
  const links = page.document.querySelectorAll("a")
    .filter((node) => ancestorIds(node).includes(DEPLOYMENT_IDS.panel));

  // The link that was already there keeps its words and its destination.
  const toReleases = links.find((node) => node.getAttribute("href") === "/releases.html#deployment-status");
  assert.ok(toReleases, "the block no longer links to the deployment check on Releases");
  assert.equal(textOf(toReleases), "See the deployment check on Releases");

  // Read out of context, in a screen reader's link list, the two are not near
  // synonyms of each other: different words, different destinations.
  const names = links.map((node) => textOf(node));
  assert.equal(new Set(names).size, names.length, "two links in the block read as the same thing");
  const hrefs = links.map((node) => node.getAttribute("href"));
  assert.equal(new Set(hrefs).size, hrefs.length, "two links in the block go to the same place");
  assert.equal(links.length, 2, "the block offers a link it was not scoped to offer");
});

test("the commit link is on the page in every state the check can be in", async (t) => {
  // A reading that has not arrived yet, so the block is asserted in the state
  // it opens in rather than only in the state it settles into.
  let answer;
  const pending = new Promise((resolve) => { answer = resolve; });
  const page = await openHome(t, { readHealth: () => pending, settle: false });

  const href = commitUrl(HOME_SHA);
  const name = commitLinkText(HOME_SHA);
  const stillOffered = (state) => {
    const link = commitLink(page);
    assert.equal(link.getAttribute("href"), href, `the commit link lost its destination in the ${state} state`);
    assert.equal(textOf(link), name, `the commit link lost its name in the ${state} state`);
    assert.equal(link.hidden, false, `the commit link was withdrawn in the ${state} state`);
  };

  assert.equal(verdictText(page), WAITING_LINE, "the block had already answered");
  stillOffered("pending");

  answer({ status: "ok", build: "v2.0.0" });
  await waitFor(
    () => page.document.documentElement.dataset.shiplogDeployment === "ready",
    "the front door's deployment check never finished its comparison",
  );
  assert.match(verdictText(page), /Not a match/);
  stillOffered("mismatch");

  // And through every repaint the block does, including the one where the
  // check could not complete: the link is not rendered by the verdict, so no
  // verdict can take it away.
  for (const [index, reading] of READINGS.entries()) {
    renderDeploymentStatus(page.document, deploymentVerdict(reading, NEWEST, NOW), { reading, release: NEWEST });
    stillOffered(`repainted ${index}`);
  }
});

test("a check that never reaches the endpoint still offers the commit", async (t) => {
  const page = await openHome(t, { readHealth: fails("TypeError") });
  assert.match(verdictText(page), /The check did not complete/);
  assert.equal(commitLink(page).getAttribute("href"), commitUrl(HOME_SHA));
  assert.equal(textOf(commitLink(page)), commitLinkText(HOME_SHA));
  assert.equal(commitLink(page).hidden, false);
});

test("an unstamped build offers no commit rather than an invented one", async (t) => {
  const page = await openHome(t, {
    buildStamp: UNSTAMPED_STAMP,
    readHealth: answers({ status: "ok", build: "v2.1.0" }),
  });
  const link = commitLink(page);
  assert.equal(link.hidden, true, "an unstamped build linked a commit it cannot name");
  assert.doesNotMatch(textOf(page.document.querySelector(`#${DEPLOYMENT_IDS.panel}`)), /Open commit/);
});
