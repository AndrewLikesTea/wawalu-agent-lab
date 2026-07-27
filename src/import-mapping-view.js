// The column-review surface: what the mapping model says, painted into the
// shipped markup of evolution.html.
//
// It takes the document rather than reading a global, exactly like
// local-import-flow.js, so a test drives the real markup instead of a fixture.
// Every node is built with createElement and textContent, and every string that
// came out of the reader's file — headers, sample values, the file name — is
// written as a text node or an attribute value, never as markup. A header of
// `<img src=x onerror=alert(1)>` is a column called `<img src=x onerror=alert(1)>`
// and nothing else, in the cell, in the accessible name, and in the title.
//
// Three rules the surface holds:
//   1. Every control names its own column. Twelve selects called "Map to" is a
//      page a screen-reader user cannot operate.
//   2. Every validation message is bound to the control it concerns with
//      aria-describedby and aria-invalid, and repeated once in the step's own
//      polite region so a change is announced rather than only redrawn.
//   3. Nothing is signalled by tint alone: proposed, unset, and blocked each
//      ship a word.

import {
  IGNORED_TARGET, IMPORT_KINDS, MAPPING_TARGETS, columnIssue, mappingIssues, mappingSummary,
} from "./import-column-mapping.js";

const ORIGIN_WORD = Object.freeze({
  detected: "Auto-detected",
  // Distinct from "auto-detected" on purpose: this column was not guessed from
  // an alias list, it is the column the export itself is grouped by.
  native: "From your export's own grouping",
  chosen: "Your choice",
  unset: "Not detected",
});

function byId(doc, id) {
  return doc?.getElementById ? doc.getElementById(id) : null;
}

