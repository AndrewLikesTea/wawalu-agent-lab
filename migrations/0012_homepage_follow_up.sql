ALTER TABLE lead_submissions RENAME TO lead_submissions_legacy_0012;
DROP INDEX lead_submissions_request_type_created_at_idx;

CREATE TABLE lead_submissions (
  email TEXT NOT NULL
    CHECK (length(email) BETWEEN 3 AND 254)
    CHECK (email = lower(trim(email))),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'field_notes',
    'follow_up',
    'follow_up_homepage',
    'follow_up_finops_example',
    'follow_up_coach',
    'follow_up_releases',
    'follow_up_social',
    'follow_up_people',
    'follow_up_agents'
  )),
  created_at TEXT NOT NULL,
  topic TEXT CHECK (topic IS NULL OR length(topic) BETWEEN 1 AND 160),
  message TEXT CHECK (message IS NULL OR length(message) BETWEEN 1 AND 200),
  PRIMARY KEY (email, purpose)
);

INSERT INTO lead_submissions (email, purpose, created_at, topic, message)
  SELECT email, purpose, created_at, topic, message FROM lead_submissions_legacy_0012;

DROP TABLE lead_submissions_legacy_0012;

CREATE INDEX lead_submissions_request_type_created_at_idx
  ON lead_submissions (created_at DESC);
