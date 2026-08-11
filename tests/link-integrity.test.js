// Every internal link in the built site resolves: the file exists, and a
// `#fragment` names something in the document it lands on.
//
// WHY THIS FILE EXISTS
// --------------------
// The nav now sends a reader to one region rather than to the top of a page
// (#1187), and the FinOps pages keep their old URLs and their old anchor ids so
// a saved link still works. Both of those are promises about strings that no
// other check reads: scripts/verify-build.mjs closes the *asset* graph (module
// specifiers, stylesheets, JSON), and the door contract there proves the five
// workspace doors point at ids the artifact carries — but nothing walked the
// ordinary prose links, and nothing noticed a renamed section leaving a
// fragment pointing at nothing. A dead fragment is silent: the browser loads
// the page, scrolls nowhere, and the reader is on the hero wondering where the
// figure went.
//
// It never fetches: filesystem plus string matching, on the tree that ships.
// `npm test` runs it against `src` for fast feedback; `npm run
// test:e2e:production` sets SHIPLOG_E2E_BUILD_ROOT=dist and runs the same
// assertions against the deployable tree, where the seeded first screen and the
// copied-in docs and contracts are the ones a reader will actually receive.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BUILD_ROOT = process.env.SHIPLOG_E2E_BUILD_ROOT || "src";
const rootUrl = new URL(`../${BUILD_ROOT}/`, import.meta.url);

const exists = async (url) => {
  try {
    return (await stat(url)).isFile();
  } catch {
    return false;
  }
};

// A built artifact carries its manifest. Only the source tree gets the second
// place to look: `docs/*.md` and `contracts/**` are linked with the paths the
// deployed origin serves them at, and scripts/build.mjs copies them in, so under
// `src` those paths resolve at the repository root. Under `dist` there is no
// fallback — a link into a file the build forgot to copy fails there, which is
// the run that decides whether the artifact is servable.
const artifact = await exists(new URL("build-manifest.json", rootUrl));
const roots = artifact ? [rootUrl] : [rootUrl, new URL("../", import.meta.url)];

// The rail's doors are destination keys, not element ids: the workspace shell
// intercepts the click and reveals the destination whose region it owns. They
// are read from the module that declares them, so a rail href that drifts from
// that list is not exempt — it falls through to the ordinary check below and
// fails as a missing anchor.
const { DESTINATION_FRAGMENT } = await import(new URL("finops-workspace-nav.js", rootUrl));
const scriptOwned = new Set(Object.values(DESTINATION_FRAGMENT).map((fragment) => fragment.slice(1)));

async function pages() {
  const found = [];
  for (const entry of await readdir(rootUrl, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const directory = (entry.parentPath ?? entry.path).replaceAll("\\", "/");
    const base = fileURLToPath(rootUrl).replaceAll("\\", "/").replace(/\/$/, "");
    const inside = directory.slice(base.length).replace(/^\/+/, "");
    found.push(inside ? `${inside}/${entry.name}` : entry.name);
  }
  return found.sort();
}

const idsIn = (html) => new Set([
  ...[...html.matchAll(/\sid="([^"]+)"/g)].map(([, value]) => value),
  ...[...html.matchAll(/\sname="([^"]+)"/g)].map(([, value]) => value),
]);

// Where a link lands, as a path relative to the build root. Root-relative hrefs
// resolve against the root; anything else resolves against the document's own
// directory, which is how a browser reads it.
function resolvePath(from, href) {
  const path = href.split("#")[0].split("?")[0];
  if (path === "") return from;
  const directory = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  const absolute = path.startsWith("/") ? path.slice(1) : `${directory}${path}`;
  const segments = [];
  for (const segment of absolute.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  const joined = segments.join("/");
  // A directory URL, "/" included, is served by its index document.
  if (joined === "") return "index.html";
  return path.endsWith("/") ? `${joined}/index.html` : joined;
}

const EXTERNAL = /^(?:https?:|mailto:|tel:|data:|javascript:|\/\/)/i;

test("every internal link in the build output resolves to a file that exists", async () => {
  const documents = new Map();
  for (const page of await pages()) documents.set(page, await readFile(new URL(page, rootUrl), "utf8"));
  assert.ok(documents.size > 0, `no HTML found under ${fileURLToPath(rootUrl)} (SHIPLOG_E2E_BUILD_ROOT=${BUILD_ROOT})`);

  // Both failure modes are collected, then reported together and named: a run
  // that stops at the first dead link makes fixing a set of them one build each.
  // A set: the same href repeated down a page is one thing to fix, and the
  // report is read by a person.
  const failures = new Set();
  let checked = 0;
  for (const [page, source] of documents) {
    // Commented-out markup is not a link a reader can follow, and the rationale
    // comments in these pages quote hrefs while explaining them.
    const html = source.replace(/<!--[\s\S]*?-->/g, "");
    for (const [, href] of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) {
      if (href === "" || EXTERNAL.test(href)) continue;
      checked += 1;
      const target = href.startsWith("#") ? page : resolvePath(page, href);
      const fragment = href.includes("#") ? decodeURIComponent(href.slice(href.indexOf("#") + 1)) : "";

      if (target !== page && !documents.has(target)) {
        const resolved = await Promise.all(roots.map((root) => exists(new URL(target, root))));
        if (!resolved.some(Boolean)) {
          failures.add(`${page} -> ${href} — missing file: no ${target} in the build output`);
          continue;
        }
        // A served file that is not a document (a contract .md, a JSON schema)
        // carries no ids for a fragment to name.
        continue;
      }
      if (fragment === "" || scriptOwned.has(fragment)) continue;
      if (!idsIn(documents.get(target)).has(fragment)) {
        failures.add(`${page} -> ${href} — missing anchor: ${target} has no id or name "${fragment}"`);
      }
    }
  }

  assert.ok(checked > 0, "the walk found no internal links to check, which means it is not walking");
  assert.deepEqual([...failures], [],
    `${failures.size} broken internal link(s) in ${BUILD_ROOT}:\n${[...failures].join("\n")}`);
});

// The published FinOps URLs and the anchors the nav and the body point at. #1187
// collapsed the nav to one door; nothing about that may move a page or retire an
// id a reader could have saved. Listed by hand so deleting one is a failing test
// rather than a shorter loop.
test("every published FinOps URL and anchor still resolves", async () => {
  const PRESERVED = {
    "evolution.html": ["finops-recoverable-answer", "finops-recoverable-value", "finops-hero",
      "finops-stand", "finops-answer", "finops-workspace-nav", "local-import"],
    "savings-action-center.html": [],
    "savings-commitment.html": [],
    "executive-briefing.html": [],
    // The per-department screen. Its ids are the ones a forwarded link and the
    // page's own entry both address; retiring one silently would leave a
    // reader's saved ?department= link resolving to a screen that never fills.
    "departments.html": ["department-answer", "department-status", "department-org-answer"],
  };
  for (const [page, anchors] of Object.entries(PRESERVED)) {
    const url = new URL(page, rootUrl);
    assert.ok(await exists(url), `${page} must still be served at its published URL (${fileURLToPath(url)})`);
    const ids = idsIn(await readFile(url, "utf8"));
    for (const anchor of anchors) {
      assert.ok(ids.has(anchor), `${page}#${anchor} was published and no longer resolves`);
    }
  }
});
