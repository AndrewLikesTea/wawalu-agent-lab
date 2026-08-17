// Rendering for the deployment status band on the releases page.
//
// The comparison itself is deployment-status.js and is pure; this layer only
// turns the verdict object into DOM and owns the one side effect the band has:
// reading `/healthz`. That read is injected — `initDeploymentStatus` takes a
// `readHealth` function — so a test supplies a fixture and never opens a socket,
// and so the probe's transport can change without touching the answer.
//
// Every value that came from the health response or a release record is written
// through `textContent`. Nothing on this band is assembled as markup, so a build
// identifier containing HTML is displayed, not executed (PRODUCT.md: no
// user-generated HTML execution).
//
// The band writes nothing: no form, no submit, no storage. Its one non-matching
// action is a link to a record a person then operates.

import {
  NO_ACTION_TEXT,
  deploymentVerdict,
  verdictMetricText,
  verdictSentence,
} from "./deployment-status.js";
import { BUILD_STAMP } from "./build-stamp.js";
import { deployedReleaseRecord } from "./deployed-release.js";

export const HEALTH_URL = "/healthz";

export const DEPLOYMENT_IDS = Object.freeze({
  panel: "deployment-status",
  callout: "deployment-status-callout",
  verdict: "deployment-verdict",
  metric: "deployment-metric",
  action: "deployment-next-action",
  actionTarget: "deployment-next-action-target",
  evidence: "deployment-evidence",
  evidenceSummary: "deployment-evidence-summary",
  evidenceBody: "deployment-evidence-body",
});

// A response body, whatever the deployment answered with.
//
// The Pages Function answers JSON; the static artifact answers the plain
// sentinel `ok`. Both are recognised, and anything else — an empty body, a proxy
// error page, a JSON array — returns null, which the verdict reads as an
// unexpected shape rather than as a crash.
export function parseHealthBody(body) {
  const raw = typeof body === "string" ? body.trim() : "";
  if (raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw.length <= 64 && !raw.includes("<") ? { status: raw } : null;
  }
}

