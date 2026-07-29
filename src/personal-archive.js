// Client-only intake for one supported provider export archive: a ZIP the
// reader picked themselves, one declared member out of it, nothing else.
//
// WHY THIS EXISTS. The largest personal assistant export arrives as a `.zip`
// whose only interesting member is `conversations.json`. Until now that was a
// refusal with a "open it yourself" sentence, which is a fair answer and also
// the answer most readers give up at. This module removes that step without
// moving a single byte off the reader's machine.
//
// WHAT IT IS NOT. There is no upload, no provider call, no credential, no
// persistence, and no server-side archive handling anywhere in this path. It is
// a pure function over bytes the browser already has, plus the platform's own
// `DecompressionStream`. Nothing here writes storage, and the member text it
// returns is handed straight to `buildPersonalHistoryReport` — the same reader,
// the same rubric, the same redaction, the same eligibility floors, the same
// evidence — and dropped. A ZIP is a container, not a second pipeline.
//
// WHAT IT READS. Exactly the members named by a package in
// `PERSONAL_ARCHIVE_PACKAGES`, matched on the whole path and nothing else. No
// glob, no "find the JSON wherever it is", no recursive walk. Every other
// member of the archive is passed over unread; its bytes are never decompressed
// and its name is never printed.
//
// HOW IT FAILS. Every refusal is a structured outcome — a stable code plus
// three authored sentences — never a thrown error and never a partial read. No
// member name, no cell, and no byte of the archive is interpolated into any of
// them: a reader is looking at their own file while they read the sentence.
//
// THE CENTRAL DIRECTORY IS AN EXACT BOUNDED REGION. This is the property the
// first version of this parser got wrong and the one everything else rests on.
// A ZIP is read from its end: the end-of-central-directory record declares
// where the directory starts, how long it is, and how many records it holds.
// Those three numbers are the archive's claim about itself, and a parser that
// trusts the record stream instead of the claim will happily read records that
// live outside the region the archive declared — an archive can then declare a
// zero-length directory and hide a valid-looking record after it. So the
// declared range is checked for containment first, every record is required to
// lie *entirely* inside it — header, fixed fields, and variable fields — and
// the walk is required to end exactly on the declared end. Not "at least the
// declared count", not "until the bytes stop looking like records": exactly the
// declared count, ending exactly on the declared boundary, or the archive is
// refused whole.
//
// A MEMBER IS DESCRIBED TWICE AND BOTH COPIES MUST AGREE. The directory is what
// this reader searches; the local file header immediately before the bytes is
// what it extracts. If those two are never compared, a central record can name
// `conversations.json` while its offset points at some other member's local
// header — and every check downstream still passes, because they all compare
// the bytes against the record that lied. So the selected record and the local
// header it points at are required to describe the same member in every field
// that decides what is read or how: name bytes, method, flags, CRC, and both
// sizes. See `readLocalHeader`.

import { PERSONAL_READER_LIMITS } from "./personal-history-contract.js";

/** Bump when a code, a limit, or a package's declared members change meaning. */
export const PERSONAL_ARCHIVE_VERSION = "personal-archive-intake/1.0.0";

/**
 * The packages this intake opens, declared as data.
 *
 * One entry, and adding a second is adding an entry here rather than branching
 * in the reader. `members` is a list of whole paths, compared literally: a
 * member is supported because this repository named it, never because it looked
 * plausible. `shape` is the personal export shape the member's bytes are read
 * as afterwards, so the archive path cannot reach a shape the direct path
 * cannot.
 */
export const PERSONAL_ARCHIVE_PACKAGES = Object.freeze([
  Object.freeze({
    id: "personal-conversation-archive",
    label: "Personal conversation export (ZIP)",
    shape: "personal-conversation-json",
    members: Object.freeze(["conversations.json"]),
    detail: "The archive an assistant hands back from “export my data”, holding a "
      + "conversations.json at its top level.",
  }),
]);

/** Every whole path this intake will open, across every package. */
export const PERSONAL_ARCHIVE_MEMBERS = Object.freeze(
  [...new Set(PERSONAL_ARCHIVE_PACKAGES.flatMap((entry) => entry.members))],
);

export const PERSONAL_ARCHIVE_EXTENSION = ".zip";

