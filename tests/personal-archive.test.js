// The archive intake, driven end to end against archives this test builds byte
// by byte.
//
// Every archive below is assembled here rather than committed: a ZIP fixture in
// the repository is a binary nobody reviews, and the cases that matter are all
// cases about *malformed* bytes, which is exactly what a committed file cannot
// be trusted to still be. The builder is deliberately dumb and takes overrides
// for the three numbers the end-of-central-directory record declares, because
// lying in that record is the attack this parser exists to survive.
//
// Nothing here reaches a network, a provider, or a disk, and every prompt in
// every archive is invented.

import assert from "node:assert/strict";
import test from "node:test";

import {
  PERSONAL_ARCHIVE_LIMITS, PERSONAL_ARCHIVE_MEMBERS, PERSONAL_ARCHIVE_OUTCOME,
  PERSONAL_ARCHIVE_PACKAGES, PERSONAL_ARCHIVE_RULE, isPersonalArchiveName,
  openPersonalArchive, readCentralDirectory, readLocalHeader,
} from "../src/personal-archive.js";
import { assertNoPromptText, buildPersonalHistoryReport } from "../src/personal-history-report.js";
import {
  PERSONAL_ELIGIBILITY, PERSONAL_NOT_ELIGIBLE, PERSONAL_REPORT_STATE, PERSONAL_SAMPLING,
  validatePersonalHistoryReport,
} from "../src/personal-history-contract.js";
import {
  PERSONAL_ENTRY_REFUSAL, PERSONAL_FILE_EXTENSIONS, personalFileEligibility,
} from "../src/personal-history-entry.js";

/* ----------------------------- a ZIP, by hand ----------------------------- */

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

/** Written out again here so the parser's checksum is checked against a second
 * implementation rather than against itself. */
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  void writer.write(bytes).then(() => writer.close());
  const chunks = [];
  let total = 0;
  for (const reader = stream.readable.getReader(); ;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

const concat = (parts) => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
};

/**
 * Build an archive.
 *
 * `members` are `{ name, data, method, flags, crc, uncompressedSize }`; the last
 * three are overrides for the malformed cases. `overrides` lies in the
 * end-of-central-directory record: `declaredMembers`, `directorySize`,
 * `directoryAt`, and `trailing` bytes appended after the directory.
 *
 * A member may also carry `local` — `{ name, method, flags, crc,
 * compressedSize, uncompressedSize }` — which is written into the local file
 * header *instead of* the central record's value, and `pointAt`, an index into
 * `members` whose local header this member's central record is repointed at.
 * Those two are how a disagreement between the archive's two descriptions of
 * the same member is built: everything else in the file stays a valid ZIP.
 */
async function buildArchive(members, overrides = {}) {
  const locals = [];
  const centrals = [];
  const offsets = [];
  let offset = 0;

  for (const member of members) {
    const raw = typeof member.data === "string" ? encoder.encode(member.data) : member.data;
    const method = member.method ?? 8;
    const payload = method === 8 ? await deflateRaw(raw) : raw;
    const name = encoder.encode(member.name);
    const crc = member.crc ?? crc32(raw);
    const uncompressed = member.uncompressedSize ?? raw.byteLength;
    const lies = member.local ?? {};
    const localName = encoder.encode(lies.name ?? member.name);

    const local = new Uint8Array(30 + localName.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, lies.flags ?? member.flags ?? 0, true);
    lv.setUint16(8, lies.method ?? method, true);
    lv.setUint32(14, lies.crc ?? crc, true);
    lv.setUint32(18, lies.compressedSize ?? payload.byteLength, true);
    lv.setUint32(22, lies.uncompressedSize ?? uncompressed, true);
    lv.setUint16(26, localName.byteLength, true);
    local.set(localName, 30);
    locals.push(local, payload);

    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, member.flags ?? 0, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.byteLength, true);
    cv.setUint32(24, uncompressed, true);
    cv.setUint16(28, member.nameLength ?? name.byteLength, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offsets.push(offset);
    offset += local.byteLength + payload.byteLength;
  }

  // Repointing happens after every offset is known, so a record can be aimed at
  // a member declared after it.
  members.forEach((member, index) => {
    if (member.pointAt === undefined && member.centralOffset === undefined) return;
    new DataView(centrals[index].buffer)
      .setUint32(42, member.centralOffset ?? offsets[member.pointAt], true);
  });

  const body = concat(locals);
  const directory = concat(centrals);
  const trailing = overrides.trailing ?? new Uint8Array(0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, overrides.declaredMembers ?? members.length, true);
  ev.setUint16(10, overrides.declaredMembers ?? members.length, true);
  ev.setUint32(12, overrides.directorySize ?? directory.byteLength, true);
  ev.setUint32(16, overrides.directoryAt ?? body.byteLength, true);
  return concat([body, directory, trailing, eocd]);
}

