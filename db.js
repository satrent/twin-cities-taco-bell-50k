import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export const dataDir = process.env.DATA_DIR || join(root, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'taco50k.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  -- Overwrite deleted rows with zeros so removed personal data doesn't linger in the file.
  PRAGMA secure_delete = ON;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT NOT NULL UNIQUE,
    year              INTEGER NOT NULL,
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL,
    email             TEXT NOT NULL COLLATE NOCASE,
    phone             TEXT NOT NULL,
    hometown          TEXT NOT NULL DEFAULT '',
    category          TEXT NOT NULL,
    shirt_size        TEXT NOT NULL,
    diet              TEXT NOT NULL,
    runner_notes      TEXT NOT NULL DEFAULT '',
    emergency_name    TEXT NOT NULL,
    emergency_phone   TEXT NOT NULL,
    waiver_signature  TEXT NOT NULL,
    waiver_signed_at  TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('registered', 'waitlist', 'cancelled')),
    paid              INTEGER NOT NULL DEFAULT 0,
    packet_picked_up  INTEGER NOT NULL DEFAULT 0,
    finished          INTEGER NOT NULL DEFAULT 0,
    bib               TEXT NOT NULL DEFAULT '',
    admin_notes       TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL,
    UNIQUE (year, email)
  );

  CREATE TABLE IF NOT EXISTS notify_list (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL DEFAULT '',
    last_name  TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL
  );
`);

// Databases made before the notify form asked for first and last name separately.
const notifyColumns = db.prepare('PRAGMA table_info(notify_list)').all().map((c) => c.name);
for (const col of ['first_name', 'last_name']) {
  if (!notifyColumns.includes(col)) db.exec(`ALTER TABLE notify_list ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
}

// Everything an organizer might change year to year. Editable in Admin > Settings.
export const DEFAULT_SETTINGS = {
  year: '2027',
  race_date: 'Date coming soon',
  start_time: '6:30 AM',
  // 'soon' (before launch), 'open', or 'closed' (after the race). A new database starts at 'soon'
  // so nobody can sign up on a fresh deploy until an organizer opens registration.
  registration_mode: 'soon',
  capacity: '100',
  fee: '85',
  deadline: 'To be announced',
  refund_cutoff: 'To be announced',
  packet_pickup: 'To be announced',
  payment_instructions: "We'll email you payment details soon. Your spot is held in the meantime."
};

const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertDefault.run(key, value);

export function getSettings() {
  const out = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) out[key] = value;
  return out;
}

const upsert = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
export function saveSettings(values) {
  for (const [key, value] of Object.entries(values)) upsert.run(key, String(value));
}

// Bookkeeping for the backup and new-year tools. Kept out of DEFAULT_SETTINGS so the
// settings form can't change them.
export function getMeta(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
}
export function setMeta(key, value) {
  upsert.run(key, value);
}
/** Call whenever runner or notify-list data changes, so we know whether the last backup is current. */
export function markDataChanged() {
  setMeta('data_changed_at', new Date().toISOString());
}

export function registeredCount(year) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM registrations WHERE year = ? AND status = 'registered'")
    .get(year).n;
}
