// The Savings Commitment page: one decision, one action, one confirmation.
//
// This entry owns the two things the contract and its render layer deliberately
// do not: the visitor's own briefing file, and the write to this browser's
// decision log. Everything it writes goes through Rowan's
// `recordCommitmentDecision`, which is the same `saveDecisions` the record form
// uses — there is no second decision store here, and no second commitment model.
//
// The bundled synthetic analysis is the state this page starts in and falls back
// to. A briefing that cannot be read never replaces it: a rejection is reported
// beside whatever commitment is already on screen, so opening the wrong file
// costs a sentence rather than the briefing the visitor was working from.

import { loadSavingsCommitment } from "/savings-commitment.js";
import { readCommitmentHandoffs } from "/commitment-handoff.js";
import {
  COMMITMENT_METADATA_FIELD, CommitmentDecisionError, recordCommitmentDecision,
} from "/finops-commitment-decision.js";
// The opt-in FinOps workspace. Approving a commitment writes it here too, so a
// later visit can say which commitments this browser has already recorded
// without the visitor reopening the briefing they were derived from. Without a
// granted consent the adapter writes nothing and reads back nothing; the
// decision log above is unaffected either way.
import {
  browserFinopsWorkspaceStorage, readRetainedCommitments, retainApprovedCommitment,
} from "/finops-workspace.js";
import {
  RECORD_BUTTON_ID,
  RECORD_OWNER_ID,
  renderHandoffRejections,
  renderRecordConfirmation,
  renderRecordError,
  renderSavingsCommitment,
  renderSavingsCommitmentError,
} from "/savings-commitment-view.js";

const root = document.getElementById("savings-commitment");
const fileInput = document.getElementById("commit-file");
const notices = document.getElementById("commit-notices");
const status = document.getElementById("commit-handoff-status");

const BUNDLED_ORIGIN = "Bundled example analysis · nothing of yours is loaded yet";

// The commitment currently on screen. Held for as long as the tab is open and
// no longer: a briefing is the visitor's own spend, and this page has no reason
// to keep a copy of it once they close it.
let current = null;

function say(message) {
  if (status) status.textContent = message;
}

function paint(node) {
  root.replaceChildren(node);
  root.setAttribute("aria-busy", "false");
}

/**
 * Draw the commitment and wire its one control. The listener is attached after
 * every paint because the card is rebuilt whenever the briefing changes, and a
 * listener on a discarded node would silently stop recording anything.
 */
function renderCurrent() {
  if (!current) {
    paint(renderSavingsCommitmentError());
    return;
  }
  paint(renderSavingsCommitment(current.preview, { origin: current.origin }));
  root.querySelector(`#${RECORD_BUTTON_ID}`)?.addEventListener("click", record);
}

/**
 * Keep the approved commitment in the opt-in FinOps workspace beside the
 * decision it became.
 *
 * The approver's name is deliberately not handed over: the decision log records
 * who approved it, and the workspace's own contract forbids a person's name.
 * Never throws — a workspace refusal must not lose a decision that was recorded.
 */
function retainApproval(decision, approvedAt) {
  try {
    return retainApprovedCommitment(browserFinopsWorkspaceStorage(), {
      metadata: decision?.[COMMITMENT_METADATA_FIELD],
      decisionId: decision?.id ?? null,
      approvedAt,
    });
  } catch {
    return null;
  }
}

const usd = (minor) => `${(Math.round(Number(minor)) / 100).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})} USD`;

/**
 * Say what this browser already recorded, from the workspace store alone.
 *
 * This is the return-visit half of the write above: no file is reopened, no
 * request is made, and the line is absent — not empty — when retention was
 * never granted or nothing is kept.
 */
function paintRetained() {
  const line = document.getElementById("commit-retained");
  if (!line) return [];
  let retained = [];
  try {
    retained = readRetainedCommitments(browserFinopsWorkspaceStorage());
  } catch {
    retained = [];
  }
  if (retained.length === 0) {
    line.textContent = "";
    line.hidden = true;
    return retained;
  }
  const newest = retained.at(-1);
  line.textContent = `This browser has already recorded ${retained.length} `
    + `commitment${retained.length === 1 ? "" : "s"}, kept here because you opted in. The most `
    + `recent is ${newest.commitmentId} — ${usd(newest.claim.monthlySavingsMinor)} a month for `
    + `${newest.claim.period}, approved on ${String(newest.recordedAt).slice(0, 10)}. It was read `
    + "from this browser's storage; no file was reopened and nothing was uploaded.";
  line.hidden = false;
  return retained;
}

function record() {
  const outcome = root.querySelector("#commit-record-outcome");
  const owner = root.querySelector(`#${RECORD_OWNER_ID}`);
  try {
    // The approval instant is this page's; the modules below it read no clock,
    // which is what lets the same commitment produce the same record in a test.
    const approvedAt = new Date().toISOString();
    const result = recordCommitmentDecision(globalThis.localStorage, {
      preview: current.preview,
      approvedBy: String(owner?.value ?? "").trim(),
      approvedAt,
    });
    retainApproval(result.decision, result.decision?.createdAt ?? approvedAt);
    paintRetained();
    outcome.replaceChildren(renderRecordConfirmation(result));
    root.querySelector(`#${RECORD_BUTTON_ID}`)?.setAttribute("disabled", "disabled");
    say(result.created
      ? "Decision recorded in this browser's Shiplog log."
      : "This commitment was already recorded; the existing decision is linked below.");
    outcome.querySelector(".commit-recorded")?.focus?.();
  } catch (error) {
    const message = error instanceof CommitmentDecisionError
      ? error.message
      : "This decision could not be written to your browser's log, so nothing was recorded. "
        + "Storage may be full or blocked in this browser.";
    if (!(error instanceof CommitmentDecisionError)) {
      console.error("commitment_decision_not_recorded", {
        error: error?.message ?? String(error),
      });
    }
    outcome.replaceChildren(renderRecordError(message));
  }
}

async function openFiles(list) {
  const files = [];
  for (const file of list) {
    files.push({ name: file.name, text: await file.text(), byteSize: file.size });
  }
  const read = readCommitmentHandoffs(files);
  notices.replaceChildren(...[renderHandoffRejections(read.rejections)].filter(Boolean));
  if (read.accepted) {
    current = { preview: read.accepted.preview, origin: read.accepted.label };
    renderCurrent();
    say(`Now proposing the commitment from ${read.accepted.label}.`);
    return;
  }
  say(`${read.rejections.length} file${read.rejections.length === 1 ? " was" : "s were"} not `
    + "used. The commitment already on screen is unchanged.");
}

fileInput?.addEventListener("change", async (event) => {
  const list = [...(event.target.files ?? [])];
  if (!list.length) return;
  try {
    await openFiles(list);
  } catch (error) {
    console.error("commitment_briefing_unreadable", { error: error?.message ?? String(error) });
    say("Those files could not be read in this tab. The commitment already on screen is unchanged.");
  } finally {
    // So reopening the same file fires a change event again.
    event.target.value = "";
  }
});

try {
  current = { preview: await loadSavingsCommitment(), origin: BUNDLED_ORIGIN };
  say("Showing the bundled example analysis. Open an exported briefing to decide on your own.");
} catch (error) {
  console.error("savings_commitment_unavailable", {
    error: error?.message ?? String(error),
  });
  say("The bundled example analysis could not be read. Open an exported briefing to continue.");
}
paintRetained();
renderCurrent();
