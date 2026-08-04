// The linked-release impact section on a decision detail page.
//
// Two layers, tested where they live: the ordering and summary rules are pure
// and asserted directly, and the rendered section is asserted against the shared
// element stub — the list order, the routing target of every row, the parts a
// screen reader needs to hear, and what a malformed or dateless release does to
// the section it appears in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { byClass, createElement, first, installDocument, tags } from "./support/dom.js";

installDocument();

import {
  MAX_LINKED_RELEASES,
  normalizeLinkedReleases,
  renderDecisionDetail,
  renderLinkedReleases,
  summarizeLinkedReleases,
} from "../src/decision-detail.js";
import { loadDecisionDetail } from "../src/decision-page.js";
import { releaseLinkPhrase } from "../src/releases.js";

const longDate = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(iso));

const release = (overrides) => ({
  id: "r-1-3-0",
  version: "v1.3.0",
  title: "Throughput and latency",
  status: "completed",
  owner: "Kai",
  createdAt: "2026-05-25T16:00:00.000Z",
  decisionIds: ["queue"],
  ...overrides,
});

const linked = [
  release({ id: "r-1-2-0", version: "v1.2.0", title: "Groundwork", status: "cancelled", createdAt: "2026-04-05T16:00:00.000Z" }),
  release({ id: "r-1-4-0", version: "v1.4.0", title: "Delivery hardening", status: "planned", createdAt: "2026-07-01T16:00:00.000Z" }),
  release({}),
];

const decision = {
  id: "queue",
  title: "Adopt a durable queue",
  status: "accepted",
  owner: "Mina",
  context: "Retries must survive a deploy.",
  alternatives: "",
  createdAt: "2026-03-01T00:00:00.000Z",
};

test("linked releases are ordered newest first, once per release", () => {
  const entries = normalizeLinkedReleases([...linked, release({})]);
  assert.deepEqual(entries.map(({ version }) => version), ["v1.4.0", "v1.3.0", "v1.2.0"]);
  assert.deepEqual(entries.map(({ href }) => href), [
    "/release.html?id=r-1-4-0",
    "/release.html?id=r-1-3-0",
    "/release.html?id=r-1-2-0",
  ]);
});

test("a release keeps its association when it cannot be placed in time, and sorts last", () => {
  const entries = normalizeLinkedReleases([
    release({ id: "undated", version: "v0.9.0", createdAt: "not a date" }),
    release({ id: "missing-date", version: "v0.8.0", createdAt: undefined }),
    ...linked,
  ]);
  assert.deepEqual(entries.map(({ version }) => version), ["v1.4.0", "v1.3.0", "v1.2.0", "v0.9.0", "v0.8.0"]);
  assert.deepEqual(entries.at(-1), { ...entries.at(-1), dated: false, createdAt: "", timestamp: 0 });
});

test("records that cannot be named or routed to are dropped rather than rendered blank", () => {
  assert.deepEqual(normalizeLinkedReleases([null, "v1", { version: "v1.0.0" }, { id: "no-version" }, { id: " ", version: " " }]), []);
  assert.deepEqual(normalizeLinkedReleases(undefined), []);
  assert.deepEqual(normalizeLinkedReleases({ length: 2 }), []);
});

test("unrecorded status and title fall back instead of leaking undefined into the row", () => {
  const [entry] = normalizeLinkedReleases([{ id: "r", version: "v2.0.0", createdAt: "2026-06-01T00:00:00.000Z" }]);
  assert.equal(entry.status, "completed");
  assert.equal(entry.title, "");
  const [unknown] = normalizeLinkedReleases([release({ status: "shipped-ish" })]);
  assert.equal(unknown.status, "completed");
});

