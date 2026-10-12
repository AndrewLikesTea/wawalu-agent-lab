// The finished demo's walkthrough summary on Releases (#2793).
//
// The builder is held as a pure function; the page is driven through the
// recorders a visitor uses — the decision form on Home, then the release form
// on Releases — and read back as text, attributes and what the clipboard got.

import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY, initDecisionLog } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { initReleaseDiscussion } from "../src/releases-discussion.js";
import {
  WALKTHROUGH_COPY_MESSAGES,
  WALKTHROUGH_SUMMARY_TITLE,
  copyWalkthroughSummary,
  walkthroughSummary,
} from "../src/demo-walkthrough-summary.js";
import { DomEvent, loadPage, pressSpace, textOf, typeText } from "./support/browser.js";

const HOME_PAGE = new URL("../src/index.html", import.meta.url);
const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const NO_SEED = { decisions: [], releases: [] };

const ENTRY = {
  title: "Adopt a <b>durable</b> job queue",
  context: "Background work was lost on deploys.",
  alternatives: "Database polling.",
  owner: "Tess",
  status: "accepted",
};

const DECISION = { id: "d-queue", ...ENTRY };
const RELEASE = { id: "r-1", version: "v1.3.0", decisionIds: ["d-queue"] };

// --- the builder ---------------------------------------------------------------

test("the summary states the exact records, the link and their provenance", () => {
  const summary = walkthroughSummary(DECISION, RELEASE);
  assert.ok(summary);
  const { text } = summary;
  assert.equal(text.split("\n")[0], WALKTHROUGH_SUMMARY_TITLE);
  assert.equal(text, [WALKTHROUGH_SUMMARY_TITLE, ...summary.lines].join("\n"));
  for (const fact of [ENTRY.title, "owner Tess", "status accepted", "Release: v1.3.0."]) {
    assert.ok(text.includes(fact), `the summary does not state ${fact}`);
  }
  assert.ok(text.includes(`Release v1.3.0 links to the decision “${ENTRY.title}”.`));
  assert.ok(text.includes("browser-local demo records created in this browser"));
  assert.ok(text.includes("not customer results or production evidence"));
});

test("the legacy status is read as the word a visitor sees", () => {
  const { text } = walkthroughSummary({ ...DECISION, status: "approved" }, RELEASE);
  assert.ok(text.includes("status accepted"));
});

test("missing or unlinked records produce no summary", () => {
  assert.equal(walkthroughSummary(null, RELEASE), null);
  assert.equal(walkthroughSummary(DECISION, null), null);
  assert.equal(walkthroughSummary(DECISION, { ...RELEASE, decisionIds: [] }), null);
  assert.equal(walkthroughSummary(DECISION, { ...RELEASE, decisionIds: ["d-other"] }), null);
  assert.equal(walkthroughSummary(DECISION, { id: "r-1", version: "v1.3.0" }), null);
  assert.equal(walkthroughSummary({ ...DECISION, id: "" }, RELEASE), null);
});

test("copying reports a missing or refusing clipboard", async () => {
  assert.equal(await copyWalkthroughSummary("x", undefined), WALKTHROUGH_COPY_MESSAGES.unavailable);
  assert.equal(await copyWalkthroughSummary("x", {}), WALKTHROUGH_COPY_MESSAGES.unavailable);
  const refusing = { writeText: async () => { throw new Error("denied"); } };
  assert.equal(await copyWalkthroughSummary("x", refusing), WALKTHROUGH_COPY_MESSAGES.failed);
});

// --- the page --------------------------------------------------------------------

const byId = (page, id) => {
  const node = page.document.querySelector(`#${id}`);
  assert.ok(node, `no #${id}`);
  return node;
};

function typeInto(page, id, value) {
  const control = byId(page, id);
  control.focus();
  control.value = "";
  typeText(page.document, value);
}

