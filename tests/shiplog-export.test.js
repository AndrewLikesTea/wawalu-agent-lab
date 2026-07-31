import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EXPORT_STATUS,
  SHIPLOG_EXPORT_SCHEMA,
  SHIPLOG_EXPORT_VERSION,
  buildShiplogExport,
  createShiplogExport,
  describeShiplogExport,
  downloadShiplogExport,
  exportedRecordSentence,
  formatShiplogExportCounts,
  initShiplogExport,
  shiplogExportFilename,
  shiplogExportLabel,
  unresolvedLinkSentence,
} from "../src/shiplog-export.js";
import { FULL_HISTORY_SCOPE, publishHistoryScope } from "../src/history-scope.js";
import {
  linkIntegrityViolations,
  orderingViolations,
  shiplogExportViolations,
} from "../src/shiplog-export-schema.js";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";

const GENERATED_AT = "2026-07-26T18:30:00.000Z";
const decision = {
  id: "d-queue", title: "Use a durable queue", context: "Jobs were lost",
  alternatives: "Database polling", owner: "Rowan", status: "accepted",
  createdAt: "2026-07-25T10:00:00.000Z",
};
const release = {
  id: "r-1", version: "v1.0.0", title: "Queue launch",
  createdAt: "2026-07-26T10:00:00.000Z",
  decisionIds: ["d-queue", "d-preserved-but-missing"],
};

function storage(values = {}) {
  return { getItem(key) { return values[key] ?? null; } };
}

function populatedStorage(extra = {}) {
  return storage({
    [STORAGE_KEY]: JSON.stringify([decision]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([release]),
    ...extra,
  });
}

// A log big enough to have shape: three decisions, three releases, one decision
// shipped in two releases, one release naming none, and one link to a decision
// this browser no longer holds.
const LINKED_DECISIONS = [
  {
    id: "link-d-cache", title: "Cache the read path", context: "Read latency spikes",
    alternatives: "Query tuning alone", owner: "Ari", status: "accepted",
    createdAt: "2026-02-01T09:00:00.000Z",
  },
  {
    id: "link-d-flags", title: "Introduce feature flags", context: "Decouple deploy from release",
    alternatives: "Long-lived branches", owner: "Priya", status: "proposed",
    createdAt: "2026-02-02T09:00:00.000Z", supersedes: "link-d-cache",
  },
  {
    id: "link-d-tokens", title: "Rotate to short-lived tokens", context: "Static keys never expire",
    alternatives: "Manual rotation", owner: "Rowan", status: "accepted",
    createdAt: "2026-02-03T09:00:00.000Z",
  },
];
const LINKED_RELEASES = [
  {
    id: "link-r-1-4-0", version: "v1.4.0", title: "Latency", description: "The read cache shipped.",
    owner: "Ari", status: "completed", createdAt: "2026-02-04T09:00:00.000Z",
    decisionIds: ["link-d-cache", "link-d-flags"],
  },
  {
    id: "link-r-1-5-0", version: "v1.5.0", owner: "Priya", status: "planned",
    createdAt: "2026-02-05T09:00:00.000Z",
    decisionIds: ["link-d-cache", "link-d-tokens", "link-d-erased"],
  },
  {
    id: "link-r-1-6-0", version: "v1.6.0", owner: "Jules", status: "planned",
    createdAt: "2026-02-06T09:00:00.000Z", decisionIds: [],
  },
];

const linkedStorage = () => storage({
  [STORAGE_KEY]: JSON.stringify(LINKED_DECISIONS),
  [RELEASE_STORAGE_KEY]: JSON.stringify(LINKED_RELEASES),
});

test("populated browser export has an explicit portable contract and only Shiplog history", () => {
  const payload = createShiplogExport(populatedStorage({
    "shiplog.social.author": "Customer Name",
    "unrelated.state": JSON.stringify({ secret: true }),
  }), { generatedAt: GENERATED_AT });

  assert.deepEqual(payload, {
    schema: SHIPLOG_EXPORT_SCHEMA,
    version: SHIPLOG_EXPORT_VERSION,
    generatedAt: GENERATED_AT,
    record_count: 2,
    // Nothing was filtered, so the block is empty — the one reading that means
    // "this file is the whole browsed history".
    filter: {},
    decisions: [decision],
    // The second id named a decision this browser does not hold, so it is not
    // written into the file: see the link integrity tests below.
    releases: [{ ...release, decisionIds: ["d-queue"] }],
  });
  assert.equal(JSON.parse(JSON.stringify(payload)).generatedAt, GENERATED_AT);
  assert.equal(payload["unrelated.state"], undefined);
  assert.deepEqual(shiplogExportViolations(payload), []);
});

test("empty browser history exports an explicitly empty valid record", () => {
  const payload = createShiplogExport(storage(), { generatedAt: GENERATED_AT });
  assert.deepEqual(payload, {
    schema: SHIPLOG_EXPORT_SCHEMA,
    version: SHIPLOG_EXPORT_VERSION,
    generatedAt: GENERATED_AT,
    record_count: 0,
    filter: {},
    decisions: [],
    releases: [],
  });
  // An empty log is a valid export, not a degenerate one: the envelope is whole
  // and both collections are present and empty rather than absent.
  assert.deepEqual(shiplogExportViolations(payload), []);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
});

test("an empty log downloads a parseable file that says it holds nothing", async () => {
  const { text } = await capture(storage());
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.decisions, []);
  assert.deepEqual(parsed.releases, []);
  assert.deepEqual(shiplogExportViolations(parsed), []);
});