/**
 * The ceilings, all applied before anything is decompressed.
 *
 * `maxArchiveBytes` is larger than the reader's character ceiling because an
 * archive is compressed and a 12 MB export is a 2 MB file; `maxMemberBytes` is
 * the same ceiling the direct path applies, so an archive cannot be a way to
 * hand this reader a file it would have refused. `maxDirectoryEntries` bounds
 * the walk itself — a directory claiming four million records is refused before
 * the loop that would walk it starts.
 */
export const PERSONAL_ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 64_000_000,
  maxDirectoryEntries: 4096,
  maxMemberBytes: PERSONAL_READER_LIMITS.maxChars,
});

/**
 * Why an archive was not read, or that it was. A closed set; a surface switches
 * on the code and never on a sentence.
 */
export const PERSONAL_ARCHIVE_OUTCOME = Object.freeze({
  extracted: "member_extracted",
  notAnArchive: "not_an_archive",
  malformedArchive: "malformed_archive",
  unsupportedArchive: "unsupported_archive",
  unsafeMemberPath: "unsafe_member_path",
  archiveTooLarge: "archive_too_large",
  memberTooLarge: "member_too_large",
  noSupportedMember: "no_supported_member",
});

const MEMBER_LIST = PERSONAL_ARCHIVE_MEMBERS.join(", ");

const NOTHING_LEFT = "The archive was opened in this tab and is gone from memory. Nothing was "
  + "uploaded, nothing was written to disk, and no member of it was kept.";

/** The three sentences behind each refusal. Authored here, never built from the file. */
export const PERSONAL_ARCHIVE_RULE = Object.freeze({
  [PERSONAL_ARCHIVE_OUTCOME.notAnArchive]: Object.freeze({
    summary: "This file is not a ZIP archive",
    detail: "The file does not carry the structure a ZIP archive ends with, so there was no "
      + `directory of members to look for ${MEMBER_LIST} in. ${NOTHING_LEFT}`,
    remedy: "Choose the archive your assistant handed you, or the JSON export inside it.",
  }),
  [PERSONAL_ARCHIVE_OUTCOME.malformedArchive]: Object.freeze({
    summary: "This archive does not describe itself consistently",
    detail: "A ZIP declares where its directory of members starts, how long it is, and how many "
      + "records it holds. This archive's records do not fit the range it declared, so nothing "
      + `in it can be located with confidence and nothing was decompressed. ${NOTHING_LEFT}`,
    remedy: "Download the export again — a truncated or partly written download fails exactly "
      + "this way — or open the archive yourself and choose the JSON inside it.",
  }),
  [PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive]: Object.freeze({
    summary: "This archive uses a feature this reader does not open",
    detail: "Encrypted archives, archives split across parts, ZIP64 archives, and compression "
      + "methods other than store and deflate are not opened here. Reading them would mean "
      + `guessing at bytes rather than following a declared structure. ${NOTHING_LEFT}`,
    remedy: "Open the archive on your own machine and choose the JSON inside it. It is read the "
      + "same way, by the same reader, with the same result.",
  }),
  [PERSONAL_ARCHIVE_OUTCOME.unsafeMemberPath]: Object.freeze({
    summary: "This archive names a member outside itself",
    detail: "A member of this archive carries an absolute path, a drive letter, or a parent-"
      + "directory step. Nothing here writes to disk, so nothing was overwritten — but an "
      + "archive that names a path outside itself is not the export it claims to be, and it is "
      + `refused whole rather than read selectively. ${NOTHING_LEFT}`,
    remedy: "Download the export again from your assistant's own console and choose that file.",
  }),
  [PERSONAL_ARCHIVE_OUTCOME.archiveTooLarge]: Object.freeze({
    summary: "This archive is too large to open in a browser tab",
    detail: `Opening happens in this tab, so this workflow stops at `
      + `${PERSONAL_ARCHIVE_LIMITS.maxArchiveBytes.toLocaleString("en-US")} bytes and at `
      + `${PERSONAL_ARCHIVE_LIMITS.maxDirectoryEntries.toLocaleString("en-US")} members. Your `
      + "archive was measured, not opened.",
    remedy: "Open the archive on your own machine and choose the JSON export inside it, or split "
      + "the export and read one part at a time.",
  }),
  [PERSONAL_ARCHIVE_OUTCOME.memberTooLarge]: Object.freeze({
    summary: "The export inside this archive is too large to read in a browser tab",
    detail: `The member was found and decompression stopped at `
      + `${PERSONAL_ARCHIVE_LIMITS.maxMemberBytes.toLocaleString("en-US")} bytes, which is the `
      + "same ceiling a file chosen directly meets. An archive is not a way around it, because "
      + `the reading happens in the same tab either way. ${NOTHING_LEFT}`,
    remedy: "Split the export and read one part at a time. A part read on its own is a complete "
      + "reading of that part.",
  }),
  [PERSONAL_ARCHIVE_OUTCOME.noSupportedMember]: Object.freeze({
    summary: "This archive holds none of the members this reader opens",
    detail: `Its directory was read and it carries no ${MEMBER_LIST} at the top level. Only `
      + "members named by this product are opened; the rest of an archive is passed over unread, "
      + `so nothing else in yours was decompressed or looked at. ${NOTHING_LEFT}`,
    remedy: `Open the archive yourself and choose the file named ${MEMBER_LIST}, or export your `
      + "history again if the archive does not carry one.",
  }),
});

