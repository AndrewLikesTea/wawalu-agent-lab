// Prompt-body segmentation: a messy real prompt in, derived signals out.
//
// The excerpt classifier could assume its input was one short sentence. A
// director's own prompt is not that. It is four turns long, half of it is a
// stack trace, a third of it is a pasted spreadsheet, and some of it is not in
// English. Scoring that as one undifferentiated blob is how a 4,000-character
// paste beats a well-formed request, so nothing here scores anything: this
// module only says which part of a body is prose, which part was carried in,
// and how much of each there is.
//
// PRIVACY. `segmentPromptBody` returns the prose text in a field the classifier
// consumes and never publishes (`proseText`), alongside a `signals` object that
// is numbers and booleans only. `signals` is the half that travels into a
// reasons payload; `proseText` is a local that dies when the classifier returns.
// The same split Anya's conversation contract makes between a prompt column and
// `prompt_chars` — a count sizes a prompt, and a count is not the prompt.
//
// NO SOURCE. Every threshold below is a judgement about how people write
// requests, not a measurement of a corpus. Each carries the assumption that
// justifies it, so a director who disagrees can name the constant.

/**
 * A block of at least this many lines *and* this many characters is treated as
 * material the requester pasted rather than prose the requester composed.
 *
 * ASSUMPTION: eight lines and 600 characters is longer than any single
 * paragraph this rubric expects someone to type into a prompt by hand. Past it,
 * the likeliest reading is that the block was carried in from somewhere else.
 * A wrong call here removes the block from the numerator *and* the denominator
 * — a signal inside it stops firing at the same moment it stops counting toward
 * length — so a misread block cannot silently move a score in one direction.
 */
export const PASTED_BLOCK_MIN_LINES = 8;
export const PASTED_BLOCK_MIN_CHARS = 600;

/**
 * A shorter block still counts as pasted when it *looks* verbatim: at least
 * this share of its lines match a log, table, quote, or key/value shape.
 *
 * ASSUMPTION: three lines of `2026-07-01T09:00:00Z ERROR ...` is a log paste at
 * any length. Shape is stronger evidence than size, so it is allowed to fire
 * earlier — but a majority of lines has to agree, because one delimiter-heavy
 * sentence inside a paragraph is a sentence.
 */
export const VERBATIM_BLOCK_MIN_LINES = 3;
export const VERBATIM_LINE_SHARE = 0.5;

/**
 * Characters of an unspaced script (Han, Kana, Hangul, Thai) that count as one
 * prose unit.
 *
 * ASSUMPTION: those scripts write no word boundaries, so splitting on
 * whitespace reads a 400-character Japanese request as three words and then
 * grades it as if the director had typed three words. Two characters per unit
 * is the coarse convention this repository picked to make length comparable
 * across scripts. It is an approximation and is declared as one — it sizes a
 * request, it does not tokenize it.
 */
export const UNSPACED_CHARS_PER_PROSE_UNIT = 2;

/**
 * Above this share of non-Latin letters, the English pattern table is not
 * trusted to read the turn and the language-agnostic path takes over.
 *
 * ASSUMPTION: a fifth of the letters is well past the point where a Latin-only
 * rule table is measuring the prompt rather than the alphabet. Set low on
 * purpose: the cost of crossing it early is that a turn is graded on structure
 * instead of vocabulary, and the cost of crossing it late is that a Japanese
 * prompt is quietly graded as if it said nothing — which is the failure this
 * whole module exists to stop.
 */
export const NON_LATIN_SCRIPT_THRESHOLD = 0.2;

/** Above this share, the turn is not mixed — it is simply another language. */
export const NON_LATIN_DOMINANT_THRESHOLD = 0.8;

/** Named scripts, coarsest useful granularity. Reported as an id, never as text. */
const SCRIPTS = Object.freeze([
  Object.freeze({ id: "han", pattern: /\p{Script=Han}/gu, unspaced: true }),
  Object.freeze({ id: "hiragana", pattern: /\p{Script=Hiragana}/gu, unspaced: true }),
  Object.freeze({ id: "katakana", pattern: /\p{Script=Katakana}/gu, unspaced: true }),
  Object.freeze({ id: "hangul", pattern: /\p{Script=Hangul}/gu, unspaced: true }),
  Object.freeze({ id: "thai", pattern: /\p{Script=Thai}/gu, unspaced: true }),
  Object.freeze({ id: "cyrillic", pattern: /\p{Script=Cyrillic}/gu, unspaced: false }),
  Object.freeze({ id: "arabic", pattern: /\p{Script=Arabic}/gu, unspaced: false }),
  Object.freeze({ id: "devanagari", pattern: /\p{Script=Devanagari}/gu, unspaced: false }),
  Object.freeze({ id: "hebrew", pattern: /\p{Script=Hebrew}/gu, unspaced: false }),
  Object.freeze({ id: "greek", pattern: /\p{Script=Greek}/gu, unspaced: false }),
]);

