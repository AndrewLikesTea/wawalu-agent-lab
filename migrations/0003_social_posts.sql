CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY NOT NULL,
  author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 60),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 280),
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 100),
  principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS social_posts_timestamp_idx
  ON social_posts (timestamp DESC, id DESC);

CREATE TABLE IF NOT EXISTS social_post_rate_limits (
  principal_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (principal_id, window_start)
);
