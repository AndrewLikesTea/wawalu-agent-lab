// The prompt-prose fixture corpus: invented prompts, hand-derived grades.
//
// PROVENANCE. Every prompt below was written for this file. Nothing here is a
// real prompt, a real conversation, a real person, a real customer, or a real
// incident, and no part of it was scraped, imported, or copied from a user.
// The organisations and hostnames are invented and the addresses sit in the
// reserved `.invalid` domain.
//
// HOW TO CHECK A FIXTURE BY HAND. Open `docs/prompt-prose-rubric.md`, read the
// baseline for the dimension and the weight of each signal, and follow the
// `derivation` string on the fixture. It states the arithmetic in full — every
// baseline, every weight, the weighted mean, and the composite — so landing on
// the published letter requires no code. That is the point of the corpus: a
// director who disputes a grade must be able to reproduce it on paper.
//
// The `expected` values were derived from the documented weights first and the
// implementation was made to agree with them, not the other way round. Where a
// fixture's prose-unit count is quoted in a derivation it is a mechanical count
// of the words the segmenter kept, which is the one input a reader takes from
// the tool rather than from the rubric.
//
// A DATA MODULE, NOT JSON, for one reason: the two length fixtures need bodies
// of a thousand words, and committing a thousand words of filler would make the
// corpus unreadable without making it more checkable. They are built from a
// stated, visible repetition instead.

const body = (...lines) => lines.join("\n");

/**
 * A long body built from `count` numbered variations of one sentence set.
 * Visible construction beats a committed wall of filler: a reader can see
 * exactly how long the prompt is and that it says nothing the short version
 * does not, which is what the length fixtures are testing.
 */
function longProse(count, subject) {
  const parts = [];
  for (let step = 1; step <= count; step += 1) {
    parts.push(`Step ${step} of the ${subject} covers the handoff between the queue `
      + `reader and the writer, the retry budget it is allowed, and the metric we watch `
      + `while it drains, which is the queue depth measured at the end of each minute.`);
  }
  return parts.join(" ");
}

/**
 * The same material as `longProse`, but one sentence per line — which is what
 * makes it a *paste*. The segmenter reads an unbroken paragraph as prose no
 * matter how long it is, and only a block of eight or more lines as material
 * carried in; the two helpers exist so the corpus exercises both readings and a
 * reader can see which shape produced which.
 */
function pastedProse(count, subject) {
  const lines = [];
  for (let step = 1; step <= count; step += 1) {
    lines.push(`Row ${step} of the ${subject} export names the owning team, the window it `
      + `ran in, the number of records it moved, and the operator who signed it off.`);
  }
  return lines.join("\n");
}

/** A synthetic log paste: verbatim-shaped lines, never composed prose. */
function logPaste(count) {
  const lines = [];
  for (let step = 0; step < count; step += 1) {
    lines.push(`2026-07-0${(step % 9) + 1}T09:${String(step % 60).padStart(2, "0")}:12Z `
      + `ERROR reconcile worker=${step % 4} attempt=3 status=timeout elapsed_ms=${900 + step}`);
  }
  return lines.join("\n");
}

/**
 * The corpus.
 *
 * `expected.dimensions` are the conversation-level, prose-length-weighted means.
 * `expected.grade` is the rubric's own letter for `expected.composite`.
 * `expected.category` is the label the band rule derives; `unclassified` there
 * means "none of the rubric's four names fits", never "we could not read it".
 * `expected.unscoredTurns` counts user turns the classifier refused to grade.
 */
