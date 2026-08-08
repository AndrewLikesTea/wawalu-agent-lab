// The ask sits where the figure is, and both mounts make one promise.
//
// The home page's opening section states the bundled example's headline result —
// 33% of analyzed AI spend is recoverable, $51,254 of $154,500. That is the
// moment a visitor decides they want to talk to someone, and until issue #1305
// the only way to say so was eight sections down in the footer. A jump link to
// that footer would not have fixed it: the ask has to be submittable where the
// conviction happens.
//
// So the home page mounts the follow-up component twice. This file pins the two
// properties that makes safe:
//
//   1. The mounts are separate instances, not two copies of one set of ids. Both
//      forms are on one page, so a shared id would break whichever one the
//      browser resolved second — and the structural tests that walk this page.
//   2. They make one promise, not two. Who replies and how soon is
//      FOLLOW_UP_RESPONSE in src/lead-capture.js, rendered above both buttons
//      and again on the receipt after a request lands. It is asserted against
//      the constant everywhere, so the two cannot drift apart in a diff.
//
// The window itself is not invented here. "Within two business days" is what the
// AI FinOps contact form has said since it shipped, and every follow-up form on
// this site posts the same `follow_up` label to the same queue.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, pressEnter, textOf, typeText } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FOLLOW_UP_PRIVACY, FOLLOW_UP_RESPONSE } from "../src/lead-capture.js";
import { heroFollowUpMarkup, HERO_INVITATION, INVITATION } from "../src/site-footer.js";

const INDEX = new URL("../src/index.html", import.meta.url);
const CTA = "Request a follow-up";
const TYPED_EMAIL = "director@example.com";

const byId = (document, id) => document.getElementById(id);

/** The opening section: everything before the decision summary below it. */
const heroOf = (html) =>
  html.slice(html.indexOf('<section class="hero'), html.indexOf('<section class="landing-decision"'));

/**
 * The home page with the footer entry wired the way the browser wires it — the
 * same script every page loads, which is what mounts both instances.
 */
async function openHomePage() {
  const page = await loadPage(INDEX);
  await importPageModule("/site-footer-page.js");
  return page;
}

/** Take over POST /api/leads, the way tests/site-footer.test.js does. */
function interceptLeads(reply) {
  const passthrough = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (url !== "/api/leads") return passthrough(url, options);
    calls.push({ url, options });
    return reply(calls.length);
  };
  return calls;
}

