// The hostile half of the decision recorder: what a submitted status may be,
// what a field exactly at its limit is stored as, and whether a recorded value
// can ever become an element.
//
// tests/decision-entry.test.js pins the rules a person types against and
// tests/decision-entry-flow.test.js drives the form. This file covers the three
// things neither of them can:
//
//   1. The status allow-list the *recorder* is held to, which is narrower than
//      the set a stored record may carry.
//   2. The boundary itself. Over-limit rejection is already pinned; what was
//      not is that a field exactly at its limit survives the write at full
//      length. A silent truncation passes every over-limit test there is.
//   3. A source-level guard on the render path. The page harness parses no
//      markup at all, so a page-level "the payload did not execute" assertion
//      cannot fail from an innerHTML regression — it would keep passing while
//      the shipped page started parsing a visitor's text. The render half is
//      pinned at the source instead, and the builders are exercised directly
//      against the element stub.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement, installDocument, tags, walk } from "./support/dom.js";

installDocument();

import {
  DECISION_ENTRY_ERRORS,
  DECISION_ENTRY_LIMITS,
  DECISION_ENTRY_STATUSES,
  decisionEntryFieldError,
  validateDecisionEntry,
} from "../src/decision-entry.js";
import { STORED_DECISION_STATUSES } from "../src/decision-status.js";
import { STORAGE_KEY, createDecision, loadDecisions, saveDecisions, renderDecisions } from "../src/app.js";
import { renderDecisionDetail } from "../src/decision-detail.js";

// The four payloads this file is written against. Each is a different shape of
// the same attack — a tag, an attribute handler, an attribute break-out, and a
// scheme — because a defense that only survives `<script>` is a defense against
// one string rather than against parsing.
const PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '"><svg onload=alert(1)>',
  "javascript:alert(document.domain)",
];

const VALID = {
  title: "Adopt a durable job queue",
  context: "Background work was lost on deploys; move to an at-least-once queue.",
  alternatives: "Database polling and in-process retries.",
  owner: "Tess",
  status: "accepted",
};

// The elements a render produced, as opposed to the text it wrote. The stub
// keeps text nodes in `children` alongside elements and gives them a truthy
// tagName, so they are told apart by the one thing only a real element has: a
// tag that is not the text-node marker.
const elementsIn = (node) => walk(node, (candidate) => candidate !== node)
  .filter((candidate) => !candidate.tagName.startsWith("#"));

// A fresh storage object per test, so nothing here depends on order.
const emptyStorage = () => {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, String(value)); },
    removeItem: (key) => { entries.delete(key); },
  };
};

// ---------------------------------------------------------------------------
// 1. The status allow-list.
// ---------------------------------------------------------------------------

test("the recorder's status allow-list is the two the form offers, and each is a storable value", () => {
  assert.deepEqual([...DECISION_ENTRY_STATUSES], ["pending", "accepted"]);
  for (const status of DECISION_ENTRY_STATUSES) {
    assert.ok(
      STORED_DECISION_STATUSES.includes(status),
      `the recorder offers ${status}, which is not a value a record may carry`,
    );
  }
});

test("a status outside the recorder's allow-list is refused by the validator", () => {
  // Not "non-empty", and not the wider stored vocabulary. The harness's select
  // double accepts any value it is assigned, and a real browser will happily
  // post a form body that never came from the select at all — so this is the
  // only layer that can refuse these, and it is asserted at the layer that
  // refuses them.
  const refused = [
    "superseded", // the supersede path owns this state; nothing proves the replacement exists
    "proposed", // the form does not offer it
    "approved", // a legacy stored word, never minted fresh
    "SHIPPED", // the comparison is exact, not case-folded
    ...PAYLOADS,
  ];
  for (const status of refused) {
    assert.equal(
      decisionEntryFieldError("status", status, { statuses: DECISION_ENTRY_STATUSES }),
      DECISION_ENTRY_ERRORS.status.invalid,
      `the recorder accepted the status ${JSON.stringify(status)}`,
    );
  }
  // Padding is not a different value: the status is trimmed before it is
  // compared, the same way every other field is, so a submitted "accepted "
  // is the option it came from rather than an unknown word.
  for (const status of DECISION_ENTRY_STATUSES) {
    for (const submitted of [status, ` ${status}`, `${status}\n`]) {
      assert.equal(
        decisionEntryFieldError("status", submitted, { statuses: DECISION_ENTRY_STATUSES }),
        null,
        JSON.stringify(submitted),
      );
    }
  }
});

