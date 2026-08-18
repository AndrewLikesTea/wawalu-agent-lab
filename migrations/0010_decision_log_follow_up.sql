-- Widen the purpose CHECK by one request type: the home page's decision and
-- release log now asks for a follow-up of its own, alongside the bundled AI
-- FinOps example's. Same table, same shape, one more allowed label -- SQLite
-- cannot alter a CHECK in place, so the table is rebuilt the way 0008 and 0009
-- rebuilt it, carrying every existing row across.
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
    'follow_up_coach',
    'follow_up_releases',
    'follow_up_social',
    'follow_up_people',
    'follow_up_agents',
    'follow_up_decision_log'
  )),
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, purpose)
);

INSERT INTO lead_submissions (email, purpose, created_at)
  SELECT email, purpose, created_at FROM lead_submissions_legacy_0010;

DROP TABLE lead_submissions_legacy_0010;

CREATE INDEX lead_submissions_request_type_created_at_idx
  ON lead_submissions (created_at DESC);
