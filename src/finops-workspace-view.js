// The FinOps local workspace, rendered.
//
// READING ORDER
// -------------
// One flow, top to bottom, stoppable at any point:
//
//   1. the boundary and the choice — what would be kept, and yes or no;
//   2. the consolidated briefing — one benchmark, one confidence, one period;
//   3. exactly one prioritized next action;
//   4. the evidence and the provenance, behind closed disclosures;
//   5. the retained records, the download, and the forget action.
//
// (1)'s explanatory copy and the contract preview are static markup, because a
// claim about what a page would keep must be true before any script runs.
//
// COLOUR IS NEVER THE MESSAGE
// ---------------------------
// The chips carry their meaning as words — "Remembering", "Moderate" — and the
// tone is `data-tone`, which the stylesheet turns into a wash or an outline.
// Read in greyscale, nothing is lost.
//
// FORGETTING IS TWO STEPS, AND THE SECOND ONE COUNTS WHAT IT WILL TAKE
// --------------------------------------------------------------------
// Forget reveals a named confirmation region, moves focus into it, and labels
// its commit button with the actual retained counts. Cancel puts focus back on
// the control the reader pressed. No `window.confirm`: a native dialog cannot
// say how many periods are about to go, and its answer cannot be reported
// through the live region that follows it.

import {
  FINOPS_CONSENT, FINOPS_OUTCOME, FINOPS_STATE,
  forgetFinopsWorkspace, readFinopsWorkspace, setFinopsConsent,
} from "./finops-workspace.js";
import {
  buildFinopsPortableRecord, importFinopsPortableRecord, parseFinopsPortableRecord,
} from "./finops-portable-record.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function chip(label, kind, tone) {
  const node = element("span", `ws-chip ws-chip-${kind}`, label);
  node.dataset.tone = tone;
  return node;
}

function fact(term, ...values) {
  const row = element("div", "ws-fact");
  row.append(element("dt", null, term));
  const detail = element("dd");
  detail.append(...values);
  row.append(detail);
  return row;
}

const plural = (count, noun) => `${count} ${count === 1 ? noun : `${noun}s`}`;

/** The download seam, shaped like `downloadShiplogExport` so both behave alike. */
export function downloadFinopsWorkspace(payload, options = {}) {
  const documentRef = options.document ?? document;
  const urlApi = options.urlApi ?? URL;
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const href = urlApi.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = href;
  const date = (options.now ?? new Date()).toISOString().slice(0, 10);
  link.download = `finops-workspace-${date}.json`;
  link.click();
  urlApi.revokeObjectURL(href);
}

/**
 * Mount the FinOps workspace flow against the shipped markup.
 *
 * @param root the document (or a parsed stand-in).
 * @param storage this browser's `localStorage`, or a stand-in.
 * @param options.now injectable clock, `options.download` injectable download —
 *   the same two seams the Shiplog half of this page already exposes, so a flow
 *   test drives the shipped wiring rather than a copy of it.
 */
