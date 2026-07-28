// Painting one presentation model. The primitive, not the page.
//
// It takes the document rather than reading a global, and every id it writes is
// derived from an `idPrefix` the caller owns — so two results can sit on one
// page without colliding, which is what the specimen needs and what the
// singleton-id surface in prompt-coaching-view.js cannot do.
//
// Every node is built with createElement and textContent. There is no markup
// string, no innerHTML and no template interpolation into markup anywhere on
// this path: the upstream input is prompt text a visitor pasted, and innerHTML
// here would be a script injection with a paste as its vector. (The model this
// renders carries no prompt text at all — that is enforced a layer up — so this
// rule is the second lock on the same door, not the first.)
//
// WHAT THIS FILE DECIDES AND WHAT IT DOES NOT. It decides markup: which element
// carries which role, where a heading sits, which control owns which panel. It
// decides no copy and no order — both are the model's, so a reading-order test
// asserts against data rather than against a snapshot of this function.
//
// ACCESSIBILITY, HELD HERE:
//   * Regions are `<section>`s with real headings at a caller-chosen level, so
//     the surface nests correctly wherever it is dropped in.
//   * Disclosures are `<button>`s that own their panel (`aria-expanded`,
//     `aria-controls`), start closed, and keep focus on activation — a button
//     is Enter- and Space-operable for free, and moving focus off it on toggle
//     is the classic way a keyboard reader loses their place.
//   * Nothing is signalled by tint alone: every state carries a word, every
//     figure carries a label, and the shapes are decorative duplicates of both.

const HEADING_TAGS = Object.freeze(["h1", "h2", "h3", "h4", "h5", "h6"]);

const headingTag = (level) => HEADING_TAGS[Math.min(Math.max(level, 1), 6) - 1];

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Decorative by construction: the word beside it is the accessible name. */
function shape(doc, glyph) {
  const node = element(doc, "span", "coaching-result-shape", glyph);
  node.setAttribute("aria-hidden", "true");
  return node;
}

/**
 * A labelled figure list. `dt` carries the label and `dd` the value, so the
 * pair survives being read aloud, and an audited figure marks itself rather
 * than relying on the tint the CSS gives it.
 */
function factList(doc, facts) {
  const list = element(doc, "dl", "coaching-result-facts");
  for (const entry of facts) {
    const term = element(doc, "dt", undefined, entry.label);
    const value = element(doc, "dd", undefined, entry.value);
    if (entry.implausible) value.dataset.implausible = "true";
    if (entry.pending) value.dataset.pending = "true";
    list.append(term, value);
  }
  return list;
}

function noticeList(doc, notices) {
  const list = element(doc, "ul", "coaching-result-notices");
  list.setAttribute("aria-label", "Figures outside their range");
  for (const notice of notices) {
    const item = element(doc, "li");
    item.dataset.code = notice.code;
    item.append(
      shape(doc, "!"),
      element(doc, "span", "coaching-result-notice-label", `Check this figure — ${notice.label}: ${notice.value}.`),
      element(doc, "span", "coaching-result-notice-guidance", notice.guidance),
    );
    list.append(item);
  }
  return list;
}

// --- the regions ------------------------------------------------------------

function regionSection(doc, region, level) {
  const section = element(doc, "section", `coaching-result-region coaching-result-${region.id}`);
  section.dataset.region = region.id;
  section.dataset.rank = String(region.rank);
  section.append(element(doc, headingTag(level), "eyebrow", region.heading));
  return section;
}

