// The bundled synthetic conversation corpus — the scored sample behind the
// first-run literacy letter.
//
// WHY IT EXISTS. `example-dataset.js` invents six months of provider billing for
// five invented departments, and every figure on the first screen comes out of
// it. Literacy was the one slot it could not fill: a grade needs *prompts*, and a
// billing export carries none, so the card said "no scored query sample" and
// showed a dash. This module is the missing half of the same invented company.
//
// It is a GENERATOR, not a committed corpus, for two reasons. The repo enforces
// a cumulative byte budget that a few hundred literal prompt strings would eat,
// and — more importantly — a generated corpus goes through
// `analyzeConversationExportText` byte for byte the way a reader's own upload
// does: same delimited reader, same dialect detection, same parse, same
// classifier, same rubric. There is no bypass branch and no pre-computed grade.
//
// ---------------------------------------------------------------------------
// EVERY NUMBER BELOW IS AN ASSUMPTION, STATED
// ---------------------------------------------------------------------------
//
// The mixes in `CORPUS_PLAN` are the only authored inputs. They are *not* a
// rubric: the rubric is `prompt-literacy-rubric.json`, and the weights that turn
// a category mix into a letter live there with their own assumptions beside
// them. What the plan decides is which invented department behaves which way,
// and each row says why in one line, because a director disputing "why is Cinder
// a C?" is owed the sentence that made it one rather than a table of counts.
//
// ---------------------------------------------------------------------------
// REDACTION
// ---------------------------------------------------------------------------
//
// The prompt strings this module emits exist for the length of one parse. They
// are written into delimited bytes here, read back inside
// `parseConversationExport`, classified there, and dropped — the parsed record
// carries counts and a category, never text. Nothing this module exports is
// rendered, and `tests/finops-first-run-literacy.test.js` asserts no substring of
// a generated prompt reaches the DOM or an export payload.
//
// Everything here is invented. The addresses are in the reserved `.invalid`
// domain, the model identifiers are made-up SKUs chosen only so the shipped tier
// table reads them as premium, standard, and economy, and no real company,
// person, or conversation appears anywhere in this file.

/** Bump when the plan, the templates, or the emitted columns change meaning. */
export const EXAMPLE_CORPUS_VERSION = "example-conversation-corpus/1.0.0";

/** Six consecutive months, the same window `example-dataset.js` bills over. */
export const CORPUS_MONTHS = Object.freeze([
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
]);

/**
 * One prompt shape per rubric category, and the model tier each is sent on.
 *
 * The text is a template because the classifier reads *signals*, not prose: a
 * hundred hand-written variations of "context: … constraints: … acceptance
 * criteria: …" would classify identically and cost a hundred lines of diff. The
 * `topic` slot varies the prompt so the corpus is not one string repeated, and
 * varies nothing the rubric consumes.
 *
 * `model` is chosen against `provider-usage-record.js`'s tier table and nothing
 * else. `overProvisioned` only exists as a category when the tier is premium —
 * that is the rule's own precondition — so the invented `…-ultra-…` SKU is load
 * bearing, and the economy SKU on the out-of-scope rows is there so the corpus
 * is not uniformly premium.
 */
const TEMPLATES = Object.freeze({
  highValue: Object.freeze({
    model: "invented-pro-1",
    text: (topic) => `context: the ${topic} rollout. constraints: must not use the legacy path. `
      + "acceptance criteria: a numbered checklist an on-call engineer can follow",
  }),
  overProvisioned: Object.freeze({
    model: "invented-ultra-1",
    text: (topic) => `rename the ${topic} column`,
  }),
  inefficient: Object.freeze({
    model: "invented-pro-1",
    text: (topic) => `try again, the ${topic} summary is still not what i asked for`,
  }),
  outOfScope: Object.freeze({
    model: "invented-mini-1",
    text: (topic) => `plan a birthday lunch for the ${topic} team`,
  }),
});

/** The categories in emission order, so a row's index decides its category. */
const CATEGORY_ORDER = Object.freeze(["highValue", "overProvisioned", "inefficient", "outOfScope"]);

/** Invented subject words. Twelve is enough that no month repeats one. */
const TOPICS = Object.freeze([
  "billing", "onboarding", "retention", "routing", "indexing", "provisioning",
  "reconciliation", "throttling", "packaging", "migration", "labelling", "archival",
]);

/**
 * The authored corpus shape: one row per invented department, keyed by the org
 * unit id `example-dataset.js` bills under, so the grade and the spend it is
 * weighted against name the same department by construction.
 *
 * `mix` is counts per category in `CATEGORY_ORDER`. `why` is the assumption the
 * mix encodes, in one sentence, because the mix is the reason the letter is what
 * it is and a reader disputing the letter will land here first.
 */
