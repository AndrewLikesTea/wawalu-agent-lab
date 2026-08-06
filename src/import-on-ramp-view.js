// The one-question on-ramp on the surface (#1169): the chooser, the answer it
// reveals, and the supporting detail that folds away.
//
// PLACEMENT IS THE POINT, so it is built in rather than asserted after the
// fact. The answer region is a direct child of the section and is NEVER put
// inside a details element: a polite live region folded into a collapsed
// disclosure is not announced in a real browser, whatever a test harness reads
// through it. What DOES fold is the material a reader consults after a refusal
// rather than before an errand — the full column list, the second file the
// headline figure needs, and the providers this reader did not choose.
//
// Priority order inside the answer is the reading order: the report to pull,
// then the files that start it, then exactly ONE next action. The action is the
// only filled control in the region; the downloads are outline controls beside
// it, so a reader is never asked to choose between three equal buttons.
//
// Slots only. Every provider name, report, column and console path is painted
// from import-on-ramp.js, and every class here already ships on this page — no
// rule was added to either stylesheet for this panel.

import {
  IMPORT_ON_RAMP_CHOICES, IMPORT_ON_RAMP_EMPTY, IMPORT_ON_RAMP_UNCHOSEN,
  onRampAlternatives, onRampChoiceFor, onRampTemplateText, TEMPLATE_MEDIA_TYPE,
} from "./import-on-ramp.js";
import { serializeProviderSample } from "./provider-readiness-contract.js";

export const ON_RAMP_SELECT_ID = "import-on-ramp-provider";
export const ON_RAMP_ANSWER_ID = "import-on-ramp-answer";
export const ON_RAMP_DETAIL_ID = "import-on-ramp-detail";
export const ON_RAMP_ACTION_ID = "import-on-ramp-action";

/** The page's blob writer, kept from the mount for the deferred control. */
let downloadFile = null;

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function keyed(doc, key, value) {
  const line = element(doc, "p", "provider-readiness-where");
  line.append(element(doc, "span", "provider-readiness-key", key),
    doc.createTextNode(value));
  return line;
}

function downloadButton(doc, label, dataset) {
  const button = element(doc, "button", "provider-readiness-download", label);
  button.setAttribute("type", "button");
  for (const [key, value] of Object.entries(dataset)) button.dataset[key] = value;
  return button;
}

function columnChips(doc, columns) {
  const line = element(doc, "p", "provider-readiness-columns");
  line.dataset.kind = "required";
  line.append(element(doc, "span", "provider-readiness-key", "Columns read"));
  for (const column of columns) line.append(element(doc, "code", null, column));
  return line;
}

function disclosure(doc, id, summary, ...body) {
  const detail = doc.createElement("details");
  detail.id = id;
  detail.append(element(doc, "summary", null, summary), ...body);
  return detail;
}

/** The answer: report first, then the files that start it, then one action. */
function answerFor(doc, choice) {
  const card = element(doc, "div", "provider-readiness-item");
  card.dataset.adapter = choice.adapter;
  const name = element(doc, "p", "import-slot-label", `${choice.label} · `);
  name.append(element(doc, "span", "import-slot-state", choice.question));
  card.append(name,
    keyed(doc, "Pull this one report", choice.report),
    keyed(doc, "Where it lives", choice.consolePath));
  // Starting files: the header template every choice has, plus the filled
  // one-row sample for the providers whose recognition source publishes one.
  card.append(downloadButton(doc,
    `Download the ${choice.label} column template (CSV)`, { template: choice.adapter }));
  for (const sample of choice.samples) {
    card.append(downloadButton(doc,
      `Download a one-row ${sample.format.toUpperCase()} sample · ${sample.displayName}`,
      { sample: sample.id }));
  }
  // The worked sample and its figure (#1167), fetched on demand: rows a reader
  // meets only after choosing a provider are not worth a byte of first paint.
  import("./import-worked-sample-view.js")
    .then((view) => view.appendWorkedSample(doc, card, choice.adapter, downloadFile));
  // The one next action, and the only filled control in this region.
  const action = element(doc, "div", "provider-readiness-item");
  action.append(keyed(doc, "Do this next", choice.nextAction.detail));
  const button = element(doc, "button", "local-export-primary", choice.nextAction.label);
  button.setAttribute("type", "button");
  button.setAttribute("id", ON_RAMP_ACTION_ID);
  action.append(button);
  return [card, action];
}

