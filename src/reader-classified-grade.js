// A real letter for a billing-only import, earned by the reader (#1008).
//
// A leader who drops a provider spend export gets money answered and a literacy
// card holding a pending mark, because the grade is scored from a conversation
// export they may not be able to get. The letter is not low, it is unscored —
// and the page says so honestly and then stops. This module is the other half
// of that sentence: the reader classifies their own top departments against the
// SAME published rubric the judge path uses, and the letter is computed from
// their answers, client-side, on the page.
//
// ---------------------------------------------------------------------------
// What is being claimed, and by whom
// ---------------------------------------------------------------------------
//
// A reader-classified letter is a WEAKER claim than a judged one and the
// surface must never let the two be mistaken for each other. So:
//
//   * No weight is invented here. Each pickable workload category is the
//     reader-facing form of a category already in prompt-literacy-rubric.json,
//     and the number it contributes is read through `categoryScoreWeight()`.
//     src/department-workload-categories.json carries the id, the label and the
//     one-line assumption; it carries no number at all, so the reader-facing
//     wording cannot drift from the published weight.
//   * The assumption travels to the surface. Every picked category paints its
//     stated assumption beside the department it was picked for, because a
//     weight a reader cannot see the reasoning for is a weight they cannot
//     dispute — and this one they chose.
//   * Coverage keeps its two halves apart. `importedShare` is spend the rubric
//     scored upstream; `readerClassifiedShare` is spend a person put in a box.
//     They are added once, to make one threshold decision, and are never
//     printed as a single number.
//
// ---------------------------------------------------------------------------
// The arithmetic, stated once
// ---------------------------------------------------------------------------
//
//   offered            the top `TOP_DEPARTMENT_COUNT` departments by spend that
//                      the rubric did not already score, ordered spend-desc then
//                      name-asc. Top-by-spend because the shortest path to a
//                      defensible letter is to classify the money, and the tail
//                      of a real export is dozens of rounding-error teams.
//   weight(department) the rubric weight of the category the reader picked, or —
//                      for a department the rubric did score — that department's
//                      own published score. One 0-100 scale, so the two are
//                      summable without a conversion step.
//   score              spend-weighted mean of weight() over covered departments,
//                      rounded to an integer. Spend-weighted, not per-department,
//                      for the reason `grade-eligibility.js` gives: the leader is
//                      asking about their money.
//   letter             `letterGradeForScore(score)` — the published cutoffs, not
//                      a second table.
//   coveredShare       (imported + reader-classified) / total imported spend,
//                      through `sampledSpendCoverage`, so the tier this letter is
//                      allowed under is decided by the same `COVERAGE_TIERS` a
//                      judged letter is decided by.
//
// Deterministic and side-effect free: no clock, no randomness, no network, no
// storage, and no mutation of the caller's input. Nothing read off an imported
// file reaches a prompt, a judge, or a request — the only thing this module does
// with a department name is compare it and render it as text.

import departmentWorkloads from "./department-workload-categories.json" with { type: "json" };
import { LITERACY_PENDING_MARK } from "./finops-import-slots.js";
import { COVERAGE_TIERS, gradeEligibilityFromCoverage, sampledSpendCoverage } from "./grade-eligibility.js";
import { RUBRIC_VERSION_ID, categoryScoreWeight, letterGradeForScore } from "./prompt-literacy-scoring.js";

/** Bump when a rule, an ordering, or a printed sentence changes meaning. */
export const READER_CLASSIFIED_VERSION = "reader-classified-grade/1.0.0";

/**
 * How many departments the control offers.
 *
 * Five, because a picker long enough to need scrolling is a picker nobody
 * finishes, and in every export this product has seen the top five groups carry
 * the majority of the spend. It is a presentation cap and not a coverage claim:
 * spend outside the five stays in the denominator and is named in the shortfall
 * sentence, so a reader is never shown a coverage figure the cap flattered.
 */
export const TOP_DEPARTMENT_COUNT = 5;

/** The picker's own first entry. Absence of a choice, said in words. */
export const UNCLASSIFIED_OPTION = Object.freeze({
  id: "", label: "Not classified yet",
});