// The production reader. Aborts rather than hanging, and never returns a partial
// answer: either a parsed body or a throw the probe below turns into a reason.
export function healthEndpointReader({
  fetchImpl = globalThis.fetch,
  url = HEALTH_URL,
  timeoutMs = 5000,
} = {}) {
  return async () => {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(url, { cache: "no-store", signal: controller?.signal });
      if (!response?.ok) throw new Error("health check refused");
      return parseHealthBody(await response.text());
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

// Turn a reader into a reading. The error itself is dropped here on purpose:
// what reaches the page is one of the named reasons, never a message from a
// stack an operator did not ask for.
export async function probeHealth(readHealth, checkedAt) {
  try {
    return { health: await readHealth(), checkedAt };
  } catch (error) {
    const aborted = error?.name === "AbortError" || error?.name === "TimeoutError";
    return { failure: aborted ? "timeout" : "unreachable", checkedAt };
  }
}

function byId(root, id) {
  return root.querySelector(`#${id}`);
}

function fieldList(doc, entries) {
  const nodes = [];
  for (const [label, value] of entries) {
    const term = doc.createElement("dt");
    term.textContent = label;
    const description = doc.createElement("dd");
    description.textContent = value;
    nodes.push(term, description);
  }
  return nodes;
}

function displayValue(value) {
  if (value === null || value === undefined) return "not stated";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "not stated";
  }
}

// What the probe returned, field by field, or why there is nothing to show. A
// health response is an anonymous status document; it is still rendered as text
// only, because this page cannot vouch for what a future field contains.
function healthEntries(reading) {
  if (reading?.failure) return [["Health response", `Not received — ${reading.failure.replace("-", " ")}.`]];
  const health = reading?.health;
  if (health === null || typeof health !== "object" || Array.isArray(health)) {
    return [["Health response", `Not a status document — received ${displayValue(health)}.`]];
  }
  const entries = Object.entries(health).map(([key, value]) => [key, displayValue(value)]);
  return entries.length > 0 ? entries : [["Health response", "An empty document."]];
}

function releaseEntries(release) {
  if (!release) return [["Compared record", "The release log holds no record."]];
  return [
    ["Record id", displayValue(release.id)],
    ["Version", displayValue(release.version)],
    ["Title", displayValue(release.title)],
    ["Status", displayValue(release.status)],
    ["Owner", displayValue(release.owner)],
    ["Recorded at", displayValue(release.createdAt)],
  ];
}

/**
 * Paint one verdict. Synchronous and side-effect free apart from the DOM it is
 * handed, so a test can render a verdict object directly.
 */
export function renderDeploymentStatus(root, verdict, { reading = null, release = null } = {}) {
  const panel = byId(root, DEPLOYMENT_IDS.panel);
  if (!panel) return null;
  const doc = root.ownerDocument ?? root;
  const callout = byId(root, DEPLOYMENT_IDS.callout);
  if (callout) {
    // The red variant for a state that needs attention. It is never the only
    // signal: the sentence below says the same thing in words.
    callout.className = verdict.state === "match"
      ? "release-followup"
      : "release-followup release-followup-missing";
  }
  panel.dataset.deploymentState = verdict.state;

  const verdictLine = byId(root, DEPLOYMENT_IDS.verdict);
  if (verdictLine) verdictLine.textContent = verdictSentence(verdict);
  const metric = byId(root, DEPLOYMENT_IDS.metric);
  if (metric) metric.textContent = verdictMetricText(verdict);

  const slot = byId(root, DEPLOYMENT_IDS.action);
  if (slot) {
    slot.replaceChildren();
    if (verdict.state === "match" || !verdict.nextAction) {
      const settled = doc.createElement("p");
      settled.className = "release-followup-target";
      settled.textContent = NO_ACTION_TEXT;
      slot.append(settled);
    } else {
      const link = doc.createElement("a");
      link.className = "release-followup-action";
      link.setAttribute("data-deployment-action", verdict.state);
      link.href = verdict.nextAction.href;
      link.setAttribute("aria-describedby", DEPLOYMENT_IDS.actionTarget);
      link.textContent = verdict.nextAction.label;
      const target = doc.createElement("p");
      target.className = "release-followup-target";
      target.id = DEPLOYMENT_IDS.actionTarget;
      target.textContent = verdict.nextAction.target;
      slot.append(link, target);
    }
  }

  const body = byId(root, DEPLOYMENT_IDS.evidenceBody);
  if (body) {
    body.replaceChildren(...fieldList(doc, [
      ["Checked at", displayValue(verdict.checkedAt)],
      ...healthEntries(reading),
      ...releaseEntries(release),
    ]));
  }
  return verdict;
}

// Mirror the disclosure's own state onto the summary, the way every other
// disclosure on this site does: the details element owns open/closed and the
// keyboard handling, and this keeps `aria-expanded` telling the same story.
export function bindDeploymentEvidence(root) {
  const details = byId(root, DEPLOYMENT_IDS.evidence);
  const summary = byId(root, DEPLOYMENT_IDS.evidenceSummary);
  if (!details || !summary || details.dataset.bound === "true") return null;
  details.dataset.bound = "true";
  details.addEventListener("toggle", () => {
    const open = details.hasAttribute("open");
    summary.setAttribute("aria-expanded", open ? "true" : "false");
    details.dataset.disclosure = open ? "expanded" : "collapsed";
  });
  return details;
}

/**
 * Boot the band: take the real record of this deployment, probe health, render
 * once.
 *
 * @param options.release the record to compare against. Passing it explicitly —
 *   including as `null` — is how a caller says which record this is about; left
 *   out, the record is derived from the build stamp this artifact shipped with,
 *   which is what both pages want in production. An unstamped build has no real
 *   record, so `deployedReleaseRecord` returns null and the band says it has
 *   nothing to compare against rather than falling back to an invented one.
 * @param options.buildStamp injected stamp, so a test can drive both the
 *   stamped and the unstamped path.
 * @param options.readHealth injected reader; tests pass a fixture, production
 *   leaves it out and gets `healthEndpointReader()`.
 * @param options.now injected clock, for the same reason.
 */
export async function initDeploymentStatus(root, options = {}) {
  const panel = byId(root, DEPLOYMENT_IDS.panel);
  if (!panel) return null;
  bindDeploymentEvidence(root);
  const release = options.release !== undefined
    ? options.release
    : deployedReleaseRecord(options.buildStamp ?? BUILD_STAMP);
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  const reading = await probeHealth(options.readHealth ?? healthEndpointReader(), checkedAt);
  let verdict;
  try {
    verdict = deploymentVerdict(reading, release, checkedAt);
  } catch {
    // A verdict this page cannot compute is still a stated end state, never a
    // blank panel and never a thrown error a reader would see as a broken page.
    verdict = deploymentVerdict({ failure: "unreachable", checkedAt }, release, checkedAt);
  }
  renderDeploymentStatus(root, verdict, { reading, release });
  const documentElement = root.documentElement ?? globalThis.document?.documentElement;
  if (documentElement) documentElement.dataset.shiplogDeployment = "ready";
  return verdict;
}
