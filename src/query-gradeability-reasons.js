// Why a department is not gradeable: the closed codes, and the sentence for each.
//
// WHY THIS IS ITS OWN FILE. These three values were declared in
// `query-literacy.js` and are still that module's — nothing here decides
// anything, and the analysis that emits these codes is still written there. They
// moved to a leaf so a surface that only needs to RENDER a reason does not have
// to import the analysis to read one: `query-literacy.js` reaches the rubric,
// the classifier, the sampler and the prose segmenter, which is ~60 KiB the
// answer region on /evolution.html would otherwise have paid on its initial
// payload for four English sentences. `query-signal-families.js` was split out
// of the classifier for the same reason and states the same rule.
//
// This file holds integers and authored English and imports nothing. Anything
// that needs to look at a record belongs in `query-literacy.js`.

/**
 * The fewest classified-and-joined records a department may be graded on.
 *
 * Five, because the rubric's composite is a share-of-queries number: under five
 * records a single query moves the composite by twenty points or more, so the
 * letter would describe the sample rather than the department. This is a
 * judgement about sampling noise, not a measured confidence interval, and it is
 * stated here rather than buried in a branch so it can be argued with.
 */
export const MIN_JOINED_RECORDS_FOR_GRADE = 5;

/** Why a department is not gradeable. Closed, machine-readable, never prose. */
export const NOT_GRADEABLE_REASONS = Object.freeze({
  noSampledQueries: "no_sampled_queries",
  noClassifiedQueries: "no_classified_queries",
  noBillingMatch: "no_billing_match",
  insufficientJoinedSample: "insufficient_joined_sample",
});

/**
 * Human copy per not-gradeable code. Held beside the code so a surface renders a
 * sentence it did not assemble, and so the code stays the thing consumers branch
 * on. Reword freely; changing what a code *means* is a version bump.
 */
export const NOT_GRADEABLE_COPY = Object.freeze({
  [NOT_GRADEABLE_REASONS.noSampledQueries]:
    "No imported query sampled this department.",
  [NOT_GRADEABLE_REASONS.noClassifiedQueries]:
    "Every sampled query for this department fell below the classification confidence floor.",
  [NOT_GRADEABLE_REASONS.noBillingMatch]:
    "No sampled query names a department and model the billing export also bills.",
  [NOT_GRADEABLE_REASONS.insufficientJoinedSample]:
    `Fewer than ${MIN_JOINED_RECORDS_FOR_GRADE} classified queries joined to billing for this department.`,
});
