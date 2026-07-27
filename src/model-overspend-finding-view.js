// The reading surface for `model-overspend-finding/1.0.0`.
//
// The contract (docs/model-overspend-finding-contract.md) is deliberate about
// what a leader is shown first: one question, one number, one action, and the
// per-model rows marked `disclosure: "progressive"` — what they open *second*.
// This view holds that order. The first screen is the sentence and the money;
// the table is behind a closed disclosure.
//
// It takes the document rather than reading a global, exactly like
// `import-mapping-view.js`, so a test drives the shipped markup of
// evolution.html instead of a fixture authored for the test. Every node is built
// with createElement and textContent: an org-unit name or a model identifier out
// of a customer's export is a string in a cell and nothing else.
//
// Four rules this surface holds:
//
//   1. **The rows reconcile with the headline.** The delta column shows what is
//      counted toward *this* finding, the total in `<tfoot>` is formatted from
//      the same minor-unit value the headline metric uses, and a row that is not
//      counted says so in words with its own estimate alongside. A table whose
//      column does not add up to the number above it teaches a leader to
//      distrust both.
//   2. **Nothing is signalled by tint alone.** Status and confidence each ship a
//      shape and a word.
//   3. **A withheld number is a sentence, never a zero.** Degraded and
//      unavailable findings render the contract's own reason text where the
//      figure would have been.
//   4. **Org-unit identity comes from one lookup.** Every place a unit is drawn
//      goes through `org-unit-labels.js`, so a rename applies to all of them.

import {
  applyOrgUnitLabelsToText, clearOrgUnitLabels, orgUnitDisplay, readOrgUnitLabels,
  renderOrgUnit, writeOrgUnitLabel, MAX_ORG_UNIT_LABEL_LENGTH,
} from "./org-unit-labels.js";

const SECTION_ID = "model-overspend";
const PANEL_ID = "model-overspend-evidence-panel";
const TOGGLE_ID = "model-overspend-evidence-toggle";
const RENAME_INPUT_ID = "model-overspend-rename-input";

/** What each contract status is called in words, next to its own shape. */
const STATUS_WORD = Object.freeze({
  ok: { shape: "●", text: "Complete result" },
  degraded_single_period: { shape: "◐", text: "Partial result — one period only" },
  degraded_no_request_counts: { shape: "◐", text: "Partial result — no request counts" },
  degraded_unrecognized_models: { shape: "◐", text: "Partial result — unrecognized models" },
  unavailable: { shape: "○", text: "No overspend metric available" },
});

const CONFIDENCE_SHAPE = Object.freeze({ high: "●", medium: "◆", low: "▲" });

// The contract's own money formatting, so the total under the table and the
// number in the headline are the same string produced the same way. Minor units
// are the source everywhere; rounding happens once, here, at display time.
const usd = (minor) => Math.round(minor) / 100;
const money = (minor) => `${usd(minor).toFixed(2)} USD`;
const requests = (value) => Number(value).toLocaleString("en-US");

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function numericCell(doc, tag, className) {
  const node = element(doc, tag, className ? `${className} numeric` : "numeric");
  return node;
}

/** A `<caption>`/label string kept off screen but in the accessibility tree. */
function hidden(doc, tag, text) {
  return element(doc, tag, "visually-hidden", text);
}

// --- mounted state ---------------------------------------------------------
// Held on the section node so two documents in one test run cannot share it, and
// so a repaint can read back what the reader had open without a module global.

function state(section) {
  if (!section.__modelOverspend) section.__modelOverspend = { finding: null, storage: null };
  return section.__modelOverspend;
}

/**
 * Paint the finding into the shipped markup.
 *
 * `storage` is this browser's `localStorage` (or a stand-in): the only place
 * org-unit labels live. Nothing here reads or writes anything else.
 */
