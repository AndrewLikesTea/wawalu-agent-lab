// Rendering for the real record of this deployment, at the top of the releases
// page.
//
// The record itself is src/deployed-release.js and is pure; this layer only
// turns it into DOM. Every value written here originates in the build stamp, and
// every one of them is written through `textContent` or as an href this module
// composed itself — nothing on this block is assembled as markup.
//
// TWO STATES, BOTH STATED. A stamped build gets the record, its commit, and a
// link to that commit in the public repository. An unstamped build gets a block
// that says so: no sha, no link, and a marking that no longer claims to be a
// real record. There is no third state where the block shows something it
// cannot back.
//
// The block writes nothing: no form, no submit, no storage.

import { NO_RECORD_LABEL, REAL_LABEL, shortCommit } from "./deployed-release.js";

export const SHIPPED_BUILD_IDS = Object.freeze({
  panel: "shipped-build",
  marking: "shipped-build-marking",
  note: "shipped-build-note",
  facts: "shipped-build-facts",
  source: "shipped-build-source",
});

export const REAL_NOTE = "This record is not an example. The build that produced the page you are reading wrote it, from the commit that build was made from. Open that commit below and check it against the public repository.";

export const UNSTAMPED_NOTE = "This build is unstamped: it records no commit, so there is no real record of it to show. Every release record on this page is an invented example.";

function byId(root, id) {
  return root.querySelector(`#${id}`);
}

function fact(doc, label, value) {
  const pair = doc.createElement("div");
  const term = doc.createElement("dt");
  term.textContent = label;
  const description = doc.createElement("dd");
  description.textContent = value;
  pair.append(term, description);
  return pair;
}

/**
 * Paint the block. Synchronous and side-effect free apart from the DOM it is
 * handed, so a test can render a record object directly.
 *
 * @param record the record from `deployedReleaseRecord`, or null when the
 *   running build is unstamped and there is nothing real to show.
 * @returns the record it painted, or null for the unstamped state.
 */
export function renderShippedBuild(root, record) {
  const panel = byId(root, SHIPPED_BUILD_IDS.panel);
  if (!panel) return null;
  const doc = root.ownerDocument ?? root;
  const marking = byId(root, SHIPPED_BUILD_IDS.marking);
  const note = byId(root, SHIPPED_BUILD_IDS.note);
  const facts = byId(root, SHIPPED_BUILD_IDS.facts);
  const source = byId(root, SHIPPED_BUILD_IDS.source);

  if (!record) {
    panel.dataset.shippedBuild = "unstamped";
    // The marking goes with the record. With no record there is nothing to
    // mark as real, so the badge says that instead of keeping a word it can no
    // longer back.
    if (marking) marking.textContent = NO_RECORD_LABEL;
    if (note) note.textContent = UNSTAMPED_NOTE;
    if (facts) facts.replaceChildren();
    if (source) source.hidden = true;
    return null;
  }

  panel.dataset.shippedBuild = "real";
  if (marking) marking.textContent = REAL_LABEL;
  if (note) note.textContent = REAL_NOTE;
  if (facts) {
    facts.replaceChildren(
      fact(doc, "Version", record.version),
      fact(doc, "Built", record.createdAt),
      fact(doc, "Status", record.status),
    );
  }
  if (source && record.sourceUrl) {
    source.hidden = false;
    source.href = record.sourceUrl;
    source.setAttribute("href", record.sourceUrl);
    source.textContent = `Open commit ${shortCommit(record.commitSha)} in the public repository`;
  }
  return record;
}
