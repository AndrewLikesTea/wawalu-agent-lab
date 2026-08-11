// The executive briefing: one printable document, rebuilt in the reader's own
// tab from the figures that are already in their browser.
//
// SOURCE ORDER
// ------------
// The reader's own retained FinOps periods come first. They are read from this
// browser's local workspace — the same aggregates the AI FinOps page already
// keeps there, with the reader's own consent — and the briefing is built from
// them by the shipped contract. Nothing is uploaded, fetched, or sent to derive
// them: the whole computation happens between `localStorage` and this tab.
//
// When this browser holds nothing to brief on — retention was never chosen, was
// declined, is on but empty, or the store cannot be read — the page says so in
// words, in its own labelled state, and *immediately* draws the published
// synthetic sample beneath it so the artifact can be read and printed in full on
// the first screen. The sample is labelled as a sample in the notice, in the
// masthead, beside the figure, and on paper.
//
// NOTHING IS FETCHED ON EITHER OF THOSE PATHS
// -------------------------------------------
// The sample's three periods are carried in the bundle by
// `executive-briefing-sample.js` and rebuilt through the shipped contract in the
// same synchronous pass as the workspace path. That is a deliberate change from
// fetching the published fixture: an empty workspace is the common first visit,
// and it used to pay for a network round-trip before the reader saw a figure —
// and got an error state with no artifact at all when the request failed. Parity
// with the published fixture is enforced by the test suite and by
// `scripts/verify-build.mjs` instead, where a drift fails the build rather than
// stalling a reader's page.
//
// The one exception is `?payload=bundled`, the hand-off from the live AI FinOps
// workspace's briefing-readiness region. That sheet is projected from a block
// that exists only in /evolution-demo-data.json, so it reads that document — and
// paints its own labelled "reading" state while it does, rather than borrowing
// the markup's panel, which promises the opposite. See `paintPayloadBriefing`
// for why a bundled second copy of the block was the worse trade.
//
// This entry writes nothing on any path: no credential, no request carrying a
// figure, and never a write back to the store it read. That is the same boundary
// the briefing's own safety statement makes, which is why this entry can
// honestly render it.
//
// It does now READ one thing more: `#brief=<token>`, the shared briefing a
// colleague copied out of the AI FinOps answer region. Reading it is still a
// read — the fragment reaches no server, the store is not consulted on that path
// at all, and nothing about the reader's own retained periods changes. A token
// this build cannot decode is drawn as a named refusal above whatever the page
// falls back to, never swallowed into a synthetic sample the reader would take
// for their colleague's numbers.

import {
  buildExecutiveBriefing, validateExecutiveBriefing,
} from "/executive-finops-briefing.js";
import { browserFinopsWorkspaceStorage } from "/finops-workspace.js";
import {
  BRIEFING_SOURCE, FILE_ORIGIN, FILE_PROVENANCE_NOTE, SAMPLE_ORIGIN, chooseBriefingSource,
} from "/executive-briefing-source.js";
// A brief as a file, both ways (#1207). Same envelope the link carries, defined
// once in `finops-brief-envelope.js` and consumed by both transports.
import {
  BRIEF_FILE_MEDIA_TYPE, buildBriefEnvelope, serializeBriefEnvelope,
} from "/finops-brief-envelope.js";
import { bindOpenSharedBrief } from "/finops-open-shared-brief.js";
import {
  SAMPLE_DISCLOSURE, SAMPLE_LABEL, SAMPLE_PROVENANCE_NOTE, sampleRetainedPeriods,
} from "/executive-briefing-sample.js";
import { initFinopsContact } from "/finops-contact.js";
import {
  EXAMPLE_BRIEFING_NOTICE, EXAMPLE_BRIEFING_ORIGIN, EXAMPLE_BRIEFING_PROVENANCE_NOTE,
  EXAMPLE_BRIEFING_SYNTHETIC, exampleBriefingPeriods, readExampleContext,
} from "/finops-example-briefing.js";
import {
  renderBriefingError,
  renderExampleContextNotice,
  renderExecutiveBriefingPreview,
  renderPrintControl,
  renderSourceNotice,
  wireDisclosures,
  wirePrintControl,
  wirePrintExpansion,
} from "/executive-briefing-view.js";
import { projectExecutiveBriefing } from "/executive-briefing-projection.js";
import { renderPayloadBriefing, renderPayloadState } from "/executive-payload-briefing-view.js";
import { readExecutivePayloadFragment } from "/executive-payload-share.js";

