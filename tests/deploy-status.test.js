// The deploy status view: one verdict, one metric, at most one next action.
//
// Four cases, all against local fixtures — the probe is injected, so no test
// here opens a socket. What each case pins is what a reader actually gets: the
// verdict sentence, the metric sentence, and the COUNT of prioritized actions,
// because "at least one" would pass a panel offering three.
//
// Harness constraints this file respects (tests/support/browser.js): no
// descendant selectors, no assert on a parsed node itself, and properties set
// in JavaScript are not reflected as attributes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ACTION_CLASS, compareDeployment, DEPLOY_STATUS_IDS, describeDuration, HEALTHZ_PATH, newestRelease,
  probeHealthz, renderDeployStatus,
} from "../src/deploy-status.js";
import { parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PAGE = new URL("../src/deploy-status.html", import.meta.url);

const CHECKED_AT = "2026-08-06T12:00:00.000Z";

// Two records, newest first by date rather than by position, so the comparison
// cannot pass by picking element zero.
const RELEASES = [
  {
    id: "demo-r-1-3-0", version: "v1.3.0", title: "Throughput and latency",
    owner: "Kai", status: "completed", createdAt: "2026-07-01T12:00:00.000Z",
  },
  {
    id: "demo-r-1-4-0", version: "v1.4.0", title: "Security and delivery hardening",
    owner: "Priya", status: "planned", createdAt: "2026-08-03T12:00:00.000Z",
  },
];

/** A fetch stand-in that answers once, from a fixture, and records the call. */
function stubFetch(body, { ok = true, status = 200, json = null } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, json: json ?? (async () => body) };
  };
  impl.calls = calls;
  return impl;
}

async function model(fetchImpl, { releases = RELEASES, previous = null } = {}) {
  const probe = await probeHealthz(fetchImpl);
  return compareDeployment({ probe, releases, checkedAt: CHECKED_AT, previous });
}

/** A rendered panel, in the page's own container, from the shipped markup. */
async function render(built) {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const container = document.querySelector("#deploy-status");
  renderDeployStatus(container, built);
  return { document, container };
}

const shown = (document, id) => textOf(document.getElementById(id));
const actionCount = (document) => document.querySelectorAll(`.${ACTION_CLASS}`).length;

/* -------------------------------- the four -------------------------------- */

test("match: the verdict says so, the metric compares the two builds, and no action is offered", async () => {
  const built = await model(stubFetch({ status: "ok", storage: "available", build: "v1.4.0" }));
  const { document } = await render(built);

  assert.equal(built.verdict, "match");
  assert.equal(shown(document, DEPLOY_STATUS_IDS.verdict), "What is deployed is the release we think it is.");

  const metric = shown(document, DEPLOY_STATUS_IDS.metric);
  assert.match(metric, /^Deployed build v1\.4\.0 matches the newest release record v1\.4\.0, recorded 3 days ago\./);
  // No prior observation was supplied, so the metric says that rather than
  // inventing a duration for how long the match has held.
  assert.match(metric, /No earlier check is recorded here, so how long this has held is not known\./);

  // Exactly zero, and the reason a reader is given zero is stated.
  assert.equal(actionCount(document), 0, "a match must offer no next action");
  assert.equal(shown(document, DEPLOY_STATUS_IDS.settled), "No action is needed.");
  assert.equal(document.querySelectorAll(`#${DEPLOY_STATUS_IDS.reason}`).length, 0,
    "a match needs no failure reason");
});

test("drift: the verdict says so, and exactly one next action links the record to reconcile", async () => {
  const built = await model(stubFetch({ status: "ok", storage: "available", build: "v1.3.0" }));
  const { document } = await render(built);

  assert.equal(built.verdict, "drift");
  assert.equal(shown(document, DEPLOY_STATUS_IDS.verdict), "What is deployed is not the release we think it is.");
  assert.match(
    shown(document, DEPLOY_STATUS_IDS.metric),
    /^Deployed build v1\.3\.0 does not match the newest release record v1\.4\.0, recorded 3 days ago\./,
  );

  assert.equal(actionCount(document), 1, "drift must name exactly one next action");
  const action = document.getElementById(DEPLOY_STATUS_IDS.action);
  assert.equal(textOf(action), "Reconcile release record v1.4.0");
  // Straight to the record, not to the list: the action names a record, so it
  // has to open that record.
  assert.equal(action.getAttribute("href"), "/release.html?id=demo-r-1-4-0");
  assert.equal(document.querySelectorAll(`#${DEPLOY_STATUS_IDS.settled}`).length, 0,
    "drift must not also claim nothing is needed");
});