/** The one-line ordering rule the shortfall sentence is built by. */
export const SHORTFALL_ORDER_RULE =
  "largest unclassified spend first, because the fewest picks that close the gap "
  + "is the shortest path to a letter";

/**
 * The pickable categories, resolved against the published rubric.
 *
 * `weight` is joined here and nowhere else. A fixture entry naming a rubric
 * category that does not exist resolves to a weight of 0, which would silently
 * grade a department at the floor — so it is rejected outright at module load
 * rather than shipped, and tests/reader-classified-grade.test.js pins both that
 * and the requirement that every entry states its assumption.
 */
export const WORKLOAD_CATEGORIES = Object.freeze(departmentWorkloads.categories.map((entry) => {
  const weight = categoryScoreWeight(entry.rubricCategory);
  if (!Number.isFinite(weight)) {
    throw new RangeError(`workload category ${entry.id}: no published rubric weight`);
  }
  return Object.freeze({
    id: entry.id,
    label: entry.label,
    rubricCategory: entry.rubricCategory,
    weight,
    assumption: entry.assumption,
    rubricVersion: RUBRIC_VERSION_ID,
  });
}));

const BY_ID = new Map(WORKLOAD_CATEGORIES.map((category) => [category.id, category]));

/**
 * A category by id, or null.
 *
 * The validation, and it is done in code on purpose: a native select refuses a
 * value it has no option for, but nothing else on the path does — a restored
 * capture, a future keyboard control, or a test harness's select double will all
 * hand over whatever string they hold. An unrecognized id is unclassified, never
 * guessed at, for the reason the rubric gives for unclassified records.
 */
export function workloadCategory(id) {
  return BY_ID.get(String(id ?? "")) ?? null;
}

const percent = (ratio) => `${(Math.max(0, Math.min(1, Number(ratio) || 0)) * 100).toFixed(1)}%`;

const money = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);

/** Spend descending, then name ascending: total, so the same set always orders the same. */
const bySpend = (left, right) => right.spendUsd - left.spendUsd || left.name.localeCompare(right.name);

/** The reader's picks, however the caller holds them, as a plain lookup. */
function choiceFor(choices, name) {
  if (choices instanceof Map) return choices.get(name);
  if (choices && typeof choices === "object") return choices[name];
  return undefined;
}

/** A name and a whole number of dollars, for a sentence. Never a reader's row. */
const amount = (value) => `$${Math.round(value).toLocaleString("en-US")}`;

/**
 * The list a reader can act on, and the letter their answers produce.
 *
 * @param {object} input
 * @param {Array} input.departments `{name, spendUsd, rubricScored, score}` rows.
 *   `rubricScored` marks a department the judged path already covered; `score`
 *   is that department's published 0-100 score, used so a mixed import rolls up
 *   on one scale rather than two.
 * @param {Map|object} input.choices department name → workload category id.
 * @returns a frozen model. Same input, identical output, every time.
 */
