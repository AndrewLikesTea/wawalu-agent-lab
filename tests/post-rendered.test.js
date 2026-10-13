// RUN_POST_BROWSER=1 node --test tests/post-rendered.test.js
// Uses workspace Playwright/Chromium, like follow-up-rendered.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const post = {
  id: "rendered-post", author: "Mina", body: "LongText".repeat(35),
  createdAt: "2026-07-14T09:00:00Z",
  image: { src: "/media/test.svg", alt: "A blue square", width: 80, height: 80 },
};
const luminance = (rgb) => rgb.map((v) => {
  v /= 255;
  return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
}).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);

test("standalone post: rendered states, keyboard recovery and media at phone and desktop widths", {
  timeout: 60000,
  skip: !process.env.RUN_POST_BROWSER && "Requires workspace Playwright/Chromium",
}, async () => {
  const { chromium } = await import("playwright");
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes("..")) {
      res.writeHead(404).end(); return;
    }
    try {
      const data = await readFile(new URL(`../src${path}`, import.meta.url));
      res.setHeader("content-type", { js: "text/javascript", css: "text/css", html: "text/html" }[path.split(".").pop()] || "application/octet-stream");
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [320, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const requests = [];
      await page.route("**/social-demo-data.json", (route) => { requests.push(route); });
      await page.route("**/media/test.svg", (route) => route.fulfill({ status: 404 }));
      const state = async (value) => {
        await page.locator(`#post-detail[data-post-state="${value}"]`).waitFor();
        assert.equal(await page.locator("[data-post-state-panel]").count(), 1);
        assert.equal(await page.locator("#post-back").getAttribute("href"), "/social.html");
        assert.ok(await page.locator("#post-back").isVisible());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      };
      const answer = async (status, posts = []) => {
        await page.waitForFunction(() => document.documentElement.dataset.shiplogPostDetail === "loading");
        while (!requests.length) await new Promise((resolve) => setTimeout(resolve, 10));
        await requests.shift().fulfill({ status, json: { posts } });
      };
      const focusRing = async (selector) => {
        const style = await page.locator(selector).evaluate((el) => {
          const css = getComputedStyle(el);
          return { focused: el === document.activeElement, width: parseFloat(css.outlineWidth), style: css.outlineStyle };
        });
        assert.ok(style.focused && style.width >= 2 && style.style !== "none");
      };
      await page.goto(`http://127.0.0.1:${server.address().port}/post.html?id=rendered-post`);
      await state("loading");
      assert.equal(await page.locator("#post-detail").getAttribute("role"), "status");
      assert.equal(await page.locator(".detail-loading-text").innerText(), "The post is loading.");
      await answer(503);
      await state("error");
      assert.equal(await page.locator(".detail-retry").count(), 1);
      await page.locator(".detail-retry").focus();
      await page.keyboard.press("Tab");
      await focusRing(".detail-state-feed");
      await page.keyboard.press("Shift+Tab");
      await focusRing(".detail-retry");
      await page.keyboard.press("Enter");
      await state("loading");
      await focusRing("#post-detail");
      await answer(200, [post]);
      await state("loaded");
      await focusRing(".detail-post");
      const heading = await page.locator("h1").innerText();
      assert.match(heading, /Mina/);
      await page.locator('.detail-media[data-state="error"]').waitFor();
      assert.equal(await page.locator(".detail-image").count(), 0);
      const caption = page.locator(".detail-image-description");
      assert.equal(await caption.getAttribute("aria-hidden"), null);
      assert.equal(await page.locator(".detail-figure").getAttribute("aria-describedby"), await caption.getAttribute("id"));
      const order = await page.locator(".detail-post").evaluate((el) => [...el.children].map((n) => n.className));
      assert.ok(order.indexOf("detail-caption") < order.indexOf("detail-figure"));
      assert.ok(await page.locator(".detail-figure").evaluate((el) => Boolean(
        el.compareDocumentPosition(document.querySelector(".share-control")) & Node.DOCUMENT_POSITION_FOLLOWING)));
      // Measure painted caption contrast against the nearest opaque background.
      const colors = await caption.evaluate((el) => {
        let parent = el, background;
        while (parent) {
          background = getComputedStyle(parent).backgroundColor;
          if (background !== "rgba(0, 0, 0, 0)") break;
          parent = parent.parentElement;
        }
        return [getComputedStyle(el).color, background];
      });
      const [a, b] = colors.map((color) => luminance(color.match(/[\d.]+/g).slice(0, 3).map(Number)));
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5);
      await page.locator(".post-report-button").focus();
      await focusRing(".post-report-button");
      await page.keyboard.press("Enter");
      assert.ok(await page.locator("#post-report-panel").isVisible());
      await page.locator("#post-report-close").focus();
      await page.keyboard.press("Space");
      await focusRing(".post-report-button");
      await page.reload();
      await answer(200, [{ ...post, image: undefined }]);
      await state("loaded");
      assert.equal(await page.locator("h1").innerText(), heading);
      assert.equal(await page.locator(".detail-figure,.detail-image-description").count(), 0);
      assert.ok(await page.locator(".post-report-button").isVisible());
      await page.reload();
      await answer(200);
      await state("not-found");
      assert.match(await page.locator("#post-detail").innerText(), /Post unavailable/);
      assert.equal(await page.locator(".detail-retry,.post-report-button").count(), 0);
      await page.locator(".detail-state-feed").focus();
      await page.keyboard.press("Enter");
      await page.waitForURL("**/social.html");
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
