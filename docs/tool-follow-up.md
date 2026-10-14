# Tool follow-up requests

Social (`social.html`), People (`profile.html`) and Agent observatory
(`agents.html`) offer Shiplog or the current separate tool. Shiplog is selected
initially and retains its four existing inquiry options. Separate tools send a
neutral question; their selection does not offer a demonstration, pilot or price.

`POST /api/leads` carries `tool: shiplog|social|people|agents` alongside the existing
email, purpose, fixed page topic, intent and optional message. The server accepts
only the separate tool matching that page purpose (not the Social post page).
Separate tools require `intent: question`; Shiplog retains the four established
intent values. Older requests with no tool retain the Shiplog behavior.

Shiplog requests remain in `lead_submissions`, with a structured `tool` column
fixed to `shiplog`. Separate interest is in `tool_interest_requests`, with the
selected tool, email, source purpose/topic, timestamp and optional message.
Recipients must inspect both tables. The new table has one row per email,
purpose and tool; a repeat updates its message. A Shiplog inquiry and separate
tool inquiry from the same address are retained independently. No email delivery
service is added: this extends the existing storage-and-review path.

The API returns the saved tool for these requests. Separate-tool success requires
a matching tool in the response; an old endpoint cannot silently produce a false
receipt. Forms retain the data-use disclosure and usual two-working-day response
window, and the receipt names the tool.

Production effect: reviewed deployment must apply migration
`0015_tool_interest.sql` before the new tool submissions can succeed. Without it,
the endpoint reports a storage error rather than claiming success. The migration
adds a column and a table without deleting existing rows. Reverting application
code leaves the additive schema and captured interest available for review.