test("a refused status is reported as the status field, and blocks the whole entry", () => {
  const failures = validateDecisionEntry(
    { ...VALID, status: "superseded" },
    { statuses: DECISION_ENTRY_STATUSES },
  );
  assert.deepEqual(failures, [{ field: "status", message: DECISION_ENTRY_ERRORS.status.invalid }]);
  // The message names the choice rather than the rejected word: echoing a
  // submitted value back into a message puts it in a second place on the page.
  assert.equal(failures[0].message.includes("superseded"), false);
});

// ---------------------------------------------------------------------------
// 2. The boundary. At the limit is kept whole; one over is refused.
// ---------------------------------------------------------------------------

test("a field exactly at its limit is stored at full length, never shortened", () => {
  for (const [field, limit] of Object.entries(DECISION_ENTRY_LIMITS)) {
    const atLimit = "x".repeat(limit);
    const storage = emptyStorage();
    const decision = createDecision({ ...VALID, [field]: atLimit });

    assert.equal(decision[field].length, limit, `createDecision shortened ${field} at its limit`);
    assert.equal(decision[field], atLimit, `createDecision altered ${field} at its limit`);

    // And through the store, which is the other place a bound could be applied
    // as a trim instead of as a refusal.
    saveDecisions(storage, [decision]);
    const [reloaded] = loadDecisions(storage);
    assert.ok(reloaded, `a record with ${field} at its limit did not survive storage`);
    assert.equal(reloaded[field].length, limit, `storage shortened ${field} at its limit`);
    assert.equal(reloaded[field], atLimit, `storage altered ${field} at its limit`);
  }
});

test("one character over the limit is refused, and the refusal names the limit", () => {
  for (const [field, limit] of Object.entries(DECISION_ENTRY_LIMITS)) {
    const over = "x".repeat(limit + 1);
    const message = DECISION_ENTRY_ERRORS[field].tooLong(limit + 1);
    assert.equal(decisionEntryFieldError(field, over), message, `${field} at limit + 1`);
    assert.match(message, new RegExp(String(limit)), `${field}'s refusal does not state its limit`);

    // The write path refuses it too, so a caller that skips the form cannot
    // land a record the form would have turned away.
    const storage = emptyStorage();
    assert.throws(
      () => createDecision({ ...VALID, [field]: over }),
      (error) => error.message === message,
      `createDecision accepted ${field} at limit + 1`,
    );
    assert.deepEqual(loadDecisions(storage), [], `a refused entry reached storage for ${field}`);
  }
});

test("leading and trailing whitespace is trimmed before the length is measured, and the trimmed value is what is stored", () => {
  // A padded value that is within the limit once trimmed is a valid entry, and
  // what is kept is the trimmed text — not the padding, and not a slice of it.
  const padded = `   ${"x".repeat(DECISION_ENTRY_LIMITS.owner)}   `;
  assert.equal(decisionEntryFieldError("owner", padded), null, "padding was counted against the limit");
  const decision = createDecision({ ...VALID, owner: padded });
  assert.equal(decision.owner.length, DECISION_ENTRY_LIMITS.owner);
  assert.equal(decision.owner, "x".repeat(DECISION_ENTRY_LIMITS.owner));
});

// ---------------------------------------------------------------------------
// 3. Inert rendering: at the source, and through the builders.
// ---------------------------------------------------------------------------

// Every module that reads a stored decision and puts it on a screen. Listed by
// hand rather than globbed, because the point of the list is that somebody
// enumerated the surfaces:
//
//   app.js                  the decision log on / — the row, the record status
//                           line, the supersedes picker, the linked-record chips
//   decision-detail.js      the record on /decision.html
//   decision-outcome-view.js the recorded-outcome panel on /decision.html
//   decision-page.js        that page's document title
//   decision-status.js      the status vocabulary every badge reads
//   decision-entry.js       the recorder's rules and its messages
//   releases.js             the linked decisions on a release detail page
//   releases-page.js        the decision filter on /releases.html
//   release-form.js         the decision picker in the release recorder
//   shiplog-export.js       the export file every record leaves in
const DECISION_MODULES = [
  "app.js",
  "decision-detail.js",
  "decision-entry.js",
  "decision-outcome-view.js",
  "decision-page.js",
  "decision-status.js",
  "release-form.js",
  "releases-page.js",
  "releases.js",
  "shiplog-export.js",
];

