CREATE TABLE IF NOT EXISTS leads (
  email TEXT PRIMARY KEY NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
