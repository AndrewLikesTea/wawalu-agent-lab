// The bring-your-own-export intake, driven end to end against the shipped page.
//
// This file covers the path a reader actually walks: they do not have an export
// yet, they are told where to ask for one, what it arrives as, and which file to
// choose out of it; they choose it; and the page either reads it or refuses it
// in a state that ends on a control rather than on a paragraph.
//
// Three things are asserted that no other test file asserts:
//
//   1. the source guidance is real, keyboard-operable, and says something
//      *different* per source — including saying plainly when the container a
//      vendor delivers is one this tab does not open;
//   2. a supported archive is read end to end through the page, from a ZIP this
//      test builds byte by byte rather than from a committed binary;
//   3. every answerless state — a sampled history that clears no floor, a
//      history too short to grade, and a refused archive — states one coverage
//      figure, restates that nothing left the tab, and ends on one control that
//      a keyboard reaches and activates.
//
// The harness supplies the browser's File API, because a headless DOM cannot
// open a picker: a selection is the `{ name, size, text(), arrayBuffer() }`
// shape the page reads. `loadPage` is given no routes, so any request at all
// throws — an intake that grew a fetch fails here rather than in production.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, pressEnter, pressKey, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { personalHistoryPreviewJson } from "../src/personal-history-fixture.js";
import { PERSONAL_ARCHIVE_MEMBERS, PERSONAL_ARCHIVE_OUTCOME } from "../src/personal-archive.js";
import { PERSONAL_ENTRY_REFUSAL } from "../src/personal-history-entry.js";
import { PERSONAL_NOT_ELIGIBLE, PERSONAL_READER_LIMITS } from "../src/personal-history-contract.js";

const PAGE = new URL("../src/personal-history.html", import.meta.url);
const MEMBER = PERSONAL_ARCHIVE_MEMBERS[0];

/* ----------------------------- a ZIP, by hand ----------------------------- */
//
// Stored members only: this builder exists to hand the page a *container*, and
// the compression paths are already driven byte by byte in personal-archive.test.js.
// Nothing is committed — a ZIP fixture in the repository is a binary nobody
// reviews, and the malformed cases are cases about bytes.

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
};

/** @param members `{ name, text }`, stored uncompressed. */
function buildArchive(members) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const member of members) {
    const data = encoder.encode(member.text);
    const name = encoder.encode(member.name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.byteLength, true);
    lv.setUint32(22, data.byteLength, true);
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    locals.push(local, data);

    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.byteLength, true);
    cv.setUint32(24, data.byteLength, true);
    cv.setUint16(28, name.byteLength, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.byteLength + data.byteLength;
  }

  const directory = concat(centrals);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, members.length, true);
  ev.setUint16(10, members.length, true);
  ev.setUint32(12, directory.byteLength, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, directory, eocd]);
}

/**
 * Locate the central record in an archive built above. These mutations model
 * provider downloads that made it as far as the picker but cannot safely be
 * opened: encryption is unsupported, while a changed payload fails integrity.
 */
function centralRecordOffset(bytes) {
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true) === 0x02014b50) {
      return offset;
    }
  }
  throw new Error("test archive has no central record");
}

