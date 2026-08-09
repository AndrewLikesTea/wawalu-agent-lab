// One glyph, one job, on /evolution.html.
//
// The page had collapsed into six near-identical geometric marks — ◌ ○ ● ◇ ◈ ◆ —
// with ◇ alone doing three unrelated jobs: it badged synthetic provenance, it
// meant "not analyzed", and it named the Evidence destination in the workspace
// rail. At the 10–13px these marks actually ship at, a reader separates them by
// outer silhouette and fill area and by nothing else; the interior stroke of ◈
// closes up entirely, so ◇/◈/◆ arrive as one mark with a caption beside it.
//
// So the vocabulary is now two families and a rule, written into `evolution.css`
// where the page can be held to it:
//
//   DIAMOND = PROVENANCE   ◇ bundled synthetic · ◆ the reader's own file
//   CIRCLE  = STATUS       ○ none · ◌ reading · ◔ some · ◐ part · ● measured
//   TRIANGLE = direction, an available action, or a disclosure
//   destinations carry no glyph at all
//
// These tests assert rendered structure and declared values, never a screenshot.
// The glyph inventory is *discovered* by walking the page rather than listed
// here, so a render site nobody migrated fails this file instead of shipping: an
// unclassified glyph is the failure, not a missing entry in a fixture.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { METRIC_FLAG } from "../src/finops-load-status.js";
import { BAND_PRESENTATION } from "../src/finops-first-run.js";
import { STAND_SAMPLE_MARKER } from "../src/finops-stand.js";
import { PANEL_STATUS, panelStatusPresentation } from "../src/panel-status-view.js";
import { applyWorkspaceNav, workspaceDestinations } from "../src/finops-workspace-nav.js";
import { journeySignals } from "../src/finops-journey-signals.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = new URL("../src/evolution.css", import.meta.url);

const html = await readFile(PAGE, "utf8");
const css = await readFile(CSS, "utf8");
const view = await readFile(new URL("../src/finops-journey-consolidated-view.js", import.meta.url), "utf8");

// --- the vocabulary ---------------------------------------------------------

/** Every geometric mark this page or its modules can draw. */
const GLYPHS = "◇◆◈◌○◐◔●▲▼▶▸▾▣▢◧▦◤×✓";
const HAS_GLYPH = new RegExp(`[${GLYPHS}]`, "u");

const ROLE = Object.freeze({
  provenance: "provenance",
  status: "status",
  action: "action",
  disclosure: "disclosure",
});

/**
 * Which role each glyph-bearing element on the page belongs to.
 *
 * Keyed by the element's own class or id, because that is what the stylesheet
 * and the painting module both key off — a role table keyed by glyph would be
 * begging the question this file exists to ask.
 */
const ROLE_OF = new Map(Object.entries({
  "sample-marker-shape": ROLE.provenance,
  "badge-shape": ROLE.provenance,
  "provenance-shape": ROLE.provenance,
  // The imported brief's one marker (#981). It draws ◆ and only ◆ — the mark
  // this table already gives to "computed from the file this reader brought" —
  // and its other two states carry no mark at all.
  "brief-provenance-shape": ROLE.provenance,

  "first-run-shape": ROLE.status,
  "kpi-flag-shape": ROLE.status,
  "finops-load-shape": ROLE.status,
  "portfolio-brief-shape": ROLE.status,
  "status-shape": ROLE.status,
  "local-lead-grade-shape": ROLE.status,
  "local-benchmark-shape": ROLE.status,
  "local-trend-shape": ROLE.status,
  "graded-shape": ROLE.status,
  "fjc-chip-shape": ROLE.status,
  "fjc-phase-shape": ROLE.status,
  "import-chip-shape": ROLE.status,
  // The shared panel-status chip. It always drew on the circle ramp — the table
  // below already checks `panelStatusPresentation`'s shapes — but until #1465
  // authored one into evolution.html it was only ever painted, so the static
  // walk never met it. Same class, same glyphs, same role.
  "panel-status-shape": ROLE.status,

  "finops-action-shape": ROLE.action,

  // The bundled example's per-figure source markers (#1025). Eight native
  // disclosures, each drawing the page's disclosure triangle and nothing else —
  // the three source states are told apart by their words and by the chip
  // silhouette, never by a mark, so no diamond is minted for a third kind of
  // provenance and ◇/◆ keep meaning exactly what they meant.
  "figure-source-shape": ROLE.disclosure,

  "stand-disclosure-shape": ROLE.disclosure,
  "first-run-method-shape": ROLE.disclosure,
  "workspace-nav-detail-shape": ROLE.disclosure,
  "dest-shape": ROLE.disclosure,
}));

