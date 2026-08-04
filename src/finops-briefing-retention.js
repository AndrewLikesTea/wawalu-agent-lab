/**
 * Opt-in local retention for the AI FinOps import result (#959).
 *
 * A reader who imports a provider export gets a briefing that dies with the
 * tab. This module is the one place that can make it survive a reload, and it
 * is deliberately the smallest thing that can: one storage key, one versioned
 * payload, four operations (read, write, forget, rebuild), no DOM, no clock of
 * its own, no transport, and no import of the page entry.
 *
 * THREE RULES THIS FILE EXISTS TO HOLD
 * ------------------------------------
 *
 *  1. OFF UNTIL ASKED. Nothing here writes on its own. `writeRetainedBriefing`
 *     runs when a reader turns the control on and at no other moment, so a
 *     visitor who never touches it leaves this browser exactly as they found
 *     it. That is the opposite default from `local-retention.js`, which governs
 *     Shiplog's own records and treats undecided as retaining — a briefing
 *     derived from a reader's own billing export has never been kept here
 *     before, so there is no prior behaviour for silence to preserve.
 *
 *  2. ONLY WHAT IS ENUMERATED. `retainedBriefingPayload` builds a FRESH object
 *     field by field. There is no spread of the analysis envelope, no
 *     `JSON.stringify` of a parsed import, and no pass-through of an unknown
 *     key — so a field added upstream cannot arrive in this browser's storage
 *     by accident. What may be kept is totals, department rollups, the detected
 *     provider and its recognition confidence, the analysis's own confidence
 *     word, and when the capture happened. Raw export text, per-row records,
 *     file names and anything prompt-shaped have no path through this function.
 *
 *     The one field that needs its own sentence is `rankedAction`: the
 *     envelope's rank-1 recommendation. It is retained because it is composed
 *     from the rank-1 department rollup already retained beside it — that
 *     department's name and its recoverable total — so it discloses nothing the
 *     rollup does not, and because a restored briefing without it renders the
 *     briefing contract's "no department was ranked" statement, which would be
 *     a false sentence about a payload that retained ranked departments.
 *
 *  3. NO STORAGE CONDITION REACHES THE PAGE. Every getItem, setItem and
 *     removeItem below is wrapped. A browser with site data disabled throws on
 *     the accessor before a call is even made, a full one throws on the write,
 *     and a payload can be truncated, hand-edited or left behind by an older
 *     version of this page. Each of those returns a stated outcome with a
 *     sentence in it; none of them returns an exception, and no message here
 *     interpolates one.
 */

import { buildFinopsBriefing } from "./finops-briefing-contract.js";

/** One literal, shared by page load, import, forget and the tests. */
export const BRIEFING_RETENTION_KEY = "shiplog.finops.briefing.v1";

/** Bump when a field below changes meaning. A mismatch is discarded, not read. */
export const BRIEFING_RETENTION_VERSION = 1;

/** What the store is doing, in this module's own words. */
export const RETENTION_STATE = Object.freeze({
  /** Nothing has been kept, and the control is operable. */
  off: "off",
  /** A valid current-version payload is in this browser. */
  retained: "retained",
  /** This browser refuses storage. Nothing was kept and nothing can be. */
  unavailable: "unavailable",
  /** Something was there, could not be read, and has been cleared. */
  discarded: "discarded",
  /** The reader asked to keep it and the browser refused the write. */
  writeRefused: "write-refused",
});

/**
 * Every sentence this feature says, authored once.
 *
 * `label` is the control's own visible label, and it has to state what is kept
 * and where before a reader can consent to it — derived values only, in this
 * browser, on this device.
 */
export const RETENTION_COPY = Object.freeze({
  label: "Keep this briefing in this browser, on this device",
  detail: "Derived values only: the spend and recoverable totals, the department rollups, the "
    + "detected provider and its recognition confidence, the confidence grade, and the time of "
    + "capture — plus the names, department categories and cohort facts you supplied here "
    + "yourself, with the time you last edited them. No file contents, no individual usage rows, "
    + "and no file names are written. Nothing is kept until you turn this on.",
  // Forget clears the WHOLE period series (#1089), not the newest month, so the
  // control says so: a reader who kept April, May and June is deleting three.
  forget: "Forget every period kept here",
  [RETENTION_STATE.off]:
    "Nothing is kept in this browser. Turning this on writes the derived values named above.",
  [RETENTION_STATE.retained]:
    "This briefing is kept in this browser, alongside every other period kept here. "
    + "Turning this off erases all of them.",
  [RETENTION_STATE.unavailable]:
    "Keeping a briefing is unavailable in this browser, so nothing was kept and nothing can be. "
    + "The briefing on screen is unaffected and lasts until this tab is closed.",
  [RETENTION_STATE.discarded]:
    "A briefing kept in this browser could not be restored, so it was discarded. The page is "
    + "showing its bundled synthetic example.",
  [RETENTION_STATE.writeRefused]:
    "This browser had no room to keep the briefing, so nothing was kept. The briefing on screen "
    + "is unaffected.",
  forgotten: "Every period kept here was erased from this browser.",
});

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const count = (value) => {
  const parsed = number(value);
  return parsed === null ? 0 : Math.max(0, Math.trunc(parsed));
};
const text = (value) => (typeof value === "string" && value.trim() ? value : null);

