# Prompt coaching session contract

`prompt-coaching-session/1.0.0` — the versioned envelope a client receives when
it coaches one typed-in prompt or short conversation.

The executable contract is `src/prompt-coaching-contract.js`. This document
explains the decisions behind it; where the two disagree, the module is right
and this file is stale.

## The question each part answers

| Part of the session | The question it answers |
| --- | --- |
| `input` | What text was analyzed, and what was measured about it? |
| `outcome`, `reason` | Did I get an answer, and if not, why not? |
| `result` | What does the coach say, and what backs it? |
| `boundary` | What was done with my text? |

The in-product preview (`#prompt-coaching-preview` on `/evolution.html`) renders
those four in that order from this module, so the explanation a reader sees is
the contract the workflow runs on rather than a transcription of it.

## Decision states

Four, and a consumer switches on `outcome`. The engine's seven reason codes stay
on the session for anyone who wants the finer distinction — a reader disputing a
refusal quotes the code.

| `outcome` | Reason codes | What the client receives |
| --- | --- | --- |
| `graded` | — | answer, benchmark, one prioritized rewrite, a model-tier reading, rubric detail |
| `empty` | `empty_input`, `no_turns` | reason code plus recovery guidance. No score, no grade, no partial result |
| `invalid_input` | `unsupported_input`, `input_too_long`, `too_many_turns`, `no_user_turn` | reason code, recovery guidance, and the ceiling hit as a count |
| `unsupported_content` | `no_scorable_turn` | reason code, recovery guidance, and the classifier's per-turn codes |

`no_scorable_turn` is deliberately **not** invalid input. The paste was
well-formed and inside every ceiling; what failed is that the rubric could not
read a request out of code and carried-in logs. Telling a reader their input was
invalid sends them to fix the wrong thing.

`OUTCOME_BY_REASON` is total over the engine's reason codes and asserted so at
module load: a reason added without a decision about which state it belongs to
fails the module rather than falling through to a default branch.

## Field definitions

Precise enough that two engineers compute them the same way.

- **`sessionId`** — an opaque 1–64 character label using only letters, numbers,
  dots, underscores, and hyphens. It is never derived from prompt text and
  rejects addresses, markup, whitespace, and other identity-bearing labels.
- **`input.chars`** — `String.prototype.length` of the submitted text, in UTF-16
  code units, before trimming. The same quantity the `input_too_long` ceiling
  (20,000) compares against. `null` when the submission was not a string.
- **`input.turns`** — turns produced by `parseCoachingInput`: one per role label
  at the start of a line outside a fenced code block, or one turn for the whole
  paste when no label is found. `null` when the submission was not a string.
- **`input.labelled`** — whether any role label was found.
- **`input.scoredTurns`** — turns the classifier scored. `0` for every outcome
  other than `graded`, because a refusal scores nothing.
- **`input.modelTier`** — the tier named beside the box (`premium`, `standard`,
  `economy`) or `null`. `null` makes the model-fit signals abstain; no tier is
  ever assumed on a reader's behalf.
- **`input.source`** — `bundled_sample` or `reader_text`.
- **`result`** — `gradeMyPrompt`'s own return value, closed by
  `GRADED_RESULT_FIELDS` or `REFUSAL_RESULT_FIELDS`. The composite score, the
  letter bands and the axis weights are the rubric's
  (`docs/prompt-prose-rubric.md`); nothing is recomputed here.

A session carries **no timestamp**. A "when" is the one field two engineers
could not compute the same way, and nothing downstream needs one because nothing
stores one. The consequence is worth stating plainly: the same paste with the
same tier produces byte-identical JSON on any machine, which is what makes a
disputed grade reproducible.

## The local-only boundary

`COACHING_LOCAL_ONLY_BOUNDARY` states five exclusions, and each pairs its claim
with the property that makes the claim checkable. Every property is asserted
mechanically in `tests/prompt-coaching-contract.test.js`:

| Excluded | Checked by |
| --- | --- |
| Credentials and identities | no module reachable from the coaching entry references a cookie, storage, or authorization API |
| Network submission | no reachable module references `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, or `EventSource`; the flow tests fail on any request |
| Prompt storage | no reachable module references `localStorage`, `sessionStorage`, or IndexedDB |
| Customer data retention | a session built from text carrying a unique marker contains that marker in no field, at any depth |
| Live integrations | coaching imports only the bundled rubric and classifier; the samples are constants in the contract module |

The scan reduces each module to the code that runs — comments and string
literals removed — because this workflow's job includes *naming* the APIs it
does not use, both in the rule that forbids them and in the boundary copy on the
page. A scan that counted those as uses would force the product to stop saying
what it does not do in order to keep proving it.

### What the wording deliberately does not say

Coaching **runs in the browser from bundled static client-side code**. No
request is sent for coaching, and no persistence is implemented. The claim is
about behaviour, not about artifacts: nothing here says the workflow is some
number of files. A file count is not checkable from the page, changes whenever a
module is split, and answers none of the questions a reader asking about privacy
is actually asking. `tests/prompt-coaching-contract.test.js` fails on a
file-count claim in any boundary or state copy.

## What this contract deliberately leaves out

- **Persistence.** There is no store and no adapter. A future one would import
  these names rather than copy a field list out of this document — and would
  need its own consent decision, because none is granted here.
- **A team or organization grade.** One pasted text is one text. The floor for a
  grade to speak for a department is `prompt-grading-eligibility.js`'s
  `minPromptsPerDepartment`, and `result.basis` says so on every graded session.
- **Any claim about model behaviour.** The workflow reads the text and the tier
  named. It measures no answer, no follow-up turn, and no spend, and claims
  none.