const root = document.getElementById("executive-briefing");
const actions = document.getElementById("briefing-actions");
const download = document.getElementById("open-shared-brief-download");

const PAYLOAD_URL = "/evolution-demo-data.json";
const PAYLOAD_PRINT_NOTE =
  "The decision summary prints without controls: the leadership question, the answer, the benchmark, "
  + "the action, and the provenance stay, and department evidence and methodology come off. "
  + "Nothing is uploaded and nothing is sent.";

function paint(...nodes) {
  // `loadExecutiveBriefingPreview` is public and may be retried in the same
  // document. Never leave a print control pointing at a briefing that an error
  // state has just replaced.
  actions?.replaceChildren();
  root.replaceChildren(...nodes.filter(Boolean));
  root.setAttribute("aria-busy", "false");
}

/**
 * Hand the finished document its behaviour: the two disclosures, the browser's
 * own print command, and this page's print control. The control is drawn only
 * beside a briefing — a print button over an error state offers a sheet with no
 * figure on it.
 */
function activate(article) {
  wireDisclosures(article, document);
  wirePrintExpansion(globalThis.window ?? globalThis, article, document);
  if (!actions) return;
  const control = renderPrintControl();
  actions.replaceChildren(control);
  wirePrintControl(control, article, { scope: globalThis.window ?? globalThis, doc: document });
}

/**
 * Draw the briefing this browser's own retained periods produce.
 *
 * A contract violation here is withheld rather than painted, exactly as it is on
 * the sample path: a briefing that fails the contract it declares cannot be
 * quoted, and the reader is told their figures are untouched.
 */
/**
 * The panel a link this build could not read is drawn as.
 *
 * It is drawn ABOVE whatever the page falls back to, never instead of it, and it
 * names the refusal. A shared link that quietly resolved to the synthetic sample
 * would put an invented company's figures under a reader's belief that they are
 * their colleague's — the one outcome the whole fragment path exists to prevent.
 */
function sharedFailureNode(sharedFailure) {
  if (!sharedFailure) return null;
  return renderBriefingError({
    summary: sharedFailure.summary,
    detail: sharedFailure.statement,
    remedy: sharedFailure.remedy,
  });
}

/**
 * Put the brief now on screen behind the download link, as a file.
 *
 * The href is a `data:` URL and the scheme is the literal above, never anything
 * a file or a fragment supplied: the bytes come from `serializeBriefEnvelope`
 * over an envelope this build just constructed from periods that already passed
 * the retained-record contract. Nothing here is fetched and nothing is sent —
 * the browser saves what this tab already holds.
 *
 * The clock lives here rather than in the envelope module, which reads none: a
 * `producedAt` stamped inside the builder would make two encodes of the same
 * analysis differ and break the link's own parity check.
 *
 * The link is hidden whenever there is no brief to put behind it. A download
 * control over an absent brief hands a reader an empty file with a confident
 * name on it.
 */
function offerBriefDownload(periods) {
  if (!download) return null;
  const built = buildBriefEnvelope(periods, { producedAt: new Date().toISOString() });
  if (!built.ok) {
    download.hidden = true;
    download.removeAttribute("href");
    return null;
  }
  const text = serializeBriefEnvelope(built.envelope, { pretty: true });
  download.href = `data:${BRIEF_FILE_MEDIA_TYPE};charset=utf-8,${encodeURIComponent(text)}`;
  download.hidden = false;
  return built.envelope;
}

/**
 * Draw the periods a colleague put in the link this reader opened.
 *
 * Read-only and network-free: the periods came off the address bar, the store
 * was never consulted on this path, and nothing is written back to it. The
 * masthead says whose figures these are and that nothing here proves who sent
 * them, because a token is evidence of what somebody chose to paste and not of
 * who pasted it.
 */