/** A ceiling on supplied entries, so nothing can grow this entry without bound. */
const MAX_CONTEXT_ENTRIES = 200;

/** A `{ id: word }` map of the reader's own strings, cleaned entry by entry. */
const suppliedMap = (value) => {
  const clean = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value).slice(0, MAX_CONTEXT_ENTRIES)) {
      const id = text(key);
      const word = text(entry);
      if (id && word) clean[id] = word;
    }
  }
  return Object.freeze(clean);
};

/**
 * The context a reader supplied by hand, normalized for the same record (#1010).
 *
 * IN THE IMPORT'S OWN RECORD, because a unit label, a department category and a
 * declared cohort attribute are all statements ABOUT one import. Under a second
 * key they would outlive it, and a reader who forgot a briefing would still be
 * carrying their reading of a company's departments. One record, one lifetime,
 * one erase. Nothing here is written without the same consent the figures
 * beside it needed, and `editedAt` comes from the caller — no clock is read.
 *
 * @returns the context, or null when the reader has supplied none of it.
 */
export function suppliedContext(supplied = null) {
  const { unitLabels = null, departments = null, cohort = null, editedAt = null } = supplied ?? {};
  const stamp = text(editedAt);
  if (!stamp) return null;
  const labels = suppliedMap(unitLabels);
  const categories = suppliedMap(departments);
  const band = text(cohort?.orgSizeBand);
  const industry = text(cohort?.industry);
  const facts = band && industry ? Object.freeze({ orgSizeBand: band, industry }) : null;
  if (!Object.keys(labels).length && !Object.keys(categories).length && !facts) return null;
  return Object.freeze({
    editedAt: stamp, unitLabels: labels, departments: categories, cohort: facts,
  });
}

/**
 * Absent is valid: a record written before this field existed is a complete
 * record of what it did carry. Present but not reproducible by the builder
 * above invalidates the WHOLE payload rather than being dropped from it —
 * half a restored record is a brief that disagrees with the one that was kept.
 */
const validContext = (value) => value === undefined || value === null
  || (typeof value === "object" && !Array.isArray(value) && suppliedContext(value) !== null);

/** The context a payload carries, or null. Read through one function. */
export function retainedSuppliedContext(payload) {
  return validPayload(payload) ? payload.context ?? null : null;
}

/** One department rollup: an aggregate over a unit, never a record from one. */
const departmentRollup = (department) => Object.freeze({
  id: text(department?.id) ?? "",
  name: text(department?.name) ?? "",
  spendUsd: number(department?.spendUsd) ?? 0,
  previousSpendUsd: number(department?.previousSpendUsd) ?? 0,
  recoverableUsd: number(department?.recoverableUsd) ?? 0,
});

/**
 * Build the payload a reader's opt-in writes.
 *
 * Every key below is written out by hand. Nothing is spread, nothing is copied
 * by iteration, and a caller that hands over a whole parsed import gets back an
 * object containing only these fields.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`.
 * @param provider `{ id, name, confidence }` from the recognition verdict.
 * @param capturedAt an ISO instant supplied by the caller; no clock is read here.
 * @returns the payload, or null when there is not enough to restore a briefing.
 */
