-- Unified social media post model: image references, captions, likes, comments.
-- Contract and rationale: docs/social-posts-api.md.
--
-- Forward-only and purely additive. Every row written by 0003 stays valid: a
-- text-only post has media_id IS NULL and caption IS NULL, and reverting the
-- application artifact leaves these tables in place with no data loss.
--
-- Bytes and metadata are separate tables: metadata is read on every feed page,
-- bytes only when a browser fetches an image. Posts never reference a blob
-- directly, so bytes can move to R2 without touching a post row.

CREATE TABLE IF NOT EXISTS social_media_objects (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  -- Opaque reference into whichever blob store is bound; the API derives URLs
  -- from the id instead (mediaUrl() in src/social-media.js).
  storage_key TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 1 AND 200),
  content_type TEXT NOT NULL CHECK (
    content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  ),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 524288),
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  -- Describes the bytes, so it lives with the bytes. NOT NULL because an
  -- undescribed image is an accessibility defect and PRODUCT.md makes
  -- screen-reader access non-negotiable.
  alt_text TEXT NOT NULL CHECK (length(alt_text) BETWEEN 1 AND 300),
  -- Optional, but paired: the client either reserves layout space or does not.
  width INTEGER CHECK (width IS NULL OR (width > 0 AND width <= 20000)),
  height INTEGER CHECK (height IS NULL OR (height > 0 AND height <= 20000)),
  principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((width IS NULL) = (height IS NULL))
);

CREATE INDEX IF NOT EXISTS social_media_objects_principal_idx
  ON social_media_objects (principal_id, created_at DESC);

-- Inline blob store, used when no object-store binding is present. Keyed by
-- storage_key so an R2-backed deployment shares the key space exactly, making
-- the move between them a copy rather than a rewrite.
CREATE TABLE IF NOT EXISTS social_media_blobs (
  storage_key TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- media_id is added before caption because caption's CHECK reads it.
ALTER TABLE social_posts ADD COLUMN media_id TEXT
  REFERENCES social_media_objects (id);

ALTER TABLE social_posts ADD COLUMN caption TEXT CHECK (
  caption IS NULL OR (length(caption) BETWEEN 1 AND 280 AND media_id IS NOT NULL)
);

-- A media object belongs to at most one post. This index -- not the guard in
-- the insert -- is what actually serializes two concurrent attempts to attach
-- the same upload; the guard only turns the loser into an explainable 409.
CREATE UNIQUE INDEX IF NOT EXISTS social_posts_media_idx
  ON social_posts (media_id) WHERE media_id IS NOT NULL;

-- One like per principal per post: the primary key makes liking idempotent at
-- the storage layer, so a retried request cannot inflate a count.
CREATE TABLE IF NOT EXISTS social_post_likes (
  post_id TEXT NOT NULL REFERENCES social_posts (id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, principal_id)
);

CREATE TABLE IF NOT EXISTS social_post_comments (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  post_id TEXT NOT NULL REFERENCES social_posts (id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 60),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 280),
  principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS social_post_comments_post_idx
  ON social_post_comments (post_id, created_at DESC, id DESC);