test("the summary states the count and where the newest release stands", () => {
  const summary = summarizeLinkedReleases(normalizeLinkedReleases(linked));
  assert.equal(summary.count, 3);
  assert.equal(summary.newest.version, "v1.4.0");
  assert.equal(summary.text, `3 releases carry this decision. Newest: v1.4.0 — planned on ${longDate("2026-07-01T16:00:00.000Z")}.`);

  const single = summarizeLinkedReleases(normalizeLinkedReleases([release({})]));
  assert.match(single.text, /^1 release carries this decision\. /);

  const undated = summarizeLinkedReleases(normalizeLinkedReleases([release({ createdAt: "" })]));
  assert.equal(undated.text, "1 release carries this decision. Newest: v1.3.0 — completed (date not recorded).");

  assert.deepEqual(summarizeLinkedReleases([]), { count: 0, newest: null, text: "" });
  assert.deepEqual(summarizeLinkedReleases(), { count: 0, newest: null, text: "" });
});

test("the summary and the list can never disagree about which release is newest", () => {
  const section = renderLinkedReleases(linked);
  const summary = first(section, "linked-release-summary");
  const firstRow = byClass(section, "linked-release")[0];
  assert.equal(summarizeLinkedReleases(normalizeLinkedReleases(linked)).newest.version, "v1.4.0");
  assert.match(summary.textContent, /Newest: v1\.4\.0/);
  assert.match(firstRow.textContent, /v1\.4\.0/);
  assert.ok(firstRow.classes.includes("linked-release-newest"));
});

test("the summary and list render only when releases are linked", () => {
  const withReleases = renderLinkedReleases(linked);
  assert.equal(byClass(withReleases, "linked-release-summary").length, 1);
  assert.equal(byClass(withReleases, "linked-release-list").length, 1);
  assert.equal(byClass(withReleases, "linked-release").length, 3);

  for (const nothing of [[], undefined, [{ id: "" }]]) {
    const section = renderLinkedReleases(nothing);
    assert.equal(byClass(section, "linked-release-summary").length, 0, "no summary without a linked release");
    assert.equal(byClass(section, "linked-release-list").length, 0, "no list without a linked release");
    // The empty state is not blank space and not a bare zero: it names the
    // relationship in the heading, says the answer in a sentence, and offers
    // the one move that changes it — recording the release.
    assert.equal(tags(section, "H2")[0].textContent, "Releases that carry this decision");
    assert.match(section.textContent, /No release carries this decision yet, so nothing here says when it shipped\./);
    const action = first(section, "empty-action");
    assert.equal(action.textContent, "Record the release that ships this decision");
    assert.equal(action.href, "/releases.html#release-form");
    assert.equal(tags(section, "A").length, 1, "the next action is the only link in the empty state");
  }
});

test("each row says whether the decision shipped in that release or is only referenced by it", () => {
  const section = renderLinkedReleases(linked);
  const rows = byClass(section, "linked-release");
  assert.deepEqual(
    rows.map((row) => first(row, "linked-release-relationship").textContent),
    [
      // v1.4.0 is planned and v1.2.0 cancelled: neither shipped anything.
      "Referenced by this release, not shipped",
      "Shipped in this release",
      "Referenced by this release, not shipped",
    ],
  );
  // The same phrase the release detail puts on the other side of the link.
  assert.equal(first(rows[1], "linked-release-relationship").textContent, releaseLinkPhrase("completed"));
  assert.equal(first(rows[0], "linked-release-relationship").textContent, releaseLinkPhrase("planned"));
  // Relationship, status and date are one described sentence, separated by real
  // characters so a screen reader does not run them together.
  assert.match(
    first(rows[1], "linked-release-meta").textContent,
    new RegExp(`Shipped in this release\\s+·\\s+completed\\s+·\\s+${longDate("2026-05-25T16:00:00.000Z")}`),
  );
});

