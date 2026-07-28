// Painting what this browser remembered, in its own region.
//
// The same rule the reopened-file region follows: a returning visitor must be
// able to tell at a glance which figures are today's import and which came out
// of this browser's store. So this never borrows the live slot's markup, and
// every value is written through `textContent` — nothing out of storage becomes
// markup, an attribute value, or a URL.
//
// The region is hidden whenever there is nothing to restore. A visitor who
// declined, or who has never been asked, sees no trace of it: an empty panel
// explaining that nothing was kept is still a FinOps panel about their data.

const byId = (doc, id) => doc.getElementById(id);

const REGION = "workspace-restore";

function write(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text ?? "";
}

function show(doc, id, visible) {
  const node = byId(doc, id);
  if (node) node.hidden = !visible;
}

/** One `<li>` per row, text only. */
function listOf(doc, id, statements) {
  const list = byId(doc, id);
  if (!list) return;
  list.replaceChildren(...statements.map((statement) => {
    const item = doc.createElement("li");
    item.textContent = statement;
    return item;
  }));
  list.hidden = statements.length === 0;
}

/** Term/detail pairs into a `<dl>`, same rule. */
function definitionsOf(doc, id, rows) {
  const list = byId(doc, id);
  if (!list) return;
  const nodes = [];
  for (const row of rows) {
    const term = doc.createElement("dt");
    term.textContent = row.term;
    const detail = doc.createElement("dd");
    detail.textContent = row.detail;
    nodes.push(term, detail);
  }
  list.replaceChildren(...nodes);
}

/**
 * Paint — or hide — the restored workspace region.
 *
 * @param doc the page document.
 * @param model what `restoreFinopsWorkspace` returned.
 * @returns the region's state, so a caller can announce it without re-deriving.
 */
export function applyWorkspaceRestore(doc, model) {
  const section = byId(doc, REGION);
  if (!section) return null;
  if (!model?.available) {
    section.hidden = true;
    section.dataset.state = "empty";
    write(doc, "workspace-restore-summary", "");
    write(doc, "workspace-restore-trend", "");
    listOf(doc, "workspace-restore-commitments", []);
    definitionsOf(doc, "workspace-restore-provenance", []);
    return "empty";
  }

  section.hidden = false;
  section.dataset.state = "restored";
  section.dataset.period = model.briefing?.period ?? "";
  section.dataset.migrated = model.migratedFrom ? "true" : "false";

  write(doc, "workspace-restore-summary", model.briefing
    ? model.briefing.statement
    : "This browser kept approved commitments but no derived period to read them against.");
  write(doc, "workspace-restore-trend", model.trend?.statement ?? "");
  show(doc, "workspace-restore-trend", Boolean(model.trend?.statement));
  write(doc, "workspace-restore-reconciliation", model.reconciliation?.statement ?? "");
  listOf(doc, "workspace-restore-commitments",
    (model.reconciliation?.rows ?? []).map((row) => row.statement));
  definitionsOf(doc, "workspace-restore-provenance", model.provenance ?? []);
  return "restored";
}