const UNSPACED_SCRIPT_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** A line that reads as carried-in material rather than as composed prose. */
const VERBATIM_LINE = [
  /^\s*\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,              // a timestamped log line
  /^\s*>/,                                              // quoted material
  /^[^\t]*\t[^\t]*\t/,                                  // two or more tab columns
  /^[^,]{1,40}(,[^,]{0,40}){3,}$/,                      // four or more csv columns
  /^[^|]*\|[^|]*\|/,                                    // a piped table row
  /^\s*[A-Za-z_][\w.-]{0,40}\s*[=:]\s*\S+\s*$/,         // a key=value dump line
  /^\s*(at |Traceback|File "|\s{2,}at )/,               // a stack frame
];

const FENCED_CODE = /^[ \t]*(```|~~~)/;
const INDENTED_CODE = /^(?: {4}|\t)\S/;
const LABELLED_LINE = /^\s*[^\s:][^:]{0,40}:\s*\S/;
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+\S/;

function isVerbatimLine(line) {
  return VERBATIM_LINE.some((pattern) => pattern.test(line));
}

/**
 * Split into whole code blocks (fenced or indented) and everything else.
 *
 * Returns each block as its own string so the count is a count of blocks, not
 * of runs that happened to be adjacent after the prose between them was pulled
 * out. An unclosed fence swallows the rest of the turn, which is the same thing
 * every markdown renderer does and is the conservative reading: text the author
 * marked as code is not prose.
 */
function extractCode(lines) {
  const blocks = [];
  const rest = [];
  let fencedRun = null;
  let indentedRun = [];
  const flushIndented = () => {
    // A single indented line is a hanging continuation, not a code block.
    if (indentedRun.length >= 2) blocks.push(indentedRun.join("\n"));
    else rest.push(...indentedRun);
    indentedRun = [];
  };
  for (const line of lines) {
    if (fencedRun) {
      fencedRun.push(line);
      if (FENCED_CODE.test(line)) { blocks.push(fencedRun.join("\n")); fencedRun = null; }
      continue;
    }
    if (FENCED_CODE.test(line)) { flushIndented(); fencedRun = [line]; continue; }
    if (INDENTED_CODE.test(line)) { indentedRun.push(line); continue; }
    flushIndented();
    rest.push(line);
  }
  flushIndented();
  if (fencedRun) blocks.push(fencedRun.join("\n"));
  return { blocks, rest };
}

/** Blank-line-separated runs of the non-code remainder. */
function blocksOf(lines) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (line.trim()) current.push(line);
    else if (current.length) { blocks.push(current); current = []; }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function isPastedBlock(block) {
  const chars = block.join("\n").length;
  if (block.length >= PASTED_BLOCK_MIN_LINES && chars >= PASTED_BLOCK_MIN_CHARS) return true;
  if (block.length < VERBATIM_BLOCK_MIN_LINES) return false;
  const verbatim = block.filter(isVerbatimLine).length;
  return verbatim / block.length >= VERBATIM_LINE_SHARE;
}

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

function scriptSignals(prose) {
  const letters = countMatches(prose, /\p{L}/gu);
  const latin = countMatches(prose, /\p{Script=Latin}/gu);
  const nonLatin = Math.max(0, letters - latin);
  const share = letters === 0 ? 0 : nonLatin / letters;
  let dominant = null;
  let best = 0;
  let unspacedChars = 0;
  for (const script of SCRIPTS) {
    const count = countMatches(prose, script.pattern);
    if (script.unspaced) unspacedChars += count;
    if (count > best) { best = count; dominant = script.id; }
  }
  return {
    letters,
    nonLatinLetters: nonLatin,
    // Rounded to four places, the rubric's own share precision.
    nonLatinLetterShare: Math.round(share * 10000) / 10000,
    dominantNonLatinScript: best > 0 ? dominant : null,
    unspacedChars,
    // Two booleans a reasons payload can carry without carrying a language name
    // it guessed: above the threshold the vocabulary table is not trusted, and
    // below the dominant threshold there is still Latin prose to read.
    languageUncertain: share >= NON_LATIN_SCRIPT_THRESHOLD,
    languageMixed: share >= NON_LATIN_SCRIPT_THRESHOLD && share < NON_LATIN_DOMINANT_THRESHOLD,
  };
}

function proseUnits(prose, unspacedChars) {
  const spacedWords = prose.split(/\s+/).filter((token) =>
    /[\p{L}\p{N}]/u.test(token) && !UNSPACED_SCRIPT_CHAR.test(token)).length;
  return spacedWords + Math.ceil(unspacedChars / UNSPACED_CHARS_PER_PROSE_UNIT);
}

/**
 * Segment one turn body.
 *
 * @param {string} body the raw turn text. Untrusted, never retained.
 * @returns {{proseText: string, signals: object}} `proseText` is for the
 *   classifier's local pattern matching only and must not be published.
 *   `signals` carries numbers and booleans exclusively and is safe to publish.
 */
export function segmentPromptBody(body) {
  const raw = typeof body === "string" ? body : "";
  const lines = raw.split(/\r?\n/);
  const { blocks: codeBlocks, rest } = extractCode(lines);
  const prosePieces = [];
  let pastedBlocks = 0;
  let pastedChars = 0;
  for (const block of blocksOf(rest)) {
    if (isPastedBlock(block)) {
      pastedBlocks += 1;
      pastedChars += block.join("\n").length;
      continue;
    }
    prosePieces.push(...block);
  }
  const proseText = prosePieces.join("\n");
  const script = scriptSignals(proseText);
  return {
    proseText,
    signals: Object.freeze({
      totalChars: raw.length,
      proseChars: proseText.length,
      proseUnits: proseUnits(proseText, script.unspacedChars),
      proseLines: prosePieces.length,
      codeBlocks: codeBlocks.length,
      codeChars: codeBlocks.reduce((sum, block) => sum + block.length, 0),
      pastedBlocks,
      pastedChars,
      labelledLines: prosePieces.filter((line) => LABELLED_LINE.test(line)).length,
      listLines: prosePieces.filter((line) => LIST_LINE.test(line)).length,
      questionMarks: countMatches(proseText, /[?？]/g),
      letters: script.letters,
      nonLatinLetters: script.nonLatinLetters,
      nonLatinLetterShare: script.nonLatinLetterShare,
      dominantNonLatinScript: script.dominantNonLatinScript,
      languageUncertain: script.languageUncertain,
      languageMixed: script.languageMixed,
    }),
  };
}
