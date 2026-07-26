// Restore a Shiplog export back into this browser.
//
// The contract is the exporter, not a new schema: createShiplogExport emits
// `{ schema, version, generatedAt, decisions, releases }`, where each record is
// exactly what loadDecisions/loadReleases already accept out of storage. So the
// validation below mirrors isDecision/isRelease field for field and nothing
// more — being stricter than the store would reject records the store itself
// holds today and break the export → import → export round trip.
//
// The file is read in the tab and parsed here. Nothing is uploaded, POSTed, or
// fetched: this module has no network call and no DOM access above the render
// layer at the bottom, so the whole data model is unit testable directly.
//
// Layering, in the order the flow uses it:
//   parseImport            pure: text -> accepted records + specific rejections
//   mergeImport            pure: parsed + existing -> the full record set to write
//   prepareShiplogImport   reads storage, returns a plan; writes nothing
//   commitShiplogImport    the only writer; one write per store, or none

import {
  MAX_ALTERNATIVES_LENGTH,
  MAX_CONTEXT_LENGTH,
  MAX_OWNER_LENGTH,
  MAX_TITLE_LENGTH,
  STATUSES,
  STORAGE_KEY,
  loadDecisions,
  saveDecisions,
} from "./app.js";
import { RELEASE_STORAGE_KEY, loadReleases, saveReleases } from "./releases.js";
import { SHIPLOG_EXPORT_SCHEMA, SHIPLOG_EXPORT_VERSION } from "./shiplog-export.js";

// Everything createShiplogExport writes. Anything else in the file is reported
// and ignored rather than silently carried into storage.
export const IMPORT_TOP_LEVEL_KEYS = ["schema", "version", "generatedAt", "decisions", "releases"];

function describe(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return Array.isArray(value) ? "array" : typeof value;
}

// Error text names the offending value, so a rejection is actionable without
// opening the file. Only primitives are echoed; objects are named by type.
function show(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  return describe(value);
}

function checkString(value, path, { max, optional = false } = {}) {
  if (value === undefined) return optional ? null : `${path}: required, got undefined`;
  if (typeof value !== "string") return `${path}: expected string, got ${describe(value)}`;
  if (!optional && value.trim() === "") return `${path}: expected a non-empty string, got ${JSON.stringify(value)}`;
  if (max !== undefined && value.length > max) {
    return `${path}: expected at most ${max} characters, got ${value.length}`;
  }
  return null;
}

function checkIsoDate(value, path) {
  const invalid = checkString(value, path);
  if (invalid) return invalid;
  if (Number.isNaN(Date.parse(value))) {
    return `${path}: expected an ISO date string, got ${JSON.stringify(value)}`;
  }
  return null;
}

function checkRecordObject(record, path) {
  return record === null || typeof record !== "object" || Array.isArray(record)
    ? `${path}: expected object, got ${describe(record)}`
    : null;
}

function collect(errors, ...results) {
  for (const result of results) if (result) errors.push(result);
  return errors;
}

// Mirrors isDecision in app.js. `alternatives` stays optional and may be empty:
// createDecision writes "" when the field is left blank.
export function validateDecision(record, path) {
  const shape = checkRecordObject(record, path);
  if (shape) return [shape];
  const errors = collect(
    [],
    checkString(record.id, `${path}.id`),
    checkString(record.title, `${path}.title`, { max: MAX_TITLE_LENGTH }),
    checkString(record.context, `${path}.context`, { max: MAX_CONTEXT_LENGTH }),
    checkString(record.alternatives, `${path}.alternatives`, {
      max: MAX_ALTERNATIVES_LENGTH,
      optional: true,
    }),
    checkString(record.owner, `${path}.owner`, { max: MAX_OWNER_LENGTH }),
    checkIsoDate(record.createdAt, `${path}.createdAt`),
  );
  if (!STATUSES.includes(record.status)) {
    errors.push(`${path}.status: expected one of ${STATUSES.join(", ")}, got ${show(record.status)}`);
  }
  return errors;
}