function paintSharedBriefing({ periods, origin, provenanceNote }) {
  let briefing;
  let verdict;
  try {
    briefing = buildExecutiveBriefing(periods);
    verdict = validateExecutiveBriefing(briefing);
  } catch {
    briefing = null;
    verdict = null;
  }
  if (!verdict?.valid) {
    const first = verdict?.violations?.[0];
    paint(renderBriefingError({
      summary: "The shared briefing failed its contract",
      detail: first
        ? `The briefing built from the ${periods.length} period(s) in this link broke `
          + `${verdict.violations.length} rule(s); the first is ${first.code} at `
          + `“${first.path || "the briefing itself"}”.`
        : `The ${periods.length} period(s) in this link could not be built into a briefing in this tab.`,
      remedy: "No shared figure is shown, because a briefing that fails the contract it declares "
        + "cannot be quoted. Nothing of yours was read, nothing was stored, and your own retained "
        + "figures were not changed. Ask the sender to copy a fresh link.",
    }));
    return null;
  }
  const article = renderExecutiveBriefingPreview(briefing, { origin, provenanceNote, followUp: true });
  paint(article);
  activate(article);
  offerBriefDownload(periods);
  return article;
}

function paintWorkspaceBriefing({ periods, origin, provenanceNote, sharedFailure = null }) {
  let briefing;
  let verdict;
  try {
    briefing = buildExecutiveBriefing(periods);
    verdict = validateExecutiveBriefing(briefing);
  } catch {
    briefing = null;
    verdict = null;
  }
  if (!verdict?.valid) {
    const first = verdict?.violations?.[0];
    const failure = renderBriefingError({
      summary: "This browser's own briefing failed its contract",
      detail: first
        ? `The briefing built from the ${periods.length} period(s) retained here broke `
          + `${verdict.violations.length} rule(s); the first is ${first.code} at `
          + `“${first.path || "the briefing itself"}”.`
        : `The ${periods.length} retained period(s) could not be built into a briefing in this tab.`,
      remedy: "Your retained figure is withheld because it cannot be quoted safely. Your retained "
        + "figures were not changed and nothing was uploaded. The explicitly labelled synthetic "
        + "sample remains below so the decision hierarchy is still readable.",
      onRetry: loadExecutiveBriefingPreview,
    });
    return paintSampleBriefing({
      origin: SAMPLE_ORIGIN,
      leadingNodes: [sharedFailureNode(sharedFailure), failure].filter(Boolean),
    });
  }
  const article = renderExecutiveBriefingPreview(briefing, { origin, provenanceNote, followUp: true });
  paint(sharedFailureNode(sharedFailure), article);
  activate(article);
  offerBriefDownload(periods);
  return article;
}

/**
 * Draw the published synthetic sample, immediately.
 *
 * Synchronous on purpose: the periods are already in this bundle, so a reader
 * with nothing retained here sees a complete briefing — decision, figure,
 * action, verdict, bounds, and both levels — on the first screen rather than a
 * "building…" panel that may never resolve.
 */
function paintSampleBriefing({ absence, origin, leadingNodes = [], sharedFailure = null }) {
  const shared = sharedFailureNode(sharedFailure);
  const leading = shared ? [shared, ...leadingNodes] : leadingNodes;
  let briefing;
  let verdict;
  try {
    briefing = buildExecutiveBriefing(sampleRetainedPeriods());
    verdict = validateExecutiveBriefing(briefing);
  } catch {
    briefing = null;
    verdict = null;
  }
  if (!verdict?.valid) {
    const first = verdict?.violations?.[0];
    paint(renderBriefingError({
      summary: "The published sample failed its own contract",
      detail: first
        ? `${verdict.violations.length} violation(s); the first is ${first.code} at `
          + `“${first.path || "the briefing itself"}”.`
        : "The bundled sample could not be built into a briefing in this tab.",
      remedy: "No figure is shown, because a briefing that fails the contract it declares cannot be "
        + "quoted. The contract and the sample it ships with have to agree before this page draws either.",
      onRetry: loadExecutiveBriefingPreview,
    }));
    return null;
  }

  const preview = renderExecutiveBriefingPreview(briefing, {
    origin,
    provenanceNote: SAMPLE_PROVENANCE_NOTE,
    synthetic: { label: SAMPLE_LABEL, disclosure: SAMPLE_DISCLOSURE },
    followUp: true,
  });
  paint(...leading, renderSourceNotice(absence), preview);
  activate(preview);
  return preview;
}

