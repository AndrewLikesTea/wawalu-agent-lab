// Where a person gets the export this page reads, per assistant.
//
// WHY THIS EXISTS. The page already says what it does with a file
// (`PERSONAL_BOUNDARY`), which shapes it reads (`PERSONAL_EXPORT_SHAPES`), and
// which containers it opens (`PERSONAL_ARCHIVE_PACKAGES`). It said nothing about
// the step before all three — *go to your assistant and ask for your data* — and
// that is the step a reader is actually standing on when they arrive. Without it
// the workflow starts at "choose a file" for a file nobody has yet.
//
// WHAT IT IS. Data plus accessors, in the same four-term shape the organizational
// intake uses (`exportPackageGuidance` in provider-export-package.js), so a
// reader who has seen one of these panels can read the other down a column: ask
// for, arrives as, accepted here, take out first. A source is added by adding an
// entry here — never by branching in the reader, the picker, or the markup.
//
// THREE RULES, the same three the organizational package contract holds itself
// to, restated because this is a second contract and not a reference to one:
//
//   1. Nothing here reaches an assistant. There is no endpoint, no credential,
//      no OAuth step, and no redirect. The reader asks their own assistant for
//      their own export, downloads it themselves, and chooses the file. This
//      module describes their console; the product never touches it.
//   2. A console path is documentation, and it is dated by the version below. A
//      vendor rearranges a menu; that is a bump here, not a code change, and a
//      reader who cannot find the menu still has `arrives_as` and `accepted` to
//      recognize the right file by.
//   3. Whether an archive can be opened in the tab is *derived*, never declared.
//      `archiveSupported` is computed against `PERSONAL_ARCHIVE_MEMBERS`, so a
//      source whose archive holds a member this repository does not open cannot
//      promise on this panel that it will be opened.
//
// No DOM, no I/O, no network. Pure data plus pure functions.

import { PERSONAL_ARCHIVE_EXTENSION, PERSONAL_ARCHIVE_MEMBERS } from "./personal-archive.js";

/** Bump when a console path, a member name, or a term changes meaning. */
export const PERSONAL_EXPORT_SOURCES_VERSION = "personal-export-sources/1.0.0";

/**
 * The one promise this panel makes, written once and painted wherever guidance
 * is. It is a statement about the shipped code — see `PERSONAL_BOUNDARY` and the
 * mechanical checks behind `PERSONAL_HISTORY_EXCLUSIONS` — not a reassurance.
 */
export const PERSONAL_SOURCE_INTAKE_SENTENCE =
  "Every file below is read in this browser tab: nothing is uploaded, no assistant account is "
  + "connected, no credential is used, and no prompt you wrote is kept or drawn on this page.";

/**
 * Consoles move. Said on the panel rather than left for a reader to discover,
 * because a stale menu path that presents itself as current is the one way this
 * guidance can waste somebody's afternoon.
 */
export const PERSONAL_SOURCE_STALENESS =
  "Menu paths were true when this version shipped and assistants rearrange them. If the menu has "
  + "moved, look for “export”, “your data”, or “privacy” in your account settings — what arrives "
  + "is described below and is what you are looking for.";

const source = (entry) => Object.freeze({
  ...entry,
  request: Object.freeze(entry.request),
  arrives: Object.freeze(entry.arrives),
  accepted: Object.freeze(entry.accepted),
  leaveOut: Object.freeze(entry.leaveOut),
});

/**
 * One entry per way a person can obtain their own history.
 *
 * The last entry is deliberately not a vendor: anybody who can put a date column
 * and a prompt column in a spreadsheet has an eligible export, and a reader whose
 * assistant is on none of these lists is owed that path rather than a dead end.
 */
