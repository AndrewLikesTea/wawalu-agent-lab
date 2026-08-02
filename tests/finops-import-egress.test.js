// The one claim on the AI FinOps page that a reader cannot check for
// themselves: "your files do not leave this tab" (#745).
//
// Every other promise the page makes is visible in what it renders. This one is
// about what it does NOT do, so asserting it means removing the ability to do
// it and then running the real thing. That is what this file is: the shipped
// markup from src/evolution.html, booted by the shipped entry
// src/evolution-page.js, driven through a real import of a real provider export
// — with every transport a browser offers replaced by a recorder first.
//
// WHAT COUNTS AS EGRESS HERE. `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`,
// `EventSource`, `WebSocket`, a native form submission, and a navigation away
// from the page. A recorder does not throw: a throw inside a `try` in page code
// is a caught error and a green test, whereas a recorded call is a violation
// this test names, with the URL it was about to send to.
//
// WHY BOOT IS EXCLUDED. The page fetches three bundled same-origin JSON
// fixtures before a file is ever chosen (the demo seed, the evaluation
// fixtures, the model-overspend finding). Those are the page loading its own
// assets, not a leader's data leaving; the recorders are installed AFTER boot
// settles, so the subject is exactly the import-and-scoring path.
//
// This test must be able to fail the build. Nothing in it is todo or skipped,
// and the negative check is written down in the pull request: introducing one
// `fetch(...)` into the import path turns it red.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

// The same bundled seed the rest of the suite serves, so the panel is met in
// the state a visitor meets it in. These are the page's own assets.
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// The subject: the checked-in example provider export and org roster, reused
// from the dialect contracts rather than copied, with two project labels
// respelled the way the roster spells them so the join actually produces a
// figure. An import that scores nothing would not exercise the scoring path.
const EXAMPLE_EXPORTS = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);
const PROVIDER_EXPORT = (await readFile(new URL("openai-usage-export.csv", EXAMPLE_EXPORTS), "utf8"))
  .replace(/atlas-platform/g, "Atlas Platform")
  .replace(/boreal-support/g, "Boreal Support");
const ORG_ROSTER = await readFile(new URL("generic-hris-roster.csv", EXAMPLE_EXPORTS), "utf8");

// The same subject on the path a leader now actually takes: one supported
// export, activated by its own adapter with no mapping step in between. The
// two-file selection above still walks the mapping step, so without this the
// one-file branch would carry no behavioural proof of the claim at all.
const NATIVE_OPENAI = await readFile(new URL(
  "../contracts/integrations/native-provider-exports/v1/fixtures/openai-supported.csv",
  import.meta.url), "utf8");

const PROVIDER_FILE = "openai-usage-export.csv";
const ROSTER_FILE = "generic-hris-roster.csv";

// ---------------------------------------------------------------------------
// The recorders.
// ---------------------------------------------------------------------------

/**
 * Replace every outbound transport with something that records instead of
 * sending, and hand back the log plus the teardown that puts the originals
 * back. Restoration is total — a stub that outlived this file would silence
 * every other suite's network expectations.
 */
