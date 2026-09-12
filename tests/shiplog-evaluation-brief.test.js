import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bindShiplogEvaluationBrief, buildShiplogEvaluationBrief, BRIEF_FOLLOW_UP_SENTENCE, BRIEF_FOLLOW_UP_URL,
} from "../src/shiplog-evaluation-brief.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";
import { loadPage, textOf, pressEnter, pressTab, tabSequence } from "./support/browser.js";

const page = new URL("../src/index.html", import.meta.url);
const url = "https://preview.example/index.html?review=procurement#top";
const settle = () => new Promise((resolve) => setImmediate(resolve));
// `npm run test:e2e:production` points this at dist, so the link targets are
// checked on the tree that ships as well as on the source.
const BUILD_ROOT = process.env.SHIPLOG_E2E_BUILD_ROOT || "src";
const built = (file) => new URL(`../${BUILD_ROOT}/${file}`, import.meta.url);
const addresses = (text) => text.match(/https?:\/\/\S+/g) ?? [];
const within = (node, ancestor) => {
  for (let current = node; current; current = current.parentNode) if (current === ancestor) return true;
  return false;
};

async function open(t, clipboard) {
  const home = await loadPage(page);
  t.after(() => home.restore());
  // The lightweight DOM models focus but not native textarea selection.
  home.document.getElementById("shiplog-evaluation-brief-manual").select = function () { this.selected = true; };
  bindShiplogEvaluationBrief(home.document, clipboard, { href: url });
  return home.document;
}

test("homepage renders the complete product brief between its explanation and AI FinOps", async (t) => {
  const doc = await open(t, {});
  const brief = doc.getElementById("shiplog-evaluation-brief");
  assert.equal(brief.getAttribute("aria-labelledby"), "shiplog-evaluation-brief-title");
  assert.equal(textOf(brief.querySelector("h2")), "Shiplog evaluation brief");
  const text = textOf(brief);
  for (const wording of [
    "without reconstructing decisions from chat history",
    "context, alternatives, and owner", "links it to the release it shaped",
    "Decisions and releases you add stay in this browser; they are not shared hosted records.",
    "Availability and pricing are provided on request.",
    "invented, use no customer or production data, and are not customer results",
    "manager or procurement stakeholder",
  ]) assert.ok(text.includes(wording), wording);
  const link = brief.querySelector("a");
  assert.equal(link.getAttribute("href"), "/releases.html#shipped-build");
  const releases = await loadPage(new URL("../src/releases.html", import.meta.url));
  t.after(() => releases.restore());
  assert.match(textOf(releases.document.getElementById("shipped-build")), /Real record of this deployment/);
  const html = await readFile(page, "utf8");
  assert.ok(html.indexOf('id="top"') < html.indexOf('id="shiplog-evaluation-brief"'));
  assert.ok(html.indexOf('id="shiplog-evaluation-brief"') < html.indexOf('id="additional-capability"'));
  assert.match(html, /<script type="module" src="\/shiplog-evaluation-brief.js"><\/script>/);
  // The manual-copy box ships hidden, so it is no tab stop above the coach entry.
  assert.equal(doc.getElementById("shiplog-evaluation-brief-fallback").hidden, true);
});

