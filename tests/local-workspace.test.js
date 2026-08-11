// The local workspace: what this browser keeps, and what a reader can do about it.
//
// Two halves, both driving shipped code. The first pins the model — the state a
// given storage produces, the confidence grade beside it, and the single next
// action chosen from it — because those sentences are the page's whole claim and
// a screenshot cannot check them. The second boots src/workspace.html the way
// the browser boots it and asserts only what a reader can perceive: the words in
// a chip, the tab order, where focus lands after a destructive step, and what
// the live region says.
//
// Determinism: no network (the harness throws on an undeclared request), no
// sleeps, and every clock is injected. Each test seeds its own storage.

import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY, saveReleases } from "../src/releases.js";
import { saveDecisions } from "../src/app.js";
import {
  CONFIDENCE, OUTCOME, RETENTION, WORKSPACE_KEY, WORKSPACE_STATE,
  eraseWorkspace, readWorkspace, retentionDeclined, setRetention,
} from "../src/local-workspace.js";
import { DomEvent, loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/workspace.html", import.meta.url);
const NOW = new Date("2026-07-28T11:30:00.000Z");
const now = () => NOW;

const DECISION = {
  id: "ws-cache",
  title: "Cache the read path",
  context: "Read latency spikes under load.",
  alternatives: "Query tuning alone.",
  owner: "Ari",
  status: "accepted",
  createdAt: "2026-07-20T09:00:00.000Z",
};

const RELEASE = {
  id: "ws-r-1-2-0",
  version: "1.2.0",
  createdAt: "2026-07-22T09:00:00.000Z",
  decisionIds: ["ws-cache"],
};

/** A storage stand-in. `refuse` models a browser that blocks site data outright. */
function storageOf(seed = {}, { refuse = false } = {}) {
  const values = new Map(Object.entries(seed));
  const guard = () => {
    if (refuse) throw new Error("this browser blocks site data");
  };
  return {
    getItem(key) { guard(); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { guard(); values.set(key, String(value)); },
    removeItem(key) { guard(); values.delete(key); },
    get size() { return values.size; },
  };
}

const populated = (extra = {}) => storageOf({
  [STORAGE_KEY]: JSON.stringify([DECISION]),
  [RELEASE_STORAGE_KEY]: JSON.stringify([RELEASE]),
  ...extra,
});

/* --------------------------------- states --------------------------------- */

test("an untouched browser reads as empty, verified, and asks for a first record", () => {
  const view = readWorkspace(storageOf(), { now: NOW });

  assert.equal(view.state, WORKSPACE_STATE.empty);
  assert.equal(view.confidence.grade, CONFIDENCE.verified);
  assert.equal(view.records.total, 0);
  assert.equal(view.nextAction.code, "first_record");
  // The default is stated as a default, never as a choice the visitor made.
  assert.equal(view.retentionChosen, false);
  assert.equal(view.retention, RETENTION.retaining);
});

test("a populated browser counts both stores and names its own size", () => {
  const view = readWorkspace(populated(), { now: NOW });

  assert.equal(view.state, WORKSPACE_STATE.retaining);
  assert.deepEqual(
    [view.records.decisions, view.records.releases, view.records.total],
    [1, 1, 2],
  );
  assert.match(view.summary, /1 decision and 1 release retained in this browser/);
  assert.match(view.summary, /under 1 KB of JSON text/);
  assert.equal(view.records.newestOn, "2026-07-22");
  // Never backed up, so the one thing to do is take a backup.
  assert.equal(view.nextAction.code, "first_backup");
});

test("storage this browser refuses is unknown, not zero", () => {
  const view = readWorkspace(storageOf({}, { refuse: true }), { now: NOW });

  assert.equal(view.state, WORKSPACE_STATE.unavailable);
  assert.equal(view.confidence.grade, CONFIDENCE.unknown);
  // The distinction the whole grade exists for: an unreadable store must not be
  // reported as an empty one.
  assert.match(view.confidence.detail, /are not zero — they are unavailable/);
  assert.match(view.summary, /what is retained here is unknown/);
  assert.equal(view.nextAction.code, "recheck_storage");
  assert.equal(view.canErase, false);
  assert.equal(view.canExport, false);
});

test("text that is not a list of records is corrupted, and restore comes before erase", () => {
  const view = readWorkspace(storageOf({ [STORAGE_KEY]: "{ this is not a list" }), { now: NOW });

  assert.equal(view.state, WORKSPACE_STATE.corrupted);
  assert.equal(view.confidence.grade, CONFIDENCE.partial);
  assert.equal(view.nextAction.code, "restore_unreadable");
  assert.match(view.nextAction.why, /Restore before erasing/);
  // There is something to erase even though nothing counts as a record.
  assert.equal(view.canErase, true);
});

test("entries this build cannot read drop the grade to partial and say how many", () => {
  const view = readWorkspace(storageOf({
    [STORAGE_KEY]: JSON.stringify([DECISION, { id: "half", title: "no owner" }]),
  }), { now: NOW });

  assert.equal(view.confidence.grade, CONFIDENCE.partial);
  assert.equal(view.records.decisions, 1);
  assert.equal(view.records.dropped, 1);
  assert.match(view.confidence.detail, /1 stored entry did not match the record shape/);
});

test("declining retention with records still stored prioritizes the stranded records", () => {
  const storage = populated();
  setRetention(storage, RETENTION.declined, { now: NOW });
  const view = readWorkspace(storage, { now: NOW });

  assert.equal(view.state, WORKSPACE_STATE.declined);
  assert.equal(view.storage.label, "Not retaining");
  assert.equal(view.nextAction.code, "erase_after_decline");
  assert.match(view.nextAction.label, /Erase 1 decision and 1 release/);
  assert.match(view.nextAction.why, /Download a backup first/);
});

test("declining with nothing stored offers the way back in", () => {
  const storage = storageOf();
  setRetention(storage, RETENTION.declined, { now: NOW });

  assert.equal(readWorkspace(storage, { now: NOW }).nextAction.code, "opt_in");
});

test("a backup that predates the newest record is stale; one that covers it settles", () => {
  const stale = populated({
    [WORKSPACE_KEY]: JSON.stringify({ retention: "retaining", exportedAt: "2026-07-21T09:00:00.000Z" }),
  });
  assert.equal(readWorkspace(stale, { now: NOW }).nextAction.code, "stale_backup");

  const covered = populated({
    [WORKSPACE_KEY]: JSON.stringify({ retention: "retaining", exportedAt: "2026-07-27T09:00:00.000Z" }),
  });
  const view = readWorkspace(covered, { now: NOW });
  assert.equal(view.nextAction.code, "settled");
  assert.equal(view.nextAction.kind, "link");
});

test("every state offers exactly one next action, and it is always sayable", () => {
  const cases = [
    storageOf(),
    populated(),
    storageOf({}, { refuse: true }),
    storageOf({ [RELEASE_STORAGE_KEY]: "nonsense" }),
    populated({ [WORKSPACE_KEY]: JSON.stringify({ retention: "declined" }) }),
  ];
  for (const storage of cases) {
    const { nextAction } = readWorkspace(storage, { now: NOW });
    assert.ok(nextAction.headline && nextAction.why && nextAction.label, "an action with no words");
    assert.ok(["recheck", "restore", "erase", "opt-in", "export", "link"].includes(nextAction.kind));
    if (nextAction.kind === "link") assert.match(nextAction.href, /^\//);
  }
});

/* ------------------------------- provenance ------------------------------- */

test("provenance names the storage keys and refuses to overclaim about backups", () => {
  const view = readWorkspace(populated(), { now: NOW });
  const rows = new Map(view.provenance.map((row) => [row.term, row.detail]));

  assert.match(rows.get("Decision count"), new RegExp(STORAGE_KEY));
  assert.match(rows.get("Release count"), new RegExp(RELEASE_STORAGE_KEY));
  assert.match(rows.get("Size"), /not disk usage/);
  assert.match(rows.get("Last backup"), /No backup has been downloaded from this page/);
  assert.match(rows.get("Checked"), /2026-07-28 11:30 UTC/);
  // The claim that makes the rest checkable.
  assert.match(rows.get("Checked"), /no network call, cookie, or analytics/);
});

/* ------------------------------- the writes ------------------------------- */

test("erasing clears both stores, keeps the retention choice, and says it is final", () => {
  const storage = populated();
  setRetention(storage, RETENTION.declined, { now: NOW });

  const result = eraseWorkspace(storage, { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.message, OUTCOME.erased);
  assert.match(result.message, /cannot be undone/);

  const view = readWorkspace(storage, { now: NOW });
  assert.equal(view.records.total, 0);
  // Erasing is not a way to be re-opted in.
  assert.equal(view.retention, RETENTION.declined);
  assert.equal(view.erasedOn, "2026-07-28");
});

test("a browser that refuses writes reports the refusal instead of a false success", () => {
  const blocked = storageOf({}, { refuse: true });

  assert.equal(setRetention(blocked, RETENTION.declined, { now: NOW }).ok, false);
  assert.equal(setRetention(blocked, RETENTION.declined, { now: NOW }).message, OUTCOME.choice_not_saved);
  assert.equal(eraseWorkspace(blocked, { now: NOW }).ok, false);
});

test("erase rolls back the first store when clearing the second store fails", () => {
  const storage = populated();
  const originalRemove = storage.removeItem;
  storage.removeItem = (key) => {
    if (key === RELEASE_STORAGE_KEY) throw new Error("release store refused the erase");
    originalRemove(key);
  };

  const result = eraseWorkspace(storage, { now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.code, "erase_failed");
  assert.equal(result.message, OUTCOME.erase_failed);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), [DECISION]);
  assert.deepEqual(JSON.parse(storage.getItem(RELEASE_STORAGE_KEY)), [RELEASE]);
});

test("erase reports an incomplete mutation when the browser also refuses rollback", () => {
  const storage = populated();
  const originalSet = storage.setItem;
  storage.removeItem = (key) => {
    if (key === RELEASE_STORAGE_KEY) throw new Error("release store refused the erase");
    // Model the first delete landing before the second one fails.
    if (key === STORAGE_KEY) {
      storage.setItem = (restoreKey, value) => {
        if (restoreKey === STORAGE_KEY) throw new Error("decision rollback refused");
        originalSet(restoreKey, value);
      };
      return originalSet(STORAGE_KEY, "[]");
    }
  };

  const result = eraseWorkspace(storage, { now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.code, "erase_incomplete");
  assert.equal(result.message, OUTCOME.erase_incomplete);
  assert.notDeepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), [DECISION]);
});

test("a declined browser refuses record writes; an undecided one does not", () => {
  const storage = storageOf();
  // Nobody has been asked, so the stores behave exactly as they did before this
  // page existed.
  assert.doesNotThrow(() => saveDecisions(storage, [DECISION]));
  assert.doesNotThrow(() => saveReleases(storage, [RELEASE]));

  setRetention(storage, RETENTION.declined, { now: NOW });
  assert.equal(retentionDeclined(storage), true);
  for (const write of [() => saveDecisions(storage, []), () => saveReleases(storage, [])]) {
    assert.throws(write, (error) => error.code === "retention_declined");
  }
  // Refused, not silently dropped: what was already stored is still there.
  assert.equal(readWorkspace(storage, { now: NOW }).records.total, 2);
});

/* --------------------------------- the page -------------------------------- */

async function open(seed = {}) {
  const page = await loadPage(PAGE, { storage: seed });
  await importPageModule("/local-workspace-page.js");
  await waitFor(
    () => page.document.querySelector("#ws-panel").getAttribute("aria-busy") === "false",
    "the workspace panel never finished reading storage",
  );
  return page;
}

const shown = (document, id) => textOf(document.querySelector(`#${id}`));

test("the page ships a readable loading state before any module runs", async () => {
  const document = (await loadPage(PAGE)).document;

  assert.equal(document.querySelector("#ws-panel").getAttribute("aria-busy"), "true");
  assert.match(shown(document, "ws-summary"), /Reading this browser's stored records/);
  // The privacy boundary is static markup: it does not wait for a script.
  assert.match(shown(document, "ws-boundary-title"), /stays in this browser/);
  assert.match(shown(document, "ws-boundary-body"), /no cookie, analytics call, or telemetry/);
});

test("a populated browser renders both chips as words, not as colours", async () => {
  const { document, restore } = await open({
    [STORAGE_KEY]: JSON.stringify([DECISION]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([RELEASE]),
  });
  try {
    const chips = document.querySelector("#ws-facts").querySelectorAll(".ws-chip");
    assert.deepEqual(chips.map((chip) => textOf(chip)), ["Retaining", "Verified"]);
    // The tone is an attribute the stylesheet reads; the meaning is in the text.
    assert.deepEqual(chips.map((chip) => chip.dataset.tone), ["on", "verified"]);
    assert.match(shown(document, "ws-facts"), /1 decision · 1 release/);
    assert.match(shown(document, "ws-next-title"), /Download a JSON backup/);
  } finally {
    restore();
  }
});

test("the page names one next action, and the reader can reach every control by keyboard", async () => {
  const { document, restore } = await open({ [STORAGE_KEY]: JSON.stringify([DECISION]) });
  try {
    assert.equal(document.querySelector("#ws-next").querySelectorAll(".ws-next-action").length, 1);

    // Walked as the real tab sequence, narrowed to the content region: the
    // header and footer stops are the site's, asserted in their own suites.
    const labels = tabSequence(document)
      .filter((stop) => stop.closest("#main-content"))
      // The scrollable contract preview is named by its id rather than by the
      // JSON inside it: it is a tab stop because it scrolls, and a keyboard
      // reader who cannot focus it cannot read it.
      .map((stop) => (stop.tagName === "PRE" ? stop.id : textOf(stop) || stop.id));
    // Reading order: the one action first, then the ordinary controls, then the
    // disclosures. Nothing reachable sits above the action it is subordinate to.
    // The disclosure summaries are stops in their own right — a <summary> is
    // focusable because it is a summary, and the browser owns that — so they
    // appear here at the DOM position they are reached from.
    // The FinOps flow follows the whole Shiplog surface rather than interleaving
    // with it — it is a second store with a second question, and its own stops
    // are asserted in tests/finops-workspace-flow.test.js.
    assert.deepEqual(labels, [
      "Download JSON backup",
      "Stop keeping new records in this browser",
      "Download JSON backup",
      "ws-restore-file",
      "Erase local records",
      "Where these numbers come from",
      "Inspect every retained field and sample value",
      "finops-preview-json",
      "Remember these figures in this browser",
      "Remember these figures in this browser",
      "Keep using files only",
      "fw-import",
      "Review what this browser is keeping — nothing, right now",
    ]);
  } finally {
    restore();
  }
});

test("erase asks first, names what it will take, and cancelling changes nothing", async () => {
  const page = await open({
    [STORAGE_KEY]: JSON.stringify([DECISION]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([RELEASE]),
  });
  const { document } = page;
  try {
    const erase = document.querySelector("#ws-erase");
    const confirm = document.querySelector("#ws-confirm");
    assert.equal(confirm.hidden, true);
    assert.equal(erase.getAttribute("aria-expanded"), "false");

    await erase.dispatchEvent(new DomEvent("click", { bubbles: true }));
    assert.equal(confirm.hidden, false);
    assert.equal(erase.getAttribute("aria-expanded"), "true");
    // Focus moves into the region a reader has to answer, not past it.
    assert.equal(document.activeElement, document.querySelector("#ws-confirm-title"));
    // The commit button counts what is actually at stake.
    assert.equal(shown(document, "ws-confirm-yes"), "Erase 1 decision and 1 release");
    assert.match(shown(document, "ws-confirm-warning"), /cannot be recovered here/);

    await document.querySelector("#ws-confirm-no").dispatchEvent(new DomEvent("click", { bubbles: true }));
    assert.equal(confirm.hidden, true);
    // Focus returns to the control that was pressed, never to the top of the page.
    assert.equal(document.activeElement, erase);
    assert.match(shown(document, "ws-announcement"), /Erase cancelled\. Nothing in this browser was changed\./);
    assert.equal(JSON.parse(page.storage.getItem(STORAGE_KEY)).length, 1);
  } finally {
    page.restore();
  }
});

test("confirming the erase empties both stores and announces the new state", async () => {
  const page = await open({
    [STORAGE_KEY]: JSON.stringify([DECISION]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([RELEASE]),
  });
  const { document } = page;
  try {
    await document.querySelector("#ws-erase").dispatchEvent(new DomEvent("click", { bubbles: true }));
    await document.querySelector("#ws-confirm-yes").dispatchEvent(new DomEvent("click", { bubbles: true }));

    assert.equal(shown(document, "ws-announcement"), OUTCOME.erased);
    assert.equal(shown(document, "ws-outcome"), OUTCOME.erased);
    assert.equal(document.querySelector("#ws-outcome").hidden, false);
    // The erased state is drawn, not merely announced.
    assert.match(shown(document, "ws-summary"), /0 decisions and 0 releases/);
    assert.equal(textOf(document.querySelector("#ws-facts").querySelector(".ws-chip")), "Retaining · nothing stored");
    assert.equal(document.querySelector("#ws-erase").disabled, true);
    // The reader lands on the answer, not on a control whose label just changed.
    assert.equal(document.activeElement, document.querySelector("#ws-next-title"));
    assert.deepEqual(
      [page.storage.getItem(STORAGE_KEY), page.storage.getItem(RELEASE_STORAGE_KEY)],
      [null, null],
    );
  } finally {
    page.restore();
  }
});

test("turning retention off is one press, is reflected in the control, and stops new writes", async () => {
  const page = await open({ [STORAGE_KEY]: JSON.stringify([DECISION]) });
  const { document } = page;
  try {
    const toggle = document.querySelector("#ws-retention");
    assert.equal(toggle.getAttribute("aria-pressed"), "true");

    await toggle.dispatchEvent(new DomEvent("click", { bubbles: true }));

    assert.equal(toggle.getAttribute("aria-pressed"), "false");
    assert.equal(textOf(toggle), "Keep new records in this browser");
    assert.match(shown(document, "ws-announcement"), /Records already stored here were not erased/);
    assert.equal(textOf(document.querySelector("#ws-facts").querySelector(".ws-chip")), "Not retaining");
    assert.match(shown(document, "ws-retention-note"), /^Off\./);
    // The control governs the store rather than describing it.
    assert.throws(() => saveDecisions(page.storage, []), (error) => error.code === "retention_declined");
  } finally {
    page.restore();
  }
});

test("a browser with nothing stored draws the empty state and disables what it cannot do", async () => {
  const { document, restore } = await open();
  try {
    assert.match(shown(document, "ws-next-title"), /Record your first decision/);
    assert.equal(document.querySelector("#ws-next-action").getAttribute("href"), "/#decision-form");
    assert.equal(document.querySelector("#ws-export").disabled, true);
    assert.equal(document.querySelector("#ws-erase").disabled, true);
  } finally {
    restore();
  }
});

test("unreadable stored text is drawn as unreadable, and the action is restore", async () => {
  const { document, restore } = await open({ [STORAGE_KEY]: "{ truncated" });
  try {
    const chips = document.querySelector("#ws-facts").querySelectorAll(".ws-chip");
    assert.deepEqual(chips.map((chip) => textOf(chip)), ["Stored text unreadable", "Partial"]);
    assert.match(shown(document, "ws-next-title"), /Restore from a JSON backup/);
    // Erase stays available, but it is not what the page asks for first.
    assert.equal(document.querySelector("#ws-erase").disabled, false);
  } finally {
    restore();
  }
});

test("a backup downloads the stored records and is recorded as taken", async () => {
  const page = await open({ [STORAGE_KEY]: JSON.stringify([DECISION]) });
  const { document } = page;
  try {
    await document.querySelector("#ws-export").dispatchEvent(new DomEvent("click", { bubbles: true }));

    assert.equal(page.downloads.length, 1);
    assert.match(page.downloads[0].filename, /^shiplog-history-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/);
    assert.equal(shown(document, "ws-announcement"), OUTCOME.exported);
    const rows = document.querySelector("#ws-provenance-list").querySelectorAll(".ws-fact");
    const backupRow = rows.find((row) => textOf(row.querySelector("dt")) === "Last backup");
    assert.ok(backupRow, "provenance has no Last backup row");
    assert.match(textOf(backupRow.querySelector("dd")), /A backup was downloaded from this page on/);
  } finally {
    page.restore();
  }
});

test("restoring reads the file in this browser and stores nothing until it is confirmed", async () => {
  const page = await open();
  const { document } = page;
  try {
    const input = document.querySelector("#ws-restore-file");
    input.files = [{
      text: async () => JSON.stringify({
        schema: "shiplog-history",
        version: 1,
        generatedAt: "2026-07-25T09:00:00.000Z",
        decisions: [DECISION],
        releases: [RELEASE],
      }),
    }];
    await input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(
      () => document.querySelector("#ws-restore-plan").hidden === false,
      "the restore summary never appeared",
    );

    // Read, summarized, and still not stored.
    assert.match(shown(document, "ws-restore-headline"), /Found 1 decision and 1 release in this file/);
    assert.match(shown(document, "ws-outcome"), /Nothing is stored until you confirm/);
    assert.equal(page.storage.getItem(STORAGE_KEY), null);
    assert.equal(document.activeElement, document.querySelector("#ws-restore-headline"));

    await document.querySelector("#ws-restore-commit").dispatchEvent(new DomEvent("click", { bubbles: true }));

    assert.equal(JSON.parse(page.storage.getItem(STORAGE_KEY)).length, 1);
    assert.match(shown(document, "ws-announcement"), /Records restored into this browser/);
    assert.match(shown(document, "ws-summary"), /1 decision and 1 release/);
  } finally {
    page.restore();
  }
});

test("a file that is not a backup is refused, and says so without changing anything", async () => {
  const page = await open({ [STORAGE_KEY]: JSON.stringify([DECISION]) });
  const { document } = page;
  try {
    const input = document.querySelector("#ws-restore-file");
    input.files = [{ text: async () => "{ not json" }];
    await input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(
      () => textOf(document.querySelector("#ws-outcome")).length > 0,
      "the rejected file was never reported",
    );

    assert.match(shown(document, "ws-outcome"), /Your stored records were not changed/);
    assert.equal(document.querySelector("#ws-restore-plan").hidden, true);
    assert.equal(JSON.parse(page.storage.getItem(STORAGE_KEY)).length, 1);
  } finally {
    page.restore();
  }
});