function textNode(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cell(doc, tag, className, label) {
  const node = textNode(doc, tag, className);
  // The stacked narrow layout draws this label from the attribute; it is one of
  // four fixed words chosen here, never anything read out of the file.
  if (label) node.dataset.label = label;
  return node;
}

/** One `<option>` per target in the kind's vocabulary, plus the explicit ignore. */
function targetOptions(doc, state, column) {
  const options = [textNode(doc, "option", undefined, "Ignore this column")];
  options[0].setAttribute("value", IGNORED_TARGET);
  for (const entry of MAPPING_TARGETS[state.kind] ?? []) {
    const option = textNode(doc, "option", undefined,
      entry.required ? `${entry.label} (required)` : entry.label);
    option.setAttribute("value", entry.field);
    options.push(option);
  }
  for (const option of options) {
    if (option.getAttribute("value") === column.target) option.setAttribute("selected", "selected");
  }
  return options;
}

function issueList(doc, id, issues, { heading, tone }) {
  const section = byId(doc, id);
  if (!section) return;
  section.hidden = issues.length === 0;
  section.dataset.count = String(issues.length);
  if (!issues.length) {
    section.replaceChildren();
    return;
  }
  const list = doc.createElement("ul");
  list.className = "import-mapping-issue-list";
  list.replaceChildren(...issues.map((issue) => {
    const item = doc.createElement("li");
    item.className = "import-mapping-issue";
    item.dataset.tone = tone;
    item.dataset.code = issue.code;
    const shape = textNode(doc, "span", "issue-shape", tone === "blocker" ? "!" : "○");
    shape.setAttribute("aria-hidden", "true");
    item.append(
      shape,
      textNode(doc, "strong", "issue-message", issue.message),
      textNode(doc, "span", "issue-consequence", issue.consequence),
    );
    return item;
  }));
  section.replaceChildren(textNode(doc, "h4", "import-mapping-issue-heading", heading), list);
}

/**
 * Paint the whole step from one state.
 *
 * `onChange(nextState)` fires for every correction — the caller owns the state
 * and repaints, so the surface never holds an opinion the model has not seen.
 */
export function renderMappingReview(doc, state, {
  onTarget, onKind, onConfirm, onCancel,
} = {}) {
  const section = byId(doc, "import-mapping");
  if (!section) return null;
  const issues = mappingIssues(state);
  const summary = mappingSummary(state, issues);

  section.hidden = false;
  section.dataset.detected = state.shapeId ? "profile" : "none";

  const fileNode = byId(doc, "import-mapping-file");
  if (fileNode) {
    fileNode.textContent = state.fileName;
    fileNode.title = state.fileName;
  }
  const summaryNode = byId(doc, "import-mapping-summary");
  if (summaryNode) {
    summaryNode.replaceChildren(
      textNode(doc, "span", "import-mapping-source", summary.source),
      // The grouping sentence sits between the shape and the outcome because it
      // answers the question the reader actually has — "how will my spend be
      // split up?" — and it is omitted rather than emptied when there is nothing
      // to say, so an empty element never occupies the line.
      ...(summary.grouping
        ? [textNode(doc, "span", "import-mapping-grouping", summary.grouping)] : []),
      textNode(doc, "span", "import-mapping-outcome", summary.outcome),
    );
  }

  renderKindChoice(doc, state, onKind);
  renderRows(doc, state, issues, onTarget);

  issueList(doc, "import-mapping-blockers", issues.blockers, {
    heading: "Resolve before the analysis can run", tone: "blocker",
  });
  issueList(doc, "import-mapping-warnings", issues.warnings, {
    heading: "You can continue; here is what the analysis will not have", tone: "warning",
  });

  const confirm = byId(doc, "import-mapping-confirm");
  if (confirm) {
    confirm.disabled = !issues.confirmable;
    confirm.setAttribute("aria-describedby", "import-mapping-status");
    if (!confirm.dataset.bound) {
      confirm.dataset.bound = "true";
      confirm.addEventListener("click", () => onConfirm?.());
    }
  }
  const cancel = byId(doc, "import-mapping-cancel");
  if (cancel && !cancel.dataset.bound) {
    cancel.dataset.bound = "true";
    cancel.addEventListener("click", () => onCancel?.());
  }
  announceMapping(doc, summary.outcome);
  return { state, issues, summary };
}

function renderKindChoice(doc, state, onKind) {
  const select = byId(doc, "import-mapping-kind-select");
  if (!select) return;
  select.replaceChildren(...IMPORT_KINDS.map((kind) => {
    const option = textNode(doc, "option", undefined, kind.label);
    option.setAttribute("value", kind.id);
    if (kind.id === state.kind) option.setAttribute("selected", "selected");
    return option;
  }));
  select.value = state.kind;
  select.dataset.origin = state.kindOrigin;
  if (!select.dataset.bound) {
    select.dataset.bound = "true";
    select.addEventListener("change", () => onKind?.(select.value));
  }
  const note = byId(doc, "import-mapping-kind-note");
  if (note) {
    note.textContent = state.kindOrigin === "detected"
      ? `Auto-detected from the header row: ${state.shapeLabel}. Correct it if it is wrong.`
      : "No export shape was recognized, so this is a starting guess. Correct it if it is wrong.";
  }
}

function renderRows(doc, state, issues, onTarget) {
  const body = byId(doc, "import-mapping-rows");
  if (!body) return;
  const caption = byId(doc, "import-mapping-caption");
  if (caption) {
    caption.textContent = `${state.columns.length} column${state.columns.length === 1 ? "" : "s"} in `
      + `file order, with one real value from your own data. `
      + `${state.dataRowCount} data row${state.dataRowCount === 1 ? "" : "s"} were read.`;
  }
  body.replaceChildren(...state.columns.map((column) => {
    const row = doc.createElement("tr");
    row.className = "import-mapping-row";
    row.dataset.column = String(column.index);
    row.dataset.origin = column.origin;

    const issue = columnIssue(state, column.index, issues);
    const headerId = `import-mapping-column-${column.index}`;
    const messageId = `import-mapping-message-${column.index}`;
    const selectId = `import-mapping-target-${column.index}`;

    const head = cell(doc, "th", "import-mapping-column", "Your column");
    head.setAttribute("scope", "row");
    head.id = headerId;
    const name = textNode(doc, "span", "import-mapping-column-name", column.label);
    // The full header stays reachable when the cell has to wrap or clip, and it
    // is an attribute value: a hostile header is a hostile string, not markup.
    name.title = column.header || column.label;
    head.append(
      textNode(doc, "span", "import-mapping-column-index", `Column ${column.index + 1}`),
      name,
    );
    if (column.blankHeader) head.append(textNode(doc, "span", "import-mapping-column-note", "Blank header"));

    const targetCell = cell(doc, "td", "import-mapping-target", "Becomes");
    const select = doc.createElement("select");
    select.id = selectId;
    select.className = "import-mapping-select";
    // Identity first: the name says which column this control belongs to, so a
    // reader tabbing through twelve of them is never told only "Map to".
    select.setAttribute("aria-label", `Column ${column.index + 1} “${column.label}” becomes`);
    select.setAttribute("aria-describedby", issue ? messageId : `import-mapping-sample-${column.index}`);
    select.setAttribute("aria-invalid", issue ? "true" : "false");
    select.replaceChildren(...targetOptions(doc, state, column));
    select.value = column.target;
    select.addEventListener("change", () => onTarget?.(column.index, select.value));
    const message = textNode(doc, "p", "import-mapping-message", issue ? issue.message : "");
    message.id = messageId;
    message.hidden = !issue;
    targetCell.append(select, message);

    const originCell = cell(doc, "td", "import-mapping-origin", "Proposal");
    originCell.append(
      textNode(doc, "span", "import-mapping-origin-word", ORIGIN_WORD[column.origin] ?? ORIGIN_WORD.unset),
    );

    const sampleCell = cell(doc, "td", "import-mapping-sample", "Sample from your file");
    sampleCell.id = `import-mapping-sample-${column.index}`;
    if (column.sample.available) {
      const value = textNode(doc, "span", "import-mapping-sample-value", column.sample.display);
      value.title = column.sample.value;
      sampleCell.append(value);
      if (column.sample.truncated)
        sampleCell.append(textNode(doc, "span", "import-mapping-sample-note", "Shortened for display"));
    } else {
      sampleCell.append(textNode(doc, "span", "import-mapping-sample-empty", column.sample.note));
    }

    row.append(head, targetCell, originCell, sampleCell);
    return row;
  }));
}

/** One polite line per correction, in the step's own region. */
export function announceMapping(doc, text) {
  const status = byId(doc, "import-mapping-status");
  if (!status) return null;
  status.textContent = text;
  return text;
}

/**
 * Enter the step: show it, and move focus to its heading so the reader is told
 * where they now are rather than left on the file input behind it.
 */
export function focusMappingReview(doc) {
  const heading = byId(doc, "import-mapping-title");
  heading?.focus?.();
  return heading;
}

/** Leave the step: hide it and clear its live region so nothing is read twice. */
export function closeMappingReview(doc) {
  const section = byId(doc, "import-mapping");
  if (section) section.hidden = true;
  const status = byId(doc, "import-mapping-status");
  if (status) status.textContent = "";
  const body = byId(doc, "import-mapping-rows");
  // The reader's headers and sample values do not outlive the step they were
  // shown in; nothing was written down, so leaving is enough to discard them.
  if (body) body.replaceChildren();
  return section;
}