test("unknown from a bad shape: a human reason, the last known-good record, and one action", async () => {
  // The probe answered, with JSON, and with no usable build identifier in it —
  // which is the shape production ships today.
  const built = await model(stubFetch({ status: "ok", storage: "available", build: 7 }));
  const { document } = await render(built);

  assert.equal(built.verdict, "unknown");
  assert.equal(
    shown(document, DEPLOY_STATUS_IDS.verdict),
    "Whether what is deployed is the release we think it is cannot be answered right now.",
  );
  assert.equal(shown(document, DEPLOY_STATUS_IDS.reason),
    "The health check reported no usable build identifier.");
  // No stack trace, no exception text, no blank panel.
  assert.doesNotMatch(textOf(document.getElementById("deploy-status")), /Error|TypeError|at \w+ \(/);
  assert.match(
    shown(document, DEPLOY_STATUS_IDS.metric),
    /^The deployed build could not be read, so it cannot be compared with the newest release record v1\.4\.0, recorded 3 days ago\./,
  );
  assert.equal(actionCount(document), 1, "unknown must name exactly one next action");
  assert.equal(textOf(document.getElementById(DEPLOY_STATUS_IDS.action)), "Reconcile release record v1.4.0");
});

test("unreachable and timed out are both unknown, in a sentence, never an error page", async () => {
  const refused = await model(async () => { throw new Error("ECONNREFUSED 127.0.0.1:443"); });
  const { document } = await render(refused);
  assert.equal(refused.verdict, "unknown");
  assert.equal(shown(document, DEPLOY_STATUS_IDS.reason), "The health check could not be reached.");
  // The thrown message is not what a reader is shown.
  assert.doesNotMatch(textOf(document.getElementById("deploy-status")), /ECONNREFUSED/);
  assert.equal(actionCount(document), 1);

  // A deadline that expires while the probe is still waiting. The fixture never
  // resolves on its own; the abort signal is what ends it.
  const hung = await probeHealthz((path, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  }), { timeoutMs: 10 });
  assert.equal(hung.status, "timeout");
  const timedOut = compareDeployment({ probe: hung, releases: RELEASES, checkedAt: CHECKED_AT });
  assert.equal(timedOut.verdict, "unknown");
  assert.match(timedOut.reason, /^The health check did not answer within \d+ seconds\.$/);

  const page = await render(timedOut);
  assert.equal(actionCount(page.document), 1, "a timeout still names one next action");
});

/* ------------------------------- the evidence ------------------------------ */

test("the evidence sits behind a native disclosure, closed, holding all three parts", async () => {
  const built = await model(stubFetch({ status: "ok", storage: "available", auth: "configured", build: "v1.4.0" }));
  const { document } = await render(built);

  const details = document.getElementById(DEPLOY_STATUS_IDS.evidence);
  assert.equal(details.tagName, "DETAILS", "the evidence must be a native disclosure");
  // The harness reads through a closed disclosure and models no layout, so the
  // closed state is asserted on the attribute rather than on visibility.
  assert.equal(details.getAttribute("open"), null, "the evidence must start closed");
  const summary = details.querySelectorAll("summary");
  assert.equal(summary.length, 1);
  assert.ok(tabSequence(document).includes(summary[0]), "the disclosure must be keyboard reachable");
  summary[0].focus();
  pressEnter(document);
  assert.equal(details.getAttribute("open"), "", "Enter on the summary must open it");

  const evidence = textOf(details);
  for (const field of ["status: ok", "storage: available", "auth: configured", "build: v1.4.0"]) {
    assert.ok(evidence.includes(field), `the raw /healthz fields must include "${field}"`);
  }
  for (const field of ["id: demo-r-1-4-0", "version: v1.4.0", "owner: Priya", "createdAt: 2026-08-03T12:00:00.000Z"]) {
    assert.ok(evidence.includes(field), `the compared record's fields must include "${field}"`);
  }
  assert.ok(evidence.includes(`Checked at ${CHECKED_AT}`), "the time the check ran must be in the evidence");

  // And the answer is NOT in there: verdict, metric and action stay outside.
  const inside = new Set(details.querySelectorAll("p").map((node) => node.id));
  for (const id of [DEPLOY_STATUS_IDS.verdict, DEPLOY_STATUS_IDS.metric, DEPLOY_STATUS_IDS.settled]) {
    assert.equal(inside.has(id), false, `${id} must not be hidden behind the disclosure`);
  }
});

/* ------------------------------ untrusted input ---------------------------- */