// Mirrors isRelease in releases.js. title/description/notes/owner/author/status
// are optional there and are carried through untouched, so an older export does
// not lose attribution on the way back in.
export function validateRelease(record, path) {
  const shape = checkRecordObject(record, path);
  if (shape) return [shape];
  const errors = collect(
    [],
    checkString(record.id, `${path}.id`),
    checkString(record.version, `${path}.version`),
    checkIsoDate(record.createdAt, `${path}.createdAt`),
  );
  if (!Array.isArray(record.decisionIds)) {
    errors.push(`${path}.decisionIds: expected array, got ${describe(record.decisionIds)}`);
  } else {
    record.decisionIds.forEach((id, index) => {
      if (typeof id !== "string") {
        errors.push(`${path}.decisionIds[${index}]: expected string, got ${describe(id)}`);
      }
    });
  }
  return errors;
}

function rejection(collection, index, id, message) {
  return { collection, index, id, message };
}

function recordId(record) {
  return record !== null && typeof record === "object" && typeof record.id === "string" ? record.id : null;
}

// A whole-file failure. The file is unreadable as a Shiplog export, so there is
// nothing to offer the user; the reason is still specific about which part of
// the top-level shape was wrong.
function unusable(message) {
  return {
    ok: false,
    error: message,
    schema: null,
    version: null,
    generatedAt: null,
    decisions: [],
    releases: [],
    rejected: [rejection("file", null, null, message)],
    droppedAssociations: [],
  };
}

/**
 * Parse an exported Shiplog file. Pure: no DOM, no storage, no network.
 *
 * `options.existingDecisionIds` are the decision ids already in the store. They
 * only widen which release→decision links survive; passing none makes the file
 * self-contained, which is what the round-trip case wants.
 *
 * A bad record is rejected on its own and never stops the rest of the file.
 * Only a non-JSON file or an unrecognizable top-level shape fails as a whole.
 */
export function parseImport(text, options = {}) {
  if (typeof text !== "string") {
    return unusable(`file: expected text, got ${describe(text)}`);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return unusable(`file: expected JSON, got a parse error (${error.message})`);
  }

  const shape = checkRecordObject(raw, "file");
  if (shape) return unusable(`file: expected a Shiplog export object, got ${describe(raw)}`);
  if (raw.schema !== SHIPLOG_EXPORT_SCHEMA) {
    return unusable(`schema: expected ${JSON.stringify(SHIPLOG_EXPORT_SCHEMA)}, got ${show(raw.schema)}`);
  }
  if (raw.version !== SHIPLOG_EXPORT_VERSION) {
    return unusable(`version: expected ${SHIPLOG_EXPORT_VERSION}, got ${show(raw.version)}`);
  }
  if (!Array.isArray(raw.decisions)) {
    return unusable(`decisions: expected array, got ${describe(raw.decisions)}`);
  }
  if (!Array.isArray(raw.releases)) {
    return unusable(`releases: expected array, got ${describe(raw.releases)}`);
  }

  const rejected = [];
  const droppedAssociations = [];

  for (const key of Object.keys(raw)) {
    if (!IMPORT_TOP_LEVEL_KEYS.includes(key)) {
      rejected.push(rejection("file", null, null, `file.${key}: unknown top-level key, not imported`));
    }
  }
  const generatedAtError = checkIsoDate(raw.generatedAt, "generatedAt");
  if (generatedAtError) rejected.push(rejection("file", null, null, generatedAtError));

  const decisions = [];
  raw.decisions.forEach((record, index) => {
    const errors = validateDecision(record, `decisions[${index}]`);
    if (errors.length > 0) {
      for (const message of errors) rejected.push(rejection("decisions", index, recordId(record), message));
      return;
    }
    decisions.push(structuredClone(record));
  });

  // A link survives when its decision will exist after the import: accepted in
  // this file, or already in the store. Everything else is dropped here rather
  // than written as a dangling reference.
  const available = new Set([
    ...(options.existingDecisionIds ?? []),
    ...decisions.map((decision) => decision.id),
  ]);

  const releases = [];
  raw.releases.forEach((record, index) => {
    const path = `releases[${index}]`;
    const errors = validateRelease(record, path);
    if (errors.length > 0) {
      for (const message of errors) rejected.push(rejection("releases", index, recordId(record), message));
      return;
    }
    const decisionIds = [];
    record.decisionIds.forEach((id, position) => {
      if (available.has(id)) {
        decisionIds.push(id);
        return;
      }
      droppedAssociations.push({
        releaseId: record.id,
        releaseIndex: index,
        decisionId: id,
        message: `${path}.decisionIds[${position}]: dropped link to unknown decision ${JSON.stringify(id)}`,
      });
    });
    releases.push({ ...structuredClone(record), decisionIds });
  });

  return {
    ok: true,
    error: null,
    schema: raw.schema,
    version: raw.version,
    generatedAt: raw.generatedAt,
    decisions,
    releases,
    rejected,
    droppedAssociations,
  };
}

