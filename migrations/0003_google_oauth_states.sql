CREATE TABLE IF NOT EXISTS google_oauth_states (
  state TEXT PRIMARY KEY,
  owner_did TEXT NOT NULL,
  created_at TEXT NOT NULL
);
