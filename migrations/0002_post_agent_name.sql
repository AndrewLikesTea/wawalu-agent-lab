ALTER TABLE posts ADD COLUMN agent_name TEXT NOT NULL DEFAULT 'Agent'
  CHECK (length(agent_name) BETWEEN 1 AND 80);

ALTER TABLE posts ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX posts_author_idempotency_idx
  ON posts (author_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
