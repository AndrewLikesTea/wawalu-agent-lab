// The forwarded department link (#1612): resolution, the fallback, the shape of
// the model, and the one list of slugs the address and the drill-down share.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  DEPARTMENT_FALLBACK, DEPARTMENT_FALLBACK_TEXT, DEPARTMENT_PARAM,
  FINOPS_DEPARTMENT_SLUGS, FINOPS_DEPARTMENT_VIEW_MODEL_VERSION,
  departmentSlugFromSearch, departmentSlugs, departmentViewModel,
  normalizeDepartmentSlug,
} from "../src/finops-department-view-model.js";
import {
  DEPARTMENT_DISCLOSURE_ID, DEPARTMENT_PANEL_ID, FORWARDED_STATUS_ID,
  applyForwardedDepartment,
} from "../src/finops-forwarded-department-view.js";
import { FINOPS_DEPARTMENT_IDS } from "../src/finops-destinations.js";
import { DEPARTMENT_PARAM as ROUTER_DEPARTMENT_PARAM } from "../src/destination-route.js";
import { parseHtml } from "./support/browser.js";

const SEED = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const PAGE_HTML = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

/**
 * The same record over a DIFFERENT reporting period, built here rather than
 * committed: two periods is the point, and a second copy of a 200 KiB seed on
 * disk is a second thing to keep in step with the first.
 */
function shiftPeriod(record, { period, previousPeriod, scale }) {
  return {
    ...record,
    departments: record.departments.map((department) => ({
      ...department,
      period,
      spendUsd: Math.round(department.spendUsd * scale),
      previousPeriod: { ...department.previousPeriod, period: previousPeriod },
    })),
  };
}

const LATER = shiftPeriod(SEED, {
  period: "25 Jul–25 Aug 2026", previousPeriod: "25 Jun–25 Jul 2026", scale: 1.1,
});

/* ------------------------------ normalization ------------------------------ */

test("the normalization rule is trim, lower-case, then slug-shaped or nothing", () => {
  assert.equal(normalizeDepartmentSlug("backend"), "backend");
  assert.equal(normalizeDepartmentSlug("  BACKEND  "), "backend");
  assert.equal(normalizeDepartmentSlug("Data-ML"), "data-ml");
  assert.equal(normalizeDepartmentSlug("\tsre\n"), "sre");
  for (const hostile of [
    "../../etc/passwd", "back end", "back_end", "-backend", "back*end",
    "a".repeat(41), "", "   ", null, undefined, 42, {}, ["backend"], true,
  ]) {
    assert.equal(normalizeDepartmentSlug(hostile), null,
      `${JSON.stringify(hostile)} is not a slug this analysis can look up`);
  }
});

test("the query parameter is the one the router already reserves", () => {
  assert.equal(DEPARTMENT_PARAM, ROUTER_DEPARTMENT_PARAM);
  assert.equal(departmentSlugFromSearch("?department=backend"), "backend");
  assert.equal(departmentSlugFromSearch("?destination=department&department=%20SRE%20"), " SRE ");
  assert.equal(departmentSlugFromSearch("?scope=month"), null);
  // Raw on purpose: "nothing was asked for" and "junk was asked for" are two
  // different sentences, and normalizing here would flatten them into one.
  assert.equal(departmentSlugFromSearch("?department=Not%20A%20Department"), "Not A Department");
  for (const junk of [null, undefined, 7, true]) {
    assert.equal(departmentSlugFromSearch(junk), null);
  }
});

/* ------------------------------ slug listing ------------------------------- */

test("the record's own ids are the slug list, normalized and deduplicated", () => {
  assert.deepEqual([...departmentSlugs(SEED)], [...FINOPS_DEPARTMENT_SLUGS]);
  assert.deepEqual([...departmentSlugs({ departments: [
    { id: "Backend" }, { id: " backend " }, { id: "sre" }, { id: 4 }, { id: "not a slug" }, null,
  ] })], ["backend", "sre"]);
  for (const empty of [null, undefined, {}, { departments: null }, { departments: "backend" }]) {
    assert.deepEqual([...departmentSlugs(empty)], []);
  }
});

