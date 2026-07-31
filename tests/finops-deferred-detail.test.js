// Disclosure-only evidence that is fetched rather than shipped.
//
// Three things have to be true and none of them are true by construction: the
// detail appears when a reader expands the panel, the panel is readable prose
// when the fetch never lands, and a second expand costs nothing. The first two
// are driven through the shipped markup in src/evolution.html so a fallback
// that was authored in the wrong place fails here rather than in production.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, parseHtml, textOf } from "./support/browser.js";
import {
  DEFERRED_PANELS, DEFERRED_STATE, createDeferredDetailLoader, deferredPanel,
  installDeferredDetails,
} from "../src/finops-deferred-detail.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const PANEL = deferredPanel("peer-benchmark-method");
const FRAGMENT = JSON.parse(await readFile(
  new URL(`../src${PANEL.source}`, import.meta.url), "utf8"));

/** A fetch that serves the real shipped fragment and counts its calls. */
function servingFetch(payload = FRAGMENT) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => structuredClone(payload) };
  };
  return { fetchImpl, calls };
}

/** A fetch that never resolves, so a pending panel can be inspected mid-flight. */
function hangingFetch() {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    calls,
    release,
    fetchImpl: async (url) => {
      calls.push(url);
      await gate;
      return { ok: true, json: async () => structuredClone(FRAGMENT) };
    },
  };
}

function expand(document, id) {
  const details = document.getElementById(id);
  details.setAttribute("open", "");
  details.dispatchEvent(new DomEvent("toggle", { bubbles: false }));
  return details;
}

test("the deferred detail is fetched on first expand and painted into the panel", async () => {
  const document = parseHtml(html);
  const { fetchImpl, calls } = servingFetch();
  const installed = installDeferredDetails(document, { fetchImpl });

  const body = document.getElementById(PANEL.bodyId);
  assert.equal(body.dataset.deferredState, DEFERRED_STATE.fallback,
    "the panel must start in its server-rendered state, not in a loading state");
  assert.equal(calls.length, 0, "nothing may be fetched before the reader expands the panel");

  expand(document, PANEL.detailsId);
  await Promise.all(installed.settled);

  assert.deepEqual(calls, [PANEL.source]);
  assert.equal(body.dataset.deferredState, DEFERRED_STATE.loaded);
  const shown = textOf(body);
  assert.match(shown, /half of ties/,
    "the percentile arithmetic must reach the reader who opened the panel");
  assert.match(shown, /close for industry plus size, broad for size only/);
  assert.match(shown, /single prioritized action/);
  assert.equal(body.querySelectorAll("dt").length, FRAGMENT.entries.length,
    "every entry in the shipped fragment must be painted");
});

test("a second expand of the same panel does not refetch", async () => {
  const document = parseHtml(html);
  const { fetchImpl, calls } = servingFetch();
  const installed = installDeferredDetails(document, { fetchImpl });

  expand(document, PANEL.detailsId);
  await Promise.all(installed.settled);
  expand(document, PANEL.detailsId); // collapse
  expand(document, PANEL.detailsId); // expand again
  await Promise.all(installed.settled);

  assert.equal(calls.length, 1, "the loaded panel must be served from memory");
  assert.match(textOf(document.getElementById(PANEL.bodyId)), /half of ties/,
    "the detail must survive a collapse and a second expand");
});

test("concurrent expands of the same panel issue one request", async () => {
  const { fetchImpl, calls, release } = hangingFetch();
  const loader = createDeferredDetailLoader({ fetchImpl, timeoutMs: 0 });
  const first = loader.load(PANEL);
  const second = loader.load(PANEL);
  // The cache is written before the first await, so the second expand is
  // deduplicated synchronously — that is the property under test. The request
  // itself is issued a microtask later, so the call log is read after one turn.
  assert.equal(loader.requestCount, 1, "two expands in one tick must share one request");
  await Promise.resolve();
  assert.deepEqual(calls, [PANEL.source], "only one request may reach the network");
  release();
  assert.deepEqual(await first, await second);
});

test("a rejected fetch leaves the panel readable, names what is missing, and links to it", async () => {
  const document = parseHtml(html);
  const fetchImpl = async () => { throw new Error("offline"); };
  const installed = installDeferredDetails(document, { fetchImpl });

  const body = document.getElementById(PANEL.bodyId);
  const fallbackBefore = textOf(body);
  expand(document, PANEL.detailsId);
  await Promise.all(installed.settled);

  assert.equal(body.dataset.deferredState, DEFERRED_STATE.unavailable);
  const shown = textOf(body);
  assert.ok(shown.includes(fallbackBefore.split(" If it does not appear")[0]),
    "the server-rendered prose must still be readable after a failed load");
  assert.match(shown, /could not be loaded/,
    "a failed panel must say so in words rather than sit empty");
  assert.doesNotMatch(shown, /loading|Loading|…/,
    "a failed panel must never be left claiming a load is still in progress");
  const link = [...body.querySelectorAll("a")]
    .map((anchor) => anchor.getAttribute("href"));
  assert.ok(link.includes(PANEL.source),
    "the failure must link directly to the static file it could not render");
  assert.equal(document.getElementById(PANEL.detailsId).hasAttribute("open"), true,
    "the disclosure control itself must stay operable through a failed load");
});

test("a fetch that never settles times out back to prose rather than a permanent spinner", async () => {
  const document = parseHtml(html);
  const timers = [];
  const installed = installDeferredDetails(document, {
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 25,
    // Drive the clock rather than wait on it: a test that sleeps is a test that
    // is flaky on a loaded machine.
    timers: {
      setTimeout: (fn) => { timers.push(fn); return timers.length; },
      clearTimeout() {},
    },
  });

  expand(document, PANEL.detailsId);
  const body = document.getElementById(PANEL.bodyId);
  assert.equal(body.dataset.deferredState, DEFERRED_STATE.loading);
  for (const fire of timers) fire();
  await Promise.all(installed.settled);

  assert.equal(body.dataset.deferredState, DEFERRED_STATE.unavailable);
  assert.match(textOf(body), /could not be loaded/);
});

test("every deferred panel's fallback is server-rendered, so it survives no JavaScript", () => {
  const document = parseHtml(html);
  for (const panel of DEFERRED_PANELS) {
    const body = document.getElementById(panel.bodyId);
    assert.ok(body, `${panel.key} must have its container in the shipped markup`);
    const fallback = body.querySelector(`[data-role="deferred-fallback"]`);
    assert.ok(fallback, `${panel.key} must author its fallback in markup, not paint it`);
    assert.ok(textOf(fallback).length > 80,
      `${panel.key}'s fallback must be a readable sentence, not a placeholder`);
    assert.ok([...body.querySelectorAll("a")]
      .some((anchor) => anchor.getAttribute("href") === panel.source),
      `${panel.key}'s fallback must link to the static file it stands in for`);
    assert.ok(document.getElementById(panel.detailsId),
      `${panel.key}'s disclosure control must be a native details in the markup`);
  }
});

test("the deferred fragment is not referenced by the initial payload's markup body", () => {
  // The point of the deferral: the prose is gone from the document. If it comes
  // back — pasted in beside the fallback, say — the payload budget would catch
  // the bytes, but this says why they are not allowed to be there.
  assert.doesNotMatch(html, /Percentile is the share strictly beaten/,
    "the deferred method prose must not be re-authored into evolution.html");
});
