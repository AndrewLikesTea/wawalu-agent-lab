// On-demand destination loading, and what a reader sees when it fails.
//
// THE HARNESS IS PERMISSIVE, SO NOTHING HERE ASSERTS "IT DID NOT THROW".
// tests/support/browser.js is a shim: a control it does not model accepts
// whatever it is handed, so a test that only checks for the absence of an
// exception passes over a page that painted an empty pane. Every assertion
// below is either on the text actually rendered into the destination's region
// or on how many times the loader's thunk was invoked.
//
// THE THREE CLAIMS:
//
//   1. The answer screen renders with the three destination modules never
//      fetched. Asserted on the shipped answer block's own four slots and on
//      the loader's invocation counters being zero.
//   2. A destination whose module rejects shows the named error and a working
//      retry, not an empty region.
//   3. The retry is a real second attempt: the thunk is invoked again and the
//      second attempt succeeds once it can.
//
// The loader is injected rather than monkey-patched. The real thunks reach the
// real modules; these use thunks this file controls, which is the only way to
// make a rejected module load reproducible without breaking a build.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { FINOPS_ANSWER_SUMMARY } from "../src/finops-answer-summary.js";
import { ANSWER_BLOCK_IDS, applyAnswerBlock } from "../src/finops-stand-view.js";
import {
  DESTINATION_LOAD_STATE, createDestinationLoader,
} from "../src/finops-destination-loader.js";
import {
  DESTINATION_LOAD_COPY, DESTINATION_MODULE_SOURCE, applyWorkspaceDestination,
  destinationRetryId, destinationStatusId, initWorkspaceShell, openDestination,
} from "../src/finops-workspace-shell.js";
import { WORKSPACE_DESTINATION } from "../src/finops-workspace-nav.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const SHELL_SOURCE = await readFile(
  new URL("../src/finops-workspace-shell.js", import.meta.url), "utf8");

const byId = (document, id) => document.getElementById(id);
const EVIDENCE = WORKSPACE_DESTINATION.evidence;

/** The status block panel-status-view.js paints into a destination's region. */
const statusText = (document, key) =>
  textOf(byId(document, `${destinationStatusId(key)}-status`));

const fakeWindow = () => ({
  location: { hash: "" },
  addEventListener() {},
  removeEventListener() {},
});

// ---------------------------------------------------------------------------
// 1. The answer screen renders with none of the three modules fetched.
// ---------------------------------------------------------------------------

test("the three destination modules are reached by import(), not by a static import", () => {
  for (const specifier of ["./finops-briefing-contract.js", "./finops-leading-finding.js",
    "./finops-destination-contract.js", "./example-dataset.js"]) {
    assert.ok(SHELL_SOURCE.includes(`import("${specifier}")`),
      `${specifier} is not reached through a dynamic import()`);
    assert.ok(!new RegExp(`from\\s+"${specifier.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}"`)
      .test(SHELL_SOURCE),
    `${specifier} is still a static import of the shell, so it is in the first-screen payload`);
  }
  assert.deepEqual(Object.keys(DESTINATION_MODULE_SOURCE).sort(),
    [WORKSPACE_DESTINATION.actAndVerify, WORKSPACE_DESTINATION.department, EVIDENCE].sort(),
    "the answer must have no module source: it is what renders without one");
});

test("the answer screen paints its four slots with no destination module loaded", () => {
  const document = parseHtml(html);
  let invoked = 0;
  const loader = createDestinationLoader(Object.fromEntries(
    Object.keys(DESTINATION_MODULE_SOURCE).map((key) => [key, () => {
      invoked += 1;
      return Promise.resolve({});
    }])));

  // The shell comes up and settles on the default destination…
  const shell = initWorkspaceShell(document, { win: fakeWindow(), loader });
  assert.equal(shell.destination, WORKSPACE_DESTINATION.answer);
  // …and the answer block paints, from the summary alone.
  assert.ok(applyAnswerBlock(document), "the answer block did not paint");
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.value)), FINOPS_ANSWER_SUMMARY.figure);
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.confidence)),
    FINOPS_ANSWER_SUMMARY.confidence);
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.basis)), FINOPS_ANSWER_SUMMARY.basis);

  assert.equal(invoked, 0, "the answer screen fetched a destination module");
  for (const key of Object.keys(DESTINATION_MODULE_SOURCE)) {
    assert.equal(loader.invocations(key), 0, `${key}'s module was fetched for the answer`);
    assert.equal(loader.stateOf(key), DESTINATION_LOAD_STATE.idle);
    // And no destination's status region is on screen claiming a load.
    assert.equal(byId(document, destinationStatusId(key)).hidden, true,
      `${key} shows a load state on a screen that never asked for its module`);
  }
  assert.deepEqual(loader.readyKeys(), []);
});