export function renderModelOverspendFinding(doc, finding, { storage = null } = {}) {
  const section = byId(doc, SECTION_ID);
  if (!section || !finding) return null;
  const mounted = state(section);
  mounted.finding = finding;
  mounted.storage = storage;
  if (section.dataset.expanded !== "true") section.dataset.expanded = "false";
  section.hidden = false;
  paint(doc, section);
  return section;
}

/**
 * Leave the surface: hide it, drop the finding, and clear this browser's
 * org-unit labels.
 *
 * This is called from the page's existing "clear the analysis" control rather
 * than from a second reset button of its own — one reset means one mental model
 * of what "start over" throws away.
 */
export function clearModelOverspendFinding(doc, { storage = null } = {}) {
  const section = byId(doc, SECTION_ID);
  clearOrgUnitLabels(storage);
  if (!section) return null;
  const mounted = state(section);
  mounted.finding = null;
  section.hidden = true;
  section.dataset.status = "unavailable";
  section.dataset.expanded = "false";
  delete section.dataset.editing;
  const body = byId(doc, "model-overspend-body");
  if (body) body.replaceChildren();
  const question = byId(doc, "model-overspend-question");
  if (question) question.textContent = "—";
  announce(doc, "");
  return section;
}

/** One polite line per commit, in this panel's own region. */
export function announce(doc, text) {
  const live = byId(doc, "model-overspend-live");
  if (!live) return null;
  live.textContent = text;
  return text;
}

// --- painting --------------------------------------------------------------

function paint(doc, section) {
  const mounted = state(section);
  const finding = mounted.finding;
  const body = byId(doc, "model-overspend-body");
  if (!finding || !body) return;
  const labels = readOrgUnitLabels(mounted.storage);
  // Every org unit this payload names, in one list, so contract-composed prose
  // can be re-labelled with the same aliases the table cells use.
  const units = orgUnits(finding);
  const expanded = section.dataset.expanded === "true";

  section.dataset.status = finding.status;
  const question = byId(doc, "model-overspend-question");
  if (question) question.textContent = finding.question;

  const pieces = [
    statusLine(doc, finding),
    element(doc, "p", "model-overspend-headline",
      applyOrgUnitLabelsToText(finding.headline, labels, units)),
    metricBlock(doc, section, finding, labels, units),
    actionBlock(doc, finding, labels, units),
    confidenceBlock(doc, finding),
    benchmarkBlock(doc, finding),
    provenanceBlock(doc, finding, labels),
    disclosure(doc, section, finding, labels, expanded),
  ];
  body.replaceChildren(...pieces.filter(Boolean));

  const focusId = section.dataset.focusTarget;
  if (focusId) {
    delete section.dataset.focusTarget;
    byId(doc, focusId)?.focus?.();
  }
}

function statusLine(doc, finding) {
  const word = STATUS_WORD[finding.status] ?? STATUS_WORD.unavailable;
  const line = element(doc, "p", "model-overspend-state");
  line.dataset.status = finding.status;
  const shape = element(doc, "span", "status-shape", word.shape);
  shape.setAttribute("aria-hidden", "true");
  line.append(shape, element(doc, "span", "model-overspend-state-word", word.text));
  return line;
}

