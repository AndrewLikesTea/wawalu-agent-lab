-- What a follow-up visitor wants to discuss, one of FOLLOW_UP_INTENTS in
-- src/lead-capture.js. Nullable: rows from before this column, and every purpose
-- whose form does not ask, keep NULL. No CHECK, so a new value costs no rebuild.
ALTER TABLE lead_submissions ADD COLUMN intent TEXT;
