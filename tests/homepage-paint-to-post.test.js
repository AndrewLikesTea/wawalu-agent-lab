import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf, pressTab } from "./support/browser.js";

test("homepage presents a named, ordered Paint → Social → People journey", async (t) => {
  const page = await loadPage(new URL("../src/index.html", import.meta.url));
  t.after(() => page.restore());
  const journey = page.document.querySelector(".paint-to-post");
  assert.equal(journey.tagName, "OL");
  assert.equal(textOf(page.document.getElementById(journey.getAttribute("aria-labelledby"))),
    "From Paint to Social to People");
  const steps = journey.querySelectorAll("li");
  assert.equal(steps.length, 3);
  const expected = [
    ["/paint/", "Create and export an image in Paint", /export it as a PNG/],
    ["/social.html", "Publish your image on Social", /Attach the exported PNG.*required image description.*chosen display name/],
    ["/profile.html", "View your image post in People", /Choose the same display name.*post you published/],
  ];
  for (const [index, step] of steps.entries()) {
    const links = step.querySelectorAll("a");
    assert.equal(links.length, 1);
    assert.equal(links[0].getAttribute("href"), expected[index][0]);
    assert.equal(textOf(links[0]), expected[index][1]);
    assert.equal(links[0].getAttribute("aria-label"), null, "visible text names the link");
    assert.equal(links[0].getAttribute("tabindex"), null, "use native link focus order");
    assert.match(textOf(step), expected[index][2]);
  }

  // Walk the page's native tab sequence into and through the new journey.
  const links = journey.querySelectorAll("a");
  let reached = false;
  for (let index = 0; index < 300; index += 1) {
    if (pressTab(page.document) === links[0]) { reached = true; break; }
  }
  assert.ok(reached, "Paint is reachable from the page's tab sequence");
  assert.equal(pressTab(page.document), links[1]);
  assert.equal(pressTab(page.document), links[2]);
  assert.equal(pressTab(page.document, { shift: true }), links[1]);

  const summaries = page.document.querySelector('ul[aria-labelledby="site-guide-demos-title"]');
  assert.deepEqual(summaries.querySelectorAll("a").map(textOf),
    ["Social", "People", "Paint", "Agent observatory"]);
});