/** The one number, or the contract's sentence about why there is not one. */
function metricBlock(doc, section, finding, labels, units) {
  const metric = finding.metric;
  const block = element(doc, "div", "model-overspend-metric");
  block.dataset.available = metric.available ? "true" : "false";
  if (metric.available) {
    block.append(
      element(doc, "p", "model-overspend-metric-label", "Estimated monthly overspend"),
      element(doc, "p", "model-overspend-metric-value", money(metric.amountMinor)),
    );
    const where = element(doc, "p", "model-overspend-metric-where");
    where.append(element(doc, "span", "model-overspend-metric-model", metric.model));
    where.append(element(doc, "span", "model-overspend-metric-sep", " in "));
    // Render site: the headline. The rename control lives here too, so a leader
    // never has to open the evidence table to fix a name they cannot read.
    where.append(...orgUnitSite(doc, section,
      orgUnitDisplay(labels, metric.segmentId, metric.segmentLabel), "headline", true));
    where.append(element(doc, "span", "model-overspend-metric-sep", ` · ${metric.period}`));
    block.append(where);
  } else {
    block.append(
      element(doc, "p", "model-overspend-metric-label", "Estimated monthly overspend"),
      // The withheld figure is a sentence. A degraded finding that printed
      // "0.00 USD" here would read as "nothing to save", which is a different
      // and false claim from "this file cannot answer it".
      element(doc, "p", "model-overspend-metric-withheld", "Not available"),
      element(doc, "p", "model-overspend-metric-reason",
        applyOrgUnitLabelsToText(metric.reason, labels, units)),
    );
    if (metric.segmentId) {
      const where = element(doc, "p", "model-overspend-metric-where");
      where.append(element(doc, "span", "model-overspend-metric-label-inline",
        "Largest block of spend in "));
      where.append(...orgUnitSite(doc, section,
        orgUnitDisplay(labels, metric.segmentId, metric.segmentLabel), "headline", true));
      if (metric.observedSpendMinor !== null) {
        where.append(element(doc, "span", "model-overspend-metric-observed",
          ` — ${money(metric.observedSpendMinor)}${metric.model ? ` on ${metric.model}` : ""}`));
      }
      block.append(where);
    }
  }
  return block;
}

function actionBlock(doc, finding, labels, units) {
  const action = finding.action;
  const block = element(doc, "p", "model-overspend-action");
  block.dataset.available = action.available ? "true" : "false";
  block.append(element(doc, "span", "model-overspend-action-label",
    action.available ? "Do this next" : "Why there is no action yet"));
  block.append(element(doc, "span", "model-overspend-action-text",
    applyOrgUnitLabelsToText(action.available ? action.text : action.reason, labels, units)));
  return block;
}

/**
 * Confidence and, when it is not `high`, the reasons — in view, in words, on the
 * first screen. A reader must never have to open something to find out why a
 * number is being qualified.
 */
function confidenceBlock(doc, finding) {
  const { level, reasons } = finding.confidence;
  const block = element(doc, "div", "model-overspend-confidence");
  block.dataset.level = level;
  const line = element(doc, "p", "model-overspend-confidence-line");
  const shape = element(doc, "span", "status-shape", CONFIDENCE_SHAPE[level] ?? "◆");
  shape.setAttribute("aria-hidden", "true");
  line.append(shape, element(doc, "span", "model-overspend-confidence-label",
    `Confidence: ${level}`));
  block.append(line);
  if (!reasons.length) {
    block.append(element(doc, "p", "model-overspend-confidence-reason",
      "Nothing in this file lowered it."));
    return block;
  }
  const list = element(doc, "ul", "model-overspend-confidence-reasons");
  list.setAttribute("aria-label", "What lowered the confidence in this finding");
  for (const reason of reasons) {
    const item = element(doc, "li", "model-overspend-confidence-reason");
    item.dataset.code = reason.code;
    item.append(
      element(doc, "span", "model-overspend-confidence-detail", reason.detail),
      element(doc, "span", "model-overspend-confidence-effect", `Confidence ${reason.effect}.`),
    );
    list.append(item);
  }
  block.append(list);
  return block;
}

/**
 * The contract carries exactly one benchmark and scopes it `intra_tenant`. The
 * scope ships with the number, because a cost-per-request comparison a reader
 * mistakes for an industry figure is worse than no comparison.
 */
function benchmarkBlock(doc, finding) {
  const benchmark = finding.benchmark;
  const block = element(doc, "p", "model-overspend-benchmark");
  block.dataset.available = benchmark.available ? "true" : "false";
  block.dataset.scope = benchmark.scope;
  block.append(element(doc, "span", "model-overspend-benchmark-label",
    "Against this organization's own segments"));
  block.append(element(doc, "span", "model-overspend-benchmark-text", benchmark.available
    ? `${money(benchmark.segmentCostPerRequestMinor)} per request here, against `
      + `${money(benchmark.otherSegmentsCostPerRequestMinor)} across `
      + `${benchmark.otherSegments} other segment${benchmark.otherSegments === 1 ? "" : "s"} `
      + `on ${benchmark.model}. No peer or industry comparison exists in this file.`
    : benchmark.reason));
  return block;
}

