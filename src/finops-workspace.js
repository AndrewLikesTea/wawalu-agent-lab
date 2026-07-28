// The FinOps side of this browser's local workspace: one consent, one store,
// one briefing, one next step.
//
// WHY THIS EXISTS
// ---------------
// `finops-workspace-contract.js` published what a browser would be allowed to
// remember about an AI FinOps analysis, and `workspace.html` rendered a
// synthetic sample of it. Nothing read or wrote the real thing, so a visitor
// could inspect a promise and could not act on it: there was no way to say yes,
// no way to see what saying yes produced, and no way to take it back.
//
// This module is the missing half. It owns the two FinOps keys named in the
// contract and answers, from those keys alone, the four questions the local
// workspace already answers for Shiplog records: what did I agree to, what is
// kept, how sure is that, and what is the one thing to do next.
//
// WHAT IT READS AND WHAT IT NEVER READS
// -------------------------------------
// Two keys: the FinOps workspace document and the org-unit display labels. No
// fetch, no cookie, no credential, no clock beyond the one a caller passes in.
// The figures it retains are the ones `buildFinopsBriefing` already selected —
// aggregates, ratios, and enum codes. Prompts, files, headers, rows, and source
// identifiers are refused at the door by `scanRetainedContent`, using the
// briefing contract's own patterns rather than a second copy of them.
//
// CONSENT IS A THIRD STATE, NOT A BOOLEAN
// ---------------------------------------
// `not_asked` is not `declined`. Shiplog's record retention defaults to on
// because it predates its own control (see `local-retention.js`); FinOps
// retention defaults to *nothing written at all* because it does not. A visitor
// who has never been asked is shown the choice, and until they make it the
// store is never created. That asymmetry is deliberate and is why this module
// does not reuse `RETENTION`.
//
// WHO CALLS THE WRITER
// --------------------
// `evolution-page.js` calls `retainDerivedPeriod` after its canonical briefing
// is composed. This module still owns consent, projection, refusal, and the
// write: the analysis page hands over derived state and never learns the
// persistence schema. Bundled example data is deliberately not handed over,
// because it must not become a false historical baseline for a later import.
//
// DECLINING CHANGES NOTHING ELSE
// ------------------------------
// The AI FinOps page reads files a visitor chooses and analyses them in the tab.
// Declining leaves that flow exactly as it was; it only stops the derived
// figures from outliving the tab. Nothing on this page can turn the file flow
// off, and nothing here is required for it to work.

import {
  ABSENCE_STATEMENT, BRIEFING_CONFIDENCE, CONTRACT_VERSION as BRIEFING_CONTRACT_VERSION,
  FORBIDDEN_FIELD_PATTERN, FORBIDDEN_VALUE_PATTERNS, MAX_STRING_LENGTH,
} from "./finops-briefing-contract.js";
import {
  FINOPS_COMMITMENT_ENVELOPE_FIELDS, FINOPS_LABELS_KEY, FINOPS_PERIOD_FIELDS,
  FINOPS_WORKSPACE_KEY, FINOPS_WORKSPACE_VERSION,
} from "./finops-workspace-contract.js";
import { ORG_UNIT_LABEL_STORAGE_KEY, readOrgUnitLabels } from "./org-unit-labels.js";

/** The three answers a visitor can have given. `not_asked` is not `declined`. */
export const FINOPS_CONSENT = Object.freeze({
  notAsked: "not_asked",
  granted: "granted",
  declined: "declined",
});

/** Every state this surface draws. `loading` is the view's, before a read. */
export const FINOPS_STATE = Object.freeze({
  loading: "loading",
  unavailable: "unavailable",
  unreadable: "unreadable",
  notAsked: "not_asked",
  declined: "declined",
  empty: "empty",
  retaining: "retaining",
});

/** The file this page downloads. Everything the forget action deletes is in it. */
export const FINOPS_FILE_VERSION = "finops-workspace-file/1.0.0";

/** The most months this browser keeps. Older ones fall off the front. */
export const MAX_RETAINED_PERIODS = 24;

/**
 * The browser capability for page wiring. Keeping the ambient lookup here
 * preserves the analysis page's architectural rule: it can submit a derived
 * result to the workspace without gaining direct access to browser persistence.
 */
