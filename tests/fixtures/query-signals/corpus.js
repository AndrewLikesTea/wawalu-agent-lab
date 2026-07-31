// The structural-signal fixture corpus: invented threads, hand-derived classes.
//
// PROVENANCE. Every turn below was written for this file. Nothing here is a real
// prompt, a real conversation, a real person, a real customer, or a real
// incident. The service names, ticket ids and hostnames are invented.
//
// WHAT THIS CORPUS IS FOR. It is the labelled input behind the two claims the
// classifier makes to a FinOps lead: that an ordinary enterprise mix classifies
// at a stated rate, and that the rate is not an artefact of English. So it is a
// mix on purpose — code review, ticket triage, a Japanese thread, a German
// thread, a correction spiral, an over-provisioned one-liner — and one record
// that SHOULD stay unclassified, because a corpus where everything classifies
// proves only that the floor is too low.
//
// HOW TO CHECK ONE BY HAND. Read `expect.why`, look each named signal up in
// `src/query-signal-families.js`, add the weights for the winning class, divide
// by the total weight cast. That is the confidence, to four places. No fixture
// below needs the implementation to be checked.
//
// LEAN ON PURPOSE. Bodies are as short as they can be and still fire the signal
// they are here for; a fixture corpus that has to be scrolled is one nobody
// audits, and this repository's build is under a byte budget.

const t = (role, body) => ({ role, body });
const user = (body) => t("user", body);
const bot = (body) => t("assistant", body);