// ---------------------------------------------------------------------------
// The ZIP structures this reader knows
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const EOCD_FIXED = 22;
const CENTRAL_FIXED = 46;
const LOCAL_FIXED = 30;

/** The longest trailing comment a ZIP may carry, and so the longest backward scan. */
const MAX_ARCHIVE_COMMENT = 0xffff;

/** The two values that mean "this number lives in a ZIP64 record instead". */
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/**
 * The general-purpose bits that end a reading, and why each one does.
 *
 * bit 0 — encrypted: the bytes are not the member's bytes.
 * bit 3 — data descriptor: the local header's CRC and sizes are zero and the
 *   real ones sit *after* the payload, at an offset only a decompressor knows.
 *   Reading it would mean inflating first and checking afterwards, which is the
 *   opposite order to the one this module is built on, so it is refused instead.
 * bit 6 — strong encryption: as bit 0, by another mechanism.
 * bit 13 — masked local header: the local copies of the CRC and sizes are
 *   deliberately zeroed, so the agreement check below has nothing to check.
 *
 * A flag outside this mask is one that does not change how the bytes are read
 * (bit 1 and 2 are compression hints, bit 11 is the name's encoding), so it is
 * carried through and compared rather than refused.
 */
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_MASKED_LOCAL_HEADER = 0x2000;
const UNSUPPORTED_FLAGS = FLAG_ENCRYPTED | FLAG_DATA_DESCRIPTOR
  | FLAG_STRONG_ENCRYPTION | FLAG_MASKED_LOCAL_HEADER;

const outcome = (code, extra = {}) => Object.freeze({
  version: PERSONAL_ARCHIVE_VERSION,
  status: code === PERSONAL_ARCHIVE_OUTCOME.extracted ? "extracted" : "refused",
  code,
  ...PERSONAL_ARCHIVE_RULE[code] ?? {},
  ...extra,
});

const refuse = (code, directory = null) => outcome(code, {
  member: null,
  text: null,
  // Counts only, and only what was actually established before the refusal. A
  // refusal that reports the shape of the file it refused is how a reader tells
  // a truncated download from a wrong file.
  archive: Object.freeze({
    declaredMembers: directory?.declaredMembers ?? null,
    readMembers: directory?.entries?.length ?? null,
  }),
});

// ---------------------------------------------------------------------------
// The central directory
// ---------------------------------------------------------------------------

/**
 * Find the end-of-central-directory record.
 *
 * Scanned backwards, and a candidate signature only counts when its declared
 * comment length reaches exactly the end of the file — which is what stops a
 * member whose *contents* happen to hold the signature from being read as the
 * record. The first candidate found scanning backwards wins, so the result is a
 * function of the bytes and nothing else.
 *
 * @returns {number} the offset of the record, or -1.
 */
function locateEndOfCentralDirectory(view, length) {
  const earliest = Math.max(0, length - EOCD_FIXED - MAX_ARCHIVE_COMMENT);
  for (let at = length - EOCD_FIXED; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    if (at + EOCD_FIXED + view.getUint16(at + 20, true) === length) return at;
  }
  return -1;
}

