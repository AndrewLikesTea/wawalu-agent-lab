// Which rung of the trust ladder this brief is on (#1104).
//
// THE PROBLEM. This page will hand a reader a cost-per-successful-task figure
// before they have shown it a single file. That is deliberate — five facts they
// already know is a lower door than an export — but it leaves every figure on
// the first screen carrying an unstated qualifier, and the reader has to
// reconstruct it from the word "Estimated" at the front of one sentence. A
// number they can quote is a number they will quote, and the difference between
// "worth looking at" and "I can take this to finance" is not a tint.
//
// So there is ONE ladder with THREE rungs, always visible, never a disclosure:
//
//   declared   the five facts on this page are the bundled example's. Nothing
//              of the reader's has been modelled yet.
//   estimated  the reader declared their own five facts and a position was
//              modelled from them. No file of theirs was read.
//   verified   a figure was counted out of an export the reader brought.
//
// COLOUR IS NEVER THE CARRIER, and neither is position alone. Each rung says
//
//   ITS PLACE   "Rung 2 of 3", so a reader who sees one chip still knows how
//               many there are and which one this is,
//   ITS NAME    Declared · Estimated · Verified,
//   A SHAPE     ● for the rung this brief is on, ○ for the ones it is not, and
//   A WORD      "you are here" on the current rung and nothing on the others,
//
// on top of the silhouette the chip vocabulary already publishes. The rungs a
// brief is NOT on stay at full outline weight rather than being dimmed: they are
// the scale the current rung is read against, and a scale nobody can read is a
// chip that says "2 of 3" with no 1 and no 3 beside it.
//
// The silhouettes follow the Claude Design foundations card ("filled wash =
// dynamic signal, outline = static classification"): the rung this brief is on
// right now moves when the reader submits or imports, so it is the live signal
// and takes the wash; the other two are the fixed scale and take outlines. No
// new token, no new glyph and no new chip class is introduced — `.brief-provenance`
// and its three shipped silhouettes are the whole vocabulary.
//
// NOTHING HERE IS FOCUSABLE. The ladder, its support sentence and its promotion
// sentence are static text, and the promotion sentence NAMES the control that
// already exists rather than adding a second way to reach it: there is exactly
// one way into the five-fact intake on this page and exactly one way into an
// export preflight, and a link here would be a second trigger for a door the
// reader can already see. tests/finops-decision-interaction.test.js enumerates
// the region's tab stops exactly, and this block adds none of them.
//
// It reads no clock, makes no request, stores nothing, and interpolates no
// declared value into any string: every sentence below is authored, and the view
// writes them through textContent.

/** The ids the ladder owns. Nothing else writes them. */
export const TRUST_LADDER_IDS = Object.freeze({
  region: "finops-first-run",
  block: "finops-trust-ladder",
  heading: "finops-trust-ladder-heading",
  rungs: "finops-trust-ladder-rungs",
  support: "finops-trust-ladder-support",
  promotion: "finops-trust-ladder-promotion",
});

/** The three rungs. There is no fourth, and "unknown" is not one of them. */
export const TRUST_RUNG = Object.freeze({
  declared: "declared",
  estimated: "estimated",
  verified: "verified",
});

/** The heading, authored here and in evolution.html, so a drift is visible. */
export const TRUST_LADDER_HEADING = "How far this brief has been checked";

/**
 * NO GLYPH IS MINTED HERE, and that is a decision rather than an omission.
 *
 * This page runs one glyph vocabulary — diamonds are provenance, circles are
 * status, triangles are direction — and the filled/hollow circle pair that a
 * ladder reaches for first is already the difference between "measured" and
 * "none" on every status chip on the screen. Borrowing it would make ● mean two
 * things at 11px, which is the collision tests/evolution-glyph-roles.test.js
 * exists to refuse. The rung says its place IN WORDS instead — "Rung 2 of 3" —
 * and the current one is additionally marked by the chip's own filled
 * silhouette, so there are three non-colour channels and no seventh mark.
 */

/** The word that says which chip is this brief's, in text rather than in fill. */
export const RUNG_HERE = "you are here";

/**
 * The ladder, in order.
 *
 * `supports` and `withholds` are one sentence each and they are the point of the
 * whole block: a rung that says what it is good for without saying what it is
 * not good for is a badge, and a badge is what a reader quotes past.
 *
 * `promotion` is ONE step and it names a control that is already on this page.
 */
