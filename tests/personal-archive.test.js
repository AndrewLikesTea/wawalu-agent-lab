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
  openPersonalArchive, readCentralDirectory,
} from "../src/personal-archive.js";
import { buildPersonalHistoryReport } from "../src/personal-history-report.js";
import {
  PERSONAL_ELIGIBILITY, PERSONAL_REPORT_STATE, validatePersonalHistoryReport,
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
 */
async function buildArchive(members, overrides = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const member of members) {
    const raw = typeof member.data === "string" ? encoder.encode(member.data) : member.data;
    const method = member.method ?? 8;
    const payload = method === 8 ? await deflateRaw(raw) : raw;
    const name = encoder.encode(member.name);
    const crc = member.crc ?? crc32(raw);
    const uncompressed = member.uncompressedSize ?? raw.byteLength;

    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, member.flags ?? 0, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.byteLength, true);
    lv.setUint32(22, uncompressed, true);
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
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

    offset += local.byteLength + payload.byteLength;
  }

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

/** An invented history, long enough to clear both eligibility floors. */
function historyJson({ prompts = 30, days = 8 } = {}) {
  const messages = [];
  for (let index = 0; index < prompts; index += 1) {
    const day = String((index % days) + 1).padStart(2, "0");
    messages.push({
      role: "user",
      create_time: `2026-03-${day}T09:00:00Z`,
      content: `Draft the quarterly migration note number ${index} and list the rollback steps for it.`,
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
