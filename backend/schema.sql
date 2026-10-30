
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL DEFAULT '',
  start        TEXT NOT NULL DEFAULT '',
  end          TEXT NOT NULL DEFAULT '',
  topic        TEXT NOT NULL DEFAULT '',
  price        TEXT NOT NULL DEFAULT '',
  capacity     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',
  meetLink     TEXT NOT NULL DEFAULT '',
  prepStudents TEXT NOT NULL DEFAULT '',
  prepAdmin    TEXT NOT NULL DEFAULT '',
  details      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);

CREATE TABLE IF NOT EXISTS bookings (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  sessionId TEXT NOT NULL,
  name      TEXT NOT NULL DEFAULT '',
  phone     TEXT NOT NULL DEFAULT '',
  email     TEXT NOT NULL DEFAULT '',
  seats     INTEGER NOT NULL DEFAULT 1,
  note      TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT '',
  status    TEXT NOT NULL DEFAULT 'pending',
  amount    TEXT NOT NULL DEFAULT '',
  paidAt    TEXT NOT NULL DEFAULT '',
  expires   TEXT NOT NULL DEFAULT '',
  consentAt TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_bookings_session ON bookings(sessionId);
CREATE INDEX IF NOT EXISTS idx_bookings_phone   ON bookings(phone);
CREATE INDEX IF NOT EXISTS idx_bookings_email   ON bookings(email);

CREATE TABLE IF NOT EXISTS menu (
  id       TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT '',
  name     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tokens (
  hash    TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS limits (
  key     TEXT PRIMARY KEY,
  count   INTEGER NOT NULL DEFAULT 0,
  resetAt INTEGER NOT NULL
);
