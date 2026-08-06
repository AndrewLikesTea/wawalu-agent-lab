// The labelled fixture behind the recoverable-figure confidence grade (#1186).
//
// A TABLE, SO A FOURTH CASE IS A DATA EDIT. Each row is one labelled input with
// the grade it must produce and the reason content it must carry. The test
// iterates this list; nothing about a case is expressed as code.
//
// Every `input` is the shape `gradeExport()` publishes — coverage plus the
// provenance counts of what was read against what counted — and nothing else,
// because that is the only input the rubric reads. The numbers are invented for
// the fixture; no reader's file and no bundled figure is copied in here.
//
//   expected_grade                the one grade this input must produce
//   expected_held_down_by         which inputs are not clean, in report order
//   expected_would_raise          which inputs must move for the next grade
//   expected_next_grade           the grade those inputs would reach, or null
//   expected_reason_fragments     substrings the reason text must state, so a
//                                 grade that survives with the wrong measurement
//                                 quoted beside it still fails

export const CONFIDENCE_CASES = Object.freeze([
  {
    name: "full scored coverage",
    input: {
      coverage: 0.94,
      provenance: { rows: 4, scored: 4, unscored: 0, unpriced: 0 },
    },
    expected_grade: "high",
    expected_next_grade: null,
    expected_held_down_by: [],
    expected_would_raise: [],
    expected_reason_fragments: [],
  },
  {
    name: "partial coverage",
    input: {
      coverage: 0.62,
      provenance: { rows: 5, scored: 3, unscored: 2, unpriced: 0 },
    },
    expected_grade: "moderate",
    expected_next_grade: "high",
    expected_held_down_by: ["scored_spend_coverage"],
    expected_would_raise: ["scored_spend_coverage"],
    // 62% measured, 80% claimed from, 18% of spend still to score.
    expected_reason_fragments: ["62%", "80%", "18%"],
  },
  {
    name: "billing-only export",
    input: {
      coverage: 0,
      provenance: { rows: 4, scored: 0, unscored: 4, unpriced: 0 },
    },
    expected_grade: "low",
    expected_next_grade: "moderate",
    // Two inputs are not clean; only the coverage one binds at Low, so only it
    // is what has to move for Moderate.
    expected_held_down_by: ["scored_spend_coverage", "scored_departments"],
    expected_would_raise: ["scored_spend_coverage"],
    expected_reason_fragments: ["0%", "50%", "0 scored departments"],
  },
  {
    name: "partial coverage with unpriced departments",
    input: {
      coverage: 0.85,
      provenance: { rows: 6, scored: 4, unscored: 2, unpriced: 2 },
    },
    // Coverage alone would allow High; the partial invoice under it does not.
    expected_grade: "moderate",
    expected_next_grade: "high",
    expected_held_down_by: ["priced_departments"],
    expected_would_raise: ["priced_departments"],
    expected_reason_fragments: ["2 of the 6 departments read carry no spend"],
  },
  {
    name: "no spend total at all",
    input: { coverage: null, provenance: { rows: 3, scored: 0, unscored: 3, unpriced: 3 } },
    expected_grade: "low",
    expected_next_grade: "moderate",
    expected_held_down_by: [
      "scored_spend_coverage", "scored_departments", "priced_departments",
    ],
    expected_would_raise: ["scored_spend_coverage"],
    expected_reason_fragments: ["no spend total"],
  },
]);