/** Where the numbers came from: the reader's own column names and row counts. */
function provenanceBlock(doc, finding, labels) {
  const provenance = finding.provenance;
  const block = element(doc, "div", "model-overspend-provenance");
  block.append(element(doc, "p", "model-overspend-provenance-label", "Where this came from"));
  const list = element(doc, "ul", "model-overspend-provenance-list");
  list.setAttribute("aria-label", "Provenance of this finding");
  const columns = Object.entries(provenance.columns)
    .map(([field, name]) => `${field}: ${name ?? "not mapped"}`).join(" · ");
  const items = [
    `Your columns — ${columns}`,
    `Periods read — ${provenance.periods.join(", ") || "none"}; reporting on `
      + `${provenance.reportingPeriod ?? "no period"}`,
    `${requests(provenance.sourceRowCount)} source rows became `
      + `${requests(provenance.analysisRowCount)} analysis rows`,
  ];
  for (const text of items) list.append(element(doc, "li", undefined, text));
  const proration = element(doc, "li", "model-overspend-proration");
  if (!provenance.proration.prorated) {
    proration.textContent = "No month was prorated.";
  } else {
    proration.append(element(doc, "span", undefined,
      `${provenance.proration.months.length} partial month`
      + `${provenance.proration.months.length === 1 ? " was" : "s were"} scaled to a whole one:`));
    const months = element(doc, "ul", "model-overspend-proration-months");
    for (const month of provenance.proration.months) {
      const item = element(doc, "li");
      item.append(
        element(doc, "span", "model-overspend-proration-model", month.model),
        element(doc, "span", "model-overspend-proration-sep", " in "),
        // Render site: proration provenance. Same lookup as every other one.
        renderOrgUnit(doc, orgUnitDisplay(labels, month.segmentId, null)),
        element(doc, "span", "model-overspend-proration-days",
          ` — ${month.observedDays} of ${month.daysInPeriod} days observed`),
      );
      months.append(item);
    }
    proration.append(months);
  }
  list.append(proration);
  block.append(list);
  return block;
}

// --- progressive disclosure -------------------------------------------------

/**
 * Collapsed by default, always. The contract marks the per-model rows
 * `disclosure: "progressive"`, and this is the whole of what that means: a
 * button that owns its panel, says whether it is open, and starts closed.
 */
function disclosure(doc, section, finding, labels, expanded) {
  const wrap = element(doc, "div", "model-overspend-evidence");
  const toggle = element(doc, "button", "model-overspend-evidence-toggle");
  toggle.id = TOGGLE_ID;
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", PANEL_ID);
  const rowCount = finding.evidence.rows.length;
  toggle.textContent = `${expanded ? "Hide" : "Show"} the per-model evidence `
    + `(${rowCount} row${rowCount === 1 ? "" : "s"})`;
  toggle.addEventListener("click", () => {
    section.dataset.expanded = expanded ? "false" : "true";
    section.dataset.focusTarget = TOGGLE_ID;
    paint(doc, section);
  });

  const panel = element(doc, "div", "model-overspend-evidence-panel");
  panel.id = PANEL_ID;
  panel.hidden = !expanded;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Per-model evidence behind this finding");
  if (expanded) {
    panel.append(
      element(doc, "p", "model-overspend-evidence-note", finding.evidence.note),
      scroller(doc, evidenceTable(doc, section, finding, labels)),
      ...unattributed(doc, finding, labels),
    );
  }
  wrap.append(toggle, panel);
  return wrap;
}

/**
 * A narrow window scrolls the table sideways rather than pushing the page out.
 * The scroll container is focusable and named, because a scroll region a
 * keyboard has no way to reach is a region a keyboard user cannot read.
 */
