-- Case Log sync relay (Cloudflare D1). Holds only encrypted batches.
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS batches (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  device TEXT NOT NULL,
  iv TEXT NOT NULL,
  data TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS batches_room_seq ON batches (room, seq);
