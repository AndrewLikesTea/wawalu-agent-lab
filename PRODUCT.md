# Product charter: Shiplog

Build a small production engineering decision and release log hosted at
`labs.wawalu.org`.

## Initial user outcomes

- Record a decision with context, alternatives, owner, and status.
- Record a release and associate it with decisions.
- Browse and filter the history quickly.
- Export all records as JSON.
- Operate without access to Wawalu customer or telemetry data.

## Non-negotiable constraints

- No Wawalu production database, cookies, credentials, or internal APIs.
- No user-generated HTML execution.
- Accessible keyboard navigation and responsive layout.
- Tests and a production build must pass before merge.
- Production releases must be reversible and expose `/healthz`.
- Agents cannot modify deployment workflows, ownership, or agent policy.