export const TRUST_RUNGS = Object.freeze([
  Object.freeze({
    rung: TRUST_RUNG.declared,
    ordinal: 1,
    name: "Declared",
    supports: "A declared fact supports a shared starting point — what your org"
      + " says is true of itself, written down where everyone can see it.",
    withholds: "It does not support a figure of yours, because nothing on this"
      + " screen has been modelled from your answers yet: the five facts above"
      + " are still the bundled example's.",
    promotion: "One step up: answer the five facts above and press \"Estimate"
      + " from these five facts\" to reach Estimated.",
  }),
  Object.freeze({
    rung: TRUST_RUNG.estimated,
    ordinal: 2,
    name: "Estimated",
    supports: "An estimate supports a direction-of-travel decision — whether"
      + " this is worth looking at.",
    withholds: "It does not support an audited claim, because no invoice and no"
      + " export of yours was read.",
    promotion: "One step up: choose \"Analyze your own export\" above and let the"
      + " evidence preflight check the file to reach Verified.",
  }),
  Object.freeze({
    rung: TRUST_RUNG.verified,
    ordinal: 3,
    name: "Verified",
    supports: "A verified figure supports a claim you can put in front of"
      + " finance, because it was counted out of an export you brought and"
      + " checked before it was used.",
    withholds: "It does not support a booked saving, because nothing here has"
      + " been reconciled against a later invoice.",
    promotion: "This is the top rung of this ladder. A realized saving is"
      + " reconciled against a later invoice on the commitment record, which is"
      + " a different claim from a verified figure.",
  }),
]);

/** How many rungs there are, so no sentence has to hardcode it twice. */
export const RUNG_COUNT = TRUST_RUNGS.length;

/**
 * One rung's descriptor. An unrecognised rung reads as the BOTTOM one, never as
 * the top: labelling a brief "Verified" on a guess is the one error this ladder
 * cannot be allowed to make.
 */
export const rungDescriptor = (rung) =>
  TRUST_RUNGS.find((entry) => entry.rung === rung) ?? TRUST_RUNGS[0];

/** "Rung 2 of 3", the place said in words rather than left to a fill. */
export const rungPlaceLabel = (rung) =>
  `Rung ${rungDescriptor(rung).ordinal} of ${RUNG_COUNT}`;

/**
 * The rung a brief has EARNED, from what has actually been read.
 *
 * Evidence first, then a declaration, then nothing — and the order matters: an
 * import outranks a declaration because it is the reader's own file, and a
 * figure outside every plausible band does not change which of those two
 * happened. An implausible input is refused where it is formatted; it does not
 * promote or demote a rung, and it must never leave the ladder claiming a rung
 * that no file and no answer paid for.
 */
export function rungFor({ importedEvidence = false, declaredEstimate = false } = {}) {
  if (importedEvidence) return TRUST_RUNG.verified;
  if (declaredEstimate) return TRUST_RUNG.estimated;
  return TRUST_RUNG.declared;
}

/**
 * What a reader who cannot see the ladder is told when it moves: the place, the
 * name, and the one thing the new rung will not carry. Not the promotion step —
 * that is on the page for them to read at their own pace, and a live region that
 * reads out an instruction is one that talks over the figure it belongs to.
 */
export function rungAnnouncement(rung) {
  const entry = rungDescriptor(rung);
  return `${rungPlaceLabel(entry.rung)}: ${entry.name}. ${entry.withholds}`;
}

/**
 * The rung each document was last TOLD about, so a revision inside one rung is
 * silent.
 *
 * A polite region rewritten with the same fact is a screen reader repeating
 * itself over whatever the reader was already hearing — and on this page a
 * revision repaints on every submit, so "announce the rung" without this
 * comparison means announcing it on every keystroke a reader commits. Held per
 * document in a WeakMap rather than in one module-wide value, because a test
 * page and a real page are two documents with two ladders.
 */
const ANNOUNCED = new WeakMap();

/** What this document was last told, or nothing if it has been told nothing. */
export const announcedRung = (doc) => ANNOUNCED.get(doc) ?? null;

/**
 * Record the rung a paint put on screen WITHOUT announcing it.
 *
 * The boot paint goes through here. A reader who has just loaded the page is
 * reading the ladder, not being told it changed, and seeding the comparison is
 * what makes the first real change the first thing anybody hears.
 */
export function seedAnnouncedRung(doc, rung) {
  if (doc) ANNOUNCED.set(doc, rung);
  return rung;
}

