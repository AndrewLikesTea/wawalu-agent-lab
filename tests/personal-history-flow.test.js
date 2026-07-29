// End-to-end regression for the personal AI-history workflow.
//
// Every test drives the shipped page — the real markup from
// src/personal-history.html, booted by the real entry (src/personal-history-page.js)
// — and asserts on what a reader can see: the boundary painted before a file is
// chosen, the states the workflow walks, the one figure a result leads with, and
// what survives a Clear pressed mid-read.
//
// THE RACE IS THE SUBJECT. Three of these tests hold a file read open on a
// promise the test itself resolves, so "Clear during processing", "the example
// against a file read", and "a superseded run settling last" are driven rather
// than reasoned about. Every one of them would have passed before the run ledger
// existed *and* painted the wrong thing, which is why each asserts on the panel
// on screen and not only on the absence of an error.
//
// The one thing the harness supplies is the browser's File API — a headless DOM
// cannot open a picker — so a selection is the `{ name, size, text() }` shape the
// page reads. `loadPage` is given no routes, so any network request at all
// throws: a page that grew a fetch fails here rather than in production.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { PERSONAL_ENTRY_REFUSAL } from "../src/personal-history-entry.js";
import { personalHistoryPreviewJson } from "../src/personal-history-fixture.js";

const PAGE = new URL("../src/personal-history.html", import.meta.url);

const PREVIEW_JSON = personalHistoryPreviewJson();

// A phrase that appears in the synthetic export and in nothing else. If it ever
// reaches the document, prompt text has leaked out of the reader.
const FIXTURE_PHRASE = "the renewal moved a month";

// A history that is read successfully and still cannot be graded: three prompts
// on two days, which clears neither declared floor.
const THIN_TABLE = "date,prompt\n2026-05-04,draft a note about the release\n"
  + "2026-05-05,summarise these three bullets for me\n2026-05-05,tighten this paragraph\n";

async function openPage() {
  const page = await loadPage(PAGE);
  await importPageModule("/personal-history-page.js");
  return page;
}

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));
const result = (document) => byId(document, "personal-history-result");
const report = (document) => result(document).querySelector(".ph-report");
const panel = (document) => result(document).querySelector(".ph-state");
const state = (document) => panel(document)?.dataset.state ?? report(document)?.dataset.state ?? null;

/** Hand the picker a selection. Nothing but name, size, and a text() promise. */
function chooseFile(document, file) {
  const input = byId(document, "personal-history-file");
  input.files = [file];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return input;
}

/** A file whose read the test finishes when it chooses to. */
function heldFile(name, text) {
  let release = null;
  let reject = null;
  const pending = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  return {
    file: { name, size: text.length, text: () => pending },
    resolve: () => { release(text); return pending.catch(() => {}); },
    fail: (message) => { reject(new Error(message)); return pending.catch(() => {}); },
  };
}

/** Activate a control the way a script would, past any disabled attribute. */
const forceClick = (node) => node.dispatchEvent(new DomEvent("click", { bubbles: true }));

const reportPainted = (document, description) =>
  waitFor(() => report(document), description);

/* ------------------------- before anything is chosen ------------------------- */

test("the page states the boundary and the shapes it reads before a file is chosen", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const boundary = byId(document, "personal-history-boundary");
    const claims = boundary.querySelectorAll("dt").map((node) => node.dataset.exclusion);
    assert.deepEqual(claims.sort(),
      ["attachments", "comparison", "credentials", "customer-data", "prompt-storage", "upload"].sort(),
      "every published refusal is on the page before a reader hands over anything");
    const text = textOf(boundary);
    assert.match(text, /this browser tab/, "the boundary says where the file is read");
    assert.match(text, /Uploaded\s*none/i);
    assert.match(text, /Keeps your prompt text\s*false/i);

    const eligibility = byId(document, "personal-history-eligibility");
    const shapes = eligibility.querySelectorAll(".ph-shape").map((node) => node.dataset.shape);
    assert.deepEqual(shapes, ["personal-conversation-json", "personal-prompt-table"]);
    assert.match(textOf(eligibility), /\.csv/, "a reader is told what their file should end in");
    assert.match(textOf(eligibility), /20 of your prompts/, "the floors are stated before the wait");
    assert.match(textOf(eligibility), /5\s*distinct days/);

    // Nothing has been read, and the page says so rather than showing an empty frame.
    assert.equal(state(document), "idle");
    assert.equal(result(document).getAttribute("aria-busy"), "false");
    assert.equal(shownText(document, "personal-history-status"), "");
  } finally {
    page.restore();
  }
});

