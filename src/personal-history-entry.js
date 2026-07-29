// The entry rules for the personal AI-history reader: what may be handed in,
// what the workflow is doing while it runs, and how a run is told apart from the
// one that replaced it.
//
// Pure and synchronous. Nothing here reads a file, touches the DOM, or knows
// what a browser is — personal-history-view.js draws these decisions and
// personal-history-page.js sequences them. Keeping them here is what lets the
// race behaviour be tested without a document and the eligibility copy be tested
// without a file.
//
// This is the *personal* path. It shares no state, no control, and no module
// with the organizational conversation-export import: a file chosen here is
// never handed to that reader, and nothing that reader retains is read here.

import {
  PERSONAL_ARCHIVE_EXTENSION, PERSONAL_ARCHIVE_LIMITS, isPersonalArchiveName,
} from "./personal-archive.js";
import {
  PERSONAL_EXPORT_SHAPES, PERSONAL_READER_LIMITS,
} from "./personal-history-contract.js";

/**
 * What a run of this workflow was started by. The report is the same either way
 * — the same reader, the same contract, the same figures — but a reader must
 * never mistake the worked example for a reading of their own history, so the
 * kind travels with the run and is printed on the result.
 */
export const PERSONAL_RUN_KIND = Object.freeze({
  file: "file",
  preview: "preview",
});

/**
 * The file endings each supported shape actually arrives as.
 *
 * Extensions rather than media types, because the media type a browser reports
 * for a `.csv` picked out of a downloads folder is anything from `text/csv` to
 * `application/vnd.ms-excel` to the empty string, and refusing a person's own
 * export over an operating-system guess is the worst possible first impression.
 * The extension is a hint too — the real decision is
 * `detectPersonalExportShape`, which reads the bytes — so this list exists only
 * to say "that is a PDF" before a reader waits for a read that cannot succeed.
 */
export const PERSONAL_FILE_KINDS = Object.freeze(PERSONAL_EXPORT_SHAPES.map((shape) => Object.freeze({
  id: shape.id,
  label: shape.label,
  container: shape.container,
  // The JSON shape arrives twice: as the file itself, and as the one member of
  // the archive a console hands back. The archive is a container around this
  // same shape and not a third shape — it is opened in the tab, one declared
  // member is taken out of it, and that member goes to this same reader.
  extensions: Object.freeze(shape.container === "json"
    ? [".json", PERSONAL_ARCHIVE_EXTENSION]
    : [".csv", ".tsv", ".txt"]),
})));

export const PERSONAL_FILE_EXTENSIONS = Object.freeze(
  [...new Set(PERSONAL_FILE_KINDS.flatMap((kind) => kind.extensions))],
);

/** The `accept` attribute the picker is given. A hint to the picker, never a check. */
export const PERSONAL_FILE_ACCEPT = PERSONAL_FILE_EXTENSIONS.join(",");

/**
 * The ceiling this entry applies before a byte is read, in bytes.
 *
 * The reader's own ceiling is on characters. A UTF-8 file is never shorter in
 * bytes than in characters, so anything under this byte ceiling is definitely
 * under the character one and is passed through untouched. The converse does not
 * hold — a multi-byte file over this ceiling might have squeaked under the
 * character one — and it is refused anyway, because the only way to find out is
 * to pull the whole file into this tab, which is the thing the ceiling exists to
 * prevent.
 */
export const PERSONAL_MAX_FILE_BYTES = PERSONAL_READER_LIMITS.maxChars;

/** Why a chosen file was refused before it was read. A closed set. */
export const PERSONAL_ENTRY_REFUSAL = Object.freeze({
  noFile: "no_file",
  unsupportedFileType: "unsupported_file_type",
  fileTooLarge: "file_too_large",
  readFailed: "read_failed",
});

const extensionOf = (name) => {
  const at = String(name ?? "").lastIndexOf(".");
  return at === -1 ? "" : String(name).slice(at).toLowerCase();
};

const listed = (values) => values.slice(0, -1).join(", ") + (values.length > 1 ? ` or ${values.at(-1)}` : values[0]);

/**
 * Whether a chosen file may be read at all, decided from what the picker hands
 * over and nothing else: a name and a byte length. The file is not opened here.
 *
 * @param {{name?: string, size?: number}|null} file the picker's own entry.
 * @returns {{eligible: boolean, code: string|null, extension: string,
 *   summary: string, detail: string, remedy: string}} a refusal carries the
 *   three sentences a surface prints; an eligible file carries the same fields
 *   empty so a caller never branches on the shape.
 */
