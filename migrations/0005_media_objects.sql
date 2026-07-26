-- Shared, namespaced durable image storage. Contract: docs/images-api.md.
--
-- Forward-only and purely additive: no existing table is altered and no row is
-- rewritten, so reverting the application artifact leaves this table in place
-- with no data loss and the social post model untouched.
--
-- Why a second metadata table rather than reusing social_media_objects: that
-- table carries a product invariant this one must not inherit -- an image there
-- belongs to at most one social post (unique index social_posts_media_idx) and
-- cannot be deleted while attached. Widening it to hold unattached, 5 MB,
-- multi-tenant objects would either break that invariant or make every shared
-- upload look like an orphaned post image. The *storage mechanism* is still
-- shared: same D1 database, same social_media_blobs inline table, same R2
-- bucket, same key space. Only the metadata contract is separate.
--
-- Convergence path, deliberately not taken now: social_media_objects becomes
-- namespace 'social-media' in this table. That is a migration of live rows plus
-- a rewrite of the attach guard, which is more than this change should carry.

CREATE TABLE IF NOT EXISTS media_objects (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  -- The tenant seam. Reads are namespace-scoped, so one team cannot fetch
  -- another team's object by guessing an id, and a future namespace needs a
  -- value here rather than a new table.
  namespace TEXT NOT NULL CHECK (length(namespace) BETWEEN 1 AND 40),
  -- Opaque reference into whichever blob store is bound. Derived from the
  -- namespace and id (storageKeyFor in src/social-media.js), never parsed, so
  -- the key space stays collision-free across namespaces by construction.
  storage_key TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 1 AND 200),
  content_type TEXT NOT NULL CHECK (
    content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  ),
  -- 5 MB is the ceiling for the whole table. The *effective* limit is lower
  -- when no object store is bound, because the inline D1 fallback must stay
  -- bounded; the API enforces that (see INLINE_MAX_IMAGE_BYTES). Encoding the
  -- hard ceiling here means a bug in that logic fails as a rejected write
  -- rather than as an unbounded row.
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  -- Nullable in storage, required by the images API. PRODUCT.md makes
  -- screen-reader access non-negotiable for anything rendered, so the endpoint
  -- demands a description today; leaving the column nullable means a future
  -- namespace for images that are never rendered (build artifacts, diffs) can
  -- opt out without a migration. Relaxing an API rule is backward compatible;
  -- relaxing a NOT NULL column is not.
  alt_text TEXT CHECK (alt_text IS NULL OR length(alt_text) BETWEEN 1 AND 300),
  -- Who uploaded it. An opaque per-principal identifier -- a token subject or a
  -- salted hash of an edge-provided address -- never a credential, an account,
  -- or anything sourced from Wawalu systems.
  principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS media_objects_namespace_idx
  ON media_objects (namespace, created_at DESC);

-- Supports the reclaim/audit query an owner-scoped listing or sweeper will
-- need; cheap now, awkward to add once the table is large.
CREATE INDEX IF NOT EXISTS media_objects_principal_idx
  ON media_objects (namespace, principal_id, created_at DESC);