export function readerClassifiedGrade({ departments = [], choices = null, topCount = TOP_DEPARTMENT_COUNT } = {}) {
  const rows = (Array.isArray(departments) ? departments : [])
    .map((entry) => ({
      name: String(entry?.name ?? entry?.id ?? "").trim(),
      spendUsd: money(entry?.spendUsd),
      rubricScored: Boolean(entry?.rubricScored),
      score: Number.isFinite(Number(entry?.score)) ? Number(entry.score) : null,
    }))
    .filter((entry) => entry.name)
    .sort(bySpend);

  const totalUsd = rows.reduce((sum, entry) => sum + entry.spendUsd, 0);
  const share = (value) => (totalUsd > 0 ? value / totalUsd : 0);
  const cap = Number.isInteger(topCount) && topCount > 0 ? topCount : TOP_DEPARTMENT_COUNT;
  // A department the rubric marked as scored but handed no number for is not
  // covered by anything, so the reader is offered it. That keeps the partition
  // exact — every dollar is rubric-scored, reader-classified, or named in the
  // shortfall — which is what lets the coverage split be checked by addition.
  const offerable = rows.filter((entry) => !(entry.rubricScored && entry.score !== null));
  const offered = offerable.slice(0, cap);

  const classified = [];
  const unclassified = [];
  for (const entry of offered) {
    const category = workloadCategory(choiceFor(choices, entry.name));
    (category ? classified : unclassified).push({ ...entry, category: category ?? null });
  }
  // Everything past the cap is unclassified spend too, and it is named as such.
  // A department the control never offered is still money the letter does not
  // cover, and hiding it would flatter the coverage figure above it.
  for (const entry of offerable.slice(cap)) unclassified.push({ ...entry, category: null });
  unclassified.sort(bySpend);

  const scored = rows.filter((entry) => entry.rubricScored && entry.score !== null);
  const importedUsd = scored.reduce((sum, entry) => sum + entry.spendUsd, 0);
  const readerClassifiedUsd = classified.reduce((sum, entry) => sum + entry.spendUsd, 0);
  const coverage = sampledSpendCoverage({
    coveredUsd: importedUsd, readerClassifiedUsd, totalUsd,
  });
  const eligibility = gradeEligibilityFromCoverage(coverage, {
    groups: unclassified.map((entry) => ({ key: entry.name, uncoveredUsd: entry.spendUsd })),
  });

  const weighted = importedUsd + readerClassifiedUsd;
  const points = scored.reduce((sum, entry) => sum + entry.spendUsd * entry.score, 0)
    + classified.reduce((sum, entry) => sum + entry.spendUsd * entry.category.weight, 0);
  const score = weighted > 0 ? Math.round(points / weighted) : null;
  const letter = score === null ? null : letterGradeForScore(score);

  const split = `${percent(coverage.coveredShare ?? 0)} of imported spend — `
    + `${percent(coverage.importedShare ?? 0)} imported and rubric-scored, `
    + `${percent(coverage.readerClassifiedShare ?? 0)} you classified`;

  return Object.freeze({
    version: READER_CLASSIFIED_VERSION,
    rubricVersion: RUBRIC_VERSION_ID,
    totalUsd,
    importedUsd,
    readerClassifiedUsd,
    importedShare: coverage.importedShare,
    readerClassifiedShare: coverage.readerClassifiedShare,
    coveredShare: coverage.coveredShare,
    score,
    letter,
    // The tier gate is the judged path's gate. A reader-classified letter that
    // covered a fifth of the money is withheld for exactly the reason a judged
    // one would be.
    showGrade: eligibility.showGrade && letter !== null,
    tier: eligibility.tier,
    state: eligibility.state,
    provisional: eligibility.provisional,
    label: eligibility.label,
    rule: eligibility.rule,
    offered: Object.freeze(offered.map((entry) => Object.freeze({
      name: entry.name,
      spendUsd: entry.spendUsd,
      share: share(entry.spendUsd),
      categoryId: workloadCategory(choiceFor(choices, entry.name))?.id ?? "",
      assumption: workloadCategory(choiceFor(choices, entry.name))?.assumption ?? "",
      // The money beside the name, so a reader picking a category knows how much
      // of the letter their answer is about to decide.
      caption: `${entry.name} · ${amount(entry.spendUsd)} · ${percent(share(entry.spendUsd))} of imported spend`,
    }))),
    classifiedNames: Object.freeze(classified.map((entry) => entry.name)),
    unclassified: Object.freeze(unclassified.map((entry) => Object.freeze({
      name: entry.name, spendUsd: entry.spendUsd, share: share(entry.spendUsd),
    }))),
    // The rebuild key. Names and order only: a value change must not rebuild the
    // rows under a reader's focus, and a department set change must.
    signature: offered.map((entry) => entry.name).join(" "),
    coverageLine: `Coverage · ${split}`,
    explanation: classified.length === 0
      ? "Why this letter: no department has been classified yet, so no share of this "
        + "import's spend has a rubric category behind it."
      : `Why this letter: ${classified.length === 1 ? "1 department" : `${classified.length} departments`}`
        + ` you classified ${classified.length === 1 ? "was" : "were"} scored — `
        + `${classified.map((entry) => entry.name).join(", ")}. Coverage is ${split}.`,
    shortfall: shortfallFor(coverage.coveredShare ?? 0, unclassified, totalUsd, classified.length),
  });
}