function scroller(doc, table) {
  const box = element(doc, "div", "model-overspend-scroll");
  box.setAttribute("tabindex", "0");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Per-model evidence table, scrolls sideways on narrow screens");
  box.append(table);
  return box;
}

const COLUMNS = Object.freeze([
  { key: "model", label: "Model", numeric: false },
  { key: "orgUnit", label: "Org unit", numeric: false },
  { key: "requests", label: "Calls", numeric: true },
  { key: "spend", label: "Current spend", numeric: true },
  { key: "candidate", label: "Proposed tier", numeric: false },
  { key: "delta", label: "Counted toward this finding", numeric: true },
]);

function evidenceTable(doc, section, finding, labels) {
  const table = element(doc, "table", "model-overspend-table");
  table.append(hidden(doc, "caption",
    "Per-model rows behind the finding: calls, current spend, the cheaper tier proposed for "
    + "each, and what each row contributes to the headline saving. Only the row the headline "
    + "names is counted; the total below equals the headline figure."));

  const headRow = element(doc, "tr");
  for (const column of COLUMNS) {
    const cell = element(doc, "th", column.numeric ? "numeric" : undefined, column.label);
    cell.setAttribute("scope", "col");
    headRow.append(cell);
  }
  const head = element(doc, "thead");
  head.append(headRow);

  const seen = new Set();
  const bodyRows = finding.evidence.rows.map((row, index) => {
    const tr = element(doc, "tr", "model-overspend-row");
    tr.dataset.headline = row.isHeadline ? "true" : "false";

    const model = element(doc, "th", "model-overspend-cell-model", row.model);
    model.setAttribute("scope", "row");

    const unit = element(doc, "td", "model-overspend-cell-unit");
    const display = orgUnitDisplay(labels, row.segmentId, row.segmentLabel);
    // Render site: the evidence table. One rename control per distinct unit, on
    // its first row, so a leader is not offered the same edit four times.
    const offerRename = row.segmentId && !seen.has(row.segmentId);
    if (row.segmentId) seen.add(row.segmentId);
    unit.append(...orgUnitSite(doc, section, display, `row-${index}`, offerRename));

    const calls = numericCell(doc, "td", "model-overspend-cell-calls");
    if (row.requests === null) {
      calls.append(element(doc, "span", "model-overspend-withheld", "—"),
        element(doc, "span", "model-overspend-cell-note", "No request count in this file"));
    } else {
      calls.textContent = requests(row.requests);
    }

    const spend = numericCell(doc, "td", "model-overspend-cell-spend");
    spend.textContent = money(row.spendMinor);

    const candidate = element(doc, "td", "model-overspend-cell-candidate");
    candidate.textContent = row.candidateModel ?? "—";

    const delta = numericCell(doc, "td", "model-overspend-cell-delta");
    delta.dataset.counted = row.isHeadline ? "true" : "false";
    if (row.isHeadline) {
      delta.append(element(doc, "span", "model-overspend-delta-value", money(row.overspendMinor)));
    } else {
      delta.append(element(doc, "span", "model-overspend-withheld", "—"));
      delta.append(element(doc, "span", "model-overspend-cell-note", row.excludedReason
        ?? `Not this month's headline finding; its own estimate is ${money(row.overspendMinor)}.`));
    }

    tr.append(model, unit, calls, spend, candidate, delta);
    return tr;
  });
  const body = element(doc, "tbody");
  if (bodyRows.length) body.append(...bodyRows);
  else {
    // A file whose model column is all placeholders ranks nothing. The table
    // says that in a row rather than leaving a headed, bodiless grid, and the
    // spend the file *does* show is listed as unattributed below it.
    const empty = element(doc, "tr", "model-overspend-empty");
    const cell = element(doc, "td", undefined,
      "No row in this month carries a model identifier this contract recognizes, so there is "
      + "nothing to rank. The spend that is present is listed below, unattributed.");
    cell.setAttribute("colspan", String(COLUMNS.length));
    empty.append(cell);
    body.append(empty);
  }
  table.append(head, body, footer(doc, finding));
  return table;
}