function encryptedArchive(text) {
  const bytes = buildArchive([{ name: MEMBER, text }]);
  const central = centralRecordOffset(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(6, view.getUint16(6, true) | 0x0001, true);
  view.setUint16(central + 8, view.getUint16(central + 8, true) | 0x0001, true);
  return bytes;
}

function integrityBrokenArchive(text) {
  const bytes = buildArchive([{ name: MEMBER, text }]);
  // The member begins immediately after the fixed local header and its name.
  // Change one payload byte without changing the CRC recorded in either header.
  bytes[30 + encoder.encode(MEMBER).byteLength] ^= 0xff;
  return bytes;
}

/* -------------------------------- the page -------------------------------- */

async function openPage() {
  const page = await loadPage(PAGE);
  await importPageModule("/personal-history-page.js");
  return page;
}

const byId = (document, id) => document.getElementById(id);
const result = (document) => byId(document, "personal-history-result");
const panel = (document) => result(document).querySelector(".ph-state");
const report = (document) => result(document).querySelector(".ph-report");

function chooseFile(document, file) {
  const input = byId(document, "personal-history-file");
  input.files = [file];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return input;
}

/** A chosen archive: bytes for `.zip`, and the size the picker would report. */
const archiveFile = (name, bytes) => ({
  name,
  size: bytes.byteLength,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  text: async () => { throw new Error("an archive is read as bytes, never as text"); },
});

const textFile = (name, text) => ({ name, size: text.length, text: async () => text });

/** The refusal, not the progress panel that precedes it — both are `.ph-state`. */
const refusalPainted = (document, description) =>
  waitFor(() => (panel(document)?.dataset.state === "error" ? panel(document) : null), description);

const nextStep = (document) => (report(document) ?? panel(document))?.querySelector(".ph-next");

/* --------------------------- where to get a file --------------------------- */

test("the page says where to ask for an export, per assistant, before a file is chosen", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const sources = byId(document, "personal-history-sources");
    assert.match(textOf(sources), /nothing is uploaded/i, "the promise is above the guidance");

    const radios = sources.querySelectorAll("input[type=radio]");
    assert.ok(radios.length >= 3, "a reader picks their assistant rather than reading four sections");
    assert.equal(radios.filter((radio) => radio.checked).length, 1,
      "exactly one source is selected, so the panel below is never ambiguous");
    for (const radio of radios) {
      assert.equal(radio.getAttribute("aria-controls"), "personal-history-source-panel",
        "each option names the panel it governs");
      assert.ok(document.querySelector(`label[for="${radio.id}"]`),
        "every radio has a label a pointer and a screen reader can both use");
    }

    // The four terms, in one order, for whichever source is selected.
    const shown = byId(document, "personal-history-source-panel");
    assert.deepEqual(shown.querySelectorAll("dt").map((node) => node.dataset.term),
      ["ask-for", "arrives-as", "accepted", "leave-out"]);
    assert.equal(shown.getAttribute("role"), "region");
    assert.match(shown.getAttribute("aria-label"), /How to export from/);
    assert.match(textOf(shown), /Settings/, "the console path is on the panel");
    assert.match(textOf(shown), new RegExp(MEMBER), "and the member this page opens out of it");
  } finally {
    page.restore();
  }
});

test("arrowing to another assistant swaps the guidance and keeps the reader's focus", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const first = byId(document, "personal-history-source-chatgpt");
    const before = textOf(byId(document, "personal-history-source-panel"));
    first.focus();

    pressKey(document, "ArrowDown");
    const chosen = document.activeElement;
    assert.equal(chosen.getAttribute("name"), "personal-history-source",
      "the arrow key moves within the group, which is what a radio group is for");
    assert.ok(chosen.checked, "and selects what it moved to");

    const after = byId(document, "personal-history-source-panel");
    assert.equal(after.dataset.source, chosen.getAttribute("value"),
      "the panel follows the selection");
    assert.notEqual(textOf(after), before, "and says something different, or it is decoration");
    assert.equal(document.activeElement, chosen,
      "swapping the panel must not take the reader's focus with it");
  } finally {
    page.restore();
  }
});

test("a container this tab cannot open says so, and says what to do instead", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const supported = byId(document, "personal-history-source-panel");
    assert.equal(supported.dataset.archiveSupported, "true");
    assert.match(textOf(supported), /opened in this tab/i);

    byId(document, "personal-history-source-gemini").click();
    const unsupported = byId(document, "personal-history-source-panel");
    assert.equal(unsupported.dataset.archiveSupported, "false",
      "a promise to open an archive is derived from the members this reader matches on");
    assert.match(textOf(unsupported), /is not opened here/,
      "and the reader is told plainly rather than finding out at the picker");
    assert.match(textOf(unsupported), /choose the JSON inside it/i, "with the step that works");
  } finally {
    page.restore();
  }
});

test("the guidance ends on the control it is guidance for", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const jump = byId(document, "personal-history-source-panel").querySelector(".ph-source-jump");
    assert.equal(jump.getAttribute("type"), "button");
    assert.match(jump.getAttribute("aria-label"), /moves focus to the file picker/);
    jump.focus();
    pressEnter(document);
    assert.equal(document.activeElement.id, "personal-history-file",
      "a keyboard reader is put on the picker, not scrolled near it");
  } finally {
    page.restore();
  }
});

test("the static markup carries the export guidance with no script at all", async () => {
  const html = await readFile(PAGE, "utf8");
  assert.match(html, /id="personal-history-sources"/);
  assert.match(html, /ph-sources-fallback/);
  assert.match(html, /conversations\.json/,
    "the file to choose out of an archive is named before any script runs");
});

