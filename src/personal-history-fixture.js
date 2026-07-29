// The canonical synthetic personal history: one invented person's export, in
// both supported shapes, from one source.
//
// WHY IT EXISTS. A reader who has never opened their own assistant export cannot
// tell what this product will make of it, and a reviewer cannot tell whether the
// reader and the surface agree. This is the answer to both: a small, obviously
// invented history that every test, preview, and screenshot is built from, so
// the shape the parser expects, the file a UI previews, and the numbers a
// reviewer checks cannot drift apart.
//
// EVERYTHING HERE IS INVENTED. No real provider export, account, conversation,
// customer, or telemetry data was available to this workflow and none is used.
// The prompts are hand-authored for this fixture; the person does not exist.
//
// WHAT IT IS BUILT TO DEMONSTRATE. The fourteen requests below recur across
// three weeks, because that is what a habit looks like and detecting one is the
// whole job of the report. The history is deliberately mixed: this person
// usually states their context and constraints and almost never says what a
// correct answer would look like, so the prioritized move is a real reading of
// them rather than the rubric's favourite sentence. It also carries one of every
// coverage bucket on purpose — an empty message, an undated one, a message that
// is only pasted code, and an attachment with no text — so a preview shows what
// a partly-readable file does to the coverage figure.

/** The nine dates the history falls on: three days a week, three weeks apart. */
export const PERSONAL_PREVIEW_DAYS = Object.freeze([
  "2026-05-04", "2026-05-05", "2026-05-07",
  "2026-05-11", "2026-05-12", "2026-05-14",
  "2026-05-18", "2026-05-19", "2026-05-21",
]);

/**
 * The fourteen requests, in the order they are dealt onto the days above.
 *
 * Written to be unremarkable working prose rather than showcase prompts: the
 * point of the fixture is a plausible week of somebody's requests, not a set of
 * examples chosen to make a rubric look good.
 */
export const PERSONAL_PREVIEW_PROMPTS = Object.freeze([
  "Context: I am drafting the partner update for this quarter.\n"
    + "Request: turn these notes into five bullets.\n"
    + "Notes: the renewal moved a month, the pilot slipped a week, the pricing page shipped.",
  "Context: our onboarding email sits at a twelve percent open rate.\n"
    + "Request: propose three subject lines.\n"
    + "Constraints: under sixty characters, no exclamation marks.",
  "can you improve this and make it better as needed",
  "Context: I am reviewing a supplier agreement before I sign it.\n"
    + "Request: list the clauses that affect how we end it.\n"
    + "Material: the term auto-extends for twelve months unless notice is given ninety days ahead.",
  "make this shorter",
  "Request: summarise the incident timeline below.\n"
    + "Material: 09:12 the alert fired, 09:20 the rollback started, 09:41 traffic recovered.\n"
    + "Constraints: one paragraph, no bullet points.",
  "that is not what I meant, I wanted one paragraph and not five bullets",
  "Context: weekly status note for my manager.\n"
    + "Request: tighten this paragraph.\n"
    + "Constraints: keep it to four sentences and keep the dates in it.",
  "Context: I am preparing an internal talk on release hygiene.\n"
    + "Request: outline six sections.\n"
    + "Constraints: forty minutes in total and no live demonstration.",
  "Request: explain why this report is slow to open.\n"
    + "Material: it joins the orders table to the customer table and filters on the last thirty days.\n"
    + "Constraints: no schema changes.",
  "rewrite this so it sounds more confident",
  "what is a good structure for a weekly update? also which tools do people use for it? "
    + "and how long should it be? should I send it on a Friday or a Monday?",
  "Context: onboarding checklist for a new starter on the platform team.\n"
    + "Request: draft the first week.\n"
    + "Constraints: nothing that needs a manager to approve access, half days only.",
  "Context: I am answering a customer question about how long we keep their data.\n"
    + "Request: draft a reply.\n"
    + "Constraints: plain language, under two hundred words, no promises about future features.",
]);

/** How many times the fourteen requests recur. Three weeks is the habit. */
export const PERSONAL_PREVIEW_WEEKS = 3;

/**
 * The four entries that exercise the coverage buckets, kept separate from the
 * requests above so a reader can see they are deliberate rather than sloppy
 * data. Each one names the bucket it lands in.
 */
