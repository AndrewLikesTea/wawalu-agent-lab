-- Private reports about public Social posts (#2343). Contract and handler:
-- src/post-reports-api.js; the form that writes them: src/post-report.js.
--
-- Forward-only and purely additive: a new table, no existing row touched.
--
-- Its own table rather than a lead purpose. A report is about one post, not a
-- follow-up request, and a new purpose would rebuild lead_submissions to widen
-- its CHECK. Nothing public reads this table: the feed and the permalink
-- project social_posts through publicPost() and never join here, so the
-- reporter's email and note are seen only by the Wawalu team.
CREATE TABLE IF NOT EXISTS social_post_reports (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  -- CASCADE like likes and comments: an owner's delete of a reported post must
  -- not start failing on this reference.
  post_id TEXT NOT NULL REFERENCES social_posts (id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (
    reason IN ('harmful', 'personal_information', 'spam', 'posted_in_error', 'other')
  ),
  context TEXT CHECK (context IS NULL OR length(context) BETWEEN 1 AND 500),
  reporter_email TEXT NOT NULL
    CHECK (length(reporter_email) BETWEEN 3 AND 254)
    CHECK (reporter_email = lower(trim(reporter_email))),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed'))
);

-- One open report per address per post, so a retry whose answer was lost is
-- the same row rather than a second one.
CREATE UNIQUE INDEX IF NOT EXISTS social_post_reports_open_idx
  ON social_post_reports (post_id, reporter_email) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS social_post_reports_status_idx
  ON social_post_reports (status, created_at);
