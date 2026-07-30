# First-run prompt-coach destination — design handoff

Issue #503. Implementation-ready specification for a dedicated destination that
a first-time visitor can arrive at, read, and get one real grade from. No code
is changed by this document; every product change it asks for is named with the
file, the selector, and the assertion that should hold afterwards.

**Canonical direction read first:** `PRODUCT.md`, `.agent-policy.json`, and
`design-system/claude-design/` (`README.md`, `review-00-summary.html`,
`review-08-foundations.html`). The mirror is refreshed from Claude Design and is
**not edited here**; where the product contradicts it, this document proposes a
change to the product's own CSS and says so.

---

## 1. What exists today, and why a first run reads badly

The prompt coach is a panel inside the AI FinOps dashboard.

| Fact | Where |
| --- | --- |
| The coach is `section.prompt-coaching#prompt-coaching` | `src/evolution.html:662` |
| It is the **eighth** top-level section of that page, after the hero, guided result, the whole local-import workflow, the restored briefing, and the workspace restore | `src/evolution.html:30–662` |
| Its front door (value → benchmark → one action → exclusions) is painted from the journey contract | `src/prompt-coaching-entry-view.js:56–148`, `src/prompt-coaching-entry.js:392` |
| Its wiring is a page entry of its own that shares no state with the FinOps analysis | `src/prompt-coaching-page.js:1–18` |
| It has **no navigation entry** and **no in-page link** anywhere in `src/*.html` | `src/site-nav.js:30–38`; no `#prompt-coaching` href exists in the repo |
| The dashboard's own `h1` is `Know what your AI spend is buying.` — a spend claim, not a prompt question | `src/evolution.html:33` |

So the destination for "grade one prompt" is currently *a scroll position on a
page about something else*. Three consequences a first-run visitor feels:

1. **The one question is an `h2` ranked below an unrelated `h1`.** A reader
   jumping by heading meets ten headings about spend before the question this
   workflow answers.
2. **Nothing links to it.** The workflow is reachable only by scrolling the
   dashboard, so it cannot be shared, bookmarked with intent, or arrived at.
3. **The page cost is the dashboard's cost.** `evolution-page.js` and the whole
   import pipeline load beside a workflow that reads nothing but a textarea.

The workflow itself is in good shape and this handoff changes none of its
semantics: grade, revise, re-grade, refuse, and compare are exactly as
`docs/prompt-coaching-session-contract.md`,
`docs/prompt-revision-comparison-contract.md`, and
`docs/first-run-coach-fixtures.md` specify.

### Dashboard relationships that must survive unchanged

| Relationship | Requirement |
| --- | --- |
| `#prompt-coaching` panel on `evolution.html` | Stays. Same markup, same ids, same reading order, same tests. |
| `prompt-coaching-page.js` wiring | Unchanged. It binds by id and every module already no-ops when its markup is absent (`prompt-coaching-entry-view.js:157`, `prompt-coaching-contract-view.js:172`, `coaching-summary-view.js:48`, `prompt-coaching-view.js:377`). |
| FinOps analysis, import, workspace, briefing | Untouched. The destination loads none of them. |
| `SITE_NAV` | Untouched (see §3). |

---

## 2. What the destination is for

One sentence: **a visitor who has typed nothing arrives, presses one control,
and reads a real grade of a real prompt, with the evidence behind it available
but not in the way.**

The reading order is fixed and is the one the journey contract already states
(`src/prompt-coaching-entry-view.js:1–22`):

1. **One question** — "Would a model answer this prompt well?"
2. **One material sample grade, with what it is measured against, how confident
   it is, and where it came from.**
3. **One prioritized next action.**
4. **Evidence, progressively disclosed** — the rubric detail, the per-turn
   reading, the runners-up, the privacy proofs.

Nothing else earns a position above the fold.

---

## 3. The destination: `/coach.html`

| Decision | Value | Why |
| --- | --- | --- |
| File | `src/coach.html` | The build copies `src/` verbatim (`src/site-nav.js:4–6`). |
| URL | `/coach.html` | |
| `<title>` | `Prompt coach · Shiplog` | Matches the `… · Shiplog` convention in `tests/site-nav.test.js` PAGES. |
| Nav ownership | `siteNavMarkup("/evolution.html")` — i.e. **AI FinOps** keeps `aria-current="page"` | `src/site-nav.js:15–17`: within-page destinations "are not peers of these surfaces and stay out of this list; they are linked from the page body that owns them." `savings-action-center.html` and `savings-commitment.html` are the precedent (`tests/site-nav.test.js` PAGES rows). |
| Stylesheets | `/styles.css` then `/evolution.css` | Every token this surface needs already lives in those two files. No third stylesheet. |
| Scripts | `<script type="module" src="/prompt-coaching-page.js"></script>` and `/site-footer-page.js` — **not** `/evolution-page.js` | The coach shares no state with the analysis (`src/prompt-coaching-page.js:4–7`). |

**Why not a new nav peer.** Adding a seventh top-level nav item rewrites the
header on all thirteen pages and re-ranks the dashboard against a single-purpose
tool. That is a change to an existing dashboard workflow, which this issue
excludes. If the owner later wants the coach promoted to a peer, it is one entry
in `SITE_NAV` plus the `current` value in the PAGES row — deliberately a
one-line decision, not a rewrite.

### How a reader gets there

One additive anchor, no behaviour change, in the dashboard panel's
`.section-heading` (`src/evolution.html:663–667`), after the existing paragraph:

> `<p class="prompt-coaching-jump"><a href="/coach.html">Open the prompt coach on its own page</a></p>`

Style it with the existing `.record-link` / `.detail-back` link treatment in
`styles.css`; introduce no new link colour. The panel keeps working in place for
anyone who ignores it.