/**
 * A member path this reader will not touch.
 *
 * Nothing in this module writes to disk, so a traversal path cannot overwrite
 * anything here. It is still refused, and the whole archive with it: a member
 * named `../../etc/passwd` is a statement about what the archive was built to
 * do, and the right response to it is not to read the one member that looked
 * fine.
 */
function unsafeMemberPath(name) {
  if (name === "" || name.includes("\u0000")) return true;
  if (name.startsWith("/") || name.includes("\\")) return true;
  if (/^[A-Za-z]:/.test(name)) return true;
  return name.split("/").some((segment) => segment === "..");
}

const PATH_DECODER = new TextDecoder("utf-8", { fatal: true });

/**
 * Read the central directory as an exact bounded region.
 *
 * The whole safety argument of this module is in this function, so it states
 * every check it makes rather than relying on a caller to have made one:
 *
 *   1. The declared range `[directoryAt, directoryAt + directorySize)` must lie
 *      inside the file and end at or before the end-of-central-directory record
 *      it was declared by.
 *   2. Exactly `declaredMembers` records are parsed, and each one — its header,
 *      its fixed fields, and its variable-length name, extra field, and comment
 *      — must lie entirely inside that range. A record that starts inside it and
 *      runs past its end is a refusal, not a truncation.
 *   3. The walk must finish exactly on `directoryAt + directorySize`. Ending
 *      early means the archive declared a longer directory than it holds;
 *      ending late is impossible by (2). A zero or undersized declared size with
 *      perfectly valid records sitting after it fails at the first record, which
 *      is the case the first version of this parser read straight through.
 *
 * Pure and synchronous: nothing is decompressed here, and no member is opened.
 *
 * @param {Uint8Array} bytes the whole archive.
 * @returns {{ok: true, entries: ReadonlyArray<object>, directoryAt: number,
 *   directorySize: number, declaredMembers: number}
 *   | {ok: false, code: string, entries?: ReadonlyArray<object>, declaredMembers?: number}}
 */