export const QUERY_SIGNAL_CORPUS = Object.freeze([
  Object.freeze({
    id: "code-review-structured",
    note: "A code review request: context, constraints, a fenced diff, one turn.",
    model: "gpt-4o",
    turns: Object.freeze([user([
      "Context: the invoice reconciler drops rows when the ledger paginates.",
      "Constraints: must not change the public signature.",
      "Acceptance criteria: the added test fails on main and passes after.",
      "",
      "```js",
      "for (const page of pages) { rows.push(...page.rows); }",
      "```",
      "",
      "Please review the loop above for the pagination bug and say what you would change,",
      "keeping the change inside the reconciler module and out of the ledger client itself.",
      "The ledger client is shared with the payouts service, so a fix that changes how it",
      "pages would move a second team's numbers as well, which is not what we are asking for.",
      "If the safe fix turns out to sit in the client after all, say so and stop rather than",
      "writing it, and name the payouts owner we would have to agree the change with first.",
    ].join("\n"))]),
    expect: Object.freeze({
      classified: true,
      category: "highValue",
      families: Object.freeze(["keyword", "complexity-vs-tier", "language-independent"]),
      why: "Three keyword structure signals at 2 each, language-independent-labelled at 2, and "
        + "complexity-matched-tier at 2 — two of the three complexity points, being over 600 "
        + "characters and carrying a fenced block, on a premium model. All ten weight votes "
        + "are highValue, so the share is 10/10 = 1.",
    }),
  }),
  Object.freeze({
    id: "ticket-triage-enumerated",
    note: "Ticket triage: an enumerated request with no English quality markers.",
    model: "gpt-4o",
    turns: Object.freeze([user([
      "Sort these into severity order and say which owner each belongs to.",
      "1. OPS-4412 checkout latency above one second in the EU region",
      "2. OPS-4418 nightly ledger export missing the final batch of rows",
      "3. OPS-4421 password reset mail delayed by roughly nine minutes",
      "4. OPS-4425 admin search returns archived accounts to support agents",
    ].join("\n"))]),
    expect: Object.freeze({
      classified: true,
      category: "highValue",
      families: Object.freeze(["language-independent"]),
      why: "Four enumerated lines fire language-independent-enumerated at 1. Nothing else "
        + "votes, so the winning share is 1 — one signal, unanimous, low evidence but not "
        + "ambiguous. The floor is a share, not a weight total.",
    }),
  }),
  Object.freeze({
    id: "correction-spiral",
    note: "A multi-turn thread with corrections: the rework case, in English.",
    model: "gpt-4o",
    turns: Object.freeze([
      user("Write the SQL that totals refunds by region for last quarter."),
      bot("Here is a query grouping by region."),
      user("No, I meant refunds net of chargebacks."),
      bot("Updated to subtract chargebacks."),
      user("Still not right — the quarter boundary is off by a day."),
      bot("Adjusted the boundary."),
      user("As I said, the boundary is inclusive at the start and exclusive at the end."),
    ]),
    expect: Object.freeze({
      classified: true,
      category: "inefficient",
      families: Object.freeze(["keyword", "thread-repeat", "turn-depth"]),
      why: "Keyword repeat and correction at 3 each, thread-repeat-followup at 3, "
        + "thread-repeat-sustained at 2 (three follow-ups), turn-depth-extended at 2 (seven "
        + "turns). Every vote is inefficient, so the share is 1.",
    }),
  }),
  Object.freeze({
    id: "japanese-structured-review",
    note: "A Japanese design review. The keyword family cannot read it; two others can.",
    model: "gpt-4o",
    turns: Object.freeze([
      user([
        "背景: 請求バッチが月末に二重計上します。",
        "制約: 既存のスキーマは変更できません。",
        "完了条件: 再発防止のテストが通ること。",
        "この設計案をレビューして、どこを直すべきか指摘してください。",
      ].join("\n")),
      bot("バッチの冪等性を確認しました。"),
      user("集計キーの重複について、もう少し詳しく説明してください。"),
    ]),
    expect: Object.freeze({
      classified: true,
      category: "inefficient",
      families: Object.freeze(["thread-repeat", "language-independent"]),
      why: "thread-repeat-followup at 3 for inefficient against language-independent-labelled "
        + "at 2 for highValue: 3/5 = 0.6, exactly the floor, read with >=, so it classifies as "
        + "inefficient. THE DISPUTABLE ONE. The keyword family read nothing here — this class "
        + "rests entirely on a turn role and three colons — and a director who holds that one "
        + "follow-up is normal iteration is disputing THREAD_REPEAT_WEIGHT, which is the "
        + "argument worth having and the reason the weight is on the result.",
    }),
  }),
  Object.freeze({
    id: "german-structured-single-turn",
    note: "A German request with labelled structure and no follow-up.",
    model: "gpt-4o",
    turns: Object.freeze([user([
      "Kontext: Der Abrechnungsdienst liefert seit Dienstag Zeitüberschreitungen.",
      "Einschränkungen: Das Datenbankschema darf nicht geändert werden.",
      "Abnahmekriterien: Ein Regressionstest, der den Fehler nachweist.",
      "Bitte schlage eine Ursachenanalyse vor und nenne die drei wahrscheinlichsten Ursachen,",
      "geordnet nach Aufwand, damit das Team am Montag mit der günstigsten beginnen kann.",
    ].join("\n"))]),
    expect: Object.freeze({
      classified: true,
      category: "highValue",
      families: Object.freeze(["language-independent"]),
      why: "Three labelled lines fire language-independent-labelled at 2 for highValue and "
        + "nothing opposes it, so the share is 1. No English keyword rule matched.",
    }),
  }),
  Object.freeze({
    id: "trivial-on-premium",
    note: "A one-line mechanical edit sent to a premium model.",
    model: "gpt-4o",
    turns: Object.freeze([user("rename this variable to invoiceTotal")]),
    expect: Object.freeze({
      classified: true,
      category: "overProvisioned",
      families: Object.freeze(["keyword", "complexity-vs-tier"]),
      why: "The keyword tier rule at 3 and complexity-under-tier at 2 — a single turn of 41 "
        + "characters with no label, list or fence, on a premium model. Both vote "
        + "overProvisioned, so the share is 5/5 = 1. The structural family reached the same "
        + "answer the English one did, which is what makes the family worth having: the same "
        + "one-liner in Japanese still lands here.",
    }),
  }),
  Object.freeze({
    id: "trivial-on-economy",
    note: "The same words on an economy model. The tier families abstain, correctly.",
    model: "gpt-4o-mini",
    turns: Object.freeze([user("rename this variable to invoiceTotal")]),
    expect: Object.freeze({
      classified: false,
      category: "unclassified",
      families: Object.freeze([]),
      why: "Nothing fires: the keyword tier rule and complexity-vs-tier both abstain off "
        + "premium, the thread is one turn, and there is no labelled or enumerated line. "
        + "THIS IS THE DELIBERATE UNCLASSIFIED RECORD — routine cheap work that the rubric "
        + "has no evidence about, and inventing a class for it would be the failure.",
    }),
  }),
  Object.freeze({
    id: "long-unresolved-thread",
    note: "A thread that ran past the long boundary without a keyword marker.",
    model: "gpt-4o",
    turns: Object.freeze([
      user("Draft the migration plan for the reporting warehouse."),
      bot("Here is a three-phase plan."),
      user("Split phase two."),
      bot("Split into 2a and 2b."),
      user("Move the backfill earlier."),
      bot("Backfill moved."),
      user("Add the rollback path."),
      bot("Rollback added."),
      user("Put the cutover on a weekend."),
      bot("Cutover moved."),
    ]),
    expect: Object.freeze({
      classified: true,
      category: "inefficient",
      families: Object.freeze(["thread-repeat", "turn-depth"]),
      why: "thread-repeat-followup at 3, thread-repeat-sustained at 2, turn-depth-long at 3 "
        + "(ten turns). Every vote is inefficient. No English phrase was needed for any of "
        + "the three, which is the point of the structural families.",
    }),
  }),
  Object.freeze({
    id: "personal-leakage",
    note: "Off-task use, caught by the one family that reads words.",
    model: "gpt-4o",
    turns: Object.freeze([user("give me a recipe for a birthday dinner for eight people")]),
    expect: Object.freeze({
      classified: true,
      category: "outOfScope",
      families: Object.freeze(["keyword", "complexity-vs-tier"]),
      why: "out-of-scope-personal at 3 for outOfScope against complexity-under-tier at 2 for "
        + "overProvisioned: 3/5 = 0.6, the floor exactly, so it classifies as leakage. Both "
        + "readings are true — a recipe on a premium model is off-task AND over-provisioned — "
        + "and the weights are what decide which one is reported. If the two were equal the "
        + "record would tie at 0.5 and be left unclassified, which is why "
        + "COMPLEXITY_UNDER_TIER_WEIGHT is 2 and not 3.",
    }),
  }),
]);

/** The records the corpus asserts must classify. Read off the labels, never counted by hand. */
export const CORPUS_EXPECTED_CLASSIFIED =
  QUERY_SIGNAL_CORPUS.filter((record) => record.expect.classified).length;