test("the destination registry sources its department ids from this selector", () => {
  // The registry used to hold its own literal. If these two ever disagree, an
  // address the router accepts resolves to a department the drill-down cannot
  // answer for — or the other way round, which is a link to an empty screen.
  assert.deepEqual([...FINOPS_DEPARTMENT_IDS], [...FINOPS_DEPARTMENT_SLUGS]);
  assert.deepEqual([...FINOPS_DEPARTMENT_IDS], [...departmentSlugs(SEED)]);
  // And the seed is what both of them claim to describe.
  assert.deepEqual(SEED.departments.map((entry) => entry.id), [...FINOPS_DEPARTMENT_IDS]);
});

/* -------------------------------- resolution ------------------------------- */

test("a resolved department carries all five readings, for two departments over two periods", () => {
  for (const record of [SEED, LATER]) {
    for (const slug of ["backend", "frontend"]) {
      const model = departmentViewModel(record, slug);
      const where = `${slug} in ${record.departments[0].period}`;
      assert.equal(model.version, FINOPS_DEPARTMENT_VIEW_MODEL_VERSION, where);
      assert.equal(model.resolved, true, where);
      assert.equal(model.slug, slug, where);
      assert.equal(model.fallback, null, where);
      assert.equal(model.period, record.departments[0].period, where);

      // 1. Spend mix: one row per published category, each with a share and what
      //    that share costs.
      assert.equal(model.spendMix.length >= 4, true, where);
      for (const row of model.spendMix) {
        assert.match(row.shareText, /%$/, where);
        assert.match(row.spendText, /^\$/, where);
        assert.equal(Number.isFinite(row.spendUsd), true, where);
      }
      // 2. Trajectory, 3. peer position, 4. training gap: each states something.
      assert.equal(model.trajectory.available, true, where);
      assert.match(model.trajectory.text, /against 25 /, where);
      assert.equal(typeof model.peerPosition.quartile, "string", where);
      assert.match(model.peerPosition.text, /quartile/i, where);
      assert.match(model.trainingGap.text, /re-prompts|compress/, where);
      // 5. The intervention verdict, from the published scorer.
      assert.match(model.intervention.version, /^department-intervention\//, where);
      assert.equal(typeof model.intervention.outcome, "string", where);
      assert.equal(model.intervention.text.length > 0, true, where);

      // It is a value, not a view: it survives a round trip through JSON.
      assert.deepEqual(JSON.parse(JSON.stringify(model)).slug, slug, where);
    }
  }
});

test("the two periods are two different readings of the same department", () => {
  const first = departmentViewModel(SEED, "backend");
  const second = departmentViewModel(LATER, "backend");
  assert.notEqual(first.period, second.period);
  assert.notEqual(first.spendUsd, second.spendUsd);
  assert.equal(first.name, second.name);
  // The mix shares are the department's own and did not move with the spend, so
  // the dollars behind them did.
  assert.notEqual(first.spendMix[0].spendText, second.spendMix[0].spendText);
});

test("an unnormalized slug resolves to the same department as its normal form", () => {
  const plain = departmentViewModel(SEED, "data-ml");
  for (const variant of ["Data-ML", " data-ml ", "DATA-ML\n"]) {
    assert.deepEqual(departmentViewModel(SEED, variant), plain,
      `${JSON.stringify(variant)} must resolve exactly as "data-ml" does`);
  }
});

/* --------------------------------- fallback -------------------------------- */

test("every unresolvable slug falls back, is named, and shows no department", () => {
  const cases = [
    [undefined, DEPARTMENT_FALLBACK.noSlug],
    [null, DEPARTMENT_FALLBACK.noSlug],
    ["", DEPARTMENT_FALLBACK.noSlug],
    ["   ", DEPARTMENT_FALLBACK.noSlug],
    ["atlas-platfrom", DEPARTMENT_FALLBACK.unknownSlug],
    ["nope", DEPARTMENT_FALLBACK.unknownSlug],
    ["../../etc/passwd", DEPARTMENT_FALLBACK.malformedSlug],
    ["backend evil", DEPARTMENT_FALLBACK.malformedSlug],
    ["b".repeat(4096), DEPARTMENT_FALLBACK.malformedSlug],
    [42, DEPARTMENT_FALLBACK.malformedSlug],
    [{ id: "backend" }, DEPARTMENT_FALLBACK.malformedSlug],
    [["backend"], DEPARTMENT_FALLBACK.malformedSlug],
  ];
  for (const [input, reason] of cases) {
    const model = departmentViewModel(SEED, input);
    const where = JSON.stringify(input)?.slice(0, 40) ?? String(input);
    assert.equal(model.resolved, false, where);
    assert.equal(model.fallback.reason, reason, where);
    assert.equal(model.fallback.text, DEPARTMENT_FALLBACK_TEXT[reason], where);
    assert.equal(model.statusText, DEPARTMENT_FALLBACK_TEXT[reason], where);
    // The property that matters most: no other department's figures ride along.
    assert.equal(model.slug, null, where);
    assert.equal(model.name, null, where);
    assert.equal(model.spendUsd, null, where);
    assert.equal(model.spendMix.length, 0, where);
    assert.equal(model.intervention, null, where);
    // The list of what WOULD resolve is still published, so the page can rank.
    assert.deepEqual([...model.availableSlugs], [...FINOPS_DEPARTMENT_SLUGS], where);
  }
});

test("only a slug-shaped request is ever echoed back onto the page", () => {
  assert.equal(departmentViewModel(SEED, "atlas-platfrom").requestedSlug, "atlas-platfrom");
  assert.equal(departmentViewModel(SEED, " NOPE ").requestedSlug, "nope");
  for (const hostile of ["<img src=x onerror=alert(1)>", "a b", 42, {}, "b".repeat(4096)]) {
    assert.equal(departmentViewModel(SEED, hostile).requestedSlug, null,
      "an address bar may not put its own prose on this page");
  }
});

test("a record with no departments is a fallback, not a crash", () => {
  for (const empty of [null, undefined, {}, { departments: [] }, { departments: "x" }, 7]) {
    const model = departmentViewModel(empty, "backend");
    assert.equal(model.resolved, false);
    assert.equal(model.fallback.reason, DEPARTMENT_FALLBACK.noDepartments);
    assert.equal(model.availableSlugs.length, 0);
  }
});

test("every reason code has a sentence and every sentence has a reason code", () => {
  const codes = Object.values(DEPARTMENT_FALLBACK);
  assert.deepEqual(Object.keys(DEPARTMENT_FALLBACK_TEXT).sort(), [...codes].sort());
  for (const code of codes) {
    if (code === DEPARTMENT_FALLBACK.none) continue;
    const text = DEPARTMENT_FALLBACK_TEXT[code];
    assert.equal(text.length > 20 && text.length < 260, true, `${code} is not a sentence`);
    assert.match(text, /\.$/, `${code} does not end in a full stop`);
  }
});

/* ------------------------------ the page half ------------------------------ */

function pageWithStub() {
  const document = parseHtml(PAGE_HTML);
  const calls = [];
  const showScreen = (_doc, route) => {
    calls.push(route);
    return { destination: route.slug, selection: route.selection, selectionApplied: true };
  };
  return { document, calls, showScreen };
}

test("the shipped page authors the status slot, hidden and inside the department panel", () => {
  const document = parseHtml(PAGE_HTML);
  const status = document.getElementById(FORWARDED_STATUS_ID);
  // Not a live region, on purpose: it is inside a disclosure, and a shut
  // disclosure announces to nobody. tests/finops-how-we-know.test.js enforces it.
  assert.equal(status.getAttribute("role"), null);
  assert.equal(status.getAttribute("aria-live"), null);
  assert.equal(status.hidden, true, "it says nothing until a link asks it to");
  assert.equal(status.dataset.departmentResolved, "false");
  // It is INSIDE the existing panel, so this change declares no new top-level
  // region and the census in finops-destination-regions.js is untouched.
  let node = status.parentNode;
  const ancestors = [];
  while (node) {
    if (node.id) ancestors.push(node.id);
    node = node.parentNode;
  }
  assert.equal(ancestors.includes(DEPARTMENT_PANEL_ID), true);
  assert.equal(ancestors.includes(DEPARTMENT_DISCLOSURE_ID), true);
});

test("a resolved link opens the department disclosure, selects it and takes focus", () => {
  const { document, calls, showScreen } = pageWithStub();
  const model = departmentViewModel(SEED, " Backend ");
  const result = applyForwardedDepartment(document, model, { showScreen });

  assert.deepEqual(calls, [{ slug: "department", selection: "backend" }]);
  assert.deepEqual({ ...result }, {
    applied: true, resolved: true, reason: DEPARTMENT_FALLBACK.none,
    opened: true, selected: true, focused: true,
  });
  const status = document.getElementById(FORWARDED_STATUS_ID);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Atlas Platform/);
  assert.equal(status.dataset.departmentResolved, "true");
  assert.equal(status.dataset.requestedDepartment, "backend");
  assert.equal(document.getElementById(DEPARTMENT_DISCLOSURE_ID).open, true,
    "a sentence inside a closed details is a sentence nobody reads");
  assert.equal(document.activeElement?.id, DEPARTMENT_PANEL_ID);
});