export function browserFinopsWorkspaceStorage() {
  return globalThis.localStorage;
}

/**
 * The sentence each outcome reports, authored once so the visible notice and the
 * screen-reader announcement are the same words. Every one says what happened to
 * the stored figures, because that is the fact a visitor is checking.
 */
export const FINOPS_OUTCOME = Object.freeze({
  granted: "This browser will now remember the derived figures from analyses you run. No prompt, "
    + "file, credential, or source row is kept, and nothing is uploaded.",
  declined: "Nothing FinOps-related will be written to this browser. The AI FinOps page still "
    + "analyses the files you choose, for as long as that tab is open.",
  choice_not_saved: "That choice could not be saved in this browser, so nothing was changed.",
  exported: "Downloaded. Nothing in this browser was changed.",
  export_failed: "The download could not be written, so nothing was saved. The figures kept in "
    + "this browser were not changed.",
  forgotten: "Forgotten. This browser now holds no FinOps figures, no org-unit labels, and no "
    + "FinOps choice. Shiplog decisions and releases were left alone.",
  forget_failed: "The FinOps figures could not be removed, so they are still stored in this "
    + "browser.",
  forget_incomplete: "The browser failed partway through forgetting. Check what is listed below "
    + "before doing anything else.",
  retained: "retained",
  not_granted: "This browser has not been asked to remember FinOps figures, so nothing was "
    + "written.",
  refused_content: "That analysis was not retained: it carried a field this workspace is not "
    + "allowed to keep.",
});

const plural = (count, noun) => `${count} ${count === 1 ? noun : `${noun}s`}`;

const isoOrNull = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

const dayOf = (instant) => (instant ? instant.slice(0, 10) : null);

const usd = (minor) =>
  `${(Math.round(Number(minor)) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} USD`;

/* ----------------------------- content refusal ----------------------------- */

/**
 * Refuse anything the briefing contract forbids, before it reaches the store.
 *
 * The patterns are imported rather than restated: a store that policed a stale
 * copy of them would be a store that quietly fell behind the contract it claims
 * to implement.
 *
 * @returns `{ ok, violations }`. Never throws — a refusal is a result the page
 *   shows, not an exception the page has to survive.
 */
export function scanRetainedContent(value, path = "") {
  const violations = [];
  const walk = (node, here) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${here}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const next = here ? `${here}.${key}` : key;
        if (FORBIDDEN_FIELD_PATTERN.test(String(key).toLowerCase().replace(/[^a-z0-9]/g, ""))) {
          violations.push({ path: next, code: "forbidden_field", detail: key });
        }
        walk(child, next);
      }
      return;
    }
    if (typeof node !== "string") return;
    if (node.length > MAX_STRING_LENGTH) {
      violations.push({ path: here, code: "free_form_text", detail: `${node.length} characters` });
    }
    for (const { code, pattern } of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(node)) violations.push({ path: here, code, detail: code });
    }
  };
  walk(value, path);
  return Object.freeze({ ok: violations.length === 0, violations: Object.freeze(violations) });
}

/* -------------------------------- the store -------------------------------- */

const EMPTY_DOCUMENT = Object.freeze({
  schemaVersion: FINOPS_WORKSPACE_VERSION,
  consent: Object.freeze({ state: FINOPS_CONSENT.notAsked, decidedAt: null, grantedAgainst: null }),
  periods: Object.freeze([]),
  commitments: Object.freeze([]),
  meta: Object.freeze({ lastWriteAt: null }),
});

function readRaw(storage) {
  try {
    return { access: "ok", raw: storage?.getItem(FINOPS_WORKSPACE_KEY) ?? null };
  } catch {
    return { access: "unavailable", raw: null };
  }
}

/** Keep only the fields the contract declares, in the contract's own order. */
function pick(entry, fields) {
  const kept = {};
  for (const field of fields) {
    if (entry[field] !== undefined) kept[field] = entry[field];
  }
  return kept;
}

function readEntries(value, fields, requiredKey) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => pick(entry, fields))
    .filter((entry) => typeof entry[requiredKey] === "string" && entry[requiredKey].length > 0)
    // A store written twice for one period is one period, and the later write
    // wins: the alternative is a trend computed over the same month twice.
    .filter((entry) => (seen.has(entry[requiredKey]) ? false : seen.add(entry[requiredKey])));
}

