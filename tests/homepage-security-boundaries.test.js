// The homepage's security and data-boundary section, and the plain text a
// reviewer forwards from it.
//
// What this file is actually holding: that the rendered section and the copied
// text make the SAME claims, that the claims are the ones the product charter
// and the shipped storage behaviour support, and that the copy control tells
// the truth when the clipboard refuses. Every assertion about wording compares
// the markup with the exported constant rather than a second literal, so a
// reworded boundary fails until both surfaces carry it.
//
// The harness does not run a page's module scripts, so the copy control is
// drawn by an explicit bind here — which is also the assertion that the section
// itself needs no script: every boundary below is read off the parsed document.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  bindSecurityBoundaries,
  buildSecurityBoundaryText,
  DEMO_BOUNDARIES,
  DEMO_BOUNDARY_LEAD,
  SECURITY_BOUNDARY_IDS,
  SECURITY_BOUNDARY_LEAD,
  SECURITY_BOUNDARY_PAGE,
  SECURITY_BOUNDARY_TEXT,
  SECURITY_BOUNDARY_TITLE,
  SECURITY_COPY_DONE,
  SECURITY_COPY_FAILED,
  SECURITY_COPY_LABEL,
  SECURITY_EVIDENCE,
  SECURITY_EVIDENCE_LEAD,
  STORAGE_DISTINCTION,
} from "../src/security-boundaries.js";
import { HEALTH_URL } from "../src/deployment-status-view.js";
import { REPOSITORY_URL } from "../src/repository-url.js";
import { SHIPLOG_ORIGIN } from "../src/shiplog-evaluation-brief.js";
import { loadPage, parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const read = () => readFile(PAGE, "utf8");

// Claims nobody can check from outside: certifications, cryptography, a
// retention regime, or a deployment of the reader's own. The section states
// that it makes none of them, so the word "certification" appears in it once,
// as a denial; the pattern below is written to catch the affirmative forms.
const UNSUPPORTABLE = /encrypt|SOC ?2|ISO ?27001|bank.level|enterprise.grade|compliant|compliance|certified|audited|penetration|retention policy|on.premise|single.tenant/i;

const section = (document) => document.getElementById(SECURITY_BOUNDARY_IDS.section);

async function openHome(t, clipboard) {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  assert.equal(bindSecurityBoundaries(page.document, clipboard), true,
    "the section must offer somewhere to draw its copy control");
  return page.document;
}

/* --------------------------- the rendered section ------------------------- */

test("the section is titled plainly and names all five demo boundaries", async () => {
  const document = parseHtml(await read());
  const block = section(document);
  assert.ok(block, "the home page must carry a security and data-boundary section");
  // h2, like every other top-level section on this page: the heading level that
  // keeps the outline of the page correct.
  assert.equal(block.querySelectorAll("h2").length, 1);
  assert.equal(textOf(document.getElementById(SECURITY_BOUNDARY_IDS.title)), SECURITY_BOUNDARY_TITLE);
  assert.equal(block.getAttribute("aria-labelledby"), SECURITY_BOUNDARY_IDS.title);
  assert.equal(block.querySelectorAll("h3").length, 0, "the section needs no sub-headings");

  const lists = block.querySelectorAll("ul");
  assert.equal(lists.length, 2, "one list of boundaries, one list of evidence");
  const boundaries = lists[0].querySelectorAll("li").map(textOf);
  assert.deepEqual(boundaries, [...DEMO_BOUNDARIES]);
  assert.equal(boundaries.length, 5);
  assert.equal(textOf(document.getElementById("security-boundaries-demo")), DEMO_BOUNDARY_LEAD);
  assert.equal(lists[0].getAttribute("aria-labelledby"), "security-boundaries-demo");

  // The five nouns the charter names, each present in the rendered text rather
  // than only in a constant a reader never sees.
  const rendered = textOf(block);
  for (const noun of ["customer data", "production databases", "Cookies", "Credentials", "Internal APIs"]) {
    assert.ok(rendered.includes(noun), `the section must name ${noun}`);
  }
  assert.doesNotMatch(rendered, UNSUPPORTABLE);
});

test("the storage distinction says browser-local records and public durable posts", async () => {
  const document = parseHtml(await read());
  const paragraphs = section(document).querySelectorAll("p").map(textOf);
  assert.deepEqual(paragraphs,
    [SECURITY_BOUNDARY_LEAD, DEMO_BOUNDARY_LEAD, ...STORAGE_DISTINCTION, SECURITY_EVIDENCE_LEAD],
    "the rendered prose must be the exported constants, in order, and nothing else");

  const [local, published] = STORAGE_DISTINCTION;
  assert.match(local, /stay in this browser/);
  assert.match(published, /public posts API/);
  assert.match(published, /anyone who visits Shiplog can read it/);
  assert.match(published, /cannot be edited or deleted after publishing/);
  // The sentence this section exists to get right: a published post is public
  // and durable, so it is never described as private, local, or removable by
  // clearing a browser. Both readings are denied outright rather than left for
  // a reader to infer from the paragraph above.
  assert.ok(published.includes("is not private, is not browser-only"),
    "the published-post sentence must deny both readings outright");
  assert.doesNotMatch(published, /stay(s)? in this browser|only in this browser|your own browser|per.browser|removed? (it|them) by clearing/i,
    "a published post may never be described as browser-only");
  assert.doesNotMatch(published, /\bcan (edit|delete)\b|\bdelete your post\b/i,
    "published posts are durable: nothing may promise removal");
  // And the browser-only promise stays attached to records, not to posts.
  assert.doesNotMatch(local, /Social|post/i);
});

test("both evidence links render, labelled as independently inspectable", async () => {
  const document = parseHtml(await read());
  const block = section(document);
  const links = block.querySelectorAll("a");
  assert.equal(links.length, 2, "two pieces of evidence, and no third address");
  assert.equal(textOf(document.getElementById("security-boundaries-evidence")), SECURITY_EVIDENCE_LEAD);
  assert.match(SECURITY_EVIDENCE_LEAD, /inspected independently/);

  assert.deepEqual(links.map((link) => link.getAttribute("href")), SECURITY_EVIDENCE.map((item) => item.href));
  assert.deepEqual(links.map(textOf), SECURITY_EVIDENCE.map((item) => item.label));
  assert.deepEqual(links.map((link) => link.id), SECURITY_EVIDENCE.map((item) => item.id));

  // Composed from the addresses the rest of the site already publishes, not
  // retyped: the repository constant and the health path every module reads.
  assert.equal(SECURITY_EVIDENCE[0].href, `${REPOSITORY_URL}/blob/main/PRODUCT.md`);
  assert.equal(SECURITY_EVIDENCE[1].href, `${SHIPLOG_ORIGIN}${HEALTH_URL}`);
  assert.equal(HEALTH_URL, "/healthz");
  // The charter file is the one the repository actually ships, so the link is
  // not a promise about a path that does not exist.
  assert.match(await readFile(new URL("../PRODUCT.md", import.meta.url), "utf8"),
    /No Wawalu production database, cookies, credentials, or internal APIs\./);

  // The repository ROOT address stays published once inside this page's main
  // region, by the deployment check; this section links the charter instead.
  assert.equal(block.querySelectorAll(`a[href="${REPOSITORY_URL}"]`).length, 0);
});

test("the section sits with what a reviewer forwards, above the form that asks for an email", async () => {
  const html = await read();
  const at = (needle) => html.indexOf(needle);
  // The evaluation cluster: the brief, the blank scorecard, the counts from
  // this browser, and now the boundaries. The demonstration and pilot routes
  // near the top of the page already send a reader here.
  assert.ok(at('id="shiplog-pilot-scorecard"') < at('id="security-boundaries"'),
    "the boundaries join the blocks a buyer forwards, rather than interrupting the demo");
  assert.ok(at('id="security-boundaries"') < at('id="additional-capability"'),
    "and they are read before the site's second capability, not after everything else");
  assert.ok(at('id="ask-about-shiplog"') < at('id="security-boundaries"'));
  assert.ok(at('id="security-boundaries"') < at('id="site-footer-panel"'),
    "a reader meets the boundaries before the form that asks for an email");
  assert.match(html, /<script type="module" src="\/security-boundaries.js"><\/script>/);
  // The follow-up form is email-only by design (#2593): this section adds no
  // topic control and no second form.
  assert.equal(section(parseHtml(html)).querySelectorAll("input,select,textarea,form").length, 0);
});

/* ------------------------------ the copy text ----------------------------- */

test("the copied text carries the same claims and the same evidence links as the section", () => {
  assert.equal(buildSecurityBoundaryText(), SECURITY_BOUNDARY_TEXT);
  const blocks = SECURITY_BOUNDARY_TEXT.split("\n\n");
  assert.equal(blocks[0], SECURITY_BOUNDARY_TITLE);
  assert.equal(blocks[1], SECURITY_BOUNDARY_LEAD);
  assert.equal(blocks[2], [DEMO_BOUNDARY_LEAD, ...DEMO_BOUNDARIES.map((item) => `- ${item}`)].join("\n"));
  assert.deepEqual(blocks.slice(3, 5), [...STORAGE_DISTINCTION]);
  assert.equal(blocks[5], [SECURITY_EVIDENCE_LEAD,
    ...SECURITY_EVIDENCE.map((link) => `- ${link.label}: ${link.href}`)].join("\n"));
  assert.equal(blocks.at(-1), `Page: ${SECURITY_BOUNDARY_PAGE}`);
  assert.equal(SECURITY_BOUNDARY_PAGE, "https://labs.wawalu.org/");
  assert.doesNotMatch(SECURITY_BOUNDARY_TEXT, UNSUPPORTABLE);

  // A reworded boundary reaches the clipboard: the builder reads its inputs
  // rather than repeating them.
  const custom = buildSecurityBoundaryText({ boundaries: ["Only one thing"], evidence: [] });
  assert.ok(custom.includes("- Only one thing"));
  assert.ok(!custom.includes("- Cookies"));
});

test("the copied text is the section's own words, block for block", async (t) => {
  const document = await openHome(t, {});
  const block = section(document);
  const paragraphs = block.querySelectorAll("p").map(textOf);
  const boundaries = block.querySelectorAll("ul")[0].querySelectorAll("li").map(textOf);
  const evidence = block.querySelectorAll("a");
  // Rebuilt from what a reader sees, then compared with what a manager gets.
  const expected = [
    textOf(document.getElementById(SECURITY_BOUNDARY_IDS.title)),
    paragraphs[0],
    [paragraphs[1], ...boundaries.map((item) => `- ${item}`)].join("\n"),
    paragraphs[2],
    paragraphs[3],
    [paragraphs[4], ...evidence.map((link) => `- ${textOf(link)}: ${link.getAttribute("href")}`)].join("\n"),
    `Page: ${SECURITY_BOUNDARY_PAGE}`,
  ].join("\n\n");
  assert.equal(SECURITY_BOUNDARY_TEXT, expected);
});

/* ---------------------------- the copy control ---------------------------- */

test("the drawn control copies the boundaries and says so", async (t) => {
  const writes = [];
  let finish;
  const document = await openHome(t, {
    writeText: (text) => { writes.push(text); return new Promise((resolve) => { finish = resolve; }); },
  });
  const button = document.getElementById(SECURITY_BOUNDARY_IDS.button);
  const status = document.getElementById(SECURITY_BOUNDARY_IDS.status);
  assert.equal(textOf(button), SECURITY_COPY_LABEL);
  assert.equal(button.type, "button");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  assert.ok(tabSequence(document).includes(button), "a keyboard reader can reach the copy control");

  button.focus();
  pressEnter(document);
  assert.deepEqual(writes, [SECURITY_BOUNDARY_TEXT]);
  // Focus is kept while the write is in flight: the control is never disabled.
  assert.equal(document.activeElement, button);
  finish();
  await settle();
  assert.equal(textOf(status), SECURITY_COPY_DONE);
  assert.equal(document.getElementById(SECURITY_BOUNDARY_IDS.manual), null);
});

test("a refused clipboard says so, offers the text by hand, and claims no copy", async (t) => {
  const writes = [];
  const document = await openHome(t, {
    writeText: async (text) => { writes.push(text); throw new Error("Denied"); },
  });
  const button = document.getElementById(SECURITY_BOUNDARY_IDS.button);
  const status = document.getElementById(SECURITY_BOUNDARY_IDS.status);
  button.focus();
  pressEnter(document);
  await settle();

  assert.deepEqual(writes, [SECURITY_BOUNDARY_TEXT]);
  assert.equal(textOf(status), SECURITY_COPY_FAILED);
  assert.doesNotMatch(textOf(status), /copied/i, "a refused write may never read as a success");
  const manual = document.getElementById(SECURITY_BOUNDARY_IDS.manual);
  assert.equal(manual.value, SECURITY_BOUNDARY_TEXT, "the manual box holds exactly what the write attempted");
  assert.equal(manual.getAttribute("readonly"), "");
  assert.equal(document.querySelectorAll(`label[for="${SECURITY_BOUNDARY_IDS.manual}"]`).length, 1);
  assert.equal(document.activeElement, manual, "the reader is put in the box they now have to use");
});

test("a browser with no clipboard API is told, rather than left with a silent button", async (t) => {
  // An embedded view or an insecure origin: `navigator.clipboard` is there and
  // cannot write, which is the same empty clipboard as a rejected promise.
  const document = await openHome(t, {});
  const button = document.getElementById(SECURITY_BOUNDARY_IDS.button);
  button.focus();
  pressEnter(document);
  await settle();
  assert.equal(textOf(document.getElementById(SECURITY_BOUNDARY_IDS.status)), SECURITY_COPY_FAILED);
  assert.equal(document.getElementById(SECURITY_BOUNDARY_IDS.manual).value, SECURITY_BOUNDARY_TEXT);
});

test("a second press that succeeds withdraws the manual box the first failure drew", async (t) => {
  let refuse = true;
  const document = await openHome(t, {
    writeText: async () => { if (refuse) throw new Error("Denied"); },
  });
  const button = document.getElementById(SECURITY_BOUNDARY_IDS.button);
  button.focus();
  pressEnter(document);
  await settle();
  assert.equal(document.getElementById(SECURITY_BOUNDARY_IDS.manual).value, SECURITY_BOUNDARY_TEXT);

  refuse = false;
  button.focus();
  pressEnter(document);
  await settle();
  assert.equal(textOf(document.getElementById(SECURITY_BOUNDARY_IDS.status)), SECURITY_COPY_DONE);
  assert.equal(document.getElementById(SECURITY_BOUNDARY_IDS.manual), null,
    "a stale fallback beside a successful copy is two answers to one press");
});

test("nothing from the page, the visitor, or storage reaches the clipboard", async () => {
  const source = await readFile(new URL("../src/security-boundaries.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|location\.|fetch\(|querySelector/);
  assert.ok(!SECURITY_BOUNDARY_TEXT.includes("?"), "no query string can ride along in the page address");
});
