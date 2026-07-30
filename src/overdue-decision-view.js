// Renders the overdue-decision finding (issue #622).
//
// One panel, three states, and no decisions of its own: overdue-decision.js
// chose the record and wrote the copy, this module only puts it on screen.
//
// ACCESSIBILITY, DELIBERATELY
// ---------------------------
// * The panel is a labelled `section`, so it is a landmark a screen reader can
//   jump to and it is announced with its own heading rather than as loose text
//   above the filters.
// * The one action is a real anchor with an href, so it is in the Tab order,
//   Enter activates it, and it can be opened in a new tab — nothing here
//   simulates a link with a click handler.
// * Its accessible name carries the decision title (the visible label stays
//   short) and it is described by the sentence saying where it goes.
// * The state is carried by words — the heading, the lead, the status word in
//   the badge — never by the border colour alone.
// * It is NOT a live region. The finding is painted on arrival and only ever
//   changes when the visitor records a decision, which the recorder's own
//   status line already announces; re-reading a whole panel over somebody's
//   typing would interrupt them for something they are not looking at.

import { OVERDUE_FINDING_KINDS } from "./overdue-decision.js";

const HEADING_ID = "overdue-decision-heading";
const TARGET_ID = "overdue-decision-target";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(iso) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

// Same label/value pair shape the history rows use, so the two read as one
// system and the meta row inherits their wrapping behaviour at narrow widths.
function appendMeta(parent, item) {
  const pair = el("span", `meta-pair ${item.badge ?? ""}`.trim());
  pair.append(el("span", "meta-label", `${item.label}:`));
  if (item.kind === "date") {
    const time = el("time", "meta-value", formatDate(item.value));
    time.dateTime = item.value;
    pair.append(time);
  } else {
    pair.append(el("span", "meta-value", item.value));
  }
  parent.append(pair);
  return pair;
}

/**
 * Paint the finding. `finding` is an overdueDecisionFinding() model; passing a
 * falsy value clears the panel, which is what a surface that cannot compute one
 * should show rather than a stale answer.
 *
 * The container is emptied and rebuilt on every call — the panel is small, and
 * a rebuilt panel cannot leave a previous state's action behind in the Tab
 * order pointing at a decision that is no longer the finding.
 */
export function renderOverdueFinding(container, finding, options = {}) {
  if (!container) return null;
  container.replaceChildren();
  container.setAttribute("aria-busy", "false");
  container.hidden = !finding;
  if (!finding) return null;

  const overdue = finding.kind === OVERDUE_FINDING_KINDS.overdue;
  const panel = el("section", `overdue-finding overdue-finding-${finding.kind}`);
  panel.setAttribute("aria-labelledby", HEADING_ID);

  const heading = el("h3", "overdue-finding-title", finding.heading);
  heading.id = HEADING_ID;
  panel.append(heading);
  panel.append(el("p", "overdue-finding-lead", finding.lead));

  if (finding.meta.length > 0) {
    // `decision-meta` is the history row's own meta row: flex, wrapping, with
    // the badge tokens already defined for every status word.
    const meta = el("div", "decision-meta overdue-finding-meta");
    for (const item of finding.meta) appendMeta(meta, item);
    // Same disclosure the list rows carry, in the same words: a finding drawn
    // from an example record must say so wherever it appears.
    if (finding.example) meta.append(el("span", "badge badge-example", options.exampleLabel ?? "Example record"));
    panel.append(meta);
  }

  panel.append(el("p", "overdue-finding-benchmark", finding.benchmark));
  if (finding.priority) panel.append(el("p", "overdue-finding-priority", finding.priority));

  if (finding.action) {
    const link = el("a", "overdue-finding-action", finding.action.label);
    link.href = finding.action.href;
    link.setAttribute("aria-label", finding.action.name);
    link.setAttribute("aria-describedby", TARGET_ID);
    const arrow = el("span", "overdue-finding-arrow", "→");
    arrow.setAttribute("aria-hidden", "true");
    link.append(arrow);
    panel.append(link);

    const target = el("p", "overdue-finding-target", finding.action.target);
    target.id = TARGET_ID;
    panel.append(target);
  }

  // The calm states say what the panel is for, so a reader who has never seen
  // it late still learns what it watches. Only there: on the overdue state the
  // benchmark and the target sentence already say it.
  if (!overdue) {
    panel.append(el("p", "overdue-finding-target",
      "This check reads the whole log, not the filters below."));
  }

  container.append(panel);
  return panel;
}
