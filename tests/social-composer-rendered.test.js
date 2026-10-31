// RUN_COMPOSER_BROWSER=1 node --test tests/social-composer-rendered.test.js
// Matches the repository's opt-in Playwright convention; fixtures generated here.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

test("composer contains complete images at desktop and 390px and keeps Tab in the composer", {
  timeout: 60000,
  skip: !process.env.RUN_COMPOSER_BROWSER && "Requires workspace Playwright/Chromium",
}, async () => {
  const { chromium } = await import("playwright");
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes("..")) return res.writeHead(404).end();
    try {
      const data = await readFile(new URL(`../src${path}`, import.meta.url));
      res.setHeader("content-type", { js: "text/javascript", css: "text/css", html: "text/html" }[path.split(".").pop()] || "application/octet-stream");
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route("**/api/social-posts?*", route => route.fulfill({ json: { posts: [] } }));
      await page.goto(`http://127.0.0.1:${server.address().port}/social.html`);
      await page.waitForFunction(() => document.documentElement.dataset.shiplogSocial === 'ready');
      await page.locator('#post-compose-open').click();
      assert.equal(await page.locator('#post-form-title').evaluate(el => el === document.activeElement), true);
      for (const [w, h] of [[300, 1800], [800, 800], [12000, 40]]) {
        const png = await page.evaluate(([w, h]) => {
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const context = canvas.getContext("2d");
          context.fillStyle = "#155f9e"; context.fillRect(0, 0, w, h);
          return canvas.toDataURL().split(",")[1];
        }, [w, h]);
        await page.locator('#post-image').setInputFiles({ name: `${w}-${h}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
        await page.locator('#compose-preview-frame[data-state="ready"]').waitFor();
        const layout = await page.evaluate(() => {
          const box = id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
          const img = document.getElementById('compose-preview-image');
          return { overflow: document.documentElement.scrollWidth > innerWidth, frame: box('compose-preview-frame'), image: box('compose-preview-image'), remove: box('remove-image'), alt: box('post-image-alt'), fit: getComputedStyle(img).objectFit, natural: [img.naturalWidth, img.naturalHeight] };
        });
        assert.equal(layout.overflow, false);
        assert.equal(layout.fit, 'contain');
        assert.deepEqual(layout.natural, [w, h]);
        assert.ok(layout.frame.height <= 384);
        assert.ok(layout.image.left >= layout.frame.left && layout.image.right <= layout.frame.right);
        assert.ok(layout.remove.bottom <= layout.frame.top);
        assert.ok(layout.alt.top >= layout.frame.bottom);
        await page.locator('#post-image').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#remove-image').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#post-image-alt').evaluate(el => el === document.activeElement), true);
      }
      await page.locator('#post-compose-cancel').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#post-body').evaluate(el => el === document.activeElement), true);
      await page.locator('#post-body').focus();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#post-compose-open').evaluate(el => el === document.activeElement), true);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