export function retainedBriefingPayload({
  analysis = null, provider = null, capturedAt = null,
  attributionWithheld = false, sources = null, context = null,
} = {}) {
  const spendUsd = number(analysis?.spendUsd);
  const departments = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  const stamp = text(capturedAt);
  if (spendUsd === null || !departments.length || !stamp) return null;
  const periods = Array.isArray(analysis?.history?.periods) ? analysis.history.periods : [];
  return Object.freeze({
    version: BRIEFING_RETENTION_VERSION,
    capturedAt: stamp,
    provider: Object.freeze({
      id: text(provider?.id) ?? "unknown",
      name: text(provider?.name) ?? "Unnamed provider",
      confidence: count(provider?.confidence),
    }),
    confidence: text(analysis?.confidence) ?? "Low",
    totals: Object.freeze({
      analyzedSpendUsd: spendUsd,
      recoverableUsd: number(analysis?.recoverableUsd) ?? 0,
      recordsAnalyzed: count(analysis?.quality?.joinedRecords),
      recordsExcluded: count(analysis?.quality?.quarantinedRecords),
      period: text(analysis?.period),
      previousPeriod: text(analysis?.history?.previousPeriod),
      // Period totals, not period records: one summed figure per analyzed month,
      // which is what the change metric on the briefing is computed from.
      periods: Object.freeze(periods.map((entry) => Object.freeze({
        period: text(entry?.period) ?? "",
        spendUsd: number(entry?.spendUsd) ?? 0,
      }))),
    }),
    departments: Object.freeze(departments.map(departmentRollup)),
    rankedAction: text(analysis?.action),
    // The decision the live page made ABOUT this analysis, kept with it (#997).
    //
    // Without it a restore rebuilt the briefing with the suppression defaulted
    // off, and a figure the import refused to state came back stated as fact
    // one reload later — same data, stronger claim. It is a derived boolean and
    // two more: no cell, no name, no export content crosses into the payload,
    // and the file presence is here because it is what the decision was made
    // against, so a restore reproduces the outcome rather than re-deriving one
    // from a partial envelope.
    attribution: Object.freeze({
      withheld: Boolean(attributionWithheld),
      spendExport: sources?.spend !== false,
      conversationExport: Boolean(sources?.conversation),
    }),
    // What the reader said about this import, in the record the import is in
    // (#1010). Null when they supplied none, which is the state every record
    // written before this field existed is also read as.
    context: suppliedContext(context),
  });
}

/**
 * The suppression decision a payload carries, defaulted the safe way.
 *
 * A payload written before this field existed has no opinion, and the honest
 * reading of "no opinion" is the one the page has always taken for it: not
 * withheld. It is read through one function so the restore path and any test
 * of it agree on that default.
 */
export function retainedAttributionWithheld(payload) {
  return payload?.attribution?.withheld === true;
}

/** Is this a payload this version of the page may render? */
function validPayload(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && value.version === BRIEFING_RETENTION_VERSION
    && typeof value.capturedAt === "string"
    && Boolean(value.totals)
    && Array.isArray(value.departments)
    && validContext(value.context);
}

const outcome = (state, payload = null) => Object.freeze({
  state, payload, message: RETENTION_COPY[state],
  retained: state === RETENTION_STATE.retained,
});

/**
 * Read what this browser is holding.
 *
 * A payload that cannot be parsed, or that was written by a version this page
 * does not render, is REMOVED before returning — otherwise the same failure
 * repeats on every load for the rest of the browser's life, and the reader is
 * told about a briefing that is never coming back.
 */
export function readRetainedBriefing(storage) {
  let raw;
  try {
    raw = storage?.getItem(BRIEFING_RETENTION_KEY) ?? null;
  } catch {
    return outcome(RETENTION_STATE.unavailable);
  }
  if (raw === null) return outcome(RETENTION_STATE.off);

  let value = null;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  if (!validPayload(value)) {
    // Discarded rather than left in place: a corrupt or stale payload is not
    // evidence of anything a reader can act on, and clearing it is the only
    // outcome that does not fail again on the next load.
    forgetRetainedBriefing(storage);
    return outcome(RETENTION_STATE.discarded);
  }
  return outcome(RETENTION_STATE.retained, value);
}

/**
 * Write the payload. Returns the state to render rather than throwing: a quota
 * refusal is a sentence the affordance shows, not a failure of the import.
 */
export function writeRetainedBriefing(storage, payload) {
  if (!validPayload(payload)) return outcome(RETENTION_STATE.writeRefused);
  try {
    storage.setItem(BRIEFING_RETENTION_KEY, JSON.stringify(payload));
  } catch {
    return outcome(RETENTION_STATE.writeRefused);
  }
  return outcome(RETENTION_STATE.retained, payload);
}

/**
 * Remove the key. Removed, never blanked: a key set to "" or "null" is a key
 * this browser still holds, and "forget" has to mean the entry is gone.
 */
export function forgetRetainedBriefing(storage) {
  try {
    storage?.removeItem(BRIEFING_RETENTION_KEY);
  } catch {
    return outcome(RETENTION_STATE.unavailable);
  }
  return outcome(RETENTION_STATE.off);
}

/**
 * Rebuild the analysis envelope a retained payload stands for.
 *
 * This is what lets a restored briefing go through `buildFinopsBriefing` and
 * `applyBriefing` — the SAME two calls a freshly imported one goes through —
 * rather than a second renderer that would drift from it. Only the slots the
 * briefing contract reads are reconstructed; the envelope is not otherwise
 * impersonated, and nothing here invents a figure that was not retained.
 */
