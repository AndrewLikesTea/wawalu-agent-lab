ALTER TABLE lead_submissions RENAME TO lead_submissions_legacy;

CREATE TABLE lead_submissions (
  email TEXT NOT NULL
    CHECK (length(email) BETWEEN 3 AND 254)
    CHECK (email = lower(trim(email))),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'field_notes',
    'follow_up',
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
  SELECT email, purpose, created_at FROM lead_submissions_legacy;

CREATE INDEX lead_submissions_request_type_created_at_idx
  ON lead_submissions (created_at DESC);
