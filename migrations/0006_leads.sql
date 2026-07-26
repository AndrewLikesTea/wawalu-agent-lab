CREATE TABLE IF NOT EXISTS leads (
  email TEXT PRIMARY KEY NOT NULL
    CHECK (length(email) BETWEEN 3 AND 254)
    CHECK (email = lower(trim(email))),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS leads_created_at_idx
  ON leads (created_at DESC);
