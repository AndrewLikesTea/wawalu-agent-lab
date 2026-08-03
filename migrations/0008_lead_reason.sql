-- Why a visitor asked for a follow-up, recorded beside the address that asked.
--
-- Nullable, because most rows in this table were never asked the question: the
-- field-note sign-up and the two follow-up forms that do not ask why send no
-- reason at all. The CHECK is the storage half of the vocabulary in
-- src/leads.js (LEAD_REASONS) and src/site-footer.js (FOLLOW_UP_REASONS), so a
-- value the endpoint would refuse cannot reach a row by another route either.
ALTER TABLE lead_submissions ADD COLUMN reason TEXT
  CHECK (reason IS NULL OR reason IN ('own_spend', 'demo_question', 'something_else'));