const jsonReply = (body, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

/** Type an address into one mount's field and submit it from the keyboard. */
function submitEmail(document, prefix, value) {
  const field = byId(document, `${prefix}-email`);
  field.value = "";
  field.focus();
  typeText(document, value);
  pressEnter(document);
  return waitFor(
    () => ["success", "error"].includes(byId(document, `${prefix}-form`).dataset.state),
    `the ${prefix} submission to settle`);
}

test("the opening section states the recoverable figure and carries a submittable follow-up form", async () => {
  const html = await readFile(INDEX, "utf8");
  const hero = heroOf(html);

  // The conviction. Pinned here so the ask cannot drift away from the figure it
  // was put beside — if the figure moves out of this section, this fails.
  assert.match(hero, /33% of analyzed AI spend is recoverable/,
    "the opening section no longer states the recoverable share");
  assert.match(hero, /\$51,254 of \$154,500/, "the opening section no longer states the two figures");

  // And the ask, in the same section, rendered from src/site-footer.js rather
  // than hand-written a second time.
  assert.ok(hero.includes(heroFollowUpMarkup()),
    "the hero mount has drifted from heroFollowUpMarkup() in src/site-footer.js");

  const page = await loadPage(INDEX);
  try {
    const { document } = page;
    const form = byId(document, "hero-follow-up-form");
    assert.ok(form, "the opening section carries no follow-up form");

    // Submittable here: a real form, a work-email field, and a submit control —
    // not a link to a form somewhere else. A jump link would satisfy none of
    // these three.
    assert.equal(form.tagName, "FORM");
    const field = byId(document, "hero-follow-up-email");
    assert.equal(field.getAttribute("type"), "email");
    assert.equal(field.getAttribute("name"), "email");
    const submit = form.querySelector('button[type="submit"]');
    assert.equal(textOf(submit), CTA, "the hero control must read the site's one follow-up label");

    // Reachable without opening anything. The footer's mount is behind a
    // disclosure that starts hidden; this one is the point of the change, so it
    // ships open and has no trigger to press first.
    assert.equal(byId(document, "hero-follow-up"), form.parentNode);
    assert.equal(byId(document, "hero-follow-up").hidden, false, "the hero mount must not start hidden");
    assert.equal(byId(document, "hero-follow-up-open"), null, "the hero mount must not sit behind a disclosure");

    // It really is inside the opening section, not merely earlier in the file.
    let section = form.parentNode;
    while (section && section.tagName !== "SECTION") section = section.parentNode;
    assert.equal(section?.id, "top", "the follow-up form is not inside the opening section");
  } finally {
    page.restore();
  }
});

test("the two mounts collide on nothing: every id the component owns is instance-scoped", async () => {
  const page = await loadPage(INDEX);
  try {
    const { document } = page;
    // The footer's mount is still whole and still separate.
    assert.ok(byId(document, "site-footer-form"), "the footer mount is gone");
    assert.ok(byId(document, "site-footer-open"), "the footer's disclosure is gone");

    // Every id the component derives from its prefix, on both mounts. A shared
    // id here is the failure this test exists for: getElementById resolves one
    // of the two, and the other silently stops being wired.
    const OWNED = ["form", "email", "note", "error", "status", "recovery"];
    for (const part of OWNED) {
      for (const prefix of ["site-footer", "hero-follow-up"]) {
        assert.ok(byId(document, `${prefix}-${part}`), `${prefix}-${part} does not render`);
      }
    }

    // Counted rather than assumed: two follow-up forms on this page, and the
    // field-note sign-up's address field beside them makes three email inputs.
    assert.equal(document.querySelectorAll('input[type="email"]').length, 3,
      "the home page carries the two follow-up fields and the field-note field");
    assert.equal(document.querySelectorAll('form[class="site-footer-form"]').length, 2,
      "the home page must mount the follow-up component exactly twice");

    // Every id in the shipped document is unique. The harness rejects the "*"
    // selector, so this walks the tree instead.
    const seen = new Map();
    const walk = (node) => {
      const id = node.getAttribute?.("id");
      if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
      for (const child of node.children ?? []) walk(child);
    };
    walk(document.body ?? document);
    const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    assert.deepEqual(duplicated, [], `the home page ships duplicate ids: ${duplicated.join(", ")}`);
  } finally {
    page.restore();
  }
});

test("both mounts render the identical who-replies sentence, and neither hedges it", async () => {
  const page = await loadPage(INDEX);
  try {
    const { document } = page;
    // Asserted against the shared constant, not against a fragment of it: a
    // substring match would pass on any prose that happened to contain the
    // words, which is how one promise becomes two.
    for (const id of ["site-footer", "hero-follow-up"]) {
      const invitation = byId(document, id).querySelector(".site-footer-invitation");
      assert.ok(invitation, `${id}: nothing above the button says who replies`);
      assert.ok(textOf(invitation).includes(FOLLOW_UP_RESPONSE),
        `${id}: the reply window has drifted from FOLLOW_UP_RESPONSE`);
      // And it is above the button, so a visitor weighs it before submitting.
      assert.ok(textOf(byId(document, id)).indexOf(FOLLOW_UP_RESPONSE)
        < textOf(byId(document, id)).lastIndexOf(CTA),
        `${id}: the promise reads after the control it should precede`);
    }
    // Both lead-ins end on the same sentence; only the context differs.
    assert.ok(INVITATION.endsWith(FOLLOW_UP_RESPONSE));
    assert.ok(HERO_INVITATION.endsWith(FOLLOW_UP_RESPONSE));

    // What the constant may and may not say. Specific words, a named team, a
    // countable window — no hedge, no tier, no invented individual, and no
    // 24-hour promise nobody has agreed to keep.
    assert.match(FOLLOW_UP_RESPONSE, /Wawalu team that operates Shiplog/, "it must name who replies");
    assert.match(FOLLOW_UP_RESPONSE, /within two business days/, "it must name a checkable window");
    for (const hedge of [/\bsoon\b/i, /shortly/i, /as soon as possible/i, /\basap\b/i, /24 hours/i,
      /\bhours?\b/i, /specialist/i, /account (?:manager|executive)/i, /\bSLA\b/i, /our team of \d/i]) {
      assert.doesNotMatch(FOLLOW_UP_RESPONSE, hedge, `the promise must not read: ${hedge}`);
    }
  } finally {
    page.restore();
  }
});

test("a request sent from the opening section lands, and the receipt repeats the same sentence", async () => {
  const page = await openHomePage();
  const passthrough = globalThis.fetch;
  const calls = interceptLeads(() => jsonReply({ created: true, purpose: "follow_up" }));
  try {
    const { document } = page;
    await submitEmail(document, "hero-follow-up", TYPED_EMAIL);
    assert.equal(byId(document, "hero-follow-up-form").dataset.state, "success");

    // The same transport and the same request body the footer's mount sends.
    assert.equal(calls.length, 1, "one submission must produce exactly one request");
    assert.equal(calls[0].url, "/api/leads");
    assert.deepEqual(JSON.parse(calls[0].options.body), { email: TYPED_EMAIL, purpose: "follow_up" });

    // The receipt, in this mount's own ids, restating the promise made above the
    // button — the same constant, not a second wording of it.
    const receipt = byId(document, "hero-follow-up-confirmation");
    assert.ok(receipt, "a landed request leaves no receipt in the opening section");
    assert.ok(textOf(receipt).includes(FOLLOW_UP_RESPONSE),
      "the receipt must repeat the reply window word for word");
    assert.ok(textOf(receipt).includes(TYPED_EMAIL), "the receipt must name the address that was sent");
    assert.ok(textOf(byId(document, "hero-follow-up-status")).includes(FOLLOW_UP_RESPONSE),
      "the live region must announce the same window");

    // And the footer's mount is untouched by any of it.
    assert.equal(byId(document, "site-footer-form").dataset.state, undefined,
      "submitting the hero's form must not change the footer's");
    assert.equal(byId(document, "site-footer-confirmation"), null);
  } finally {
    globalThis.fetch = passthrough;
    page.restore();
  }
});

test("the footer's own follow-up form still renders and still submits, unchanged", async () => {
  // Requirement five of the issue: the hero mount is an addition, not a move.
  const page = await openHomePage();
  const passthrough = globalThis.fetch;
  const calls = interceptLeads(() => jsonReply({ created: true, purpose: "follow_up" }));
  try {
    const { document } = page;

    // The disclosure still starts closed and still opens.
    const panel = byId(document, "site-footer-panel");
    assert.equal(panel.hidden, true, "the footer's form must still start behind its disclosure");
    byId(document, "site-footer-open").click();
    assert.equal(panel.hidden, false, "the footer's disclosure no longer opens");
    assert.equal(byId(document, "site-footer-open").getAttribute("aria-expanded"), "true");

    // Same field set as before: the work email, and nothing added beside it.
    const fields = byId(document, "site-footer-form").querySelectorAll("input");
    assert.equal(fields.length, 1, "the footer's field set must not have changed");
    assert.equal(fields[0].id, "site-footer-email");
    assert.equal(textOf(byId(document, "site-footer-note")), FOLLOW_UP_PRIVACY);

    // And the same success path.
    await submitEmail(document, "site-footer", TYPED_EMAIL);
    assert.equal(byId(document, "site-footer-form").dataset.state, "success");
    assert.deepEqual(JSON.parse(calls[0].options.body), { email: TYPED_EMAIL, purpose: "follow_up" });
    assert.ok(byId(document, "site-footer-confirmation"), "the footer's receipt must still appear");
  } finally {
    globalThis.fetch = passthrough;
    page.restore();
  }
});

test("every page that had the footer's form still has it, and only the home page has two", async () => {
  // The component is mounted twice on one page and once on the rest. A prefix
  // that leaked into the shared markup would show up here as a page that
  // suddenly carries a hero mount, or one that lost its footer form.
  const { readdir } = await import("node:fs/promises");
  const src = new URL("../src/", import.meta.url);
  const files = (await readdir(src)).filter((name) => name.endsWith(".html")).sort();
  let heroMounts = 0;

  for (const file of files) {
    const html = await readFile(new URL(file, src), "utf8");
    if (!html.includes('class="site-nav"')) continue;
    if (html.includes('id="hero-follow-up-form"')) heroMounts += 1;

    // The executive briefing is the one page whose footer points at a form of
    // its own instead of carrying the generic one; every other page keeps it.
    if (file === "executive-briefing.html") continue;
    assert.match(html, /id="site-footer-form"/, `${file} lost its footer follow-up form`);
    assert.ok(html.includes(FOLLOW_UP_RESPONSE), `${file} does not say who replies or how soon`);
  }

  assert.equal(heroMounts, 1, "the hero mount must be the home page's alone");
});

// The one place the module names the pages it renders for, kept honest above.
test("importing the footer entry wires both mounts without a second module", async () => {
  const source = await readFile(new URL("../src/site-footer-page.js", import.meta.url), "utf8");
  assert.match(source, /initFollowUpForm\(document, "hero-follow-up"\)/,
    "the shipped entry must mount the hero instance");
  assert.match(source, /initSiteFooter\(\)/, "the shipped entry must still mount the footer instance");
  // No new entry module: the hero's mount rides the script every page already
  // loads, so no page pays for a second file in its initial payload.
  const index = await readFile(INDEX, "utf8");
  assert.equal((index.match(/<script type="module" src="\/site-footer-page\.js"><\/script>/g) ?? []).length, 1,
    "the home page must load the footer entry exactly once");
});