export function initFinopsWorkspace(root, storage, options = {}) {
  const byId = (id) => root.querySelector(`#${id}`);
  const panel = byId("fw-panel");
  if (!panel) return null;

  const now = () => options.now?.() ?? new Date();
  const download = options.download ?? downloadFinopsWorkspace;

  const status = byId("fw-status");
  const facts = byId("fw-facts");
  const summary = byId("fw-summary");
  const next = byId("fw-next");
  const briefing = byId("fw-briefing");
  const benchmarkFigure = byId("fw-benchmark-figure");
  const benchmarkLabel = byId("fw-benchmark-label");
  const benchmarkDetail = byId("fw-benchmark-detail");
  const briefingPeriod = byId("fw-briefing-period");
  const evidence = byId("fw-evidence");
  const evidenceSummary = byId("fw-evidence-summary");
  const evidenceList = byId("fw-evidence-list");
  const provenance = byId("fw-provenance");
  const provenanceSummary = byId("fw-provenance-summary");
  const provenanceList = byId("fw-provenance-list");
  const recordsSummary = byId("fw-records-summary");
  const recordsList = byId("fw-records-list");
  const outcome = byId("fw-outcome");
  const announcement = byId("fw-announcement");
  const consentNote = byId("fw-consent-note");
  const grantButton = byId("fw-grant");
  const declineButton = byId("fw-decline");
  const exportButton = byId("fw-export");
  const importInput = byId("fw-import");
  const importConfirm = byId("fw-import-confirm");
  const importConfirmTitle = byId("fw-import-confirm-title");
  const importConfirmYes = byId("fw-import-confirm-yes");
  const importConfirmNo = byId("fw-import-confirm-no");
  const forgetButton = byId("fw-forget");
  const confirm = byId("fw-confirm");
  const confirmTitle = byId("fw-confirm-title");
  const confirmWarning = byId("fw-confirm-warning");
  const confirmYes = byId("fw-confirm-yes");
  const confirmNo = byId("fw-confirm-no");

  let view = null;
  let pendingImport = null;

  // One announcement channel. The visible notice and the screen-reader text are
  // the same sentence, so nothing is said to one reader and withheld from the
  // other.
  function report(message, { tone = "neutral" } = {}) {
    outcome.textContent = message ?? "";
    outcome.hidden = !message;
    outcome.dataset.tone = tone;
    announcement.textContent = message ?? "";
  }

  function closeConfirm({ focusTrigger = false } = {}) {
    confirm.hidden = true;
    forgetButton.setAttribute("aria-expanded", "false");
    if (focusTrigger) forgetButton.focus();
  }

  function renderStatus() {
    facts.replaceChildren(
      fact("FinOps storage", chip(view.chip.label, "storage", view.chip.tone)),
      fact("Kept here", element("span", "ws-count", view.state === FINOPS_STATE.unavailable
        ? "Unknown"
        : `${plural(view.counts.periods, "period")} · ${plural(view.counts.labels, "label")}`)),
      view.briefing
        ? fact("Confidence",
          chip(view.briefing.confidence.label, "confidence", view.briefing.confidence.tone),
          element("span", "ws-fact-detail", view.briefing.confidence.detail))
        : fact("Confidence", element("span", "ws-fact-detail",
          "No figure is kept here, so there is no confidence grade to report.")),
    );
    summary.textContent = view.summary;
    status.dataset.state = view.state;
    panel.setAttribute("aria-busy", "false");
  }

  /**
   * The briefing region, or nothing at all.
   *
   * A hidden region is the right answer for every state but `retaining`: an
   * empty benchmark card over a browser that has been asked nothing is a slot
   * pretending to be a finding.
   */
  function renderBriefing() {
    if (!view.briefing) {
      briefing.hidden = true;
      evidence.hidden = true;
      provenance.hidden = true;
      return;
    }
    briefing.hidden = false;
    evidence.hidden = false;
    provenance.hidden = false;
    briefing.dataset.available = String(view.briefing.available);
    benchmarkFigure.textContent = view.briefing.benchmark.figure;
    benchmarkFigure.dataset.available = String(view.briefing.benchmark.available);
    benchmarkLabel.textContent = view.briefing.benchmark.label;
    benchmarkDetail.textContent = view.briefing.benchmark.statement;
    briefingPeriod.textContent = view.briefing.priorPeriod
      ? `${view.briefing.period}, with ${view.briefing.priorPeriod} retained beside it`
      : `${view.briefing.period} · the only period kept here`;

    // The disclosures name their contents before they are opened, so a reader
    // decides whether to spend a keystroke on them.
    evidenceSummary.textContent =
      `Check the ${plural(view.counts.periods, "retained period")} behind this figure`;
    evidenceList.replaceChildren(...view.records
      .filter((record) => record.kind === "period")
      .map((record) => {
        const item = element("li", "fw-record");
        item.append(element("strong", null, record.headline), element("span", null, record.detail));
        return item;
      }));
    provenanceSummary.textContent = "Where every figure above comes from";
    provenanceList.replaceChildren(...view.briefing.provenance
      .map((row) => fact(row.term, element("span", null, row.detail))));
  }

  function renderNext() {
    const action = view.nextAction;
    const card = element("section", "ws-next-card");
    card.dataset.action = action.code;
    card.setAttribute("aria-labelledby", "fw-next-title");
    const title = element("h3", "ws-next-title", action.headline);
    title.id = "fw-next-title";
    title.setAttribute("tabindex", "-1");
    card.append(element("p", "eyebrow", "Do this next"), title, element("p", "ws-next-why", action.why));

    let control;
    if (action.kind === "link") {
      control = element("a", "ws-next-action", action.label);
      control.setAttribute("href", action.href);
    } else {
      control = element("button", "ws-next-action", action.label);
      control.setAttribute("type", "button");
      control.addEventListener("click", () => runAction(action.kind));
    }
    control.id = "fw-next-action";
    card.append(control);
    next.replaceChildren(card);
  }

  function renderRecords() {
    recordsSummary.textContent = view.records.length
      ? `Review the ${plural(view.records.length, "record")} this browser is keeping`
      : "Review what this browser is keeping — nothing, right now";
    recordsList.replaceChildren(...(view.records.length
      ? view.records.map((record) => {
        const item = element("li", "fw-record");
        item.dataset.kind = record.kind;
        item.append(element("strong", null, record.headline), element("span", null, record.detail));
        return item;
      })
      : [element("li", "fw-record", "No FinOps figure, label, or choice is stored in this browser.")]));
  }

  function renderControls() {
    const granted = view.consent.state === FINOPS_CONSENT.granted;
    grantButton.disabled = granted || view.state === FINOPS_STATE.unavailable;
    declineButton.disabled = view.consent.state === FINOPS_CONSENT.declined
      || view.state === FINOPS_STATE.unavailable;
    grantButton.setAttribute("aria-pressed", String(granted));
    declineButton.setAttribute("aria-pressed", String(view.consent.state === FINOPS_CONSENT.declined));
    consentNote.textContent = {
      [FINOPS_CONSENT.granted]: `Yes, chosen on ${view.consent.decidedOn ?? "an unrecorded date"}. `
        + "Derived monthly figures from analyses you run are written to this browser and read back "
        + "the next time you open this page on this device.",
      [FINOPS_CONSENT.declined]: `No, chosen on ${view.consent.decidedOn ?? "an unrecorded date"}. `
        + "Nothing FinOps-related is written here, and the figures already kept were dropped when "
        + "you chose. The AI FinOps page is unchanged: it still analyses the files you open.",
    }[view.consent.state]
      ?? "Not asked yet. Nothing FinOps-related has been written to this browser, and nothing "
        + "will be until you answer. Either answer leaves the file-based AI FinOps page working "
        + "exactly as it does now.";

    exportButton.disabled = !view.canExport;
    forgetButton.disabled = !view.canForget;
    confirmYes.textContent = view.records.length
      ? `Forget ${plural(view.records.length, "record")}`
      : "Forget the stored FinOps text";
    confirmWarning.textContent = view.records.length
      ? `This removes ${plural(view.counts.periods, "retained period")}, `
        + `${plural(view.counts.labels, "org-unit label")}, and your stored choice from this `
        + "browser, then reads both keys back to check they are empty. Nothing else keeps a copy. "
        + "Your Shiplog decisions and releases are not touched."
      : "This removes the text stored under Shiplog's two FinOps keys and reads both back to check "
        + "they are empty. Your Shiplog decisions and releases are not touched.";
  }

  function render() {
    view = readFinopsWorkspace(storage, { now: now() });
    renderStatus();
    renderBriefing();
    renderNext();
    renderRecords();
    renderControls();
    return view;
  }

  /**
   * Re-read, redraw, say what happened, and put focus where the answer is.
   *
   * Focus lands on the next action's heading rather than staying on a control
   * that may no longer mean what it did: after forgetting, "Forget 4 records" is
   * gone, and leaving a keyboard reader parked on a stale label is how a page
   * loses someone mid-task.
   */
  function settle(message, { tone = "neutral", focus = true } = {}) {
    render();
    report(message, { tone });
    if (focus) byId("fw-next-title")?.focus();
  }

  function runExport() {
    try {
      download(buildFinopsPortableRecord(storage));
      settle(FINOPS_OUTCOME.exported, { tone: "good", focus: false });
    } catch {
      settle(FINOPS_OUTCOME.export_failed, { tone: "bad", focus: false });
    }
  }

  function closeImportConfirm({ focusInput = false } = {}) {
    pendingImport = null;
    importConfirm.hidden = true;
    if (focusInput) importInput.focus();
  }

  async function runImport() {
    const file = importInput.files?.[0];
    if (!file) return;
    let parsed;
    try { parsed = parseFinopsPortableRecord(await file.text()); }
    catch { parsed = { ok: false, errors: ["File could not be read"] }; }
    if (!parsed.ok) {
      importInput.setAttribute("aria-invalid", "true");
      report(`Import refused: ${parsed.errors[0]}. Nothing changed.`, { tone: "bad" });
      return;
    }
    importInput.setAttribute("aria-invalid", "false");
    const result = importFinopsPortableRecord(storage, parsed, { now: now() });
    if (result.code === "confirmation_required") {
      pendingImport = parsed;
      importConfirm.hidden = false;
      importConfirmTitle.focus();
      report(result.message, { tone: "neutral" });
      return;
    }
    settle(result.message, { tone: result.ok ? "good" : "bad", focus: false });
    importInput.value = "";
  }

  function choose(state) {
    const result = setFinopsConsent(storage, state, { now: now() });
    settle(result.message, { tone: result.ok ? "good" : "bad" });
  }

  function openConfirm() {
    confirm.hidden = false;
    forgetButton.setAttribute("aria-expanded", "true");
    confirmTitle.focus();
  }

  function runForget() {
    const result = forgetFinopsWorkspace(storage);
    closeConfirm();
    settle(result.message, { tone: result.ok ? "good" : "bad" });
  }

  // The next-action button is a shortcut to a control that also exists in the
  // region below. It runs the same code path rather than a parallel one.
  function runAction(kind) {
    if (kind === "grant") return choose(FINOPS_CONSENT.granted);
    if (kind === "forget") return openConfirm();
    // "recheck": read both keys again and say so, whether or not the answer moved.
    return settle("This browser's FinOps storage was read again.", { tone: "neutral" });
  }

  grantButton.addEventListener("click", () => choose(FINOPS_CONSENT.granted));
  declineButton.addEventListener("click", () => choose(FINOPS_CONSENT.declined));
  exportButton.addEventListener("click", runExport);
  importInput.addEventListener("change", runImport);
  importConfirmNo.addEventListener("click", () => {
    closeImportConfirm({ focusInput: true });
    importInput.value = "";
    report("Import cancelled. Nothing in this browser was changed.", { tone: "neutral" });
  });
  importConfirmYes.addEventListener("click", () => {
    const result = importFinopsPortableRecord(storage, pendingImport, { confirm: true, now: now() });
    closeImportConfirm();
    importInput.value = "";
    settle(result.message, { tone: result.ok ? "good" : "bad" });
  });
  forgetButton.addEventListener("click", () => {
    if (confirm.hidden) openConfirm();
    else closeConfirm({ focusTrigger: true });
  });
  confirmNo.addEventListener("click", () => {
    closeConfirm({ focusTrigger: true });
    report("Forget cancelled. Nothing in this browser was changed.", { tone: "neutral" });
  });
  confirmYes.addEventListener("click", runForget);

  render();
  report(null);
  return { render, refresh: () => settle(null, { focus: false }) };
}
