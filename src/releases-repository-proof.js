// One real Shiplog decision and the recorded build that contains it, beside the
// Releases page's invented decision-to-release story (#2908).
//
// Not a second fetcher: the pairing is the home page's repositoryReleasePair
// (app.js), run over the same canonical REPOSITORY_DECISIONS and over the
// historical build stamp the home page's "Last verified" block transcribes
// (docs/repository-proof.md). That stamp is public and immutable at
// LAST_VERIFIED_STAMP_COMMIT, so every value shown here can be checked there.
// Anything the pairing cannot prove renders the failure sentence and no field.
import { repositoryReleasePair } from "./app.js";
import { REPOSITORY_DECISIONS } from "./seed-records.js";
import { REPOSITORY_URL, commitUrl, pullRequestUrl, shortCommit } from "./deployed-release.js";

export const LAST_VERIFIED_STAMP_COMMIT = "a1dc0a2dd45b24f8c114dfabed2a31f095f75557";
export const LAST_VERIFIED_BUILD = Object.freeze({
  schemaVersion: 1,
  commitSha: "28b2398ff49c1026182305c85b8a2ed715069ab6",
  commitSubject: "Agent: Mina — Attribute the homepage history count and rows to example data or the visitor's own records (#2547)",
  builtAt: "2026-09-25T09:08:40.330Z",
});

export const REPOSITORY_PROOF_LOADED = "Loaded: one decision from the Shiplog repository and the recorded build that contains it.";
export const REPOSITORY_PROOF_FAILED = "The repository record could not load, so no decision or build from it is shown here. The public Shiplog repository holds every decision and build.";
export const REPOSITORY_PROOF_NOT_LIVE = "This describes a recorded build, not the deployment running now.";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const utcDay = (iso) => {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

export function repositoryProofPair(decisions = REPOSITORY_DECISIONS, stamp = LAST_VERIFIED_BUILD) {
  try {
    return repositoryReleasePair(decisions, stamp);
  } catch {
    return null;
  }
}

// Only #repository-proof-status is live; the record itself is static once
// written, and nothing here moves focus.
export function renderRepositoryProof(root, pair = repositoryProofPair()) {
  const section = root.querySelector("#repository-proof");
  const status = root.querySelector("#repository-proof-status");
  const target = root.querySelector("#repository-proof-record");
  const fallback = root.querySelector("#repository-proof-repo");
  if (!section || !status || !target) return;
  target.replaceChildren();
  section.dataset.state = pair ? "loaded" : "failed";
  status.textContent = pair ? REPOSITORY_PROOF_LOADED : REPOSITORY_PROOF_FAILED;
  if (fallback) {
    fallback.hidden = Boolean(pair);
    if (pair) fallback.removeAttribute("href");
    else fallback.setAttribute("href", REPOSITORY_URL);
  }
  if (!pair) return;
  const { decision, release, pullNumber, status: decisionStatus } = pair;
  const commit = shortCommit(release.commitSha);
  const facts = root.createElement("dl");
  facts.setAttribute("class", "shiplog-proof-facts");
  for (const [term, value] of [
    ["Decision", decision.title],
    ["Decision status", decisionStatus[0].toUpperCase() + decisionStatus.slice(1)],
    ["Decision owner", decision.owner],
    ["Recorded build", `Commit ${commit}, which merged pull request #${pullNumber}`],
  ]) {
    const row = root.createElement("div");
    const dt = root.createElement("dt");
    const dd = root.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    row.append(dt, dd);
    facts.append(row);
  }
  target.append(facts);
  for (const text of [`Last verified ${utcDay(release.createdAt)}.`, REPOSITORY_PROOF_NOT_LIVE]) {
    const note = root.createElement("p");
    note.setAttribute("class", "shiplog-proof-note");
    note.textContent = text;
    target.append(note);
  }
  const share = root.createElement("div");
  share.setAttribute("class", "shiplog-proof-share");
  for (const [href, text] of [
    [pullRequestUrl(pullNumber), `Open pull request #${pullNumber}, the source of this decision, on GitHub`],
    [commitUrl(release.commitSha), `Open commit ${commit}, the recorded build, on GitHub`],
    [`${REPOSITORY_URL}/blob/${LAST_VERIFIED_STAMP_COMMIT}/src/build-stamp.js`, "Inspect the recorded build stamp on GitHub"],
  ]) {
    const link = root.createElement("a");
    link.setAttribute("class", "shiplog-real-link");
    link.setAttribute("href", href);
    link.textContent = text;
    share.append(link);
  }
  target.append(share);
}
