# Residue resolution, from a keyboard and a screen reader

Issue #769 asks for the accessibility layer over Mina's residue cluster review
control on `/evolution.html`: keyboard operability of the cluster controls,
announcement coalescing across rapid assignments, and a lead-assisted grade told
apart from an unassisted one at a glance.

**That control has not landed.** This file records what was searched for, what
is on the page instead, the one slice of #769 that survives the missing
dependency (and ships with it), and the specification the control has to meet
when issue #768 arrives — so the next attempt is an implementation, not a second
round of archaeology.

## 1. What was searched, and what was found

Searched on `main` at `65e02b4`:

| Looked for | Where | Found |
| --- | --- | --- |
| The page and its modules | `src/evolution.html` (2349 lines), `src/evolution.js`, `src/evolution-page.js`, `src/evolution.css` | All four ship; the coaching region is `#org-coaching` (`evolution.html:1945`) |
| Residue / cluster / unclassified rendering | `residue`, `cluster`, `unclassified`, `classify`, `coverage` across `src/` | `src/corpus-family-coverage.js` ranks clusters; `src/org-query-decision.js:443` (`residueRows`) turns them into `dt`/`dd` rows; `src/org-query-decision-view.js` paints them; wired at `src/evolution-page.js:2043` |
| A control that assigns a class to a cluster | `assign`, `classify`, `data-cluster`, `clusterAssign`, `lead-supplied`, `<select` in `evolution.html` and every module it loads | **Nothing.** The six `<select>`s on the page are the source chooser, the dialect chooser, the comparability sample, the mapping kind, and the two portfolio filters. No button, menu, or listbox writes a class onto a cluster |
| A recompute path after an assignment | `familyCoverage(...)` callers | One caller, `paintCoachingDecision` (`evolution-page.js:2032`), and it recomputes from imported records only — there is no lead-supplied label in its input |
| The issue-#768 work itself | `git log --oneline --all`, `git branch -a` | No commit and no branch for #768. Mina's most recent landed work is #763 (the drawn empty state) |
| The live regions | `aria-live`, `role="status"`, `role="alert"` | The page ships many status regions, but the *answer* announcement discipline is `src/finops-answer-announcement.js`: one announcer (`#finops-stand-live`) with the echoing regions silenced via `ECHOED_LIVE_REGION_IDS`. The coaching region keeps its own announcer, `#org-coaching-live`, and is deliberately **not** on the echo list — it answers a different question |
| The grade / withheld rendering | `grade`, `withheld` | `gradedLead` / `ungradeableLead` (`org-query-decision-view.js:144`, `:170`), told apart by `data-grade-status="graded" \| "ungradeable"`, a glyph (`▲` / `◇`) and a border style (`evolution.css:2770`) — never by colour alone. A letter withheld for coverage carries the tier table's own words (`coverageWithheld`, `org-query-decision.js:204`) |

So residue clusters are **read-only detail today**: ranked, deterministic, and
printed inside the sampling-limits disclosure. There is no loop to complete from
a keyboard because there is no assignment to make.

## 2. What #769 cannot have until #768 lands

- **A. Keyboard operability of the cluster controls** — there are no controls.
- **B. Coalescing across rapid assignments** — there are no assignments.
- **C. Lead-assisted vs unassisted grade** — every grade on this surface is
  unassisted, so the distinction would mark a state the product cannot enter.

Faking any of these means shipping a control the review has not seen, on a
surface whose ranking rules another persona owns. It is not done here.

## 3. What ships in this change instead

One slice of #769 survives the missing dependency: **hearing the grade.**

The visible block prints, in order, the answer, the letter, the coverage the
letter rests on, and the one action. The announcement printed the answer, the
letter and the action — and dropped the coverage. So the coverage figure
disappeared from the spoken answer at exactly the moment the letter appeared:
a withheld letter is announced *as* its coverage figure (`coverageWithheld`),
and the graded sentence that replaced it said nothing about coverage at all.

`graded()` in `src/org-query-decision.js` now speaks `coverage.text` verbatim —
the same string `coverageBlock` paints under the letter — between the grade and
the action, so the sentence is read in the block's own order. A sample with no
coverage result gains no qualifier it cannot support. This is criterion B3's
"grade letter + coverage figure" half; the "lead-supplied labels contributed"
clause is specified in §4 and lands with #768.

## 4. The specification #768's control has to meet

Written now, against code that exists, so it can be executed rather than
re-derived.