test("the static markup carries the boundary and the controls even with no script at all", async () => {
  const html = await readFile(PAGE, "utf8");
  assert.match(html, /Your export never leaves this tab/);
  assert.match(html, /id="personal-history-file"/);
  assert.match(html, /id="personal-history-preview"/);
  assert.match(html, /id="personal-history-clear"/);
  // The workflow is separate from the organizational import, and says so.
  assert.match(html, /not the organizational conversation-export import/);
});

/* --------------------------------- results --------------------------------- */

test("the worked example lands one prioritized move, its confidence, its provenance, and one action", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    byId(document, "personal-history-preview").click();
    const article = await reportPainted(document, "the worked example to be graded");

    assert.equal(article.dataset.state, "prioritized");
    assert.equal(article.dataset.kind, "preview");
    assert.match(textOf(article.querySelector(".eyebrow")), /not yours/i,
      "the example must never read as a grade of the reader's own history");

    // One figure leads, and it is the move's worth across this history.
    const figures = article.querySelectorAll(".ph-figure");
    assert.equal(figures.length, 1, "one headline figure, not a dashboard");
    assert.equal(textOf(figures[0].querySelector(".ph-figure-value")), "288");
    assert.match(textOf(article.querySelector(".ph-lead-reach")), /42 prompts of the 42/);

    // Confidence and provenance travel with it.
    assert.equal(article.querySelector(".ph-confidence").dataset.confidence, "moderate");
    assert.match(textOf(article.querySelector(".ph-confidence-arithmetic")), /42 scored prompts \/ 20 floor/);
    const provenance = textOf(article.querySelector(".ph-provenance"));
    assert.match(provenance, /Personal conversation export \(JSON\)/);
    assert.match(provenance, /42 of 45 prompt entries scored \(93%\), across 9 days/);
    assert.match(provenance, /read in this tab/);

    // Exactly one next action, and it is an action rather than a figure.
    const actions = article.querySelectorAll(".ph-action");
    assert.equal(actions.length, 1);
    assert.ok(textOf(actions[0].querySelector(".ph-action-guidance")).length > 20);

    // A one-person reading is never presented as a standing against others. The
    // refusal that says so is drawn beside the figure — so the scan runs over
    // the claim itself, which is where a comparison would actually appear.
    assert.match(textOf(article.querySelector(".ph-lead-refusal")), /not a benchmark/i);
    const claim = [".ph-lead-move", ".ph-figure", ".ph-figure-caption", ".ph-lead-reach",
      ".ph-lead-evidence", ".ph-confidence-level", ".ph-confidence-rule",
      ".ph-confidence-arithmetic", ".ph-action-guidance"]
      .map((selector) => textOf(article.querySelector(selector) ?? article.querySelector(".ph-lead")))
      .join(" ").toLowerCase();
    for (const word of ["percentile", "cohort", "peer", "benchmark", "team", "average", "median"]) {
      assert.doesNotMatch(claim, new RegExp(`\\b${word}\\b`), `the claim printed "${word}"`);
    }
    // And no prompt from the export it read reaches the document.
    assert.ok(!textOf(document.querySelector("main")).includes(FIXTURE_PHRASE),
      "prompt text from the export reached the page");

    assert.match(shownText(document, "personal-history-status"), /One move is prioritized/);
    assert.equal(result(document).getAttribute("aria-busy"), "false");
  } finally {
    page.restore();
  }
});

