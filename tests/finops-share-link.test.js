// A FinOps lead's own analysis, sent as a link (#1206).
//
// THE DEFECT THIS EXISTS TO CATCH. A link to this page opened the bundled
// invented company on the recipient's screen, whatever the sender was looking
// at. The properties held here are the four that make a shared link safe to
// send and safe to open:
//
//   1. WHAT GOES IN COMES OUT. The recoverable figure, the first destination and
//      the confidence grade survive a round trip byte for byte.
//   2. A BAD LINK FAILS BY NAME. Unknown version, over-size, malformed and
//      incomplete each decode to their own reason with their own sentence, and
//      none of them throws or returns a payload.
//   3. THE PAYLOAD IS FRAGMENT-ONLY. It is never in the query string, and a
//      decode never writes to the reader's retained workspace records.
//   4. THE EXISTING DEEP LINKS ARE UNCHANGED. `?payload=bundled` and a plain
//      `#anchor` still resolve to what they resolved to before.
//
// The DOM half runs against the shipped markup, like the copy control's tests.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import {
  MAX_SHARE_TOKEN, SHARE_FRAGMENT_KEY, SHARE_REASON, SHARE_REASON_MESSAGE, SHARE_SCHEMA_VERSION,
  buildShareLink, decodeShareToken, encodeShareToken, shareFragment, tokenFromFragment,
} from "../src/finops-share-codec.js";
import {
  ANSWER_SHARE_IDS, ANSWER_SHARE_LABEL, ANSWER_SHARE_REASON, applyAnswerShare, applyShareNotice,
  bindAnswerShare, buildAnswerShare,
} from "../src/finops-answer-share.js";
import {
  ANSWER_SOURCE, SHAREABLE_ANSWER, createAnswerState, projectAnswer, shareableAnswer,
} from "../src/answer-state.js";
import { buildStandHeadline, sharedStandHeadline } from "../src/finops-stand.js";
import { applyStandHeadline } from "../src/finops-stand-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

const LOCATION = Object.freeze({ origin: "https://labs.wawalu.org", pathname: "/evolution.html" });

/** The bundled answer, which is a real composed one and needs no fixture file. */
const bundledAnswer = () => projectAnswer(buildStandHeadline(), ANSWER_SOURCE.synthetic);

