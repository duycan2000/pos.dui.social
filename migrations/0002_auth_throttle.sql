-- Wrong-PIN counter for server logins. A key is 'staff:<id>' or 'register:<ip>'.
CREATE TABLE auth_throttle (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