/**
 * Draw the bundled AI FinOps example, because the reader arrived from it.
 *
 * PINNED, NOT PREFERRED. This path runs *before* the workspace is consulted and
 * the store is never read on it. A reader who followed "open the executive
 * briefing for this example" asked for the example: briefing on their own
 * retained months instead would answer a question they did not ask, under a
 * heading that looks identical. The notice says the omission out loud, and links
 * back to the region they came from.
 *
 * Synchronous and network-free, like both paths above: the periods are derived
 * from the dataset this bundle already carries, through the same contract a
 * reader's own export walks through. A derivation that fails is drawn as the
 * page's error state rather than silently falling back to the published sample —
 * two different synthetic datasets under one label is the confusion this
 * hand-off exists to remove.
 */
function paintExampleBriefing() {
  let briefing;
  try {
    briefing = buildExecutiveBriefing(exampleBriefingPeriods());
  } catch {
    briefing = null;
  }
  const verdict = briefing ? validateExecutiveBriefing(briefing) : null;
  if (!verdict?.valid) {
    const first = verdict?.violations?.[0];
    paint(renderBriefingError({
      summary: "The bundled example could not be built into a briefing",
      detail: first
        ? `The example's periods broke ${verdict.violations.length} rule(s); the first is `
          + `${first.code} at “${first.path || "the briefing itself"}”.`
        : "The bundled example dataset could not be analyzed in this browser.",
      remedy: "No figure is shown, because a briefing that fails the contract it declares cannot be "
        + "quoted. Nothing of yours was read and nothing was stored — the AI FinOps page still holds "
        + "the same example result, and this page briefs on your own retained periods without the "
        + "example link.",
      onRetry: loadExecutiveBriefingPreview,
    }));
    return null;
  }
  const preview = renderExecutiveBriefingPreview(briefing, {
    origin: EXAMPLE_BRIEFING_ORIGIN,
    provenanceNote: EXAMPLE_BRIEFING_PROVENANCE_NOTE,
    synthetic: EXAMPLE_BRIEFING_SYNTHETIC,
    followUp: true,
  });
  paint(renderExampleContextNotice(EXAMPLE_BRIEFING_NOTICE), preview);
  activate(preview);
  return preview;
}

/**
 * Draw the printable sheet for the bundled analysis's decision payload.
 *
 * THE ONE PATH THAT READS A FILE, and the header above says the others do not.
 * The payload is projected from the readiness block, which lives in
 * /evolution-demo-data.json and nowhere else — the same document
 * `evolution-page.js` reads to paint the region this link sits in. Restating
 * those figures in a bundled module the way the sample path does would make
 * this sheet network-free too, at the cost of a second copy of the block that
 * can drift from the one the workspace just showed the reader; two different
 * numbers under one label is the confusion this hand-off exists to remove. So
 * it fetches, and it says so on screen while it does, in its own labelled state
 * rather than under the markup's "nothing is fetched either way" panel.
 *
 * Nothing else about the boundary changes: no store is read or written, no
 * credential is sent, and `projectExecutiveBriefing` allowlists its own output,
 * so no provider row, prompt, or customer field can reach this sheet even if
 * the bundled document grows one.
 */
async function paintPayloadBriefing() {
  const restored = readExecutivePayloadFragment(globalThis.window?.location?.hash ?? "");
  if (restored) {
    const article = renderPayloadBriefing(document, restored);
    paint(article);
    const control = renderPrintControl({ note: PAYLOAD_PRINT_NOTE });
    actions?.replaceChildren(control);
    wirePrintControl(control, article, { scope: globalThis.window ?? globalThis, doc: document });
    return article;
  }
  paint(renderPayloadState(document, "loading", "Reading the bundled analysis",
    "Building the printable briefing in this tab from the bundled example's decision payload. "
    + "Nothing of yours is read, and nothing is uploaded."));
  try {
    const response = await globalThis.fetch(PAYLOAD_URL, { credentials: "same-origin" });
    if (!response?.ok) throw new Error(`bundled payload unavailable (${response?.status ?? "no response"})`);
    const data = await response.json();
    const article = renderPayloadBriefing(document, projectExecutiveBriefing(data?.briefingReadiness));
    paint(article);
    // The standing print hint under the sheet describes the workspace briefing,
    // where both levels open on paper. This sheet does the opposite, so the two
    // sentences a reader meets beside the same button have to agree — briefly
    // here, in full beside the control itself.
    const hint = document.querySelector(".brief-print-hint");
    if (hint) {
      hint.textContent = "Printing or saving as PDF keeps the decision: the site chrome and both "
        + "levels come off, and the answer, benchmark, action, and provenance stay.";
    }
    // Not `activate`: the disclosures here are native <details>, and the shared
    // print expansion opens `.brief-toggle` levels this sheet does not have.
    const control = renderPrintControl({ note: PAYLOAD_PRINT_NOTE });
    actions?.replaceChildren(control);
    wirePrintControl(control, article, { scope: globalThis.window ?? globalThis, doc: document });
    return article;
  } catch {
    paint(renderPayloadState(document, "error", "The briefing is unavailable",
      "The bundled decision payload is absent, incompatible, or malformed. No decision figures are "
      + "shown, because a briefing missing its own evidence cannot be quoted. Nothing of yours was "
      + "read or stored. Return to the analysis and try again."));
    return null;
  }
}