function mergeCollection(incoming, existing) {
  const seen = new Set(existing.map((record) => record.id));
  const added = [];
  const duplicates = [];
  for (const record of incoming) {
    // Duplicates are skipped, never overwritten and never added twice. The
    // second copy of an id inside one file is a duplicate of the first.
    if (seen.has(record.id)) {
      duplicates.push(record.id);
      continue;
    }
    seen.add(record.id);
    added.push(record);
  }
  return { records: [...existing, ...added], added, duplicates };
}

/**
 * Combine a parse result with what is already stored. Pure. Returns the
 * complete record set to write plus the counts the pre-commit summary shows.
 * Existing records keep their position; new ones are appended.
 */
export function mergeImport(parsed, existing = {}) {
  const decisions = mergeCollection(parsed.decisions ?? [], existing.decisions ?? []);
  const releases = mergeCollection(parsed.releases ?? [], existing.releases ?? []);
  return {
    decisions: decisions.records,
    releases: releases.records,
    summary: {
      decisionsFound: (parsed.decisions ?? []).length,
      releasesFound: (parsed.releases ?? []).length,
      newDecisions: decisions.added.length,
      newReleases: releases.added.length,
      duplicateDecisions: decisions.duplicates.length,
      duplicateReleases: releases.duplicates.length,
      rejected: (parsed.rejected ?? []).length,
      droppedAssociations: (parsed.droppedAssociations ?? []).length,
      restorable: decisions.added.length + releases.added.length,
    },
  };
}

/**
 * Read the current store and produce a plan. Writes nothing: the user has not
 * confirmed yet, so this is the whole pre-commit state the UI renders from.
 */
export function prepareShiplogImport(storage, text) {
  const existing = {
    decisions: loadDecisions(storage),
    releases: loadReleases(storage),
  };
  const parsed = parseImport(text, {
    existingDecisionIds: existing.decisions.map((decision) => decision.id),
  });
  if (!parsed.ok) return { ok: false, parsed, merged: null };
  return { ok: true, parsed, merged: mergeImport(parsed, existing) };
}

function restore(storage, key, value) {
  try {
    if (value !== null && value !== undefined) storage.setItem(key, value);
    else if (typeof storage.removeItem === "function") storage.removeItem(key);
    else storage.setItem(key, "[]");
  } catch {
    // The store is already refusing writes; the caller reports the failure.
  }
}

/**
 * Commit a plan. localStorage has no transaction, so this is the closest
 * all-or-nothing the store allows: both record sets are serialized up front (a
 * serialization failure writes nothing at all), each store is written once as a
 * whole set rather than appended per record, and a failure on the second write
 * rolls the first back to the exact bytes that were there before.
 */
export function commitShiplogImport(storage, plan) {
  if (!plan?.ok || !plan.merged) {
    throw new TypeError("Cannot restore an import that could not be read.");
  }
  // Dry run: proves both sets serialize before either store is touched.
  JSON.stringify(plan.merged.decisions);
  JSON.stringify(plan.merged.releases);

  const previousDecisions = storage.getItem(STORAGE_KEY);
  const previousReleases = storage.getItem(RELEASE_STORAGE_KEY);
  try {
    saveDecisions(storage, plan.merged.decisions);
    saveReleases(storage, plan.merged.releases);
  } catch (error) {
    restore(storage, STORAGE_KEY, previousDecisions);
    restore(storage, RELEASE_STORAGE_KEY, previousReleases);
    throw error;
  }
  return plan.merged.summary;
}