/**
 * The total, formatted from the same minor-unit value the headline metric is
 * formatted from, so the two can never disagree by a rounding step. When no
 * metric exists there is no total: the contract's reason goes in its place
 * rather than a zero that would read as "nothing to save".
 */
function footer(doc, finding) {
  const foot = element(doc, "tfoot");
  const row = element(doc, "tr", "model-overspend-total");
  const metric = finding.metric;
  if (!metric.available) {
    const cell = element(doc, "td", "model-overspend-total-withheld");
    cell.setAttribute("colspan", String(COLUMNS.length));
    cell.append(
      element(doc, "span", "model-overspend-total-label", "No total"),
      element(doc, "span", "model-overspend-total-reason", metric.reason),
    );
    row.append(cell);
    foot.append(row);
    return foot;
  }
  const counted = finding.evidence.rows.filter((entry) => entry.isHeadline)
    .reduce((total, entry) => total + entry.overspendMinor, 0);
  const label = element(doc, "th", "model-overspend-total-label", "Total counted toward this finding");
  label.setAttribute("scope", "row");
  label.setAttribute("colspan", String(COLUMNS.length - 1));
  const value = numericCell(doc, "td", "model-overspend-total-value");
  value.textContent = money(metric.amountMinor);
  row.append(label, value);
  foot.append(row);
  // Defensive, and visible if it ever fires: a total that silently disagreed
  // with the rows above it is exactly the bug this table exists to prevent.
  if (counted !== metric.amountMinor) {
    const note = element(doc, "tr", "model-overspend-total-mismatch");
    const cell = element(doc, "td", undefined,
      `The counted rows sum to ${money(counted)}, which is not the headline figure. `
      + "The headline value is shown; treat the row detail as unreconciled.");
    cell.setAttribute("colspan", String(COLUMNS.length));
    note.append(cell);
    foot.append(note);
  }
  return foot;
}

/** Spend that carries no recognizable model. Reported, never dropped. */
function unattributed(doc, finding, labels) {
  const rows = finding.evidence.unattributedRows;
  if (!rows.length) return [];
  const block = element(doc, "div", "model-overspend-unattributed");
  block.append(element(doc, "p", "model-overspend-unattributed-label",
    `${rows.length} row${rows.length === 1 ? "" : "s"} of spend carry no model this contract `
    + "recognizes, so they are outside the ranking above:"));
  const list = element(doc, "ul", "model-overspend-unattributed-list");
  for (const row of rows) {
    const item = element(doc, "li");
    // Render site: unattributed spend.
    item.append(
      renderOrgUnit(doc, orgUnitDisplay(labels, row.segmentId, row.segmentLabel)),
      element(doc, "span", "model-overspend-unattributed-spend", ` — ${money(row.spendMinor)}`),
      element(doc, "span", "model-overspend-unattributed-reason", ` — ${row.reason}`),
    );
    list.append(item);
  }
  block.append(list);
  return [block];
}

// --- renaming ---------------------------------------------------------------

/**
 * One org-unit render site: the shared chip, plus — where the surface offers it
 * — a named rename control, or the open editor when this is the unit being
 * renamed.
 *
 * The control is a real button in the tab order with its own accessible name
 * ("Rename org unit seg-atlas"), not a pencil that appears on hover. A hover
 * affordance is unreachable by keyboard and invisible on touch.
 */