test("a broken forwarded link opens the region, states why, and selects nothing", () => {
  const { document, calls, showScreen } = pageWithStub();
  const result = applyForwardedDepartment(document,
    departmentViewModel(SEED, "atlas-platfrom"), { showScreen });

  assert.deepEqual(calls, [], "no screen change is asked for on a link that resolved to nothing");
  assert.equal(result.resolved, false);
  assert.equal(result.reason, DEPARTMENT_FALLBACK.unknownSlug);
  assert.equal(result.selected, false);
  assert.equal(result.focused, false, "focus stays where the reader left it");
  const status = document.getElementById(FORWARDED_STATUS_ID);
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, DEPARTMENT_FALLBACK_TEXT[DEPARTMENT_FALLBACK.unknownSlug]);
  assert.equal(status.dataset.fallbackReason, DEPARTMENT_FALLBACK.unknownSlug);
  // Opened, because the reason is only readable in open content.
  assert.equal(document.getElementById(DEPARTMENT_DISCLOSURE_ID).open, true);
});

test("a hostile slug reaches the document as nothing at all", () => {
  const { document, showScreen } = pageWithStub();
  applyForwardedDepartment(document,
    departmentViewModel(SEED, "<img src=x onerror=alert(1)>"), { showScreen });
  const status = document.getElementById(FORWARDED_STATUS_ID);
  assert.equal(status.dataset.requestedDepartment, undefined);
  assert.equal(status.dataset.fallbackReason, DEPARTMENT_FALLBACK.malformedSlug);
  assert.equal(status.textContent.includes("<"), false);
  assert.equal(status.textContent.includes("alert"), false);
});

