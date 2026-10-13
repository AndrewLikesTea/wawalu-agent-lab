# Standalone Social post — issue #2863

The existing `/post.html` → `post-page.js` → `post-detail.js` path already renders
loading, unavailable, request failure/retry, and loaded text/image posts. It keeps
the Social feed exit in every state and mounts the shared `post-report.js` review
form on loaded posts. No new reporting backend or alternate flow is needed.

This change exposes the permalink's figure caption to assistive technology and
associates it with the figure, while preserving image alt text for direct image
navigation. It also removes already-failed images after insertion, preventing a
cached failure from leaving a broken image alongside the fallback. Existing product
CSS provides wrapping, image containment, typography and visible focus rings.

## Verification

- `npm run check` passed: 7,482 tests passed, zero failures, four skipped, and
  one pre-existing release-keyboard TODO; production build, artifact/size checks,
  and production E2E checks passed (45 passed, one existing TODO).

- Focused tests: post detail, permalink states, report flow, failed images, and
  shared image descriptions pass. New regressions cover the accessible caption
  association and a synchronously known image failure.
- `tests/post-rendered.test.js` adds opt-in Playwright checks at 320px and 1280px:
  loading text/status, persistent feed exits, error → keyboard retry → loading →
  loaded, focus rings, caption contrast/association, content order, broken media,
  text-only posts, report opening/closing, and unavailable → Social navigation.
- Run with `RUN_POST_BROWSER=1 node --test tests/post-rendered.test.js` once
  Playwright and Chromium are available in the workspace. This environment has
  neither the Playwright package nor a cached copy; installation failed with
  `ENOTFOUND registry.npmjs.org`. Real-browser checks remain unverified here.

The caption can be encountered both through direct image navigation (alt text)
and through figure reading (caption). This preserves access to the visible text;
manual screen-reader checking is still useful for announcement behavior.

No bindings, migrations, infrastructure, or production deployment changes.
