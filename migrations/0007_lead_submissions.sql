CREATE TABLE IF NOT EXISTS lead_submissions (
  email TEXT NOT NULL
    CHECK (length(email) BETWEEN 3 AND 254)
    CHECK (email = lower(trim(email))),
  purpose TEXT NOT NULL CHECK (purpose IN ('field_notes', 'follow_up')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, purpose)
);

INSERT OR IGNORE INTO lead_submissions (email, purpose, created_at)
  SELECT email, 'field_notes', created_at FROM leads;

CREATE INDEX IF NOT EXISTS lead_submissions_created_at_idx
  ON lead_submissions (created_at DESC);
