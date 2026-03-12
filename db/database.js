const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
  await db.execute(`CREATE TABLE IF NOT EXISTS keys (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL, hotelName TEXT, roomNumber TEXT, guestName TEXT, checkIn TEXT, checkOut TEXT, zones TEXT, passUrl TEXT, active INTEGER DEFAULT 1, createdAt TEXT DEFAULT (datetime('now')))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL, floor TEXT, type TEXT DEFAULT 'standard', active INTEGER DEFAULT 1)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, createdAt TEXT DEFAULT (datetime('now')))`);
  console.log('✅ Turso DB initialisée');
}

const dbHelper = {
  async run(sql, params = []) { return await db.execute({ sql, args: params }); },
  async get(sql, params = []) { const r = await db.execute({ sql, args: params }); return r.rows[0] || null; },
  async all(sql, params = []) { const r = await db.execute({ sql, args: params }); return r.rows; }
};

module.exports = { db, dbHelper, initDB };