// #2299: a forwarded brief said pricing was "provided on request" and never
// said where. Every address in it is production's, whatever page copied it.
test("the brief says where to ask, with production addresses even when copied from localhost", () => {
  const payload = buildShiplogEvaluationBrief({
    paragraphs: ["Shiplog evaluation brief", "Availability and pricing are provided on request."],
    recordHref: "/releases.html#shipped-build",
    pageHref: "http://localhost:8788/?status=accepted#record-history",
  });
  assert.ok(payload.includes(`${BRIEF_FOLLOW_UP_SENTENCE} ${BRIEF_FOLLOW_UP_URL}`));
  assert.deepEqual(addresses(payload), [
    "https://labs.wawalu.org/releases.html#shipped-build",
    "https://labs.wawalu.org/#site-footer-panel",
    "https://labs.wawalu.org/?status=accepted#record-history",
  ]);
  for (const address of addresses(payload)) assert.match(address, /^https:\/\/labs\.wawalu\.org\//);
  assert.match(BRIEF_FOLLOW_UP_SENTENCE, /availability and pricing/);
  for (const claim of [/\bwithin\b/i, /\bhours?\b/i, /business day/i, /\bcustomers\b/i, /\$/, /\bpilot\b/i]) {
    assert.doesNotMatch(payload, claim);
  }
});

test("keyboard copy includes every rendered paragraph, verification link and current URL, then confirms success", async (t) => {
  const copied = [];
  let complete;
  const doc = await open(t, { writeText: (text) => { copied.push(text); return new Promise((resolve) => { complete = resolve; }); } });
  const button = doc.getElementById("copy-shiplog-evaluation-brief");
  const status = doc.getElementById("shiplog-evaluation-brief-status");
  assert.ok(tabSequence(doc).includes(button));
  button.focus();
  pressEnter(doc);
  assert.equal(textOf(status), "");
  complete();
  await settle();
  const paragraphs = doc.getElementById("shiplog-evaluation-brief-text").querySelectorAll("h2, p")
    .map((node) => textOf(node).replace(/\s+/g, " ").trim());
  assert.equal(paragraphs.length, 4);
  assert.deepEqual(copied, [[...paragraphs,
    "Verification: https://labs.wawalu.org/releases.html#shipped-build",
    `${BRIEF_FOLLOW_UP_SENTENCE} https://labs.wawalu.org/#site-footer-panel`,
    "Page: https://labs.wawalu.org/index.html?review=procurement#top"].join("\n\n")]);
  assert.equal(textOf(status), "Shiplog evaluation brief and page link copied.");
  assert.equal(status.hidden, false);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(doc.getElementById("shiplog-evaluation-brief-fallback").hidden, true);
});

// An impatient buyer presses twice. Whatever the LAST press did is what the
// status line has to say: a slow first copy landing after a refused second one
// would report success for a clipboard that is still empty.
test("a slow first press cannot report success over a later refusal", async (t) => {
  const presses = [];
  const doc = await open(t, { writeText: () => new Promise((resolve, reject) => presses.push({ resolve, reject })) });
  const button = doc.getElementById("copy-shiplog-evaluation-brief");
  const status = doc.getElementById("shiplog-evaluation-brief-status");
  button.click();
  button.click();
  assert.equal(presses.length, 2);
  presses[1].reject(new Error("denied"));
  await settle();
  presses[0].resolve();
  await settle();
  await settle();
  assert.match(textOf(status), /^Could not copy/);
  assert.equal(doc.getElementById("shiplog-evaluation-brief-fallback").hidden, false);
});

// Sasha's brief travels into someone else's evaluation, where nobody can check
// it against the page. Claim SHAPES, not a word list: the brief honestly says
// "no customer or production data", so "customer" alone cannot be the trigger.
const UNSUPPORTED_CLAIMS = [
  /\d\s*%/, /\b\d+x\b/i, /\bsav(e|es|ed|ing|ings)\b/i, /\btrusted by\b/i,
  /\b(faster|fastest|quicker|cheaper)\b/i, /\b(hundreds|thousands|millions) of\b/i,
  /\b(industry[- ]leading|best[- ]in[- ]class|proven results)\b/i,
  /\b\d+\s+(customers|teams|companies|engineers)\b/i,
  /\bcustomers\s+(use|trust|report|say|ship)\b/i,
];

test("the copied brief carries its own boundaries and claims nothing it cannot show", async (t) => {
  let copied = "";
  const doc = await open(t, { writeText: async (text) => { copied = text; } });
  doc.getElementById("copy-shiplog-evaluation-brief").click();
  await settle();
  for (const wording of [
    "Decisions and releases you add stay in this browser; they are not shared hosted records.",
    "Availability and pricing are provided on request.",
    "The example decisions and releases are invented",
    "use no customer or production data",
    "are not customer results",
    "Verification: https://labs.wawalu.org/releases.html#shipped-build",
  ]) assert.ok(copied.includes(wording), wording);
  // One word for the example records on every homepage surface (#2284): the
  // opening section says "invented", so a pasted brief may not say "synthetic".
  assert.equal(copied.split("invented").length - 1, 1);
  assert.doesNotMatch(copied, /synthetic/i);
  for (const claim of UNSUPPORTED_CLAIMS) assert.doesNotMatch(copied, claim);
  for (const claim of [/\bwithin\b/i, /\bhours?\b/i, /business day/i, /\bcustomers\b/i, /\$/]) {
    assert.doesNotMatch(copied, claim);
  }
});

for (const [name, clipboard] of [
  ["unavailable", () => ({})],
  ["denied", (copied) => ({ writeText: async (text) => { copied.push(text); throw new Error("denied"); } })],
]) test(`clipboard ${name} fills the manual-copy box with the exact brief the clipboard gets`, async (t) => {
  const copied = [];
  const doc = await open(t, clipboard(copied));
  const button = doc.getElementById("copy-shiplog-evaluation-brief");
  button.focus();
  pressEnter(doc);
  await settle();
  const status = doc.getElementById("shiplog-evaluation-brief-status");
  assert.match(textOf(status), /^Could not copy.*manually.*text box below.*page URL/);
  assert.equal(status.hidden, false);
  const manual = doc.getElementById("shiplog-evaluation-brief-manual");
  assert.equal(doc.getElementById("shiplog-evaluation-brief-fallback").hidden, false);
  assert.equal(manual.hasAttribute("readonly"), true);
  assert.equal(doc.activeElement.getAttribute("id"), "shiplog-evaluation-brief-manual");
  assert.equal(manual.selected, true);
  assert.equal(textOf(doc.querySelector('[for="shiplog-evaluation-brief-manual"]')), "Shiplog evaluation brief for manual copying");
  if (copied.length) assert.equal(manual.value, copied[0]);
  for (const text of [manual.value, ...copied]) {
    assert.ok(text.includes(`${BRIEF_FOLLOW_UP_SENTENCE} ${BRIEF_FOLLOW_UP_URL}`));
    assert.ok(text.includes("Verification: https://labs.wawalu.org/releases.html#shipped-build"));
  }
});

// The follow-up address has to land a stranger on a form that asks Wawalu
// about Shiplog. Told apart from the AI FinOps example form by purpose and
// topic, never by wording.
test("the follow-up address opens the homepage's Shiplog follow-up form, and Tab reaches its email then submit", async (t) => {
  const target = new URL(BRIEF_FOLLOW_UP_URL);
  assert.equal(target.pathname, "/");
  const home = await loadPage(built("index.html"));
  t.after(() => home.restore());
  const doc = home.document;
  const panel = doc.getElementById(target.hash.slice(1));
  assert.ok(panel, `${target.hash} must name an element in the authored page`);
  const forms = panel.querySelectorAll("form");
  assert.equal(forms.length, 1);
  const purpose = forms[0].getAttribute("data-follow-up-type");
  assert.equal(purpose, "follow_up_homepage");
  assert.equal(forms[0].getAttribute("data-follow-up-topic"), FOLLOW_UP_TOPICS[purpose]);
  assert.notEqual(forms[0].getAttribute("id"), "finops-example-follow-up-form");
  for (let node = forms[0]; node?.tagName; node = node.parentNode) {
    assert.ok(!(node.tagName === "DETAILS" && !node.open), "the form may not sit in a closed details element");
    assert.ok(!node.hidden, `${node.getAttribute("id") ?? node.tagName} hides the form`);
  }

  // A fragment sets the sequential focus starting point at the panel, so the
  // first Tab lands on the first stop inside it.
  const sequence = tabSequence(doc);
  const first = sequence.findIndex((node) => within(node, panel));
  assert.ok(first > 0);
  sequence[first - 1].focus();
  const email = pressTab(doc);
  assert.equal(email.getAttribute("id"), "site-footer-email");
  assert.equal(email.getAttribute("type"), "email");
  assert.ok(within(email, forms[0]));
  const submit = pressTab(doc);
  assert.equal(submit.getAttribute("type"), "submit");
  assert.equal(textOf(submit), "Request a follow-up");
  assert.ok(within(submit, forms[0]));
});

test("the deployment address resolves to the record the brief links, on a page that exists", async (t) => {
  const home = await loadPage(built("index.html"));
  t.after(() => home.restore());
  const recordHref = home.document.getElementById("shiplog-evaluation-brief-text").querySelector("a").getAttribute("href");
  const payload = buildShiplogEvaluationBrief({ paragraphs: [], recordHref, pageHref: "/" });
  const deployment = new URL(payload.match(/^Verification: (\S+)$/m)[1]);
  assert.equal(deployment.origin, "https://labs.wawalu.org");
  const releases = await loadPage(built(deployment.pathname.slice(1)));
  t.after(() => releases.restore());
  const record = releases.document.getElementById(deployment.hash.slice(1));
  assert.ok(record, `${deployment.hash} must exist on ${deployment.pathname}`);
  assert.match(textOf(record), /Real record of this deployment/);
});
