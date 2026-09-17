import { copyText } from "./share-link.js";
import { BRIEF_FOLLOW_UP_SENTENCE, BRIEF_FOLLOW_UP_URL } from "./shiplog-evaluation-brief.js";

// The handoff runs on the log's own controls, named by their visible labels: a
// record reaches a teammate as a file, never as a shared or hosted copy.
//
// #2394: the two labels were right and the address was missing. A reviewer sent
// to "export a record" opened the Releases page, found a button reading
// "Export releases as JSON", and read the step as naming a control that does not
// exist. Both halves of the round trip live on the Home page — the export button
// and the file picker in the two Portable history panels — and the Releases page
// carries a releases-only export under a different label and no import control
// at all. The step says so rather than leaving a team to find it out, and no
// control is renamed to make the sentence shorter.
//
// #2395: the address it gained was "this page" and "here". This text is written
// to leave the page it describes — it is copied to a clipboard for a manager and
// downloaded as shiplog-evaluation-brief.txt to forward — so a deictic resolves
// only for the one reader who never needed it. Worse, the same sentence names
// the Releases page, so "here" invited the reading it was added to prevent. Each
// control is now named with the destination its nav link carries: "Home".
export const PILOT_TEAM_HANDOFF = "Your evaluating team must hand a record to a teammate as a file: press “Download JSON” on the Home page to export it, send the file to your teammate, and have them open it with “Choose JSON file” on the Home page in their own browser and confirm the summary. Both controls are on the Home page only: the Releases page has a separate “Export releases as JSON” button and no import control. Count their unanswered questions about why the work shipped and who owns it.";

export const PILOT_SCORECARD_CRITERIA = Object.freeze([
  ["Release reasoning retrieval", "Your evaluating team must time how long it takes to find a selected release’s linked decision and identify its context and alternatives."],
  ["Record completeness", "Your evaluating team must count sampled decisions with context, alternatives, owner, and status, and sampled releases with the expected decision links; record counts and sample sizes."],
  ["Team handoff", PILOT_TEAM_HANDOFF],
  ["Data-handling requirements", "Your evaluating team must compare browser-local storage, retention controls, and export behavior with your data-handling requirements; record requirements checked and any gaps."],
]);

// Authored template only. Never compose this from DOM text, location, storage,
// records, or form values. Tests pin the visible template to this payload, and
// the follow-up line is the evaluation brief's, word for word.
export function buildPilotScorecardText(criteria = PILOT_SCORECARD_CRITERIA) {
  return ["Shiplog pilot scorecard",
    "For your evaluating team to complete during a pilot and share with a manager. Set your own targets before measuring; all targets, results, and owners below are blank. No pilot outcome is claimed.",
    ...criteria.map(([title, instruction], i) =>
      `${i + 1}. ${title}\n${instruction}\nBuyer target: ________\nObserved result: ________\nOwner: ________`),
    "The example decisions and releases are invented, use no customer or production data, and are not customer results.",
    `${BRIEF_FOLLOW_UP_SENTENCE} ${BRIEF_FOLLOW_UP_URL}`,
    "Page: https://labs.wawalu.org/",
  ].join("\n\n");
}

export const PILOT_SCORECARD_TEXT = buildPilotScorecardText();

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