export function readCentralDirectory(bytes) {
  const fail = (code, extra = {}) => Object.freeze({ ok: false, code, ...extra });
  if (!(bytes instanceof Uint8Array)) return fail(PERSONAL_ARCHIVE_OUTCOME.notAnArchive);
  const length = bytes.byteLength;
  if (length < EOCD_FIXED) return fail(PERSONAL_ARCHIVE_OUTCOME.notAnArchive);

  const view = new DataView(bytes.buffer, bytes.byteOffset, length);
  const eocdAt = locateEndOfCentralDirectory(view, length);
  if (eocdAt < 0) return fail(PERSONAL_ARCHIVE_OUTCOME.notAnArchive);

  const disk = view.getUint16(eocdAt + 4, true);
  const directoryDisk = view.getUint16(eocdAt + 6, true);
  const membersOnDisk = view.getUint16(eocdAt + 8, true);
  const declaredMembers = view.getUint16(eocdAt + 10, true);
  const directorySize = view.getUint32(eocdAt + 12, true);
  const directoryAt = view.getUint32(eocdAt + 16, true);

  // ZIP64 puts the real numbers in a record this reader does not read. A
  // sentinel is refused as unsupported rather than followed, because following
  // it would mean acting on a number that is not there.
  if (declaredMembers === ZIP64_MARKER_16 || membersOnDisk === ZIP64_MARKER_16
    || directorySize === ZIP64_MARKER_32 || directoryAt === ZIP64_MARKER_32) {
    return fail(PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive);
  }
  // One disk, one directory, and the disk's count is the archive's count. A
  // spanned archive is a set of files, and this reader was handed one.
  if (disk !== 0 || directoryDisk !== 0 || membersOnDisk !== declaredMembers) {
    return fail(PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive);
  }
  if (declaredMembers > PERSONAL_ARCHIVE_LIMITS.maxDirectoryEntries) {
    return fail(PERSONAL_ARCHIVE_OUTCOME.archiveTooLarge, { declaredMembers });
  }

  // (1) The declared range, checked before a single byte of it is read. The
  // directory sits between the members and the record that declared it, so its
  // end is bounded by that record's own offset rather than by the file length.
  const directoryEnd = directoryAt + directorySize;
  if (directoryAt > eocdAt || directorySize > eocdAt || directoryEnd > eocdAt) {
    return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, { declaredMembers });
  }

  const entries = [];
  let cursor = directoryAt;
  for (let index = 0; index < declaredMembers; index += 1) {
    // (2) The record's header and fixed fields, inside the declared range.
    if (cursor + CENTRAL_FIXED > directoryEnd) {
      return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, { declaredMembers });
    }
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, { declaredMembers });
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderAt = view.getUint32(cursor + 42, true);

    // (2, continued) The variable-length fields, inside the same range. The
    // three lengths are read from inside the region and are then required to
    // stay in it; a record cannot extend its own bounds by declaring a long name.
    const variable = nameLength + extraLength + commentLength;
    if (cursor + CENTRAL_FIXED + variable > directoryEnd) {
      return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, { declaredMembers });
    }

    let name;
    try {
      name = PATH_DECODER.decode(bytes.subarray(cursor + CENTRAL_FIXED, cursor + CENTRAL_FIXED + nameLength));
    } catch {
      // A member name that is not UTF-8 is not a name this reader can compare
      // against a declared path, and guessing an encoding is guessing.
      return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, { declaredMembers });
    }
    if (unsafeMemberPath(name)) {
      return fail(PERSONAL_ARCHIVE_OUTCOME.unsafeMemberPath, { declaredMembers });
    }

    entries.push(Object.freeze({
      name, flags, method, crc, compressedSize, uncompressedSize, localHeaderAt,
      // Where the name was read from, kept so the local header's copy of it can
      // be compared byte for byte rather than through two decodes. Two different
      // byte strings can decode to the same string, and "the same name" has to
      // mean the same bytes for the comparison below to be worth making.
      nameAt: cursor + CENTRAL_FIXED,
      nameLength,
    }));
    cursor += CENTRAL_FIXED + variable;
  }

  // (3) Exactly on the declared end, or the archive is refused whole.
  if (cursor !== directoryEnd) {
    return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, {
      declaredMembers, entries: Object.freeze(entries),
    });
  }

  return Object.freeze({
    ok: true, entries: Object.freeze(entries), directoryAt, directorySize, declaredMembers,
  });
}

// ---------------------------------------------------------------------------
// Reading one declared member
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** The archive's own integrity check, run rather than trusted. */
function crc32(bytes) {
  let value = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    value = CRC_TABLE[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * Inflate one member with the platform's own decompressor, capped.
 *
 * The cap is enforced on the *output* as it arrives, not on the declared size,
 * which is the only version of the check an archive cannot lie its way past: a
 * member declaring 4 KB and expanding to a gigabyte is stopped at the ceiling
 * with the stream cancelled, and the reader gets a refusal instead of a tab that
 * stops responding.
 */
async function inflateRaw(bytes, cap) {
  if (typeof DecompressionStream !== "function") return { ok: false, code: PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive };
  let stream;
  try {
    stream = new DecompressionStream("deflate-raw");
  } catch {
    return { ok: false, code: PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive };
  }
  const writer = stream.writable.getWriter();
  // Write and read concurrently: a stream whose reader never starts deadlocks
  // on the first full chunk. A write that fails surfaces on the read side, so
  // the rejection here is swallowed deliberately rather than ignored.
  const pumped = (async () => {
    try {
      await writer.write(bytes);
      await writer.close();
    } catch { /* the read below reports it */ }
  })();

  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        await pumped;
        return { ok: false, code: PERSONAL_ARCHIVE_OUTCOME.memberTooLarge };
      }
      chunks.push(value);
    }
  } catch {
    await pumped;
    return { ok: false, code: PERSONAL_ARCHIVE_OUTCOME.malformedArchive };
  }
  await pumped;

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return { ok: true, bytes: out };
}

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