/**
 * What is still missing, in the two things a reader can act on: the exact share
 * of spend the next tier needs, and which departments would supply it.
 *
 * The list is built by taking unclassified departments in the order stated by
 * `SHORTFALL_ORDER_RULE` — largest unclassified spend first — until their
 * cumulative share reaches the gap. Never a bare number: the sentence that says
 * where the number came from and the number itself are one string, so no surface
 * can print half of it.
 */
function shortfallFor(coveredShare, unclassified, totalUsd, classifiedCount) {
  if (!(totalUsd > 0)) return null;
  const better = [...COVERAGE_TIERS].reverse().find((tier) => tier.floor > coveredShare);
  if (!better) return null;
  const needed = better.floor - coveredShare;
  const picks = [];
  let gained = 0;
  // A tolerance, because the gap is a difference of two ratios and 0.8 - 0.5 is
  // 0.30000000000000004 in binary floating point. Without it a department whose
  // share closes the gap EXACTLY is followed by a second one nobody needs, which
  // is a longer instruction than the arithmetic supports. A billionth of a
  // percent of spend is below anything this page prints.
  const enough = (value) => value >= needed - 1e-9;
  for (const entry of unclassified) {
    if (enough(gained)) break;
    picks.push(entry);
    gained += totalUsd > 0 ? entry.spendUsd / totalUsd : 0;
  }
  // With a well-formed department list every dollar is scored, classified, or
  // unclassified, so the picks always close the gap. `closes` is the guard for a
  // caller whose rows do not partition their own total: it says so in the
  // sentence rather than promising a tier the list cannot reach.
  const closes = enough(gained);
  const named = picks.map((entry) => `${entry.name} (${percent(entry.spendUsd / totalUsd)} of spend)`);
  const opening = classifiedCount === 0
    ? `No letter yet: classify the departments below and this card fills in. ${percent(needed)} of `
      + "imported spend has to sit in a rubric category"
    : `${percent(needed)} more of imported spend has to sit in a rubric category`;
  return Object.freeze({
    neededShare: needed,
    targetTier: better.tier,
    targetFloor: better.floor,
    closes,
    departments: Object.freeze(picks.map((entry) => entry.name)),
    sentence: named.length === 0
      ? `${opening} to reach ${percent(better.floor)} coverage, and this export has no `
        + "unclassified department left to supply it."
      : `${opening} to reach ${percent(better.floor)} coverage. `
        + `${closes ? "Classifying" : "Classifying every department left —"} `
        + `${named.join(", ")}${closes ? "" : " —"} would add ${percent(gained)}`
        + `${closes ? ", which closes the gap" : ", which does not close it"}. `
        + `Listed ${SHORTFALL_ORDER_RULE}.`,
  });
}

/**
 * Paint the classification control.
 *
 * Every department name is written with `textContent` and every option value is
 * an id from the fixture, so nothing an imported file carries is ever
 * interpolated as markup. The rows are rebuilt only when the department set
 * itself changes — a rebuild on every keystroke would drop the reader's focus
 * out of the select they are using.
 *
 * NOT a live region and NOT inside a disclosure. The page announces through one
 * region; and a grade explanation folded into a collapsed details element is one
 * a real browser hides from the reader it was written for, however well a test
 * harness reads through it.
 */
