/**
 * The AI literacy card, read in one glance (#998).
 *
 * The card already published a 66px letter. What it never published was the
 * three things that decide whether the letter may be acted on: how much of the
 * money was graded, how confident that makes the letter, and which band the
 * letter sits in. Coverage was a sentence, confidence was a clause buried at
 * the end of it, and the band existed only as a tint on the glyph — which is
 * colour carrying meaning alone, and is gone in a greyscale screenshot, in
 * Windows high-contrast, and for the eight percent of men who cannot separate
 * the amber from the green.
 *
 * So this module owns four slots and their order:
 *
 *   score-grade → score-coverage → score-confidence → score-band
 *
 * The letter is dominant; coverage and confidence are immediately subordinate
 * to it; the band label closes the block. That order is document order, not a
 * visual arrangement, so it is also the order a screen reader and a keyboard
 * meet the card in. `LITERACY_SLOT_IDS` is the published list, and
 * tests/finops-literacy-card.test.js holds the page to it.
 *
 * TWO RULES THIS MODULE KEEPS:
 *
 * 1. NO SLOT IS EVER REMOVED. Loading, empty, withheld, error, and the
 *    implausible extremes are all the same four nodes saying different words.
 *    A state that deletes a node is a state that reflows the card under a
 *    reader mid-sentence, and it is a state no test can find.
 * 2. NO SLOT IS TOLD BY COLOUR. The band ships a word and a numeric range;
 *    confidence ships a word and the threshold it was decided by; coverage
 *    leads with its own percentage. Every one of them survives greyscale on
 *    its own, before the tint is a third redundant carrier.
 *
 * Deliberately NOT here: any announcement. The page speaks through exactly one
 * region (`finops-stand-live`), which sits in always-rendered markup outside
 * every disclosure on the page. A second announcer inside this card would make
 * one import speak twice, and a live region nested inside a closed disclosure
 * is silent in a real browser while reading fine to a test harness.
 */

/** The four slots, in the order the card must emit them. */
export const LITERACY_SLOT_IDS = Object.freeze([
  "score-grade", "score-coverage", "score-confidence", "score-band",
]);

/** The attribute the four slots are collected by. Order is document order. */
export const LITERACY_SLOT_ATTRIBUTE = "data-literacy-slot";

/**
 * The band a published score sits in, as a word and the range that defined it.
 * The thresholds are the page's own (`band()` in evolution-page.js); they are
 * repeated here as text so a reader can dispute the boundary without opening a
 * branch, which is the same reason `COVERAGE_TIERS` publishes its floors.
 */
export const LITERACY_BANDS = Object.freeze({
  good: Object.freeze({ key: "good", word: "Good", range: "score 80–100" }),
  watch: Object.freeze({ key: "watch", word: "Watch", range: "score 65–79" }),
  poor: Object.freeze({ key: "poor", word: "Poor", range: "score 0–64" }),
  review: Object.freeze({ key: "review", word: "Under review", range: "no letter published" }),
});

/**
 * Confidence, by the coverage tier that produced it. The word first, then the
 * threshold it was decided by — a reader who disagrees with "Moderate" can see
 * the rule that assigned it without opening the disclosure.
 */
export const LITERACY_CONFIDENCE = Object.freeze({
  high: "High · at least 80% of spend graded",
  moderate: "Moderate · half to four-fifths of spend graded",
  provisional: "Provisional · a quarter to a half graded, not actionable alone",
  insufficient: "Not established · under a quarter of spend graded",
  no_baseline: "Not established · no spend total to divide by",
});

/** Before any input has been read at all. Not a measured zero. */
export const LITERACY_CONFIDENCE_PENDING = "Not established yet · no scored sample read";

/** Said when covered spend arrived larger than the total it is a share of. */
export const LITERACY_CLAMP_NOTE =
  "Graded spend arrived larger than the total; coverage is clamped to 100%";

/** The disclosure's collapsed line when the card has no department list yet. */
export const LITERACY_DETAIL_EMPTY = "Per-department scores and the rubric · no departments read yet";

const percent = (ratio) => `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%`;

/** The band record for a key, falling back to the withheld band. */
export function literacyBand(key) {
  return LITERACY_BANDS[key] ?? LITERACY_BANDS.review;
}

/**
 * The two-to-three drivers behind the letter, visible without expanding
 * anything. Ranked: what the rubric found, then what it could not reach.
 *
 * A driver is only named when its figure exists. An import with no mix and no
 * departments yields one honest sentence rather than three empty clauses.
 */
