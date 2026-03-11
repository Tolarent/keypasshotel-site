// routes/setup.js
// Routes pour la configuration initiale : scan réseau, connexion, import chambres

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

const { scanNetwork, testConnection } = require('../services/scanner');
const { importRooms }  = require('../services/locks');
const { ConfigDB, RoomsDB } = require('../db/database');
const { testSMTP }    = require('../services/mailer');

// ── GET /api/setup/status — état de la configuration ─────────────────────────
router.get('/status', (req, res) => {
  const config = ConfigDB.getAll();
  res.json({
    ok:             true,
    configured:     !!process.env.LOCK_IP,
    hotelName:      process.env.HOTEL_NAME,
    lockBrand:      process.env.LOCK_BRAND,
    lockIp:         process.env.LOCK_IP,
    roomCount:      RoomsDB.count(),
    appleConfigured: !!(process.env.APPLE_PASS_TYPE_ID && process.env.APPLE_TEAM_ID),
    smtpConfigured:  !!(process.env.SMTP_USER && process.env.SMTP_PASSWORD),
  });
});

// ── POST /api/setup/scan — lance le scan réseau ───────────────────────────────
// Utilisé par le wizard de configuration pour détecter les contrôleurs
router.post('/scan', async (req, res) => {
  try {
    // SSE (Server-Sent Events) pour streamer la progression en temps réel
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    send({ type: 'start', message: 'Scan du réseau démarré' });

    const controllers = await scanNetwork((progress) => {
      send({ type: 'progress', progress });
    });

    send({ type: 'done', controllers });
    res.end();
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/setup/connect — teste et sauvegarde la connexion ────────────────
router.post('/connect', async (req, res) => {
  try {
    const { brand, ip, port, user, password, hotelName } = req.body;

    // Tester la connexion avant de sauvegarder
    const test = await testConnection(brand, ip, parseInt(port), user, password);
    if (!test.ok) {
      return res.status(400).json({ ok: false, error: `Connexion échouée : ${test.error}` });
    }

    // Écrire dans config.env
    updateEnvFile({
      HOTEL_NAME:        hotelName || '',
      LOCK_BRAND:        brand,
      LOCK_IP:           ip,
      LOCK_PORT:         String(port),
      LOCK_API_USER:     user,
      LOCK_API_PASSWORD: password,
    });

    // Recharger les variables d'environnement
    require('dotenv').config({ path: './config.env', override: true });

    res.json({ ok: true, message: 'Connexion établie et configuration sauvegardée' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/setup/import-rooms — importe les chambres depuis le contrôleur ──
router.post('/import-rooms', async (req, res) => {
  try {
    const { count, rooms } = await importRooms();
    ConfigDB.set('rooms_imported_at', new Date().toISOString());
    res.json({ ok: true, count, rooms });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/setup/rooms — liste les chambres importées ──────────────────────
router.get('/rooms', (req, res) => {
  try {
    const rooms = RoomsDB.getAll();
    res.json({ ok: true, rooms, count: rooms.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/setup/test-lock — test de connexion live (depuis Paramètres) ───
router.post('/test-lock', async (req, res) => {
  try {
    const { testConnection: testLock } = require('../services/locks');
    const result = await testLock();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/setup/test-smtp — test email (depuis Paramètres) ───────────────
router.post('/test-smtp', async (req, res) => {
  try {
    const result = await testSMTP();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
// Met à jour le fichier config.env sans écraser les autres variables
function updateEnvFile(updates) {
  const envPath = path.join(__dirname, '..', 'config.env');
  let content   = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  for (const [key, value] of Object.entries(updates)) {
    const escaped = value.replace(/\n/g, '\\n');
    const line    = `${key}=${escaped}`;
    const regex   = new RegExp(`^${key}=.*$`, 'm');

    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content += `\n${line}`;
    }
  }

  fs.writeFileSync(envPath, content);
}

module.exports = router;
