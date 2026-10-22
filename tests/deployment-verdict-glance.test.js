// The deployment check on Releases, read at a glance (#2967): in each of its
// four states the band names the verdict in words beside a shape, lays the two
// builds out as a labeled pair, puts the one corrective action directly after
// the sentence that explains it, and lets Tab run record → action → evidence →
// copy. The harness models no layout, so the 390px behaviour is asserted on the
// page's own CSS rules rather than on a viewport.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { REAL_RECORD_LINK_LABEL } from "../src/deployed-release.js";
import { VERDICT_LABELS } from "../src/deployment-status-view.js";
import { loadPage, pressTab, tabSequence, textOf } from "./support/browser.js";
import { waitFor } from "./support/page-module.js";

const RELEASES_PAGE = new URL("../src/releases.html", import.meta.url);
const RELEASES_CSS = new URL("../src/releases-proof.css", import.meta.url);
const NOW = "2026-08-17T12:00:00.000Z";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";
const STAMPED = Object.freeze({ schemaVersion: 1, commitSha: SHA, builtAt: "2026-08-17T08:00:00.000Z" });

const STATES = {
  loading: { readHealth: () => new Promise(() => {}), settle: false },
  match: { readHealth: async () => ({ status: "healthy", version: SHA }) },
  drift: { readHealth: async () => ({ status: "healthy", version: OTHER }) },
  unknown: {
    readHealth: async () => {
      throw new TypeError("unreachable");
    },
  },
};

async function open(t, state) {
  const { readHealth, settle = true } = STATES[state];
  const page = await loadPage(RELEASES_PAGE, {
    storage: { [STORAGE_KEY]: JSON.stringify([]), [RELEASE_STORAGE_KEY]: JSON.stringify([]) },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: "", hash: "" },
    history: { replaceState() {} },
    buildStamp: STAMPED,
    readHealth,
    now: () => NOW,
  });
  const key = settle ? "shiplogDeployment" : "shiplogReleases";
  await waitFor(() => page.document.documentElement.dataset[key] === "ready", `the ${state} state never rendered`);
  // The retry's visibility is settled by the page after the check resolves.
  await Promise.resolve();
  return page;
}

const byId = (page, id) => page.document.querySelector(`#${id}`);
const isInside = (node, ancestor) => {
  for (let at = node; at; at = at.parentNode) if (at === ancestor) return true;
  return false;
};

function buildPair(page) {
  const nodes = byId(page, "deployment-identifiers").childElements;
  const values = nodes.filter((node) => node.tagName === "DD");
  return nodes.filter((node) => node.tagName === "DT").map((term, index) => [textOf(term), textOf(values[index])]);
}

// The controls in the action slot a reader can actually see.
const visibleActions = (page) => byId(page, "deployment-next-action").childElements
  .filter((node) => ["A", "BUTTON"].includes(node.tagName) && !node.hidden);

// The tab stops in the record's block, walked with Tab from the first one, as
// ids (the record link carries none, so it is named by its action attribute).
function blockTabOrder(page) {
  const block = byId(page, "real-deployment");
  const stops = tabSequence(page.document).filter((node) => isInside(node, block));
  stops[0].focus();
  const order = [];
  for (let node = stops[0]; node && isInside(node, block) && order.length < 20; node = pressTab(page.document)) {
    order.push(node.getAttribute("id") ?? `action:${node.getAttribute("data-deployment-action")}`);
  }
  return order;
}

const EXPECTED = {
  loading: { pair: [], action: null },
  match: { pair: [["Recorded build", SHA], ["Running build", SHA]], action: null },
  drift: { pair: [["Recorded build", SHA], ["Running build", OTHER]], action: "action:drift" },
  unknown: { pair: [["Recorded build", SHA], ["Running build", "not reported"]], action: "deployment-retry" },
};