export function applyReaderClassification(doc, model, { onChange = null } = {}) {
  const root = doc?.getElementById?.("score-classify");
  const list = doc?.getElementById?.("score-classify-list");
  if (!root || !list || !model) return null;
  root.hidden = false;
  const title = doc.getElementById("score-classify-title");
  if (title) {
    title.textContent = "This import has spend but no scored conversations. Classify your "
      + `biggest ${model.offered.length === 1 ? "department" : `${model.offered.length} departments`} `
      + "against the published rubric and the letter above is computed from your answers.";
  }

  if (list.dataset.signature !== model.signature) {
    list.dataset.signature = model.signature;
    list.replaceChildren(...model.offered.map((department, index) => {
      const item = doc.createElement("li");
      item.className = "score-classify-row";
      const selectId = `score-classify-choice-${index}`;
      const label = doc.createElement("label");
      label.className = "score-classify-label";
      label.setAttribute("for", selectId);
      label.textContent = department.caption;
      const select = doc.createElement("select");
      select.className = "score-classify-select";
      select.id = selectId;
      select.dataset.department = department.name;
      for (const option of [UNCLASSIFIED_OPTION, ...WORKLOAD_CATEGORIES]) {
        const node = doc.createElement("option");
        node.setAttribute("value", option.id);
        node.textContent = option.label;
        select.append(node);
      }
      if (onChange) {
        select.addEventListener("change", (event) => {
          // Validated against the fixture, not against the control: the id is
          // only accepted if the published rubric has a weight for it.
          const chosen = workloadCategory(event?.target?.value);
          onChange(department.name, chosen ? chosen.id : "");
        });
      }
      const why = doc.createElement("p");
      why.className = "score-classify-assumption";
      why.id = `${selectId}-assumption`;
      select.setAttribute("aria-describedby", why.id);
      item.append(label, select, why);
      return item;
    }));
  }

  model.offered.forEach((department, index) => {
    const select = doc.getElementById(`score-classify-choice-${index}`);
    if (select) select.value = department.categoryId;
    const why = doc.getElementById(`score-classify-choice-${index}-assumption`);
    // The stated assumption, on the surface rather than in the fixture alone.
    if (why) {
      why.textContent = department.assumption
        || "No category picked yet, so this department's spend is not in the letter above.";
    }
  });
  return model;
}

/**
 * Paint the letter the reader's answers earned.
 *
 * Four slots the card already ships, plus the reason line. Nothing is created
 * and nothing is removed, so the card keeps its shape in every state — the rule
 * src/finops-literacy-card.js keeps, for the same reason.
 *
 * The reason line is where the shortfall sentence goes, replacing the generic
 * "drop a conversation export" message the moment a reader has classified
 * anything: a reader who has just supplied evidence should be told what is still
 * missing, not told again to go and find a file.
 */
export function applyReaderClassifiedLetter(doc, model) {
  if (!doc?.getElementById || !model) return null;
  const write = (id, text) => {
    const node = doc.getElementById(id);
    if (node) node.textContent = text;
    return node;
  };
  write("score-grade", model.showGrade ? model.letter : LITERACY_PENDING_MARK);
  write("score-value", model.showGrade
    ? `${model.score} / 100 · grade ${model.letter} · classified by you · ${model.rubricVersion}`
    : model.label);
  write("score-coverage", model.coverageLine);
  write("score-why", model.explanation);
  const need = doc.getElementById("score-input-need");
  // Only once the reader has actually classified something. Before that the line
  // belongs to src/finops-import-slots.js, which names the missing conversation
  // export — a reader who has supplied no evidence yet is owed the file they
  // could go and get, not an arithmetic gap. After they have, the generic
  // message is replaced by the exact share still needed and who would supply it.
  if (need && model.shortfall && model.classifiedNames.length > 0) {
    need.textContent = model.shortfall.sentence;
    // Shown, never folded away: this sentence is the one instruction on the card.
    need.hidden = false;
  } else if (need && model.showGrade) {
    need.textContent = "";
    need.hidden = true;
  }
  const card = doc.getElementById("score-card");
  if (card) {
    card.dataset.readerClassified = String(model.classifiedNames.length > 0);
    card.dataset.coverageTier = model.tier;
    card.dataset.gradeState = model.state;
  }
  return model;
}

/** Hide the control without destroying it, for every state that is not a billing-only import. */
export function clearReaderClassification(doc) {
  const root = doc?.getElementById?.("score-classify");
  if (root) root.hidden = true;
  return root;
}
