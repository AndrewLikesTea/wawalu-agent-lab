-- Private review requests. No public read route or join into public post data.
-- post_id also supports bundled demo posts, so no FK to social_posts.
CREATE TABLE IF NOT EXISTS post_reports (
  submission_id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  context TEXT NOT NULL CHECK(length(context) <= 2000),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS post_reports_post_idx ON post_reports(post_id);