---

## 4. Landmarks and heading outline

Landmarks are exactly those every other page ships (`src/styles.css:7–24`):
skip link → `header.site-header` (with `nav.site-nav[aria-label="Wawalu Labs"]`)
→ `main#main-content[tabindex="-1"]` → the site footer region.

```
h1  #page-title                  Would a model answer this prompt well?
 h2 #prompt-coaching-question    Grade one prompt, in this tab
  h3 #prompt-coaching-entry-title  Start here                 (entry section)
   h4 What you get here                                       (entry-view, unchanged)
   h4 Measured against what                                   (entry-view, unchanged)
   h4 Your first move                                         (entry-view, see §11-C)
  h3 #prompt-coaching-form-title   Grade a prompt              (NEW static heading)
  h3 What changed                                             (prompt-coaching-view.js:519)
  h3 Take this with you                                       (evolution.html:731, unchanged)
  h3 Do this first / Model tier / Not graded / Axis subscores  (prompt-coaching-view.js:696,735,757,859)
   h4 Do this next                                            (prompt-coaching-view.js:604)
```

Two rules this outline exists to satisfy:

- **The `h1` is the question.** It is the only `h1`, it is the loudest type on
  the page, and it is the sentence the workflow answers. The panel's `h2` names
  the *step*, not the question, so no two headings say the same thing.
- **Every level below `h2` is the level the shipped modules already render.**
  `prompt-coaching-view.js` and `coaching-specimen-view.js` hard-code `h3`/`h4`
  under an `h2`-owned workflow; putting the destination's workflow at `h2` keeps
  every rendered heading correct with **zero JavaScript change**. Do not
  re-level them for this destination — that churn lands in modules the dashboard
  panel shares.

`#prompt-coaching` keeps `aria-labelledby="prompt-coaching-question"`.
`#prompt-coaching-entry` keeps `aria-labelledby="prompt-coaching-entry-title"`.

---

## 5. DOM order, focus order, and keyboard

DOM order **is** focus order; nothing on this surface uses a positive
`tabindex`, and nothing is reordered visually away from its DOM position.

| # | Node | Tab stop | Notes |
| --- | --- | --- | --- |
| 1 | `a.skip-link` → `#main-content` | yes | `styles.css:23`, offscreen not hidden |
| 2 | header brand + 7 nav links | yes | shared markup |
| 3 | `h1#page-title` | no | |
| 4 | static value + boundary sentence | no | readable before any script |
| 5 | `#prompt-coaching-entry` blocks: value, benchmark | no | definition lists |
| 6 | `button#prompt-coaching-example` | yes | hidden unless `data-entry-state="empty"` (`prompt-coaching-entry-view.js:189–193`) |
| 7 | `p#prompt-coaching-entry-source` (`role="status"`) | no | permanent node, never replaced |
| 8 | `details.prompt-coaching-entry-boundary` summary | yes | native disclosure |
| 9 | `textarea#prompt-coaching-input` | yes | described by `#prompt-coaching-hint` |
| 10 | `select#prompt-coaching-model` | yes | |
| 11 | `button#prompt-coaching-grade` (submit) | yes | |
| 12 | `button#prompt-coaching-clear` | yes | |
| 13 | `p#prompt-coaching-live` (`role="status"`) | no | permanent |
| 14 | `section#prompt-coaching-change[tabindex="-1"]` | no (programmatic) | focus destination after a re-grade |
| 15 | `button#prompt-coaching-copy-button` | yes | only while `#prompt-coaching-copy` is unhidden |
| 16 | `textarea#prompt-coaching-copy-text` | yes | only while the fallback is unhidden |
| 17 | `#prompt-coaching-result` — answer, benchmark, action, then `button.coaching-result-toggle` / `.prompt-coaching-disclosure-toggle` | yes (toggles) | disclosure panels follow their own toggle in DOM |
| 18 | `details#prompt-coaching-preview` summary | yes | |
| 19 | site footer | yes | |

**The result never jumps the queue.** The answer is *below* the form in DOM
order, which is where a reader who just pressed a button looks. Focus is moved
only by the workflow's own existing rules, restated here so they are testable:

| Event | Focus lands on | Source |
| --- | --- | --- |
| Press "Grade the worked example" | `#prompt-coaching-input` (caret at the loaded sample) | `prompt-coaching-page.js:91` |
| Grade succeeds, no baseline yet | stays on the submit button; the live region announces | `prompt-coaching-view.js:467` |
| Re-grade produces a comparison | `#prompt-coaching-change` (`tabindex="-1"`, visible ring on plain `:focus` — `evolution.css:1526`) | `prompt-coaching-view.js:390` |
| Grade refuses | `#prompt-coaching-input`, marked `aria-invalid="true"` and re-described to the recovery text | `prompt-coaching-view.js:106–111` |
| Clear | `#prompt-coaching-input` | `prompt-coaching-page.js:134` |
| Copy falls back to manual | `#prompt-coaching-copy-text`, selected | `coaching-summary-view.js:118–125` |

Keyboard interactions, complete:

| Key | Where | Result |
| --- | --- | --- |
| `Tab` / `Shift+Tab` | everywhere | the order above; no trap, no focus stealing on load |
| `Enter` / `Space` | any `button` | activates; `Enter` in the textarea inserts a newline and does **not** submit (multi-line field, expected) |
| `Enter` | `select#prompt-coaching-model` | submits the form — acceptable, it is the same action the visible primary performs |
| `Enter` / `Space` | any `summary` | toggles the native disclosure; state exposed by the element itself, no custom ARIA |
| `Escape` | nowhere | this surface opens no modal, no popover, no overlay |
| `Ctrl/Cmd+C` | manual-copy fallback | copies the pre-selected summary text |