// ---------------------------------------------------------------------------
// 2. A rejected load: the named error and a working retry, never an empty pane.
// ---------------------------------------------------------------------------

test("a destination whose module rejects names the destination and offers a retry", async () => {
  const document = parseHtml(html);
  const loader = createDestinationLoader({
    [EVIDENCE]: () => Promise.reject(new Error("network is offline")),
  });

  await openDestination(document, EVIDENCE, { loader });

  const region = byId(document, destinationStatusId(EVIDENCE));
  assert.equal(region.hidden, false, "the failed destination shows an empty pane");
  const text = statusText(document, EVIDENCE);
  assert.match(text, /Could not load Evidence\b/,
    `the error does not name the destination: "${text}"`);
  assert.equal(text.includes(DESTINATION_LOAD_COPY.error("Evidence")), true,
    "the failure is not the page's own named-error copy");
  assert.match(text, /Retry Evidence/, "the failure does not point at the retry control");
  // The page's existing vocabulary, not a second one: the error chip's word and
  // shape come from panel-status-view.js.
  assert.match(text, /▲\s*Could not compute/);
  assert.equal(region.dataset.panelStatus, "error");

  const retry = byId(document, destinationRetryId(EVIDENCE));
  assert.equal(retry.hidden, false, "the retry control is not reachable from the failure");
  assert.equal(textOf(retry), "Retry Evidence");
  assert.equal(retry.tagName, "BUTTON", "the retry must be a real control, not a hint");
});

test("a load in flight shows the loading treatment, not a blank region", () => {
  const document = parseHtml(html);
  // A thunk that never settles: the region has to be readable in that state,
  // which is the state a slow network actually produces.
  const loader = createDestinationLoader({ [EVIDENCE]: () => new Promise(() => {}) });

  openDestination(document, EVIDENCE, { loader });

  const region = byId(document, destinationStatusId(EVIDENCE));
  assert.equal(region.hidden, false, "a destination mid-fetch shows an empty pane");
  assert.match(statusText(document, EVIDENCE), /◌\s*Reading/);
  assert.match(statusText(document, EVIDENCE), /Opening Evidence/);
  assert.equal(region.getAttribute("aria-busy"), "true");
  // The retry belongs to the failure state only. A control offered mid-fetch
  // invites a reader to re-press a request that is still on its way.
  assert.equal(byId(document, destinationRetryId(EVIDENCE)).hidden, true);
});

// ---------------------------------------------------------------------------
// 3. Retry after a rejection succeeds on the second attempt.
// ---------------------------------------------------------------------------

test("a failed load is not cached: a second open is a second real attempt", async () => {
  const document = parseHtml(html);
  let attempts = 0;
  const loader = createDestinationLoader({
    [EVIDENCE]: () => {
      attempts += 1;
      return Promise.reject(new Error("network is offline"));
    },
  });

  await openDestination(document, EVIDENCE, { loader });
  assert.equal(attempts, 1);
  assert.equal(loader.invocations(EVIDENCE), 1);
  assert.equal(loader.stateOf(EVIDENCE), DESTINATION_LOAD_STATE.error);

  await openDestination(document, EVIDENCE, { loader });
  assert.equal(attempts, 2, "the failed load was cached, so a retry could never work");
  assert.equal(loader.invocations(EVIDENCE), 2);
  // Still the named failure, and still not an empty pane.
  assert.match(statusText(document, EVIDENCE), /Could not load Evidence/);
  assert.equal(byId(document, destinationRetryId(EVIDENCE)).hidden, false);
});

