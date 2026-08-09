// The homepage's short, forwardable reading of the bundled worked decision.
// Keep this byte-identical to #executive-takeaway-text: the visible paragraph
// lets a reader verify the clipboard payload before activating the control.
// Every claim here is authored rather than composed, because the composer that
// publishes it on AI FinOps carries an import graph this first screen must not
// pay for. Authored, then, but not unpinned: the test file holds all four
// claims against `buildStandHeadline()` and `buildFirstRunResult()`, so a
// rename or a re-rank in the example data fails the build here rather than
// quietly forwarding a stale number to somebody's boss.
export const EXECUTIVE_TAKEAWAY = "$51,254 of $154,500 in analyzed AI spend is recoverable (33%) "
  + "— a modelled ceiling on what re-routing this work could save, not money already saved. "
  + "First recommended action: Pilot lower-cost routing in Atlas Platform. "
  + "Accountable role: Platform Engineering Lead. Figures are from a bundled synthetic example "
  + "and are not visitor data. No visitor export, account, or customer data was used.";

export const TAKEAWAY_COPY_FEEDBACK = Object.freeze({
  copied: "Executive takeaway copied.",
  failed: "Could not copy the executive takeaway. Select the text above and copy it manually.",
  printFailed: "Printing is unavailable here. Use your browser’s Print command to print this handoff.",
});

/** Wire the handoff dialog. Dependencies are injectable for focused tests. */
export function bindExecutiveTakeaway(doc = globalThis.document, clipboard = globalThis.navigator?.clipboard,
  scope = globalThis.window) {
  const open = doc?.getElementById("open-executive-proof");
  const dialog = doc?.getElementById("executive-proof-handoff");
  const close = doc?.getElementById("close-executive-proof");
  const button = doc?.getElementById("copy-executive-takeaway");
  const print = doc?.getElementById("print-executive-takeaway");
  const fallback = doc?.getElementById("executive-takeaway-fallback");
  const status = doc?.getElementById("executive-takeaway-status");
  if (!open || !dialog || !close || !button || !print || !fallback || !status) return false;

  const dismiss = () => {
    dialog.hidden = true;
    doc.body?.classList?.remove("printing-executive-proof");
    open.setAttribute("aria-expanded", "false");
    open.focus();
  };
  open.setAttribute("aria-expanded", "false");
  open.addEventListener("click", () => {
    dialog.hidden = false;
    open.setAttribute("aria-expanded", "true");
    status.textContent = "";
    fallback.hidden = true;
    close.focus();
  });
  close.addEventListener("click", dismiss);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismiss();
    if (event.key === "Tab") {
      const controls = [...dialog.querySelectorAll("button,textarea")]
        .filter((control) => !control.hidden && !control.disabled);
      const first = controls[0];
      const last = controls.at(-1);
      if ((!event.shiftKey && doc.activeElement === last) || (event.shiftKey && doc.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  });

  button.addEventListener("click", async () => {
    try {
      if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
      await clipboard.writeText(EXECUTIVE_TAKEAWAY);
      status.textContent = TAKEAWAY_COPY_FEEDBACK.copied;
    } catch {
      status.textContent = TAKEAWAY_COPY_FEEDBACK.failed;
      fallback.value = EXECUTIVE_TAKEAWAY;
      fallback.hidden = false;
      fallback.focus();
      fallback.select?.();
    }
  });
  print.addEventListener("click", () => {
    try {
      if (typeof scope?.print !== "function") throw new Error("Print unavailable");
      doc.body?.classList?.add("printing-executive-proof");
      scope.print();
    } catch {
      doc.body?.classList?.remove("printing-executive-proof");
      status.textContent = TAKEAWAY_COPY_FEEDBACK.printFailed;
    }
  });
  scope?.addEventListener?.("afterprint", () => {
    doc.body?.classList?.remove("printing-executive-proof");
  });
  return true;
}

if (globalThis.document) bindExecutiveTakeaway();