/* ------------------------------ the fixtures ------------------------------ */

const MEMBER = PERSONAL_ARCHIVE_MEMBERS[0];

/**
 * An invented history, long enough to clear both eligibility floors.
 *
 * Every prompt is synthetic and structurally identical apart from its number, so
 * the grade a reading produces is a function of the *count* of prompts and not
 * of which ones a sample happened to land on. That is the assumption the
 * sampling assertions below rest on, and it is stated here rather than implied:
 * a uniform history is representative of itself under any stride, which is what
 * makes "sampled and unsampled produce the same move" a check of the sampler
 * rather than a check of the fixture's luck.
 *
 * `marker` is a string planted in every prompt so a leak into a report is a
 * substring search rather than a review.
 */
function historyJson({ prompts = 30, days = 8, marker = "" } = {}) {
  const messages = [];
  for (let index = 0; index < prompts; index += 1) {
    const day = String((index % days) + 1).padStart(2, "0");
    messages.push({
      role: "user",
      create_time: `2026-03-${day}T09:00:00Z`,
      content: `Draft the quarterly migration note number ${index}${marker && ` ${marker}`} `
        + "and list the rollback steps for it.",
    });
  }
  return JSON.stringify({ conversations: [{ messages }] });
}

/* ------------------------------- happy path ------------------------------- */

test("a supported archive yields exactly the member the packages declare", async () => {
  const text = historyJson();
  const outcome = await openPersonalArchive(await buildArchive([
    { name: MEMBER, data: text },
    { name: "user.json", data: '{"email":"someone@example.invalid"}' },
    { name: "message_feedback.json", data: "[]" },
  ]));

  assert.equal(outcome.status, "extracted");
  assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.extracted);
  assert.equal(outcome.text, text);
  assert.equal(outcome.member.name, MEMBER);
  assert.equal(outcome.member.packageId, PERSONAL_ARCHIVE_PACKAGES[0].id);
  assert.equal(outcome.member.shape, PERSONAL_ARCHIVE_PACKAGES[0].shape);
  assert.equal(outcome.archive.readMembers, 3, "every record is read; only one member is opened");
  // The two members that are not declared are named nowhere in the outcome, in
  // any state. An archive holds a person's account file next to their history.
  const serialized = JSON.stringify(outcome);
  assert.equal(serialized.includes("user.json"), false);
  assert.equal(serialized.includes("message_feedback.json"), false);
});

test("a stored member is read identically to a deflated one", async () => {
  const text = historyJson({ prompts: 24 });
  const stored = await openPersonalArchive(await buildArchive([{ name: MEMBER, data: text, method: 0 }]));
  const deflated = await openPersonalArchive(await buildArchive([{ name: MEMBER, data: text, method: 8 }]));
  assert.equal(stored.text, text);
  assert.equal(deflated.text, text);
});

test("an archived export produces the same report the same JSON produces directly", async () => {
  const text = historyJson();
  const outcome = await openPersonalArchive(await buildArchive([{ name: MEMBER, data: text }]));

  const fromArchive = buildPersonalHistoryReport(outcome.text);
  const direct = buildPersonalHistoryReport(text);

  assert.equal(fromArchive.state, PERSONAL_REPORT_STATE.prioritized);
  assert.deepEqual(fromArchive, direct,
    "an archive is a container, not a second pipeline: the same bytes must read the same way");
  assert.deepEqual(validatePersonalHistoryReport(fromArchive).errors, []);
  assert.ok(fromArchive.eligibility.scoredPrompts >= PERSONAL_ELIGIBILITY.minScoredPrompts);
});

/* ------------------ the central directory as a bounded region ------------------ */

