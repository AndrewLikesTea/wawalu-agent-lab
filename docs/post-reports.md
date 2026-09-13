# Private post reports

Social cards and People tiles link to `/report-post.html?id=…`. The reporting
note under Social's feed links to the same page without a post, where it explains
the review route and sends the visitor back to choose one. The page resolves the
exact post before enabling submission, names its author and text, and discloses
the payload before collecting a reason, optional context and a required follow-up
email. Values remain in the page on failure, never in browser storage. Closing or
reloading the page discards the draft.

`POST /api/post-reports` accepts only JSON: `post_id` (1–100 characters),
`submission_id` (UUID), `reason` (a key below), `context` (0–2000, at least one
character with `other`), `email` (valid email, up to 254). Strings are trimmed
server-side. The post must exist in the durable store or bundled demo seed. The
server adds `created_at`. Success returns only `{"accepted":true}`. No report
read/list endpoint exists. All responses are non-cacheable. Errors never echo
input or log storage exception details.

| `reason` | Label on the form |
| --- | --- |
| `harmful` | Harmful or abusive |
| `sensitive` | Shares private or sensitive information |
| `mistaken` | Mistaken or misleading |
| `impersonation` | Uses someone else’s name |
| `other` | Something else |

## Counting reports

One `post_reports` row is one report; group rows by `post_id` or `reason`. There
is no reporter identity, so distinct reporters cannot be counted. Retrying
unchanged entries reuses the submission ID, and a unique key makes simultaneous
or lost-receipt retries land in one row. Changing any entry before retrying makes
a new ID, so a visitor who corrects an unconfirmed report can leave two rows for
one post. The API still refuses a reused ID with changed fields (409) without
revealing stored values. The form prevents parallel submissions and locks fields
while a request is pending.

## Delivery and production effect

Migration `0013_post_reports.sql` adds the private `post_reports` table and a
post-ID index to the existing DB binding. Apply it through the reviewed deployment
pipeline before using the new endpoint. No new binding or deployment configuration
is required. Rolling back the app leaves private rows intact; no public query
joins this table. Post IDs intentionally have no foreign key because bundled
sample posts are reportable too, and reports survive later post deletion.

These rows contain sensitive contact details and context. Access should remain
restricted to the team operating the database. This slice stores review requests;
it does not provide a staff inbox, email delivery, automated moderation, removal,
or a retention/erasure workflow. Hosting receives ordinary connection metadata;
the application does not store addresses or cookies with reports. Public clients
have no way to retrieve report content. Endpoint abuse controls beyond the
same-origin browser check and input bounds remain future work.