test("markup in a fixture's build identifier arrives as literal text, never as HTML", async () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const built = await model(stubFetch({ status: "ok", build: hostile }));
  const { document } = await render(built);

  assert.equal(built.verdict, "drift");
  assert.ok(shown(document, DEPLOY_STATUS_IDS.metric).includes(hostile),
    "the identifier must read back character for character");
  // Nothing was parsed: no element the fixture named exists anywhere on the page.
  assert.equal(document.querySelectorAll("img").length, 0, "the fixture's markup was executed as HTML");
  assert.equal(document.querySelectorAll("[onerror]").length, 0);
});

test("a body that is not an object, or answers with an error status, is unknown rather than a crash", async () => {
  for (const [probeImpl, reason] of [
    [stubFetch(["ok"]), "The health check did not answer with JSON."],
    [stubFetch(null, { json: async () => { throw new Error("bad json"); } }), "The health check did not answer with JSON."],
    [stubFetch(null, { ok: false, status: 503 }), "The health check answered 503 instead of reporting its build."],
  ]) {
    const built = await model(probeImpl);
    assert.equal(built.verdict, "unknown");
    assert.equal(built.reason, reason);
  }
});

/* -------------------------------- read only -------------------------------- */

test("the probe makes one GET, uncached, and the view sends nothing else", async () => {
  const fetchImpl = stubFetch({ status: "ok", build: "v1.4.0" });
  await model(fetchImpl);
  assert.equal(fetchImpl.calls.length, 1, "the view must make exactly one request");
  const [{ url, options }] = fetchImpl.calls;
  assert.equal(url, HEALTHZ_PATH);
  assert.equal(options.method, "GET");
  assert.equal(options.cache, "no-store");
  assert.equal(options.body, undefined, "a status view must send no body");
});

test("the shipped page carries no form, no button, and no mutating control", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const main = document.getElementById("main-content");
  assert.equal(main.querySelectorAll("form").length, 0);
  assert.equal(main.querySelectorAll("button").length, 0);
  assert.equal(main.querySelectorAll("input").length, 0);
  // The container the module renders into is present before any script runs, so
  // a reader with no JavaScript sees a stated state rather than an empty panel.
  const container = document.querySelectorAll("#deploy-status");
  assert.equal(container.length, 1);
  assert.equal(container[0].getAttribute("aria-busy"), "true");
});

/* --------------------------- the derived duration -------------------------- */

test("a prior observation of the same verdict is how long it has held; without one, that is said", async () => {
  const held = await model(stubFetch({ status: "ok", build: "v1.3.0" }), {
    previous: { verdict: "drift", build: "v1.3.0", observedAt: "2026-08-06T06:00:00.000Z" },
  });
  assert.match(held.metric, /This has held since the last recorded check, 6 hours ago\./);

  // A prior observation that disagreed is reported as what it was, not folded
  // into a duration the page cannot support.
  const changed = await model(stubFetch({ status: "ok", build: "v1.3.0" }), {
    previous: { verdict: "match", build: "v1.4.0", observedAt: "2026-08-05T12:00:00.000Z" },
  });
  assert.match(changed.metric, /The last recorded check, 24 hours ago, found deployed build v1\.4\.0\./);

  // An unparseable timestamp is no observation at all.
  const bogus = await model(stubFetch({ status: "ok", build: "v1.3.0" }), {
    previous: { verdict: "drift", build: "v1.3.0", observedAt: "yesterday" },
  });
  assert.match(bogus.metric, /No earlier check is recorded here/);
});

test("the newest record is the one with the newest date, and durations do not round up into a claim", () => {
  assert.equal(newestRelease(RELEASES).id, "demo-r-1-4-0");
  assert.equal(newestRelease([{ version: "v1", createdAt: "not a date" }]), null);
  assert.equal(describeDuration(30_000), "under a minute");
  assert.equal(describeDuration(60_000), "1 minute");
  assert.equal(describeDuration(3 * 3600_000), "3 hours");
  assert.equal(describeDuration(72 * 3600_000), "3 days");
  assert.equal(describeDuration(-1), null);
});

test("with no release record at all, the view is unknown and still names one next action", async () => {
  const built = await model(stubFetch({ status: "ok", build: "v1.4.0" }), { releases: [] });
  const { document } = await render(built);
  assert.equal(built.verdict, "unknown");
  assert.equal(built.reason, "No release record has been recorded yet, so there is nothing to compare against.");
  // The metric names the cause that actually happened: the build WAS read, and
  // there is nothing to read it against.
  assert.match(shown(document, DEPLOY_STATUS_IDS.metric),
    /^Deployed build v1\.4\.0 has no release record to compare with\./);
  assert.equal(actionCount(document), 1);
  assert.equal(document.getElementById(DEPLOY_STATUS_IDS.action).getAttribute("href"), "/releases.html");
});