function recordEgress(document) {
  const violations = [];
  const note = (channel, target) => { violations.push(`${channel} → ${target}`); };

  const globals = ["fetch", "XMLHttpRequest", "navigator", "EventSource", "WebSocket"];
  const saved = Object.fromEntries(globals
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const install = (key, value) => Object.defineProperty(globalThis, key,
    { value, writable: true, configurable: true, enumerable: false });

  install("fetch", async (input, options) => {
    note("fetch", `${options?.method ?? "GET"} ${input}`);
    return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
  });

  // Defined rather than wrapped: the harness DOM has no XHR, and a page that
  // reached for one would otherwise die on a ReferenceError somebody's `catch`
  // could swallow. The recorder makes the attempt visible either way.
  install("XMLHttpRequest", class RecordingXhr {
    open(method, url) { this.request = `${method} ${url}`; note("XMLHttpRequest.open", this.request); }
    send() { note("XMLHttpRequest.send", this.request ?? "(no open)"); }
    setRequestHeader() {}
    addEventListener() {}
  });
  install("navigator", { ...globalThis.navigator, sendBeacon: (url) => { note("sendBeacon", url); return true; } });
  install("EventSource", class RecordingEventSource {
    constructor(url) { note("EventSource", url); this.url = url; }
    addEventListener() {}
    close() {}
  });
  install("WebSocket", class RecordingWebSocket {
    constructor(url) { note("WebSocket", url); this.url = url; }
    send(data) { note("WebSocket.send", `${this.url} ${String(data).slice(0, 40)}`); }
    addEventListener() {}
    close() {}
  });

  // A native form submission is egress with no script in it. The harness's
  // elements share one prototype and it carries no `submit`, so this both adds
  // the recorder and gives the page the constructor name a browser would.
  const form = document.getElementById("finops-contact-form");
  const elementPrototype = Object.getPrototypeOf(form);
  const savedSubmit = Object.getOwnPropertyDescriptor(elementPrototype, "submit");
  Object.defineProperty(elementPrototype, "submit", {
    value() { note("HTMLFormElement.submit", this.id || this.tagName); },
    writable: true, configurable: true,
  });
  const savedFormElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLFormElement");
  install("HTMLFormElement", elementPrototype.constructor);

  // Navigation is the transport nobody stubs: `location.href = "https://…?rows"`
  // sends just as effectively as a POST. The harness records every navigation
  // the document performs, so the baseline is taken here and compared later.
  const navigationsBefore = document.navigations.length;

  return {
    violations,
    navigationsSince: () => document.navigations.slice(navigationsBefore),
    restore() {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      if (savedFormElement) Object.defineProperty(globalThis, "HTMLFormElement", savedFormElement);
      else delete globalThis.HTMLFormElement;
      if (savedSubmit) Object.defineProperty(elementPrototype, "submit", savedSubmit);
      else delete elementPrototype.submit;
    },
  };
}

// ---------------------------------------------------------------------------
// The import, driven exactly as tests/finops-import-e2e.test.js drives it.
// ---------------------------------------------------------------------------

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  // Every asynchronous surface the page boots has to settle before the
  // recorders go in, or one of the page's own asset fetches would land inside
  // the recording window and be reported as a leak of the leader's data.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => textOf(byId(document, "integration-contract-provenance")).startsWith("Gateway completed"),
    "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result").getAttribute("aria-busy") === "false",
    "the evaluation panel to settle");
  return page;
}

function chooseFiles(document, files) {
  const input = byId(document, "local-finops-files");
  input.files = files.map(({ name, text }) => ({
    name, type: "text/csv", text: async () => text,
  }));
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const reviewOpens = (document, fileName) => waitFor(
  () => !byId(document, "import-mapping").hidden && shownText(document, "import-mapping-file") === fileName,
  `the column-mapping step to open on ${fileName}`);

test("importing and scoring a provider export opens no outbound connection", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  const egress = recordEgress(document);
  t.after(() => { egress.restore(); page.restore(); });

  // Step 1 → 2: the file is read and its columns are recognized.
  chooseFiles(document, [
    { name: PROVIDER_FILE, text: PROVIDER_EXPORT },
    { name: ROSTER_FILE, text: ORG_ROSTER },
  ]);
  await reviewOpens(document, PROVIDER_FILE);

  // Step 2 → 3: both mappings confirmed, and the analysis runs.
  byId(document, "import-mapping-confirm").click();
  await reviewOpens(document, ROSTER_FILE);
  byId(document, "import-mapping-confirm").click();
  await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");

  // The path really ran. Without this, a silently broken import would pass by
  // doing nothing at all, which is the one way this test could lie.
  assert.equal(shownText(document, "local-trust-coverage"), "81.3%",
    "the import must have actually scored the fixture, or there was nothing to leak");
  assert.match(shownText(document, "local-recoverable"), /^\d+\.\d{2} USD$/);

  assert.deepEqual(egress.violations, [],
    "the import path transmitted the leader's data; every entry above is a call that would have left the browser");
  assert.deepEqual(egress.navigationsSince(), [],
    "the import path navigated the page, which carries whatever is in the URL off the browser");
});

