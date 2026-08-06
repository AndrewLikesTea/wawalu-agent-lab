// "Is what's deployed the release we think it is?" — read only, one verdict.
//
// The page this backs makes exactly one comparison: the build identifier the
// deployment reports at /healthz against the build identifier on the newest
// release record. It writes nothing, deploys nothing, rolls back nothing, and
// sends no request other than the one GET the probe makes. Everything below is
// pure apart from probeHealthz(), which is the only seam that touches the
// network — callers hand it a fetch, and tests hand it a fixture.
//
// THE PROBE RESPONSE IS UNTRUSTED INPUT. /healthz is not owned by this page,
// its body is not a contract this module can enforce, and it is reachable by
// anyone. So every field is validated before use, unknown fields are dropped,
// and nothing derived from it is ever written as markup — the renderer sets
// textContent, so a build identifier containing "<script>" arrives on the page
// as those nine characters and nothing else.
//
// WHAT THIS DOES NOT DO. It does not change /healthz. That probe gates
// production rollout and rollback smoke tests, and coupling it to a new field
// this page wants would put a status view in the path of a deploy. Until the
// probe reports a build identifier of its own, the honest answer here is the
// unknown verdict with the reason stated — which is a state this module renders
// deliberately rather than a gap it papers over.

export const HEALTHZ_PATH = "/healthz";

// Long enough for a cold Pages Function, short enough that a reader is not left
// watching a spinner. A timeout is an unknown answer, never an error page.
export const HEALTHZ_TIMEOUT_MS = 4000;

export const DEPLOY_STATUS_IDS = Object.freeze({
  verdict: "deploy-status-verdict",
  reason: "deploy-status-reason",
  metric: "deploy-status-metric",
  action: "deploy-status-action",
  settled: "deploy-status-settled",
  evidence: "deploy-status-evidence",
});

// The class the one prioritized next action carries, so "exactly one" is a
// count a test can take rather than a shape it has to infer.
export const ACTION_CLASS = "deploy-status-action";

const VERDICT_SENTENCES = Object.freeze({
  match: "What is deployed is the release we think it is.",
  drift: "What is deployed is not the release we think it is.",
  unknown: "Whether what is deployed is the release we think it is cannot be answered right now.",
});

// Printable ASCII, bounded. A build identifier is a tag or a commit — anything
// with a control character, a newline, or novel length in it is a shape this
// page does not recognise, and an unrecognised shape is an unknown verdict.
const BUILD_PATTERN = /^[\x20-\x7e]{1,80}$/;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,30}$/;
const MAX_FIELDS = 8;
const MAX_FIELD_LENGTH = 120;

/* ------------------------------- the probe -------------------------------- */

const failedProbe = (status, reason) => ({ status, build: null, fields: [], reason });

/**
 * One GET at `path`, with an explicit deadline, validated before it is believed.
 *
 * `fetchImpl` is the seam: production passes globalThis.fetch, tests pass a
 * fixture and no request leaves the process. The result is a record, never a
 * thrown error — a status view that can throw is a status view that can render
 * a blank panel.
 */