export const PERSONAL_PREVIEW_EDGE_ENTRIES = Object.freeze([
  Object.freeze({
    bucket: "empty", date: PERSONAL_PREVIEW_DAYS[0], text: "   ",
    why: "A message sent with nothing in it. Counted, never scored.",
  }),
  Object.freeze({
    bucket: "undated", date: null, text: "draft a short thank-you note for the workshop hosts",
    why: "A well-formed request whose conversation carried no date. The date is required, so "
      + "this is a counted drop rather than a guess at a day.",
  }),
  Object.freeze({
    bucket: "unreadable", date: PERSONAL_PREVIEW_DAYS[4],
    text: "```\nTypeError: cannot read properties of undefined (reading 'total')\n"
      + "    at summarise (report.js:42:17)\n    at main (report.js:88:3)\n```",
    why: "Pasted output with no request in prose. The rubric cannot read a question out of it, "
      + "so it is counted as unreadable rather than scored badly.",
  }),
  Object.freeze({
    bucket: "attachment", date: PERSONAL_PREVIEW_DAYS[7], text: "",
    why: "A message that is only a file. It is counted as an attachment and is not a prompt "
      + "entry at all, so it never enters the coverage denominator.",
  }),
]);

/** Which day each request falls on: three per day, cycling, week by week. */
function scheduled() {
  const entries = [];
  for (let week = 0; week < PERSONAL_PREVIEW_WEEKS; week += 1) {
    PERSONAL_PREVIEW_PROMPTS.forEach((text, at) => {
      entries.push({ date: PERSONAL_PREVIEW_DAYS[week * 3 + (at % 3)], text });
    });
  }
  return entries;
}

/**
 * The history as a personal conversation export (JSON).
 *
 * One conversation per entry, each with the assistant reply that would have
 * followed. The replies are here to be ignored: a reader checking the coverage
 * figure should be able to see that ninety messages produced forty-odd prompt
 * entries because assistant turns are not read.
 */
export function personalHistoryPreviewJson() {
  const conversations = scheduled().map((entry, at) => ({
    title: `Working session ${at + 1}`,
    create_time: `${entry.date}T09:00:00Z`,
    messages: [
      { role: "user", create_time: `${entry.date}T09:00:00Z`, content: entry.text },
      { role: "assistant", create_time: `${entry.date}T09:00:12Z`, content: "Here is a draft." },
    ],
  }));
  for (const edge of PERSONAL_PREVIEW_EDGE_ENTRIES) {
    const message = edge.bucket === "attachment"
      ? { role: "user", attachments: [{}] }
      : { role: "user", content: edge.text };
    conversations.push({
      title: `Working session ${edge.bucket}`,
      ...(edge.date ? { create_time: `${edge.date}T14:30:00Z` } : {}),
      messages: [message, { role: "assistant", content: "Here is a draft." }],
    });
  }
  return `${JSON.stringify({ conversations }, null, 2)}\n`;
}

const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;

/**
 * The same history as a personal prompt log (CSV).
 *
 * Built from the same source as the JSON above, so the two shapes cannot drift.
 * A table has no roles and no attachments in it, so the attachment entry has no
 * row here — and the two shapes still report the same coverage denominator,
 * which is the point: an attachment-only message is not a prompt entry in either
 * shape, so leaving it out of one file changes no published figure.
 */
export function personalHistoryPreviewTable() {
  const lines = ["date,prompt"];
  for (const entry of scheduled()) lines.push(`${entry.date},${quote(entry.text)}`);
  for (const edge of PERSONAL_PREVIEW_EDGE_ENTRIES) {
    if (edge.bucket === "attachment") continue;
    lines.push(`${edge.date ?? ""},${quote(edge.text)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Both shapes, keyed by the shape id they are meant to be recognized as. */
export function personalHistoryPreviewFiles() {
  return Object.freeze([
    Object.freeze({
      shape: "personal-conversation-json",
      name: "personal-history-preview.json",
      text: personalHistoryPreviewJson(),
    }),
    Object.freeze({
      shape: "personal-prompt-table",
      name: "personal-history-preview.csv",
      text: personalHistoryPreviewTable(),
    }),
  ]);
}