export async function loadExecutiveBriefingPreview() {
  if (!root) return null;
  try {
    if (new URLSearchParams(globalThis.window?.location?.search ?? "").get("payload") === "bundled") {
      return paintPayloadBriefing();
    }
    // The example context is read from the address bar, so it survives a copied
    // link and a reload — the two ways a reader actually keeps a page.
    if (readExampleContext(globalThis.window?.location ?? null).pinned) {
      return paintExampleBriefing();
    }
    // The fragment is read here and passed in, rather than reached for inside
    // the chooser, so the one place that decides what this page briefs on takes
    // both of its inputs as arguments.
    const chosen = chooseBriefingSource(browserFinopsWorkspaceStorage(), {
      hash: globalThis.window?.location?.hash ?? "",
    });
    if (chosen.source === BRIEFING_SOURCE.shared) return paintSharedBriefing(chosen);
    if (chosen.source === BRIEFING_SOURCE.workspace) return paintWorkspaceBriefing(chosen);
    return paintSampleBriefing(chosen);
  } catch (error) {
    // This function is awaited at the top level of a module. Anything that
    // escapes it leaves the markup's own "Reading…" panel and `aria-busy="true"`
    // on screen permanently — a page that claims to be working forever, which is
    // the one outcome this surface exists to not produce. Each path above
    // already handles the failures it can name; this catches the ones it cannot,
    // and fails in words with a control rather than in the console.
    paint(renderBriefingError({
      summary: "The briefing could not be built in this tab",
      detail: `This browser stopped while choosing what to brief on (${error?.name ?? "error"}).`,
      remedy: "Nothing was uploaded, nothing was stored, and your retained figures were not changed. "
        + "Retrying rebuilds from this browser's own periods, and reloading does the same from a "
        + "clean start.",
      onRetry: loadExecutiveBriefingPreview,
    }));
    return null;
  }
}

// The follow-up affordance is wired before the briefing is built and never
// touched again: it sits outside the painted region, so it is usable while the
// document is still loading, and it survives every repaint above it. The AI
// FinOps result runs the same module under its own id family.
initFinopsContact(document, undefined, { prefix: "briefing-contact" });

/**
 * Draw a brief that arrived as a FILE the reader chose.
 *
 * The SAME read-only recipient view a shared link is drawn in — the same
 * renderer, the same disclosures, the same print behaviour — because it is the
 * same envelope. What differs is the masthead's origin line, which says the
 * periods came off the reader's disk rather than off the address bar.
 *
 * Only ever reached with an envelope that already passed the whole contract:
 * `bindOpenSharedBrief` does not call back on a refusal. Nothing on this path
 * writes, so the reader's own retained records are untouched by opening it.
 */
export function paintOpenedBriefFile(envelope) {
  return paintSharedBriefing({
    periods: envelope.periods,
    origin: FILE_ORIGIN,
    provenanceNote: FILE_PROVENANCE_NOTE,
  });
}

// The file control is wired for the same reason and at the same point: it sits
// outside the painted region, so it survives every repaint above it and is
// usable before the first briefing has been built.
bindOpenSharedBrief(document, { onBrief: paintOpenedBriefFile });

if (root) await loadExecutiveBriefingPreview();
