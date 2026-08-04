// "Which releases shipped this decision", answered on the history row (#1085).
//
// The association is the one Shiplog already stores — a release names the
// decisions it carried in `decisionIds` — read from the decision's side. Nothing
// here seeds a new field, fetches anything, or touches storage beyond the two
// keys the history page already reads.
//
// Three layers, matching how the code is split. The rule for which release is
// the most recent one is pure and asserted directly. The rendered row is
// asserted against the shared element stub. The keyboard is driven through the
// shipped markup of src/index.html, because a disclosure that opens is a thing
// only a real summary element and a real key press can prove.
//
// Harness rules this file follows deliberately:
//   • Assertions are on counts and attribute values. No `assert.equal(node,
//     null)` — that walks the whole parsed page and outlives the test timeout.
//   • The stub reads through a closed details element, so "collapsed" is
//     asserted as the `open` attribute and `aria-expanded`, never as absence.
//   • No descendant selectors are handed to the page harness.

import test from "node:test";
import assert from "node:assert/strict";

import { RELATIONSHIP_COPY, initDecisionLog, renderHistory, toHistoryRecords } from "../src/app.js";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { shippedState } from "../src/shipped-releases.js";
import { byClass, createElement, first, installDocument, tags } from "./support/dom.js";
import { loadPage, pressKey, textOf } from "./support/browser.js";

installDocument();

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const NO_DEMO_DATA = { decisions: [], releases: [] };

const mediumDate = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
// The stub joins child text with spaces, so a line built from element and text
// nodes is compared after the same collapse the page harness's textOf applies.
const flat = (node) => node.textContent.replace(/\s+/g, " ").trim();

