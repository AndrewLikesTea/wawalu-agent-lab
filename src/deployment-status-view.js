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
// The band writes nothing: no form, no submit, no storage. A mismatch's one
// action is a link to a record a person then operates; a check that did not
// complete offers the page's own Retry, where the page carries one.

import {
  CHECKING_LINE,
  NO_ACTION_TEXT,
  deploymentResultSnapshot,
  deploymentVerdict,
  verdictCopyText,
  verdictMetricText,
} from "./deployment-status.js";
import { BUILD_STAMP } from "./build-stamp.js";
import { commitLinkText, deployedReleaseRecord } from "./deployed-release.js";
import { copyRecordUrl } from "./share-link.js";

export const HEALTH_URL = "/healthz";

export const DEPLOYMENT_IDS = Object.freeze({
  panel: "deployment-status",
  callout: "deployment-status-callout",
  verdict: "deployment-verdict",
  verdictLabel: "deployment-verdict-label",
  retry: "deployment-retry",
  identifiers: "deployment-identifiers",
  checkedAt: "deployment-checked-at",
  metric: "deployment-metric",
  copy: "deployment-copy",
  copyStatus: "deployment-copy-status",
  copyAvailability: "deployment-copy-availability",
  action: "deployment-next-action",
  actionTarget: "deployment-next-action-target",
  evidence: "deployment-evidence",
  evidenceSummary: "deployment-evidence-summary",
  evidenceBody: "deployment-evidence-body",
  source: "deployment-commit",
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

// What the copy control's availability means, said in words next to it. A
// disabled control explains nothing on its own, and a control that has been
// withdrawn explains even less, so a surface that carries the availability slot
// gets a sentence for each state the control is not usable in.
export const COPY_PENDING_LINE = "The copy control becomes available once the check answers.";
export const COPY_NO_VERDICT_LINE = "The check did not answer, so there is no verdict to copy yet.";

/**
 * The address of the page a verdict is being copied from.
 *
 * Read off the live location rather than written down, because the same control
 * is mounted on more than one page and a hard-coded path would have every paste
 * name whichever page was authored first. Origin and path only: the query
 * string and fragment a reader happens to be on are not part of where the check
 * ran, and this site's other copy controls leave them out for the same reason
 * (src/share-link.js). A location this cannot read returns null, which
 * `verdictCopyText` renders as no address rather than as a guessed one.
 */
export function pageAddress(location = globalThis.window?.location) {
  const origin = typeof location?.origin === "string" ? location.origin.trim() : "";
  if (!origin) return null;
  const path = typeof location?.pathname === "string" && location.pathname.trim() ? location.pathname.trim() : "/";
  try {
    return new URL(path, origin).href;
  } catch {
    return null;
  }
}

// The verdict at a glance: a shape and a word per state, so the chip's colour is
// never the only thing that tells one state from another.
export const VERDICT_LABELS = Object.freeze({
  loading: Object.freeze({ shape: "◌", label: "Checking…" }),
  match: Object.freeze({ shape: "✓", label: "Confirmed" }),
  drift: Object.freeze({ shape: "≠", label: "Not a match" }),
  unknown: Object.freeze({ shape: "!", label: "Did not complete" }),
});

function byId(root, id) {
  return root.querySelector(`#${id}`);
}

function renderVerdictLabel(root, state) {
  const chip = byId(root, DEPLOYMENT_IDS.verdictLabel);
  const entry = VERDICT_LABELS[state];
  if (!chip || !entry) return;
  const doc = root.ownerDocument ?? root;
  const shape = doc.createElement("span");
  shape.setAttribute("aria-hidden", "true");
  shape.textContent = entry.shape;
  const label = doc.createElement("span");
  label.textContent = entry.label;
  chip.dataset.verdict = state;
  chip.replaceChildren(shape, " ", label);
}

// The action slot keeps the page's own Retry, if it carries one, across every
// render; everything else in the slot belongs to the verdict being painted.
function clearActionSlot(root) {
  const slot = byId(root, DEPLOYMENT_IDS.action);
  if (!slot) return { slot: null, retry: null };
  const retry = byId(root, DEPLOYMENT_IDS.retry);
  slot.replaceChildren(...(retry ? [retry] : []));
  return { slot, retry };
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
export function renderDeploymentStatus(
  root,
  verdict,
  { reading = null, release = null, location = globalThis.window?.location } = {},
) {
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
  panel.dataset.checkState = verdict.state === "unknown" ? "failure" : "success";
  const snapshot = deploymentResultSnapshot(verdict);
  const checkedAtLine = byId(root, DEPLOYMENT_IDS.checkedAt);
  if (checkedAtLine) {
    checkedAtLine.replaceChildren();
    checkedAtLine.hidden = !snapshot.checkedAt;
    if (snapshot.checkedAt) {
      const time = doc.createElement("time");
      time.setAttribute("datetime", snapshot.checkedAt);
      time.textContent = snapshot.checkTime;
      checkedAtLine.append(time);
    }
  }

  const verdictLine = byId(root, DEPLOYMENT_IDS.verdict);
  if (verdictLine) verdictLine.textContent = snapshot.verdict;
  renderVerdictLabel(root, verdict.state);
  const identifiers = byId(root, DEPLOYMENT_IDS.identifiers);
  // A labeled pair where the page carries one, recorded first because it is the
  // reference; the copied sentence (`snapshot.versions`) uses the same fallbacks.
  if (identifiers?.tagName === "DL") {
    identifiers.replaceChildren(...fieldList(doc, [
      ["Recorded build", verdict.recordedBuild ?? "not available"],
      ["Running build", verdict.deployedBuild ?? "not reported"],
    ]));
  } else if (identifiers) identifiers.textContent = snapshot.versions;
  const metric = byId(root, DEPLOYMENT_IDS.metric);
  if (metric) metric.textContent = verdictMetricText(verdict);
  const copy = byId(root, DEPLOYMENT_IDS.copy);
  // A comparison that came out one way or the other is a verdict somebody can
  // paste into an incident note. "The check did not complete" is not one: it is
  // the absence of the thing the control offers to copy.
  const hasVerdict = verdict.state === "match" || verdict.state === "drift";
  // Only a surface that carries the availability line takes the second half of
  // this rule — withdrawing the control when there is no verdict — because that
  // is the half a reader cannot understand without a sentence explaining it.
  // The releases page carries no such line and keeps its long-standing
  // behaviour: it offers the copy in every settled state, including the one
  // that failed, because the band's own rule there is that a proof a reader
  // takes away must say what it failed to establish.
  const availability = byId(root, DEPLOYMENT_IDS.copyAvailability);
  if (copy) {
    const offered = hasVerdict || !availability;
    // Empty rather than stale when nothing is offered: a hidden control whose
    // payload still reads as a verdict is one focus bug away from copying it.
    copy.dataset.copyText = offered ? verdictCopyText(verdict, pageAddress(location), snapshot) : "";
    // The control ships disabled and is enabled by the render that gives it
    // something to say. Before a verdict exists there is no result to copy, and
    // a click on nothing would report a clipboard failure that never happened.
    copy.disabled = !offered;
    copy.hidden = !offered;
  }
  if (availability) availability.textContent = hasVerdict ? "" : COPY_NO_VERDICT_LINE;

  const { slot, retry } = clearActionSlot(root);
  // A check that did not complete, on a page that carries its own Retry, offers
  // that Retry as its one corrective action rather than a second, competing link.
  if (slot && !(verdict.state === "unknown" && retry)) {
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
      ...(snapshot.checkedAt ? [["Checked at", snapshot.checkedAt]] : []),
      ...healthEntries(reading),
      ...releaseEntries(release),
    ]));
  }
  return verdict;
}

