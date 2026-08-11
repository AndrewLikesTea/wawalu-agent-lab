import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectExecutiveBriefing } from "../src/executive-briefing-projection.js";
import { renderPayloadBriefing, renderPayloadState, validatePayload } from "../src/executive-payload-briefing-view.js";
import { executivePayloadHref, readExecutivePayloadFragment } from "../src/executive-payload-share.js";
import { installDocument } from "./support/dom.js";

installDocument();
const createDocument = () => globalThis.document;

const fixture = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8")).briefingReadiness;
const payload = () => projectExecutiveBriefing(structuredClone(fixture), {
  clock: () => new Date("2026-08-01T12:34:56.000Z"),
});

test("renders the decision-ready payload in leadership reading order", () => {
  const doc = createDocument();
  const article = renderPayloadBriefing(doc, payload());
  const text = article.textContent;
  const ordered = [
    "Where should we act first?", "Atlas Platform is the first intervention priority",
    "Material benchmark or trend", "Prioritized next action", "Why it matters", "Confidence",
    "Selected period", "Generated", "Department evidence", "Audit appendix — internal identifiers",
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(text.indexOf(ordered[index - 1]) < text.indexOf(ordered[index]), ordered[index]);
  }
  assert.equal(article.querySelectorAll("details").length, 2);
  // Array.from, not NodeList.filter: the harness returns an array, a browser
  // does not, and a test that only runs on the double proves nothing here.
  assert.equal(Array.from(article.querySelectorAll("details"))
    .filter((node) => node.getAttribute("open") != null).length, 0);
  assert.doesNotMatch(JSON.stringify(payload()), /providerRows|promptContent|credential|customerData/);
});

test("internal identifiers render only inside the closed audit appendix", () => {
  const built = payload();
  const article = renderPayloadBriefing(createDocument(), built);
  const appendix = Array.from(article.querySelectorAll("details")).at(-1);
  assert.equal(appendix.getAttribute("open"), null);
  assert.match(appendix.textContent, /executive-briefing\/1\.0\.0/);
  const visible = article.children.filter((node) => node !== appendix)
    .map((node) => node.textContent).join(" ");
  for (const identifier of Object.values(built.auditAppendix).slice(1)) {
    assert.equal(visible.includes(identifier), false, identifier);
  }
  assert.match(article.querySelector(".payload-signoff").textContent,
    /claims the finding, comparison, next action, confidence, and source period.*2026-08-01T12:34:56\.000Z/);
});

test("the share fragment restores the exact payload without regenerating claims or time", () => {
  const initial = payload();
  const href = executivePayloadHref(initial);
  const restored = readExecutivePayloadFragment(new URL(href, "https://labs.wawalu.org").hash);
  assert.deepEqual(restored, initial);
  assert.equal(renderPayloadBriefing(createDocument(), restored).textContent,
    renderPayloadBriefing(createDocument(), initial).textContent);
});

test("why-it-matters explains the answer instead of restating it", () => {
  const built = payload();
  const why = renderPayloadBriefing(createDocument(), built)
    .querySelector(".payload-why").textContent;
  for (const restated of [built.headlineAnswer, built.materialBenchmarkOrTrend, built.prioritizedNextAction]) {
    assert.ok(!why.includes(restated), restated);
  }
  // The bundled fixture carries one row today and is expected to grow more.
  assert.match(why, /Consolidated from 1 department signal,/);
  const plural = { ...built, departmentEvidence: [...built.departmentEvidence, ...built.departmentEvidence] };
  assert.match(renderPayloadBriefing(createDocument(), plural).querySelector(".payload-why").textContent,
    /Consolidated from 2 department signals,/);
});

test("malformed payloads are rejected before any decision figure renders", () => {
  const malformed = { ...payload(), confidence: { level: "High" }, departmentEvidence: [] };
  assert.deepEqual(validatePayload(malformed), ["confidence", "departmentEvidence"]);
  assert.throws(() => renderPayloadBriefing(createDocument(), malformed), /Malformed executive briefing payload/);
});

test("error state is announced, focusable, and offers a keyboard-operable recovery link", () => {
  const state = renderPayloadState(createDocument(), "error", "The briefing is unavailable", "No figures are shown.");
  assert.equal(state.getAttribute("role"), "alert");
  assert.equal(state.getAttribute("tabindex"), "-1");
  assert.equal(state.querySelector("a").getAttribute("href"), "/evolution.html#briefing-readiness");
});

test("the live workspace offers the printable briefing only when a payload is ready", async () => {
  const [workspace, workspaceCss, wiring] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.css", import.meta.url), "utf8"),
    readFile(new URL("../src/executive-briefing-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /class="briefing-projection-open"><a [^>]*href="\/executive-briefing\.html\?payload=bundled"/);
  assert.match(workspaceCss,
    /\.briefing-projection:not\(\[data-state="ready"\]\) \.briefing-projection-open \{ display:none; \}/);
  assert.match(wiring, /get\("payload"\) === "bundled"/);
  assert.match(wiring, /projectExecutiveBriefing\(data\?\.briefingReadiness\)/);
});

test("the payload stylesheet prints the hierarchy without disclosures and reaches nothing shared", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../src/executive-briefing.html", import.meta.url), "utf8"),
    readFile(new URL("../src/executive-payload-briefing.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id="executive-briefing" role="region"/);
  assert.match(css, /@media print \{[\s\S]*\.payload-disclosure \{ display:none !important; \}/);
  // This file loads on every visit to the page, including the workspace,
  // sample, and example sheets. A shared hook or a redefined custom property
  // here repaints all three; every selector must stay inside .payload-.
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const shared of [":root", ".brief-", ".briefing-", "#executive-briefing", "#payload-briefing"]) {
    assert.ok(!selectors.includes(shared), `payload stylesheet must not reach ${shared}`);
  }
});