/**
 * Read the local file header a selected record points at, and require the two
 * copies of the member to be the same member.
 *
 * WHY THIS EXISTS. A ZIP describes every member twice: once in the central
 * directory, which is what a reader searches, and once in a local file header
 * immediately before the bytes themselves, which is what a reader extracts. The
 * first version of this module searched the first and extracted from the second
 * without ever asking whether they agreed. That gap is the whole of the attack:
 * a central record can name `conversations.json` and point its offset at a
 * local entry named something else entirely. Every downstream check still
 * passes — the payload is real, its CRC matches, its size matches — because
 * every one of those checks compares the bytes against the *central* record,
 * which is the record that lied. What is graded is then not the member this
 * product declared it would open, and the archive got to choose which member
 * that was.
 *
 * THE RULE. The two records must describe the same member in every field that
 * decides what is read or how: the name (compared as bytes, at the same
 * length), the compression method, the general-purpose flags, and the CRC and
 * both sizes. Any disagreement refuses the archive whole. This is deliberately
 * stricter than the format requires — a ZIP writer is permitted to differ in
 * the extra field, and only that — because "which of these two records is the
 * true one" has no answer a reader could check, and an ambiguous archive read
 * either way is a reading nobody can defend.
 *
 * THE ZIP64 SENTINELS need no separate check here: the central record's own
 * sizes were refused as unsupported before this function is reached, and the
 * local copies are then required to equal them.
 *
 * Bounds are checked in the same order as everything else in this module —
 * containment first, then the signature, then the fields — and every offset is
 * bounded by `directoryAt`, because a member's bytes live before the directory
 * that describes them.
 *
 * @param {Uint8Array} bytes the whole archive.
 * @param {DataView} view the same bytes.
 * @param {object} member the selected central-directory record.
 * @param {number} directoryAt where the central directory starts.
 * @returns {{ok: true, dataAt: number, dataEnd: number} | {ok: false, code: string}}
 */
export function readLocalHeader(bytes, view, member, directoryAt) {
  const fail = (code) => Object.freeze({ ok: false, code });
  const headerAt = member.localHeaderAt;
  if (headerAt + LOCAL_FIXED > directoryAt) return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  if (view.getUint32(headerAt, true) !== LOCAL_SIGNATURE) {
    return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  }

  const flags = view.getUint16(headerAt + 6, true);
  const method = view.getUint16(headerAt + 8, true);
  const crc = view.getUint32(headerAt + 14, true);
  const compressedSize = view.getUint32(headerAt + 18, true);
  const uncompressedSize = view.getUint32(headerAt + 22, true);
  const nameLength = view.getUint16(headerAt + 26, true);
  const extraLength = view.getUint16(headerAt + 28, true);

  // A flag this reader does not open is unsupported wherever it is declared. It
  // is read off the local header too, because the central record is the copy an
  // archive controls most cheaply and agreement alone would let both lie.
  if (flags & UNSUPPORTED_FLAGS) return fail(PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive);

  if (flags !== member.flags || method !== member.method || crc !== member.crc
    || compressedSize !== member.compressedSize || uncompressedSize !== member.uncompressedSize) {
    return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  }

  // The name, as bytes, at the same length. The length is checked first so the
  // comparison below is over two ranges of equal size, and the range is checked
  // for containment before it is read.
  const nameAt = headerAt + LOCAL_FIXED;
  if (nameLength !== member.nameLength) return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  if (nameAt + nameLength > directoryAt) return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  for (let at = 0; at < nameLength; at += 1) {
    if (bytes[nameAt + at] !== bytes[member.nameAt + at]) {
      return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
    }
  }

  // The data starts after the local copy of the name and extra field — the
  // local lengths, not the central ones, because those two are allowed to
  // differ and the payload sits after whichever this header declared.
  const dataAt = nameAt + nameLength + extraLength;
  const dataEnd = dataAt + member.compressedSize;
  if (dataAt > directoryAt || dataEnd > directoryAt) {
    return fail(PERSONAL_ARCHIVE_OUTCOME.malformedArchive);
  }
  return Object.freeze({ ok: true, dataAt, dataEnd });
}

/**
 * Open a chosen archive and return the one declared member's text, or a
 * structured refusal.
 *
 * @param {ArrayBuffer|Uint8Array} input the archive's bytes, read in the tab.
 * @returns {Promise<object>} a frozen outcome carrying a stable `code`, the
 *   three sentences a surface prints, and — only when a member was extracted —
 *   its declared name, the package it belongs to, and its text. A refusal
 *   carries `text: null`; there is no partial read.
 */