for (const state of Object.keys(STATES)) {
  test(`the ${state} verdict reads at a glance: label, shape, build pair, action and tab order`, async (t) => {
    const page = await open(t, state);
    const chip = byId(page, "deployment-verdict-label");
    const expected = EXPECTED[state];

    // A word and a shape per state, so no state relies on its colour.
    assert.equal(chip.dataset.verdict, state);
    assert.equal(chip.childElements.length, 2);
    const [shape, label] = chip.childElements;
    assert.equal(shape.getAttribute("aria-hidden"), "true");
    assert.equal(textOf(shape), VERDICT_LABELS[state].shape);
    assert.equal(textOf(label), VERDICT_LABELS[state].label);
    // The sentence stays the live region; the chip is not a second one.
    assert.equal(byId(page, "deployment-verdict").getAttribute("role"), "status");
    assert.equal(chip.getAttribute("role"), null);
    assert.equal(chip.getAttribute("aria-live"), null);

    assert.equal(byId(page, "deployment-identifiers").tagName, "DL");
    assert.deepEqual(buildPair(page), expected.pair);

    // The corrective action slot follows the explanation directly.
    const callout = byId(page, "deployment-status-callout").childElements;
    const verdictAt = callout.findIndex((node) => node.getAttribute("id") === "deployment-verdict");
    assert.equal(callout[verdictAt + 1].getAttribute("id"), "deployment-next-action");
    const actions = visibleActions(page);
    if (expected.action === null) {
      assert.equal(actions.length, 0, `the ${state} state offered a corrective action`);
    } else {
      assert.equal(actions.length, 1, `the ${state} state must offer exactly one corrective action`);
      const action = actions[0];
      assert.equal(action.getAttribute("id") ?? `action:${action.getAttribute("data-deployment-action")}`, expected.action);
      if (state === "drift") {
        assert.equal(action.getAttribute("href"), "/releases.html#shipped-build");
        assert.equal(textOf(action), REAL_RECORD_LINK_LABEL);
      } else {
        assert.equal(textOf(action), "Retry the deployment check");
      }
    }

    // Tab order matches the visual order: record, action, evidence, copy.
    const order = blockTabOrder(page);
    const deploymentStops = order.filter((id) => !id.startsWith("shipped-build"));
    assert.ok(order.indexOf(deploymentStops[0]) > 0, "the deployment record's controls do not lead the block");
    assert.ok(order.slice(0, order.indexOf(deploymentStops[0])).every((id) => id.startsWith("shipped-build")));
    const settledCopy = state === "loading" ? [] : ["deployment-copy"];
    assert.deepEqual(
      deploymentStops,
      [...(expected.action ? [expected.action] : []), "deployment-evidence-summary", ...settledCopy],
    );
  });
}

test("long build identifiers wrap inside the column and the band never widens the page at 390px", async () => {
  const css = (await readFile(RELEASES_CSS, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(found, `no rule for ${selector}`);
    return found[1].replace(/\s+/g, "");
  };
  assert.match(rule("#deployment-status-callout"), /min-width:0;/);
  assert.match(rule("#deployment-status-callout"), /overflow-wrap:anywhere;/);
  const pair = rule(".deployment-builds");
  assert.match(pair, /display:grid;/);
  // Whitespace is stripped above, so "max-content minmax(0,1fr)" reads joined.
  assert.match(pair, /grid-template-columns:max-contentminmax\(0,1fr\);/);
  assert.match(pair, /min-width:0;/);
  const value = rule(".deployment-builds dd");
  assert.match(value, /overflow-wrap:anywhere;/);
  assert.match(value, /min-width:0;/);
  assert.match(rule(".deployment-verdict-chip"), /max-width:100%;/);
  // Nothing in the band's rules forbids wrapping or fixes a width.
  const bandRules = css.split("\n").filter((line) => /deployment-(builds|verdict-chip|status-callout|checked-at|next-action)/.test(line));
  assert.ok(bandRules.length >= 5);
  for (const line of bandRules) {
    assert.doesNotMatch(line, /nowrap|(?:^|[;{\s])(?:min-)?width:\s*\d+px/, `a rule can widen the page: ${line}`);
  }
});

test("the shipped markup names the loading verdict before any script runs", async () => {
  const html = await readFile(RELEASES_PAGE, "utf8");
  assert.match(
    html,
    /<p class="deployment-verdict-chip" id="deployment-verdict-label" data-verdict="loading"><span aria-hidden="true">◌<\/span> <span>Checking…<\/span><\/p>/,
  );
});
