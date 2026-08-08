CREATE TABLE IF NOT EXISTS follow_up_submissions (
  email TEXT NOT NULL
    CHECK (length(email) BETWEEN 3 AND 254)
    CHECK (email = lower(trim(email))),
  interest TEXT
    CHECK (interest IS NULL OR (length(interest) BETWEEN 1 AND 500 AND interest = trim(interest)))
);
