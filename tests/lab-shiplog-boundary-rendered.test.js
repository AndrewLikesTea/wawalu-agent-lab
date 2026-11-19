// RUN_LAB_BOUNDARY_BROWSER=1 node --test tests/lab-shiplog-boundary-rendered.test.js
// Requires workspace Playwright and Chromium. No production requests are used.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const luminance = (hex) => hex.match(/\w\w/g).map((v) => {
  const n = parseInt(v, 16) / 255;
  return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
}).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};

test("boundary text and focus tokens meet AA on their light and dark surfaces", () => {
  for (const [ink, surface, minimum] of [
    ["171713", "fcfcfb", 4.5], ["6a6a65", "fcfcfb", 4.5],
    ["1f70c1", "fcfcfb", 4.5], ["155f9e", "fcfcfb", 3],
    ["ffffff", "1a1a19", 4.5], ["c3c2b7", "1a1a19", 4.5],
    ["8bc2ff", "1a1a19", 4.5], ["898781", "ffffff", 3],
  ]) assert.ok(contrast(ink, surface) >= minimum, `${ink} on ${surface}`);
});

test("four rendered boundaries at desktop and 390px, both themes and keyboard order", {
  skip: !process.env.RUN_LAB_BOUNDARY_BROWSER && "Requires workspace Playwright/Chromium",
}, async () => {
  const { chromium } = await import("playwright");
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes("..")) {
      res.writeHead(404).end(); return;
    }
    try {
      const data = await readFile(new URL(`../src${path}`, import.meta.url));
      res.setHeader("content-type", { html: "text/html", js: "text/javascript", css: "text/css" }[path.split(".").pop()] || "application/octet-stream");
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [1280, 390]) for (const colorScheme of ["light", "dark"]) {
      for (const route of ["social", "profile", "post", "coach"]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
        await page.route("**/api/**", (route) => route.fulfill({ status: 200, json: {} }));
        await page.goto(`http://127.0.0.1:${server.address().port}/${route}.html`);
        assert.equal(await page.getByRole("main").count(), 1);
        assert.equal(await page.getByRole("contentinfo", { name: "About Shiplog" }).count(), 1);
        const geometry = await page.evaluate(() => {
          const main = document.querySelector("main").getBoundingClientRect();
          const footer = document.querySelector("footer");
          const rect = footer.getBoundingClientRect();
          const style = getComputedStyle(footer);
          return { bottom: main.bottom, top: rect.top, border: style.borderTopWidth,
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(geometry.top >= geometry.bottom);
        assert.equal(geometry.border, "1px");
        assert.equal(geometry.overflow, false);
        // Walk actual Tab stops from the skip target through the footer form.
        await page.locator("main").focus();
        let enteredFooter = false;
        let reachedSubmit = false;
        for (let i = 0; i < 200; i++) {
          await page.keyboard.press("Tab");
          const focused = await page.evaluate(() => {
            const el = document.activeElement;
            const css = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return { main: !!el.closest("main"), footer: !!el.closest("footer"),
              submit: !!el.matches('#site-footer-form button[type="submit"]'),
              ring: css.outlineStyle !== "none" && parseFloat(css.outlineWidth) >= 3,
              visible: r.width > 0 && r.height > 0 };
          });
          if (enteredFooter) assert.equal(focused.main, false);
          if (focused.footer) {
            enteredFooter = true;
            assert.ok(focused.visible && focused.ring);
          }
          if (focused.submit) { reachedSubmit = true; break; }
        }
        assert.ok(enteredFooter && reachedSubmit);
        // Removing colour leaves the heading, whitespace, border and order intact.
        await page.addStyleTag({ content: "html { filter: grayscale(1); }" });
        assert.ok(await page.getByRole("heading", { name: "About Shiplog", exact: true }).isVisible());
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
