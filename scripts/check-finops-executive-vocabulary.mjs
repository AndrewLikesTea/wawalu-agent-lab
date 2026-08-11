import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FINOPS_EXECUTIVE_BANNED_TOKEN_SHAPES } from "../src/finops-executive-vocabulary.js";

export const FINOPS_EXECUTIVE_PAGES = Object.freeze([
  "evolution.html",
  "executive-briefing.html",
  "savings-action-center.html",
  "savings-commitment.html",
]);

const NON_READER_TAGS = new Set(["script", "style", "template", "code", "pre", "kbd", "samp"]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " });

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (/^#x/i.test(body)) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function excludedElement(tag, attributes) {
  if (NON_READER_TAGS.has(tag)) return true;
  if (/\b(?:hidden|inert|data-audit(?:-disclosure)?|data-code)(?:\s|=|$)/i.test(attributes)) return true;
  if (/\baria-hidden\s*=\s*["']?true\b/i.test(attributes)) return true;
  const classes = attributes.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2]?.split(/\s+/) ?? [];
  return classes.includes("audit-disclosure");
}

/** Return reader-visible banned tokens with one-based artifact line numbers. */
export function findFinopsVocabularyViolations(html) {
  const violations = [];
  const stack = [];
  let excludedDepth = 0;
  const tokens = String(html).matchAll(/<!--[\s\S]*?-->|<![^>]*>|<[^>]*>|[^<]+/g);
  for (const token of tokens) {
    const value = token[0];
    if (value.startsWith("<!--") || value.startsWith("<!")) continue;
    if (value.startsWith("</")) {
      const frame = stack.pop();
      if (frame?.excluded) excludedDepth -= 1;
      continue;
    }
    if (value.startsWith("<")) {
      const opening = value.match(/^<\s*([a-z0-9-]+)([\s\S]*?)\/?\s*>$/i);
      if (!opening || /\/\s*>$/.test(value)) continue;
      const tag = opening[1].toLowerCase();
      const excluded = excludedDepth > 0 || excludedElement(tag, opening[2]);
      if (VOID_TAGS.has(tag)) continue;
      stack.push({ excluded });
      if (excluded) excludedDepth += 1;
      continue;
    }
    if (excludedDepth > 0) continue;
    const text = decodeEntities(value);
    for (const shape of FINOPS_EXECUTIVE_BANNED_TOKEN_SHAPES) {
      const pattern = new RegExp(shape.pattern, `${shape.flags ?? ""}g`);
      for (const match of text.matchAll(pattern)) {
        const offset = token.index + match.index;
        violations.push({
          line: html.slice(0, offset).split("\n").length,
          token: match[0],
          replacement: shape.replacement,
        });
      }
    }
  }
  return violations;
}

export async function checkBuiltFinopsVocabulary(root, pages = FINOPS_EXECUTIVE_PAGES) {
  const violations = [];
  for (const file of pages) {
    const html = await readFile(resolve(root, file), "utf8");
    for (const violation of findFinopsVocabularyViolations(html)) violations.push({ file, ...violation });
  }
  if (violations.length) {
    throw new Error(`AI FinOps reader-visible vocabulary violations:\n${violations.map((entry) =>
      `${entry.file}:${entry.line}: "${entry.token}"; use "${entry.replacement}"`).join("\n")}`);
  }
}