test("the one-file native activation path opens no outbound connection either", async (t) => {
  const page = await openFinopsTab();
  const { document } = page;
  const egress = recordEgress(document);
  t.after(() => { egress.restore(); page.restore(); });

  // No mapping step to click through: the adapter is recognized from the header
  // row and the analysis runs from the same selection event.
  chooseFiles(document, [{ name: "openai-native.csv", text: NATIVE_OPENAI }]);
  await waitFor(() => !byId(document, "local-results").hidden, "the activated analysis to appear");

  // The branch really ran. Without this a skipped activation would pass by
  // leaking nothing because it did nothing.
  assert.equal(byId(document, "import-mapping").hidden, true,
    "this must be the direct path, not the mapping step under another name");
  assert.equal(byId(document, "local-export-activation").dataset.state, "ready");

  assert.deepEqual(egress.violations, [],
    "the native activation path transmitted the leader's export; every entry above is a call that would have left the browser");
  assert.deepEqual(egress.navigationsSince(), [],
    "the native activation path navigated the page, which carries whatever is in the URL off the browser");
});

test("exporting the resulting briefing keeps it in the browser too", async (t) => {
  // The file the leader is handed back is written with `URL.createObjectURL`
  // over a `Blob` and downloaded by the anchor. That is local by construction —
  // and it is also the most tempting place to add "and mail a copy", so it is
  // held to the same rule as the import.
  const page = await openFinopsTab();
  const { document } = page;

  chooseFiles(document, [
    { name: PROVIDER_FILE, text: PROVIDER_EXPORT },
    { name: ROSTER_FILE, text: ORG_ROSTER },
  ]);
  await reviewOpens(document, PROVIDER_FILE);
  byId(document, "import-mapping-confirm").click();
  await reviewOpens(document, ROSTER_FILE);
  byId(document, "import-mapping-confirm").click();
  await waitFor(() => !byId(document, "local-results").hidden, "the decision brief to appear");

  const egress = recordEgress(document);
  t.after(() => { egress.restore(); page.restore(); });

  const download = byId(document, "export-local-json");
  assert.ok(download, "the briefing export control is no longer on the page");
  download.click();
  await waitFor(() => document.downloads.length > 0, "the briefing file to be handed back");

  assert.deepEqual(egress.violations, [],
    "exporting the briefing transmitted it");
});

// ---------------------------------------------------------------------------
// Supplementary only: the behavioural check above is the requirement.
// ---------------------------------------------------------------------------

test("no module on the import-and-scoring path names a transport at all", async () => {
  // A source scan cannot prove absence — a transport reached through a computed
  // property would pass this and fail the behavioural test above. It is here for
  // the reverse case: code added on a branch the fixture happens not to walk.
  //
  // The seeds are the path's own entries — the flow, the offload, the worker
  // core, the reader, the mapper, the normalizer, the scorer. Everything below
  // them is walked rather than listed, so a module added under one of them is
  // covered on the day it is added. `evolution-page.js` is deliberately not a
  // seed: it is the page boot, and it legitimately fetches bundled assets.
  // `native-provider-activation.js` is its own seed: it decides whether a file
  // skips the mapping step, but the page reaches it by an absolute specifier and
  // the walk below follows relative ones, so no other entry would pull it in.
  const ENTRIES = ["local-import-flow.js", "import-offload.js", "import-worker-core.js",
    "finops-tabular-import.js", "import-column-mapping.js", "finops-export-normalization.js",
    "finops-trust-verdict.js", "local-finops.js", "native-provider-activation.js"];
  const source = new URL("../src/", import.meta.url);
  const seen = new Set();
  const offenders = [];
  const queue = ENTRIES.map((entry) => new URL(entry, source).href);

  while (queue.length) {
    const href = queue.pop();
    if (seen.has(href)) continue;
    seen.add(href);
    const text = await readFile(new URL(href), "utf8");
    const name = href.slice(source.href.length);
    for (const transport of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bsendBeacon\b/,
      /\bnew\s+WebSocket\b/, /\bnew\s+EventSource\b/]) {
      if (transport.test(text)) offenders.push(`${name} names ${transport.source}`);
    }
    // Relative specifiers only, resolved against the importing module, so a
    // module in a subdirectory pulls in its own neighbours and not the ones it
    // would have had at the top of src/.
    for (const [, specifier] of text.matchAll(/\bfrom\s+"(\.[^"]+\.js)"/g)) {
      queue.push(new URL(specifier, href).href);
    }
  }

  assert.ok(seen.size > 10, `only ${seen.size} modules were walked; the closure walk stopped early`);
  assert.deepEqual(offenders, [], "a module on the import path names a network transport");
});