/* ------------------------------ a real archive ------------------------------ */

test("a supported archive is read end to end and grades exactly as the file inside it would", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const bytes = buildArchive([
      { name: "chat/2026-05/notes.txt", text: "a member this reader never opens" },
      { name: MEMBER, text: personalHistoryPreviewJson() },
    ]);
    chooseFile(document, archiveFile("my-export.zip", bytes));
    const article = await waitFor(() => report(document), "the archive to be read and graded");

    assert.equal(article.dataset.state, "prioritized");
    assert.equal(article.dataset.kind, "file", "an archive is the reader's own export, not the example");
    assert.equal(article.dataset.shape, "personal-conversation-json",
      "the container is a container: the member goes to the same reader a .json would");
    assert.equal(article.querySelectorAll(".ph-figure").length, 1, "one headline figure, not a dashboard");
    assert.match(textOf(article.querySelector(".ph-provenance-source")), /read in this tab/);
    assert.match(textOf(byId(document, "personal-history-status")), /read in this tab/i);
    // The archive's other member was never opened, so nothing about it is on the page.
    assert.doesNotMatch(textOf(article), /notes\.txt/);
    assert.equal(nextStep(document), null, "a result that names a move ends on the move, not on a button");
  } finally {
    page.restore();
  }
});

/* ---------------------------- the answerless states ---------------------------- */

test("a sampled history that clears no floor states the sample, the count, and one next step", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    // Over the in-tab ceiling, so the reading is sampled; every date is
    // unparseable, so nothing scores and the reading is refused on a floor.
    const rows = Array.from({ length: PERSONAL_READER_LIMITS.maxPromptEntries + 1 },
      (unused, index) => `not-a-date,draft a short note number ${index}`);
    chooseFile(document, textFile("prompts.csv", `date,prompt\n${rows.join("\n")}\n`));
    const article = await waitFor(() => report(document), "the sampled history to be refused");

    assert.equal(article.dataset.state, "not_eligible");
    // One coverage figure, in the state that has no other number in it.
    assert.equal(article.querySelectorAll(".ph-figure").length, 1);
    assert.equal(textOf(article.querySelector(".ph-figure-unit")), "prompts scored");

    const sampled = article.querySelector(".ph-lead-sampled");
    assert.ok(sampled, "a floor measured on a sample says so beside the figure that failed it");
    assert.match(textOf(sampled), /every 2th entry was read/,
      "with the stride, so the reader can tell a sample's ratio from a whole file's");
    assert.match(textOf(article.querySelector(".ph-reason")), /date/i);
    assert.equal(article.querySelector(".ph-reason").dataset.reason, PERSONAL_NOT_ELIGIBLE.noDatedPrompts);
    // Local-only, restated in the state a reader most wonders about it in.
    assert.match(textOf(article.querySelector(".ph-provenance-boundary")), /read in this tab/i);

    const step = nextStep(document);
    assert.equal(step.dataset.action, "choose_file",
      "a file this reader could not date is fixed by another file, not by waiting");
    const button = step.querySelector(".ph-next-action");
    button.focus();
    pressEnter(document);
    assert.equal(document.activeElement.id, "personal-history-file");
  } finally {
    page.restore();
  }
});

test("a history too short to grade is offered the example rather than sent back to the picker", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    chooseFile(document, textFile("thin.csv",
      "date,prompt\n2026-05-04,draft a note about the release\n2026-05-05,tighten this paragraph\n"));
    const article = await waitFor(() => report(document), "the thin history to be refused");
    assert.equal(article.dataset.state, "not_eligible");

    const step = nextStep(document);
    assert.equal(step.dataset.action, "worked_example",
      "no file they own today clears this floor, so the picker is not the answer");
    assert.equal(step.dataset.code, PERSONAL_NOT_ELIGIBLE.tooFewScoredPrompts);

    const button = step.querySelector(".ph-next-action");
    assert.match(button.getAttribute("aria-label"), /bundled invented history/);
    button.focus();
    pressEnter(document);

    const example = await waitFor(
      () => (report(document)?.dataset.kind === "preview" ? report(document) : null),
      "the worked example to be built from the refusal's own next step");
    assert.match(textOf(example.querySelector(".eyebrow")), /not yours/i,
      "and it still says whose history it is");
  } finally {
    page.restore();
  }
});

