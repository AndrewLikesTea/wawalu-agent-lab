ALTER TABLE lead_submissions ADD COLUMN topic TEXT
  CHECK (topic IS NULL OR length(topic) BETWEEN 1 AND 160);