test("a readable history that clears no floor is refused with the count that decided it", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    chooseFile(document, { name: "prompts.csv", size: THIN_TABLE.length, text: async () => THIN_TABLE });
    const article = await reportPainted(document, "the thin history to be reported");

    assert.equal(article.dataset.state, "not_eligible");
    assert.equal(article.querySelector(".ph-reason").dataset.reason, "too_few_scored_prompts");
    assert.equal(textOf(article.querySelector(".ph-figure-value")), "3");
    assert.match(textOf(article.querySelector(".ph-figure-caption")), /floors are 20 scored prompts/);
    assert.equal(article.querySelectorAll(".ph-action").length, 0, "a refusal names no move to act on");
    assert.match(textOf(article), /gone from memory when you leave the page|read in this tab/);
  } finally {
    page.restore();
  }
});

/* --------------------------- recoverable refusals --------------------------- */

test("an unsupported file is refused without being opened, and the workflow stays usable", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    let opened = false;
    chooseFile(document, { name: "transcript.pdf", size: 2048, text: async () => { opened = true; return ""; } });

    const refusal = panel(document);
    assert.equal(refusal.dataset.state, "error");
    assert.equal(refusal.dataset.code, PERSONAL_ENTRY_REFUSAL.unsupportedFileType);
    assert.equal(refusal.getAttribute("role"), "alert");
    assert.match(textOf(refusal), /Not read:/);
    assert.match(textOf(refusal), /Nothing was uploaded/);
    assert.equal(opened, false, "the refused file must never be opened");

    // Recoverable: the controls are live, and a supported file still works.
    assert.equal(byId(document, "personal-history-file").disabled, false);
    assert.equal(byId(document, "personal-history-preview").disabled, false);
    byId(document, "personal-history-preview").click();
    const article = await reportPainted(document, "a result after a refusal");
    assert.equal(article.dataset.state, "prioritized");
  } finally {
    page.restore();
  }
});

test("a file the browser cannot finish reading is an error a reader can act on", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const held = heldFile("history.json", PREVIEW_JSON);
    chooseFile(document, held.file);
    assert.equal(state(document), "processing");

    await held.fail("NotReadableError");
    const failure = await waitFor(() => {
      const node = panel(document);
      return node?.dataset.state === "error" ? node : null;
    }, "the read failure to be reported");

    assert.equal(failure.dataset.code, PERSONAL_ENTRY_REFUSAL.readFailed);
    assert.match(textOf(failure), /NotReadableError/);
    assert.match(textOf(failure), /Choose the file again/);
    assert.equal(byId(document, "personal-history-file").disabled, false, "the way out must be re-enabled");
    assert.equal(result(document).getAttribute("aria-busy"), "false");
  } finally {
    page.restore();
  }
});

/* ------------------------------ the race cases ------------------------------ */

test("Clear during a read empties the page, and the read cannot repaint it", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const held = heldFile("history.json", PREVIEW_JSON);
    chooseFile(document, held.file);

    // Mid-read: the page says which step it is on and the start controls are shut.
    const progress = panel(document);
    assert.equal(progress.dataset.state, "processing");
    assert.equal(result(document).getAttribute("aria-busy"), "true");
    assert.equal(byId(document, "personal-history-file").disabled, true);
    assert.equal(byId(document, "personal-history-preview").disabled, true);
    assert.equal(byId(document, "personal-history-clear").disabled, false, "Clear is the way out of a slow read");
    assert.match(textOf(progress), /Step 1 of 3/);

    byId(document, "personal-history-clear").click();
    assert.equal(state(document), "idle");
    assert.match(shownText(document, "personal-history-status"), /discarded/);

    // The read finishes anyway — a browser cannot be told to forget a promise —
    // and finds that it no longer owns the page.
    await held.resolve();
    for (let turn = 0; turn < 30; turn += 1) await new Promise((settle) => setImmediate(settle));

    assert.equal(report(document), null, "a cleared page painted a stale report");
    assert.equal(state(document), "idle");
    assert.equal(result(document).getAttribute("aria-busy"), "false");
    assert.match(shownText(document, "personal-history-status"), /discarded/,
      "a discarded run must not announce itself either");
  } finally {
    page.restore();
  }
});