test("a refused archive is a recoverable state: a code, a remedy, and a control", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    // A real, well-formed archive that simply holds nothing this reader opens.
    const bytes = buildArchive([{ name: "images/first.png", text: "not an export" }]);
    chooseFile(document, archiveFile("takeout.zip", bytes));
    const refusal = await refusalPainted(document, "the archive refusal");

    assert.equal(refusal.dataset.state, "error");
    assert.equal(refusal.dataset.code, PERSONAL_ARCHIVE_OUTCOME.noSupportedMember);
    assert.equal(refusal.getAttribute("role"), "alert");
    assert.match(textOf(refusal), new RegExp(MEMBER), "the member it looked for is named");
    assert.doesNotMatch(textOf(refusal), /first\.png/,
      "and no member of the reader's archive is echoed back at them");
    assert.match(textOf(refusal.querySelector(".ph-error-boundary")), /Nothing was uploaded/);

    const step = nextStep(document);
    assert.equal(step.dataset.action, "choose_file");
    step.querySelector(".ph-next-action").focus();
    pressEnter(document);
    assert.equal(document.activeElement.id, "personal-history-file");

    // And the workflow is still usable: the picker is live and nothing is busy.
    assert.equal(byId(document, "personal-history-file").disabled, false);
    assert.equal(result(document).getAttribute("aria-busy"), "false");
  } finally {
    page.restore();
  }
});

test("bytes that are not an archive at all, and a format that is neither, both recover", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    chooseFile(document, archiveFile("broken.zip", encoder.encode("PK not really an archive")));
    const notAnArchive = await refusalPainted(document, "the not-an-archive refusal");
    assert.equal(notAnArchive.dataset.code, PERSONAL_ARCHIVE_OUTCOME.notAnArchive);
    assert.ok(notAnArchive.querySelector(".ph-next-action"), "a refusal ends on a control");

    chooseFile(document, textFile("invoice.pdf", "%PDF-1.7"));
    const unsupported = await waitFor(
      () => (panel(document)?.dataset.code === PERSONAL_ENTRY_REFUSAL.unsupportedFileType
        ? panel(document) : null),
      "the unsupported-format refusal");
    assert.match(textOf(unsupported), /\.pdf is not one of the two shapes/);
    assert.equal(unsupported.querySelector(".ph-next").dataset.action, "choose_file");
    assert.match(textOf(unsupported.querySelector(".ph-next-outcome")), /was not kept/);
  } finally {
    page.restore();
  }
});

test("unsafe, unsupported, and malformed archives each recover through the keyboard", async (t) => {
  const cases = [
    {
      name: "unsafe member path",
      bytes: buildArchive([{ name: `../${MEMBER}`, text: personalHistoryPreviewJson() }]),
      code: PERSONAL_ARCHIVE_OUTCOME.unsafeMemberPath,
      message: /outside itself/i,
    },
    {
      name: "unsupported encrypted ZIP",
      bytes: encryptedArchive(personalHistoryPreviewJson()),
      code: PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive,
      message: /feature this reader does not open/i,
    },
    {
      name: "malformed member integrity",
      bytes: integrityBrokenArchive(personalHistoryPreviewJson()),
      code: PERSONAL_ARCHIVE_OUTCOME.malformedArchive,
      message: /does not describe itself consistently/i,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const page = await openPage();
      const { document } = page;
      try {
        chooseFile(document, archiveFile("provider-export.zip", scenario.bytes));
        const refusal = await refusalPainted(document, `${scenario.name} refusal`);

        assert.equal(refusal.dataset.code, scenario.code);
        assert.equal(refusal.getAttribute("role"), "alert",
          "the outcome is announced when it replaces progress");
        assert.match(textOf(refusal.querySelector(".ph-state-title")), scenario.message);
        assert.match(textOf(refusal.querySelector(".ph-error-boundary")), /Nothing was uploaded/);

        const recovery = refusal.querySelector(".ph-next-action");
        assert.equal(recovery.getAttribute("type"), "button");
        recovery.focus();
        pressEnter(document);
        assert.equal(document.activeElement.id, "personal-history-file");
        assert.equal(byId(document, "personal-history-file").disabled, false);
        assert.equal(result(document).getAttribute("aria-busy"), "false");
      } finally {
        page.restore();
      }
    });
  }
});
