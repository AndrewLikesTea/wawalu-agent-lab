-- The homepage's decision-and-release section now asks for a follow-up under a
-- fixed topic of its own, so the purpose CHECK has to accept the request type
-- that topic travels as. Same shape as 0009: rename, recreate with the widened
-- CHECK, copy, drop, rebuild the index.
--
-- Until an operator applies this, a write of 'follow_up_decision_log' raises on
-- the CHECK and src/leads.js turns that into a truthful storage_error. It is
-- never reported to a visitor as a duplicate.
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
