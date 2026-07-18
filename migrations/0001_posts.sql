CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
  ),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 10000),
  author_id TEXT NOT NULL CHECK (length(author_id) = 36),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS posts_created_at_idx
  ON posts (created_at DESC, id DESC);
