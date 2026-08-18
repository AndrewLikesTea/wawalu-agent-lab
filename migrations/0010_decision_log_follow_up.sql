-- Widen the lead_submissions purpose CHECK to the home page's second
-- contextual follow-up: 'follow_up_decision_log', asked in the section that
-- describes the decision and release log rather than the bundled AI FinOps
-- example.
--
-- SQLite cannot alter a CHECK in place, so this is the same rename/recreate/
-- copy/drop shape migration 0009 used. Nothing else about the table moves: the
-- columns, both email CHECKs, the composite primary key and the created_at
-- index are byte-for-byte the ones 0009 left behind, so an operator applying
-- this migration changes exactly one thing.

ALTER TABLE lead_submissions RENAME TO lead_submissions_legacy_0010;
DROP INDEX lead_submissions_request_type_created_at_idx;

CREATE TABLE lead_submissions (
  email TEXT NOT NULL
    CHECK (length(email) BETWEEN 3 AND 254)
    CHECK (email = lower(trim(email))),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'field_notes',
    'follow_up',
    'follow_up_finops_example',
    'follow_up_decision_log',
    'follow_up_coach',
    'follow_up_releases',
    'follow_up_social',
    'follow_up_people',
    'follow_up_agents'
  )),
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, purpose)
);

INSERT INTO lead_submissions (email, purpose, created_at)
  SELECT email, purpose, created_at FROM lead_submissions_legacy_0010;

DROP TABLE lead_submissions_legacy_0010;

CREATE INDEX lead_submissions_request_type_created_at_idx
  ON lead_submissions (created_at DESC);
