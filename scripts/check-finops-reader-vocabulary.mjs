import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  EXECUTIVE_READER_TOKEN, executiveReplacement,
} from "../src/finops-executive-vocabulary.js";

export const FINOPS_PAGES = Object.freeze([
  "evolution.html",
  "executive-briefing.html",
  "savings-action-center.html",
]);

const NON_READER_TAGS = new Set(["script", "style", "template", "code", "pre"]);
const TAG = /<!--[\s\S]*?-->|<![^>]*>|<[^>]*>|[^<]+/g;

function excluded(attributes, tag) {
  if (NON_READER_TAGS.has(tag)) return true;
  return /\s(?:hidden|data-audit-disclosure)(?:\s|=|>)/i.test(` ${attributes}>`)
    || /\sdata-reader-copy\s*=\s*["'](?:audit|code)["']/i.test(` ${attributes}`);
}

/** Inspect text nodes only. Markup, attributes, comments and excluded subtrees are not copy. */
export function readerVocabularyViolations(html, file = "built FinOps page") {
  const violations = [];
  const stack = [];
  for (const part of html.matchAll(TAG)) {
    const value = part[0];
    if (value.startsWith("<!--") || /^<!/i.test(value)) continue;
    if (value.startsWith("<")) {
      const close = value.match(/^<\s*\/\s*([\w-]+)/);
      if (close) {
        const name = close[1].toLowerCase();
        while (stack.length && stack.pop().name !== name) {}
        continue;
      }
      const open = value.match(/^<\s*([\w-]+)([\s\S]*?)\/?\s*>$/);
      if (!open) continue;
      const name = open[1].toLowerCase();
      const parentExcluded = stack.at(-1)?.excluded ?? false;
      stack.push({ name, excluded: parentExcluded || excluded(open[2], name) });
      if (/\/\s*>$/.test(value) || ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"].includes(name)) stack.pop();
      continue;
    }
    if (stack.at(-1)?.excluded) continue;
    for (const match of value.matchAll(new RegExp(EXECUTIVE_READER_TOKEN.source, "gi"))) {
      const offset = part.index + match.index;
      violations.push({
        file,
        line: html.slice(0, offset).split("\n").length,
        token: match[0],
        replacement: executiveReplacement(match[0]),
      });
    }
  }
  return violations;
}

export function formatReaderVocabularyViolations(violations) {
  return violations.map(({ file, line, token, replacement }) =>
    `${file}:${line}: reader-visible internal token "${token}"; use "${replacement}"`).join("\n");
}

export async function verifyFinopsReaderVocabulary(root, pages = FINOPS_PAGES) {
  const entries = new Set((await readdir(root)).filter((name) => name.endsWith(".html")));
  const missing = pages.filter((page) => !entries.has(page));
  if (missing.length) throw new Error(`missing built FinOps page: ${missing.join(", ")}`);
  const violations = (await Promise.all(pages.map(async (page) => readerVocabularyViolations(
    await readFile(resolve(root, page), "utf8"),
    relative(root, resolve(root, page)).replaceAll("\\", "/"),
  )))).flat();
  if (violations.length) throw new Error(`FinOps reader vocabulary check failed:\n${formatReaderVocabularyViolations(violations)}`);
  return { pages: pages.length };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(process.argv[2] ?? "dist");
  const result = await verifyFinopsReaderVocabulary(root);
  console.log(`checked reader-visible vocabulary in ${result.pages} built FinOps pages`);
}