test("many decisions and releases export with every association intact", () => {
  const { payload, unresolvedLinks } = buildShiplogExport(linkedStorage(), { generatedAt: GENERATED_AT });

  assert.deepEqual(payload.decisions.map(({ id }) => id), LINKED_DECISIONS.map(({ id }) => id));
  assert.deepEqual(
    payload.releases.map(({ id, decisionIds }) => [id, decisionIds]),
    [
      ["link-r-1-4-0", ["link-d-cache", "link-d-flags"]],
      // Order is the order the release recorded, with only the unresolvable id
      // removed — the surviving links do not shift or re-sort.
      ["link-r-1-5-0", ["link-d-cache", "link-d-tokens"]],
      ["link-r-1-6-0", []],
    ],
  );
  // One decision carried by two releases stays one exported record.
  assert.equal(payload.decisions.filter(({ id }) => id === "link-d-cache").length, 1);
  assert.equal(payload.decisions[1].supersedes, "link-d-cache", "the supersede link survives the export");
  assert.deepEqual(unresolvedLinks, [
    { releaseId: "link-r-1-5-0", decisionId: "link-d-erased", position: 2 },
  ]);
  assert.deepEqual(shiplogExportViolations(payload), []);
});

// --------------------------------------------------------------------------
// Determinism
// --------------------------------------------------------------------------
//
// The file is a record two parties can compare, so the same history has to
// produce the same bytes. localStorage order is not that: records are prepended
// as they are written, a restore rewrites both arrays wholesale, and the same
// log therefore reached the exporter in different orders depending on how it
// got into the browser. These tests pin the file against the *content* of the
// store rather than against its layout.

// The linked fixture, shuffled, with two decisions and two releases sharing a
// createdAt so the id tiebreak is exercised rather than assumed.
const TIED_DECISIONS = [
  { ...LINKED_DECISIONS[2], createdAt: "2026-02-01T09:00:00.000Z" },
  ...LINKED_DECISIONS.slice(0, 2),
];
const TIED_RELEASES = [
  LINKED_RELEASES[2],
  { ...LINKED_RELEASES[1], createdAt: "2026-02-04T09:00:00.000Z" },
  LINKED_RELEASES[0],
];