// Step one, on Home: the decision form. Returns the storage it left behind.
async function recordDecisionOnHome() {
  const page = await loadPage(HOME_PAGE, { storage: { [STORAGE_KEY]: "[]", [RELEASE_STORAGE_KEY]: "[]" } });
  try {
    await initDecisionLog(page.document, page.storage, {
      seed: NO_SEED,
      location: { pathname: "/", search: "", hash: "" },
      history: { replaceState() {} },
    });
    for (const [field, value] of Object.entries(ENTRY)) {
      if (field === "status") byId(page, field).value = value;
      else typeInto(page, field, value);
    }
    byId(page, "decision-form").querySelector('button[type="submit"]').click();
    const decisions = page.storage.getItem(STORAGE_KEY);
    assert.equal(JSON.parse(decisions).length, 1, "the decision was not recorded");
    return decisions;
  } finally {
    page.restore();
  }
}

// Step two: arriving on Releases with that decision.
async function openReleases(t, decisions, { clipboard } = {}) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: decisions, [RELEASE_STORAGE_KEY]: "[]" },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    seed: NO_SEED,
    location: { pathname: "/releases.html", search: "", hash: "" },
    history: { replaceState() {} },
    readHealth: async () => { throw new Error("no network in tests"); },
    clipboard,
  });
  assert.equal(page.document.documentElement.dataset.shiplogReleases, "ready");
  return page;
}

// Step three: record a release, linking the decision or not.
function recordRelease(page, { link }) {
  typeInto(page, "release-version", "v1.3.0");
  typeInto(page, "release-owner", "Tess");
  typeInto(page, "release-released-on", "2026-05-20");
  typeInto(page, "release-description", "The queue work, shipped.");
  if (link) {
    const check = page.document.querySelectorAll(".decision-picker-check")
      .find((node) => node.getAttribute("value") === link);
    assert.ok(check, `no picker option for ${link}`);
    check.focus();
    pressSpace(page.document);
  }
  byId(page, "release-form").querySelector('button[type="submit"]').click();
}

// Counted rather than compared: no completion control may be reachable.
function assertNoCompletion(page, when) {
  assert.equal(byId(page, "demo-summary").hidden, true, `${when}: the summary is shown`);
  assert.equal(byId(page, "demo-summary-lines").children.length, 0, `${when}: summary lines were painted`);
  assert.equal(textOf(byId(page, "demo-summary-status")), "", `${when}: the status line speaks`);
}

const storedDecision = (page) => JSON.parse(page.storage.getItem(STORAGE_KEY))[0];
const storedRelease = (page) => JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY))[0];
const paintedLines = (page) => byId(page, "demo-summary-lines").children.map((node) => textOf(node));

test("the summary appears only once a release links the recorded decision", async (t) => {
  const empty = await openReleases(t, "[]");
  assertNoCompletion(empty, "nothing recorded");

  const decisions = await recordDecisionOnHome();
  const page = await openReleases(t, decisions);
  assertNoCompletion(page, "decision recorded, page arrived at");

  const decision = storedDecision(page);
  recordRelease(page, { link: decision.id });
  const release = storedRelease(page);
  assert.deepEqual(release.decisionIds, [decision.id]);

  const region = byId(page, "demo-summary");
  assert.equal(region.hidden, false);
  assert.equal(textOf(byId(page, "demo-summary-title")), "Your walkthrough summary");
  assert.deepEqual(paintedLines(page), walkthroughSummary(decision, release).lines);
  // The user's title arrives as text, markup and all, not as an element.
  assert.ok(paintedLines(page)[0].includes(ENTRY.title));
  assert.equal(byId(page, "demo-summary-lines").querySelectorAll("b").length, 0);
  // The guide's own step text still stands above it.
  assert.equal(byId(page, "evaluation-path-steps").querySelectorAll("li").length, 4);
  assert.equal(textOf(byId(page, "demo-summary-status")), WALKTHROUGH_COPY_MESSAGES.ready);
  assert.equal(byId(page, "demo-summary-copy").getAttribute("type"), "button");
});

