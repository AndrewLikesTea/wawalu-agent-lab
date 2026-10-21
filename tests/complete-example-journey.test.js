import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const root = process.env.SHIPLOG_E2E_BUILD_ROOT || "src";
const asset = (name) => new URL(`../${root}/${name}`, import.meta.url);
const { initReleaseDetail } = await import(asset("release-page.js"));
const { initDecisionDetail } = await import(asset("decision-page.js"));
const { initDecisionLog, STORAGE_KEY } = await import(asset("app.js"));
const { RELEASE_STORAGE_KEY } = await import(asset("releases.js"));
const { SAMPLE_RELEASE_ID, SAMPLE_DECISION_ID } = await import(asset("seed-records.js"));

function follow(page, link) {
  assert.ok(link, "route is visible");
  assert.ok(tabSequence(page.document).includes(link), "route is keyboard accessible");
  link.focus();
  pressEnter(page.document);
  return new URL(page.navigations.at(-1), "https://labs.wawalu.org");
}

function forbidStorage(page) {
  for (const method of ["getItem", "setItem", "removeItem", "clear"]) {
    page.storage[method] = () => assert.fail(`Example route accessed storage: ${method}`);
  }
}

test("hero opens the complete invented release, its decision, and the recorder without saving", async () => {
  let page = await loadPage(asset("index.html"));
  let releaseUrl;
  try {
    const actions = page.document.querySelector(".hero-actions").querySelectorAll("a");
    assert.equal(actions[0].id, "core-demo-link");
    assert.match(textOf(actions[1]), /complete example release/i);
    releaseUrl = follow(page, actions[1]);
    assert.equal(releaseUrl.searchParams.get("id"), SAMPLE_RELEASE_ID);
    assert.equal(releaseUrl.searchParams.get("example"), "1");
  } finally { page.restore(); }

  // Repeat fresh loads to cover reload/direct entry, including same-id records
  // that must never replace or mislabel the bundled example.
  for (const storage of [{}, {
    [STORAGE_KEY]: JSON.stringify([{ id: SAMPLE_DECISION_ID, title: "Private decision" }]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([{ id: SAMPLE_RELEASE_ID, title: "Private release" }]),
  }]) {
    page = await loadPage(asset("release.html"), { storage, location: { search: releaseUrl.search } });
    let decisionUrl;
    try {
      forbidStorage(page);
      initReleaseDetail();
      const detail = page.document.querySelector("#release-detail");
      assert.equal(detail.getAttribute("aria-busy"), "false");
      assert.match(textOf(detail), /Throughput and latency/);
      assert.match(textOf(detail), /Invented examples only.*no customer or production data/);
      assert.doesNotMatch(textOf(detail), /Private release/);
      assert.ok(detail.querySelectorAll("a").some(a => a.getAttribute("href") === "/#title"));
      decisionUrl = follow(page, detail.querySelectorAll("a").find(a =>
        a.getAttribute("href") === `/decision.html?id=${SAMPLE_DECISION_ID}&example=1`));
    } finally { page.restore(); }

    page = await loadPage(asset("decision.html"), { storage, location: { search: decisionUrl.search } });
    try {
      forbidStorage(page);
      await initDecisionDetail();
      const detail = page.document.querySelector("#decision-detail");
      assert.match(textOf(detail), /Adopt a durable job queue/);
      assert.match(textOf(detail), /Managed durable queue/);
      assert.match(textOf(detail), /Invented examples only.*no customer or production data/);
      assert.equal(detail.getAttribute("aria-busy"), "false");
      const back = detail.querySelectorAll("a").find(a => a.getAttribute("href") === "/#title");
      assert.equal(follow(page, back).hash, "#title");
    } finally { page.restore(); }
  }
  page = await loadPage(asset("index.html"), { location: { hash: "#title" } });
  try {
    for (const method of ["setItem", "removeItem", "clear"]) {
      page.storage[method] = () => assert.fail(`Returning saved data: ${method}`);
    }
    await initDecisionLog();
    assert.equal(page.document.activeElement.id, "title");
    assert.equal(page.document.querySelector("#title").value, "");
  } finally { page.restore(); }
});