/** What a reader consults after a refusal, not before the errand. */
function detailFor(doc, choice) {
  return [
    disclosure(doc, "import-on-ramp-columns",
      `Every column this report must carry · ${choice.label}`,
      keyed(doc, "Unit each row counts toward", choice.grouping),
      columnChips(doc, choice.columns)),
    disclosure(doc, "import-on-ramp-second-input",
      "The second file the headline figure needs",
      keyed(doc, choice.secondInput.label, choice.secondInput.report),
      keyed(doc, "It answers", choice.secondInput.question)),
    disclosure(doc, "import-on-ramp-alternates",
      "Other providers this page reads",
      ...onRampAlternatives(choice.adapter).map((other) => keyed(doc, other.label, other.report))),
  ];
}

/**
 * Paint the answer for a chosen adapter id, or the unchosen empty state.
 *
 * Returns whether a provider is now chosen, so a caller cannot report a choice
 * the region did not paint.
 */
export function renderImportOnRamp(doc, adapterId) {
  const answer = doc.getElementById(ON_RAMP_ANSWER_ID);
  const detail = doc.getElementById(ON_RAMP_DETAIL_ID);
  if (!answer || !detail) return false;
  const choice = onRampChoiceFor(adapterId);
  answer.dataset.adapter = choice ? choice.adapter : "none";
  answer.dataset.state = choice ? "chosen" : "empty";
  if (!choice) {
    answer.replaceChildren(element(doc, "p", "import-slot-unlocks", IMPORT_ON_RAMP_EMPTY));
    detail.replaceChildren();
    detail.hidden = true;
    return false;
  }
  answer.replaceChildren(...answerFor(doc, choice));
  detail.replaceChildren(...detailFor(doc, choice));
  detail.hidden = false;
  return true;
}

/**
 * Fill the chooser, bind it, and paint the unchosen state.
 *
 * `download` is the page's own local blob writer and `onNextAction` its own
 * picker: this module opens no file dialog and creates no Blob of its own, so
 * there is still exactly one download path and one import affordance on the
 * page.
 */
export function mountImportOnRamp(doc, { download, onNextAction }) {
  const select = doc.getElementById(ON_RAMP_SELECT_ID);
  const answer = doc.getElementById(ON_RAMP_ANSWER_ID);
  if (!select || !answer) return false;
  downloadFile = download;
  const unchosen = doc.createElement("option");
  unchosen.value = "";
  unchosen.textContent = IMPORT_ON_RAMP_UNCHOSEN;
  select.replaceChildren(unchosen, ...IMPORT_ON_RAMP_CHOICES.map((choice) => {
    const option = doc.createElement("option");
    option.value = choice.adapter;
    option.textContent = choice.label;
    return option;
  }));
  select.value = "";
  select.addEventListener("change", () => renderImportOnRamp(doc, select.value));
  // One delegated handler rather than three per choice: the region is repainted
  // on every change, and a file is generated only when a reader asks for one.
  answer.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (!button) return;
    if (button.getAttribute("id") === ON_RAMP_ACTION_ID) {
      onNextAction?.();
      return;
    }
    const choice = onRampChoiceFor(button.dataset.template ?? select.value);
    if (button.dataset.template && choice) {
      download(onRampTemplateText(choice), TEMPLATE_MEDIA_TYPE, choice.templateFilename);
      return;
    }
    const sample = choice?.samples.find((entry) => entry.id === button.dataset.sample);
    if (sample) download(serializeProviderSample(sample.id), sample.mediaType, sample.filename);
  });
  renderImportOnRamp(doc, "");
  return true;
}