test("an ordinary visit changes nothing: no open disclosure, no focus, no sentence", () => {
  const { document, calls, showScreen } = pageWithStub();
  const result = applyForwardedDepartment(document,
    departmentViewModel(SEED, departmentSlugFromSearch("")), { showScreen });

  assert.deepEqual(calls, []);
  assert.equal(result.reason, DEPARTMENT_FALLBACK.noSlug);
  assert.equal(result.opened, false);
  assert.equal(result.focused, false);
  assert.equal(document.getElementById(FORWARDED_STATUS_ID).hidden, true);
  assert.equal(document.activeElement?.id, undefined, "nothing was focused");
  // A closed details reports `open` as undefined in this harness, never false.
  assert.equal(!document.getElementById(DEPARTMENT_DISCLOSURE_ID).open, true);
});

test("a page with no status slot is reported, not crashed into", () => {
  const result = applyForwardedDepartment(parseHtml("<main id=\"m\"></main>"),
    departmentViewModel(SEED, "backend"), { showScreen: () => ({}) });
  assert.equal(result.applied, false);
  assert.equal(result.focused, false);
  for (const doc of [null, undefined, {}]) {
    assert.equal(applyForwardedDepartment(doc, departmentViewModel(SEED, "sre")).applied, false);
  }
});
