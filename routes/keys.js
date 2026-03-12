const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { dbHelper } = require('../db/database');
const { generatePass, generateQRImage } = require('../services/passkit');
const { sendKeyEmail } = require('../services/mailer');
const { grantAccess, revokeAccess } = require('../services/locks');

router.get('/', async (req, res) => {
  try {
    await dbHelper.run("UPDATE keys SET active=0 WHERE active=1 AND checkOut < date('now')");
    const keys = await dbHelper.all("SELECT * FROM keys ORDER BY createdAt DESC");
    res.json({ ok: true, keys: keys.map(k => ({ ...k, zones: JSON.parse(k.zones || '[]') })) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/active', async (req, res) => {
  try {
    const keys = await dbHelper.all("SELECT * FROM keys WHERE active=1 ORDER BY createdAt DESC");
    res.json({ ok: true, keys: keys.map(k => ({ ...k, zones: JSON.parse(k.zones || '[]') })), count: keys.length });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { guest_name, guest_email, room_id, checkin, checkout, zones = [] } = req.body;
    if (!guest_name || !room_id || !checkin || !checkout) {
      return res.status(400).json({ ok: false, error: 'Champs requis manquants' });
    }
    const room = await dbHelper.get("SELECT * FROM rooms WHERE number=?", [room_id]);
    const keyId = "kp_" + uuidv4().slice(0, 8);
    const passSerial = uuidv4();
    const qrToken = uuidv4().replace(/-/g, '');
    const passUrl = (process.env.BASE_URL || 'https://keypasshotel.com') + '/api/keys/passes/download?token=' + qrToken;
    await dbHelper.run("INSERT INTO keys (token,hotelName,roomNumber,guestName,checkIn,checkOut,zones,passUrl,active) VALUES (?,?,?,?,?,?,?,?,1)",
      [qrToken, process.env.HOTEL_NAME || 'Hotel', room_id, guest_name, checkin, checkout, JSON.stringify(zones), passUrl]);
    const qrImage = await generateQRImage(qrToken);
    let pkpassBuffer = null, passGenerated = false;
    try {
      const { buffer } = await generatePass({ keyId, guestName: guest_name, hotelName: process.env.HOTEL_NAME || 'Hotel', roomNumber: room_id, checkin, checkout, zones, qrToken, passSerial });
      pkpassBuffer = buffer; passGenerated = true;
    } catch (e) { console.warn('[KeyPass] pkpass:', e.message); }
    let lockGranted = false;
    try { await grantAccess({ keyId, lockId: room?.lock_id, accessToken: qrToken, checkin, checkout }); lockGranted = true; } catch(e) { console.warn('[KeyPass] Email erreur:', e.message); }
    let emailSent = false;
    if (guest_email) {
      try { await sendKeyEmail({ to: guest_email, guestName: guest_name, hotelName: process.env.HOTEL_NAME || 'Hotel', roomNumber: room_id, checkin, checkout, zones, qrImageBuffer: qrImage, pkpassBuffer }); emailSent = true; } catch(e) { console.warn('[KeyPass] Email erreur:', e.message); }
    }
    res.json({ ok: true, key: { keyId, guest_name, room_id, checkin, checkout, zones, passUrl }, qrImageBase64: qrImage.toString('base64'), passGenerated, lockGranted, emailSent });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: err.message }); }
});

router.delete('/:token', async (req, res) => {
  try {
    const key = await dbHelper.get("SELECT * FROM keys WHERE token=?", [req.params.token]);
    if (!key) return res.status(404).json({ ok: false, error: 'Clé introuvable' });
    await dbHelper.run("UPDATE keys SET active=0 WHERE token=?", [req.params.token]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/passes/download', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token manquant');
    const key = await dbHelper.get("SELECT * FROM keys WHERE token=? AND active=1", [token]);
    if (!key) return res.status(404).send('Clé introuvable ou expirée');
    res.status(200).json({ ok: true, room: key.roomNumber, guest: key.guestName, checkin: key.checkIn, checkout: key.checkOut });
  } catch (err) { res.status(500).send('Erreur serveur'); }
});

module.exports = router;