function plural(count, noun) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

export function formatImportSummary(summary) {
  const parts = [
    `Found ${plural(summary.decisionsFound, "decision")} and ${plural(summary.releasesFound, "release")} in this file.`,
    `${plural(summary.newDecisions + summary.newReleases, "record")} new, ${summary.duplicateDecisions + summary.duplicateReleases} already in this browser and skipped.`,
  ];
  parts.push(`${plural(summary.rejected, "record")} rejected, ${plural(summary.droppedAssociations, "release link")} dropped.`);
  return parts.join(" ");
}

export function formatRestoreAction(summary) {
  return `Restore ${plural(summary.restorable, "record")}`;
}

// ---------------------------------------------------------------------------
// Render layer. Every value that came out of the file is written through
// textContent, never an HTML string, so imported text can never execute
// (PRODUCT.md: no user-generated HTML). The panel keeps exactly one piece of
// state — `plan` — and everything on screen is derived from it.
// ---------------------------------------------------------------------------

function readSelectedFile(file) {
  return file.text();
}

function detailItems(plan) {
  if (!plan.ok) return [plan.parsed.error];
  return [
    ...plan.parsed.rejected.map((entry) => entry.message),
    ...plan.parsed.droppedAssociations.map((entry) => entry.message),
  ];
}

export function initShiplogImport(root, storage, options = {}) {
  const input = root.querySelector("#import-shiplog-file");
  const panel = root.querySelector("#import-shiplog-summary");
  const headline = root.querySelector("#import-shiplog-headline");
  const detail = root.querySelector("#import-shiplog-detail");
  const detailToggle = root.querySelector("#import-shiplog-detail-toggle");
  const commit = root.querySelector("#import-shiplog-commit");
  const cancel = root.querySelector("#import-shiplog-cancel");
  const status = root.querySelector("#import-shiplog-status");
  if (!input || !panel || !headline || !commit) return;

  const readFile = options.readFile ?? readSelectedFile;
  let plan = null;

  const clear = () => {
    plan = null;
    panel.hidden = true;
    headline.textContent = "";
    detail?.replaceChildren();
    if (detailToggle) detailToggle.hidden = true;
    if (input.value !== undefined) input.value = "";
  };

  const render = () => {
    const items = detailItems(plan);
    panel.hidden = false;
    headline.textContent = plan.ok
      ? formatImportSummary(plan.merged.summary)
      : `This file could not be read as a Shiplog export. ${plan.parsed.error}`;
    commit.hidden = !plan.ok;
    if (plan.ok) {
      commit.textContent = formatRestoreAction(plan.merged.summary);
      commit.disabled = plan.merged.summary.restorable === 0;
    }
    if (detail) {
      detail.replaceChildren();
      for (const message of items) {
        const item = document.createElement("li");
        item.textContent = message;
        detail.append(item);
      }
    }
    if (detailToggle) {
      detailToggle.hidden = items.length === 0;
      detailToggle.textContent = `${plural(items.length, "record note")}`;
    }
    // Focus moves to the decision the user now has to make, not past it.
    (plan.ok && !commit.disabled ? commit : headline).focus?.({ preventScroll: true });
  };

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) {
      clear();
      return;
    }
    if (status) status.textContent = "";
    let text;
    try {
      text = await readFile(file);
    } catch {
      clear();
      if (status) {
        status.textContent = "That file could not be read. Nothing in this browser was changed.";
      }
      return;
    }
    plan = prepareShiplogImport(storage, text);
    render();
  });

  commit.addEventListener("click", () => {
    if (!plan?.ok) return;
    try {
      const summary = commitShiplogImport(storage, plan);
      if (status) {
        status.textContent = `Restored ${plural(summary.restorable, "record")}. Reload to see them in your history.`;
      }
    } catch {
      if (status) {
        status.textContent = "Nothing was restored. Your existing records were left unchanged.";
      }
    }
    clear();
    input.focus?.({ preventScroll: true });
  });

  cancel?.addEventListener("click", () => {
    clear();
    if (status) status.textContent = "Import cancelled. Nothing was changed.";
    input.focus?.({ preventScroll: true });
  });
}