/**
 * The sentence to speak for a rung change, or `null` when the rung has not moved.
 *
 * `null` IS THE CONTRACT, not an absence of one: the caller writes nothing at
 * all when it gets null, so a same-rung revision leaves the live region holding
 * whatever the figures themselves said and adds no second announcement to it.
 */
export function rungChangeAnnouncement(doc, rung) {
  const settled = rungDescriptor(rung).rung;
  if (announcedRung(doc) === settled) return null;
  seedAnnouncedRung(doc, settled);
  return rungAnnouncement(settled);
}

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/** One rung chip: its place, its name, and — on the current one — the word. */
function rungChip(doc, entry, current) {
  const chip = doc.createElement("span");
  chip.className = "brief-provenance";
  chip.dataset.rung = entry.rung;
  chip.dataset.current = current ? "true" : "false";
  // Filled wash for the rung this brief is on, outline for the scale it is read
  // against. Never dashed: a rung the brief has not reached is not an absence,
  // it is the next thing to earn.
  chip.dataset.silhouette = current ? "filled" : "outline";
  chip.dataset.tone = current ? "import" : "neutral";
  const label = doc.createElement("span");
  label.className = "brief-provenance-label";
  label.textContent = `${rungPlaceLabel(entry.rung)} · ${entry.name}`
    + (current ? ` · ${RUNG_HERE}` : "");
  chip.replaceChildren(label);
  return chip;
}

/**
 * Paint the ladder for one rung.
 *
 * REPAINT, NEVER REPLACE, of nodes evolution.html authors: the block, its
 * heading and its two sentences ship in the document in the Declared state, so a
 * reader whose script never ran meets a complete, true ladder rather than an
 * empty box. Only the three chips are built here, and none of them is focusable.
 *
 * @returns the rung it painted, so a caller can assert on it.
 */
export function applyTrustLadder(doc, rung = TRUST_RUNG.declared) {
  const block = byId(doc, TRUST_LADDER_IDS.block);
  if (!block) return null;
  const entry = rungDescriptor(rung);
  block.dataset.rung = entry.rung;
  block.dataset.ordinal = String(entry.ordinal);
  const heading = byId(doc, TRUST_LADDER_IDS.heading);
  if (heading) heading.textContent = TRUST_LADDER_HEADING;
  const rungs = byId(doc, TRUST_LADDER_IDS.rungs);
  if (rungs) {
    rungs.replaceChildren(...TRUST_RUNGS.map((step) =>
      rungChip(doc, step, step.rung === entry.rung)));
  }
  const support = byId(doc, TRUST_LADDER_IDS.support);
  if (support) support.textContent = `${entry.supports} ${entry.withholds}`;
  const promotion = byId(doc, TRUST_LADDER_IDS.promotion);
  if (promotion) promotion.textContent = entry.promotion;
  return entry.rung;
}

/**
 * What the page itself says has been read, off the region's own state.
 *
 * BOTH FLAGS LIVE ON THE REGION, and that is the point. The import flag is the
 * `data-source` the first-run view already sets when a reader's export
 * supersedes the example; the declaration flag is written beside it by whoever
 * paints the intake. Reading them back out of the DOM rather than out of a
 * module value is what stops the ladder and the region it sits in from
 * disagreeing about what has been read — including on the path where an import
 * is cleared and the region has to fall back to whichever rung was underneath.
 */
export function readTrustEvidence(doc) {
  const region = byId(doc, TRUST_LADDER_IDS.region);
  return {
    importedEvidence: region?.dataset?.source === "imported",
    declaredEstimate: region?.dataset?.declaredEstimate === "true",
  };
}

/**
 * Record whether the figures on screen are modelled from the READER's five
 * facts or still from the bundled example's.
 *
 * It is a comparison against the example rather than a "they pressed submit"
 * flag on purpose: the answer spine repaints as they type, so a ladder keyed to
 * the button would sit under their own numbers still calling them the example's.
 */
export function setDeclaredEstimate(doc, declared) {
  const region = byId(doc, TRUST_LADDER_IDS.region);
  if (region) region.dataset.declaredEstimate = declared ? "true" : "false";
  return Boolean(declared);
}

/** The rung the page's own state currently earns. */
export const currentTrustRung = (doc) => rungFor(readTrustEvidence(doc));

/** Repaint the ladder from that state. The one call site a repaint needs. */
export const refreshTrustLadder = (doc) => applyTrustLadder(doc, currentTrustRung(doc));
