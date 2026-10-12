// Opt in with RUN_FOLLOW_UP_BROWSER=1 node --test tests/follow-up-rendered.test.js
// Requires Playwright and its Chromium browser installed in the workspace.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const surfaces = ["social", "profile", "post", "index", "releases", "coach"];
const luminance = (rgb) => rgb.map((v) => {
  v /= 255;
  return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
}).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05)
  / (Math.min(luminance(a), luminance(b)) + .05);

test("rendered follow-up states, accessibility tree, focus and contrast on six surfaces", {
  skip: !process.env.RUN_FOLLOW_UP_BROWSER && "Requires workspace Playwright/Chromium; opt in explicitly",
}, async () => {
  const { chromium } = await import("playwright");
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(pathname) || pathname.includes("..")) {
      res.writeHead(404).end(); return;
    }
    try {
      const body = await readFile(new URL(`../src${pathname}`, import.meta.url));
      const ext = pathname.split(".").pop();
      res.setHeader("content-type", { js: "text/javascript", css: "text/css", html: "text/html" }[ext] || "application/octet-stream");
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [375, 1280]) for (const surface of surfaces) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const calls = [];
      let pending;
      await page.route("**/api/**", async (route) => {
        if (new URL(route.request().url()).pathname !== "/api/leads") {
          await route.fulfill({ status: 200, json: {} }); return;
        }
        calls.push(route.request().postDataJSON());
        pending = route;
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/${surface}.html`);
      await page.locator('[aria-controls="site-footer-panel"]').click();
      const form = page.locator("#site-footer-form");
      const retry = page.locator("#site-footer-retry");
      const submit = form.locator('button[type="submit"]').first();
      const status = page.locator("#site-footer-status");
      const email = page.locator("#site-footer-email");
      const cdp = await page.context().newCDPSession(page);
      const noRetry = async () => {
        assert.equal(await retry.isVisible(), false);
        assert.equal(await retry.evaluate((el) => getComputedStyle(el).display), "none");
        const tree = await cdp.send("Accessibility.getFullAXTree");
        assert.equal(tree.nodes.some((n) => !n.ignored && n.name?.value === "Retry your follow-up request"), false);
      };
      const painted = async (locator, focus = false) => {
        const result = await locator.evaluate((el) => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return { color: s.color, background: s.backgroundColor, outline: s.outlineColor,
            outlineWidth: s.outlineWidth, left: r.left, right: r.right, width: innerWidth,
            focus: el.matches(":focus-visible") };
        });
        const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        assert.ok(contrast(rgb(result.color), rgb(result.background)) >= 4.5, JSON.stringify(result));
        assert.ok(result.left >= 0 && result.right <= result.width, `${surface}/${width}: overflow`);
        if (focus) {
          assert.equal(result.focus, true);
          assert.ok(parseFloat(result.outlineWidth) >= 2);
          assert.ok(contrast(rgb(result.outline), [255, 255, 255]) >= 3);
        }
      };
      await noRetry();
      const intent = page.locator("#site-footer-intent-pilot");
      if (await intent.count()) await intent.check();
      const note = form.locator('[name="message"]');
      if (await note.count()) await note.fill("Please discuss a pilot.");
      await email.fill("person@example.com");
      await email.press("Tab");
      assert.equal(await submit.evaluate((el) => el === document.activeElement), true);
      await painted(submit, true);
      for (let attempt = 0; attempt < 3; attempt++) {
        await (attempt ? retry : submit).press("Enter");
        await page.waitForFunction(() => document.querySelector("#site-footer-form").dataset.requestState === "submitting");
        await noRetry();
        assert.match(await status.innerText(), /sending your email/);
        assert.equal(await submit.getAttribute("aria-disabled"), "true");
        await painted(submit, true);
        await painted(status);
        await submit.press("Enter");
        await form.evaluate((el) => el.requestSubmit());
        await page.waitForTimeout(50);
        assert.equal(calls.length, attempt + 1);
        if (attempt) assert.deepEqual(calls[attempt], calls[0]);
        await pending.fulfill(attempt === 2
          ? { status: 201, json: { captured: true, created: true } }
          : { status: 500, json: { error: { code: attempt ? {} : "storage_error", message: "secret person@example.com" } } });
        await page.waitForFunction((state) => document.querySelector("#site-footer-form").dataset.requestState === state,
          attempt === 2 ? "success" : "failure");
        if (attempt < 2) {
          assert.equal(await retry.isVisible(), true);
          const tree = await cdp.send("Accessibility.getFullAXTree");
          assert.ok(tree.nodes.some((n) => !n.ignored && n.name?.value === "Retry your follow-up request"));
          assert.ok(tree.nodes.some((n) => !n.ignored && /No request was sent|couldn’t send/.test(n.name?.value)));
          assert.match(await status.innerText(), /No request was sent|couldn’t send/);
          assert.doesNotMatch(await status.innerText(), /secret|person@example.com/);
          assert.equal(await status.evaluate((el) => el.nextElementSibling.className), "site-footer-actions");
          await painted(status);
          assert.equal(await email.inputValue(), "person@example.com");
          if (await note.count()) assert.equal(await note.inputValue(), "Please discuss a pilot.");
          await email.press("Tab"); // Repository alternative precedes retry.
          await page.keyboard.press("Tab");
          assert.equal(await retry.evaluate((el) => el === document.activeElement), true);
          await painted(retry, true);
        }
      }
      await noRetry();
      assert.equal(await form.isVisible(), false);
      const receipt = page.locator("#site-footer-confirmation");
      assert.match(await receipt.innerText(), /Request received/);
      assert.equal(await receipt.evaluate((el) => el === document.activeElement), true);
      const receiptColors = await receipt.evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        color: getComputedStyle(el.querySelector(".site-footer-confirmation-lead")).color,
        focus: el.matches(":focus-visible"),
        outline: getComputedStyle(el).outlineWidth,
      }));
      const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      assert.ok(contrast(rgb(receiptColors.color), rgb(receiptColors.background)) >= 4.5);
      assert.equal(receiptColors.focus, true);
      assert.ok(parseFloat(receiptColors.outline) >= 2);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      assert.equal(await email.evaluate((el) => el === document.activeElement), true);
      await noRetry();
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