export const PROMPT_PROSE_CORPUS = Object.freeze([
  Object.freeze({
    id: "a-well-formed-single-turn",
    covers: ["band:A", "class:highValue", "single-turn"],
    model: "gpt-4o",
    turns: [{ role: "user", body: body(
      "Context: the billing service returns 500s under sustained load during the nightly reconciliation window.",
      "Constraints: we must not change the public schema and we cannot hold a lock for longer than one second.",
      "Acceptance criteria: a passing regression test that reproduces the failure, and a patch that keeps the existing handler signature.",
    ) }],
    derivation: "Intent 40 + 18 context + 18 constraints + 18 acceptance + 18 layout = 112, "
      + "clamped to 100. Efficiency 85 (nothing fired). Model fit 80 (premium, but 51 prose "
      + "units is under the 150 the substantive credit needs). Composite = 0.5x100 + "
      + "0.3x85 + 0.2x80 = 91.5, rounded to 92. Grade A.",
    expected: { category: "highValue", dimensions: { intent: 100, efficiency: 85, modelFit: 80 }, composite: 92, grade: "A", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "a-substantive-design-brief",
    covers: ["band:A", "class:highValue", "very-long-prompt", "model-fit-credit"],
    model: "gpt-4o",
    turns: [{ role: "user", body: body(
      "Context: we are building a replacement for the reconciliation pipeline and need a written design before any code.",
      "Constraints: must not introduce a second datastore, and do not use a scheduled job where a queue would do.",
      "Acceptance criteria: a design note naming the failure modes and the rollback for each stage.",
      longProse(8, "migration"),
    ) }],
    derivation: "Same three intent signals plus layout: 40 + 54 + 18 = 112, clamped to 100. "
      + "Efficiency 85. Model fit 80 + 20 substantive-on-premium (prose units are over 150) "
      + "= 100. Composite = 0.5x100 + 0.3x85 + 0.2x100 = 95.5, rounded to 96. Grade A.",
    expected: { category: "highValue", dimensions: { intent: 100, efficiency: 85, modelFit: 100 }, composite: 96, grade: "A", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "a-focused-two-turn",
    covers: ["band:A", "class:highValue", "multi-turn"],
    model: "gpt-4o",
    turns: [
      { role: "user", body: body(
        "Context: the invoice export drops rows whose currency code is lower case.",
        "Constraints: must not change the export format that finance already parses.",
        "Acceptance criteria: every row survives the export and the codes are normalised on the way in.",
      ) },
      { role: "user", body: body(
        "Context: same export, now the totals column.",
        "Constraints: do not use floating point for the sum.",
        "Expected output: the patch plus the one test that would have caught this.",
      ) },
    ],
    derivation: "Both turns score intent 100, efficiency 85, model fit 80 by the same "
      + "arithmetic as the first fixture. A weighted mean of two identical scores is that "
      + "score whatever the weights are, so the conversation is 100 / 85 / 80 and the "
      + "composite is 91.5, rounded to 92. Grade A.",
    expected: { category: "highValue", dimensions: { intent: 100, efficiency: 85, modelFit: 80 }, composite: 92, grade: "A", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "b-context-and-constraints",
    covers: ["band:B", "class:highValue"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body: body(
      "Background: the staging cluster loses its connection pool about once a day and recovers on its own.",
      "Requirements: an explanation I can put in an incident note, not a patch.",
    ) }],
    derivation: "Intent 40 + 18 context + 18 constraints + 18 layout (two labelled lines) = "
      + "94; acceptance never fired. Efficiency 85. Model fit 80 (standard tier: no "
      + "model-fit signal applies to it at all). Composite = 0.5x94 + 0.3x85 + 0.2x80 = "
      + "88.5, rounded to 89. Grade B.",
    expected: { category: "highValue", dimensions: { intent: 94, efficiency: 85, modelFit: 80 }, composite: 89, grade: "B", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "b-bulleted-requirements",
    covers: ["band:B", "class:highValue", "list-layout"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body: body(
      "I need a short runbook for the queue drain.",
      "- it must not require a deploy",
      "- one operator, no pairing",
      "- fifteen minutes end to end",
    ) }],
    derivation: "Intent 40 + 18 constraints (\"must not\") + 18 layout (three list lines) = "
      + "76; no context marker and no acceptance marker. Efficiency 85. Model fit 80. "
      + "Composite = 0.5x76 + 0.3x85 + 0.2x80 = 79.5, rounded to 80. Grade B.",
    expected: { category: "highValue", dimensions: { intent: 76, efficiency: 85, modelFit: 80 }, composite: 80, grade: "B", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "c-flowing-paragraph-context-only",
    covers: ["band:C", "class:unclassified", "prose-without-layout"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body:
      "We are currently seeing the reconciliation job finish about forty minutes later than "
      + "it did last quarter and nobody has changed the query, so I would like a read on "
      + "where the extra time is going before I take it to the platform team." }],
    derivation: "Intent 40 + 18 context (\"we are currently seeing\") = 58. No colon-led "
      + "sections and no list, so layout does not fire. Efficiency 85, model fit 80. "
      + "Composite = 0.5x58 + 0.3x85 + 0.2x80 = 70.5, rounded to 71. Grade C. The category "
      + "is unclassified: intent 58 is under the 70 the high-value band needs, and nothing "
      + "here is inefficient, over-provisioned, or out of scope.",
    expected: { category: "unclassified", dimensions: { intent: 58, efficiency: 85, modelFit: 80 }, composite: 71, grade: "C", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "c-code-heavy-debug-request",
    covers: ["band:C", "class:unclassified", "large-code-block", "code_heavy"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body: body(
      "Here is the handler that times out. What is holding the connection open?",
      "```js",
      "export async function reconcile(queue, store) {",
      "  const batch = await queue.take(500);",
      "  for (const item of batch) {",
      "    const row = await store.find(item.id);",
      "    if (!row) continue;",
      "    await store.update(row.id, { state: 'settled', at: item.at });",
      "  }",
      "  return batch.length;",
      "}",
      "```",
    ) }],
    derivation: "The fenced block is cut out before anything is counted, so the prose is the "
      + "two sentences only. Intent 40 + 18 context (\"here is the\") = 58; no layout, "
      + "because the code lines are not prose lines. Efficiency 85, model fit 80. Composite "
      + "= 0.5x58 + 0.3x85 + 0.2x80 = 70.5, rounded to 71. Grade C, and the turn carries "
      + "code_heavy so a reader can see why intent is low.",
    expected: { category: "unclassified", dimensions: { intent: 58, efficiency: 85, modelFit: 80 }, composite: 71, grade: "C", unscoredTurns: 0, turnReasonCodes: [["code_heavy"]] },
  }),
  Object.freeze({
    id: "d-bare-request-no-structure",
    covers: ["band:D", "class:unclassified", "very-short-prompt"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body: "Take a look at the deploy pipeline and tell me why the last release took so long." }],
    derivation: "Nothing fires: no context marker, no constraint, no acceptance, no layout, "
      + "no hedges. Intent is the bare baseline 40, efficiency 85, model fit 80. Composite "
      + "= 0.5x40 + 0.3x85 + 0.2x80 = 61.5, rounded to 62. Grade D.",
    expected: { category: "unclassified", dimensions: { intent: 40, efficiency: 85, modelFit: 80 }, composite: 62, grade: "D", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "d-mostly-pasted-log",
    covers: ["band:D", "class:unclassified", "mostly-pasted-context", "paste_heavy"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body: body(
      "What is going on here?",
      "",
      logPaste(14),
    ) }],
    derivation: "The fourteen log lines are pasted context: they are cut out of the prose "
      + "denominator and no pattern runs over them. The prose is four words. Intent 40 + 8 "
      + "pasted-context = 48. Efficiency 85 (one question mark, not four). Model fit 80. "
      + "Composite = 0.5x48 + 0.3x85 + 0.2x80 = 65.5, rounded to 66. Grade D, with "
      + "paste_heavy on the turn.",
    expected: { category: "unclassified", dimensions: { intent: 48, efficiency: 85, modelFit: 80 }, composite: 66, grade: "D", unscoredTurns: 0, turnReasonCodes: [["paste_heavy"]] },
  }),
  Object.freeze({
    id: "d-pasted-corpus-with-short-ask",
    covers: ["band:D", "class:unclassified", "mostly-pasted-context"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body: body(
      "Summarise the themes.",
      "",
      pastedProse(9, "handover"),
    ) }],
    derivation: "Nine lines and well over 600 characters, so the block is read as material "
      + "carried in: it leaves the prose denominator, no pattern runs over it, and it "
      + "fires the pasted-context signal instead. The prose is the three-word question. "
      + "Intent 40 + 8 pasted-context = 48, efficiency 85, model fit 80. Composite = "
      + "0.5x48 + 0.3x85 + 0.2x80 = 65.5, rounded to 66. Grade D.",
    expected: { category: "unclassified", dimensions: { intent: 48, efficiency: 85, modelFit: 80 }, composite: 66, grade: "D", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "f-vague-short-request",
    covers: ["band:F", "class:unclassified", "very-short-prompt", "rate-signal"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body: "Can you fix it and make it better somehow?" }],
    derivation: "Eight prose units, under the 25-unit rate floor, so the rate is quoted "
      + "against 25. Three hedges fire the vague signal: 3 / 25 x 100 = 12 per window, "
      + "which saturates at 2, so the full weight applies. Intent 40 - 12 = 28. Efficiency "
      + "85, model fit 80. Composite = 0.5x28 + 0.3x85 + 0.2x80 = 55.5, rounded to 56. "
      + "Grade F.",
    expected: { category: "unclassified", dimensions: { intent: 28, efficiency: 85, modelFit: 80 }, composite: 56, grade: "F", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "f-out-of-scope-personal",
    covers: ["band:F", "class:outOfScope"],
    model: "gpt-4o-mini",
    turns: [{ role: "user", body: "Give me a recipe for a birthday dinner for eight people, nothing too fussy." }],
    derivation: "Intent 40 - 40 out-of-scope = 0. Efficiency 85. Model fit 80 (economy tier, "
      + "and thirteen prose units is nowhere near the 150 that would make it "
      + "under-provisioned). Composite = 0.5x0 + 0.3x85 + 0.2x80 = 41.5, rounded to 42. "
      + "Grade F, category out-of-scope because intent reached zero.",
    expected: { category: "outOfScope", dimensions: { intent: 0, efficiency: 85, modelFit: 80 }, composite: 42, grade: "F", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "f-reprompt-spiral",
    covers: ["band:F", "class:inefficient", "multi-turn"],
    model: "claude-sonnet-4",
    turns: [
      { role: "user", body: "The nightly export job fails and I need it working." },
      { role: "user", body: "Still not working. Try again, and no, I meant the staging cluster, not production." },
      { role: "user", body: "As I said, the token expires early. Try again." },
    ],
    derivation: "Turn 1: nothing fires, so 40 / 85 / 80. Turn 2: two repeat matches and one "
      + "correction match, each saturating against the 25-unit floor, so efficiency is "
      + "85 - 35 - 35 = 15. Turn 3: two repeat matches, efficiency 85 - 35 = 50. All three "
      + "turns are under the 20-unit weight floor, so each weighs 20 and the mean is "
      + "unweighted: intent 40, efficiency (85 + 15 + 50) / 3 = 50, model fit 80. Composite "
      + "= 0.5x40 + 0.3x50 + 0.2x80 = 51, grade F. The conversation's category is the worst "
      + "any turn earned, which is inefficient (turn 2 at efficiency 15).",
    expected: { category: "inefficient", dimensions: { intent: 40, efficiency: 50, modelFit: 80 }, composite: 51, grade: "F", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "f-trivial-rename-on-premium",
    covers: ["band:F", "class:overProvisioned", "model-fit-debit"],
    model: "gpt-4o",
    turns: [{ role: "user", body: "Rename this variable to invoiceTotal." }],
    derivation: "Intent 40, efficiency 85. Model fit 80 - 60 trivial-on-premium = 20; the "
      + "guard allows it because the turn is five prose units, well under the 60-unit "
      + "ceiling that separates an errand from a request that mentions renaming. Composite "
      + "= 0.5x40 + 0.3x85 + 0.2x20 = 49.5, rounded to 50. Grade F, category "
      + "over-provisioned because model fit fell under 50.",
    expected: { category: "overProvisioned", dimensions: { intent: 40, efficiency: 85, modelFit: 20 }, composite: 50, grade: "F", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "b-rename-inside-a-real-request",
    covers: ["band:B", "class:highValue", "guard-abstains"],
    model: "gpt-4o",
    turns: [{ role: "user", body: body(
      "Context: the ledger module uses three different names for the same amount and it is "
      + "costing us in review time. " + longProse(2, "rename"),
      "Constraints: do not use an automated codemod; I want to read every change.",
    ) }],
    derivation: "The word \"rename\" appears, but the turn is well past 60 prose units, so "
      + "the trivial-on-premium guard abstains and model fit stays at 80 — the request is "
      + "not an errand. Intent 40 + 18 context + 18 constraints + 18 layout = 94. "
      + "Efficiency 85. Model fit 80: over 60 units but under 150, so neither model-fit "
      + "signal applies. Composite = 0.5x94 + 0.3x85 + 0.2x80 = 88.5, rounded to 89, "
      + "grade B.",
    expected: { category: "highValue", dimensions: { intent: 94, efficiency: 85, modelFit: 80 }, composite: 89, grade: "B", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "b-substantive-on-economy",
    covers: ["band:B", "class:highValue", "model-fit-debit", "very-long-prompt"],
    model: "gpt-4o-mini",
    turns: [{ role: "user", body: body(
      "Context: we are running the reconciliation pipeline on a fixed nightly window and want it re-planned.",
      "Constraints: must not add a datastore.",
      "Acceptance criteria: a staged plan with a rollback per stage.",
      longProse(10, "replan"),
    ) }],
    derivation: "Intent 40 + 54 + 18 layout = 112, clamped to 100. Efficiency 85. Model fit "
      + "80 - 25 substantive-on-economy, because the request is over 150 prose units and "
      + "the model is an economy tier, = 55. Composite = 0.5x100 + 0.3x85 + 0.2x55 = 86.5, "
      + "rounded to 87. Grade B. Not over-provisioned: model fit 55 is above the 50 band, "
      + "which is deliberate — under-provisioning is a different mistake.",
    expected: { category: "highValue", dimensions: { intent: 100, efficiency: 85, modelFit: 55 }, composite: 87, grade: "B", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "f-scattered-questions",
    covers: ["band:F", "class:unclassified", "efficiency-debit"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body:
      "Why is the job slow? Should we shard it? Is the index still used? "
      + "Who owns the queue now?" }],
    derivation: "Four question marks in a turn well under 120 prose units fires the "
      + "scattered-questions signal. Intent 40, efficiency 85 - 10 = 75, model fit 80. "
      + "Composite = 0.5x40 + 0.3x75 + 0.2x80 = 58.5, rounded to 59. Grade F.",
    expected: { category: "unclassified", dimensions: { intent: 40, efficiency: 75, modelFit: 80 }, composite: 59, grade: "F", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "x-japanese-structured",
    covers: ["non-english", "language_uncertain", "unspaced-script"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body: body(
      "前提: 夜間の照合ジョブが先月より四十分遅く終わっています。",
      "制約: スキーマは変更できません。",
      "完了条件: 遅延の原因を説明する短い報告書。",
    ) }],
    derivation: "Every letter is non-Latin, so the vocabulary table is not trusted and the "
      + "turn is marked language_uncertain. Intent starts at the language-agnostic "
      + "baseline 58 and takes 18 for layout (three labelled lines) = 76. Efficiency 85 "
      + "and model fit 80, neither of which has a vocabulary signal that could fire. "
      + "Composite = 0.5x76 + 0.3x85 + 0.2x80 = 79.5, rounded to 80. Grade B. The turn is "
      + "scored, not dropped, and it says why it was scored this way.",
    expected: { category: "highValue", dimensions: { intent: 76, efficiency: 85, modelFit: 80 }, composite: 80, grade: "B", unscoredTurns: 0, turnReasonCodes: [["language_uncertain"]] },
  }),
  Object.freeze({
    id: "x-russian-plain",
    covers: ["non-english", "language_uncertain", "spaced-non-latin-script"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body:
      "Объясни, почему ночная сверка стала занимать на сорок минут больше, "
      + "и подскажи, что стоит проверить в первую очередь." }],
    derivation: "Cyrillic throughout: language_uncertain, no layout, so intent is the "
      + "language-agnostic baseline 58 with nothing added. Efficiency 85, model fit 80. "
      + "Composite = 0.5x58 + 0.3x85 + 0.2x80 = 70.5, rounded to 71. Grade C. Note what "
      + "this fixture protects: the same request in English with no structure scores 40, "
      + "so the uncertainty baseline is the statement that we did not read it rather than "
      + "a claim that it said nothing.",
    expected: { category: "unclassified", dimensions: { intent: 58, efficiency: 85, modelFit: 80 }, composite: 71, grade: "C", unscoredTurns: 0, turnReasonCodes: [["language_uncertain"]] },
  }),
  Object.freeze({
    id: "x-mixed-language",
    covers: ["mixed-language", "language_mixed", "credit-only-asymmetry"],
    model: "claude-sonnet-4",
    turns: [{ role: "user", body: body(
      "Context: 夜間の照合バッチが先月より四十分ほど遅く終わっています。The nightly batch is slower than last quarter.",
      "Constraints: must not change the schema. スキーマは変更できません。移行は今四半期には行いません。",
      "報告は短くまとめてください。原因の候補を三つ挙げてください。",
    ) }],
    derivation: "Between a fifth and four fifths of the letters are non-Latin, so the turn "
      + "is language_uncertain and language_mixed. Credits may still fire on the Latin "
      + "half and debits may not: intent 58 + 18 context + 18 constraints + 18 layout = "
      + "112, clamped to 100. Efficiency 85, model fit 80. Composite = 0.5x100 + 0.3x85 + "
      + "0.2x80 = 91.5, rounded to 92. Grade A.",
    expected: { category: "highValue", dimensions: { intent: 100, efficiency: 85, modelFit: 80 }, composite: 92, grade: "A", unscoredTurns: 0, turnReasonCodes: [["language_uncertain", "language_mixed"]] },
  }),
  Object.freeze({
    id: "x-code-only-turn",
    covers: ["no-prose", "unscored-turn", "large-code-block"],
    model: "claude-sonnet-4",
    turns: [
      { role: "user", body: body(
        "```py",
        "def reconcile(queue, store):",
        "    for item in queue.take(500):",
        "        store.update(item.id, state='settled')",
        "```",
      ) },
      { role: "user", body: body(
        "Context: that function is the one timing out.",
        "Acceptance criteria: name the line that blocks and say why.",
      ) },
    ],
    derivation: "Turn 1 is a fenced block and nothing else, so there is no prose to read: it "
      + "is reported unscored with reason no_prose and contributes to the corpus's "
      + "unclassified rate. It contributes nothing to the score in either direction. Turn "
      + "2 scores intent 40 + 18 context + 18 acceptance + 18 layout = 94, efficiency 85, "
      + "model fit 80, and is the only scored turn, so it is the conversation. Composite = "
      + "0.5x94 + 0.3x85 + 0.2x80 = 88.5, rounded to 89. Grade B.",
    expected: { category: "highValue", dimensions: { intent: 94, efficiency: 85, modelFit: 80 }, composite: 89, grade: "B", unscoredTurns: 1 },
  }),
  Object.freeze({
    id: "x-assistant-turns-ignored",
    covers: ["multi-turn", "roles", "class:highValue"],
    model: "gpt-4o",
    turns: [
      { role: "user", body: body(
        "Context: the retry budget is exhausted before the third attempt.",
        "Constraints: must not raise the total attempt count.",
        "Acceptance criteria: a bounded backoff with the numbers stated.",
      ) },
      { role: "assistant", body: "Here is a bounded exponential backoff with a cap, and the reasoning behind each number, plus a recipe for choosing the jitter." },
      { role: "user", body: body(
        "Context: applying that to the second queue as well.",
        "Expected output: the two constants and where they go.",
      ) },
    ],
    derivation: "The assistant turn is skipped with reason not_a_user_turn — including its "
      + "word \"recipe\", which would be leakage in a prompt and is not a prompt. Turn 1 "
      + "scores intent 100 (40 + 18 + 18 + 18 + 18 layout, clamped), turn 3 scores 40 + 18 "
      + "context + 18 acceptance + 18 layout = 94. Turn 1 is 27 prose units and weighs 27; "
      + "turn 3 is 18 units and is floored to 20. Intent = (100x27 + 94x20) / 47 = 4580 / "
      + "47 = 97.4468, published as 97.4. Efficiency 85, model fit 80. Composite = "
      + "0.5x97.4468 + 0.3x85 + 0.2x80 = 90.2, rounded to 90, grade A.",
    expected: { category: "highValue", dimensions: { intent: 97.4, efficiency: 85, modelFit: 80 }, composite: 90, grade: "A", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "x-very-long-well-formed",
    covers: ["very-long-prompt", "band:A", "length-does-not-inflate"],
    model: "gpt-4o",
    turns: [{ role: "user", body: body(
      "Context: replatforming the settlement service over two quarters.",
      "Constraints: must not change the external contract.",
      "Acceptance criteria: a phased plan with a named owner per phase.",
      longProse(40, "replatform"),
    ) }],
    derivation: "Roughly 1,400 prose units against the 51 of the first fixture, saying the "
      + "same three things. Because every intent credit is a presence signal it scores "
      + "exactly the same 100 on intent. Only model fit differs, at 80 + 20 = 100 for "
      + "being substantive work on a premium model. Composite = 0.5x100 + 0.3x85 + "
      + "0.2x100 = 95.5, rounded to 96, grade A — the same grade as the eight-step "
      + "version, which is the point: length buys the model-fit credit it can evidence "
      + "and nothing else.",
    expected: { category: "highValue", dimensions: { intent: 100, efficiency: 85, modelFit: 100 }, composite: 96, grade: "A", unscoredTurns: 0 },
  }),
  Object.freeze({
    id: "x-long-turn-outweighs-short-follow-up",
    covers: ["multi-turn", "aggregation-weighting"],
    model: "claude-sonnet-4",
    turns: [
      { role: "user", body: body(
        "Context: the settlement ledger disagrees with the provider statement by a few cents a day.",
        "Constraints: must not restate history; the fix has to be forward-only.",
        "Acceptance criteria: a reconciliation report that shows the drift and its source.",
        longProse(12, "reconciliation"),
      ) },
      { role: "user", body: "Try again." },
    ],
    derivation: "Turn 1 is 530 prose units and scores 100 / 85 / 80. Turn 2 is two units, "
      + "floored to a weight of 20, and scores 40 / 50 / 80 — one repeat match, saturating "
      + "against the 25-unit rate floor, takes the full 35 off efficiency. Intent = "
      + "(100x530 + 40x20) / 550 = 53800 / 550 = 97.8182, published as 97.8. Efficiency = "
      + "(85x530 + 50x20) / 550 = 46050 / 550 = 83.7273, published as 83.7. Model fit 80. "
      + "Composite = 0.5x97.8182 + 0.3x83.7273 + 0.2x80 = 90.03, rounded to 90, grade A. "
      + "That is the aggregation rule doing what its assumption says out loud: the "
      + "substantive opening turn carries the conversation and the one-line follow-up "
      + "still counts, for 3.6% of the weight. The category stays high-value because "
      + "efficiency 50 is not *under* 50 — one repeat is a repeat, and the inefficient "
      + "band is reserved for a turn that repeated and corrected.",
    expected: { category: "highValue", dimensions: { intent: 97.8, efficiency: 83.7, modelFit: 80 }, composite: 90, grade: "A", unscoredTurns: 0 },
  }),
]);

/** Ids, for a test that wants to name a fixture without importing the body. */
export const PROMPT_PROSE_CORPUS_IDS = Object.freeze(PROMPT_PROSE_CORPUS.map((f) => f.id));