test("the retry control re-invokes the load and succeeds on the second attempt", async () => {
  const document = parseHtml(html);
  let attempts = 0;
  let offline = true;
  const loader = createDestinationLoader({
    [EVIDENCE]: () => {
      attempts += 1;
      return offline
        ? Promise.reject(new Error("network is offline"))
        : Promise.resolve({ briefing: "arrived" });
    },
  });

  const shell = initWorkspaceShell(document, { win: fakeWindow(), loader });
  await openDestination(document, EVIDENCE, { loader });
  assert.match(statusText(document, EVIDENCE), /Could not load Evidence/);

  offline = false;
  byId(document, destinationRetryId(EVIDENCE)).click();
  await loader.load(EVIDENCE);
  // One microtask for the shell's own repaint, which is chained off that load.
  await Promise.resolve();

  assert.equal(attempts, 2, "the retry did not re-invoke the load");
  assert.equal(loader.invocations(EVIDENCE), 2);
  assert.equal(loader.stateOf(EVIDENCE), DESTINATION_LOAD_STATE.ready);
  assert.deepEqual(loader.value(EVIDENCE), { briefing: "arrived" });
  // The region retires: a status that stayed on screen after the module landed
  // would be the second visual vocabulary this change exists to avoid.
  assert.equal(byId(document, destinationStatusId(EVIDENCE)).hidden, true);
  assert.equal(byId(document, destinationRetryId(EVIDENCE)).hidden, true);

  // A third open after success is served from the cache.
  await openDestination(document, EVIDENCE, { loader });
  assert.equal(attempts, 2, "an open after a successful load re-fetched the module");
  shell.dispose();
});

// ---------------------------------------------------------------------------
// The loader's own rules, driven directly.
// ---------------------------------------------------------------------------

test("a second open while the first is in flight does not start a second fetch", async () => {
  let attempts = 0;
  let settle;
  const loader = createDestinationLoader({
    [EVIDENCE]: () => {
      attempts += 1;
      return new Promise((resolve) => { settle = resolve; });
    },
  });

  const first = loader.load(EVIDENCE);
  const second = loader.load(EVIDENCE);
  // The thunk is deliberately deferred by one microtask — see the comment on
  // `Promise.resolve().then(source)` in the loader — so this waits for it.
  await Promise.resolve();
  assert.equal(attempts, 1, "an in-flight load was started twice");
  settle({ ok: true });
  assert.deepEqual((await first).value, (await second).value);
  assert.equal(attempts, 1);
});

test("a thunk that throws synchronously is still retryable", async () => {
  let attempts = 0;
  const loader = createDestinationLoader({
    [EVIDENCE]: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("module evaluation failed");
      return Promise.resolve("second time");
    },
  });

  const failed = await loader.load(EVIDENCE);
  assert.equal(failed.status, DESTINATION_LOAD_STATE.error);
  assert.match(failed.error.message, /module evaluation failed/);
  const recovered = await loader.load(EVIDENCE);
  assert.equal(recovered.status, DESTINATION_LOAD_STATE.ready);
  assert.equal(recovered.value, "second time");
  assert.equal(attempts, 2);
});

test("a key with no module resolves as absent rather than failing", async () => {
  const loader = createDestinationLoader({});
  const outcome = await loader.load(WORKSPACE_DESTINATION.answer);
  assert.equal(outcome.status, "absent");
  assert.equal(outcome.value, null);
  assert.equal(loader.invocations(WORKSPACE_DESTINATION.answer), 0);
});

test("a seeded value is never re-fetched", async () => {
  let attempts = 0;
  const loader = createDestinationLoader({
    [WORKSPACE_DESTINATION.actAndVerify]: () => {
      attempts += 1;
      return Promise.resolve("fetched");
    },
  });
  assert.equal(loader.seed(WORKSPACE_DESTINATION.actAndVerify, "held by the entry"), true);
  const document = parseHtml(html);
  applyWorkspaceDestination(document, WORKSPACE_DESTINATION.actAndVerify, { loader });
  await loader.load(WORKSPACE_DESTINATION.actAndVerify);
  assert.equal(attempts, 0, "the shell re-read a record the page entry already held");
  assert.equal(loader.value(WORKSPACE_DESTINATION.actAndVerify), "held by the entry");
});
