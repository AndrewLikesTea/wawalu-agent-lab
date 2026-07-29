# Executive briefing surface

The presentation half of the executive FinOps briefing: what
`src/executive-briefing.html` renders, where its figures come from, and what
pressing "Print or save as PDF" is guaranteed to produce.

The arithmetic and its rules are not restated here. They live in
`docs/executive-finops-briefing-contract.md` and in the module that implements
it, `src/executive-finops-briefing.js`; this page consumes both and decides
nothing about a figure.

| Concern | Owner |
|---------|-------|
| What the figures mean | `src/executive-finops-briefing.js` |
| Which figures this browser has | `src/finops-workspace.js` |
| Which of the two sources is used | `src/executive-briefing-source.js` |
| How the document is drawn and printed | `src/executive-briefing-view.js` |
| Wiring the three together | `src/executive-briefing-page.js` |

## Source order

1. **This browser's own retained FinOps periods.** Read from the local workspace
   the AI FinOps page already keeps with the reader's consent, and built into a
   briefing in the same tab. No request is made to derive them — a populated
   workspace renders a full briefing with the network unreachable, which
   `tests/executive-briefing-local.test.js` asserts by declaring no fetch routes
   at all.
2. **The published synthetic sample**, when the workspace holds nothing to brief
   on. It is drawn *beneath* a labelled notice that names which of six reasons
   applies (`WORKSPACE_ABSENCE`): storage blocked, unreadable document,
   unsupported document, retention never chosen, retention declined, or nothing
   retained yet. Those are six different facts about a reader's machine and the
   page does not collapse them into "no data".

There is no third source. Nothing is uploaded, no credential is accepted, no
prompt is persisted, and no URL can carry a record — the sheet contains no link
of any kind, which is asserted rather than asserted-about.

A workspace that holds periods none of which can be briefed on (no positive
recoverable scenario, an absence reason recorded, insufficient confidence) is
*not* an absent source: those are still the reader's own months, so the briefing
renders its absent state, names every empty slot, and stays printable.

## The print flow

- One control, drawn by script into `#briefing-actions`. A print button on a page
  whose script never ran is a dead control, so it is never in the markup.
- Pressing it expands every disclosure level, opens the dialog, and restores the
  reader's own expansion state afterwards — `restoreAfterPrint` closes only the
  levels this code opened, so a level the reader opened stays open.
- `beforeprint`/`afterprint` do the same for the browser's own print command, and
  the print stylesheet reveals a collapsed panel on its own. Three routes, and
  the CSS route works with no script at all, because
  `PRESENTATION_REQUIREMENTS.print` requires every level on paper.
- A browser that offers this page no print dialog is told so in a status message,
  with the sheet left expanded so its own menu produces the same artifact.
- The printed sheet is self-contained: site header, footer, skip link, and the
  print control come off; the masthead, figure, action, confidence, provenance,
  method, limitations, and — when the sample is what was drawn — the notice
  saying so, all stay.
