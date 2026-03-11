// routes/keys.js
// Toutes les routes liées aux clés : création, révocation, téléchargement du pass

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');

const { KeysDB, RoomsDB, LogDB } = require('../db/database');
const { generatePass, generateQRImage, getPassPath } = require('../services/passkit');
const { sendKeyEmail } = require('../services/mailer');
const { grantAccess, revokeAccess } = require('../services/locks');

// ── GET /api/keys — toutes les clés ──────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    // Expirer automatiquement les vieilles clés au passage
    const expired = KeysDB.expireOld();
    if (expired > 0) console.log(`[KeyPass] ${expired} clé(s) expirée(s) automatiquement`);

    const keys = KeysDB.getAll().map(k => ({
      ...k,
      zones: JSON.parse(k.zones || '[]'),
    }));
    res.json({ ok: true, keys });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/keys/active — clés actives seulement ────────────────────────────
router.get('/active', (req, res) => {
  try {
    const keys = KeysDB.getActive().map(k => ({
      ...k,
      zones: JSON.parse(k.zones || '[]'),
    }));
    res.json({ ok: true, keys, count: keys.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/keys — créer une nouvelle clé ───────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { guest_name, guest_email, room_id, checkin, checkout, zones = [] } = req.body;

    // Validation
    if (!guest_name || !room_id || !checkin || !checkout) {
      return res.status(400).json({ ok: false, error: 'Champs requis manquants' });
    }

    // Vérifier que la chambre existe
    const rooms = RoomsDB.getAll();
    const room  = rooms.find(r => r.id === room_id);
    if (!room) {
      return res.status(400).json({ ok: false, error: `Chambre ${room_id} introuvable` });
    }

    // Générer les identifiants uniques
    const keyId      = `kp_${uuidv4().slice(0, 8)}`;
    const passSerial = uuidv4();
    const qrToken    = uuidv4().replace(/-/g, ''); // token opaque, pas de données en clair

    // Sauvegarder en base
    const key = KeysDB.create({
      id:          keyId,
      guest_name,
      guest_email:  guest_email || null,
      room_id,
      zones:        JSON.stringify(zones),
      checkin,
      checkout,
      pass_serial:  passSerial,
      qr_token:     qrToken,
    });

    LogDB.add(keyId, 'key_created', room_id, { guest_name, room_id, checkin, checkout });

    // Générer le QR code image (toujours)
    const qrImage = await generateQRImage(qrToken);

    // Générer le .pkpass Apple Wallet
    let pkpassBuffer = null;
    let passGenerated = false;
    try {
      const hotelName = process.env.HOTEL_NAME || 'Hôtel';
      const { buffer } = await generatePass({
        keyId,
        guestName: guest_name,
        hotelName,
        roomNumber: room_id,
        checkin,
        checkout,
        zones,
        qrToken,
        passSerial,
      });
      pkpassBuffer  = buffer;
      passGenerated = true;
    } catch (passErr) {
      // Les certificats Apple ne sont peut-être pas encore configurés
      // On continue quand même — le QR code fonctionne sans le .pkpass
      console.warn('[KeyPass] .pkpass non généré :', passErr.message);
    }

    // Donner l'accès dans le contrôleur de serrures
    let lockGranted = false;
    try {
      await grantAccess({
        keyId,
        lockId:      room.lock_id,
        accessToken: qrToken,
        checkin,
        checkout,
      });
      lockGranted = true;
    } catch (lockErr) {
      console.warn('[KeyPass] Accès serrure non accordé :', lockErr.message);
    }

    // Envoyer l'email si adresse fournie
    let emailSent = false;
    if (guest_email && pkpassBuffer) {
      try {
        await sendKeyEmail({
          to:            guest_email,
          guestName:     guest_name,
          hotelName:     process.env.HOTEL_NAME || 'Hôtel',
          roomNumber:    room_id,
          checkin,
          checkout,
          zones,
          qrImageBuffer: qrImage,
          pkpassBuffer,
        });
        KeysDB.markEmailSent(keyId);
        emailSent = true;
      } catch (mailErr) {
        console.warn('[KeyPass] Email non envoyé :', mailErr.message);
      }
    }

    res.json({
      ok: true,
      key: { ...key, zones },
      qrImageBase64: qrImage.toString('base64'),
      passGenerated,
      lockGranted,
      emailSent,
    });

  } catch (err) {
    console.error('[KeyPass] Erreur création clé :', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /api/keys/:id — révoquer une clé ───────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const key = KeysDB.getById(req.params.id);
    if (!key) return res.status(404).json({ ok: false, error: 'Clé introuvable' });
    if (key.status !== 'active') {
      return res.status(400).json({ ok: false, error: 'Cette clé est déjà inactive' });
    }

    // Révoquer dans le contrôleur de serrures
    try {
      const room = RoomsDB.getAll().find(r => r.id === key.room_id);
      if (room) {
        await revokeAccess({
          keyId:       key.id,
          lockId:      room.lock_id,
          accessToken: key.qr_token,
        });
      }
    } catch (lockErr) {
      console.warn('[KeyPass] Révocation serrure échouée :', lockErr.message);
    }

    const updated = KeysDB.revoke(key.id);
    LogDB.add(key.id, 'key_revoked', key.room_id);

    res.json({ ok: true, key: { ...updated, zones: JSON.parse(updated.zones || '[]') } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/passes/download — le client clique sur le lien du QR code ────────
// C'est cette route que l'iPhone appelle quand le client scanne le QR
router.get('/passes/download', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token manquant');

    const key = KeysDB.getByQrToken(token);
    if (!key) return res.status(404).send('Clé introuvable ou expirée');
    if (key.status !== 'active') return res.status(410).send('Cette clé a été révoquée ou est expirée');

    // Vérifier que la date est dans la plage valide
    const now      = new Date();
    const checkin  = new Date(key.checkin);
    const checkout = new Date(key.checkout + 'T23:59:59');
    if (now < checkin || now > checkout) {
      return res.status(410).send('Clé hors période de validité');
    }

    const passPath = getPassPath(key.pass_serial);
    if (!require('fs').existsSync(passPath)) {
      return res.status(404).send('Fichier pass introuvable — contactez la réception');
    }

    LogDB.add(key.id, 'pass_downloaded', key.room_id);

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="cle-chambre-${key.room_id}.pkpass"`);
    res.sendFile(passPath);
  } catch (err) {
    res.status(500).send('Erreur serveur');
  }
});

module.exports = router;