test("a release that does not link the decision finishes nothing", async (t) => {
  const page = await openReleases(t, await recordDecisionOnHome());
  recordRelease(page, { link: null });
  assert.equal(JSON.parse(page.storage.getItem(RELEASE_STORAGE_KEY)).length, 1);
  assertNoCompletion(page, "unlinked release");
});

// Stored the way the recorders store them, so the store's own read accepts them.
const STORED_DECISION = { ...DECISION, createdAt: "2026-05-02T09:00:00.000Z" };
const STORED_RELEASE = {
  ...RELEASE,
  title: "Throughput and latency",
  description: "The queue work, shipped.",
  owner: "Tess",
  status: "completed",
  releasedOn: "2026-05-20",
  createdAt: "2026-05-20T09:00:00.000Z",
};

async function reopenReleases(t, release) {
  const page = await loadPage(RELEASES_PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify([STORED_DECISION]),
      [RELEASE_STORAGE_KEY]: JSON.stringify([release]),
    },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    seed: NO_SEED,
    location: { pathname: "/releases.html", search: "", hash: "" },
    history: { replaceState() {} },
    readHealth: async () => { throw new Error("no network in tests"); },
  });
  return page;
}

test("a reload of a finished demo restores the summary without announcing it", async (t) => {
  const page = await reopenReleases(t, STORED_RELEASE);
  assert.equal(byId(page, "demo-summary").hidden, false);
  assert.deepEqual(paintedLines(page), walkthroughSummary(STORED_DECISION, STORED_RELEASE).lines);
  assert.equal(textOf(byId(page, "demo-summary-status")), "");
});

test("a reload after the link was removed shows no summary", async (t) => {
  const page = await reopenReleases(t, { ...STORED_RELEASE, decisionIds: [] });
  assertNoCompletion(page, "reloaded with the link removed");
});

test("the copy control writes the painted summary, and says when it cannot", async (t) => {
  const writes = [];
  let refuse = false;
  const clipboard = {
    async writeText(value) {
      if (refuse) throw new Error("denied");
      writes.push(value);
    },
  };
  const page = await openReleases(t, await recordDecisionOnHome(), { clipboard });
  recordRelease(page, { link: storedDecision(page).id });
  const expected = walkthroughSummary(storedDecision(page), storedRelease(page)).text;

  byId(page, "demo-summary-copy").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [expected]);
  assert.deepEqual(expected.split("\n").slice(1), paintedLines(page));
  assert.equal(textOf(byId(page, "demo-summary-status")), WALKTHROUGH_COPY_MESSAGES.copied);

  refuse = true;
  byId(page, "demo-summary-copy").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(textOf(byId(page, "demo-summary-status")), WALKTHROUGH_COPY_MESSAGES.failed);
  assert.equal(byId(page, "demo-summary").hidden, false, "the summary must stay up to be selected by hand");
  assert.equal(byId(page, "demo-summary-status").getAttribute("aria-live"), "polite");
});

test("the pilot route selects the existing pilot topic and lands on it", async (t) => {
  const page = await openReleases(t, await recordDecisionOnHome());
  recordRelease(page, { link: storedDecision(page).id });
  const view = {
    Event: DomEvent,
    location: { hash: "" },
    history: { state: null, replaceState() {} },
    addEventListener() {},
  };
  initReleaseDiscussion(page.document, view);

  const pilot = byId(page, "demo-summary-pilot");
  assert.equal(pilot.getAttribute("type"), "button");
  assert.equal(pilot.getAttribute("data-target"), "#site-footer-intent-pilot");
  pilot.click();
  const radios = page.document.querySelectorAll('input[name="intent"]');
  const chosen = radios.filter((radio) => radio.checked);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].value, "pilot");
  assert.ok(radios.map((radio) => radio.getAttribute("value")).includes(chosen[0].value));
  assert.equal(page.document.activeElement === byId(page, "site-footer-intent-pilot"), true);
});