No custom key handlers. No shortcut that would collide with a screen reader's
browse mode.

---

## 6. Composition: which existing token does which job

No new hue, no new type size, no new spacing step. Every value below already
ships.

| Role | Token / rule | Source |
| --- | --- | --- |
| Page ground | `#f3f1eb` + the header radial | `styles.css:1,5` |
| Panel frame | `.finops-panel` — 1px `--panel-border`, 18px radius, 30px pad, `rgba(255,255,255,.68)` | `evolution.css:120` |
| Eyebrow / micro-label | `.eyebrow` — mono 700/11px, `.11em`, uppercase, `#65717d` | `styles.css:40` |
| `h1` | the hero step already used for a page question, `clamp(22px,3vw,30px)` family as `.proof-point-copy h2`; do not exceed the score numeral | `evolution.css:58` |
| The grade numeral | `.coaching-result-mark` / `.prompt-coaching-letter` — 52px, 750, `-.05em`, `--import-ink` | `evolution.css:1438,1673` |
| Benchmark block | `.prompt-coaching-benchmark` — `--import-wash` fill, 5px `--import-accent` left rule | `evolution.css:1433` |
| Provenance / versions | `.coaching-result-version`, `.prompt-coaching-rubric-version` — mono 11px `--ink-muted` | `evolution.css:1480,1717` |
| The one action | `.coaching-result-action` — 4px solid `--import-accent` left rule; dashed `--ink-muted` when unavailable | `evolution.css:1695–1696` |
| Movement between two grades | `.prompt-coaching-change-delta` — **filled wash** chip | `evolution.css:1536` |
| Static classification (source, tier, state) | `.panel-status-chip[data-silhouette="outline"]` | `evolution.css:729` |
| Caution | `--state-warn-*` | `evolution.css:24–26` |
| Rejected / out-of-range | `--state-error-*` + wavy underline | `evolution.css:27–29,1682` |
| Focus ring | `--focus-ring` `#155f9e`, 3px, offset 2–3px | `styles.css:1` |
| Control floor | `min-height:44px` | `evolution.css:1424,1576,1706` |
| Measure | `max-width:70ch` on every prose block | throughout the coach block |

**Chip silhouette rule, applied** (mirror `review-08-foundations.html:53` —
"filled wash = dynamic signal, outline = static classification"):

| Chip on this surface | Silhouette | Because |
| --- | --- | --- |
| Score movement (`+33 points`, `F → B`) | filled wash | a dynamic signal |
| Copy outcome while copying | filled wash | a live state |
| "Bundled example" / "Your text" source | outline | a static classification |
| Model tier ("premium") | outline | a static classification |
| Rubric / classifier version | no chip — mono caption | metadata, not a state |

**Blue's double duty** (mirror `review-08-foundations.html:29`): on the
dashboard, `--cat-inefficient:#2a78d6` is a chart series *and* blue is the
accent. This destination renders **no chart**, so blue is unambiguous here and
is reserved for exactly one job: the focus ring. Do not introduce a blue fill,
a blue chip, or a blue rule on this page.

---

## 7. Every state, drawn

Nine states. Each names its DOM signal, the cue that is **not** colour, what a
screen reader gets, and what happens at 390px. The `data-*` attributes below are
the ones the shipped modules already write; a state a test cannot name from the
DOM is not specified here.

### 7.0 Versioned destination contract

The destination is a composition adapter over bundled, client-side contracts;
it is not an integration with a provider, HRIS, identity system, billing export,
or customer record. Implement it against the following explicit envelope so a
markup change cannot silently turn missing or reordered support data into a
grade claim.

**Contract id:** `first-run-coach-destination/1.0.0`. The major version changes
when a required field, state meaning, or reading-order invariant changes; the
minor version changes for an optional field or additive state; the patch
version changes for wording that preserves those semantics. The destination
must expose this value as
`#prompt-coaching[data-destination-version="first-run-coach-destination/1.0.0"]`.

```text
DestinationEnvelope {
  version: "first-run-coach-destination/1.0.0",
  question: { id: non-empty string, text: non-empty string },
  source: {
    kind: "bundled_example" | "reader_text",
    fixtureVersion: semver contract id,
    rubricVersion: semver contract id,
    classifierVersion: semver contract id
  },
  result: null | {
    state: "graded" | "not_graded",
    score?: integer 0..100,
    grade?: "A" | "B" | "C" | "D" | "F",
    benchmarkText?: non-empty string,
    confidenceText: non-empty string,
    prioritizedAction?: { id: non-empty string, text: non-empty string },
    evidence: ordered array
  }
}
```

The adapter validates this envelope before painting a material result. It does
not coerce strings to numbers, infer a grade from a score, clamp a figure, fill
an absent action from a previous result, or treat array arrival order as
priority. `result.evidence` may be reordered by `id` into the canonical order
declared by the session contract because it is support content. The
`prioritizedAction` is singular and named, not selected as “the first” item in
an array.

| Input condition | Required destination behaviour |
| --- | --- |
| Complete and current | Paint question → grade/benchmark/confidence/provenance → one action → closed evidence. |
| Partial result: benchmark, confidence, provenance, or action missing | Paint `not_graded` with the missing field named; do not show a score or retain a stale visible result. The field remains editable. |
| Partial evidence | Keep the material result only when all material fields validate. Render the available evidence in canonical order and say “Some supporting evidence is unavailable” inside the disclosure. |
| Unknown major version | Refuse the envelope as unsupported. Show no score and announce “This bundled example needs a newer coach.” |
| Older compatible minor/patch version | Grade it, print the actual source versions beneath the figure, and never relabel it as current. |
| Malformed type, range, enum, or duplicate evidence id | Refuse the entire result. Name the invalid field in a generic diagnostic; never echo reader text or serialize the rejected envelope. |
| Reordered evidence | Normalize by stable evidence id. Reading order of the question, material result, action, and disclosure never follows input order. |
| Duplicate or multiple prioritized actions | Refuse the result; the destination must not guess which action is primary. |

