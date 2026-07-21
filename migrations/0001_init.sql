CREATE TABLE IF NOT EXISTS user_scope (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'pending',
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  added_by TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  email TEXT,
  role TEXT,
  action TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  result TEXT
);
