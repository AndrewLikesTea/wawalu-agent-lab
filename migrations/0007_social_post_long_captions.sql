-- Image publishing uses the common 2,200-character caption budget. Preserve
-- the original short content column for backwards compatibility and add the
-- full value beside it. Reads prefer long_content when present.
ALTER TABLE social_posts ADD COLUMN long_content TEXT
  CHECK (long_content IS NULL OR length(long_content) BETWEEN 281 AND 2200);
