const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'kindred.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  qr_code       TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age            INTEGER,
  location       TEXT,
  bio            TEXT,
  socials_json   TEXT NOT NULL DEFAULT '{}',   -- {linkedin, instagram, twitter, tiktok, facebook, website}
  social_text    TEXT,                          -- pasted bios/posts the user consents to analyse
  answers_json   TEXT NOT NULL DEFAULT '{}',   -- raw questionnaire answers keyed by question id
  traits_json    TEXT NOT NULL DEFAULT '{}',   -- derived scores (big five, attachment, values, etc.)
  interests_json TEXT NOT NULL DEFAULT '[]',   -- merged chosen + extracted interest tags
  completed      INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scanner_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scanned_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  report_json TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
