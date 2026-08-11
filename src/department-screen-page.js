// The department screen's entry: read the address bar, load the bundled
// analysis, paint one of three states.
//
// WHY THE SCREEN LOADS AT ALL. This surface is addressed from somewhere else —
// evolution.html forwards `?department=` — so the first thing a reader sees is
// whatever the document says before this module has an answer. That state is
// authored in the markup and is a real state, not a flash: the page says it is
// reading, `aria-busy` is true, and the announcement is already correct if the
// fetch never lands.
//
// THE FAILURE STATE IS THE POINT. A slug this analysis does not hold, a link
// with no slug at all, and a dataset this browser could not read are three
// different problems, and each one is named. All three offer the same way
// forward — the organization-wide answer, carrying the same selection — because
// a dead end with no door is the state this screen exists to replace.
//
// NOTHING IS UPLOADED, STORED, OR CREDENTIALED. One same-origin request for a
// committed synthetic fixture, and no writes of any kind.

import { applyDepartmentScreen } from "/department-screen-view.js";
import {
  DEPARTMENT_SCREEN_REASON,
  departmentScreenModel,
  departmentSlugFrom,
  pendingDepartmentScreen,
  unavailableDepartmentScreen,
} from "/department-screen.js";

const DATA_URL = "/evolution-demo-data.json";

const slug = departmentSlugFrom(globalThis.window?.location?.search ?? "");

/**
 * Load the bundled analysis and paint the answer for `slug`.
 *
 * Every failure this can meet — a request that does not resolve, a response that
 * is not the document it claims to be, a payload with no departments in it —
 * lands in the one named unavailable state rather than escaping and leaving the
 * pending sentence on screen forever.
 */
export async function loadDepartmentScreen() {
  applyDepartmentScreen(document, pendingDepartmentScreen(slug));
  try {
    const response = await fetch(DATA_URL);
    if (!response?.ok) throw new Error("the bundled analysis did not load");
    const data = await response.json();
    applyDepartmentScreen(document, departmentScreenModel({
      departments: data?.departments,
      benchmark: data?.benchmark,
      slug,
    }));
  } catch {
    applyDepartmentScreen(document,
      unavailableDepartmentScreen(DEPARTMENT_SCREEN_REASON.loadFailed, slug));
  }
  return document.getElementById("department-answer");
}

/**
 * The load now in flight, so a test waits on the paint rather than on a timer.
 *
 * Started rather than awaited at the top level: the pending state is a state a
 * reader occupies, and a module that resolved only once the fetch had landed
 * would make it unobservable to everything except a slow network.
 */
export const ready = loadDepartmentScreen();