export function personalFileEligibility(file) {
  const extension = extensionOf(file?.name);
  const refuse = (code, summary, detail, remedy) => Object.freeze({
    eligible: false, code, extension, summary, detail, remedy,
  });

  if (!file) {
    return refuse(
      PERSONAL_ENTRY_REFUSAL.noFile,
      "No file was chosen",
      "The picker closed without a file, so there was nothing to read.",
      "Choose your export again. Nothing was read and nothing was kept.",
    );
  }
  if (!PERSONAL_FILE_EXTENSIONS.includes(extension)) {
    return refuse(
      PERSONAL_ENTRY_REFUSAL.unsupportedFileType,
      `A ${extension || "file with no extension"} is not one of the two shapes this reader accepts`,
      `This workflow reads a personal conversation export (${listed([".json", PERSONAL_ARCHIVE_EXTENSION])}) `
        + `or a personal prompt log (${listed([".csv", ".tsv", ".txt"])}). The file you chose was not `
        + "opened, because a shape this reader cannot recognize is not guessed at.",
      "Export your history again in one of the two shapes described above and choose that file. "
        + "Nothing was uploaded, and the file you chose was never read.",
    );
  }
  // An archive is compressed, so the byte ceiling a text file meets would refuse
  // archives well inside what this tab can open. It gets its own, and the
  // member it holds meets the reader's character ceiling after decompression —
  // an archive is not a way around a limit, only a different measure of it.
  const archive = isPersonalArchiveName(file.name);
  const ceiling = archive ? PERSONAL_ARCHIVE_LIMITS.maxArchiveBytes : PERSONAL_MAX_FILE_BYTES;
  if (Number.isFinite(file.size) && file.size > ceiling) {
    return refuse(
      PERSONAL_ENTRY_REFUSAL.fileTooLarge,
      `This ${archive ? "archive" : "export"} is too large to read in a browser tab`,
      `Reading is single-threaded and happens in this tab, so this workflow stops at `
        + `${ceiling.toLocaleString("en-US")} bytes. Your file was measured and not opened.`,
      "Split the export and read one part at a time. A part read on its own is a complete reading "
        + "of that part, and no figure is drawn from a file that was only half read.",
    );
  }
  return Object.freeze({ eligible: true, code: null, extension, summary: "", detail: "", remedy: "" });
}

/**
 * The three things this workflow does with a file, named so a reader waiting on
 * a slow read is told which one is happening rather than watching a spinner.
 *
 * They are the stages the code already walks — read the bytes, grade each
 * prompt, build the report — and not an invented progress bar: each one is a
 * real await or a real call in personal-history-page.js.
 */
export const PERSONAL_READ_STAGES = Object.freeze([
  Object.freeze({
    id: "read",
    label: "Reading the file",
    detail: "Your export is read into this tab. It is not uploaded, and no request leaves the page.",
  }),
  Object.freeze({
    id: "grade",
    label: "Grading your prompts",
    detail: "Each message you wrote is measured against the bundled rubric and dropped in the same "
      + "call. Assistant replies are not read at all.",
  }),
  Object.freeze({
    id: "report",
    label: "Building your report",
    detail: "Counts and move identifiers are assembled into the report. No prompt text survives this "
      + "step, because none of it was kept past the step before.",
  }),
]);

const STAGE_STATE_TEXT = Object.freeze({
  complete: { status: "done", shape: "✓" },
  current: { status: "now", shape: "●" },
  remaining: { status: "next", shape: "○" },
});

/**
 * Current / completed / remaining for each stage, with the word and the glyph a
 * surface prints. Never colour alone: the state is a word, a shape, and a
 * position, and the stylesheet is the fourth channel.
 */
export function personalStageProgress(stageId) {
  const index = Math.max(0, PERSONAL_READ_STAGES.findIndex((stage) => stage.id === stageId));
  return PERSONAL_READ_STAGES.map((stage, position) => {
    const state = position < index ? "complete" : position === index ? "current" : "remaining";
    return Object.freeze({
      ...stage,
      state,
      position: position + 1,
      status: STAGE_STATE_TEXT[state].status,
      shape: STAGE_STATE_TEXT[state].shape,
    });
  });
}

/**
 * The run ledger: one counter, and the only thing that decides whether an async
 * completion is allowed to paint.
 *
 * WHY THIS EXISTS. Two starts and a clear can all be outstanding at once — a
 * file read is an await, the worked example is an await, and a reader who
 * pressed Clear is owed an empty page whatever is still in flight. Without a
 * token the last promise to settle wins, which is how a cleared page paints a
 * report and how the example's figures land under a heading that says they are
 * the reader's own.
 *
 * HOW IT WORKS. Every start takes a token and becomes the current run; every
 * clear takes a token nobody holds. A completion asks `isCurrent(token)` before
 * it touches the DOM, so a superseded run cannot paint, cannot announce, and
 * cannot re-enable a control. There is no cancellation of the work itself —
 * reading a file and grading it are cheap and pure — only of its right to
 * mutate the page, which is the thing that was actually broken.
 */
export function createRunLedger() {
  let issued = 0;
  let current = 0;
  let kind = null;

  return Object.freeze({
    /** Take the next token and make it the current run. */
    start(runKind) {
      issued += 1;
      current = issued;
      kind = runKind ?? null;
      return current;
    },
    /**
     * Invalidate every outstanding run without starting one. What Clear does:
     * the token it takes is held by nobody, so every completion still in flight
     * finds itself stale.
     */
    invalidate() {
      issued += 1;
      current = issued;
      kind = null;
      return current;
    },
    isCurrent: (token) => token === current && token !== 0,
    /** The kind of the run in flight, or null when nothing is. */
    get runningKind() { return kind; },
    get running() { return kind !== null; },
    /** Mark the current run finished. Only the run that owns the token may. */
    finish(token) {
      if (token === current) kind = null;
      return kind === null;
    },
  });
}
