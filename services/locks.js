// services/locks.js
// Couche d'abstraction pour tous les contrôleurs de serrures
// Ajouter un nouveau contrôleur = créer un adapter dans ADAPTERS

const axios  = require('axios');
const { ConfigDB, RoomsDB, LogDB } = require('../db/database');

// ── Chaque adapter traduit les appels KeyPass vers l'API du contrôleur ────────

const ADAPTERS = {

  // ── ASSA ABLOY VingCard (VOSTIO API) ────────────────────────────────────────
  assa_abloy: {
    async authenticate(ip, port, user, password) {
      const res = await api(ip, port).post('/api/v1/auth', { username: user, password });
      return res.data.token;
    },

    async getRooms(ip, port, token) {
      const res = await api(ip, port, token).get('/api/v1/units');
      return res.data.units.map(u => ({
        id:      u.unitName,
        floor:   parseInt(u.unitName[0]) || 1,
        type:    u.unitType || 'Standard',
        lock_id: u.unitId,
      }));
    },

    async grantAccess(ip, port, token, lockId, accessToken, validFrom, validTo) {
      await api(ip, port, token).post('/api/v1/access/grant', {
        unitId:     lockId,
        token:      accessToken,
        validFrom,
        validTo,
        accessType: 'NFC_WALLET',
      });
    },

    async revokeAccess(ip, port, token, lockId, accessToken) {
      await api(ip, port, token).post('/api/v1/access/revoke', {
        unitId: lockId,
        token:  accessToken,
      });
    },
  },

  // ── Dormakaba (EXOS API) ─────────────────────────────────────────────────────
  dormakaba: {
    async authenticate(ip, port, user, password) {
      const res = await api(ip, port).post('/exos/api/v1/auth', { login: user, password });
      return res.data.access_token;
    },

    async getRooms(ip, port, token) {
      const res = await api(ip, port, token).get('/exos/api/v1/doors');
      return res.data.doors.map(d => ({
        id:      d.doorName,
        floor:   parseInt(d.doorName[0]) || 1,
        type:    d.doorCategory || 'Standard',
        lock_id: d.doorId,
      }));
    },

    async grantAccess(ip, port, token, lockId, accessToken, validFrom, validTo) {
      await api(ip, port, token).post('/exos/api/v1/credentials', {
        doorId:     lockId,
        credential: accessToken,
        startDate:  validFrom,
        endDate:    validTo,
        type:       'MOBILE_NFC',
      });
    },

    async revokeAccess(ip, port, token, lockId, accessToken) {
      await api(ip, port, token).delete(`/exos/api/v1/credentials/${accessToken}`, {
        data: { doorId: lockId },
      });
    },
  },

  // ── Salto Systems (KS API) ───────────────────────────────────────────────────
  salto: {
    async authenticate(ip, port, user, password) {
      const res = await api(ip, port).post('/salto/api/v1/login', { user, password });
      return res.data.sessionToken;
    },

    async getRooms(ip, port, token) {
      const res = await api(ip, port, token).get('/salto/api/v1/outputs');
      return res.data.outputs
        .filter(o => o.outputType === 'DOOR')
        .map(o => ({
          id:      o.name,
          floor:   parseInt(o.name[0]) || 1,
          type:    o.zoneId ? 'Zone' : 'Standard',
          lock_id: o.outputId,
        }));
    },

    async grantAccess(ip, port, token, lockId, accessToken, validFrom, validTo) {
      await api(ip, port, token).post('/salto/api/v1/keys', {
        outputId:   lockId,
        keyData:    accessToken,
        startValidity: validFrom,
        endValidity:   validTo,
        keyType:    'BLE_WALLET',
      });
    },

    async revokeAccess(ip, port, token, lockId, accessToken) {
      await api(ip, port, token).post('/salto/api/v1/keys/cancel', {
        outputId: lockId,
        keyData:  accessToken,
      });
    },
  },
};

// ── Axios helper avec auth token ──────────────────────────────────────────────
function api(ip, port, token = null) {
  const protocol = port === 443 || port === 8443 ? 'https' : 'http';
  const headers  = token ? { Authorization: `Bearer ${token}` } : {};
  return axios.create({
    baseURL: `${protocol}://${ip}:${port}`,
    timeout: 8000,
    headers,
    validateStatus: (s) => s < 500,
  });
}

// ── Cache du token d'authentification (valide en général 1h) ─────────────────
let _cachedToken  = null;
let _tokenExpiry  = 0;

async function getToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const brand    = process.env.LOCK_BRAND;
  const ip       = process.env.LOCK_IP;
  const port     = parseInt(process.env.LOCK_PORT);
  const user     = process.env.LOCK_API_USER;
  const password = process.env.LOCK_API_PASSWORD;

  const adapter = ADAPTERS[brand];
  if (!adapter) throw new Error(`Contrôleur inconnu : ${brand}`);

  _cachedToken = await adapter.authenticate(ip, port, user, password);
  _tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 minutes
  return _cachedToken;
}

// ── API publique de locks.js ──────────────────────────────────────────────────

// Importe toutes les chambres depuis le contrôleur
async function importRooms() {
  const brand   = process.env.LOCK_BRAND;
  const ip      = process.env.LOCK_IP;
  const port    = parseInt(process.env.LOCK_PORT);
  const token   = await getToken();
  const adapter = ADAPTERS[brand];

  const rooms = await adapter.getRooms(ip, port, token);
  const count = RoomsDB.upsert(rooms);
  return { count, rooms };
}

// Donne l'accès à une chambre (appelé à la création d'une clé)
async function grantAccess({ keyId, lockId, accessToken, checkin, checkout }) {
  const brand   = process.env.LOCK_BRAND;
  const ip      = process.env.LOCK_IP;
  const port    = parseInt(process.env.LOCK_PORT);
  const token   = await getToken();
  const adapter = ADAPTERS[brand];

  try {
    await adapter.grantAccess(ip, port, token, lockId, accessToken,
      new Date(checkin).toISOString(),
      new Date(checkout + 'T23:59:59').toISOString()
    );
    LogDB.add(keyId, 'access_granted', null, { lockId });
    return { ok: true };
  } catch (err) {
    LogDB.add(keyId, 'access_grant_failed', null, { error: err.message });
    throw err;
  }
}

// Révoque l'accès (instantané)
async function revokeAccess({ keyId, lockId, accessToken }) {
  const brand   = process.env.LOCK_BRAND;
  const ip      = process.env.LOCK_IP;
  const port    = parseInt(process.env.LOCK_PORT);
  const token   = await getToken();
  const adapter = ADAPTERS[brand];

  try {
    await adapter.revokeAccess(ip, port, token, lockId, accessToken);
    LogDB.add(keyId, 'access_revoked', null, { lockId });
    return { ok: true };
  } catch (err) {
    LogDB.add(keyId, 'revoke_failed', null, { error: err.message });
    throw err;
  }
}

// Test de connexion (depuis l'écran Paramètres)
async function testConnection() {
  try {
    await getToken();
    const rooms = RoomsDB.getAll();
    return { ok: true, roomCount: rooms.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { importRooms, grantAccess, revokeAccess, testConnection };