/**
 * Read the stored document.
 *
 * @returns `{ access, document, characters }`. `access` is `ok`, `unavailable`
 *   (the browser refused the key), `absent` (nothing written yet), or
 *   `unreadable` (text that is not this contract's document). Those are four
 *   different answers, and a page that collapses them into "empty" is lying
 *   about at least two of them.
 */
export function readFinopsDocument(storage) {
  const { access, raw } = readRaw(storage);
  if (access === "unavailable") {
    return Object.freeze({ access, document: EMPTY_DOCUMENT, characters: 0 });
  }
  if (raw === null) {
    return Object.freeze({ access: "absent", document: EMPTY_DOCUMENT, characters: 0 });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Object.freeze({ access: "unreadable", document: EMPTY_DOCUMENT, characters: raw.length });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || parsed.schemaVersion !== FINOPS_WORKSPACE_VERSION) {
    return Object.freeze({ access: "unreadable", document: EMPTY_DOCUMENT, characters: raw.length });
  }

  const consent = parsed.consent && typeof parsed.consent === "object" ? parsed.consent : {};
  const state = Object.values(FINOPS_CONSENT).includes(consent.state)
    ? consent.state : FINOPS_CONSENT.notAsked;
  const periods = readEntries(parsed.periods, FINOPS_PERIOD_FIELDS, "periodId")
    .sort((left, right) => String(left.period).localeCompare(String(right.period)));
  return Object.freeze({
    access: "ok",
    characters: raw.length,
    document: Object.freeze({
      schemaVersion: FINOPS_WORKSPACE_VERSION,
      consent: Object.freeze({
        state,
        decidedAt: isoOrNull(consent.decidedAt),
        grantedAgainst: typeof consent.grantedAgainst === "string" ? consent.grantedAgainst : null,
      }),
      periods: Object.freeze(periods.map((period) => Object.freeze(period))),
      commitments: Object.freeze(
        readEntries(parsed.commitments, FINOPS_COMMITMENT_ENVELOPE_FIELDS, "commitmentId")
          .map((commitment) => Object.freeze(commitment)),
      ),
      meta: Object.freeze({ lastWriteAt: isoOrNull(parsed.meta?.lastWriteAt) }),
    }),
  });
}

function writeDocument(storage, document, { now }) {
  try {
    storage.setItem(FINOPS_WORKSPACE_KEY, JSON.stringify({
      ...document,
      meta: { lastWriteAt: now.toISOString() },
    }));
    return true;
  } catch {
    return false;
  }
}

/** The consent record alone, for callers that only need to know whether to write. */
export function readFinopsConsent(storage) {
  const { access, document } = readFinopsDocument(storage);
  return Object.freeze({
    ...document.consent,
    available: access !== "unavailable",
    chosen: document.consent.state !== FINOPS_CONSENT.notAsked,
  });
}

export function finopsRetentionGranted(storage) {
  return readFinopsConsent(storage).state === FINOPS_CONSENT.granted;
}

/**
 * Record the choice.
 *
 * Declining keeps the record — a visitor who said no has said something, and
 * asking them again on every visit is how a consent surface becomes a nag — but
 * it drops every retained figure at the same time, because keeping figures a
 * visitor just refused would make the choice cosmetic.
 */
export function setFinopsConsent(storage, state, { now = new Date() } = {}) {
  const target = state === FINOPS_CONSENT.granted ? FINOPS_CONSENT.granted : FINOPS_CONSENT.declined;
  const { access, document } = readFinopsDocument(storage);
  if (access === "unavailable") {
    return Object.freeze({
      ok: false, code: "choice_not_saved", message: FINOPS_OUTCOME.choice_not_saved,
    });
  }
  const declining = target === FINOPS_CONSENT.declined;
  const saved = writeDocument(storage, {
    schemaVersion: FINOPS_WORKSPACE_VERSION,
    consent: {
      state: target,
      decidedAt: now.toISOString(),
      grantedAgainst: declining ? null : FINOPS_WORKSPACE_VERSION,
    },
    periods: declining ? [] : document.periods,
    commitments: declining ? [] : document.commitments,
  }, { now });
  if (!saved) {
    return Object.freeze({
      ok: false, code: "choice_not_saved", message: FINOPS_OUTCOME.choice_not_saved,
    });
  }
  const code = declining ? "declined" : "granted";
  return Object.freeze({ ok: true, code, message: FINOPS_OUTCOME[code] });
}

