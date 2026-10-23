-- Who is asking, as the follow-up visitor chose to say: both optional, both
-- trimmed and capped in src/leads.js. Nullable: rows from before these columns,
-- every purpose whose form does not ask, and every field left blank keep NULL.
-- No CHECK, so the cap can move without a table rebuild.
ALTER TABLE lead_submissions ADD COLUMN name TEXT;
ALTER TABLE lead_submissions ADD COLUMN organization TEXT;