const decision = (id, title) => ({
  id,
  title,
  context: `Why ${title.toLowerCase()}.`,
  owner: "Mina",
  status: "accepted",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const release = (overrides) => ({
  id: "r-2-4-0",
  version: "v2.4.0",
  title: "Delivery hardening",
  description: "Shipped.",
  status: "completed",
  owner: "Kai",
  createdAt: "2026-03-11T00:00:00.000Z",
  decisionIds: ["queue"],
  ...overrides,
});

// Three decisions covering the three states a row can be in, and the releases
// that put them there. "queue" is carried by three releases so the count in the
// summary line has something to be wrong about.
const DECISIONS = [
  decision("queue", "Adopt a durable queue"),
  decision("cache", "Cache the read path"),
  decision("cron", "Retire the cron worker"),
];

const RELEASES = [
  release({ id: "r-2-2-0", version: "v2.2.0", status: "planned", createdAt: "2026-01-20T00:00:00.000Z" }),
  release({}),
  release({ id: "r-2-3-0", version: "v2.3.0", status: "cancelled", createdAt: "2026-02-08T00:00:00.000Z" }),
  // One release, on its own decision: the "+N more" fragment must not appear.
  release({ id: "r-1-0-0", version: "v1.0.0", createdAt: "2026-01-05T00:00:00.000Z", decisionIds: ["cache"] }),
];

function render(decisions = DECISIONS, releases = RELEASES, view = {}) {
  const container = createElement("div");
  const count = createElement("span");
  renderHistory(container, count, toHistoryRecords(decisions, releases), view);
  return container;
}

// The row for a record, addressed the way a reader finds it: by its title. The
// relationship line is a sibling of the card's own link, so the article is what
// carries it.
function rowFor(container, title) {
  const card = byClass(container, "history-card")
    .find((candidate) => candidate.children[0].textContent === title);
  assert.ok(card, `no history row is titled "${title}"`);
  return card.parent;
}

const shippedLine = (container, title) => first(rowFor(container, title), "record-links");

// --- the rule --------------------------------------------------------------

test("the most recent release is picked by date, with a stable tiebreak", () => {
  const newest = (releases) => shippedState(releases).newest.version;
  assert.equal(newest(RELEASES.slice(0, 3)), "v2.4.0", "the newest release by date is not the one reported");
  // Reversing the records must not change the answer, and a shared date falls
  // back to the version rather than to whichever order the log happened to be
  // in — the same input always renders the same line.
  assert.equal(newest([...RELEASES.slice(0, 3)].reverse()), "v2.4.0");
  const tied = [
    release({ id: "r-a", version: "v3.0.0", createdAt: "2026-05-01T00:00:00.000Z" }),
    release({ id: "r-b", version: "v3.1.0", createdAt: "2026-05-01T00:00:00.000Z" }),
  ];
  assert.equal(newest(tied), "v3.1.0");
  assert.equal(newest([...tied].reverse()), "v3.1.0");

  // The three states, named rather than inferred from a count by the renderer.
  assert.equal(shippedState([]).state, "none");
  assert.equal(shippedState(RELEASES).state, "shipped");
  // A release that names the decision and can be neither named nor routed to.
  assert.equal(shippedState([{ decisionIds: ["queue"] }]).state, "unresolved");
});

// --- the summary line ------------------------------------------------------

test("a decision carried by several releases names the newest one and counts the rest", () => {
  const line = shippedLine(render(), "Adopt a durable queue");
  const summary = first(line, "shipped-summary");
  assert.equal(
    flat(summary),
    `${RELATIONSHIP_COPY.decision.label} v2.4.0 · ${mediumDate("2026-03-11T00:00:00.000Z")} · +2 more`,
    "the summary line does not name the newest release, its date, and how many others there are",
  );
  assert.equal(byClass(summary, "shipped-latest-version").length, 1, "the summary names more than one version");
  assert.equal(first(summary, "shipped-more").textContent, "+2 more", "the count of the other releases is wrong");
  // The date is a real time element, so the machine-readable value and the words
  // a reader sees cannot drift apart.
  const time = first(summary, "shipped-latest-date");
  assert.equal(time.tagName, "TIME");
  assert.equal(time.dateTime, "2026-03-11T00:00:00.000Z");
});

test("a decision with exactly one release renders no +N more fragment", () => {
  const line = shippedLine(render(), "Cache the read path");
  assert.equal(byClass(line, "shipped-more").length, 0, "one release still rendered a count of the others");
  assert.doesNotMatch(flat(line), /\+\d+ more/, "a lone release was given a “+N more” fragment");
  assert.doesNotMatch(flat(line), /\+0/, "a lone release was given a “+0 more” fragment");
  assert.match(flat(line), /v1\.0\.0/, "the one release that shipped it is not named");
  assert.equal(byClass(line, "record-link").length, 1, "the disclosure lists something other than the one release");
});

// --- the two absences ------------------------------------------------------

test("nothing shipped it and its releases could not be read are different sentences", () => {
  const unshipped = shippedLine(render(), "Retire the cron worker");
  assert.equal(first(unshipped, "record-link-empty").textContent, RELATIONSHIP_COPY.decision.empty);
  assert.equal(flat(unshipped), "Not yet shipped", "an unshipped decision does not say so in words");
  assert.equal(byClass(unshipped, "record-link").length, 0, "an unshipped decision rendered a release link");

  // The same decision, now named by a release record that cannot be named or
  // routed to itself. The association survives; its subject does not.
  const broken = shippedLine(
    render(DECISIONS, [release({ id: "r-broken", version: "", decisionIds: ["cron"] })]),
    "Retire the cron worker",
  );
  assert.equal(first(broken, "record-link-empty").textContent, RELATIONSHIP_COPY.decision.unresolved);
  assert.equal(flat(broken), "Shipped releases could not be read");
  assert.notEqual(
    RELATIONSHIP_COPY.decision.unresolved,
    RELATIONSHIP_COPY.decision.empty,
    "a decision whose releases went missing must not read as one that never shipped",
  );
  assert.doesNotMatch(
    flat(broken),
    new RegExp(RELATIONSHIP_COPY.decision.empty),
    "the unreadable-records state repeats the words the unshipped state uses",
  );
});

// --- the disclosure --------------------------------------------------------

test("the expanded list gives every release its version, status, date, and route", () => {
  const line = shippedLine(render(), "Adopt a durable queue");
  const links = byClass(line, "record-link");
  assert.equal(links.length, 3, "the disclosure does not list every release that shipped the decision");
  assert.deepEqual(
    links.map((link) => [link.tagName, link.href]),
    [
      ["A", "/release.html?id=r-2-2-0"],
      ["A", "/release.html?id=r-2-4-0"],
      ["A", "/release.html?id=r-2-3-0"],
    ],
    "the releases do not route through the same /release.html?id= link the Releases view uses",
  );
  assert.deepEqual(
    byClass(line, "record-link-label").map((label) => label.textContent),
    ["v2.2.0", "v2.4.0", "v2.3.0"],
  );
  assert.deepEqual(
    links.map((link) => flat(link)),
    [
      `v2.2.0 planned ${mediumDate("2026-01-20T00:00:00.000Z")}`,
      `v2.4.0 completed ${mediumDate("2026-03-11T00:00:00.000Z")}`,
      `v2.3.0 cancelled ${mediumDate("2026-02-08T00:00:00.000Z")}`,
    ],
    "a release in the list is missing its status or its date",
  );
  // The disclosure starts closed and says so to assistive technology. Asserted
  // on the attributes, because this stub — like the page harness — reads through
  // a closed details element and would pass a "not visible" claim either way.
  const disclosure = first(line, "shipped-releases");
  assert.equal(disclosure.tagName, "DETAILS");
  assert.equal(disclosure.getAttribute("open"), null);
  assert.equal(first(line, "shipped-summary").getAttribute("aria-expanded"), "false");
  // The line a reader must take in on arrival is the summary itself, never
  // folded into the part that is not rendered while collapsed.
  assert.equal(first(line, "shipped-summary").tagName, "SUMMARY");
});

// --- escaping --------------------------------------------------------------

test("a release version recorded as markup renders as the characters it is", () => {
  const payload = "<img src=x onerror=alert(1)>";
  const container = render(DECISIONS, [release({ id: "r-x", version: payload })]);
  const line = shippedLine(container, "Adopt a durable queue");
  assert.equal(
    first(line, "record-link-label").textContent,
    payload,
    "the hostile version is not rendered as the literal characters that were recorded",
  );
  assert.equal(
    first(line, "shipped-latest-version").textContent,
    payload,
    "the summary line lost the literal characters of the hostile version",
  );
  assert.equal(tags(container, "IMG").length, 0, "the injected tag became an element");
  assert.equal(tags(container, "SCRIPT").length, 0, "the injected payload became a script");
  // Status is a closed vocabulary, so markup in that field can never reach the
  // DOM at all: it falls back to a word this view chose.
  assert.equal(
    first(first(line, "record-link"), "badge").textContent,
    "completed",
    "a release status outside the recorded vocabulary was rendered as given",
  );
});

// --- the keyboard, in the shipped page -------------------------------------

test("the disclosure opens and closes from the keyboard, in the natural tab order", async (t) => {
  const page = await loadPage(DECISIONS_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify(DECISIONS), [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES) },
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, { announceDelay: 0, seed: NO_DEMO_DATA });
  assert.equal(page.document.documentElement.dataset.shiplog, "ready", "the history never finished rendering");

  const summaries = page.document.querySelectorAll(".shipped-summary");
  assert.equal(summaries.length, 2, "the shipped decisions did not both render a disclosure");
  const [summary] = summaries;
  assert.match(textOf(summary), /Shipped in v2\.4\.0/, "the first disclosure is not the one this test drives");

  // The harness rejects a descendant selector, so the disclosure is reached by
  // walking up from the summary rather than by querying through it.
  const disclosure = summary.parentNode;
  assert.equal(disclosure.tagName, "DETAILS");
  assert.equal(disclosure.getAttribute("open"), null, "the disclosure did not start collapsed");

  // A real tab stop, and not one bought with a positive tabindex.
  assert.equal(summary.getAttribute("tabindex"), null, "the disclosure declares a tabindex of its own");
  summary.focus();
  assert.equal(page.document.activeElement, summary, "the disclosure cannot take focus");

  pressKey(page.document, "Enter");
  assert.equal(disclosure.getAttribute("open"), "", "Enter did not open the disclosure");
  assert.equal(summary.getAttribute("aria-expanded"), "true", "the opened disclosure still announces itself collapsed");

  pressKey(page.document, " ");
  assert.equal(disclosure.getAttribute("open"), null, "Space did not close the disclosure");
  assert.equal(summary.getAttribute("aria-expanded"), "false", "the closed disclosure still announces itself expanded");

  pressKey(page.document, " ");
  assert.equal(disclosure.getAttribute("open"), "", "Space did not open the disclosure");
  assert.equal(summary.getAttribute("aria-expanded"), "true");
});
