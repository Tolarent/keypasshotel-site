// server.js
// Point d'entrée KeyPass — serveur Express qui tourne en local sur le PC de l'hôtel

require('dotenv').config({ path: './config.env' });

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:3000',  // dashboard React
    'http://127.0.0.1:3000',
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log des requêtes (dev)
app.use((req, res, next) => {
  const ts = new Date().toLocaleTimeString('fr-FR');
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/keys',  require('./routes/keys'));
app.use('/api/setup', require('./routes/setup'));

// ── Téléchargement du .pkpass (appelé par l'iPhone après scan QR) ─────────────
// Cette route est séparée car elle est accédée par le client, pas le dashboard
app.get('/api/passes/download', (req, res) => {
  // Redirigée vers routes/keys.js
  require('./routes/keys')(req, res);
});

// ── Santé du serveur ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    ok:      true,
    service: 'KeyPass',
    version: '1.0.0',
    hotel:   process.env.HOTEL_NAME || 'Non configuré',
    lock:    process.env.LOCK_BRAND ? `${process.env.LOCK_BRAND} @ ${process.env.LOCK_IP}` : 'Non configuré',
    uptime:  Math.floor(process.uptime()),
  });
});

// ── Stats dashboard ───────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  try {
    const { KeysDB, RoomsDB, LogDB } = require('./db/database');

    const keys     = KeysDB.getAll();
    const active   = keys.filter(k => k.status === 'active');
    const today    = new Date().toISOString().slice(0, 10);
    const checkins = keys.filter(k => k.checkin === today);

    res.json({
      ok:           true,
      activeKeys:   active.length,
      checkinsToday: checkins.length,
      totalRooms:   RoomsDB.count(),
      recentLog:    LogDB.getLast(20),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ██╗  ██╗███████╗██╗   ██╗██████╗  █████╗ ███████╗███████╗');
  console.log('  ██║ ██╔╝██╔════╝╚██╗ ██╔╝██╔══██╗██╔══██╗██╔════╝██╔════╝');
  console.log('  █████╔╝ █████╗   ╚████╔╝ ██████╔╝███████║███████╗███████╗');
  console.log('  ██╔═██╗ ██╔══╝    ╚██╔╝  ██╔═══╝ ██╔══██║╚════██║╚════██║');
  console.log('  ██║  ██╗███████╗   ██║   ██║     ██║  ██║███████║███████║');
  console.log('  ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝');
  console.log('');
  console.log(`  Serveur démarré sur http://127.0.0.1:${PORT}`);
  console.log(`  Hôtel     : ${process.env.HOTEL_NAME || '(non configuré)'}`);
  console.log(`  Serrures  : ${process.env.LOCK_BRAND || '(non configuré)'} @ ${process.env.LOCK_IP || '?'}`);
  console.log('');
  console.log('  Ne pas fermer cette fenêtre.');
  console.log('');

  // Expirer les vieilles clés au démarrage
  try {
    const { KeysDB } = require('./db/database');
    const n = KeysDB.expireOld();
    if (n > 0) console.log(`  [Auto] ${n} clé(s) expirée(s)`);
  } catch {}
});

// ── Gestion propre de l'arrêt ─────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[KeyPass] Arrêt du serveur...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[KeyPass] Erreur non gérée :', err.message);
});
