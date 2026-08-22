// Rendering for the real record of this deployment, at the top of the releases
// page.
//
// The record itself is src/deployed-release.js and is pure; this layer only
// turns it into DOM. Every value written here originates in the build stamp, and
// every one of them is written through `textContent`, or as an href this module
// composed itself, or as one it checked with `sameSiteHref` before painting —
// nothing on this block is assembled as markup.
//
// TWO STATES, BOTH STATED. A stamped build gets the record, its commit, and a
// link to that commit in the public repository. An unstamped build gets a block
// that says so: no sha, no link, and a marking that no longer claims to be a
// real record. There is no third state where the block shows something it
// cannot back.
//
// The block writes nothing: no form, no submit, no storage.

import { NO_RECORD_LABEL, REAL_LABEL, commitLinkText, sameSiteHref } from "./deployed-release.js";
import { copyRecordUrl } from "./share-link.js";

export const SHIPPED_BUILD_IDS = Object.freeze({
  panel: "shipped-build",
  marking: "shipped-build-marking",
  note: "shipped-build-note",
  facts: "shipped-build-facts",
  source: "shipped-build-source",
  detail: "shipped-build-detail",
  copy: "shipped-build-copy",
  copyStatus: "shipped-build-copy-status",
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
export function renderShippedBuild(root, record, options = {}) {
  const panel = byId(root, SHIPPED_BUILD_IDS.panel);
  if (!panel) return null;
  const doc = root.ownerDocument ?? root;
  const marking = byId(root, SHIPPED_BUILD_IDS.marking);
  const note = byId(root, SHIPPED_BUILD_IDS.note);
  const facts = byId(root, SHIPPED_BUILD_IDS.facts);
  const source = byId(root, SHIPPED_BUILD_IDS.source);
  const detail = byId(root, SHIPPED_BUILD_IDS.detail);
  const copy = byId(root, SHIPPED_BUILD_IDS.copy);
  const copyStatus = byId(root, SHIPPED_BUILD_IDS.copyStatus);

  if (!record) {
    panel.dataset.shippedBuild = "unstamped";
    // The marking goes with the record. With no record there is nothing to
    // mark as real, so the badge says that instead of keeping a word it can no
    // longer back.
    if (marking) marking.textContent = NO_RECORD_LABEL;
    if (note) note.textContent = UNSTAMPED_NOTE;
    if (facts) facts.replaceChildren();
    if (source) source.hidden = true;
    if (detail) detail.hidden = true;
    if (copy) copy.hidden = true;
    if (copyStatus) copyStatus.textContent = "";
    return null;
  }

  panel.dataset.shippedBuild = "real";
  if (marking) marking.textContent = REAL_LABEL;
  if (note) note.textContent = REAL_NOTE;
  if (facts) {
    facts.replaceChildren(
      fact(doc, "Version", record.version),
      fact(doc, "Released", record.createdAt),
      fact(doc, "Owner", record.owner),
      fact(doc, "Status", record.status),
      fact(doc, "Summary", record.description),
    );
  }
  if (source && record.sourceUrl) {
    source.hidden = false;
    source.href = record.sourceUrl;
    source.setAttribute("href", record.sourceUrl);
    source.textContent = commitLinkText(record.commitSha);
  }
  // Checked, not trusted: a record whose detailHref is not a link into this
  // site gets no anchor and no copy button, the same way a record whose sha is
  // not a commit gets no repository link above. A withdrawn control is a state
  // the block already has; a control pointing somewhere this module did not
  // sanction is not.
  const detailHref = sameSiteHref(record.detailHref);
  if (detail) {
    detail.hidden = !detailHref;
    if (detailHref) {
      detail.href = detailHref;
      detail.setAttribute("href", detailHref);
    }
  }
  if (copy) {
    const locationRef = options.location ?? globalThis.window?.location;
    const clipboard = options.clipboard ?? globalThis.navigator?.clipboard;
    let url = "";
    try {
      if (detailHref) url = new URL(detailHref, locationRef?.origin).href;
    } catch {}
    // No URL means there is nothing to put on the clipboard, so the control is
    // withdrawn rather than left to report its own failure. A missing clipboard
    // is different and keeps the button: that failure has a next step, and the
    // status line below says it.
    copy.hidden = !url;
    // The URL the button copies lives on the button, and the handler is bound
    // once. renderShippedBuild is exported for direct use, so a second render
    // over the same DOM would otherwise stack handlers and write the clipboard
    // once per past render; reading the URL back out here rather than closing
    // over it keeps that one handler pointed at the record now on screen.
    copy.dataset.copyUrl = url;
    if (url && !copy.dataset.copyBound) {
      copy.dataset.copyBound = "yes";
      copy.addEventListener("click", async () => {
        copy.disabled = true;
        if (copyStatus) copyStatus.textContent = "";
        const copied = await copyRecordUrl(clipboard, copy.dataset.copyUrl);
        if (copyStatus) {
          copyStatus.textContent = copied
            ? "Real release link copied to clipboard."
            : "Clipboard unavailable. Open the real record of this deployment to copy its address.";
        }
        copy.disabled = false;
      });
    }
  }
  return record;
}