const FAMILY = Object.freeze({
  diamond: "◇◆◈",
  circle: "◌○◐◔●",
});

const keysOf = (node) => [
  ...String(node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
  ...(node.id ? [node.id] : []),
];

/** The role table's verdict for one element, or null when nothing claims it. */
function roleOf(node) {
  for (const key of keysOf(node)) {
    if (ROLE_OF.has(key)) return ROLE_OF.get(key);
  }
  return null;
}

/** Every element in the tree, in document order. */
function walk(node, found = []) {
  for (const child of node.children ?? []) {
    if (child.nodeType === 1) {
      found.push(child);
      walk(child, found);
    }
  }
  return found;
}

/** The text this element owns directly, not the text its descendants own. */
const ownText = (node) => (node.children ?? [])
  .filter((child) => child.nodeType === 3)
  .map((child) => child.textContent)
  .join("");

/** Every element whose own text carries a mark from the vocabulary. */
const glyphNodes = (document) =>
  walk(document).filter((node) => HAS_GLYPH.test(ownText(node)));

const marksIn = (text) => [...new Set([...String(text)].filter((ch) => GLYPHS.includes(ch)))];

/** The declared value of one property on one selector, top-level rules only. */
function declared(selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(rule, `no rule for ${selector}`);
  const found = rule[1].match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return found ? found[1].trim() : null;
}

// --- role exclusivity -------------------------------------------------------

test("every rendered glyph is aria-hidden decoration over a label that stands alone", () => {
  const document = parseHtml(html);
  const nodes = glyphNodes(document);
  assert.ok(nodes.length >= 20, `only ${nodes.length} glyph-bearing elements found — the page did not parse`);

  for (const node of nodes) {
    const described = `<${node.tagName.toLowerCase()} class="${node.getAttribute("class") ?? ""}"`
      + ` id="${node.id}"> carries ${marksIn(ownText(node)).join("")}`;

    // 1. It is decoration. A screen reader must reach the label, not the mark.
    assert.equal(node.getAttribute("aria-hidden"), "true",
      `${described} but is not aria-hidden, so it is spoken as part of the accessible name`);

    // 2. The role table knows it. This is the assertion that catches a render
    //    site nobody migrated — a shared chip helper still emitting the old mark
    //    reaches here as an unclassified glyph rather than as a silent pass.
    const role = roleOf(node);
    assert.ok(role, `${described} in no known role — add the render site to the role table in`
      + " evolution.css, or migrate it onto the family its job belongs to");

    // 3. Deleting the mark from the DOM loses no meaning: the chip it sits in
    //    still carries the words. The mark is never the whole chip.
    const chip = node.parentNode;
    assert.ok(chip, `${described} has no chip around it to carry the label`);
    const label = textOf(chip).replace(new RegExp(`[${GLYPHS}]`, "gu"), "").trim();
    assert.ok(label.length > 0,
      `${described} and its chip says nothing else — delete the glyph and the chip is empty`);
  }
});

test("no glyph does two jobs: ◇ is provenance and only provenance", () => {
  const document = parseHtml(html);
  const roles = new Map();
  for (const node of glyphNodes(document)) {
    const role = roleOf(node);
    for (const mark of marksIn(ownText(node))) {
      if (!roles.has(mark)) roles.set(mark, new Set());
      roles.get(mark).add(role);
    }
  }

  for (const [mark, claimed] of roles) {
    assert.equal(claimed.size, 1,
      `${mark} is drawn in ${claimed.size} roles (${[...claimed].sort().join(", ")}).`
      + " A reader has no way to tell which one a given instance means.");
  }

  // The specific collision this page shipped: ◇ badged provenance, meant
  // "not analyzed", and named the Evidence destination, all at caption size.
  assert.deepEqual([...(roles.get("◇") ?? [])], [ROLE.provenance],
    "◇ is the provenance badge and nothing else");
  assert.ok(!roles.has("◈"), "◈ does not survive: it is ◇ with a stroke that closes up at 11px");

  // And the families do not cross. Provenance is drawn on the diamond, live
  // status on the circle ramp, and no element is drawn on both.
  for (const [mark, claimed] of roles) {
    const role = [...claimed][0];
    if (FAMILY.diamond.includes(mark)) {
      assert.equal(role, ROLE.provenance, `${mark} is a diamond, so it must be provenance`);
    }
    if (FAMILY.circle.includes(mark)) {
      assert.equal(role, ROLE.status, `${mark} is on the circle ramp, so it must be status`);
    }
  }
});

test("the modules that repaint those chips draw on the same two families", () => {
  // The static markup is only the state the page ships in. These are the tables
  // the scripts paint over it with, and they have to agree with the markup or
  // the role a reader learned before the script ran stops being true after it.
  const statusShapes = [
    ...Object.values(METRIC_FLAG).map((flag) => flag.shape),
    ...Object.values(BAND_PRESENTATION).map((band) => band.shape),
    ...Object.values(PANEL_STATUS).map((status) => panelStatusPresentation(status).shape),
  ];
  for (const shape of statusShapes) {
    for (const mark of marksIn(shape)) {
      assert.ok(!FAMILY.diamond.includes(mark),
        `a status chip paints ${mark}, which is a provenance diamond`);
    }
  }

  // Provenance is the other half of the mirror: outline for the bundled
  // classification, filled for the file the reader brought. Both diamonds.
  assert.equal(STAND_SAMPLE_MARKER.example.shape, "◇");
  assert.equal(STAND_SAMPLE_MARKER.import.shape, "◆");
  assert.equal(METRIC_FLAG.unmeasured.shape, "○",
    "the unmeasured flag is the empty end of the status ramp, not a diamond");
});

// --- the workspace rail -----------------------------------------------------

// The rail's own doors, not every door on the page. #1327 gave the front door's
// two unpromoted destinations the same outline silhouette — a door looks like a
// door — so the scan below is scoped to the rail it is about.
const railDoors = (document) => walk(document.getElementById("finops-workspace-nav"))
  .filter((node) => node.classList?.contains?.("workspace-dest"));

test("the five destinations stay apart with every glyph suppressed", () => {
  const document = parseHtml(html);
  const doors = railDoors(document);
  assert.equal(doors.length, 5, "the rail authors five doors");

  // No door draws a mark at all. This is the third job ◇ used to do.
  for (const door of doors) {
    assert.ok(!HAS_GLYPH.test(textOf(door)),
      `${door.dataset.destinationKey} still draws ${marksIn(textOf(door)).join("")} beside its name`);
  }

  // With the glyphs gone the names have to carry the whole distinction, so they
  // must be four non-empty strings that differ from each other.
  const names = doors.map((door) => {
    const name = walk(door).find((node) => node.classList?.contains?.("workspace-dest-name"));
    assert.ok(name, `${door.dataset.destinationKey} has no visible name`);
    return textOf(name);
  });
  assert.deepEqual(names, ["The answer", "Evidence", "Departments", "Act and verify", "Monthly review"]);
  assert.equal(new Set(names).size, 5, "two doors read the same with glyphs suppressed");

  // The module that owns the rail no longer publishes a shape for any door, so
  // a future painter cannot put one back without failing here first.
  for (const entry of workspaceDestinations(null)) {
    assert.equal(entry.shape, undefined, `${entry.key} still carries a glyph in the rail's model`);
  }
});

test("the current destination is the word Current plus a cue that is neither colour nor glyph", () => {
  const document = parseHtml(html);
  const doors = railDoors(document);
  const current = doors.filter((door) => door.getAttribute("aria-current") === "true");
  assert.equal(current.length, 1, "exactly one door is marked current before any script runs");

  const state = walk(current[0]).find((node) => node.classList?.contains?.("workspace-dest-state"));
  assert.equal(textOf(state), "Current");
  assert.notEqual(state.hidden, true, "the word Current is authored visible, not painted later");
  for (const door of doors) {
    if (door === current[0]) continue;
    const other = walk(door).find((node) => node.classList?.contains?.("workspace-dest-state"));
    if (other) assert.equal(textOf(other), "", "only the current door says Current");
  }

  // The non-colour cue: the left rule thickens. Geometry, not hue — it survives
  // greyscale, a mono printer, and a reader who cannot separate the two tints.
  const base = Number.parseInt(declared(".workspace-dest", "border"), 10);
  const marked = Number.parseInt(declared('.workspace-dest[aria-current="true"]', "border-left"), 10);
  assert.ok(Number.isFinite(base) && Number.isFinite(marked),
    "the rail must declare a border width on both states");
  assert.ok(marked > base,
    `the current door's left rule is ${marked}px against a ${base}px default, so the only`
    + " thing separating it is colour");
});

// --- 390px ------------------------------------------------------------------

test("at 390px every chip renders its whole label instead of clipping it", () => {
  // This harness has no layout engine, so overflow is asserted where it is
  // actually decided: the declarations that would cause it. A chip clips when it
  // refuses to wrap, ellipsises, or hides its overflow — and a row of chips
  // pushes the page sideways when its items cannot shrink below their content.
  // No `.workspace-dest-kind`: the "Opens another page" chip retired with the
  // off-page door when #819 collapsed the two navigation controls into one.
  const CHIPS = [".workspace-dest", ".workspace-dest-name", ".workspace-dest-state",
    ".workspace-dest-recommended", ".workspace-nav-list"];

  for (const selector of CHIPS) {
    for (const property of ["text-overflow", "white-space"]) {
      const value = declared(selector, property);
      assert.ok(value === null || !/ellipsis|nowrap/.test(value),
        `${selector} declares ${property}:${value}, which truncates a label at 390px`);
    }
    const overflow = declared(selector, "overflow");
    assert.ok(overflow === null || !/hidden/.test(overflow),
      `${selector} hides its overflow, so a long label is cut rather than wrapped`);
  }

  // The row and each door wrap, and both can shrink below their content width —
  // which is what keeps "Act and verify · Opens another page", the longest door
  // in the rail, on two lines inside a 390px viewport instead of on one line
  // wider than the screen.
  assert.match(declared(".workspace-nav-list", "flex-wrap"), /wrap/);
  assert.match(declared(".workspace-dest", "flex-wrap"), /wrap/);
  assert.equal(declared(".workspace-dest", "min-width"), "0");
  assert.equal(declared(".workspace-nav-item", "min-width"), "0");
  assert.equal(declared(".workspace-dest-name", "min-width"), "0");
  assert.match(declared(".workspace-dest", "overflow-wrap"), /anywhere|break-word/);

  // Nothing in the rail is pinned to a width a 390px viewport cannot give it.
  // The page column is `calc(100% - 24px)` at phone width, so 366px is the
  // widest content box any of these chips will ever be laid out in.
  for (const selector of CHIPS) {
    for (const property of ["width", "min-width"]) {
      const value = declared(selector, property);
      const px = value && /^\d+px$/.test(value) ? Number.parseInt(value, 10) : 0;
      assert.ok(px <= 366, `${selector} declares ${property}:${value}, wider than a 390px viewport`);
    }
  }
});

test("the rail draws no glyph once its own module has repainted it", async () => {
  // The markup is one state; this is the other. `applyWorkspaceNav` rewrites
  // every door from the contract, and a painter that put a mark back would beat
  // the static assertions above — so the scan is run again over what it drew.
  const page = await loadPage(PAGE);
  try {
    const { document } = page;
    applyWorkspaceNav(document, null);
    const doors = railDoors(document);
    assert.equal(doors.length, 5);
    for (const door of doors) {
      assert.ok(!HAS_GLYPH.test(textOf(door)),
        `the painted ${door.dataset.destinationKey} door drew ${marksIn(textOf(door)).join("")}`);
      assert.ok(textOf(door).length > 0, "a door with no glyph and no words is not a door");
    }
    for (const node of glyphNodes(document)) {
      const role = roleOf(node);
      assert.ok(role, `<${node.tagName.toLowerCase()} class="${node.getAttribute("class") ?? ""}"`
        + ` id="${node.id}"> carries ${marksIn(ownText(node)).join("")} in no known role`);
      assert.equal(node.getAttribute("aria-hidden"), "true",
        `a painted glyph in ${role} is spoken as part of its chip's accessible name`);
    }
  } finally {
    page.restore();
  }
});

test("the shared journey chip helper draws status on the circle ramp, never a diamond", () => {
  // This is the emitter that made ◇ ambiguous from a second module: the five
  // `.fjc-chip-shape` marks are painted from `journeySignals`, not from the
  // page, so migrating the page alone would have left ◇ meaning "unknown" here
  // while it meant "bundled synthetic example" three sections above.
  const signals = journeySignals({});
  assert.equal(signals.length, 5, "impact, confidence, verification, provenance, department");
  for (const signal of signals) {
    for (const mark of marksIn(signal.shape)) {
      assert.ok(!FAMILY.diamond.includes(mark),
        `the ${signal.key} chip draws ${mark}, which is a provenance diamond`);
    }
    // The chip's own words carry the state, so the mark is never load-bearing.
    assert.ok(String(signal.label).length > 0 && String(signal.value).length > 0);
  }
  // An unknown signal is the empty end of the ramp, and it is the same mark the
  // page authors for "not analyzed" — one glyph, one meaning, both modules.
  const unknown = signals.filter((signal) => !signal.known).map((signal) => signal.shape);
  assert.ok(unknown.length > 0, "an empty review has signals it cannot know");
  assert.deepEqual([...new Set(unknown)], ["○"]);

  // The phase mark above the chips is painted by the same module and rides the
  // same ramp. Migrating the chips and leaving the phase behind is exactly how
  // a glyph ends up meaning two things again.
  const phases = renderedPhaseShapes();
  assert.ok(phases.length >= 4, "the journey has a mark for every phase it can be in");
  for (const shape of phases) {
    assert.ok(FAMILY.circle.includes(shape), `the journey phase draws ${shape}, off the status ramp`);
  }
  assert.equal(new Set(phases).size, phases.length, "two phases draw the same mark");
});

/** The phase marks the journey view can draw, read out of its own source. */
function renderedPhaseShapes() {
  const table = view.match(/const PHASE_SHAPE = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(table, "the journey view no longer declares a phase shape table");
  return [...table[1].matchAll(/:\s*"([^"]+)"/g)].map(([, shape]) => shape);
}

// --- the rule is written down where the product can be held to it ------------

test("the mirror rule is a comment in the product's own stylesheet", () => {
  const header = css.slice(0, css.indexOf(":root"));
  assert.match(header, /OUTLINE = a static classification\.\s+FILLED WASH = a live signal\./);
  assert.match(header, /DIAMOND = PROVENANCE/);
  assert.match(header, /CIRCLE = STATUS/);
  assert.match(header, /WORKSPACE DESTINATIONS CARRY NO GLYPH/);
  // Written into the product, not into the shared design system: this is one
  // page's vocabulary and the other surfaces have not been migrated onto it.
  assert.ok(!/design-system/.test(header));
});