Fixtures are local and credential-free. The implementation adds
`tests/fixtures/first-run-coach-destination-v1.json` with these labelled cases:
`complete`, `partial-evidence`, `missing-material-action`,
`stale-compatible-version`, `unknown-major-version`, `malformed-score`,
`reordered-evidence`, and `multiple-actions`. The `complete` case references
the pinned `first-run-example` figures rather than copying a second independent
set of numbers. A fixture test validates every case twice and asserts identical
DOM state, text order, and announcement; no test is allowed network or storage
access. This destination contract supplements, and never changes,
`first-run-coach-fixtures/1.0.0`, `literacy-mix/1.0.0`, or
`prompt-prose-classifier/1.0.0`.

### 7.1 Sample loading (pre-hydration, and the module that never arrives)

The bundled sample is a frozen constant, so "loading" is not a fetch — it is the
window before `prompt-coaching-page.js` runs, plus the failure mode where it
never runs at all.

| | |
| --- | --- |
| DOM | `#prompt-coaching[data-state="idle"]`, `#prompt-coaching-entry[data-entry-state="empty"]`, entry body holds its static lead paragraph (`evolution.html:679`) |
| Reads | The `h1` question, the static value + boundary sentence, the labelled field, and the hint — all before any script |
| Non-colour cue | The entry lead sentence says the blocks "are rendered here … when the page's scripts load". No spinner: nothing is being waited on that a reader can influence |
| Screen reader | Nothing announced. This is initial page content, not a change |
| Live region | `#prompt-coaching-live` is empty; an empty status region announces nothing |
| Mobile | Single column; nothing collapses because nothing is painted yet |

**Required for this state (new):** the form must not be able to submit the
prompt anywhere. See §10 — this is currently a real boundary defect.

Progressive-enhancement floor: if the module never loads, the reader still gets
the question, the boundary sentence, the field, and the hint. The primary
control must not *appear* to work and then do nothing observable — see §10 for
the exact requirement.

### 7.2 Sample ready

Reached by pressing **Grade the worked example** (`prompt-coaching-page.js:84`).

| | |
| --- | --- |
| DOM | `#prompt-coaching-entry[data-entry-state="example_loaded"][data-next-action="grade_example"]` |
| Visible | Sample text now in the textarea; the model select set to the tier the sample names; instruction rewritten to "The worked example is in the field. Press Grade this prompt to see what a result contains."; alternative line offers replacing it |
| Non-colour cue | The example control is **removed from the tab order** (`hidden`) — "offering to overwrite text a visitor already typed is not an offer" (`prompt-coaching-entry-view.js:191`). The instruction sentence is the state, in words |
| Screen reader | Focus moves into the textarea, which announces its label and value. The instruction is `aria-describedby` on the (now hidden) control; the rewritten sentence is read on next traversal |
| Live region | Silent. Filling a field the reader just asked to fill is not news |
| Mobile | The full-width example button (see §11-B) collapses out; the textarea keeps its 11rem min-height |

### 7.3 Grading in progress

The shipped path grades synchronously and never paints this
(`prompt-coaching-view.js:400–401`). Specify it anyway, because a first-run
destination is exactly where a slow device makes the gap visible.

| | |
| --- | --- |
| DOM | `#prompt-coaching-change[data-status="pending"]`, scores `dd[data-pending="true"]` |
| Visible | Dashed left rail (`evolution.css:1527`), the two score slots present but rendered in muted regular weight (`evolution.css:1535`) |
| Non-colour cue | Dashed vs solid rail; the words "Grading the revision. Nothing has been sent anywhere." |
| Screen reader | `#prompt-coaching-live` announces exactly that sentence (`prompt-coaching-view.js:189`) |
| Rule | **Never a full-width placeholder card.** Mirror finding 10 (`review-00-summary.html:29`): "verdict placeholder is a large empty banner … holds a full-width card hostage". The pending state occupies the region that will hold the answer, at the size it will hold it, and the previous grade stays readable underneath |
| Motion | The `.state-spinner` primitive is not used here. If one is ever added it must honour `prefers-reduced-motion` as `state-ui.css:14` already does |
| Mobile | Same, one column |

### 7.4 Grade complete (the material sample grade)

The state this destination exists to reach. Figures are the pinned first-run
ones (`docs/first-run-coach-fixtures.md`), which is what makes this state
screenshot-stable.

| | |
| --- | --- |
| DOM | `#prompt-coaching[data-state="graded"][data-grade="F"]`, `#prompt-coaching-result` unhidden |
| Reading order inside the result | answer sentence → grade numeral + benchmark → **one** action → disclosure toggle | 
| The figure | `56 / 100`, grade `F`, and the distance line — 4 points from D. The letter is 52px; the "/ 100" and the band distance are mono beside it, never inferred from the glyph |
| Confidence, stated three ways | (a) source: "graded from the supplied example — a demonstration, not a reading of your work" (`prompt-coaching-entry-view.js:205–219`); (b) abstention: with no tier selected the routing recommendation abstains out loud rather than assuming one (`prompt-coaching.js:797`); (c) **no population claim** — this surface must never render a percentile, a cohort, or "better than N%" (`docs/first-run-coach-fixtures.md`, "what this deliberately leaves out") |
| Provenance | `rubric literacy-mix/1.0.0 · classifier prompt-prose-classifier/1.0.0 · model tier premium`, mono `--ink-muted`, always beneath the figure it qualifies |
| Non-colour cue | The grade letter is a glyph; the answer sentence leads with a shape (`.coaching-result-shape`, `aria-hidden`); the status label prints the state as a word |
| Screen reader | `#prompt-coaching-live` announces `<answer>` and, when compared, the change announcement first (`prompt-coaching-view.js:467`). The 52px letter is decorative to AT (`aria-hidden`, `prompt-coaching-view.js:673`) because the score line carries it in words |
| Evidence | Everything else — axis subscores, per-turn reading, runners-up, assumptions — sits behind `button.coaching-result-toggle` with `aria-expanded`/`aria-controls`, closed on every new result (`prompt-coaching-view.js:384–387`) |
| Mobile | Numeral drops to 40px (`evolution.css:1754,1756`); fact lists collapse to one column; toggle goes full width |

