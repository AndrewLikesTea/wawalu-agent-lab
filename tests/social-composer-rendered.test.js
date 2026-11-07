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
    for (const colorScheme of ["light", "dark"]) for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      await page.route("**/api/social-posts?*", route => route.fulfill({ json: { posts: [] } }));
      await page.goto(`http://127.0.0.1:${server.address().port}/social.html`);
      await page.waitForFunction(() => document.documentElement.dataset.shiplogSocial === 'ready');
      await page.locator('#post-compose-open').click();
      assert.equal(await page.locator('#post-form-title').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.getByRole('dialog', { name: 'Write a post', exact: true }).count(), 1);
      assert.equal(await page.locator('#post-compose-panel').evaluate(el => el.matches(':modal')), true);
      // Publishing terms stay readable together beside the action at both widths.
      await page.locator('#post-submit').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#post-storage-scope').innerText(),
        'Publishing stores this post on the Wawalu team’s server, not in this browser. Anyone can read a published post, on any device or browser.');
      assert.equal(await page.locator('#post-consequence').innerText(),
        'A published post is public and cannot be edited or deleted by the person who published it. To ask the Wawalu team to remove your own post, select Report post on it and choose “Mistaken or posted in error”. Anyone can select Report post on it. Do not include customer or production data.');
      const termsFit = await page.evaluate(() => {
        const panel = document.getElementById('post-compose-panel');
        const bounds = panel.getBoundingClientRect();
        const boxes = ['post-storage-scope', 'post-consequence', 'post-submit']
          .map(id => document.getElementById(id).getBoundingClientRect());
        return panel.scrollWidth <= panel.clientWidth && boxes.every(box =>
          box.width > 0 && box.height > 0 && box.left >= bounds.left && box.right <= bounds.right &&
          box.top >= Math.max(0, bounds.top) && box.bottom <= Math.min(innerHeight, bounds.bottom)) &&
          boxes[0].bottom <= boxes[1].top && boxes[1].bottom <= boxes[2].top;
      });
      assert.equal(termsFit, true, `publishing terms and action: ${colorScheme}/${width}`);
      await page.locator('#post-compose-open').evaluate(el => el.focus());
      assert.equal(await page.locator('#post-form-title').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('#post-compose-cancel').evaluate(el => el === document.activeElement), true);
      await page.locator('#post-body').fill('A draft kept through both dismissal routes.');
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
      await page.locator('#post-image-alt').fill('A blue rectangle.');
      const stops = await page.evaluate(async () => {
        const { composerFocusables } = await import('/social.js');
        return composerFocusables(document.getElementById('post-compose-panel')).map(el => el.id || el.className);
      });
      assert.ok(stops.includes('post-submit'));
      assert.ok(stops.includes('remove-image'));
      await page.locator('#post-form-title').focus();
      for (const expected of stops) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          const visible = el.id === 'post-image' ? el.closest('.file-button') : el;
          visible.scrollIntoView({ block: "center", behavior: "instant" });
          const rect = visible.getBoundingClientRect();
          const panel = document.getElementById('post-compose-panel');
          const bounds = panel.getBoundingClientRect();
          const style = getComputedStyle(visible);
          return { name: el.id || el.className, ring: style.outlineStyle,
            ringWidth: parseFloat(style.outlineWidth),
            fits: rect.left >= bounds.left + 5 && rect.right <= bounds.right - 5 &&
              rect.top >= bounds.top + 5 && rect.bottom <= bounds.bottom - 5,
            overflow: panel.scrollWidth > panel.clientWidth };
        });
        assert.equal(focused.name, expected);
        assert.notEqual(focused.ring, 'none', `${expected}: ${colorScheme}/${width}`);
        assert.ok(focused.ringWidth >= 3, expected);
        assert.equal(focused.fits, true, expected);
        assert.equal(focused.overflow, false);
      }
      for (const expected of [...stops].reverse().slice(1)) {
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id || document.activeElement.className), expected);
      }
      await page.locator('#post-compose-cancel').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#post-body').evaluate(el => el === document.activeElement), true);
      await page.locator('#post-body').focus();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#post-compose-open').evaluate(el => el === document.activeElement), true);
      await page.locator('#post-compose-open').click();
      assert.equal(await page.locator('#post-body').inputValue(), 'A draft kept through both dismissal routes.');
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await page.locator('#post-compose-open').evaluate(el => el === document.activeElement), true);
      // The empty-feed invitation is a distinct trigger, including mouse clicks.
      const other = page.locator('#feed-state button').filter({ hasText: 'Write a post' });
      await other.click();
      await page.keyboard.press('Escape');
      assert.equal(await other.evaluate(el => el === document.activeElement), true);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