export async function openPersonalArchive(input) {
  const bytes = input instanceof Uint8Array ? input
    : input instanceof ArrayBuffer ? new Uint8Array(input)
      : null;
  if (!bytes) return refuse(PERSONAL_ARCHIVE_OUTCOME.notAnArchive);
  if (bytes.byteLength > PERSONAL_ARCHIVE_LIMITS.maxArchiveBytes) {
    return refuse(PERSONAL_ARCHIVE_OUTCOME.archiveTooLarge);
  }

  const directory = readCentralDirectory(bytes);
  if (!directory.ok) return refuse(directory.code, directory);

  // The whole of the member selection: a literal comparison against the paths
  // this product declared. A member matching none of them is never opened, and
  // its name never leaves this loop.
  const matches = directory.entries.filter((entry) => PERSONAL_ARCHIVE_MEMBERS.includes(entry.name));
  if (matches.length === 0) return refuse(PERSONAL_ARCHIVE_OUTCOME.noSupportedMember, directory);
  // Two records claiming the same path is an archive that cannot say which one
  // it means, and picking either is picking one for it.
  if (matches.length > 1) return refuse(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, directory);

  const member = matches[0];
  const pack = PERSONAL_ARCHIVE_PACKAGES.find((entry) => entry.members.includes(member.name));
  if (member.flags & UNSUPPORTED_FLAGS) return refuse(PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive, directory);
  if (member.method !== METHOD_STORE && member.method !== METHOD_DEFLATE) {
    return refuse(PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive, directory);
  }
  if (member.compressedSize === ZIP64_MARKER_32 || member.uncompressedSize === ZIP64_MARKER_32) {
    return refuse(PERSONAL_ARCHIVE_OUTCOME.unsupportedArchive, directory);
  }
  if (member.uncompressedSize > PERSONAL_ARCHIVE_LIMITS.maxMemberBytes) {
    return refuse(PERSONAL_ARCHIVE_OUTCOME.memberTooLarge, directory);
  }

  // The local header the selected record points at, required to describe the
  // same member the directory did. Nothing is decompressed until it does: an
  // archive whose two descriptions of a member disagree does not get to pick
  // which one this reader grades.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = readLocalHeader(bytes, view, member, directory.directoryAt);
  if (!local.ok) return refuse(local.code, directory);

  const raw = bytes.subarray(local.dataAt, local.dataEnd);
  let content;
  if (member.method === METHOD_STORE) {
    if (member.compressedSize !== member.uncompressedSize) {
      return refuse(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, directory);
    }
    content = raw;
  } else {
    const inflated = await inflateRaw(raw, PERSONAL_ARCHIVE_LIMITS.maxMemberBytes);
    if (!inflated.ok) return refuse(inflated.code, directory);
    content = inflated.bytes;
  }

  // The archive's own claims about the member, checked rather than believed. A
  // size or checksum that disagrees means the download is damaged, and a damaged
  // export read anyway is a coverage figure drawn from bytes nobody sent.
  if (content.byteLength !== member.uncompressedSize) {
    return refuse(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, directory);
  }
  if (crc32(content) !== member.crc) return refuse(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, directory);

  let text;
  try {
    text = TEXT_DECODER.decode(content);
  } catch {
    return refuse(PERSONAL_ARCHIVE_OUTCOME.malformedArchive, directory);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length > PERSONAL_ARCHIVE_LIMITS.maxMemberBytes) {
    return refuse(PERSONAL_ARCHIVE_OUTCOME.memberTooLarge, directory);
  }

  return outcome(PERSONAL_ARCHIVE_OUTCOME.extracted, {
    summary: "",
    detail: "",
    remedy: "",
    // The declared name — this repository's own string, matched literally — and
    // the package it belongs to. No other member of the archive is named here,
    // because no other member was read.
    member: Object.freeze({
      packageId: pack?.id ?? null,
      shape: pack?.shape ?? null,
      name: member.name,
      chars: text.length,
    }),
    archive: Object.freeze({
      declaredMembers: directory.declaredMembers,
      readMembers: directory.entries.length,
    }),
    text,
  });
}

/** Whether a chosen file name is the archive container this intake opens. */
export function isPersonalArchiveName(name) {
  return String(name ?? "").toLowerCase().endsWith(PERSONAL_ARCHIVE_EXTENSION);
}