### 7.5 Replacing the sample

| | |
| --- | --- |
| Trigger | One keystroke in the field (`prompt-coaching-page.js:96`) or **Clear** (`:126`) |
| DOM | `data-entry-state="visitor_text"` / back to `"empty"`; `data-graded-source` deleted on clear |
| Visible | The source attribution line empties and hides; the instruction becomes "Your text is in the field…"; on clear, the example control returns and the result region empties |
| Non-colour cue | The attribution line's tinted left rule **disappears** — presence/absence, not hue, is the signal that the on-screen grade is no longer the example's |
| Screen reader | `#prompt-coaching-entry-source` is a permanent `role="status"` node that is written into, never replaced, so the change is announced (`prompt-coaching-entry-view.js:105`) |
| Rule | A grade produced from the bundled sample must never survive on screen next to a claim that it is the reader's work. Clearing removes the result; editing re-labels the next one |
| Mobile | Unchanged |

### 7.6 Copying a privacy-safe summary

| | |
| --- | --- |
| DOM | `#prompt-coaching-copy[data-reason="compared"]` unhidden; status `data-outcome` ∈ `pending` \| `copied` \| `manual` |
| Idle | "Nothing has been copied yet." (`coaching-summary-view.js:35`) |
| In flight | Button `disabled`, `cursor:progress`, status "Copying…" |
| Success | Status text says so, `data-outcome="copied"` |
| Failure | `data-outcome="manual"`, the fallback textarea unhides, focus moves into it and selects (`coaching-summary-view.js:118–125`) |
| Non-colour cue | Every outcome is a different **sentence**; the manual outcome additionally gains a 1px `--state-warn-line` border. Tint is the third cue |
| Screen reader | `role="status" aria-live="polite" aria-atomic="true"` on `#prompt-coaching-copy-status` — a permanent node (`evolution.html:734`) |
| Privacy | The copied text is nine labelled lines of figures plus static rubric copy, ending in the boundary sentence, and contains no submitted prompt text — asserted window-by-window in `tests/first-run-coach-fixtures.test.js` |
| Mobile | The button must go full width (§11-B); the fallback textarea is already `justify-self:stretch` |

### 7.7 Empty and error

Three refusal outcomes, from `COACHING_OUTCOME_STATES`
(`prompt-coaching-contract.js:111–142`). All three share one presentation:

| Outcome | What it says | Cue |
| --- | --- | --- |
| `empty` | "Nothing to grade" — the box was empty or whitespace | dashed `--state-warn-line` rail, `h3` "Not graded", field `aria-invalid="true"` |
| `invalid_input` | "Not accepted" — a stated ceiling was passed; the ceiling is named as a **count**, never an echo of the text | same, plus the ceiling figure |
| `unsupported_content` | "Nothing the rubric can read" — accepted, but every turn was code or carried-in material | same, plus per-turn reason codes behind the disclosure |

Shared rules:

- Focus moves to the field, which is marked `aria-invalid="true"` and
  re-described to `#prompt-coaching-hint` **and** the recovery text
  (`prompt-coaching-view.js:106–107`), so the reason is in the accessible
  description rather than only on screen.
- The live region announces `Not graded. <title> <guidance>`
  (`prompt-coaching-view.js:445`).
- A refusal is **not** a baseline: it replaces the visible result with recovery
  guidance, while the previous valid session remains only in the page entry's
  private `baseline` variable so the next successful grade still compares
  (`prompt-coaching-page.js:123`, `prompt-coaching-view.js:381–403`). No prior
  score remains visible beside the refusal.
- Non-colour: dashed rail vs solid, the words "Not graded", and the invalid
  field's 2px border (`evolution.css:1411`).
- A refusal must never be styled as an error *page*; it replaces nothing above
  it.

### 7.8 Implausible extremes

| | |
| --- | --- |
| DOM | `[data-implausible="true"]` on the change region, the delta chip, and any out-of-range `dd` |
| Visible | `--state-error-*` wash **and** a wavy underline on the figure itself (`evolution.css:1682`) — "the underline survives a grayscale print, a colour-blind reader, and a screenshot pasted into a ticket" |
| Also drawn | notices list (`.prompt-coaching-change-notices`, dashed 1px error border, label + guidance) naming each figure that fell outside its range |
| Screen reader | The notices list is `aria-label="Figures outside their range"` (`prompt-coaching-view.js:583`); the announcement leads with the notice count |
| Extremes this destination must survive without layout damage | a 100-point swing (`F → A`); a 0 or 100 composite; a delta of `0` on an unchanged re-grade; a paste at the character ceiling; a transcript at the turn ceiling; a single word; a prompt with no whitespace at all (every prose block sets `overflow-wrap:anywhere`) |
| Rule | An out-of-range figure is **shown**, labelled, and refused as evidence — never silently clamped on screen. The clamp that the rubric applies internally is disclosed in the arithmetic (`docs/first-run-coach-fixtures.md`, `sum: 112` beside `score: 100`) |
| Mobile | The delta chip is `width:fit-content; max-width:100%` and wraps its band line to a full row (`evolution.css:1538,1550`) |