export function analysisFromRetained(payload) {
  if (!validPayload(payload)) return null;
  // The reader's own name for a unit. It renames, it never re-ranks: only the
  // visible word changes, so a restored brief names the team a leader knows
  // without the arithmetic depending on anything the reader typed.
  const labels = payload.context?.unitLabels ?? null;
  const departments = payload.departments.map((entry) => departmentRollup(
    labels?.[entry?.id] ? { ...entry, name: labels[entry.id] } : entry));
  const periods = (payload.totals.periods ?? []).map((entry) => Object.freeze({
    period: text(entry?.period) ?? "", spendUsd: number(entry?.spendUsd) ?? 0,
  }));
  return Object.freeze({
    period: text(payload.totals.period),
    spendUsd: number(payload.totals.analyzedSpendUsd) ?? 0,
    recoverableUsd: number(payload.totals.recoverableUsd) ?? 0,
    confidence: text(payload.confidence) ?? "Low",
    rankedDepartments: Object.freeze(departments),
    topDepartment: departments[0] ?? null,
    action: text(payload.rankedAction),
    quality: Object.freeze({
      joinedRecords: count(payload.totals.recordsAnalyzed),
      quarantinedRecords: count(payload.totals.recordsExcluded),
      // Completeness is reported from the provider this payload retained rather
      // than asserted: an unrecognized provider leaves the briefing's coverage
      // grade to say an input was missing, which is the truth about it.
      providerCompleteness: Boolean(text(payload.provider?.id)
        && payload.provider.id !== "unknown"),
    }),
    history: Object.freeze({
      state: periods.length >= 2 ? "available" : "missing",
      // One period is a figure without movement, and the sentence for it names
      // the period it has rather than the export it lacks: a reader who kept a
      // single month is not the cause of anything and is not asked to re-export.
      message: periods.length >= 2 ? ""
        : periods.length === 1
          ? `${periods[0].period} is the only period kept here, so this briefing carries `
            + "its figure and no movement."
          : "No period was kept here, so this briefing carries no movement.",
      currentPeriod: text(payload.totals.period),
      previousPeriod: text(payload.totals.previousPeriod),
      periods: Object.freeze(periods),
    }),
  });
}

/**
 * The briefing a retained payload stands for, selected through the SAME
 * contract call the live analysis goes through.
 *
 * The selection lives here rather than at the page, because the page is not
 * allowed to build a briefing of its own — it consumes the one the adapter
 * selected — and a restore has no adapter run to consume. This is that one call
 * and nothing else: no figure is decided here.
 *
 * @returns `{ analysis, briefing }`, or null when the payload cannot produce one.
 */
export function briefingFromRetained(payload) {
  const analysis = analysisFromRetained(payload);
  if (!analysis) return null;
  try {
    // The SAME option the live import passed, read back from the payload rather
    // than defaulted: a briefing restored with the suppression off is a
    // different, stronger claim than the one that was kept.
    const briefing = buildFinopsBriefing(analysis,
      { attributionWithheld: retainedAttributionWithheld(payload) });
    return briefing ? Object.freeze({ analysis, briefing }) : null;
  } catch {
    return null;
  }
}

const UNITS = Object.freeze([
  ["day", 86400000], ["hour", 3600000], ["minute", 60000],
]);

/**
 * When this briefing was captured, in words a reader can check.
 *
 * Both channels, always: the relative phrase is what answers "is this still the
 * export I meant?", and the absolute instant beside it is what survives being
 * read a week later in a screenshot.
 */
function stampLabel(instant, now, lead, unknown) {
  const at = Date.parse(String(instant ?? ""));
  if (!Number.isFinite(at)) return unknown;
  const absolute = new Date(at).toISOString().replace("T", " ").slice(0, 16);
  const elapsed = now.getTime() - at;
  if (elapsed < 60000) return `${lead} just now · ${absolute} UTC`;
  const [unit, size] = UNITS.find(([, span]) => elapsed >= span) ?? UNITS.at(-1);
  const amount = Math.floor(elapsed / size);
  return `${lead} ${amount} ${unit}${amount === 1 ? "" : "s"} ago · ${absolute} UTC`;
}

export function capturedAtLabel(capturedAt, now = new Date()) {
  return stampLabel(capturedAt, now, "Captured", "Captured at an unrecorded time");
}

/**
 * When the reader last edited what THEY supplied, said apart from the file.
 *
 * Two instants in one record answering different questions: above is when the
 * file was read, this is when a person last typed. Same formatter, so they are
 * comparable at a glance; different sentence, so neither can be read as the
 * other.
 */
export function suppliedContextLabel(context, now = new Date()) {
  if (!context?.editedAt) return "";
  return `${stampLabel(context.editedAt, now, "You last edited the names and facts you supplied yourself",
    "You supplied names and facts yourself, at an unrecorded time")}. `
    + "Every figure in this brief was derived from the file you imported.";
}
