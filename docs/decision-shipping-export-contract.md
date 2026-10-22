# Decision shipping evidence (#2981)

The history answers, in order: which decision am I reviewing, which releases
reference it, and does it still need acceptance? The JSON export answers the same
questions for offline review without requiring the reader to rebuild the join.
Neither surface establishes the decision's status at the time a release shipped:
Shiplog has no acceptance-event history or production-deployment evidence.

Acceptance questions and definitions:

- **Which releases carried this decision?** `shipped_in` contains one `{ id,
  version }` per distinct stored release id whose `decisionIds` contains the
  decision's exact id. Duplicate references do not multiply shipments. Values
  remain unshortened; the page's 100-link display limit does not limit the file.
  Empty means no stored release references this decision.
- **Which came first?** Entries sort by parsed `createdAt` descending, with invalid
  dates last, then version descending using the shared history comparator.
  Exact ties retain release storage order. Version numbers do not determine time.
- **Which shipped decisions currently need acceptance?**
  `shipped_while_unaccepted` is true iff `shipped_in.length > 0` and current status,
  after mapping legacy `approved` to `accepted`, is not `accepted`. This includes
  `superseded`; it does not prove that acceptance was missing when shipping occurred.
- **Does filtering erase shipping evidence?** Only the selected decision records
  are exported, but their shipping evidence uses every release in browser storage,
  including releases outside the filter. Such releases need not have a full record
  in this file. Counts continue to count exported records, not shipping references.
- **What evidence is missing?** A release's optional `unresolved_decision_ids` lists
  distinct referenced ids absent from browser storage in first-reference order.
  These ids remain outside the existing resolved `decisionIds` and `associations`
  joins. Filter-hidden decisions are not missing. No phantom decisions are created.
- **What does each release ship, and is any of it unaccepted? (#2985)**
  `decision_links` holds one `{ id, title, status, unresolved }` per stored
  reference, in association order, from the history row's `resolveRelease`
  against every decision in browser storage. A missing id is `{ id, title: null,
  status: null, unresolved: true }`. `ships_unaccepted` is
  `shipsUnacceptedDecision`, the releases page's filter predicate. An unresolved
  link counts as not accepted. Both keys follow every legacy release key, and
  the importer drops them.

The existing envelope, record order, fields and resolved joins remain compatible.
Derived shipping fields are recalculated, not restored as authoritative storage
on import. Missing-id evidence is an audit annotation, not an importable link.
No new dashboard, aggregate KPI, or deployment-status claim is in scope.