### 7.9 Cleared / returned to first run

Pressing **Clear** restores exactly the §7.1 reading with the field empty, the
example offered again, the baseline dropped, and the live region silenced
(`prompt-coaching-page.js:126–135`, `prompt-coaching-view.js:409–428`). A
first-run destination that cannot be put back to its first run is not one.

---

## 8. Responsive behaviour

Two breakpoints, both already in `evolution.css`: 900px (`:981`, the page-level
grids) and 640px (`:992` panel padding, `:1746` the coach block). This
destination introduces neither a third breakpoint nor a new query.

| Width | Behaviour |
| --- | --- |
| > 900px | One column of prose at `70ch` inside a `.finops-panel`. **No second column.** There is nothing on this destination to put beside the answer, and a sidebar would compete with the one action |
| 640–900px | Measure unchanged; below 640px the panel drops to 21px padding (`:1020`) |
| ≤ 640px | Every definition grid collapses to one column; the grade numeral drops to 40px; all primary controls go full width; the delta chip wraps |
| 390px reference | The mobile review's device. Mirror finding 01 (`review-00-summary.html:20`) is a fixed multi-column grid with no responsive rule — §11-A lists the two grids on this workflow that still have that defect |
| Touch targets | 44px minimum on every control, already enforced |
| Zoom | 400% zoom / 320px CSS width must not produce horizontal scrolling: the measure is `ch`-based, every long token wraps via `overflow-wrap:anywhere`, and the only fixed-size element is the numeral |

---

## 9. Contrast and focus expectations

Stated as numbers so they are testable, not asserted by eye. Method: WCAG 2.x
relative luminance, sRGB, against the *effective* background (the panel is
`rgba(255,255,255,.68)` over `#f3f1eb` ≈ `#fbfaf7`).

| Pair | Ratio | Floor |
| --- | --- | --- |
| `--import-ink` `#244c3c` on `#fff` | 9.7 : 1 | 4.5 |
| `--ink-muted` `#6f6f69` on `#fff` | 5.05 : 1 | 4.5 |
| `--ink-muted` `#6f6f69` on the panel `#fbfaf7` | 4.84 : 1 | 4.5 — this is the tightest pair on the surface and it governs the 11px mono metadata |
| `--state-warn-ink` `#614a12` on `--state-warn-wash` `#fffaf0` | 8.1 : 1 | 4.5 |
| `--state-error-ink` `#6f2821` on `--state-error-wash` `#fdf4f3` | 9.7 : 1 | 4.5 |
| `--focus-ring` `#155f9e` on the panel `#fbfaf7` | 6.4 : 1 | 3.0 (non-text) |
| `--import-accent` `#315f50` on `#fff` | 7.3 : 1 | 3.0 (non-text) |

Focus expectations:

- Every interactive element shows a 3px ring at 2–3px offset. No `outline:none`
  without a replacement.
- The ring is never the *only* indication of the current control on a surface
  where a control also changes label ("Show/Hide …", `coaching-result-view.js:233`).
- `#prompt-coaching-change` draws its ring on plain `:focus` as well as
  `:focus-visible`, because focus arrives there programmatically after a
  mouse-driven re-grade (`evolution.css:1526`).
- Reduced motion: `html { scroll-behavior:smooth }` (`styles.css:4`) is already
  reverted under `prefers-reduced-motion`, so the scroll that follows a
  programmatic focus is instant for a reader who asked for less motion. This
  destination adds no other motion.

---

## 10. The privacy boundary — and one defect that breaks it

What must stay true, and stay stated in **static markup** (a privacy claim that
appears only after a script succeeds is a claim a visitor cannot rely on):

1. Coaching is computed in this browser from bundled static client-side code.
2. No request is sent for coaching; no persistence is implemented.
3. No live model provider, HRIS, enterprise/billing system, credential, or
   customer record is contacted or read (`prompt-coaching-entry.js:339–376`,
   each claim paired with how to check it).
4. The copyable summary carries figures and rubric wording only, never prompt
   text.
5. The previous grade is a text-free envelope held in a closure for the life of
   the tab and nowhere else (`prompt-coaching-page.js:63–67`).

The destination inherits all five and adds no new capability: it loads strictly
fewer modules than the dashboard panel does.

### Defect: the no-JavaScript fallback puts the prompt in the URL

`#prompt-coaching-form` has no `action` and no `method`
(`src/evolution.html:689`), and its controls carry `name="prompt"` and
`name="modelTier"` (`:695`, `:700`). A form with no `action` submits **GET to
the current document URL**. So if `prompt-coaching-page.js` does not run — a
parse error, a blocked module, a stale cache, a CSP change — pressing "Grade
this prompt" navigates to
`/evolution.html?prompt=<the entire pasted prompt>&modelTier=premium`.

The pasted text then exists in the address bar, in browser history, and in the
`Referer` any subsequent navigation sends. The entry module's own header states
the opposite — "the form does nothing — it never had an action to fall back to"
(`src/prompt-coaching-page.js:10–12`) — so this is an untested assumption rather
than a decision.

**Recommendation (product change, one line each, no product-visible effect):**

- On `coach.html`, ship the textarea and select **without `name` attributes**.
  Nothing serializes, so a fallback submit carries no data.
- Make the same removal on `src/evolution.html:695,700`. Verified safe: no
  module reads either control by name — both are read by id
  (`prompt-coaching-page.js:51–52`) — and the only `getAttribute("name")`
  assertion in the suite is `tests/release-form.test.js:158`, an unrelated form.
- Optionally also set `action=""`+`onsubmit` — **do not**; the `name` removal is
  the version with no script and no navigation semantics to get wrong.

