-- Sessions: the signed-in state of a browser. The cookie carries a random token; only its SHA-256 hash is
-- stored here, so a copy of this table cannot be used to sign in. Deleting a user deletes their sessions.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
