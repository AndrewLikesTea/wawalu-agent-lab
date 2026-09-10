import { copyText } from "./share-link.js";

// Authored template only. Never compose this from DOM text, location, storage,
// records, or form values. Tests pin the visible template to this payload.
export const PILOT_SCORECARD_TEXT = `Shiplog pilot scorecard

For your evaluating team to complete during a pilot and share with a manager. Set your own targets before measuring; all targets, results, and owners below are blank. No pilot outcome is claimed.

1. Release reasoning retrieval
Your evaluating team must time how long it takes to find a selected release’s linked decision and identify its context and alternatives.
Buyer target: ________
Observed result: ________
Owner: ________

2. Record completeness
Your evaluating team must count sampled decisions with context, alternatives, owner, and status, and sampled releases with the expected decision links; record counts and sample sizes.
Buyer target: ________
Observed result: ________
Owner: ________

3. Team handoff
Your evaluating team must ask a teammate to review a handed-off record and count unanswered questions about why the work shipped and who owns it.
Buyer target: ________
Observed result: ________
Owner: ________

4. Data-handling requirements
Your evaluating team must compare browser-local storage, retention controls, and export behavior with your data-handling requirements; record requirements checked and any gaps.
Buyer target: ________
Observed result: ________
Owner: ________

The example decisions and releases are synthetic, use no customer or production data, and are not customer results.

Page: https://labs.wawalu.org/`;

export function bindPilotScorecard(doc = globalThis.document,
  clipboard = globalThis.navigator?.clipboard) {
  const button = doc?.getElementById("copy-pilot-scorecard");
  const status = doc?.getElementById("pilot-scorecard-status");
  const fallback = doc?.getElementById("pilot-scorecard-fallback");
  const manual = doc?.getElementById("pilot-scorecard-manual");
  if (!button || !status || !fallback || !manual) return false;
  let pending = false;
  button.addEventListener("click", async () => {
    if (pending) return;
    pending = true;
    // Keep keyboard focus while preventing concurrent clipboard writes.
    button.setAttribute("aria-disabled", "true");
    status.textContent = "Copying pilot scorecard…";
    const copied = await copyText(clipboard, PILOT_SCORECARD_TEXT);
    pending = false;
    button.removeAttribute("aria-disabled");
    status.textContent = copied
      ? "Pilot scorecard and canonical page link copied. Blank fields are ready for your team."
      : "Could not copy the pilot scorecard. Use the manual copying text box below.";
    fallback.hidden = copied;
    if (!copied) {
      manual.value = PILOT_SCORECARD_TEXT;
      manual.focus();
      manual.select();
    }
  });
  return true;
}

if (typeof document !== "undefined") bindPilotScorecard();