export function literacyDrivers({ mix = null, departments = [], coverage = null } = {}) {
  const drivers = [];
  const shares = mix && typeof mix === "object" ? mix : null;
  if (shares && Number.isFinite(Number(shares.highValue))) {
    drivers.push(`${percent(Number(shares.highValue))} of scored prompts were high-value work`);
  }
  if (shares) {
    const rest = [
      ["over-provisioned models", Number(shares.overProvisioned)],
      ["inefficient prompting", Number(shares.inefficient)],
      ["out-of-scope use", Number(shares.outOfScope)],
    ].filter(([, share]) => Number.isFinite(share) && share > 0)
      .sort((left, right) => right[1] - left[1]);
    if (rest[0]) drivers.push(`${percent(rest[0][1])} was ${rest[0][0]}`);
  }
  const list = Array.isArray(departments) ? departments : [];
  const ungraded = list.filter((entry) => !entry?.graded).length;
  if (list.length > 0) {
    drivers.push(ungraded === 0
      ? `all ${list.length} departments carried a scored sample`
      : `${ungraded} of ${list.length} departments carried no scored sample`);
  } else if (Number.isFinite(coverage)) {
    drivers.push(`${percent(coverage)} of spend sits in a graded department`);
  }
  return Object.freeze(drivers.slice(0, 3));
}

/**
 * Assemble everything the card says below the letter.
 *
 * @param {object} input
 * @param {string|null} input.tier      a `COVERAGE_TIERS` key, or null when nothing was read
 * @param {string} input.band           a `LITERACY_BANDS` key
 * @param {boolean} input.clamped       covered spend exceeded the baseline
 * @param {object|null} input.mix       the scored category mix, as shares in [0,1]
 * @param {Array} input.departments     `{name, graded, score}` rows, already ordered
 * @param {number|null} input.coverage  the raw coverage ratio, for the driver fallback
 * @param {string} input.rule           the eligibility rule this tier was decided by
 * @param {string|null} input.confidence a confidence line stated by the caller. The
 *   imported corpus grades on its own scored-record tiers rather than on spend
 *   coverage, so it hands the already-named level over instead of being mapped
 *   onto a tier table that never decided it.
 */
export function literacyCardModel({
  tier = null, band = "review", clamped = false, mix = null,
  departments = [], coverage = null, rule = "", confidence: stated = null,
} = {}) {
  const bandRecord = literacyBand(band);
  const named = typeof stated === "string" && stated.trim() ? stated.trim() : null;
  const confidence = named
    ?? (tier && LITERACY_CONFIDENCE[tier] ? LITERACY_CONFIDENCE[tier] : LITERACY_CONFIDENCE_PENDING);
  const rows = (Array.isArray(departments) ? departments : [])
    .map((entry) => Object.freeze({
      name: String(entry?.name ?? "").trim(),
      graded: Boolean(entry?.graded),
      // A number out of 100, never a letter: this text sits inside a closed
      // disclosure, and a letter in there would read as a second published
      // grade to anything that walks the card's text.
      line: `${String(entry?.name ?? "").trim()} · ${entry?.graded
        && Number.isFinite(Number(entry?.score))
        ? `${Math.round(Number(entry.score))} / 100` : "Not graded"}`,
    }))
    .filter((entry) => entry.name);
  const drivers = literacyDrivers({ mix, departments, coverage });
  return Object.freeze({
    band: bandRecord,
    bandLine: `${bandRecord.word} · ${bandRecord.range}`,
    confidence: clamped ? `${confidence} · ${LITERACY_CLAMP_NOTE}` : confidence,
    why: drivers.length
      ? `Why this letter: ${drivers.join("; ")}.`
      : "Why this letter: no scored sample has been read, so no driver can be named yet.",
    detail: Object.freeze({
      summary: rows.length
        ? `Per-department scores and the rubric · ${rows.length} `
          + `${rows.length === 1 ? "department" : "departments"}`
        : LITERACY_DETAIL_EMPTY,
      rows,
      rule: String(rule ?? ""),
    }),
  });
}

/**
 * Paint the card.
 *
 * Every node written here is authored in evolution.html, so this writes text
 * and attributes and never creates or removes a slot. The disclosure's list is
 * the one exception and it is replaced in place: the details element itself,
 * its summary, and its open state all survive the repaint, so a reader who had
 * it open still has it open and focus is never stranded on a removed node.
 */
export function applyLiteracyCard(doc, model) {
  if (!doc?.getElementById || !model) return null;
  const write = (id, text) => {
    const node = doc.getElementById(id);
    if (node) node.textContent = text;
    return node;
  };
  write("score-confidence", model.confidence);
  write("score-band", model.bandLine);
  write("score-why", model.why);
  write("score-detail-summary", model.detail.summary);
  write("score-detail-rule", model.detail.rule);
  const rule = doc.getElementById("score-detail-rule");
  if (rule) rule.hidden = !model.detail.rule;
  const list = doc.getElementById("score-detail-list");
  if (list) {
    list.replaceChildren(...(model.detail.rows.length
      ? model.detail.rows.map((row) => {
        const item = doc.createElement("li");
        item.dataset.graded = String(row.graded);
        item.textContent = row.line;
        return item;
      })
      : [(() => {
        const item = doc.createElement("li");
        item.textContent = "No department has been read yet.";
        return item;
      })()]));
  }
  const card = doc.getElementById("score-card");
  if (card) card.dataset.confidenceTier = model.band.key;
  return model;
}