/** Bind the one non-mutating control in the band exactly once. */
export function bindDeploymentCopy(root, clipboard = globalThis.navigator?.clipboard) {
  const button = byId(root, DEPLOYMENT_IDS.copy);
  const status = byId(root, DEPLOYMENT_IDS.copyStatus);
  if (!button || !status || button.dataset.copyBound === "true") return null;
  button.dataset.copyBound = "true";
  button.addEventListener("click", async () => {
    const payload = button.dataset.copyText;
    if (!payload || button.disabled) return;
    button.disabled = true;
    status.textContent = "";
    const copied = await copyRecordUrl(clipboard, payload);
    if (button.dataset.copyText !== payload) return;
    status.textContent = copied
      ? "Deployment check verdict and both version values copied to clipboard."
      : "Clipboard unavailable. Select the verdict and both version values above to copy them.";
    button.disabled = false;
  });
  return button;
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

const activeChecks = new WeakMap();

/**
 * Boot or recheck the band: clear prior evidence, probe health, then render.
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
  const request = {};
  activeChecks.set(panel, request);
  panel.dataset.checkState = "loading";
  panel.dataset.deploymentState = "loading";
  const documentElement = root.documentElement ?? globalThis.document?.documentElement;
  if (documentElement) documentElement.dataset.shiplogDeployment = "loading";
  for (const id of [DEPLOYMENT_IDS.checkedAt, DEPLOYMENT_IDS.identifiers,
    DEPLOYMENT_IDS.metric, DEPLOYMENT_IDS.copyStatus, DEPLOYMENT_IDS.evidenceBody]) {
    byId(root, id)?.replaceChildren();
  }
  clearActionSlot(root);
  renderVerdictLabel(root, "loading");
  const timeLine = byId(root, DEPLOYMENT_IDS.checkedAt);
  if (timeLine) timeLine.hidden = true;
  const verdictLine = byId(root, DEPLOYMENT_IDS.verdict);
  if (verdictLine) verdictLine.textContent = CHECKING_LINE;
  const copy = byId(root, DEPLOYMENT_IDS.copy);
  if (copy) {
    copy.disabled = true;
    copy.hidden = false;
    copy.dataset.copyText = "";
  }
  const availability = byId(root, DEPLOYMENT_IDS.copyAvailability);
  if (availability) availability.textContent = COPY_PENDING_LINE;
  bindDeploymentEvidence(root);
  bindDeploymentCopy(root, options.clipboard);
  const stampedRecord = deployedReleaseRecord(options.buildStamp ?? BUILD_STAMP);
  // Before the probe, so the link is on the page in the pending state too. It
  // is the stamp's record even when a caller compares against a different one:
  // the question this link answers is "which commit produced the page I am
  // reading?", and only the stamp knows that.
  renderDeploymentSource(root, stampedRecord);
  const release = options.release !== undefined ? options.release : stampedRecord;
  const reading = await probeHealth(options.readHealth ?? healthEndpointReader());
  if (activeChecks.get(panel) !== request) return null;
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  reading.checkedAt = checkedAt;
  let verdict;
  try {
    verdict = deploymentVerdict(reading, release, checkedAt);
  } catch {
    // A verdict this page cannot compute is still a stated end state, never a
    // blank panel and never a thrown error a reader would see as a broken page.
    verdict = deploymentVerdict({ failure: "unreachable", checkedAt }, release, checkedAt);
  }
  renderDeploymentStatus(root, verdict, { reading, release });
  if (documentElement) documentElement.dataset.shiplogDeployment = "ready";
  return verdict;
}