test("every release is one native link to the existing release detail route", () => {
  const section = renderLinkedReleases(linked);
  const rows = byClass(section, "linked-release");
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const links = tags(row, "A");
    assert.equal(links.length, 1, "one activation target per row, not a nested pair");
    assert.match(links[0].href, /^\/release\.html\?id=/);
    // Native anchors are keyboard reachable on their own. A tabindex or a
    // click-only element here would be the regression worth catching.
    assert.equal(links[0].getAttribute("tabindex"), null);
    assert.equal(links[0].attributes.tabIndex, undefined);
    assert.equal(links[0].listeners.click, undefined);
  }
  // The version and the title are separated by a text node rather than by flex
  // spacing: the accessible name is computed from text, so a gap would announce
  // them run together.
  assert.match(tags(rows[0], "A")[0].textContent, /^v1\.4\.0\s+·\s+Delivery hardening$/);
  assert.match(tags(rows[1], "A")[0].textContent, /^v1\.3\.0\s+·\s+Throughput and latency$/);
});

test("status and date are described to the link rather than folded into its name", () => {
  const section = renderLinkedReleases(linked);
  const list = first(section, "linked-release-list");
  assert.equal(list.tagName, "UL");
  assert.equal(list.getAttribute("aria-label"), "Releases that carry this decision, newest first");
  assert.equal(section.getAttribute("aria-labelledby"), "linked-releases-title");
  assert.equal(tags(section, "H2")[0].id, "linked-releases-title");

  const rows = byClass(section, "linked-release");
  const described = rows.map((row) => tags(row, "A")[0].getAttribute("aria-describedby"));
  assert.deepEqual(described, ["linked-release-meta-1", "linked-release-meta-2", "linked-release-meta-3"]);
  assert.equal(new Set(described).size, rows.length, "each row points at its own description");
  rows.forEach((row, index) => {
    assert.equal(first(row, "linked-release-meta").id, described[index]);
  });

  const [newest] = rows;
  assert.equal(first(newest, "badge").textContent, "planned");
  assert.ok(first(newest, "badge").classes.includes("badge-release-planned"));
  const time = tags(newest, "TIME")[0];
  assert.equal(time.dateTime, "2026-07-01T16:00:00.000Z");
  assert.equal(time.textContent, longDate("2026-07-01T16:00:00.000Z"));
});

test("a dateless release says so instead of rendering an invalid date", () => {
  const section = renderLinkedReleases([release({ createdAt: "not a date" })]);
  assert.equal(tags(section, "TIME").length, 0);
  assert.equal(first(section, "linked-release-undated").textContent, "Date not recorded");
  assert.doesNotMatch(section.textContent, /Invalid Date|NaN|undefined/);
});

test("a release title carrying markup renders as characters, not as an element", () => {
  const section = renderLinkedReleases([release({
    version: "<svg onload=alert(1)>",
    title: "<img src=x onerror=alert(1)>",
  })]);
  const link = tags(section, "A")[0];
  assert.equal(first(section, "linked-release-title").textContent, "<img src=x onerror=alert(1)>");
  assert.match(link.textContent, /^<svg onload=alert\(1\)>/);
  assert.equal(tags(link, "IMG").length, 0);
  assert.equal(tags(link, "SVG").length, 0);
});

test("hostile stored identifiers and oversized linked-release lists are bounded", () => {
  const hostileIds = [
    release({ id: "javascript:alert(1)" }),
    release({ id: "release\u202eroute" }),
    release({ id: "x".repeat(201) }),
  ];
  const entries = normalizeLinkedReleases(hostileIds);
  assert.deepEqual(entries.map(({ id }) => id), ["javascript:alert(1)"]);
  assert.equal(entries[0].href, "/release.html?id=javascript%3Aalert(1)");

  const many = Array.from({ length: MAX_LINKED_RELEASES + 20 }, (_, index) => release({
    id: `release-${index}`,
    version: `v${index}`,
    title: `safe\u202eevil${"t".repeat(200)}`,
  }));
  const bounded = normalizeLinkedReleases(many);
  assert.equal(bounded.length, MAX_LINKED_RELEASES);
  assert.equal(bounded[0].title.length, 120);
  assert.doesNotMatch(bounded[0].title, /\u202e/u);
});

