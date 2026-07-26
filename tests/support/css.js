// Scoping helpers for the stylesheet assertions.
//
// `assert.match(css, /@media\(max-width:520px\)[\s\S]*\.empty-action\{/)` reads
// like it pins a rule to a breakpoint, but `[\s\S]*` runs to the end of the
// file: the rule can sit in any later block, or none at all, and the test still
// passes. These tests exist because the responsive behaviour has no runtime
// coverage, so a vacuous one is worse than none. Slice the block first, then
// match inside it.

import assert from "node:assert/strict";

const escape = (selector) => selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Comments are stripped before matching so a rule preceded by one is still
// anchored to a boundary rather than silently unmatched.
const bare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Every block whose header starts with `opener`, brace-balanced so nested rules
// are included and following rules are not. A stylesheet may repeat a media
// query; the caller decides which of them has to carry a rule.
export function blocks(css, opener) {
  const source = bare(css);
  const found = [];
  let from = 0;
  for (let start = source.indexOf(opener, from); start !== -1; start = source.indexOf(opener, from)) {
    const open = source.indexOf("{", start);
    assert.notEqual(open, -1, `${opener} must open a block`);
    let depth = 0;
    let end = -1;
    for (let index = open; index < source.length && end === -1; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}" && (depth -= 1) === 0) end = index;
    }
    assert.notEqual(end, -1, `${opener} is never closed`);
    found.push(source.slice(open + 1, end));
    from = end;
  }
  return found;
}

export function block(css, opener) {
  const [first] = blocks(css, opener);
  assert.ok(first !== undefined, `stylesheet must contain a block opening with ${opener}`);
  return first;
}

// The declarations of one rule, or null. Anchored to a block boundary so
// `.site-nav` never matches inside `.site-nav a`.
export function findRule(source, selector) {
  const found = bare(source).match(new RegExp(`(^|[};])\\s*${escape(selector)}\\s*\\{([^}]*)\\}`));
  return found ? found[2] : null;
}

// Asserting form, so a test names the selector it means instead of matching on
// whatever the next `}` happens to follow.
export function rule(source, selector) {
  const declarations = findRule(source, selector);
  assert.ok(declarations !== null, `expected a rule for ${selector}`);
  return declarations;
}