**Tab order.** The cluster controls belong in the coverage block
(`coverageBlock`, `org-query-decision-view.js:223`), between the letter and the
action block — the DOM order the reader already reads them in. Painting them
into the sampling-limits disclosure instead would put the loop behind a closed
panel and put the action *before* the controls that change it. No positive
`tabindex`: the four disclosure toggles already prove the pattern
(`org-query-decision-view.test.js`, "the four toggles are keyboard-reachable in
the painted order").

**The stable id to key on.** `cluster.key` — not the array index, and not
`Residue N`, which *is* the index. `residueClusterKey` derives the key from the
record's own normalized fields (`corpus-family-coverage.js:118`), unkeyed
records collapse into the `RESIDUE_UNKEYED` sentinel rather than being dropped,
and `tests/corpus-family-coverage.test.js:109` ("cluster keys and their order
survive a shuffled input array") already guards it. A control's id should be
derived from the key, and the visible `Residue N ·` prefix must stay a label,
never an identifier.

**Focus restoration.** The precedent is on this surface already: a toggle sets
`section.dataset.focusTarget` before the repaint (`:286`) and `paint` restores
focus from it after `replaceChildren` (`:131`). Assignment does the same with
the cluster's key-derived id. When the cluster is gone after recompute —
resolving it is the point — restore in this documented order: the next cluster
in ranked order, then the previous one, then the cluster-list container with
`tabindex="-1"`. Never `<body>`: focus on `<body>` after a successful assignment
reads as "the page reloaded and I lost my place".

**Coalescing.** This page has no timer debounce to match; its stated rule is
"one announcement per commit … one region, one message, one per event"
(`evolution-page.js:764`). Assignment is a commit, so N rapid assignments must
recompute N times and announce **once**, when the burst settles. If a timer is
needed rather than an explicit commit, use 400 ms and say why in the code: below
that, two deliberate selections read as one edit and the reader loses the
confirmation of the first; above it, the settled summary arrives after the
reader has moved on.

**The one region.** `#org-coaching-live` (`ORG_COACHING_LIVE_ID`), which the
view already writes through and dedupes against. Do not add `aria-live`,
`role="status"` or `role="alert"` to the cluster list, the grade block, or the
coverage block — a test in `org-query-decision-view.test.js` now asserts the
coaching section carries exactly one announcer.

**The withheld-to-letter sentence**, once lead labels exist:

> Your imported query sample was read. {department} needs coaching first, grade
> {letter}, {confidence}. {coverage.text}. Lead-supplied labels contributed to
> this coverage. Prioritized action: {action}.

One clause added after the coverage sentence, composed in `graded()` from a flag
on the coverage slot — not a second announcement, and not a separate coverage
utterance beside it.

**The non-colour attribute.** `data-grade-assist="lead-assisted" | "unassisted"`
on `.org-coaching-lead`, beside the `data-grade-status` the block already
carries, plus a chip whose text says `lead-assisted`. Tests assert the attribute
and the chip text; no test reads a colour.

## 5. Design-system citations, with measured contrast

From `design-system/claude-design/review-08-foundations.html`:

- **Chip rules** — "filled wash = dynamic signal, outline = static
  classification". How a grade was produced is a standing classification, not a
  live signal, so the assisted marker is an **outline** chip, never a wash.
  The same card warns to "reserve green fills/outlines for live-good states":
  this panel's accent `--import-accent:#315f50` is green, so the assisted chip
  takes the neutral ink `--ink-muted:#6f6f69` (**5.06:1** on the panel's white,
  clearing both the 4.5:1 text floor and the 3:1 non-text floor for its border).
  `--import-line:#9eb9aa` is **2.11:1** on white and must not draw a chip edge —
  `evolution.css:2792` already says so for the disclosure toggle.
- **Type-scale roles** — "stat numerals" and "card titles" are distinct roles.
  The grade letter is the stat (`.org-coaching-letter`, 56px/750, `aria-hidden`
  because `.org-coaching-benchmark` repeats it in words) and the assisted marker
  is metadata — the card's "metadata · timestamps · statuses — mono ink-3" role,
  which `.org-coaching-disclosure-chip` already ships as `650 12px/1.4
  ui-monospace` in `--ink-muted`. The marker adds no size to the scale.
- **Palette semantics** — the card flags blue's double duty as input-series and
  selection. The site focus token `--focus-ring:#155f9e` is that blue and is
  reserved for focus alone here: **5.88:1** against the page `#f3f1eb`,
  **6.64:1** against the panel white. The coaching disclosure toggles instead
  draw their ring in `--import-accent:#315f50` (**7.28:1** on white, **6.62:1**
  on `--import-wash #eef6f2`); both clear WCAG 1.4.11's 3:1 non-text floor, so a
  cluster control should inherit the panel's existing ring rather than add a
  third. That two rings coexist on one page is a real inconsistency, recorded
  here for the design system rather than resolved inside an accessibility
  change that owns neither surface.

Ratios computed with the sRGB relative-luminance formula, the same one
`tests/graded-legibility.test.js` measures with; no figure here is quoted from
memory.

## 6. Status

Blocked on #768 for criteria A, B (coalescing) and C. The grade-and-coverage
announcement in §3 ships now and is tested in
`tests/corpus-family-coverage.test.js` and `tests/org-query-decision-view.test.js`.
