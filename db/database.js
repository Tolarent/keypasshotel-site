// db/database.js
// Base de données SQLite locale — un seul fichier, aucune installation requise

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'keypass.db');

// Créer le dossier data si nécessaire
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Performance : WAL mode pour lectures/écritures simultanées
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Création des tables ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS hotel_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,   -- "301"
    floor       INTEGER,
    type        TEXT,               -- "Double", "Suite", etc.
    lock_id     TEXT,               -- ID interne du contrôleur serrures
    imported_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS zones (
    id   TEXT PRIMARY KEY,          -- "spa", "piscine"
    name TEXT NOT NULL,             -- "Spa & Bien-être"
    lock_ids TEXT DEFAULT '[]'      -- JSON array des IDs serrures de la zone
  );

  CREATE TABLE IF NOT EXISTS keys (
    id          TEXT PRIMARY KEY,   -- "kp_a1b2c3d4"
    guest_name  TEXT NOT NULL,
    guest_email TEXT,
    room_id     TEXT NOT NULL,
    zones       TEXT DEFAULT '[]',  -- JSON array ["spa", "piscine"]
    checkin     TEXT NOT NULL,      -- "2025-04-14"
    checkout    TEXT NOT NULL,      -- "2025-04-18"
    status      TEXT DEFAULT 'active', -- active | expired | revoked
    pass_serial TEXT UNIQUE,        -- serial Apple Wallet
    qr_token    TEXT UNIQUE,        -- token unique du QR code
    email_sent  INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    revoked_at  TEXT,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS access_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id     TEXT NOT NULL,
    room_id    TEXT,
    action     TEXT,               -- "door_opened", "door_denied", "key_created", "key_revoked"
    timestamp  TEXT DEFAULT (datetime('now')),
    details    TEXT                -- JSON
  );
`);

// ── Helpers ───────────────────────────────────────────────────────────────────

const KeysDB = {
  getAll() {
    return db.prepare(`
      SELECT k.*, r.type as room_type, r.floor
      FROM keys k
      LEFT JOIN rooms r ON k.room_id = r.id
      ORDER BY k.created_at DESC
    `).all();
  },

  getActive() {
    return db.prepare(`
      SELECT * FROM keys
      WHERE status = 'active'
      AND date(checkout) >= date('now')
      ORDER BY checkin ASC
    `).all();
  },

  getById(id) {
    return db.prepare('SELECT * FROM keys WHERE id = ?').get(id);
  },

  getByQrToken(token) {
    return db.prepare('SELECT * FROM keys WHERE qr_token = ?').get(token);
  },

  getByPassSerial(serial) {
    return db.prepare('SELECT * FROM keys WHERE pass_serial = ?').get(serial);
  },

  create(data) {
    const stmt = db.prepare(`
      INSERT INTO keys (id, guest_name, guest_email, room_id, zones,
                        checkin, checkout, pass_serial, qr_token)
      VALUES (@id, @guest_name, @guest_email, @room_id, @zones,
              @checkin, @checkout, @pass_serial, @qr_token)
    `);
    stmt.run(data);
    return this.getById(data.id);
  },

  revoke(id) {
    db.prepare(`
      UPDATE keys
      SET status = 'revoked', revoked_at = datetime('now')
      WHERE id = ?
    `).run(id);
    return this.getById(id);
  },

  markEmailSent(id) {
    db.prepare('UPDATE keys SET email_sent = 1 WHERE id = ?').run(id);
  },

  // Expire automatiquement les clés dont la date de checkout est passée
  expireOld() {
    return db.prepare(`
      UPDATE keys
      SET status = 'expired'
      WHERE status = 'active'
      AND date(checkout) < date('now')
    `).run().changes;
  },
};

const RoomsDB = {
  getAll() {
    return db.prepare('SELECT * FROM rooms ORDER BY floor, id').all();
  },

  upsert(rooms) {
    const stmt = db.prepare(`
      INSERT INTO rooms (id, floor, type, lock_id)
      VALUES (@id, @floor, @type, @lock_id)
      ON CONFLICT(id) DO UPDATE SET
        floor = excluded.floor,
        type  = excluded.type,
        lock_id = excluded.lock_id
    `);
    const insertMany = db.transaction((rooms) => {
      for (const r of rooms) stmt.run(r);
    });
    insertMany(rooms);
    return rooms.length;
  },

  count() {
    return db.prepare('SELECT COUNT(*) as n FROM rooms').get().n;
  },
};

const ConfigDB = {
  get(key) {
    const row = db.prepare('SELECT value FROM hotel_config WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  set(key, value) {
    db.prepare(`
      INSERT INTO hotel_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  },

  getAll() {
    const rows = db.prepare('SELECT key, value FROM hotel_config').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },
};

const LogDB = {
  add(key_id, action, room_id = null, details = {}) {
    db.prepare(`
      INSERT INTO access_log (key_id, room_id, action, details)
      VALUES (?, ?, ?, ?)
    `).run(key_id, room_id, action, JSON.stringify(details));
  },

  getLast(n = 50) {
    return db.prepare(`
      SELECT l.*, k.guest_name, k.room_id as key_room
      FROM access_log l
      LEFT JOIN keys k ON l.key_id = k.id
      ORDER BY l.timestamp DESC
      LIMIT ?
    `).all(n);
  },
};

module.exports = { db, KeysDB, RoomsDB, ConfigDB, LogDB };