test("a zero-length declared directory is refused, whatever follows it", async () => {
  // The blocker, exactly: the records after the declared range are perfectly
  // valid, and a parser that walks the record stream instead of the declared
  // region reads them anyway.
  const bytes = await buildArchive([{ name: MEMBER, data: historyJson() }], { directorySize: 0 });
  const directory = readCentralDirectory(bytes);
  assert.equal(directory.ok, false);
  assert.equal(directory.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);

  const outcome = await openPersonalArchive(bytes);
  assert.equal(outcome.status, "refused");
  assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  assert.equal(outcome.text, null, "a refused archive yields no member text at all");
});

test("an undersized declared directory is refused rather than read past", async () => {
  const members = [{ name: MEMBER, data: historyJson() }, { name: "user.json", data: "{}" }];
  const full = await buildArchive(members);
  const short = await buildArchive(members, {
    // Two bytes short of the real directory: every record is intact, and the
    // last one now ends outside the region the archive declared.
    directorySize: readCentralDirectory(full).directorySize - 2,
  });
  const directory = readCentralDirectory(short);
  assert.equal(directory.ok, false);
  assert.equal(directory.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  assert.equal((await openPersonalArchive(short)).code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
});

test("a declared directory smaller than one record is refused at the first record", async () => {
  const bytes = await buildArchive([{ name: MEMBER, data: historyJson() }], { directorySize: 40 });
  assert.equal(readCentralDirectory(bytes).code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
});

test("a declared directory larger than the records in it is refused", async () => {
  // The walk ends before the declared end. Accepting it would mean accepting an
  // archive whose own arithmetic does not close.
  const bytes = await buildArchive([{ name: MEMBER, data: historyJson() }], {
    trailing: new Uint8Array(16),
    directorySize: null,
  });
  const real = readCentralDirectory(await buildArchive([{ name: MEMBER, data: historyJson() }]));
  const stretched = await buildArchive([{ name: MEMBER, data: historyJson() }], {
    trailing: new Uint8Array(16),
    directorySize: real.directorySize + 16,
  });
  assert.equal(readCentralDirectory(bytes).ok, true, "trailing bytes alone are not the failure");
  assert.equal(readCentralDirectory(stretched).code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
});

test("a declared member count higher than the directory holds is refused", async () => {
  const bytes = await buildArchive([{ name: MEMBER, data: historyJson() }], { declaredMembers: 2 });
  assert.equal(readCentralDirectory(bytes).code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
});

test("a declared member count lower than the directory holds is refused", async () => {
  const bytes = await buildArchive(
    [{ name: MEMBER, data: historyJson() }, { name: "user.json", data: "{}" }],
    { declaredMembers: 1 },
  );
  assert.equal(readCentralDirectory(bytes).code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
});

test("a record whose name runs past the declared directory is refused", async () => {
  // The name length is a number inside the region that decides how far outside
  // it the record reaches. It is checked against the region, not against the file.
  const bytes = await buildArchive([{ name: MEMBER, data: historyJson(), nameLength: 4096 }]);
  assert.equal(readCentralDirectory(bytes).code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
});

test("a directory declared outside the file is refused before it is walked", async () => {
  const bytes = await buildArchive([{ name: MEMBER, data: historyJson() }], { directoryAt: 0xfffffff });
  assert.equal(readCentralDirectory(bytes).code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
});

/* ------------------------------ unsafe, unsupported ------------------------------ */

test("a member naming a path outside the archive refuses the archive whole", async () => {
  for (const name of ["../conversations.json", "/etc/passwd", "C:/exports/x.json", "a\\b.json"]) {
    const bytes = await buildArchive([
      { name: MEMBER, data: historyJson() },
      { name, data: "{}" },
    ]);
    const outcome = await openPersonalArchive(bytes);
    assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.unsafeMemberPath, name);
    assert.equal(outcome.text, null, `${name}: the safe member must not be read out of a hostile archive`);
  }
});

test("an encrypted or unknown-method member is unsupported, not malformed", async () => {
  const encrypted = await openPersonalArchive(
    await buildArchive([{ name: MEMBER, data: historyJson(), flags: 0x0001 }]),
  );
  assert.equal(encrypted.code, PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive);

  const exotic = await openPersonalArchive(
    await buildArchive([{ name: MEMBER, data: historyJson(), method: 12 }]),
  );
  assert.equal(exotic.code, PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive);
});

test("an archive holding no declared member is refused with the member named", async () => {
  const outcome = await openPersonalArchive(await buildArchive([
    { name: "chat/conversations.json", data: historyJson() },
    { name: "user.json", data: "{}" },
  ]));
  assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.noSupportedMember);
  assert.equal(outcome.text, null);
  // Only a whole-path match opens a member: a nested copy is not guessed at.
  assert.ok(outcome.remedy.includes(MEMBER));
});

test("two records claiming the declared member are refused rather than picked between", async () => {
  const outcome = await openPersonalArchive(await buildArchive([
    { name: MEMBER, data: historyJson() },
    { name: MEMBER, data: historyJson({ prompts: 21 }) },
  ]));
  assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
});

test("a checksum or size the archive got wrong is a refusal, not a reading", async () => {
  const wrongCrc = await openPersonalArchive(
    await buildArchive([{ name: MEMBER, data: historyJson(), crc: 1 }]),
  );
  assert.equal(wrongCrc.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);

  const wrongSize = await openPersonalArchive(
    await buildArchive([{ name: MEMBER, data: historyJson(), method: 0, uncompressedSize: 5 }]),
  );
  assert.equal(wrongSize.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
});

test("a member declaring more than the in-tab ceiling is refused before it is inflated", async () => {
  const outcome = await openPersonalArchive(await buildArchive([{
    name: MEMBER,
    data: historyJson(),
    uncompressedSize: PERSONAL_ARCHIVE_LIMITS.maxMemberBytes + 1,
  }]));
  assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.memberTooLarge);
});

test("something that is not an archive at all is refused as one", async () => {
  for (const input of [null, "conversations.json", encoder.encode("not a zip"), new ArrayBuffer(8)]) {
    const outcome = await openPersonalArchive(input);
    assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.notAnArchive);
  }
  // A JSON file whose *contents* carry the end-of-central-directory signature is
  // still not an archive: the record has to reach the end of the file.
  const decoy = concat([encoder.encode("{}"), new Uint8Array([0x50, 0x4b, 0x05, 0x06]), new Uint8Array(40)]);
  assert.equal((await openPersonalArchive(decoy)).code, PERSONAL_ARCHIVE_OUTCOME.notAnArchive);
});

test("every outcome carries a code, three sentences, and no byte of the file", async () => {
  const codes = Object.values(PERSONAL_ARCHIVE_OUTCOME)
    .filter((code) => code !== PERSONAL_ARCHIVE_OUTCOME.extracted);
  for (const code of codes) {
    const rule = PERSONAL_ARCHIVE_RULE[code];
    assert.ok(rule, `${code} has no published sentence`);
    for (const field of ["summary", "detail", "remedy"]) {
      assert.ok(rule[field].length > 20, `${code}.${field} is too short to act on`);
    }
  }
});

/* --------------------------------- entry gate --------------------------------- */

test("a .zip is an accepted container and the direct formats are untouched", () => {
  assert.deepEqual([...PERSONAL_FILE_EXTENSIONS].sort(), [".csv", ".json", ".tsv", ".txt", ".zip"]);
  for (const name of ["history.zip", "history.json", "log.csv", "log.tsv", "log.txt"]) {
    assert.equal(personalFileEligibility({ name, size: 1024 }).eligible, true, name);
  }
  assert.equal(personalFileEligibility({ name: "history.pdf", size: 10 }).code,
    PERSONAL_ENTRY_REFUSAL.unsupportedFileType);
  assert.equal(isPersonalArchiveName("history.ZIP"), true);
  assert.equal(isPersonalArchiveName("history.json"), false);
});

test("an archive meets the archive ceiling and a text export meets its own", () => {
  const big = { name: "history.zip", size: PERSONAL_ARCHIVE_LIMITS.maxArchiveBytes + 1 };
  assert.equal(personalFileEligibility(big).code, PERSONAL_ENTRY_REFUSAL.fileTooLarge);
  assert.equal(personalFileEligibility({
    name: "history.zip", size: PERSONAL_ARCHIVE_LIMITS.maxArchiveBytes,
  }).eligible, true);
  // The compressed ceiling is not a way past the reader's own: a text file over
  // the character ceiling is refused exactly as it was before archives existed.
  assert.equal(personalFileEligibility({
    name: "history.json", size: PERSONAL_ARCHIVE_LIMITS.maxArchiveBytes,
  }).code, PERSONAL_ENTRY_REFUSAL.fileTooLarge);
});

/* ------------- the two descriptions of a member, required to agree ------------- */
//
// A ZIP describes every member twice: in the central directory, which is what
// this reader searches, and in a local file header, which is what it extracts
// from. Until the fix these tests were written for, the two were never compared,
// and the checks that looked like integrity checks — CRC, sizes — all compared
// the bytes against the *central* record, which is the record an attacker
// controls. So they all passed while a different member was graded.

test("a central record aimed at another member's local header is refused before grading", async () => {
  // THE CRAFTED CASE. Two members, byte-identical payloads, so every check
  // downstream of selection passes: the CRC in the central record is the CRC of
  // the bytes actually inflated, and the declared size is their real size. The
  // only thing wrong with this archive is that the record naming
  // conversations.json points at the local header of `notes/decoy.txt`, so what
  // would be graded is a member this product never declared it would open.
  const text = historyJson();
  const members = [
    { name: "notes/decoy.txt", data: text },
    { name: MEMBER, data: text, pointAt: 0 },
  ];

  const crafted = await openPersonalArchive(await buildArchive(members));
  assert.equal(crafted.status, "refused");
  assert.equal(crafted.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  assert.equal(crafted.text, null, "nothing is extracted out of an archive that contradicts itself");
  assert.equal(crafted.member, null, "and no member metadata reaches a surface either");
  assert.equal(JSON.stringify(crafted).includes("decoy"), false,
    "the member it pointed at is not named in the refusal");

  // The control, and the whole argument that the refusal is about the repoint:
  // the same members, the same bytes, the same payloads — only the aimed offset
  // removed — read normally. A test that only asserts the refusal cannot tell a
  // fix from a reader that stopped opening archives.
  const honest = await openPersonalArchive(await buildArchive([
    members[0], { name: MEMBER, data: text },
  ]));
  assert.equal(honest.status, "extracted");
  assert.equal(honest.text, text);
});

test("the payload's bounds come from the local header's own lengths", async () => {
  // The agreement rule covers every field except the extra field, which a ZIP
  // writer is allowed to differ on — so the offset of the data has to be
  // computed from the *local* copy of the name and extra lengths. Asserted
  // directly, because it is the one place the two records legitimately disagree
  // and the one place a reader could quietly slide off the payload.
  const text = historyJson({ prompts: 22 });
  const bytes = await buildArchive([{ name: "notes/decoy.txt", data: "x" }, { name: MEMBER, data: text }]);
  const directory = readCentralDirectory(bytes);
  const member = directory.entries.find((entry) => entry.name === MEMBER);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = readLocalHeader(bytes, view, member, directory.directoryAt);
  assert.equal(local.ok, true);
  assert.equal(local.dataAt, member.localHeaderAt + 30 + MEMBER.length,
    "no extra field here, so the data starts right after the local name");
  assert.equal(local.dataEnd - local.dataAt, member.compressedSize);
  assert.ok(local.dataEnd <= directory.directoryAt, "a member's bytes live before the directory");
});

test("the two copies of a member must agree on name, method, flags, and integrity", async () => {
  // One field disagrees per case, everything else is a valid archive, and each
  // one is a refusal on its own. Read as a table so a field added to the
  // agreement check is a row here rather than a new test.
  const text = historyJson();
  const cases = [
    ["name", { name: "conversations.jsonx" }],
    ["name at the same length", { name: "conversationsxjson" }],
    ["method", { method: 0 }],
    // Bit 11 only declares the name's encoding, so it is a field this reader
    // carries rather than refuses — which is what makes it a clean test of the
    // agreement rule rather than of the unsupported-feature rule.
    ["flags", { flags: 0x0800 }],
    ["crc", { crc: 0x12345678 }],
    ["compressed size", { compressedSize: 3 }],
    ["uncompressed size", { uncompressedSize: text.length - 1 }],
  ];
  for (const [field, local] of cases) {
    const outcome = await openPersonalArchive(
      await buildArchive([{ name: MEMBER, data: text, local }]),
    );
    assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive,
      `a local header disagreeing on ${field} must refuse the archive`);
    assert.equal(outcome.text, null, field);
  }
});

test("a local header declaring a feature this reader does not open is unsupported", async () => {
  const text = historyJson();
  // Bit 3 puts the CRC and both sizes *after* the payload, where they can only
  // be read by inflating first — the opposite order to the one every check in
  // this module depends on. Bit 13 zeroes the local copies outright, which
  // leaves the agreement check with nothing to compare.
  for (const flags of [0x0008, 0x2000, 0x0040]) {
    const localOnly = await openPersonalArchive(
      await buildArchive([{ name: MEMBER, data: text, local: { flags } }]),
    );
    assert.equal(localOnly.code, PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive,
      `local flag ${flags} must be unsupported, not read past`);
    // Set in both copies it is caught earlier, off the directory alone, and must
    // land on the same code: a reader should not be able to tell the two apart.
    const both = await openPersonalArchive(
      await buildArchive([{ name: MEMBER, data: text, flags }]),
    );
    assert.equal(both.code, PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive, `declared flag ${flags}`);
  }
});

test("a record aimed outside the members region is refused rather than read", async () => {
  const text = historyJson();
  for (const centralOffset of [0xfffffff, 0xffffffff, 1]) {
    // 1 is the interesting one: it is inside the file and inside the region,
    // and lands one byte into a real local header, so the signature check is
    // what catches it rather than a bound.
    const outcome = await openPersonalArchive(
      await buildArchive([{ name: MEMBER, data: text, centralOffset }]),
    );
    assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive, String(centralOffset));
    assert.equal(outcome.text, null);
  }
});

/* --------------------- valid archives, as they actually arrive --------------------- */

test("a multi-file archive with nested paths opens the one member and reads nothing else", async () => {
  // The shape a real export arrives in: a directory entry, nested folders, a
  // binary attachment, and the history at the top level. Everything but the
  // last is passed over unread, and none of it is named in the outcome.
  const text = historyJson({ prompts: 26 });
  const outcome = await openPersonalArchive(await buildArchive([
    { name: "chat/", data: new Uint8Array(0), method: 0 },
    { name: "chat/2026/session-notes.txt", data: "an invented note, not a prompt" },
    { name: "attachments/diagram.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]) },
    { name: MEMBER, data: text },
    { name: "user.json", data: '{"email":"someone@example.invalid"}' },
  ]));

  assert.equal(outcome.status, "extracted");
  assert.equal(outcome.text, text);
  assert.equal(outcome.archive.readMembers, 5, "every record is read; one member is opened");
  assert.equal(outcome.member.chars, text.length);
  const serialized = JSON.stringify(outcome.member) + JSON.stringify(outcome.archive);
  for (const name of ["chat/", "session-notes", "diagram.png", "user.json", "example.invalid"]) {
    assert.equal(serialized.includes(name), false, `${name} must not reach a surface`);
  }
  assert.equal(buildPersonalHistoryReport(outcome.text).state, PERSONAL_REPORT_STATE.prioritized);
});

test("a member that is not text, and one that is text of no supported shape", async () => {
  // A payload that is not UTF-8 cannot be decoded without guessing an encoding,
  // and a guess is a reading nobody can defend — so it is a refusal, before any
  // shape detection runs.
  const binary = await openPersonalArchive(await buildArchive([
    { name: MEMBER, data: new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x81, 0x50, 0x4b]), method: 0 },
  ]));
  assert.equal(binary.code, PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  assert.equal(binary.text, null);

  // Valid UTF-8 of an unrecognized shape is a different failure and belongs to a
  // different layer: the archive opened correctly, and the reader — not the ZIP
  // parser — is what declines to guess at the shape.
  const wrongShape = await openPersonalArchive(await buildArchive([
    { name: MEMBER, data: '{"records":[{"note":"an invented line, not an export"}]}' },
  ]));
  assert.equal(wrongShape.status, "extracted");
  const report = buildPersonalHistoryReport(wrongShape.text);
  assert.equal(report.state, PERSONAL_REPORT_STATE.notEligible);
  assert.equal(report.reason, PERSONAL_NOT_ELIGIBLE.unrecognizedShape);
});

/* ------------------------------ the declared ceilings ------------------------------ */

test("a directory claiming more members than the ceiling is refused before it is walked", async () => {
  // The count is refused off the record alone, so the loop that would walk four
  // thousand records never starts. The archive under it holds one member: the
  // refusal is a response to the claim, not to what is behind it.
  const bytes = await buildArchive([{ name: MEMBER, data: historyJson() }], {
    declaredMembers: PERSONAL_ARCHIVE_LIMITS.maxDirectoryEntries + 1,
  });
  const directory = readCentralDirectory(bytes);
  assert.equal(directory.ok, false);
  assert.equal(directory.code, PERSONAL_ARCHIVE_OUTCOME.archiveTooLarge);
  assert.equal(directory.declaredMembers, PERSONAL_ARCHIVE_LIMITS.maxDirectoryEntries + 1);
  assert.equal((await openPersonalArchive(bytes)).code, PERSONAL_ARCHIVE_OUTCOME.archiveTooLarge);
});

test("an archive over the whole-file ceiling is measured, not opened", async () => {
  // Not built at that size — the ceiling is checked against `byteLength` before
  // anything is parsed, so a buffer of that length is the whole fixture. A real
  // 64 MB fixture would prove the same thing and cost a minute of CI.
  const oversized = new Uint8Array(PERSONAL_ARCHIVE_LIMITS.maxArchiveBytes + 1);
  const outcome = await openPersonalArchive(oversized);
  assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.archiveTooLarge);
  assert.equal(outcome.archive.declaredMembers, null, "nothing was established before the refusal");
});

test("output over the in-tab ceiling stops the inflate rather than filling the tab", async () => {
  // The declared size passes the pre-check by sitting exactly on the ceiling and
  // the payload then expands one byte past it, so this is the *output* cap doing
  // the work — the only version of the check an archive cannot declare its way
  // around. Zeros, because the assertion is about the length of the output and
  // nothing else, and they compress to a fixture of a few hundred bytes.
  const cap = PERSONAL_ARCHIVE_LIMITS.maxMemberBytes;
  const outcome = await openPersonalArchive(await buildArchive([{
    name: MEMBER,
    data: new Uint8Array(cap + 1),
    uncompressedSize: cap,
  }]));
  assert.equal(outcome.code, PERSONAL_ARCHIVE_OUTCOME.memberTooLarge);
  assert.equal(outcome.text, null);
});

/* ---------------- a large history: sampled, and graded the same way ---------------- */

test("a history over the sampling ceiling is sampled across the whole archive member", async () => {
  // ASSUMPTION BEHIND THE NUMBERS. `prompts` is the sampling ceiling plus a
  // deliberate remainder, so `available / ceiling` does not divide evenly and
  // the stride arithmetic is exercised at its awkward case rather than its neat
  // one. `days` is 7 — above the five-day floor, and coprime with the stride of
  // 2 that this count produces, so the sample lands on every day the file spans.
  // The test below this one is what that choice is protecting against.
  const available = PERSONAL_SAMPLING.ceiling + 501;
  const text = historyJson({ prompts: available, days: 7 });
  const outcome = await openPersonalArchive(await buildArchive([
    { name: MEMBER, data: text },
    { name: "chat/2026/attachments.json", data: "[]" },
  ]));
  assert.equal(outcome.status, "extracted");

  const report = buildPersonalHistoryReport(outcome.text);
  const direct = buildPersonalHistoryReport(text);
  assert.deepEqual(report, direct, "an archive is a container: sampling happens once, in the reader");
  assert.deepEqual(validatePersonalHistoryReport(report).errors, []);

  const stride = Math.ceil(available / PERSONAL_SAMPLING.ceiling);
  assert.equal(stride, 2, "2501 entries over a 2000 ceiling is every second one");
  assert.equal(report.scope.sampled, true);
  assert.equal(report.scope.method, PERSONAL_SAMPLING.methods.evenlySpaced);
  assert.equal(report.scope.stride, stride);
  assert.equal(report.scope.promptEntriesAvailable, available);
  assert.equal(report.scope.promptEntriesRead, Math.ceil(available / stride));
  assert.equal(report.scope.promptEntriesRead, 1251);
  // The floors are read off the sample, not off the file: the denominator a
  // reader is shown and the denominator eligibility used are the same number.
  assert.equal(report.eligibility.scoredPrompts, report.scope.promptEntriesRead);
  assert.equal(report.eligibility.distinctDays, 7, "the sample spans every day the file does");
  assert.equal(report.eligibility.met, true);
});

test("an evenly spaced sample can span fewer days than the file, and says so", async () => {
  // A PROPERTY OF THE SAMPLER, PINNED RATHER THAN HIDDEN. Reading every nth
  // entry of a history whose days repeat on a cycle of n — or of any multiple of
  // n — lands on the same residues forever. Here 2501 entries over 8 repeating
  // days give a stride of 2, and the sample sees 4 of those 8 days. The reading
  // is still honest: the distinct-day floor binds on what was actually read,
  // which is what the contract promises, so the answer is a refusal naming the
  // day floor rather than a grade drawn from a span nobody measured.
  //
  // This is the reason the fixtures above choose a day count coprime with their
  // stride. It is not a defect being covered for: an export whose author really
  // does write on an 8-day cycle is a history this reader will under-count the
  // days of, and a director shown "too few distinct days" for an eight-day
  // export deserves to find that stated in a test rather than infer it.
  const text = historyJson({ prompts: PERSONAL_SAMPLING.ceiling + 501, days: 8 });
  const outcome = await openPersonalArchive(await buildArchive([{ name: MEMBER, data: text }]));
  const report = buildPersonalHistoryReport(outcome.text);

  assert.equal(report.scope.stride, 2);
  assert.equal(report.coverage.distinctDays, 4, "every second entry of an 8-day cycle is 4 days");
  assert.equal(report.state, PERSONAL_REPORT_STATE.notEligible);
  assert.equal(report.reason, PERSONAL_NOT_ELIGIBLE.tooFewDistinctDays);
  // What was available is still stated, so the gap between the file and the
  // reading is visible on the report rather than only in this test.
  assert.equal(report.scope.promptEntriesAvailable, PERSONAL_SAMPLING.ceiling + 501);
  assert.deepEqual(validatePersonalHistoryReport(report).errors, []);
});

test("sampling changes how much was read and not which move is named", async () => {
  // The grading-semantics claim, stated as a comparison rather than a snapshot:
  // the same synthetic habit, once small enough to be read whole and once large
  // enough to be sampled, must name the same move for the same reason and at the
  // same share of prompts. See `historyJson` for why a uniform fixture is what
  // makes this a check of the sampler.
  const whole = buildPersonalHistoryReport(historyJson({ prompts: 40, days: 8 }));
  const sampledOutcome = await openPersonalArchive(await buildArchive([
    { name: MEMBER, data: historyJson({ prompts: PERSONAL_SAMPLING.ceiling * 3, days: 8 }) },
  ]));
  const sampled = buildPersonalHistoryReport(sampledOutcome.text);

  assert.equal(whole.scope.sampled, false);
  assert.equal(sampled.scope.sampled, true);
  assert.equal(sampled.state, whole.state);
  assert.equal(sampled.priority.id, whole.priority.id, "the leading move survives sampling");
  assert.equal(sampled.priority.kind, whole.priority.kind);
  assert.equal(sampled.priority.axis, whole.priority.axis);
  assert.equal(sampled.priority.evidence, whole.priority.evidence);
  assert.equal(sampled.priority.promptShare, whole.priority.promptShare,
    "a share is a ratio over what was read, so a representative sample reproduces it");
  assert.equal(sampled.priority.leadMargin, whole.priority.leadMargin);
  assert.equal(sampled.coverage.ratio, whole.coverage.ratio);
  // Points are a sum over prompts, so they scale with the sample and are the one
  // figure that legitimately differs. Stated, rather than left for a reader to
  // discover from two numbers that do not match.
  assert.ok(sampled.priority.points > whole.priority.points);

  // Read twice, byte for byte: a score somebody has to defend cannot move
  // between two readings of one file.
  const again = buildPersonalHistoryReport(sampledOutcome.text);
  assert.deepEqual(again, sampled);
});

test("no prompt text survives the archive path into anything a reader is shown", async () => {
  // Planted in every prompt of the member, then searched for in the report and
  // in the outcome's own metadata. `outcome.text` is deliberately excluded: it
  // *is* the member, handed to the reader's own grader and dropped, and it is
  // the one value on this path that is supposed to hold what they wrote.
  const marker = "zq7-archive-marker-not-in-any-report";
  const text = historyJson({ prompts: PERSONAL_SAMPLING.ceiling + 7, days: 7, marker });
  const outcome = await openPersonalArchive(await buildArchive([
    { name: MEMBER, data: text },
    { name: "user.json", data: '{"email":"someone@example.invalid"}' },
  ]));

  assert.equal(JSON.stringify(outcome.member).includes(marker), false);
  assert.equal(JSON.stringify(outcome.archive).includes(marker), false);

  const report = buildPersonalHistoryReport(outcome.text);
  assert.equal(report.state, PERSONAL_REPORT_STATE.prioritized);
  assert.equal(report.scope.sampled, true);
  assert.equal(JSON.stringify(report).includes(marker), false,
    "a sampled reading carries no more of the export than an unsampled one");
  assert.equal(assertNoPromptText(report, marker), true);
});
