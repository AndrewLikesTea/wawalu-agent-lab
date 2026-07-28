// The home page's proof path, walked the way a visitor walks it.
//
// tests/demo-path.test.js proves the data resolves and that each detail page
// renders when its URL is loaded directly. This file proves the *route between
// them*: every hop starts from an href read out of the rendered DOM of the
// previous page, never from a literal repeated in the test. A story card that
// silently points at an id the seed no longer carries fails here, where reading
// the markup for a hard-coded href would still pass.
//
// No network at all: loadPage throws on any request, so reaching the release
// page from the home page proves it happened without one.

import test from "node:test";
import assert from "node:assert/strict";

import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { initDecisionDetail } from "../src/decision-page.js";
import { initReleaseDetail } from "../src/release-page.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { EXAMPLE_LABEL, SAMPLE_DECISION_ID, SAMPLE_RELEASE_ID } from "../src/seed-records.js";
import { loadPage, textOf } from "./support/browser.js";

const PAGES = {
  "/index.html": new URL("../src/index.html", import.meta.url),
  "/decision.html": new URL("../src/decision.html", import.meta.url),
  "/release.html": new URL("../src/release.html", import.meta.url),
};

// A release this visitor recorded. Dated after every example so it sorts to the
// front of the composed log — the position the sample release panel used to
// feature blindly.
const OWN_RELEASE = {
  id: "own-r-2-0-0",
  version: "v2.0.0",
  title: "Our own launch",
  description: "A release this visitor recorded in their own browser.",
  status: "completed",
  owner: "Devi",
  createdAt: "2099-01-01T00:00:00.000Z",
  decisionIds: [],
};

// One hop. Splits an href the way a browser does, resolves the path against the
// shipped page it names, and stands that page up with the query string intact.
// An href pointing anywhere this site does not serve fails loudly rather than
// quietly loading the wrong file.
async function follow(href, { storage = {} } = {}) {
  const [path, search = ""] = String(href).split("?");
  const pageUrl = PAGES[path === "/" ? "/index.html" : path];
  assert.ok(pageUrl, `the rendered page linked to ${href}, which this site does not serve`);
  return loadPage(pageUrl, { storage, location: { search: search ? `?${search}` : "" } });
}

const linkNamed = (root, label) => root.querySelectorAll("a")
  .find((link) => textOf(link).startsWith(label));

async function openHome(t, { decisions = [], releases = [] } = {}) {
  const page = await loadPage(PAGES["/index.html"], {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage);
  return page;
}

test("the home page's sample decision link opens a fully populated decision", async (t) => {
  const home = await openHome(t);
  const link = linkNamed(home.document, "Open the sample decision");
  assert.ok(link, "the rendered home page must offer the sample decision");
  const href = link.getAttribute("href");
  home.restore();

  const page = await follow(href);
  t.after(() => page.restore());
  await initDecisionDetail();

  const detail = page.document.querySelector("#decision-detail");
  const rendered = textOf(detail);
  assert.equal(detail.getAttribute("aria-busy"), "false");
  assert.equal(detail.querySelectorAll(".detail-state-loading").length, 0,
    "the link landed on a page that never left its loading state");

  // The five things a reader followed the link for.
  assert.match(rendered, /Adopt a durable job queue/);          // title
  assert.match(rendered, /accepted/);                            // status
  assert.match(rendered, /Kai/);                                 // owner
  assert.match(rendered, /Background work was lost on deploys/); // context and reasoning
  assert.ok(linkNamed(detail, "Throughput and latency")
    ?? detail.querySelectorAll("a").some((a) => a.getAttribute("href")?.includes("/release.html")),
  "the decision must name the release it reached");              // linked release

  // And it says what it is, for a reader who arrived here without seeing a list.
  assert.ok(rendered.includes(EXAMPLE_LABEL), "the decision page must label the record as an example");
});

test("the release that decision links to lists the decision back", async (t) => {
  const home = await openHome(t);
  const decisionHref = linkNamed(home.document, "Open the sample decision").getAttribute("href");
  home.restore();

  const decisionPage = await follow(decisionHref);
  await initDecisionDetail();
  const releaseHref = decisionPage.document.querySelector("#decision-detail")
    .querySelectorAll("a")
    .map((link) => link.getAttribute("href"))
    .find((candidate) => candidate?.startsWith("/release.html"));
  assert.ok(releaseHref, "the decision page must link on to its release");
  decisionPage.restore();

  const releasePage = await follow(releaseHref);
  t.after(() => releasePage.restore());
  initReleaseDetail();

  const detail = releasePage.document.querySelector("#release-detail");
  const rendered = textOf(detail);
  assert.equal(detail.getAttribute("aria-busy"), "false");
  assert.equal(detail.querySelectorAll(".list-state-loading").length, 0,
    "the release link landed on a page that never left its loading state");
  assert.match(rendered, /v1\.3\.0/);
  assert.match(rendered, /Adopt a durable job queue/, "the release must list the decision that reached it");
  assert.ok(rendered.includes(EXAMPLE_LABEL), "the release page must label the record as an example");

  // The association is the point: both ids are the ones the seed agrees on, so
  // renaming one without the other breaks this test rather than the site.
  assert.ok(decisionHref.endsWith(SAMPLE_DECISION_ID));
  assert.ok(releaseHref.endsWith(SAMPLE_RELEASE_ID));
});

test("the representative release panel features the release the story names", async (t) => {
  const home = await openHome(t);
  const panel = home.document.querySelector("#sample-release-list");

  assert.equal(panel.getAttribute("aria-busy"), "false");
  assert.equal(panel.querySelectorAll(".list-state-loading").length, 0, "the panel stayed on its loading state");
  assert.equal(panel.querySelectorAll(".release-item").length, 1, "the panel features exactly one release");
  assert.match(textOf(panel), /Throughput and latency/);
  assert.ok(textOf(panel).includes(EXAMPLE_LABEL), "the featured release must be labelled as an example");

  // The panel, the story card, and the hero proof all name one release.
  const detailHref = panel.querySelectorAll("a")
    .map((link) => link.getAttribute("href"))
    .find((href) => href?.startsWith("/release.html"));
  assert.equal(detailHref, `/release.html?id=${SAMPLE_RELEASE_ID}`);
  const storyHref = linkNamed(home.document, "Open the sample release")?.getAttribute("href");
  assert.equal(storyHref, detailHref);
});

test("a release the visitor recorded is never featured as the representative example", async (t) => {
  const home = await openHome(t, { releases: [OWN_RELEASE] });
  const panel = home.document.querySelector("#sample-release-list");
  const rendered = textOf(panel);

  // Their release is the newest in the log, so it leads the history — but this
  // panel says "Representative release", and their record is not one.
  assert.doesNotMatch(rendered, /Our own launch/);
  assert.doesNotMatch(rendered, /Devi/);
  assert.match(rendered, /Throughput and latency/);
  assert.ok(rendered.includes(EXAMPLE_LABEL));

  // The visitor's release is still in the log itself, and carries no label.
  const own = home.document.querySelector("#decision-list").querySelectorAll(".history-card")
    .find((card) => textOf(card).includes("Our own launch"));
  assert.ok(own, "the visitor's release must still appear in the history");
  assert.doesNotMatch(textOf(own), new RegExp(EXAMPLE_LABEL));
});