test("the worked example started during a file read wins, and the file read cannot overwrite it", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    // A file that would produce a visibly different result if it landed.
    const held = heldFile("prompts.csv", THIN_TABLE);
    chooseFile(document, held.file);
    assert.equal(state(document), "processing");

    // The control is disabled, so a reader cannot do this by hand — the guard is
    // what makes it impossible rather than merely inconvenient, so the click is
    // dispatched past the disabled attribute on purpose.
    assert.equal(byId(document, "personal-history-preview").disabled, true);
    forceClick(byId(document, "personal-history-preview"));

    const article = await reportPainted(document, "the worked example to land");
    assert.equal(article.dataset.kind, "preview");
    assert.equal(article.dataset.state, "prioritized");

    await held.resolve();
    for (let turn = 0; turn < 30; turn += 1) await new Promise((settle) => setImmediate(settle));

    const still = report(document);
    assert.equal(still.dataset.kind, "preview", "the superseded file read overwrote the example");
    assert.equal(still.dataset.state, "prioritized");
    assert.equal(result(document).querySelectorAll(".ph-report").length, 1, "two results are on screen at once");
    assert.match(shownText(document, "personal-history-status"), /worked example/i);
  } finally {
    page.restore();
  }
});

test("a superseded file read settling last cannot replace the run that replaced it", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const first = heldFile("old.csv", THIN_TABLE);
    const second = heldFile("current.json", PREVIEW_JSON);

    chooseFile(document, first.file);
    // A second selection while the first is still in flight. Real enough: a
    // reader who picks again after a slow read, or a picker that fires twice.
    chooseFile(document, second.file);

    await second.resolve();
    const article = await reportPainted(document, "the second selection to land");
    assert.equal(article.dataset.state, "prioritized");
    assert.equal(article.dataset.shape, "personal-conversation-json");

    // Now the first read finishes, last. Its result is a refusal, and it must
    // not appear under a heading that describes the second file.
    await first.resolve();
    for (let turn = 0; turn < 30; turn += 1) await new Promise((settle) => setImmediate(settle));

    assert.equal(report(document).dataset.state, "prioritized", "the stale read painted its own result");
    assert.equal(report(document).dataset.shape, "personal-conversation-json");
    assert.equal(result(document).childElements.length, 1);
  } finally {
    page.restore();
  }
});

test("Clear during the example discards it too, and a later start still works", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    byId(document, "personal-history-preview").click();
    assert.equal(state(document), "processing");
    byId(document, "personal-history-clear").click();

    for (let turn = 0; turn < 30; turn += 1) await new Promise((settle) => setImmediate(settle));
    assert.equal(state(document), "idle", "the example painted over a cleared page");

    byId(document, "personal-history-preview").click();
    const article = await reportPainted(document, "the example after a clear");
    assert.equal(article.dataset.state, "prioritized");
  } finally {
    page.restore();
  }
});

/* ----------------------- keyboard and assistive access ----------------------- */

test("every control is reachable by Tab, in the order the workflow reads", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const ids = tabSequence(document).map((stop) => stop.id).filter(Boolean);
    const order = ["personal-history-file", "personal-history-preview", "personal-history-clear"];
    const positions = order.map((id) => ids.indexOf(id));
    for (const [index, at] of positions.entries()) {
      assert.ok(at >= 0, `${order[index]} is not reachable by Tab`);
      if (index) assert.ok(at > positions[index - 1], `${order[index]} is out of reading order`);
    }
    // The field is named by its label and described by the sentence under it.
    const input = byId(document, "personal-history-file");
    assert.equal(document.querySelector('label[for="personal-history-file"]').textContent.trim(), "Your own export");
    assert.equal(input.getAttribute("aria-describedby"), "personal-history-file-hint");
    assert.match(input.getAttribute("accept"), /\.json/);

    // One live region, and it is polite: a result is read out, never interrupted.
    const status = byId(document, "personal-history-status");
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.getAttribute("aria-live"), "polite");
  } finally {
    page.restore();
  }
});