const bytesOf = (decisions, releases) => JSON.stringify(createShiplogExport(storage({
  [STORAGE_KEY]: JSON.stringify(decisions),
  [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
}), { generatedAt: GENERATED_AT }));

test("the same history exports to the same bytes whatever order the browser holds it in", () => {
  const expected = bytesOf(TIED_DECISIONS, TIED_RELEASES);

  // Every rotation of both stores: the exporter sees a different array each
  // time and must not let that reach the file.
  for (let offset = 1; offset < 3; offset += 1) {
    const rotate = (records) => [...records.slice(offset), ...records.slice(0, offset)];
    assert.equal(
      bytesOf(rotate(TIED_DECISIONS), rotate(TIED_RELEASES)),
      expected,
      `storage rotated by ${offset} produced a different file`,
    );
  }
  assert.equal(bytesOf([...TIED_DECISIONS].reverse(), [...TIED_RELEASES].reverse()), expected);
  // Determinism is worth nothing if the agreed-on file is itself invalid.
  assert.deepEqual(shiplogExportViolations(JSON.parse(expected)), []);
});

test("records are written oldest first, with same-instant records ordered by id", () => {
  const { payload } = buildShiplogExport(storage({
    [STORAGE_KEY]: JSON.stringify(TIED_DECISIONS),
    [RELEASE_STORAGE_KEY]: JSON.stringify(TIED_RELEASES),
  }), { generatedAt: GENERATED_AT });

  assert.deepEqual(payload.decisions.map(({ id }) => id), [
    // Two decisions at 2026-02-01T09:00:00Z: "link-d-cache" before
    // "link-d-tokens", which is the id order and not the storage order.
    "link-d-cache", "link-d-tokens", "link-d-flags",
  ]);
  assert.deepEqual(payload.releases.map(({ id }) => id), [
    "link-r-1-4-0", "link-r-1-5-0", "link-r-1-6-0",
  ]);
  assert.deepEqual(orderingViolations(payload), []);
  assert.deepEqual(shiplogExportViolations(payload), []);
});

test("canonical order does not disturb the associations or the drop report", () => {
  const { payload, unresolvedLinks } = buildShiplogExport(storage({
    [STORAGE_KEY]: JSON.stringify([...LINKED_DECISIONS].reverse()),
    [RELEASE_STORAGE_KEY]: JSON.stringify([...LINKED_RELEASES].reverse()),
  }), { generatedAt: GENERATED_AT });

  assert.deepEqual(
    payload.releases.map(({ id, decisionIds }) => [id, decisionIds]),
    [
      ["link-r-1-4-0", ["link-d-cache", "link-d-flags"]],
      // Reordering the collection does not reorder a release's own links: that
      // sequence is what the visitor recorded.
      ["link-r-1-5-0", ["link-d-cache", "link-d-tokens"]],
      ["link-r-1-6-0", []],
    ],
  );
  assert.deepEqual(unresolvedLinks, [
    { releaseId: "link-r-1-5-0", decisionId: "link-d-erased", position: 2 },
  ]);
  assert.deepEqual(shiplogExportViolations(payload), []);
});

test("an empty log is deterministic too, and stays valid JSON", async () => {
  const first = createShiplogExport(storage(), { generatedAt: GENERATED_AT });
  const second = createShiplogExport(storage({
    [STORAGE_KEY]: "[]",
    [RELEASE_STORAGE_KEY]: "not JSON at all",
  }), { generatedAt: GENERATED_AT });

  assert.equal(JSON.stringify(second), JSON.stringify(first));
  const { text } = await capture(storage({ [RELEASE_STORAGE_KEY]: "not JSON at all" }));
  assert.equal(text, `${JSON.stringify(first, null, 2)}\n`);
  assert.deepEqual(orderingViolations(JSON.parse(text)), []);
});

test("every exported release link resolves to an exported decision", () => {
  const { payload } = buildShiplogExport(linkedStorage(), { generatedAt: GENERATED_AT });
  const exportedIds = new Set(payload.decisions.map(({ id }) => id));
  const dangling = payload.releases.flatMap((exported) => exported.decisionIds
    .filter((id) => !exportedIds.has(id))
    .map((id) => `${exported.id} -> ${id}`));

  assert.deepEqual(dangling, [], "the file claims an association it cannot resolve");
  assert.deepEqual(linkIntegrityViolations(payload), []);
});

test("the shipped integrity check names a link that does not resolve", () => {
  const { payload } = buildShiplogExport(linkedStorage(), { generatedAt: GENERATED_AT });
  const mutated = structuredClone(payload);
  mutated.releases[0].decisionIds.push("link-d-erased");

  assert.deepEqual(linkIntegrityViolations(mutated), [
    'export.releases[0].decisionIds[2]: "link-d-erased" does not resolve to a decision in this export',
  ]);
  assert.ok(shiplogExportViolations(mutated).length > 0);
});

test("a record's undeclared keys stay in the browser", () => {
  const payload = createShiplogExport(storage({
    [STORAGE_KEY]: JSON.stringify([{
      ...decision,
      sessionCookie: "sid=abc123",
      customerEmail: "someone@example.com",
      telemetry: { views: 12 },
      note: "<img src=x onerror=alert(1)>",
    }]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([{ ...release, decisionIds: ["d-queue"], authToken: "t-1" }]),
  }), { generatedAt: GENERATED_AT });

  assert.deepEqual(payload.decisions, [decision]);
  assert.deepEqual(Object.keys(payload.releases[0]).toSorted(),
    ["createdAt", "decisionIds", "id", "title", "version"]);
  assert.deepEqual(shiplogExportViolations(payload), []);
});

test("the export report names the fields it refused to carry", () => {
  const { droppedFields } = buildShiplogExport(storage({
    [STORAGE_KEY]: JSON.stringify([{ ...decision, sessionCookie: "sid=abc123" }]),
  }), { generatedAt: GENERATED_AT });

  assert.deepEqual(droppedFields, [
    { collection: "decisions", id: "d-queue", field: "sessionCookie" },
  ]);
});

test("a non-ISO generatedAt is refused rather than written into the file", () => {
  assert.throws(
    () => createShiplogExport(storage(), { generatedAt: "yesterday" }),
    /must be an ISO date/,
  );
});

// --------------------------------------------------------------------------
// Download behaviour
// --------------------------------------------------------------------------

// The browser seam the download actually uses: a Blob handed to
// createObjectURL and an anchor with a download attribute that is clicked. The
// bytes the browser would receive are read back out of the Blob, so these tests
// assert on the file rather than on the object that produced it.
async function capture(store, options = {}) {
  const clicks = [];
  const revoked = [];
  let blob = null;
  const documentRef = {
    createElement() {
      const link = { click() { clicks.push({ href: link.href, download: link.download }); } };
      return link;
    },
  };
  const urlApi = {
    createObjectURL(value) { blob = value; return "blob:shiplog-export"; },
    revokeObjectURL(href) { revoked.push(href); },
  };
  const payload = createShiplogExport(store, { generatedAt: options.generatedAt ?? GENERATED_AT });
  downloadShiplogExport(payload, { document: documentRef, urlApi });
  return { payload, blob, clicks, revoked, text: await blob.text() };
}

test("the download hands the browser one JSON file named for the export instant", async () => {
  const { payload, blob, clicks, revoked, text } = await capture(linkedStorage());

  assert.equal(clicks.length, 1);
  assert.deepEqual(clicks[0], {
    href: "blob:shiplog-export",
    download: "shiplog-history-2026-07-26T18-30-00Z.json",
  });
  assert.equal(blob.type, "application/json");
  assert.deepEqual(revoked, ["blob:shiplog-export"], "the object URL is released after the click");
  assert.ok(text.endsWith("\n"), "the file ends with a newline");
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed, payload, "the bytes the browser receives are the payload");
  assert.deepEqual(shiplogExportViolations(parsed), [],
    "the downloaded file is a valid export on its own terms");
});

test("export UI shows local counts before download and downloads one record", () => {
  const listeners = {};
  const button = { addEventListener(type, listener) { listeners[type] = listener; } };
  const counts = { textContent: "" };
  const status = { textContent: "" };
  const elements = {
    "#export-shiplog": button,
    "#export-shiplog-counts": counts,
    "#export-shiplog-status": status,
  };
  const downloads = [];

  initShiplogExport({
    querySelector(selector) { return elements[selector] ?? null; },
  }, populatedStorage(), {
    now: () => new Date(GENERATED_AT),
    download(payload) { downloads.push(payload); },
  });

  assert.equal(counts.textContent, "Ready to export 1 decision and 1 release stored in this browser.");
  assert.equal(downloads.length, 0, "counts are visible before the user starts the download");
  listeners.click();
  assert.equal(downloads.length, 1);
  assert.deepEqual(downloads[0].releases[0].decisionIds, ["d-queue"]);
  assert.equal(
    status.textContent,
    "Shiplog history exported. 1 release link to a decision this browser no longer holds was left out.",
  );
});

test("a clean export says so, and a failed one says the browser was not changed", () => {
  const listeners = {};
  const status = { textContent: "" };
  const elements = {
    "#export-shiplog": { addEventListener(type, listener) { listeners[type] = listener; } },
    "#export-shiplog-counts": { textContent: "" },
    "#export-shiplog-status": status,
  };
  const root = { querySelector(selector) { return elements[selector] ?? null; } };

  initShiplogExport(root, storage({
    [STORAGE_KEY]: JSON.stringify([decision]),
    [RELEASE_STORAGE_KEY]: JSON.stringify([{ ...release, decisionIds: ["d-queue"] }]),
  }), { now: () => new Date(GENERATED_AT), download() {} });
  listeners.click();
  assert.equal(status.textContent, EXPORT_STATUS.exported);

  initShiplogExport(root, populatedStorage(), {
    now: () => new Date(GENERATED_AT),
    download() { throw new Error("the browser refused the download"); },
  });
  listeners.click();
  assert.equal(status.textContent, EXPORT_STATUS.failed);
});

test("the dropped-link sentence is singular, plural, or absent", () => {
  assert.equal(unresolvedLinkSentence({ unresolvedLinks: [] }), "");
  assert.equal(unresolvedLinkSentence({}), "");
  assert.equal(describeShiplogExport({ unresolvedLinks: [] }), EXPORT_STATUS.exported);
  assert.match(describeShiplogExport({ unresolvedLinks: [{}] }), /1 release link .* was left out\.$/);
  assert.match(describeShiplogExport({ unresolvedLinks: [{}, {}] }), /2 release links .* were left out\.$/);
});

test("count copy uses explicit zero and plural labels", () => {
  assert.equal(
    formatShiplogExportCounts({ decisions: 0, releases: 0 }),
    "Ready to export 0 decisions and 0 releases stored in this browser.",
  );
});

// --------------------------------------------------------------------------
// The envelope: what the file says about itself
// --------------------------------------------------------------------------

test("a scoped export carries the filter that produced it and counts what it wrote", () => {
  const { payload, filtered, recordCount } = buildShiplogExport(linkedStorage(), {
    generatedAt: GENERATED_AT,
    scope: {
      filtered: true,
      decisionIds: ["link-d-cache"],
      releaseIds: [],
      filters: { owner: "Ari", status: "accepted", sort: "title" },
    },
  });

  assert.deepEqual(payload.decisions.map(({ id }) => id), ["link-d-cache"]);
  assert.deepEqual(payload.releases, []);
  assert.equal(payload.record_count, 1);
  assert.equal(recordCount, 1);
  assert.equal(filtered, true);
  // `sort` is not a filter — it reorders the same records — so it is not in the
  // block, and the retired "approved" spelling would arrive here as "accepted".
  assert.deepEqual(payload.filter, { owner: "Ari", status: "accepted" });
  assert.deepEqual(shiplogExportViolations(payload), []);
});

test("a filter matching nothing exports an empty file rather than refusing", () => {
  const payload = createShiplogExport(linkedStorage(), {
    generatedAt: GENERATED_AT,
    scope: { filtered: true, decisionIds: [], releaseIds: [], filters: { query: "nothing matches this" } },
  });

  assert.equal(payload.record_count, 0);
  assert.deepEqual(payload.decisions, []);
  assert.deepEqual(payload.releases, []);
  assert.deepEqual(payload.filter, { query: "nothing matches this" });
  assert.deepEqual(shiplogExportViolations(payload), [], "the empty filtered file is still a whole export");
});

test("a rubbish filter state degrades to an empty block rather than throwing", () => {
  const payload = createShiplogExport(populatedStorage(), {
    generatedAt: GENERATED_AT,
    scope: { filtered: false, filters: { status: "not-a-status", from: "2026-02-31", owner: 12 } },
  });

  assert.deepEqual(payload.filter, {}, "an unusable filter value was written into the file");
  assert.equal(payload.record_count, 2);
});

test("the filename is timestamped, ASCII, and safe on every filesystem", async () => {
  const { clicks } = await capture(populatedStorage());
  const [{ download }] = clicks;

  assert.match(download, /^shiplog-history-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/);
  // The characters Windows refuses, plus the two macOS and Linux care about.
  assert.doesNotMatch(download, /[<>:"/\\|?*]/, "the filename holds a character a filesystem refuses");
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(download, /[^\x20-\x7E]/, "the filename is not plain ASCII");
  assert.doesNotMatch(download, /[. ]$/, "the filename ends with a dot or a space");

  // Two exports of the same history a second apart are two files, not one that
  // overwrites the other.
  const later = await capture(populatedStorage(), { generatedAt: "2026-07-26T18:30:01.000Z" });
  assert.notEqual(later.clicks[0].download, download);

  // No visitor text reaches the name, so a filter cannot put a slash in it.
  assert.equal(
    shiplogExportFilename({ generatedAt: GENERATED_AT, filter: { query: "../etc/passwd", owner: "O'Brien" } }),
    download,
  );
  assert.equal(shiplogExportFilename({ generatedAt: "yesterday" }), "shiplog-history.json");
  assert.equal(shiplogExportFilename({}), "shiplog-history.json");
});

test("record text with markup, quotes, and backslashes survives JSON.parse unchanged", async () => {
  const hostile = {
    id: "d-hostile",
    title: `<script>alert("x")</script> & 'quotes' "both" \\backslash\\`,
    context: "A </div>, a tab\tand a newline\nand <b>markup</b> & an &amp; entity.",
    alternatives: "5 > 3 && 3 < 5",
    owner: "O'Brien & Co <ops>",
    status: "accepted",
    createdAt: "2026-07-25T10:00:00.000Z",
  };
  const { text } = await capture(storage({ [STORAGE_KEY]: JSON.stringify([hostile]) }));

  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.decisions, [hostile], "a record did not round-trip through the file byte for byte");
  assert.equal(parsed.record_count, 1);
  // The bytes are JSON escapes, never HTML entities: nothing on this path
  // escapes for a document, because nothing on this path writes one.
  assert.ok(text.includes("\\\\backslash\\\\"), "a backslash was not JSON-escaped");
  assert.ok(!text.includes("&amp;lt;"), "a value was HTML-escaped on the way into the file");
});

test("the button's accessible name states the filtered scope, and nothing when unfiltered", () => {
  assert.equal(shiplogExportLabel({ decisions: 9, releases: 3, filtered: true }),
    "Download JSON: export 12 filtered records");
  assert.equal(shiplogExportLabel({ decisions: 1, releases: 0, filtered: true }),
    "Download JSON: export 1 filtered record");
  // Zero is a scope like any other: the control still says what it will write.
  assert.equal(shiplogExportLabel({ decisions: 0, releases: 0, filtered: true }),
    "Download JSON: export 0 filtered records");
  assert.equal(shiplogExportLabel({ decisions: 9, releases: 3 }), "",
    "an unfiltered export restates the visible label instead of leaving it alone");
  assert.equal(shiplogExportLabel(), "");
});

test("a filtered download is announced in the visitor's own numbers", () => {
  assert.equal(exportedRecordSentence({ recordCount: 12, filtered: true }), "Exported 12 filtered records.");
  assert.equal(exportedRecordSentence({ recordCount: 1, filtered: true }), "Exported 1 filtered record.");
  assert.equal(exportedRecordSentence({ recordCount: 0, filtered: true }), "Exported 0 filtered records.");
  assert.equal(exportedRecordSentence({ recordCount: 12 }), EXPORT_STATUS.exported);
  assert.equal(exportedRecordSentence(), EXPORT_STATUS.exported);
  assert.equal(
    describeShiplogExport({ recordCount: 2, filtered: true, excludedLinks: [{}] }),
    "Exported 2 filtered records. 1 release link to a decision your filters hide was left out.",
  );
});

test("the export panel keeps the button's name in step with the filtered scope", () => {
  const listeners = {};
  const attributes = {};
  const button = {
    addEventListener(type, listener) { listeners[type] = listener; },
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
  };
  const status = { textContent: "" };
  const root = {
    querySelector(selector) {
      return {
        "#export-shiplog": button,
        "#export-shiplog-counts": { textContent: "" },
        "#export-shiplog-status": status,
      }[selector] ?? null;
    },
  };

  initShiplogExport(root, populatedStorage(), { now: () => new Date(GENERATED_AT), download() {} });
  assert.equal(attributes["aria-label"], undefined, "an unfiltered panel names a scope it does not have");

  publishHistoryScope(root, {
    filtered: true,
    decisionIds: ["d-queue"],
    releaseIds: [],
    filters: { status: "accepted" },
  });
  assert.equal(attributes["aria-label"], "Download JSON: export 1 filtered record");

  listeners.click();
  assert.equal(status.textContent, "Exported 1 filtered record.");

  publishHistoryScope(root, FULL_HISTORY_SCOPE);
  assert.equal(attributes["aria-label"], undefined, "the filtered name outlived the filter");
});

test("decision page exposes and initializes the pre-download export summary", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /id="export-shiplog-counts"/);
  assert.match(html, /id="export-shiplog"/);
  assert.match(html, /src="\/shiplog-export-page\.js"/);
});