/** base64url over UTF-8, so a payload with a diamond or an accent in it encodes. */
const b64url = (value) => btoa(encodeURIComponent(JSON.stringify(value))
  .replace(/%([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------------------------------------------------------------------------
// 1. The round trip.
// ---------------------------------------------------------------------------

test("an encoded answer decodes to the same figure, destination and grade", () => {
  const answer = bundledAnswer();
  const token = encodeShareToken(answer);
  assert.ok(token.length > 0, "the bundled answer produced no token");

  const decoded = decodeShareToken(token);
  assert.equal(decoded.ok, true, `a token this build wrote was refused: ${decoded.reason}`);
  assert.equal(decoded.reason, SHARE_REASON.ok);
  // The three the issue names, each on its own so a failure says which drifted.
  assert.equal(decoded.payload.metric.value, answer.metric.value);
  assert.equal(decoded.payload.metric.basis, answer.metric.basis);
  assert.equal(decoded.payload.action.label, answer.action.label);
  assert.equal(decoded.payload.grade.grade, answer.grade.grade);
  assert.equal(decoded.payload.grade.label, answer.grade.label);
  // …and the whole allowlisted payload, so a field added later is caught too.
  assert.deepEqual(decoded.payload, shareableAnswer(answer));
});

test("a decoded payload paints as the sender's answer, not the bundled example", () => {
  const decoded = decodeShareToken(encodeShareToken(bundledAnswer()));
  const headline = sharedStandHeadline(decoded.payload);
  assert.equal(headline.source, "shared");
  assert.equal(headline.recoverable.value, decoded.payload.metric.value);
  assert.equal(headline.action.label, decoded.payload.action.label);
  // Nowhere to navigate a stranger's browser: no href travels in a link.
  assert.equal(headline.action.href, null);
  // The floor is absent by name rather than as a zero somebody could quote.
  assert.equal(headline.recoverableFloor.available, false);
  assert.match(headline.recoverableFloor.value, /Not carried in a shared link/);
});

test("the answer state adopts a shared payload and says which source it is on", () => {
  const state = createAnswerState();
  const token = encodeShareToken(bundledAnswer());
  const outcome = state.setShared(decodeShareToken(token).payload);
  assert.equal(outcome.committed, true);
  assert.equal(state.getSource(), ANSWER_SOURCE.shared);
  assert.equal(state.getHeadline().source, "shared");
  // …and a payload that is not one leaves the held answer standing.
  const held = state.getAnswer();
  assert.equal(state.setShared({ question: "" }).committed, false);
  assert.equal(state.getAnswer(), held, "a refused payload replaced the held answer");
});

// ---------------------------------------------------------------------------
// 2. Every rejection, by name.
// ---------------------------------------------------------------------------

test("an unknown schema version is refused by name, not read", () => {
  const payload = shareableAnswer(bundledAnswer());
  const decoded = decodeShareToken(b64url({ v: SHARE_SCHEMA_VERSION + 1, a: payload }));
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, SHARE_REASON.version);
  assert.equal(decoded.payload, null);
  assert.match(decoded.message, /newer version/);
});

test("an over-size token is refused before it is parsed", () => {
  // Generated here rather than committed: a fixture of this size is bytes in
  // the repository for a property one line of code can produce.
  const decoded = decodeShareToken("a".repeat(MAX_SHARE_TOKEN + 1));
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, SHARE_REASON.oversize);
  assert.equal(decoded.payload, null);
  assert.match(decoded.message, /longer than this page will read/);
});

test("malformed tokens of every kind are refused by name and never throw", () => {
  const valid = encodeShareToken(bundledAnswer());
  const cases = [
    ["outside the base64url alphabet", "not a token!!"],
    ["truncated", valid.slice(0, Math.floor(valid.length / 2))],
    ["not an object", b64url(["v", 1])],
    ["an envelope with no payload", b64url({ v: SHARE_SCHEMA_VERSION })],
  ];
  for (const [what, token] of cases) {
    const decoded = decodeShareToken(token);
    assert.equal(decoded.ok, false, `${what} decoded as if it were valid`);
    assert.equal(decoded.reason, SHARE_REASON.malformed, `${what} got the wrong reason`);
    assert.equal(decoded.payload, null);
  }
});

test("a payload missing a required field, or carrying the wrong type, is incomplete", () => {
  const payload = shareableAnswer(bundledAnswer());
  const withoutFigure = { ...payload, metric: { ...payload.metric, available: false } };
  const wrongType = { ...payload, question: 42 };
  const noSlot = { ...payload, grade: undefined };
  for (const [what, broken] of [["no figure", withoutFigure], ["wrong type", wrongType],
    ["a missing slot", noSlot]]) {
    const decoded = decodeShareToken(b64url({ v: SHARE_SCHEMA_VERSION, a: broken }));
    assert.equal(decoded.ok, false, `${what} decoded as if it were whole`);
    assert.equal(decoded.reason, SHARE_REASON.incomplete, `${what} got the wrong reason`);
  }
});

test("every reason in the closed set has its own sentence for the reader", () => {
  for (const reason of Object.values(SHARE_REASON)) {
    assert.equal(typeof SHARE_REASON_MESSAGE[reason], "string", `${reason} has no message`);
  }
  // The two silent ones are silent on purpose; every failure states itself.
  for (const reason of [SHARE_REASON.oversize, SHARE_REASON.version, SHARE_REASON.malformed,
    SHARE_REASON.incomplete]) {
    assert.ok(SHARE_REASON_MESSAGE[reason].length > 80, `${reason} says too little`);
    assert.match(SHARE_REASON_MESSAGE[reason], /Nothing of yours was changed/,
      `${reason} does not tell the reader their own figures are untouched`);
  }
  assert.equal(decodeShareToken(null).reason, SHARE_REASON.absent);
  assert.equal(decodeShareToken("").reason, SHARE_REASON.absent);
});

// ---------------------------------------------------------------------------
// 3. The boundary: fragment only, and no write.
// ---------------------------------------------------------------------------

test("the encoded payload rides in the fragment and never in the query string", () => {
  const link = buildShareLink(bundledAnswer(), LOCATION);
  const url = new URL(link);
  assert.equal(url.search, "", `the payload reached the query string: ${url.search}`);
  assert.equal(url.pathname, "/evolution.html");
  assert.ok(url.hash.startsWith(`#${SHARE_FRAGMENT_KEY}=`), `the token is not in the fragment: ${url.hash}`);
  assert.equal(tokenFromFragment(url.hash), encodeShareToken(bundledAnswer()));
  // A sender who arrived with a query string of their own does not forward it.
  const noisy = buildShareLink(bundledAnswer(),
    { ...LOCATION, search: "?payload=bundled", hash: "#analysis=old" });
  assert.equal(new URL(noisy).search, "");
  assert.equal(new URL(noisy).hash.split("=").length, 2, "two tokens were stacked in one link");
});

test("decoding a shared link writes nothing to the retained workspace records", () => {
  const writes = [];
  const storage = {
    getItem: (key) => { writes.push(["getItem", key]); return null; },
    setItem: (key, value) => writes.push(["setItem", key, value]),
    removeItem: (key) => writes.push(["removeItem", key]),
  };
  // Installed for the duration: a decode that reached storage at all would have
  // to reach this one, and a write would be recorded above.
  const had = Object.hasOwn(globalThis, "localStorage");
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  try {
    const decoded = decodeShareToken(encodeShareToken(bundledAnswer()));
    assert.equal(decoded.ok, true);
    createAnswerState().setShared(decoded.payload);
  } finally {
    if (had) Object.defineProperty(globalThis, "localStorage", { value: previous, configurable: true });
    else delete globalThis.localStorage;
  }
  assert.deepEqual(writes.filter(([call]) => call !== "getItem"), [],
    `opening a shared link wrote to this browser's retained records: ${JSON.stringify(writes)}`);
});

test("the allowlist is the one the codec encodes, and it carries no rows", () => {
  const payload = shareableAnswer(bundledAnswer());
  assert.deepEqual(Object.keys(payload).sort(),
    [...SHAREABLE_ANSWER.strings, ...Object.keys(SHAREABLE_ANSWER.slots)].sort());
  // Nothing row-shaped, nothing per-department, no filename: the drill-down the
  // bounded answer holds is not on the list and must not have travelled.
  assert.equal(payload.departments, undefined);
  assert.equal(payload.withheld, undefined);
  assert.equal(payload.source, undefined);
});

// ---------------------------------------------------------------------------
// 4. The existing deep links, unchanged.
// ---------------------------------------------------------------------------

test("the existing deep links still resolve to what they resolved to", () => {
  // A bundled payload deep link is a QUERY parameter and is not touched here.
  assert.equal(tokenFromFragment(""), null);
  assert.equal(tokenFromFragment("#trend-title"), null);
  assert.equal(tokenFromFragment("#recommendation-evidence"), null);
  assert.equal(decodeShareToken(tokenFromFragment("#trend-title")).reason, SHARE_REASON.absent);
  const bundled = new URL("https://labs.wawalu.org/executive-briefing.html?payload=bundled");
  assert.equal(new URLSearchParams(bundled.search).get("payload"), "bundled");
  assert.equal(tokenFromFragment(bundled.hash), null);
  // …and a fragment that carries a token beside an anchor still finds it.
  assert.equal(tokenFromFragment("#other=1&analysis=abc"), "abc");
  assert.equal(shareFragment(""), "");
});

// ---------------------------------------------------------------------------
// 5. The control, in the shipped markup.
// ---------------------------------------------------------------------------

test("the control is authored, named, and reachable by keyboard", () => {
  const document = parseHtml(html);
  const button = document.getElementById(ANSWER_SHARE_IDS.button);
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(textOf(button), ANSWER_SHARE_LABEL,
    "the control's accessible name does not say what it copies");
  assert.equal(button.getAttribute("aria-describedby"),
    `${ANSWER_SHARE_IDS.lead} ${ANSWER_SHARE_IDS.status}`);
  const status = document.getElementById(ANSWER_SHARE_IDS.status);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(textOf(status), "", "the status line speaks before anything was pressed");
  // …and it is NOT a tab stop before there is anything to share: the block ships
  // hidden, which is the empty-state decision this control made.
  assert.equal(tabSequence(document).filter((node) => node.id === ANSWER_SHARE_IDS.button).length, 0,
    "the control is in the tab order over an answer that has not been composed");
});

test("with nothing to share the block is hidden and says why", () => {
  const document = parseHtml(html);
  // The authored state, before any script has run: nothing is composed.
  assert.equal(document.getElementById(ANSWER_SHARE_IDS.block).hasAttribute("hidden"), true);
  assert.equal(document.getElementById(ANSWER_SHARE_IDS.block).dataset.reason,
    ANSWER_SHARE_REASON.noAnswer);

  assert.equal(applyAnswerShare(document, null, LOCATION), null);
  assert.equal(document.getElementById(ANSWER_SHARE_IDS.block).hidden, true);
  assert.equal(document.getElementById(ANSWER_SHARE_IDS.block).dataset.reason,
    ANSWER_SHARE_REASON.noAnswer);

  // An answer with no figure in it is a link to nothing, and is not offered.
  const empty = { ...bundledAnswer(), metric: { available: false, label: "", value: "", basis: "" } };
  assert.equal(buildAnswerShare(empty, LOCATION).reason, ANSWER_SHARE_REASON.noFigure);
  applyAnswerShare(document, empty, LOCATION);
  assert.equal(document.getElementById(ANSWER_SHARE_IDS.block).hidden, true);
  assert.equal(document.getElementById(ANSWER_SHARE_IDS.text).value, "");
});

test("a painted answer fills the box with the link the button copies", async () => {
  const document = parseHtml(html);
  applyStandHeadline(document, buildStandHeadline(), { announce: false });
  const block = document.getElementById(ANSWER_SHARE_IDS.block);
  assert.equal(block.hidden, false, "an answer with a figure offered no link");
  assert.equal(block.dataset.reason, ANSWER_SHARE_REASON.shareable);
  const box = document.getElementById(ANSWER_SHARE_IDS.text);
  assert.ok(box.value.includes(`#${SHARE_FRAGMENT_KEY}=`), `the box holds no link: ${box.value}`);
  assert.equal(box.value.includes("?"), false, "the link on screen carries a query string");
  assert.equal(tabSequence(document).filter((node) => node.id === ANSWER_SHARE_IDS.button).length, 1,
    "the revealed control cannot be reached from the keyboard");

  const copied = [];
  bindAnswerShare(document, { clipboard: { writeText: async (text) => copied.push(text) } });
  document.getElementById(ANSWER_SHARE_IDS.button).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(copied, [box.value], "the clipboard did not get the link on screen");
  const status = document.getElementById(ANSWER_SHARE_IDS.status);
  assert.equal(status.dataset.outcome, "copied");
  assert.ok(textOf(status).length > 0, "a copy that happened was not announced");
});

test("a link that did not open says which named reason it was", () => {
  const document = parseHtml(html);
  const notice = document.getElementById(ANSWER_SHARE_IDS.notice);
  assert.equal(notice.hasAttribute("hidden"), true, "the notice is on screen before any bad link");

  applyShareNotice(document, decodeShareToken("not a token!!"));
  assert.equal(notice.hidden, false);
  assert.equal(notice.dataset.reason, SHARE_REASON.malformed);
  assert.equal(textOf(notice), SHARE_REASON_MESSAGE[SHARE_REASON.malformed]);

  // …and no fragment at all is not a failure and says nothing.
  applyShareNotice(document, decodeShareToken(tokenFromFragment("")));
  assert.equal(notice.hidden, true);
  assert.equal(textOf(notice), "");
  assert.equal(notice.dataset.reason, "none");
});