test("the decision detail view keeps the section between the record header and its context", () => {
  const container = createElement("div");
  renderDecisionDetail(container, decision, { linkedReleases: linked });

  const section = first(container, "linked-releases");
  assert.ok(section.classes.includes("proof-relationship"), "keeps the shared relationship styling hook");
  const sections = tags(container, "SECTION").map((node) => node.classes[0]);
  assert.ok(sections.indexOf("proof-relationship") < sections.indexOf("decision-context"));
  assert.match(container.textContent, /3 releases carry this decision\. Newest: v1\.4\.0 — planned/);
  // The return link stays the first thing in the container on every path.
  assert.equal(tags(container, "A")[0].textContent, "← Back to Decisions");
  assert.equal(tags(container, "A")[1].href, "/release.html?id=r-1-4-0");
});

test("the decision detail states the relationship even when no release carries the decision", () => {
  const container = createElement("div");
  renderDecisionDetail(container, decision, { linkedReleases: [] });
  assert.equal(byClass(container, "linked-releases").length, 1);
  assert.match(container.textContent, /Releases that carry this decision/);
  assert.match(container.textContent, /No release carries this decision yet/);
  // Back link first, the next action second: no release row exists to link to.
  assert.deepEqual(tags(container, "A").map((link) => link.href), ["/", "/releases.html#release-form"]);
});

test("the page layer associates releases by decision id and the view orders them", () => {
  const releases = [...linked, release({ id: "unrelated", version: "v9.0.0", decisionIds: ["cache"] })];
  const loadData = () => ({
    decisions: [decision],
    releases,
    publicDecisionIds: new Set(),
    exampleDecisionIds: new Set(),
  });

  const result = loadDecisionDetail("queue", null, { loadData, detailSeeds: [] });
  assert.equal(result.state, "available");
  assert.deepEqual(result.linkedReleases.map(({ id }) => id), ["r-1-2-0", "r-1-4-0", "r-1-3-0"]);

  const container = createElement("div");
  renderDecisionDetail(container, result.decision, { linkedReleases: result.linkedReleases });
  assert.deepEqual(
    byClass(container, "linked-release-link").map((link) => link.href),
    ["/release.html?id=r-1-4-0", "/release.html?id=r-1-3-0", "/release.html?id=r-1-2-0"],
  );

  const none = loadDecisionDetail("cache", null, {
    loadData: () => ({ ...loadData(), decisions: [{ ...decision, id: "cache" }], releases: [] }),
    detailSeeds: [],
  });
  assert.deepEqual(none.linkedReleases, []);
});

test("the section stays readable at a narrow width and routes through the shared href builder", async () => {
  const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  // Two files now: the association rules moved to shipped-releases.js when the
  // history rows began answering "what shipped this" inline, and the guard
  // follows the code rather than staying pointed at the file it used to be in.
  const [component, shipped, css] = await Promise.all([
    read("decision-detail.js"),
    read("shipped-releases.js"),
    read("styles.css"),
  ]);
  // The route lives in one place (releases.js), so neither view can drift from
  // wherever the release detail page moves to.
  assert.match(shipped, /releaseDetailHref/);
  for (const source of [component, shipped]) {
    assert.doesNotMatch(source, /release\.html\?id=/);
    assert.doesNotMatch(source, /innerHTML/);
  }
  assert.match(css, /\.linked-release-list \{[^}]*grid/);
  assert.match(css, /\.linked-release-meta \{[^}]*flex-wrap:wrap/);
  // The one narrow-width breakpoint the decision detail page already uses: the
  // two halves of a row stack there instead of being squeezed onto one line.
  const narrow = css.slice(css.indexOf("@media(max-width:760px)"));
  assert.ok(narrow.startsWith("@media(max-width:760px)"), "the decision detail breakpoint still exists");
  assert.match(narrow, /\.linked-release\{[^}]*flex-direction:column/);
});
