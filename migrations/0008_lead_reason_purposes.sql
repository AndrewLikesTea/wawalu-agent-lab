-- The footer's follow-up form now asks a visitor why they are reaching out, and
-- their answer travels as the request's purpose (see LEAD_PURPOSES in
-- src/leads.js). The CHECK constraint written in 0007 names its accepted values
-- inline, and SQLite cannot alter a constraint in place, so widening it is a
-- table rebuild.
--
-- Written to be safe to run twice: after the rename below there is no
-- lead_submissions_v2, so a second run recreates it empty, copies the same rows
-- forward, and lands on the same table with the same contents. No row is
-- dropped and no purpose already stored stops validating — the new list is the
-- old one plus three values.
CREATE TABLE IF NOT EXISTS lead_submissions_v2 (
  email TEXT NOT NULL
    CHECK (length(email) BETWEEN 3 AND 254)
    CHECK (email = lower(trim(email))),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'field_notes', 'follow_up', 'follow_up_own_spend', 'follow_up_question', 'follow_up_press'
  )),
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, purpose)
);

INSERT OR IGNORE INTO lead_submissions_v2 (email, purpose, created_at)
  SELECT email, purpose, created_at FROM lead_submissions;

DROP TABLE lead_submissions;

ALTER TABLE lead_submissions_v2 RENAME TO lead_submissions;

-- Dropping the old table dropped its index with it.
CREATE INDEX IF NOT EXISTS lead_submissions_created_at_idx
  ON lead_submissions (created_at DESC);
