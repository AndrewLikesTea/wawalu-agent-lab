import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadActivity, EVENTS_URLS, SOURCE_REPOSITORIES } from "../src/agents.js";
import { BUILD_STAMP } from "../src/build-stamp.js";
import { loadPage, textOf, tabSequence } from "./support/browser.js";

const pageUrl = new URL("../src/agents.html", import.meta.url);
const stamp = "2026-11-08T12:00:00.000Z";
const event = { type: "PullRequestEvent", created_at: stamp,
  payload: { action: "closed", pull_request: { merged: true, number: 7 } } };
const ok = (payload) => ({ ok: true, headers: { get: () => stamp }, json: async () => payload });

test("success exposes the filtered count and reproducible provenance on the shipped surface", async (t) => {
  const page = await loadPage(pageUrl);
  t.after(() => page.restore());
  const { document } = page;
  await loadActivity(document, async (url) => ok(url === EVENTS_URLS[0]
    ? [event, { ...event, persona: "Synthetic" }] : [event]), page.storage);
  const figure = document.querySelector("#merged-figure");
  const source = document.querySelector("#merged-figure-source");
  const copy = textOf(source);
  assert.equal(figure.dataset.state, "live");
  assert.equal(textOf(document.querySelector(".merged-figure-count")), "2");
  for (const repo of SOURCE_REPOSITORIES) assert.ok(copy.includes(repo));
  assert.match(copy, /Checked/);
  assert.equal(source.querySelector("time").dateTime, stamp);
  assert.match(copy, /at most the preceding 90 days/);
  assert.match(copy, /may provide less complete history/);
  assert.match(copy, /not an all-time total/);
  assert.match(copy, /30 most recent combined events/);
  assert.match(copy, /excludes specific hard-coded synthetic records/);
  assert.doesNotMatch(copy, /No fixed calendar window|all (?:qualifying |returned )?events (?:were |are )?counted/i);
  assert.equal(figure.getAttribute("aria-describedby"), source.id);
  const links = source.querySelectorAll("a");
  const rules = `/blob/${BUILD_STAMP.commitSha ?? "main"}/src/`;
  assert.ok(links.some((link) => link.href.endsWith(`${rules}agents.js`) && /exclusion.*liveGithubEvents/.test(textOf(link))));
  assert.ok(links.some((link) => link.href.endsWith(`${rules}public-merges.js`) && /filtering rules/.test(textOf(link))));
  for (const [index, link] of figure.querySelector(".merged-figure-sources").querySelectorAll("a").entries()) {
    assert.equal(link.href, EVENTS_URLS[index]);
    assert.ok(textOf(link).includes(SOURCE_REPOSITORIES[index]));
    assert.match(textOf(link), /merged pull requests.*public GitHub event feed/);
  }
  for (const link of links) assert.ok(tabSequence(document).includes(link));
});

for (const [name, second] of [
  ["partial HTTP failure", { ok: false, status: 503 }],
  ["malformed repository payload", ok({ message: "missing" })],
  ["malformed event", ok([null])],
  ["undated event", ok([{ ...event, created_at: null }])],
]) {
  test(`${name} cannot publish a partial count`, async (t) => {
    const page = await loadPage(pageUrl);
    t.after(() => page.restore());
    await loadActivity(page.document, async (url) => url === EVENTS_URLS[0] ? ok([event]) : second, page.storage);
    assert.equal(page.document.querySelector("#merged-figure").dataset.state, "unavailable");
    assert.equal(page.document.querySelector(".merged-figure-count"), null);
    assert.doesNotMatch(textOf(page.document.querySelector("#merged-figure-readout")), /Checked|verified|\d/i);
  });
}

test("audit text wraps without responsive hiding", async () => {
  const css = await readFile(new URL("../src/agents.css", import.meta.url), "utf8");
  assert.match(css, /\.merged-figure\s*\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/);
  assert.doesNotMatch(css, /\.merged-figure(?:-source|-sources|-time)?\s*\{[^}]*(?:display:none|visibility:hidden)/);
});
