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
  recordDetailHref,
  verdictMetricText,
  verdictSentence,
} from "./deployment-status.js";
import { BUILD_STAMP } from "./build-stamp.js";
import { commitLinkText, deployedReleaseRecord } from "./deployed-release.js";

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
  source: "deployment-commit",
  record: "deployment-record",
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

/**
 * Point the block's commit link at the commit this build was made from.
 *
 * WHY IT IS NOT PART OF `renderDeploymentStatus`. The commit a visitor opens to
 * check the claim is the same commit whether the check is still running, agreed,
 * disagreed, or never completed — so it is painted once, before the probe, by a
 * function no verdict calls. That is what keeps it on the page in the state the
 * reader most needs it: the one where the check could not answer. It also keeps
 * the link's words out of the verdict's live region, so a state change
 * announces the answer and not the link a second time.
 *
 * The record is the one derived from the build stamp, so this link and the
 * releases page's own commit link are one derivation with one name.
 *
 * @param record the record from `deployedReleaseRecord`, or null for an
 *   unstamped build — which names no commit, and so gets no link rather than a
 *   link to something invented.
 */
export function renderDeploymentSource(root, record) {
  const link = byId(root, DEPLOYMENT_IDS.source);
  if (!link) return null;
  const label = commitLinkText(record?.commitSha);
  if (!record?.sourceUrl || !label) {
    link.hidden = true;
    return null;
  }
  link.hidden = false;
  link.href = record.sourceUrl;
  link.setAttribute("href", record.sourceUrl);
  link.textContent = label;
  return record.sourceUrl;
}

/**
 * Keep the exact record the check compared against reachable, and name it.
 *
 * Painted before the probe and never by a verdict, for the reason the commit
 * link above is: the record the comparison was made against is the same record
 * whether the check is pending, agreed, disagreed or never completed, and the
 * state a reader most needs it in is the one where the check could not answer.
 * The match state offers no next action at all, so without this link that state
 * — the one a prospect is meant to be convinced by — would name a record id it
 * gave no way to open.
 *
 * The destination is `recordDetailHref`, the same derivation the non-matching
 * next action uses, so the two anchors cannot name different places for one
 * record. No record, or a record naming nowhere on this site: no link, rather
 * than a link to something invented.
 */
export function renderDeploymentRecordLink(root, record) {
  const link = byId(root, DEPLOYMENT_IDS.record);
  if (!link) return null;
  const href = recordDetailHref(record);
  if (!href) {
    link.hidden = true;
    return null;
  }
  link.hidden = false;
  link.href = href;
  link.setAttribute("href", href);
  link.textContent = `Open release record ${record.id}`;
  return href;
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
  const stampedRecord = deployedReleaseRecord(options.buildStamp ?? BUILD_STAMP);
  // Before the probe, so the link is on the page in the pending state too. It
  // is the stamp's record even when a caller compares against a different one:
  // the question this link answers is "which commit produced the page I am
  // reading?", and only the stamp knows that.
  renderDeploymentSource(root, stampedRecord);
  const release = options.release !== undefined ? options.release : stampedRecord;
  renderDeploymentRecordLink(root, release);
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