function gradeBlock(doc, region, level) {
  const section = regionSection(doc, region, level);
  const status = element(doc, "p", "coaching-result-status");
  status.append(
    shape(doc, region.shape),
    element(doc, "span", "coaching-result-status-label", `${region.statusLabel}:`),
    element(doc, "strong", "coaching-result-status-value", region.statusValue),
  );
  section.append(status);

  if (region.mark) {
    // The one piece of pure display on the surface. Hidden from assistive
    // technology because the sentence under it says the same thing in words.
    const mark = element(doc, "p", "coaching-result-mark", region.mark);
    mark.setAttribute("aria-hidden", "true");
    section.append(mark);
  }
  section.append(element(doc, "p", "coaching-result-answer", region.answer));
  if (region.facts.length) section.append(factList(doc, region.facts));
  if (region.notices.length) section.append(noticeList(doc, region.notices));
  return section;
}

function benchmarkBlock(doc, region, level) {
  const section = regionSection(doc, region, level);
  section.append(factList(doc, region.facts));
  const note = element(doc, "p", "coaching-result-note");
  note.append(
    element(doc, "strong", "coaching-result-note-label", region.noteLabel),
    element(doc, "span", "coaching-result-note-text", region.note),
  );
  section.append(note);
  return section;
}

function actionBlock(doc, region, level) {
  const section = regionSection(doc, region, level);
  section.dataset.available = String(region.available);
  const title = element(doc, "p", "coaching-result-action-title");
  title.append(shape(doc, region.shape),
    element(doc, "span", "coaching-result-action-words", region.title));
  section.append(title, element(doc, "p", "coaching-result-action-guidance", region.guidance));
  if (region.rewrite) {
    section.append(
      element(doc, "p", "coaching-result-rewrite-label", "Ready-to-edit rewrite"),
      element(doc, "pre", "coaching-result-rewrite", region.rewrite),
    );
  }
  if (region.worth) section.append(element(doc, "p", "coaching-result-worth", region.worth));
  if (region.control) {
    const target = element(doc, "p", "coaching-result-action-control",
      `The control that acts on this: ${region.control}`);
    section.append(target);
  }
  return section;
}

function evidenceBody(doc, region) {
  const nodes = [];
  if (region.recommendation) {
    const block = element(doc, "div", "coaching-result-recommendation");
    block.dataset.state = region.recommendation.state;
    block.dataset.evidenced = String(region.recommendation.evidenced);
    const title = element(doc, "p", "coaching-result-recommendation-title");
    title.append(shape(doc, region.recommendation.shape),
      element(doc, "span", "coaching-result-recommendation-label", `${region.recommendation.label}:`),
      element(doc, "span", "coaching-result-recommendation-words", region.recommendation.title));
    block.append(title, element(doc, "p", "coaching-result-recommendation-text", region.recommendation.text));
    if (region.recommendation.basis) {
      block.append(element(doc, "p", "coaching-result-recommendation-basis", region.recommendation.basis));
    }
    nodes.push(block);
  }
  nodes.push(factList(doc, region.facts));
  nodes.push(element(doc, "p", "coaching-result-note", region.note));
  return nodes;
}

function rubricBody(doc, region) {
  const axes = element(doc, "dl", "coaching-result-facts");
  axes.setAttribute("aria-label", "Axis subscores");
  for (const axis of region.axes) {
    axes.append(element(doc, "dt", undefined, axis.label), element(doc, "dd", undefined, axis.value));
  }

  const turns = element(doc, "ul", "coaching-result-turns");
  turns.setAttribute("aria-label", "What the classifier read in each turn");
  for (const turn of region.turns) {
    const item = element(doc, "li", "coaching-result-turn");
    item.dataset.scored = String(turn.scored);
    item.append(
      element(doc, "span", "coaching-result-turn-index", turn.label),
      element(doc, "span", "coaching-result-turn-role", turn.role),
      element(doc, "span", "coaching-result-turn-read", turn.read),
      element(doc, "span", "coaching-result-turn-scored", turn.scoredLabel),
    );
    if (turn.codes) item.append(element(doc, "span", "coaching-result-turn-codes", turn.codes));
    turns.append(item);
  }

  const nodes = [axes, turns];
  const assumptions = element(doc, "dl", "coaching-result-assumptions");
  assumptions.setAttribute("aria-label", "Assumptions behind the weights and recommendations");
  for (const assumption of region.assumptions) {
    assumptions.append(
      element(doc, "dt", undefined, assumption.key),
      element(doc, "dd", undefined, assumption.text),
    );
  }
  nodes.push(assumptions);
  if (region.runnersUp.length) {
    const list = element(doc, "ol", "coaching-result-runners-up");
    list.setAttribute("aria-label", "The other changes this rubric would rank next");
    for (const entry of region.runnersUp) {
      const item = element(doc, "li");
      item.append(element(doc, "span", "coaching-result-runner-title", entry.title),
        element(doc, "span", "coaching-result-runner-worth", entry.worth));
      list.append(item);
    }
    nodes.push(list);
  }
  nodes.push(element(doc, "p", "coaching-result-version", region.version));
  return nodes;
}

