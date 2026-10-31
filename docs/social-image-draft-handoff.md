# Social image draft resilience — #3073

The shipped composer is an in-flow disclosure below the feed, not a modal:
there is no overlay, dialog primitive, or inert background. It retains heading
focus on open, Escape/Close, draft preservation, opener focus restoration, and
the #2456 Tab ring, whose exits #post-keyboard-hint names. No dialog or
aria-modal semantics were added.

The image group names and associates the preview, file metadata, live status,
Remove image action, and description. Preparation leaves Remove image usable;
publication waits for a successful image load. Read/decode failures remain
explained and removable. Generation checks cover reading and bitmap decoding;
a fresh image element and guarded listeners isolate each preview request.
Removed and superseded images cannot mutate the current draft.

The preview reuses the existing surface, border, type, and spacing values.
A bounded grid track and contained scaling preserve the entire image without
allowing intrinsic dimensions to expand the page or overlap its controls.
The original uploaded data URL is rendered directly, including animated GIF
and WebP bytes; no canvas conversion or static frame extraction was introduced.
The existing reduced-motion rule only suppresses the loading shimmer.

## Changed files

- `src/social-page.js`: preparation, decoding, failure, removal, race guards.
- `src/social.html`: semantic image group and action/status association.
- `src/social-composer.css`: bounded contained preview and shrinking/wrapping.
- `tests/social-image-draft.test.js`: transitions, semantics, keyboard stops,
  stale events, asynchronous removal/replacement, GIF byte preservation.
- `tests/social-composer-rendered.test.js`: opt-in computed browser layout and
  keyboard assertions at 390px and 1280px, with generated portrait, square,
  and extreme panoramic PNG fixtures.
- `tests/social-image-upload-limits.test.js`,
  `tests/social-paint-handoff-flow.test.js`,
  `tests/social-publish-progress.test.js`: await actual preview readiness.
- `tests/support/social-paint-arrival.js`: explicit simulated image loads,
  with a manual-event mode for race tests.

## Validation and remaining work

`npm run check` passed (7,769 passed, zero failures, five skips, one existing
TODO), including production build, artifact/size verification, and production
journeys (50 passed, zero failures, one existing TODO). A separate production
build and verification also passed. Social tests passed; all six final focused
image-draft tests passed. The existing TODO concerns Enter activation of a
release-row disclosure, outside this issue. The rendered test
uses the repository's existing opt-in Playwright convention. Browser execution
is still required in an environment with Playwright and Chromium:

```
RUN_COMPOSER_BROWSER=1 node --test tests/social-composer-rendered.test.js
```

Playwright is absent here; installation failed with `ENOTFOUND` for
`registry.npmjs.org`. Consequently computed browser layout is not verified in
this environment. GIF tests prove byte preservation, not animation playback.
Actual GIF/WebP playback and browser-specific `createImageBitmap` behavior
remain browser QA risks, particularly in Safari and Firefox. No production
configuration, binding, migration, deployment, or feed/profile changes occur.