test("the supporting evidence is disclosed progressively, and each disclosure is a real button", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    byId(document, "personal-history-preview").click();
    const article = await reportPainted(document, "a result with disclosures");

    const toggles = article.querySelectorAll(".ph-toggle");
    assert.equal(toggles.length, 2, "the evidence and the boundary, in that order");
    for (const toggle of toggles) {
      assert.equal(toggle.tagName, "BUTTON");
      assert.equal(toggle.getAttribute("type"), "button");
      assert.equal(toggle.getAttribute("aria-expanded"), "false");
      const panel = byId(document, toggle.getAttribute("aria-controls"));
      assert.ok(panel, "a toggle must control a panel that exists");
      assert.equal(panel.hidden, true, "supporting evidence is shut by default");
      assert.ok(!tabSequence(document).includes(panel.querySelector("a") ?? panel),
        "a closed panel must not hold a tab stop");
    }

    // Opened from the keyboard, not just the mouse.
    let focused = null;
    for (let step = 0; step < tabSequence(document).length; step += 1) {
      focused = pressTab(document);
      if (focused === toggles[0]) break;
    }
    assert.equal(focused, toggles[0], "the first disclosure is not reachable by Tab");
    pressEnter(document);
    assert.equal(toggles[0].getAttribute("aria-expanded"), "true");

    const panel = byId(document, toggles[0].getAttribute("aria-controls"));
    assert.equal(panel.hidden, false);
    const evidence = textOf(panel);
    assert.match(evidence, /Prompt entries found/);
    assert.match(evidence, /prompt_entries = scored_prompts/, "the reconciliation travels with the counts");
    assert.match(evidence, /Say what the answer may not do/, "the move it beat is named");
    assert.ok(!evidence.includes(FIXTURE_PHRASE), "prompt text reached a disclosure panel");

    // Closing puts it back, so the state a reader left is the state they return to.
    toggles[0].click();
    assert.equal(toggles[0].getAttribute("aria-expanded"), "false");
    assert.equal(panel.hidden, true);
  } finally {
    page.restore();
  }
});

/* ------------------------------ the boundary ------------------------------ */

test("no module this workflow reaches can upload, store, or authenticate", async () => {
  const modules = [
    "personal-history-page.js", "personal-history-view.js", "personal-history-entry.js",
    "personal-history-report.js", "personal-history-contract.js", "personal-history-fixture.js",
  ];
  // Call syntax rather than the word: the contract module *states* these
  // refusals in its published copy, and a scan that could not tell a promise
  // from a call would have to exclude the module that makes the promise.
  const forbidden = [
    /\bfetch\s*\(/, /new XMLHttpRequest/, /\.sendBeacon\s*\(/, /new WebSocket/,
    /new EventSource/, /localStorage\s*[.[]/, /sessionStorage\s*[.[]/, /indexedDB\s*\.\s*[a-z]/,
    /document\.cookie/, /[Aa]uthorization"?\s*:/, /\bapiKey\s*[:=]/,
  ];
  for (const name of modules) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
    // Comments state the refusals in prose, so the check runs on code alone.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
      .filter((row) => !row.trim().startsWith("//") && !row.trim().startsWith("*")).join("\n");
    for (const pattern of forbidden) {
      assert.doesNotMatch(code, pattern, `${name} reaches for ${pattern}`);
    }
  }
});

test("one module names browser storage, and it names one key", async () => {
  // The list above is the whole workflow except the module whose job is the
  // slot one reading is carried forward in. The claim that used to be "nothing
  // is written to browser storage" is now "one module writes one key", so this
  // is what checks it: every other module still cannot reach storage at all, and
  // the one that can cannot reach a second key.
  const source = await readFile(
    new URL("../src/personal-history-carry-forward.js", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
    .filter((row) => !row.trim().startsWith("//") && !row.trim().startsWith("*")).join("\n");

  for (const pattern of [/\bfetch\s*\(/, /new XMLHttpRequest/, /\.sendBeacon\s*\(/,
    /new WebSocket/, /new EventSource/, /document\.cookie/, /\bapiKey\s*[:=]/]) {
    assert.doesNotMatch(code, pattern, `the carry-forward module reaches for ${pattern}`);
  }
  assert.doesNotMatch(code, /sessionStorage|indexedDB/, "a second storage is reached for");
  // Every call goes through the one declared key, so a key name is never built
  // at a call site and a second slot cannot appear without this failing.
  const keyed = [...code.matchAll(/(getItem|setItem|removeItem)\(([^)]*)/g)]
    .filter(([, , args]) => !args.startsWith("CARRY_FORWARD_STORAGE.key"));
  assert.deepEqual(keyed.map(([match]) => match), [],
    "a storage call names something other than the one declared key");
});
