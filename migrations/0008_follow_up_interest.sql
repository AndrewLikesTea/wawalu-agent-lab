ALTER TABLE lead_submissions ADD COLUMN interest TEXT
  CHECK (interest IS NULL OR length(interest) <= 280);