/**
 * A disclosed region: a button that owns its panel, and a panel that starts
 * closed and is a labelled region once open.
 *
 * The toggle rewrites its own label and `aria-expanded` and never rebuilds the
 * surface around it, so focus stays exactly where the reader put it.
 */
function disclosedBlock(doc, region, level, idPrefix, body) {
  const section = regionSection(doc, region, level);
  const toggleId = `${idPrefix}-${region.id}-toggle`;
  const panelId = `${idPrefix}-${region.id}-panel`;

  const toggle = element(doc, "button", "coaching-result-toggle");
  toggle.id = toggleId;
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  const label = (expanded) => `${expanded ? "Hide" : "Show"} ${region.heading.toLowerCase()} (${region.summary})`;
  toggle.textContent = label(false);

  const panel = element(doc, "div", "coaching-result-panel");
  panel.id = panelId;
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", region.heading);
  panel.append(...body);

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    toggle.textContent = label(!expanded);
    panel.hidden = expanded;
  });

  section.append(toggle, panel);
  return section;
}

const BLOCKS = Object.freeze({
  grade: (doc, region, level) => gradeBlock(doc, region, level),
  benchmark: (doc, region, level) => benchmarkBlock(doc, region, level),
  action: (doc, region, level) => actionBlock(doc, region, level),
  evidence: (doc, region, level, prefix) =>
    disclosedBlock(doc, region, level, prefix, evidenceBody(doc, region)),
  rubric: (doc, region, level, prefix) =>
    disclosedBlock(doc, region, level, prefix, rubricBody(doc, region)),
});

/**
 * Render one presentation model.
 *
 * @param {object} doc the document to build in.
 * @param {object} model from `presentCoachingResult`.
 * @param {{idPrefix?: string, headingLevel?: number, labelledBy?: string}} options
 *   `labelledBy` names an existing heading to label the result with — pass it
 *   when the caller already wrote one, so the surface does not stack two
 *   headings saying the same thing. Without it the result writes its own at
 *   `headingLevel` and its regions one level below.
 * @returns {object} the detached `<section>`; the caller decides where it goes.
 */
export function renderCoachingResult(doc, model, {
  idPrefix = "coaching-result", headingLevel = 3, labelledBy = null,
} = {}) {
  const root = element(doc, "section", "coaching-result");
  root.id = idPrefix;
  root.dataset.status = model.status;
  root.dataset.tone = model.tone;
  root.dataset.implausible = String(model.implausible);

  let regionLevel = headingLevel;
  if (labelledBy) {
    root.setAttribute("aria-labelledby", labelledBy);
  } else {
    const heading = element(doc, headingTag(headingLevel), "coaching-result-heading",
      `${model.statusLabel} — the answer, what it is measured against, and one move`);
    heading.id = `${idPrefix}-heading`;
    root.setAttribute("aria-labelledby", heading.id);
    root.append(heading);
    regionLevel = headingLevel + 1;
  }

  for (const region of model.regions) {
    root.append(BLOCKS[region.kind](doc, region, regionLevel, idPrefix));
  }
  return root;
}
