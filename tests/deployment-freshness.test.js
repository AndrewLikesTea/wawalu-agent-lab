import test from "node:test";
import assert from "node:assert/strict";
import { initDeploymentStatus } from "../src/deployment-status-view.js";
import { loadPage, textOf } from "./support/browser.js";

const first = "2026-08-06T12:00:00.000Z";
const second = "2026-08-07T13:01:02.000Z";
const release = { id: "real", version: "v1", createdAt: first };

for (const surface of ["index", "releases"]) {
  test(`${surface}: freshness, copy parity, repeat and failed checks`, async (t) => {
    const page = await loadPage(new URL(`../src/${surface}.html`, import.meta.url));
    t.after(() => page.restore());
    const doc = page.document;
    const get = (id) => doc.querySelector(`#deployment-${id}`);
    let instant = first;
    let clockReads = 0;
    let copied;
    const options = {
      release, now: () => { clockReads++; return instant; },
      clipboard: { writeText: async (value) => { copied = value; } },
    };
    const check = (readHealth) => initDeploymentStatus(doc, { ...options, readHealth });
    const assertSuccess = (expectedInstant, version) => {
      assert.equal(get("status").dataset.checkState, "success");
      const line = get("checked-at");
      assert.equal(line.hidden, false);
      assert.equal(get("verdict").getAttribute("aria-describedby"), line.id);
      assert.equal(line.parentNode, get("verdict").parentNode);
      assert.equal(line.querySelector("time").getAttribute("datetime"), expectedInstant);
      const format = new Intl.DateTimeFormat(undefined, {
        year: "numeric", month: "short", day: "numeric", hour: "numeric",
        minute: "2-digit", second: "2-digit", timeZoneName: "short",
      });
      const displayed = textOf(line);
      assert.equal(displayed, `Deployment checked at: ${format.format(new Date(expectedInstant))}`);
      const zone = format.formatToParts(new Date(expectedInstant)).find((part) => part.type === "timeZoneName");
      assert.ok(zone?.value);
      assert.ok(displayed.includes(zone.value));
      assert.equal(get("copy").dataset.copyText,
        `Deployment check verdict: ${textOf(get("verdict"))}\nRunning build version: ${version}. Deployment record version: v1.\n${displayed}\nCopied from: https://labs.wawalu.org/`);
    };
    await check(async () => ({ status: "ok", build: "v1" }));
    assertSuccess(first, "v1");
    get("copy").click();
    await Promise.resolve();
    assert.equal(copied, get("copy").dataset.copyText);
    let resolve;
    const pending = check(() => new Promise((done) => { resolve = done; }));
    assert.equal(get("status").dataset.checkState, "loading");
    assert.equal(get("checked-at").hidden, true);
    assert.equal(textOf(get("checked-at")), "");
    assert.equal(get("copy").disabled, true);
    assert.equal(get("copy").dataset.copyText, "");
    assert.equal(textOf(get("evidence-body")), "");
    assert.equal(clockReads, 1, "the clock is sampled on completion, not request start");
    instant = second;
    resolve({ status: "ok", build: "v2" });
    await pending;
    assert.equal(clockReads, 2);
    assertSuccess(second, "v2");
    await check(async () => { throw new Error("offline"); });
    assert.equal(get("status").dataset.checkState, "failure");
    assert.equal(get("checked-at").hidden, true);
    assert.equal(textOf(get("checked-at")), "");
    assert.ok(!textOf(get("evidence-body")).includes("Checked at"));
    assert.ok(!get("copy").dataset.copyText.includes("Deployment checked at:"));

    let older;
    const stale = check(() => new Promise((done) => { older = done; }));
    await check(async () => ({ status: "ok", build: "v2" }));
    older({ status: "ok", build: "v1" });
    await stale;
    assertSuccess(second, "v2");
  });
}