export const CORPUS_PLAN = Object.freeze([
  Object.freeze({
    unitId: "psn_example_unit_atlas0",
    mix: Object.freeze([34, 8, 4, 2]),
    why: "The biggest spender, working as intended but routing carelessly: mostly "
      + "well-formed requests with a visible tail of mechanical edits on the premium tier. "
      + "It grades in the B band so the top-spend department is not also the worst one, "
      + "which would make the example's ranked action trivially obvious.",
  }),
  Object.freeze({
    unitId: "psn_example_unit_boreal",
    mix: Object.freeze([33, 2, 1, 0]),
    why: "The internal reference class: an A, so the corpus contains a department the "
      + "others can be coached toward rather than only degrees of failure.",
  }),
  Object.freeze({
    unitId: "psn_example_unit_cinder",
    mix: Object.freeze([19, 6, 5, 2]),
    why: "The coachable problem: re-prompt spirals and leakage together drag it into "
      + "the C band, which is the band the rubric describes as acceptable-with-a-plan.",
  }),
  Object.freeze({
    unitId: "psn_example_unit_quartz",
    mix: Object.freeze([20, 3, 1, 1]),
    why: "A second B, on a quarter of Atlas's prompt count, so the company roll-up is "
      + "visibly prompt-weighted rather than a mean of five equal letters.",
  }),
  Object.freeze({
    unitId: "psn_example_unit_ember0",
    mix: Object.freeze([2, 1, 0, 0]),
    why: "Deliberately under the five-prompt floor `query-literacy.js` publishes. The "
      + "example has to show a department that is sampled and still not graded, because "
      + "that is the case the spend-coverage figure beside the letter exists to expose.",
  }),
]);

/** The header spellings this corpus is written in. One dialect, stated once. */
export const CORPUS_COLUMNS = Object.freeze([
  "conversation_id", "user_email", "department", "created_at", "role", "model", "message_text",
]);

/** RFC 4180 quoting, for the columns that carry a comma-bearing sentence. */
const cell = (value) => (/[",\n]/.test(value) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

/** The invented actor for a row: three per department, rotated by index. */
const actor = (tail, index) => `person${(index % 3) + 1}.${tail}@example.invalid`;

/**
 * Expand one plan row into records, in a fixed order that depends only on the
 * plan. No clock, no randomness, and no generator seed to get wrong: the
 * position of a row *is* its seed, which is what makes the corpus byte-identical
 * on every run and lets `tests/finops-first-run-literacy.test.js` assert it.
 */
function departmentRows(plan, name) {
  const tail = plan.unitId.slice(-6);
  const rows = [];
  CATEGORY_ORDER.forEach((category, categoryIndex) => {
    const template = TEMPLATES[category];
    for (let n = 0; n < plan.mix[categoryIndex]; n += 1) {
      const index = rows.length;
      const month = CORPUS_MONTHS[index % CORPUS_MONTHS.length];
      const day = String((index % 27) + 1).padStart(2, "0");
      rows.push([
        `conv-${tail}-${String(index + 1).padStart(3, "0")}`,
        actor(tail, index),
        name,
        `${month}-${day}T09:${String((index % 50) + 5).padStart(2, "0")}:00Z`,
        "user",
        template.model,
        template.text(TOPICS[(index + categoryIndex) % TOPICS.length]),
      ]);
    }
  });
  return rows;
}

/**
 * The corpus as delimited bytes, in the shape `analyzeConversationExportText`
 * accepts.
 *
 * @param departments the invented departments to write rows for, as
 *   `{ id, name }` — taken from the billing analysis itself rather than named
 *   here, so the department column and the spend column cannot drift apart. A
 *   plan row whose unit id is absent from `departments` emits nothing.
 */
export function exampleConversationCorpusText(departments = []) {
  const nameFor = new Map(departments
    .filter((department) => typeof department?.id === "string" && typeof department?.name === "string")
    .map((department) => [department.id, department.name]));
  const rows = CORPUS_PLAN.flatMap((plan) => {
    const name = nameFor.get(plan.unitId);
    return name ? departmentRows(plan, name) : [];
  });
  return `${[CORPUS_COLUMNS.join(","), ...rows.map((row) => row.map(cell).join(","))].join("\n")}\n`;
}

/** How many rows `exampleConversationCorpusText` writes. Derived, never counted twice. */
export const CORPUS_PROMPT_COUNT = CORPUS_PLAN.reduce(
  (total, plan) => total + plan.mix.reduce((sum, count) => sum + count, 0), 0,
);
