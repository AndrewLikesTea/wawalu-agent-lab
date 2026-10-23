-- Who is asking, when the visitor says (#2995): the optional Name and
-- Organization fields on the follow-up forms. Nullable, because both fields are
-- optional and rows from before this column have neither. The limits match
-- FOLLOW_UP_IDENTITY_LIMITS in src/lead-capture.js, which the endpoint enforces
-- after trimming; an empty value is stored as NULL, never as ''. No purpose
-- CHECK is touched, so this is two ALTERs and not a table rebuild.
ALTER TABLE lead_submissions ADD COLUMN name TEXT
  CHECK (name IS NULL OR length(name) BETWEEN 1 AND 120);
ALTER TABLE lead_submissions ADD COLUMN organization TEXT
  CHECK (organization IS NULL OR length(organization) BETWEEN 1 AND 200);
