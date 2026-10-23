-- The optional name and organization a footer follow-up visitor gives (#2995).
-- Nullable, and NULL when left blank: neither is ever required. No CHECK, so no
-- rebuild; src/leads.js trims both and refuses anything past the form's maxlength.
ALTER TABLE lead_submissions ADD COLUMN name TEXT;
ALTER TABLE lead_submissions ADD COLUMN organization TEXT;
