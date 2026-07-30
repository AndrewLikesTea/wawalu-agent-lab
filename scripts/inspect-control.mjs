// Which shipped source files carry raw control characters.
//
// A stray control byte in a `.js` file is not a style problem: git stops
// treating the file as text, so it reviews as `Bin` and its diff is unreadable,
// and a byte inside a regular expression or a string literal changes what the
// module does without showing anything at the review. This walks the source
// tree and names the offenders. Tabs, newlines, and carriage returns are the
// three control characters ordinary source is written with, so they pass.

import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

const offending = (text) => [...text].some((character) => {
  const code = character.codePointAt(0);
  return (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) && !ALLOWED.has(code);
});

/** Every text file under `root` that carries one, as repository-relative paths. */
export async function controlCharacterFiles(root, directory = root) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await controlCharacterFiles(root, path));
    else if (/\.(?:js|mjs|css|html|json|md)$/.test(entry.name)
      && offending(await readFile(path, "utf8"))) found.push(relative(root, path));
  }
  return found.sort();
}