export const PERSONAL_EXPORT_SOURCES = Object.freeze([
  source({
    id: "chatgpt",
    label: "ChatGPT (OpenAI)",
    shape: "personal-conversation-json",
    request: {
      requestedBy: "you, for your own account — no admin seat and no workspace owner is involved",
      path: "Settings → Data controls → Export data, then confirm from the email that follows",
      askFor: "your own conversation history",
      not: "a workspace or compliance export, which is somebody else's data as well as yours",
      wait: "the download link arrives by email, usually within a few minutes",
    },
    arrives: {
      container: "zip",
      delivery: "a download link, saved wherever your browser saves things",
      member: "conversations.json",
      expect: "one entry per conversation, each carrying the messages in it",
    },
    accepted: [PERSONAL_ARCHIVE_EXTENSION, ".json"],
    leaveOut: [
      "Nothing has to be removed: the archive is opened here and only conversations.json is read out of it.",
      "Every other member of the archive — images, audio, the HTML viewer — is passed over undecompressed.",
    ],
  }),
  source({
    id: "claude",
    label: "Claude (Anthropic)",
    shape: "personal-conversation-json",
    request: {
      requestedBy: "you, for your own account",
      path: "Settings → Privacy → Export data",
      askFor: "your own conversation history",
      not: "an organization usage or billing export — that is a different file with its own reader",
      wait: "the download link arrives by email",
    },
    arrives: {
      container: "zip",
      delivery: "a download link, saved wherever your browser saves things",
      member: "conversations.json",
      expect: "one entry per conversation, each carrying the messages in it",
    },
    accepted: [PERSONAL_ARCHIVE_EXTENSION, ".json"],
    leaveOut: [
      "Nothing has to be removed: the archive is opened here and only conversations.json is read out of it.",
      "If your archive names that file something else, open it yourself and choose the JSON inside.",
    ],
  }),
  source({
    id: "gemini",
    label: "Gemini (Google)",
    shape: "personal-conversation-json",
    request: {
      requestedBy: "you, from your own Google account",
      path: "Google Takeout → deselect all → select the Gemini Apps activity → export once",
      askFor: "your Gemini activity, as JSON rather than HTML",
      not: "the whole Takeout of every Google product, which is large and almost all of it unread here",
      wait: "Takeout emails a link when the archive is built; a large account can take hours",
    },
    arrives: {
      container: "zip",
      delivery: "a Takeout download link",
      // Takeout does not name its member the way this reader's declared list
      // does, and `archiveSupported` derives false from exactly that.
      member: "an activity JSON inside the Takeout folder",
      expect: "one record per turn, with a timestamp on each",
    },
    accepted: [".json"],
    leaveOut: [
      "Export Gemini activity only; nothing else in a Takeout is read, so exporting more only makes the wait longer.",
      "Choose JSON, not HTML: an HTML activity page is a rendered document and is refused rather than parsed.",
    ],
  }),
  source({
    id: "prompt-log",
    label: "Any assistant, as your own prompt log",
    shape: "personal-prompt-table",
    request: {
      requestedBy: "you, from a spreadsheet or a script you already have",
      path: "any spreadsheet: one row per prompt, a date column, and a prompt column",
      askFor: "the prompts you wrote, one per row, with the day you wrote each",
      not: "the assistant's replies — they are not read, so a reply column is only bulk",
      wait: "none; this is a file you make",
    },
    arrives: {
      container: "file",
      delivery: "saved by you as CSV or TSV",
      member: null,
      expect: "a header row naming a date column and a prompt column, then one row per prompt",
    },
    accepted: [".csv", ".tsv", ".txt"],
    leaveOut: [
      "Delete any column holding a name, an email address, an account, or a customer's details — none of them are read, and a column that is not in the file cannot be.",
      "One prompt per row: a cell holding a whole conversation is graded as a single prompt.",
    ],
  }),
]);

/** The source a reader lands on. First rather than a guess about their assistant. */
export const DEFAULT_PERSONAL_EXPORT_SOURCE = PERSONAL_EXPORT_SOURCES[0].id;

export function personalExportSourceById(id) {
  return PERSONAL_EXPORT_SOURCES.find((entry) => entry.id === id)
    ?? PERSONAL_EXPORT_SOURCES.find((entry) => entry.id === DEFAULT_PERSONAL_EXPORT_SOURCE);
}

/**
 * Whether this page opens the container this source delivers, derived from the
 * member list `personal-archive.js` actually matches on.
 *
 * A source delivering a single file is trivially supported. A source delivering
 * an archive is supported only when the member it carries is one this repository
 * named — which is why the member is compared here rather than a boolean being
 * declared alongside it. A `true` written by hand next to a member nobody opens
 * is a promise the intake would then break.
 */
export function archiveSupported(entry) {
  if (!entry || entry.arrives.container !== "zip") return true;
  return PERSONAL_ARCHIVE_MEMBERS.includes(entry.arrives.member);
}

/**
 * What this page does with the container the source delivers, in one sentence a
 * reader can act on.
 */
export function containerHandling(entry) {
  if (!entry) return "";
  if (entry.arrives.container !== "zip") {
    return "Choose the file itself — it is read directly, with no unpacking step.";
  }
  if (archiveSupported(entry)) {
    return `Choose the ${PERSONAL_ARCHIVE_EXTENSION} as it downloaded. It is opened in this tab, `
      + `${entry.arrives.member} is taken out of it, and nothing else in it is decompressed or looked at.`;
  }
  return `This ${PERSONAL_ARCHIVE_EXTENSION} is not opened here, because the member this reader opens `
    + `(${PERSONAL_ARCHIVE_MEMBERS.join(", ")}) is not the one it carries. Open the archive on your own `
    + "machine and choose the JSON inside it — it is read by exactly the same reader either way.";
}

/**
 * The guidance rows a panel paints for one source: four terms, fixed and in one
 * order, so four vendors are a table of the same four questions rather than four
 * paragraphs.
 */
export function personalSourceGuidance(entry) {
  if (!entry) return [];
  const { request, arrives } = entry;
  return Object.freeze([
    Object.freeze({
      id: "ask-for",
      term: "Ask for",
      detail: `${request.askFor} — ${request.path}. Requested by ${request.requestedBy}. `
        + `Not ${request.not}.`,
    }),
    Object.freeze({
      id: "arrives-as",
      term: "Arrives as",
      detail: `${arrives.container === "zip" ? "A ZIP archive" : "A single file"}: `
        + `${arrives.delivery} — ${request.wait}. Expect ${arrives.expect}.`,
    }),
    Object.freeze({
      id: "accepted",
      term: "Accepted here",
      detail: `${entry.accepted.join(", ")}. ${containerHandling(entry)}`,
    }),
    Object.freeze({
      id: "leave-out",
      term: "Take out first",
      detail: entry.leaveOut.join(" "),
    }),
  ]);
}