/* ------------------------------- projection -------------------------------- */

/**
 * A short digest of the aggregates a period was derived from.
 *
 * FNV-1a over four numbers, none of which is an identifier: it lets a reader see
 * that two retentions of the same month came from the same figures, and it
 * cannot be turned back into a file, a row, or a source instance.
 */
export function sourceFingerprint(parts) {
  let hash = 0x811c9dc5;
  for (const character of parts.join("|")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** "2026-06-01 to 2026-07-01" → "2026-06". The month a reader would name it by. */
function monthOf(period) {
  const match = /^(\d{4}-\d{2})-\d{2}/.exec(String(period ?? "").trim());
  return match ? match[1] : null;
}

const minorOf = (usdValue) =>
  (Number.isFinite(Number(usdValue)) ? Math.round(Number(usdValue) * 100) : null);

/**
 * Project one analysis into the contract's period shape.
 *
 * Every figure here is copied from a briefing or an envelope that already
 * published it. Nothing is recomputed: a store that re-derived the confidence
 * grade would be a second opinion, and two grades for one month on two surfaces
 * is the bug this projection exists to prevent.
 *
 * @returns the record, or null when the analysis has no period to key it by.
 */
export function projectRetainedPeriod({ briefing, analysis, dataset = "user", now = new Date() }) {
  const month = monthOf(analysis?.period);
  if (!briefing || !analysis || !month) return null;

  const coverage = briefing.coverage ?? {};
  const ranked = Array.isArray(analysis.rankedDepartments) ? analysis.rankedDepartments : [];
  const analyzedSpendMinor = minorOf(analysis.spendUsd);
  const attributedSpendMinor = ranked.length
    ? minorOf(ranked.reduce((sum, department) => sum + (Number(department.spendUsd) || 0), 0))
    : null;
  const recoverableScenarioMinor = minorOf(analysis.recoverableUsd);
  const recordsAnalyzed = Number(coverage.recordsAnalyzed) || 0;
  const recordsTotal = Number(coverage.recordsTotal) || 0;

  return Object.freeze({
    periodId: `${dataset}:${month}`,
    period: month,
    dataset,
    briefingContractVersion: briefing.contractVersion ?? BRIEFING_CONTRACT_VERSION,
    derivedAt: now.toISOString(),
    sourceFingerprint: sourceFingerprint([
      month, String(analyzedSpendMinor), String(recordsTotal), String(recordsAnalyzed),
    ]),
    analyzedSpendMinor,
    attributedSpendMinor,
    recoverableScenarioMinor,
    recordsTotal,
    recordsAnalyzed,
    coverageRatioPpm: Math.round((Number(coverage.coverageRatio) || 0) * 1_000_000),
    confidence: coverage.confidence ?? BRIEFING_CONFIDENCE.insufficient,
    missingInputs: Object.freeze([...(coverage.missingInputs ?? [])]),
    materialMetricId: briefing.materialMetric?.candidate ?? null,
    materialMetricMinor: briefing.materialMetric ? minorOf(briefing.materialMetric.value) : null,
    absenceReason: briefing.absent?.materialMetric?.reason ?? null,
    topDepartmentId: typeof analysis.topDepartment?.id === "string" ? analysis.topDepartment.id : null,
  });
}

/**
 * Retain one projected period.
 *
 * Refuses when consent was never granted, and refuses again when the record
 * carries anything the briefing contract forbids. Both refusals are results, not
 * exceptions: the caller is a render path, and a render path that can throw on a
 * storage write is a render path that leaves a page half-drawn.
 */
export function retainFinopsPeriod(storage, period, { now = new Date() } = {}) {
  const { access, document } = readFinopsDocument(storage);
  if (access === "unavailable" || document.consent.state !== FINOPS_CONSENT.granted) {
    return Object.freeze({ ok: false, code: "not_granted", message: FINOPS_OUTCOME.not_granted });
  }
  if (!period || typeof period.periodId !== "string") {
    return Object.freeze({ ok: false, code: "not_projected", message: FINOPS_OUTCOME.not_granted });
  }
  const record = pick(period, FINOPS_PERIOD_FIELDS);
  const scan = scanRetainedContent(record, "period");
  if (!scan.ok) {
    return Object.freeze({
      ok: false, code: "refused_content", message: FINOPS_OUTCOME.refused_content,
      violations: scan.violations,
    });
  }
  const periods = [
    ...document.periods.filter((entry) => entry.periodId !== record.periodId),
    record,
  ]
    .sort((left, right) => String(left.period).localeCompare(String(right.period)))
    .slice(-MAX_RETAINED_PERIODS);

  const saved = writeDocument(storage, { ...document, periods }, { now });
  return saved
    ? Object.freeze({ ok: true, code: "retained", message: FINOPS_OUTCOME.retained })
    : Object.freeze({ ok: false, code: "not_saved", message: FINOPS_OUTCOME.choice_not_saved });
}

/** Project and retain in one call, for a render path that has both to hand. */
export function retainDerivedPeriod(storage, input, { now = new Date() } = {}) {
  const period = projectRetainedPeriod({ ...input, now });
  if (!period) {
    return Object.freeze({ ok: false, code: "not_projected", message: FINOPS_OUTCOME.not_granted });
  }
  return retainFinopsPeriod(storage, period, { now });
}

/* -------------------------------- forgetting ------------------------------- */

function clearKey(storage, key) {
  if (typeof storage.removeItem === "function") storage.removeItem(key);
  else storage.setItem(key, "");
}

const KEY_CLEARED = (storage, key) => {
  const value = storage.getItem(key);
  return value === null || value === "";
};

/**
 * Remove everything FinOps kept, then read both keys back to prove it.
 *
 * Consent returns to `not_asked` rather than to `declined`, because forgetting
 * is not an answer to the question — the next visit asks it again from a clean
 * store, which is what the erasure copy beside the contract preview has always
 * promised. Shiplog decisions and releases are not touched.
 */
export function forgetFinopsWorkspace(storage) {
  const keys = [FINOPS_WORKSPACE_KEY, ORG_UNIT_LABEL_STORAGE_KEY];
  try {
    for (const key of keys) clearKey(storage, key);
    if (!keys.every((key) => KEY_CLEARED(storage, key))) {
      return Object.freeze({
        ok: false, code: "forget_incomplete", message: FINOPS_OUTCOME.forget_incomplete,
      });
    }
  } catch {
    return Object.freeze({
      ok: false, code: "forget_failed", message: FINOPS_OUTCOME.forget_failed,
    });
  }
  return Object.freeze({ ok: true, code: "forgotten", message: FINOPS_OUTCOME.forgotten });
}

/**
 * The file this page downloads: every key the forget action deletes, in one
 * document, so "download before you forget" is a complete instruction rather
 * than an approximate one.
 */
export function finopsWorkspaceFile(storage, { now = new Date() } = {}) {
  const { document } = readFinopsDocument(storage);
  return {
    schemaVersion: FINOPS_FILE_VERSION,
    exportedAt: now.toISOString(),
    workspace: document,
    orgUnitLabels: readOrgUnitLabels(storage),
  };
}

/* --------------------------------- reading --------------------------------- */

const CONFIDENCE_LABEL = Object.freeze({
  [BRIEFING_CONFIDENCE.high]: "High",
  [BRIEFING_CONFIDENCE.moderate]: "Moderate",
  [BRIEFING_CONFIDENCE.low]: "Low",
  [BRIEFING_CONFIDENCE.insufficient]: "Insufficient",
});

const CONFIDENCE_TONE = Object.freeze({
  [BRIEFING_CONFIDENCE.high]: "verified",
  [BRIEFING_CONFIDENCE.moderate]: "partial",
  [BRIEFING_CONFIDENCE.low]: "partial",
  [BRIEFING_CONFIDENCE.insufficient]: "unknown",
});

const BENCHMARK_LABEL = Object.freeze({
  recoverable_scenario: "Recoverable AI spend in this period (routing scenario, not a realized saving)",
  spend_change: "Change in analyzed AI spend against the preceding retained period",
});

function stateChip(state) {
  switch (state) {
    case FINOPS_STATE.unavailable: return { label: "Storage unavailable", tone: "blocked" };
    case FINOPS_STATE.unreadable: return { label: "Stored text unreadable", tone: "warn" };
    case FINOPS_STATE.declined: return { label: "Not remembering", tone: "off" };
    case FINOPS_STATE.notAsked: return { label: "Not asked yet", tone: "quiet" };
    case FINOPS_STATE.empty: return { label: "Remembering · nothing kept", tone: "quiet" };
    default: return { label: "Remembering", tone: "on" };
  }
}

/**
 * The consolidated briefing, from the newest retained period.
 *
 * One benchmark, one confidence grade, one provenance trail. The figures are the
 * ones the briefing contract selected at derivation time; this function chooses
 * which period to read and writes the sentences, and computes nothing else.
 */
function deriveBriefing(periods) {
  const current = periods.at(-1) ?? null;
  const prior = periods.at(-2) ?? null;
  if (!current) return null;

  const grade = current.confidence ?? BRIEFING_CONFIDENCE.insufficient;
  const coveragePercent = Math.round((Number(current.coverageRatioPpm) || 0) / 10_000);
  const hasMetric = current.materialMetricId !== null && current.materialMetricMinor !== null;

  return Object.freeze({
    available: hasMetric,
    period: current.period,
    periodCount: periods.length,
    priorPeriod: prior?.period ?? null,
    benchmark: Object.freeze(hasMetric
      ? {
        available: true,
        figure: usd(current.materialMetricMinor),
        label: BENCHMARK_LABEL[current.materialMetricId] ?? current.materialMetricId,
        metricId: current.materialMetricId,
        statement: `Derived for ${current.period} from ${plural(current.recordsAnalyzed, "analyzed record")} `
          + `and carried here unchanged from the analysis that selected it.`,
      }
      : {
        available: false,
        figure: "No figure",
        label: "No material figure was selected for this period",
        metricId: null,
        statement: ABSENCE_STATEMENT[current.absenceReason]
          ?? "This period was retained without a material figure, so there is nothing to headline.",
      }),
    confidence: Object.freeze({
      grade,
      label: CONFIDENCE_LABEL[grade] ?? "Insufficient",
      tone: CONFIDENCE_TONE[grade] ?? "unknown",
      coveragePercent,
      detail: `${CONFIDENCE_LABEL[grade] ?? "Insufficient"}: `
        + `${coveragePercent}% of the ${plural(current.recordsTotal, "record")} this period was handed `
        + `were analyzed`
        + (current.missingInputs.length
          ? `, and ${plural(current.missingInputs.length, "required input")} was missing `
            + `(${current.missingInputs.join(", ")}).`
          : ", and every required input was present."),
    }),
    provenance: Object.freeze([
      {
        term: "Figures",
        detail: `Read from this browser's local storage under “${FINOPS_WORKSPACE_KEY}” — `
          + `${plural(periods.length, "retained period")}, newest ${current.period}.`,
      },
      {
        term: "Dataset",
        detail: current.dataset === "example"
          ? "Derived from the bundled example dataset, not from a file of yours. Import a provider "
            + "export to replace it."
          : "Derived from a provider export you opened on the AI FinOps page. The file itself was "
            + "never stored; only the aggregates above were.",
      },
      {
        term: "Derived",
        detail: `${dayOf(current.derivedAt) ?? "an unrecorded date"}, against `
          + `${current.briefingContractVersion}, from source fingerprint ${current.sourceFingerprint}. `
          + "The fingerprint is a digest of the aggregates, not of the file.",
      },
      {
        term: "Coverage",
        detail: `${current.recordsAnalyzed} of ${current.recordsTotal} records analyzed `
          + `(${coveragePercent}%). Both counts are the analysis's own.`,
      },
      {
        term: "Transfer",
        detail: "None. Reading this page sends no request, and no FinOps figure has left this "
          + "device: there is no account, sync, or server copy to leave it for.",
      },
    ].map((row) => Object.freeze(row))),
  });
}

/**
 * The one thing to do next, chosen by what a visitor stands to lose or cannot
 * yet answer. There is deliberately no backup-hygiene rung: unlike a Shiplog
 * decision, every figure here is re-derivable from the file it came from, so
 * nagging for a download would be nagging for a copy of a copy.
 */
function nextAction({ state, briefing }) {
  if (state === FINOPS_STATE.unavailable) {
    return {
      code: "recheck_storage",
      headline: "Check this browser again",
      why: "Local storage is switched off or blocked here — often a private window, or a site-data "
        + "setting. Nothing can be remembered or read until it is available. The AI FinOps page "
        + "still analyses files you open, for as long as that tab stays open.",
      label: "Check storage again",
      kind: "recheck",
    };
  }
  if (state === FINOPS_STATE.unreadable) {
    return {
      code: "forget_unreadable",
      headline: "Forget the unreadable FinOps text",
      why: "Text is stored under the FinOps key that is not a workspace document this build can "
        + "read, so nothing can be shown from it. There is no restore for derived figures — they "
        + "come back by importing the export they were derived from.",
      label: "Forget FinOps figures",
      kind: "forget",
    };
  }
  if (state === FINOPS_STATE.notAsked) {
    return {
      code: "choose",
      headline: "Choose whether this browser remembers",
      why: "Nothing FinOps-related is stored here, and nothing will be until you say so. Saying "
        + "yes keeps the derived monthly figures — spend, coverage, confidence, the one material "
        + "number — so a later import can be compared with this one. Prompts, files, and "
        + "credentials are never kept either way.",
      label: "Remember these figures in this browser",
      kind: "grant",
    };
  }
  if (state === FINOPS_STATE.declined) {
    return {
      code: "files_only",
      headline: "Carry on with files only",
      why: "You said no, and nothing FinOps-related is written here. The AI FinOps page works "
        + "exactly as before: open a provider export, read the analysis in that tab, download what "
        + "you want to keep. Closing the tab is what ends it.",
      label: "Open the AI FinOps page",
      kind: "link",
      href: "/evolution.html",
    };
  }
  if (state === FINOPS_STATE.empty) {
    return {
      code: "first_import",
      headline: "Import a provider export",
      why: "This browser is set to remember and is holding nothing. The first analysis you run on "
        + "the AI FinOps page is kept here as derived monthly figures, and appears below from the "
        + "moment it is computed.",
      label: "Open the AI FinOps page",
      kind: "link",
      href: "/evolution.html",
    };
  }
  if (!briefing.available) {
    return {
      code: "missing_input",
      headline: "Add the input this period is missing",
      why: `${briefing.benchmark.statement} Until one is present, ${briefing.period} is retained as `
        + "evidence but cannot headline a figure or size an action.",
      label: "Open the AI FinOps page",
      kind: "link",
      href: "/evolution.html",
    };
  }
  if (briefing.periodCount < 2) {
    return {
      code: "second_period",
      headline: "Retain a second month",
      why: `${briefing.period} is the only period kept here, so this browser can show a figure but `
        + "not a movement. Importing the immediately preceding month gives the benchmark above "
        + "something to be compared with.",
      label: "Open the AI FinOps page",
      kind: "link",
      href: "/evolution.html",
    };
  }
  return {
    code: "record_decision",
    headline: "Record the decision this figure sizes",
    why: `${briefing.benchmark.figure} is the material figure for ${briefing.period}, and `
      + `${briefing.priorPeriod} is retained beside it to compare against. Recording it as a `
      + "Shiplog decision is what turns a number into something with an owner and an outcome.",
    label: "Record a commitment",
    kind: "link",
    href: "/savings-commitment.html",
  };
}

/**
 * The whole FinOps workspace status, from two storage keys alone.
 *
 * @param storage this browser's `localStorage`, or a stand-in.
 * @param options.now the instant to stamp the read with. Injectable so a test
 *   pins a sentence rather than racing a clock.
 * @returns a frozen status. Total: it never throws, and every failure storage
 *   can produce arrives as a state with words attached.
 */
export function readFinopsWorkspace(storage, { now = new Date() } = {}) {
  const { access, document, characters } = readFinopsDocument(storage);
  const labels = access === "unavailable" ? {} : readOrgUnitLabels(storage);
  const labelCount = Object.keys(labels).length;

  let state;
  if (access === "unavailable") state = FINOPS_STATE.unavailable;
  else if (access === "unreadable") state = FINOPS_STATE.unreadable;
  else if (document.consent.state === FINOPS_CONSENT.notAsked) state = FINOPS_STATE.notAsked;
  else if (document.consent.state === FINOPS_CONSENT.declined) state = FINOPS_STATE.declined;
  else if (document.periods.length === 0) state = FINOPS_STATE.empty;
  else state = FINOPS_STATE.retaining;

  const briefing = state === FINOPS_STATE.retaining ? deriveBriefing(document.periods) : null;

  const summary = {
    [FINOPS_STATE.unavailable]:
      "This browser did not let the page read its local storage, so what FinOps has kept here is unknown.",
    [FINOPS_STATE.unreadable]:
      "Text is stored under the FinOps key that this build cannot read as a workspace document.",
    [FINOPS_STATE.notAsked]:
      "Nothing FinOps-related is stored in this browser, and nothing will be until you choose.",
    [FINOPS_STATE.declined]:
      "You chose not to keep FinOps figures here. Nothing is stored, and the AI FinOps page still "
      + "works from the files you open.",
    [FINOPS_STATE.empty]:
      "This browser is set to remember FinOps figures and is holding none yet.",
  }[state] ?? `${plural(document.periods.length, "period")} and `
    + `${plural(labelCount, "org-unit label")} kept in this browser, `
    + `${characters < 1024 ? "under 1 KB" : `about ${Math.round(characters / 1024)} KB`} of JSON text.`;

  // Retained records, said as rows a reader can check one at a time. Periods
  // first because the briefing above is read off one of them.
  const records = document.periods.map((period) => Object.freeze({
    kind: "period",
    id: period.periodId,
    headline: `${period.period} · ${period.dataset === "example" ? "example dataset" : "your import"}`,
    detail: `${usd(period.analyzedSpendMinor ?? 0)} analyzed · `
      + `${usd(period.recoverableScenarioMinor ?? 0)} routing scenario · `
      + `${period.recordsAnalyzed}/${period.recordsTotal} records · `
      + `${CONFIDENCE_LABEL[period.confidence] ?? "Insufficient"} confidence · `
      + `retained ${dayOf(period.derivedAt) ?? "on an unrecorded date"}`,
  }));
  for (const commitment of document.commitments) {
    records.push(Object.freeze({
      kind: "commitment",
      id: commitment.commitmentId,
      headline: `Commitment · ${commitment.commitmentId}`,
      detail: `${commitment.status ?? "recorded"} · period ${commitment.periodId ?? "unstated"}`,
    }));
  }
  if (labelCount > 0) {
    records.push(Object.freeze({
      kind: "labels",
      id: ORG_UNIT_LABEL_STORAGE_KEY,
      headline: `${plural(labelCount, "org-unit display label")}`,
      detail: `Names you typed for your own opaque org-unit identifiers, kept under `
        + `“${ORG_UNIT_LABEL_STORAGE_KEY}”. Forgetting below removes them with everything else.`,
    }));
  }

  return Object.freeze({
    state,
    checkedAt: now.toISOString(),
    consent: Object.freeze({
      ...document.consent,
      chosen: document.consent.state !== FINOPS_CONSENT.notAsked,
      decidedOn: dayOf(document.consent.decidedAt),
    }),
    chip: Object.freeze(stateChip(state)),
    summary,
    briefing,
    counts: Object.freeze({
      periods: document.periods.length,
      commitments: document.commitments.length,
      labels: labelCount,
      characters,
    }),
    records: Object.freeze(records),
    canExport: state === FINOPS_STATE.retaining || (state !== FINOPS_STATE.unavailable && labelCount > 0),
    // Forget is offered whenever there is something to forget: unreadable text,
    // a recorded choice, retained figures, or labels. Offering it over a store
    // that holds nothing would promise a change it cannot make.
    canForget: access !== "unavailable"
      && (access === "unreadable" || labelCount > 0
        || document.consent.state !== FINOPS_CONSENT.notAsked),
    nextAction: Object.freeze(nextAction({ state, briefing })),
  });
}
