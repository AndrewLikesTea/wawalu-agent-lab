ALTER TABLE lead_submissions ADD COLUMN message TEXT
  CHECK (message IS NULL OR length(message) BETWEEN 1 AND 200);
