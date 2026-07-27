// The downloadable example conversation exports, one per supported dialect.
//
// A reader who has never seen an assistant admin export cannot tell whether
// theirs will be recognized. These are the answer: four small, obviously
// synthetic files, each spelled the way that vendor family spells its columns.
//
// Everything is invented — the organisations, the identifiers, the prose, and
// the addresses, all in the reserved `.invalid` domain. No real, scraped, or
// personal content appears here, and nothing in this file reaches a network.
//
// One source, two artifacts. `conversationExampleTable` builds the columns and
// rows the parser consumes, and `conversationExampleText` writes the same data
// as delimited bytes. The committed fixtures under
// `contracts/integrations/conversation-export/v1/fixtures/` are those bytes, and
// the tests assert all three agree, so the shipped file, the download, and the
// parser's expectations cannot drift apart.

import { CONVERSATION_DIALECT_PROFILES } from "./dialect-profiles.js";

/** The four turns every example carries, in the contract's own vocabulary. */
const TURNS = Object.freeze([
  Object.freeze({
    id: "conv-4821", actor: "rowan.ash@example.invalid", department: "Atlas Platform",
    at: "2026-06-15T09:12:04Z", model: "assistant-large",
    prompt: "summarize the incident review notes into five bullets for the ops readout",
  }),
  Object.freeze({
    id: "conv-4822", actor: "juno.vale@example.invalid", department: "Boreal Support",
    at: "2026-06-15T11:40:19Z", model: "assistant-small",
    prompt: "draft a friendly reply explaining the refund window to a waiting customer",
  }),
  Object.freeze({
    id: "conv-4823", actor: "rowan.ash@example.invalid", department: "Atlas Platform",
    at: "2026-06-16T08:55:41Z", model: "assistant-large",
    prompt: "rewrite this migration checklist so each step names its rollback",
  }),
  Object.freeze({
    id: "conv-4824", actor: "wren.holt@example.invalid", department: "Cinder Research",
    at: "2026-06-16T15:02:58Z", model: "assistant-small",
    prompt: "list three questions to ask before we approve another evaluation run",
  }),
]);

/**
 * Per dialect: the header spellings, in vendor order, and what fills each one.
 * The keys are dialect ids, so a profile added without an example fails the
 * coverage test rather than shipping a control that downloads nothing.
 */
const SHAPES = Object.freeze({
  "chatgpt-enterprise-conversation-export": Object.freeze([
    ["conversation_id", (turn) => turn.id],
    ["user_email", (turn) => turn.actor],
    ["department", (turn) => turn.department],
    ["created_at", (turn) => turn.at],
    ["role", () => "user"],
    ["model", (turn) => turn.model],
    ["message_text", (turn) => turn.prompt],
  ]),
  "claude-enterprise-conversation-export": Object.freeze([
    ["conversation_uuid", (turn) => turn.id],
    ["account_email", (turn) => turn.actor],
    ["organization_group", (turn) => turn.department],
    ["started_at", (turn) => turn.at],
    ["sender", () => "human"],
    ["model_slug", (turn) => turn.model],
    ["prompt_text", (turn) => turn.prompt],
  ]),
  "copilot-conversation-export": Object.freeze([
    ["interaction_id", (turn) => turn.id],
    ["user_principal_name", (turn) => turn.actor],
    ["cost_center", (turn) => turn.department],
    ["interaction_time", (turn) => turn.at],
    ["app_host", () => "documents"],
    ["client_type", () => "web"],
    ["prompt_body", (turn) => turn.prompt],
  ]),
  "workspace-audit-conversation-export": Object.freeze([
    ["event_id", (turn) => turn.id],
    ["actor_email", (turn) => turn.actor],
    ["org_unit_path", (turn) => turn.department],
    ["event_time", (turn) => turn.at],
    ["event_name", () => "assistant_prompt_submitted"],
    ["application", () => "workspace-assistant"],
    ["prompt_content", (turn) => turn.prompt],
  ]),
});

/** One entry per shipped example, in registry order. Drives the UI chooser. */
export const CONVERSATION_EXAMPLE_FILES = Object.freeze(
  CONVERSATION_DIALECT_PROFILES.map((profile) => Object.freeze({
    dialectId: profile.id,
    label: profile.label,
    fileName: `example-${profile.id}.csv`,
    mediaType: "text/csv",
  })),
);

const shapeFor = (dialectId) => {
  const shape = SHAPES[dialectId];
  if (!shape) throw new RangeError(`no example conversation export for dialect ${dialectId}`);
  return shape;
};

/** The example as the table shape the dialect layer consumes. */
export function conversationExampleTable(dialectId) {
  const shape = shapeFor(dialectId);
  return {
    delimiter: ",",
    headerRowIndex: 0,
    columns: shape.map(([header]) => header),
    rows: TURNS.map((turn) => shape.map(([, fill]) => fill(turn))),
  };
}

/** RFC 4180 quoting, for the one column that carries a comma-bearing sentence. */
const cell = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The example as bytes — exactly what the committed fixture holds. */
export function conversationExampleText(dialectId) {
  const table = conversationExampleTable(dialectId);
  return `${[table.columns.join(","), ...table.rows.map((row) => row.map(cell).join(","))].join("\n")}\n`;
}

/** Every example as `{ fileName, mediaType, text }`, the shape the page hands a download. */
export function conversationExampleFiles() {
  return CONVERSATION_EXAMPLE_FILES.map((entry) => ({ ...entry, text: conversationExampleText(entry.dialectId) }));
}