export async function probeHealthz(fetchImpl, { path = HEALTHZ_PATH, timeoutMs = HEALTHZ_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== "function") {
    return failedProbe("unreachable", "This browser could not run the check.");
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller?.abort(); }, timeoutMs);

  let response;
  try {
    // No credentials, no body, no cache: a read, and one a rollback never has
    // to clean up after.
    response = await fetchImpl(path, { method: "GET", cache: "no-store", signal: controller?.signal });
  } catch {
    // The caught value is never shown. A reader gets a sentence; the exception
    // stays where it belongs.
    return expired
      ? failedProbe("timeout", `The health check did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)
      : failedProbe("unreachable", "The health check could not be reached.");
  } finally {
    clearTimeout(timer);
  }

  if (!response || typeof response !== "object") {
    return failedProbe("unreadable", "The health check answered with something this page cannot read.");
  }
  if (response.ok === false) {
    const code = Number.isInteger(response.status) ? response.status : null;
    return failedProbe("unreachable", `The health check answered ${code ?? "with an error"} instead of reporting its build.`);
  }

  let body;
  try {
    body = typeof response.json === "function" ? await response.json() : null;
  } catch {
    return failedProbe("unreadable", "The health check did not answer with JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return failedProbe("unreadable", "The health check did not answer with JSON.");
  }

  const fields = readFields(body);
  const build = readBuild(body);
  if (build === null) {
    return { status: "unreadable", build: null, fields, reason: "The health check reported no usable build identifier." };
  }
  return { status: "reported", build, fields, reason: null };
}

/** The one field this page compares. Anything else is evidence, not an answer. */
function readBuild(body) {
  if (typeof body.build !== "string") return null;
  const build = body.build.trim();
  return BUILD_PATTERN.test(build) ? build : null;
}

/**
 * The response's own fields, narrowed to what can be shown as text: a bounded
 * number of primitive values under plausible names, each truncated. Objects,
 * arrays and anything else the probe grows later are dropped rather than
 * stringified into the panel.
 */
function readFields(body) {
  const fields = [];
  for (const [name, value] of Object.entries(body)) {
    if (fields.length >= MAX_FIELDS) break;
    if (!FIELD_NAME.test(name)) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    fields.push({ name, value: String(value).slice(0, MAX_FIELD_LENGTH) });
  }
  return fields;
}

/* ----------------------------- the comparison ----------------------------- */

const parseTime = (value) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** A coarse, honest duration. Never rounded up into a claim it cannot support. */
export function describeDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
}

/** The newest release record that carries both a build identifier and a date. */
export function newestRelease(releases) {
  return (Array.isArray(releases) ? releases : [])
    .filter((record) => record && typeof record.version === "string" && record.version.trim() !== ""
      && parseTime(record.createdAt) !== null)
    .sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt))[0] ?? null;
}

/**
 * The whole answer, as data: one verdict, one metric, at most one action, and
 * the evidence behind them. No DOM, no clock, no network — `checkedAt` is
 * passed in so the page and its tests read the same moment.
 *
 * `previous` is the seam for an earlier observation of this same comparison:
 * `{ verdict, build, observedAt }`. This page records nothing, so production
 * passes none and the metric says so instead of inventing a duration.
 */
export function compareDeployment({ probe, releases = [], checkedAt = new Date().toISOString(), previous = null } = {}) {
  const now = parseTime(checkedAt) ?? Date.now();
  const record = newestRelease(releases);
  const reported = probe?.status === "reported" && typeof probe.build === "string" ? probe.build : null;

  let verdict = "unknown";
  if (reported !== null && record) verdict = reported === record.version.trim() ? "match" : "drift";

  const model = {
    verdict,
    sentence: VERDICT_SENTENCES[verdict],
    reason: verdict === "unknown" ? unknownReason(probe, record) : null,
    metric: metricFor({ verdict, reported, record, now, previous }),
    action: verdict === "match" ? null : actionFor(record),
    settled: verdict === "match" ? "No action is needed." : null,
    evidence: {
      checkedAt: String(checkedAt),
      healthz: probe?.fields ?? [],
      record: record ? recordFields(record) : [],
    },
  };
  return model;
}

function unknownReason(probe, record) {
  if (probe?.reason) return probe.reason;
  if (!record) return "No release record has been recorded yet, so there is nothing to compare against.";
  return "The deployed build could not be read.";
}

function metricFor({ verdict, reported, record, now, previous }) {
  const recorded = record ? describeDuration(now - parseTime(record.createdAt)) : null;
  const named = record ? `the newest release record ${record.version.trim()}` : "any release record";
  const age = recorded ? `, recorded ${recorded} ago` : "";
  const held = heldSentence({ verdict, now, previous });

  if (verdict === "match") return `Deployed build ${reported} matches ${named}${age}. ${held}`;
  if (verdict === "drift") return `Deployed build ${reported} does not match ${named}${age}. ${held}`;
  // Unknown has two causes, and the metric has to name the one that happened:
  // the deployed build could not be read, or there is no record to read it
  // against. Saying the first when the second is true is a false report.
  if (reported !== null) return `Deployed build ${reported} has no release record to compare with. ${held}`;
  return `The deployed build could not be read, so it cannot be compared with ${named}${age}. ${held}`;
}

// What is known about how long this has held — and, when nothing is known, that
// sentence rather than a number.
function heldSentence({ verdict, now, previous }) {
  const observed = parseTime(previous?.observedAt);
  const since = observed === null ? null : describeDuration(now - observed);
  if (!since) return "No earlier check is recorded here, so how long this has held is not known.";
  if (previous.verdict === verdict) return `This has held since the last recorded check, ${since} ago.`;
  return `The last recorded check, ${since} ago, found deployed build ${previous.build}.`;
}

// One action, tied to one record, and it is a link to that record — not a
// control that does anything to the deployment.
function actionFor(record) {
  if (!record) {
    return { label: "Record the release that is deployed", href: "/releases.html" };
  }
  return {
    label: `Reconcile release record ${record.version.trim()}`,
    href: `/release.html?id=${encodeURIComponent(record.id ?? "")}`,
  };
}

function recordFields(record) {
  return [
    ["id", record.id],
    ["version", record.version],
    ["title", record.title],
    ["owner", record.owner],
    ["status", record.status],
    ["createdAt", record.createdAt],
  ]
    .filter(([, value]) => typeof value === "string" && value !== "")
    .map(([name, value]) => ({ name, value: value.slice(0, MAX_FIELD_LENGTH) }));
}

/* ------------------------------ the rendering ----------------------------- */

const text = (document, tag, value, attributes = {}) => {
  const node = document.createElement(tag);
  node.textContent = value;
  for (const [name, attribute] of Object.entries(attributes)) node.setAttribute(name, attribute);
  return node;
};

function fieldList(document, entries, className, empty) {
  const list = document.createElement("ul");
  list.className = className;
  if (entries.length === 0) {
    list.append(text(document, "li", empty));
    return list;
  }
  // textContent for the value too: the field names are this page's, the values
  // are the probe's, and neither is ever parsed as markup.
  for (const { name, value } of entries) list.append(text(document, "li", `${name}: ${value}`));
  return list;
}

/**
 * The verdict, the metric, the action, then the evidence — in that order, and
 * with the first three OUTSIDE the disclosure. A reader who never opens the
 * details still has the whole answer.
 */
export function renderDeployStatus(container, model) {
  if (!container) return;
  const { ownerDocument: document } = container;
  const nodes = [];

  nodes.push(text(document, "p", model.sentence, { id: DEPLOY_STATUS_IDS.verdict, class: "filter-summary" }));
  if (model.reason) nodes.push(text(document, "p", model.reason, { id: DEPLOY_STATUS_IDS.reason, class: "hint" }));
  nodes.push(text(document, "p", model.metric, { id: DEPLOY_STATUS_IDS.metric, class: "detail-summary" }));

  if (model.action) {
    const paragraph = document.createElement("p");
    paragraph.append(text(document, "a", model.action.label, {
      id: DEPLOY_STATUS_IDS.action,
      class: `detail-back ${ACTION_CLASS}`,
      href: model.action.href,
    }));
    nodes.push(paragraph);
  } else {
    nodes.push(text(document, "p", model.settled, { id: DEPLOY_STATUS_IDS.settled, class: "hint" }));
  }

  const details = document.createElement("details");
  details.setAttribute("id", DEPLOY_STATUS_IDS.evidence);
  details.append(text(document, "summary", "Evidence behind this verdict"));
  details.append(text(document, "h2", "What /healthz answered", { class: "detail-summary" }));
  details.append(fieldList(document, model.evidence.healthz, "deploy-status-healthz-fields",
    "No fields could be read from the health check."));
  details.append(text(document, "h2", "The release record compared", { class: "detail-summary" }));
  details.append(fieldList(document, model.evidence.record, "deploy-status-record-fields",
    "No release record was available to compare."));
  details.append(text(document, "p", `Checked at ${model.evidence.checkedAt}`, { class: "deploy-status-checked" }));
  nodes.push(details);

  container.replaceChildren(...nodes);
  container.setAttribute("aria-busy", "false");
}