// A plain substring check, deliberately. It refuses these names in comments as
// well as in code, which is the property that makes it something anybody can
// check by eye: there is no parsing, no allow-list of "safe" uses, and nothing
// to reason about before believing the result. A module that needs to talk
// about one of them can say "the innerHTML property" without the parenthesis.
const FORBIDDEN_SINKS = ["innerHTML", "insertAdjacentHTML", "outerHTML", "document.write"];

test("no module on the decision path names a markup-parsing sink", async () => {
  for (const module of DECISION_MODULES) {
    const source = await readFile(new URL(`../src/${module}`, import.meta.url), "utf8");
    for (const sink of FORBIDDEN_SINKS) {
      assert.equal(
        source.includes(sink),
        false,
        `src/${module} names ${sink}; a decision's text must never reach a markup parser`,
      );
    }
  }
});

test("a hostile decision renders as text in the log row, and builds nothing", () => {
  for (const payload of PAYLOADS) {
    const container = createElement("div");
    const count = createElement("p");
    renderDecisions(container, count, [{
      id: "decision-1",
      title: payload,
      context: payload,
      alternatives: payload,
      owner: payload,
      status: "accepted",
      createdAt: "2026-07-01T00:00:00.000Z",
    }], {});

    const heading = tags(container, "H3")[0];
    assert.ok(heading, "the log row has no title");
    assert.equal(heading.textContent, payload, `the row title is not the literal ${payload}`);
    assert.equal(elementsIn(heading).length, 0, "the row title built an element out of a recorded value");

    // The payload survived as characters rather than being escaped into
    // entities: nothing parsed it, so nothing had to encode it either.
    assert.equal(container.textContent.includes(payload), true, "the row did not carry the recorded characters");
    assert.equal(container.textContent.includes("&lt;"), false, "the row escaped a recorded value as markup");

    // And none of the four shapes reached the tree as a tag.
    for (const tagName of ["SCRIPT", "IMG", "SVG", "B", "IFRAME"]) {
      assert.equal(tags(container, tagName).length, 0, `a recorded value produced a ${tagName} element`);
    }
  }
});

test("a hostile decision renders as text on the detail page, and builds nothing", () => {
  for (const payload of PAYLOADS) {
    const container = createElement("div");
    renderDecisionDetail(container, {
      id: "decision-1",
      title: payload,
      context: payload,
      alternatives: payload,
      owner: payload,
      status: "accepted",
      createdAt: "2026-07-01T00:00:00.000Z",
    });

    const heading = tags(container, "H1")[0];
    assert.ok(heading, "the detail page has no heading");
    assert.equal(heading.textContent, payload, `the heading is not the literal ${payload}`);
    assert.equal(elementsIn(heading).length, 0, "the heading built an element out of a recorded value");

    assert.equal(container.textContent.includes(payload), true, "the detail page dropped the recorded characters");
    assert.equal(container.textContent.includes("&lt;"), false, "the detail page escaped a recorded value as markup");
    for (const tagName of ["SCRIPT", "IMG", "SVG", "B", "IFRAME"]) {
      assert.equal(tags(container, tagName).length, 0, `a recorded value produced a ${tagName} element`);
    }
  }
});

test("a javascript: payload never becomes a link target", () => {
  // The one payload that does not need a parser to be dangerous: it only needs
  // somewhere that treats a recorded string as a URL. Nothing on the decision
  // path does — every href here is built from an id, through
  // encodeURIComponent — and this is what says so.
  const payload = "javascript:alert(document.domain)";
  const container = createElement("div");
  const count = createElement("p");
  renderDecisions(container, count, [{
    id: payload,
    title: payload,
    context: payload,
    alternatives: payload,
    owner: payload,
    status: "accepted",
    createdAt: "2026-07-01T00:00:00.000Z",
  }], {});

  const links = tags(container, "A");
  assert.ok(links.length > 0, "the row has no link to check");
  for (const link of links) {
    const href = link.href ?? link.getAttribute("href") ?? "";
    assert.equal(href.startsWith("javascript:"), false, `a recorded value became the link target ${href}`);
    assert.match(href, /^\//, `a decision link points somewhere other than this site: ${href}`);
  }
});