This is a boundary fix, not a workflow change: with JavaScript working, nothing
about the grade, the result, or the dashboard changes.

---

## 11. Conflicts with the design mirror, and the product CSS updates they imply

The mirror is not edited. Each item below is a change to **product CSS or
product markup**.

### A. Two grids still fail the mobile finding the review filed first

Mirror finding 01 (`review-00-summary.html:20`): a fixed multi-column grid with
no responsive rule collapses its own track at 390px. The coach block's 640px
rule (`evolution.css:1746–1763`) collapses `.coaching-result-facts`,
`.coaching-result-assumptions`, `.prompt-coaching-entry-block dl`,
`.prompt-coaching-preview-measures`, `.prompt-coaching-preview-fields`, and
`.prompt-coaching-axes` — but **not**:

- `.prompt-coaching-change-scores` (`evolution.css:1532`) —
  `grid-template-columns:minmax(0,auto) auto` with a 15px mono figure in the
  second column. This is the "previous 56 / revised 89" pair, i.e. the most
  important two lines of a re-grade, at the width where it breaks.
- `.prompt-coaching-change-notices li` (`:1552`) — `auto minmax(0,1fr)` with a
  label that can be a long signal id.

**Recommended addition to the existing `@media (max-width:640px)` block:**

```
.prompt-coaching-change-scores { grid-template-columns:minmax(0,1fr); gap:2px; }
.prompt-coaching-change-scores dd { margin-bottom:6px; }
.prompt-coaching-change-notices li { grid-template-columns:minmax(0,1fr); }
.prompt-coaching-change-notice-guidance { grid-column:1; }
```

### B. Two primary controls are not full width at 390px

`evolution.css:1757` widens `.prompt-coaching-actions button`,
`.prompt-coaching-disclosure-toggle`, and `.prompt-coaching-entry-example`, but
not `#prompt-coaching-copy-button`. Add it to the same selector list. (The
`.coaching-result-toggle` is already handled at `:1755`.)

### C. Two blocks on one screen both say "Do this first"

After a grade the reader sees the front door's `h4` "Do this first"
(`prompt-coaching-entry-view.js:110`) and the result's `h3` "Do this first"
(`prompt-coaching-view.js:696`) at once. Exactly one prioritized next action is
the whole point of this destination.

**Recommendation:** rename the *front door's* heading to **"Your first move"**
(`prompt-coaching-entry-view.js:110`). The result's wording is the one under
contract — `tests/prompt-coaching-flow.test.js:135` asserts the live region
matches `/Do this first:/`, and that string comes from the result view. No test
asserts the entry heading text. The dashboard panel inherits the rename, which
is an improvement there too and changes no workflow.

### D. Two focus-ring colours on one surface

`--focus-ring` `#155f9e` (`styles.css:1`) is the site ring, but the coach block
overrides it with `--import-accent` `#315f50` on the textarea, select, action
buttons, disclosure toggle, copy button, and preview summary
(`evolution.css:1417–1420, 1580, 1603, 1614, 1710`) — while the entry boundary
summary uses `--focus-ring` (`:1511`). Both clear 3:1, so this is consistency,
not contrast: a reader tabbing this destination sees the ring change colour
mid-sequence.

**Recommendation:** on the coach surface use `--focus-ring` for every ring and
keep `--import-accent` for structural rails and fills. Implement by replacing
`outline:3px solid var(--import-accent)` with `var(--focus-ring)` in the
selectors above. This is a scoped, product-visible improvement; if the owner
prefers the green ring, invert it and make `:1511` match instead — but pick one.

### E. Status voice contradicts the mirror's type roles (accepted deviation)

Mirror `review-08-foundations.html:39–41` gives statuses a **lowercase mono
ink-3** voice and says "the lowercase-mono voice is the brand; keep it". The
product renders status micro-labels as **uppercase** mono with `.06em` tracking
(`.coaching-result-status-label`, `.coaching-result-recommendation-label`,
`.eyebrow`, `.panel-status` labels, `state-ui.css:6`).

This is a system-wide voice on labs surfaces, not a coach-local slip. Changing
it here alone would make the destination the odd page out. **Recommendation:
keep the product's uppercase micro-label on this destination, and record the
deviation here rather than silently diverging.** If the owner wants the mirror's
lowercase voice, it is one sweep across `.eyebrow` and the `*-label` rules and
belongs in its own issue.

### F. Button voice (mirror's other type note)