function orgUnitSite(doc, section, display, siteKey, offerRename) {
  const chip = renderOrgUnit(doc, display);
  if (!offerRename || !display.id) return [chip];
  // The site as well as the unit: the same unit is drawn at the headline and in
  // the table, and only the site the reader actually activated becomes an
  // editor. Two editors would mean two controls sharing one id and one label.
  const editing = section.dataset.editing === display.id && section.dataset.editingSite === siteKey;
  const triggerId = `model-overspend-rename-${siteKey}`;
  if (!editing) {
    const trigger = element(doc, "button", "model-overspend-rename", "Rename");
    trigger.id = triggerId;
    trigger.setAttribute("type", "button");
    trigger.setAttribute("aria-label", `Rename org unit ${display.id}`);
    trigger.addEventListener("click", () => {
      section.dataset.editing = display.id;
      section.dataset.editingSite = siteKey;
      section.dataset.focusTarget = RENAME_INPUT_ID;
      paint(doc, section);
    });
    return [chip, trigger];
  }
  return [chip, renameEditor(doc, section, display, triggerId)];
}

function renameEditor(doc, section, display, triggerId) {
  const mounted = state(section);
  const box = element(doc, "span", "model-overspend-rename-editor");
  const label = hidden(doc, "label", `New label for org unit ${display.id}`);
  label.setAttribute("for", RENAME_INPUT_ID);
  const input = element(doc, "input", "model-overspend-rename-input");
  input.id = RENAME_INPUT_ID;
  input.setAttribute("type", "text");
  input.setAttribute("maxlength", String(MAX_ORG_UNIT_LABEL_LENGTH));
  input.setAttribute("aria-describedby", "model-overspend-rename-help");
  input.value = display.renamed ? display.label : "";
  const help = element(doc, "span", "model-overspend-rename-help",
    `Stays in this browser. Clear it to go back to ${display.id}.`);
  help.id = "model-overspend-rename-help";

  const finish = (next) => {
    mounted.storage = mounted.storage ?? null;
    writeOrgUnitLabel(mounted.storage, display.id, next);
    delete section.dataset.editing;
    delete section.dataset.editingSite;
    section.dataset.focusTarget = triggerId;
    paint(doc, section);
    const applied = next?.trim();
    announce(doc, applied
      ? `Org unit ${display.id} is now labelled ${applied} everywhere it appears.`
      : `Label cleared. Org unit ${display.id} shows its own identifier again.`);
  };
  const cancel = () => {
    delete section.dataset.editing;
    delete section.dataset.editingSite;
    section.dataset.focusTarget = triggerId;
    paint(doc, section);
    announce(doc, `Rename cancelled. Org unit ${display.id} is unchanged.`);
  };

  const save = element(doc, "button", "model-overspend-rename-save", "Save");
  save.setAttribute("type", "button");
  save.setAttribute("aria-label", `Save the label for org unit ${display.id}`);
  save.addEventListener("click", () => finish(input.value));
  const dismiss = element(doc, "button", "model-overspend-rename-cancel", "Cancel");
  dismiss.setAttribute("type", "button");
  dismiss.setAttribute("aria-label", `Cancel renaming org unit ${display.id}`);
  dismiss.addEventListener("click", cancel);

  // Enter commits and Escape abandons, both from inside the field, because a
  // reader who has just typed a name should not have to go looking for a button.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault?.();
      finish(input.value);
    } else if (event.key === "Escape") {
      event.preventDefault?.();
      cancel();
    }
  });

  box.append(label, input, save, dismiss, help);
  return box;
}

// --- org units in one payload ----------------------------------------------

/** Every org unit this finding names, deduplicated, id first seen wins. */
export function orgUnits(finding) {
  const units = new Map();
  const add = (id, analysisLabel) => {
    if (typeof id !== "string" || !id) return;
    if (!units.has(id)) units.set(id, { id, analysisLabel: analysisLabel ?? null });
    else if (!units.get(id).analysisLabel && analysisLabel) units.get(id).analysisLabel = analysisLabel;
  };
  add(finding?.metric?.segmentId, finding?.metric?.segmentLabel);
  for (const row of finding?.evidence?.rows ?? []) add(row.segmentId, row.segmentLabel);
  for (const row of finding?.evidence?.unattributedRows ?? []) add(row.segmentId, row.segmentLabel);
  for (const month of finding?.provenance?.proration?.months ?? []) add(month.segmentId, null);
  return [...units.values()];
}