Same card: "pick one button voice." The coach's buttons are Title-Case
sentences ("Grade this prompt", "Copy this coaching summary", "Grade the
supplied example"). They are consistent with each other and with the rest of
labs. Keep them; do not mix in a mono lowercase control on this destination.

---

## 12. Acceptance scenarios

For Mina. Written so each one fails loudly if the reading order regresses.

**A1 — arrival, nothing typed.** Given a first visit to `/coach.html` with
JavaScript enabled, the reader sees, in DOM order: the question as the only
`h1`; what they get; what it is measured against; one control offering the
supplied example; and the privacy boundary as a collapsed disclosure. No score
is claimed, and `#prompt-coaching[data-state="idle"]`.

**A2 — zero-input grade.** When the reader presses "Grade the worked example"
and then "Grade this prompt", the result shows `56 / 100`, grade `F`, the
distance to the next band, and the rubric + classifier + tier provenance line;
the source attribution says the grade is a demonstration, not a reading of their
work; and `#prompt-coaching[data-state="graded"]`.

**A3 — exactly one action.** In the graded state, exactly one block on the page
is presented as the prioritized next action; the entry block does not also
present one (§11-C).

**A4 — evidence is disclosed, not displayed.** After a grade, axis subscores,
per-turn reading, and runners-up are all inside a panel whose toggle is
`aria-expanded="false"`; opening it keeps focus on the toggle.

**A5 — replace the sample.** One keystroke in the field clears the "bundled
example" attribution; the next grade is classified as reader text; **Clear**
returns the surface to A1 exactly, including the example being offered again.

**A6 — re-grade.** A second grade after an edit renders the change region with
both scores, a filled delta chip carrying a direction word and a value, the band
movement in words, and focus lands on that region.

**A7 — copy.** With a comparison on screen, the copy control is visible; a
successful copy says so; a failed copy unhides the fallback, focuses and selects
it; the copied text contains no substring of either graded prompt and ends with
the boundary sentence.

**A8 — refusal.** Grading an empty field, an over-ceiling paste, and a
code-only paste each produce a named reason, recovery guidance, an
`aria-invalid` field described by that guidance, and no score anywhere on the
page. The previously graded result, if any, is not left standing beside the
refusal as if it were the answer; it remains only as the private comparison
baseline for the next successful grade.

**A9 — no-JS floor.** With scripts blocked, the page still states the question,
the value, and the privacy boundary; and submitting the form transmits no field
value anywhere, including into the URL (§10).

**A10 — the dashboard is unchanged.** `/evolution.html` renders the same coach
panel, in the same place, with the same behaviour, plus exactly one new link to
`/coach.html`.

---

## 13. Regression checks

For Tess. Each maps to an existing suite so nothing needs a new harness.

| # | Check | Home |
| --- | --- | --- |
| R1 | `coach.html` appears in `tests/site-nav.test.js` PAGES with `current: "/evolution.html"`, title `Prompt coach · Shiplog`, and its nav markup matches `siteNavMarkup("/evolution.html")` byte for byte | `tests/site-nav.test.js` |
| R2 | `SITE_NAV` is unchanged by this issue (label set and order identical) | `tests/site-nav.test.js` |
| R3 | `coach.html` is in the `required` set in `scripts/verify-build.mjs` alongside the coaching modules, so a half-published artifact fails before Pages | `tests/build.test.js` |
| R4 | Heading outline of `coach.html`: exactly one `h1`; no level is skipped; no two headings share text | new test in `tests/prompt-coaching-flow.test.js` |
| R5 | Landmarks: one `main#main-content[tabindex="-1"]`, a skip link whose target it is, one `nav[aria-label="Wawalu Labs"]` | same |
| R6 | Every required element id the modules bind to is present on `coach.html`; the specimen (`coaching-specimen-body`) may be absent and the page must still initialise without throwing | same |
| R7 | Static-before-script: the boundary sentence and the question are in the served HTML, not injected | mirrors `tests/prompt-coaching-flow.test.js:366` |
| R8 | Neither the textarea nor the select carries a `name`, on `coach.html` **and** `evolution.html` | new assertion, `tests/prompt-coaching-flow.test.js` |
| R9 | First-run figures on the destination equal the pinned fixtures (`56`, `F`, first move `intent-states-acceptance`) | `tests/first-run-coach-fixtures.test.js` (already asserts the shipped `buildSampleCoachingSession` path) |
| R10 | Each of the nine states in §7 is reachable in jsdom and exposes its `data-*` signal; each refusal marks the field and announces | `tests/prompt-coaching-flow.test.js`, `tests/prompt-coaching-revision-flow.test.js` |
| R11 | Focus order equals DOM order; focus destinations after grade / re-grade / refuse / clear / manual-copy are the five named in §5 | `tests/prompt-coaching-revision-flow.test.js` |
| R12 | Live regions are permanent nodes: `#prompt-coaching-live`, `#prompt-coaching-copy-status`, `#prompt-coaching-entry-source` are written into, never replaced, across two consecutive grades | `tests/coaching-summary-flow.test.js` |
| R13 | No status is carried by colour alone: for every `data-status` / `data-outcome` / `data-direction` / `data-implausible` value, the rendered text differs too | `tests/graded-legibility.test.js` |
| R14 | Contrast: the seven pairs in §9 are computed from the stylesheet and asserted against their floors | `tests/graded-legibility.test.js` |
| R15 | At 640px the four grids in §11-A collapse to one column (assert the media-block text contains each selector) | `tests/graded-legibility.test.js` |
| R16 | The copied summary contains no 24-character window of either graded prompt and ends with the boundary sentence | `tests/first-run-coach-fixtures.test.js` (already) |
| R17 | The destination loads no analysis module: `coach.html` references neither `evolution-page.js` nor any import/workspace entry | `tests/build.test.js` |
| R18 | `evolution.html` diff is limited to one added link and the two `name` removals; the panel's ids, order, and headings are unchanged | `tests/prompt-coaching-flow.test.js` (existing assertions must pass untouched) |
| R19 | Every `first-run-coach-destination/1.0.0` fixture produces its declared graded/refused state; reordered evidence is canonicalized, incomplete evidence is labelled, and partial/malformed/unknown-major inputs expose no score | new fixture test in `tests/prompt-coach-destination-contract.test.js` |

---

## 14. Deliberately out of scope

- **Any change to the grading engine, rubric, or session contract.** Figures
  come from `literacy-mix/1.0.0` and are pinned; this is a reading-order and
  destination change only.
- **Prefilling the field with the example on load.** The fixtures document
  flags it as an open product decision; the one-press control is the version
  that keeps "this is our example" honest.
- **A percentile, cohort, or pass/fail threshold on 56.** No population exists
  behind it.
- **Dark mode.** The mirror carries a dark palette; the labs product ships
  `color-scheme:light` only (`styles.css:1`). Adding one is its own issue.
- **Promoting the coach to a top-level nav peer.** One line when the owner wants
  it; not this issue.
- **The uppercase-vs-lowercase status voice sweep** (§11-E).
