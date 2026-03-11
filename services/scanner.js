// services/scanner.js
// Scan le réseau local pour détecter automatiquement les contrôleurs de serrures
// L'hôtelier n'a jamais besoin de connaître l'adresse IP

const axios = require('axios');
const os    = require('os');

// ── Fingerprints des contrôleurs connus ───────────────────────────────────────
// Pour chaque marque : les ports à tester et comment identifier la réponse
const CONTROLLER_FINGERPRINTS = [
  {
    brand:    'assa_abloy',
    label:    'ASSA ABLOY VingCard',
    ports:    [8080, 8443, 443],
    paths:    ['/api/v1/info', '/vostio/api/info', '/api/info'],
    identify: (data) => {
      const s = JSON.stringify(data).toLowerCase();
      return s.includes('vingcard') || s.includes('vostio') || s.includes('assa');
    },
  },
  {
    brand:    'dormakaba',
    label:    'Dormakaba',
    ports:    [4433, 8080, 443],
    paths:    ['/api/v1/system', '/exos/api/info', '/api/info'],
    identify: (data) => {
      const s = JSON.stringify(data).toLowerCase();
      return s.includes('dormakaba') || s.includes('exos') || s.includes('saflok');
    },
  },
  {
    brand:    'salto',
    label:    'Salto Systems',
    ports:    [8080, 4430, 443],
    paths:    ['/api/v1/version', '/salto/api/info', '/api/info'],
    identify: (data) => {
      const s = JSON.stringify(data).toLowerCase();
      return s.includes('salto') || s.includes('ks4') || s.includes('saltoks');
    },
  },
];

// ── Récupère le sous-réseau local ─────────────────────────────────────────────
function getLocalSubnet() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4, non-loopback
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}`;
      }
    }
  }
  return '192.168.1'; // fallback
}

// ── Teste une IP précise sur un port et un path ───────────────────────────────
async function probeHost(ip, port, path, timeout = 1500) {
  try {
    const protocol = port === 443 || port === 8443 ? 'https' : 'http';
    const res = await axios.get(`${protocol}://${ip}:${port}${path}`, {
      timeout,
      validateStatus: () => true, // on accepte tous les codes HTTP
      // En prod : ajouter httpsAgent pour ignorer les certs auto-signés
    });
    return { ok: true, status: res.status, data: res.data };
  } catch {
    return { ok: false };
  }
}

// ── Calcule un score de confiance ─────────────────────────────────────────────
function confidenceScore(brand, data, responseTime) {
  let score = 60; // base si le port répond
  if (brand.identify(data)) score += 35;
  if (responseTime < 200)   score += 5;
  return Math.min(score, 99);
}

// ── Scan principal ────────────────────────────────────────────────────────────
// Retourne une liste de contrôleurs détectés, triée par confiance
async function scanNetwork(onProgress = null) {
  const subnet = getLocalSubnet();
  const found  = [];

  // On commence par les IPs les plus courantes pour les équipements réseau
  const priorityHosts = [
    `${subnet}.1`, `${subnet}.100`, `${subnet}.101`,
    `${subnet}.200`, `${subnet}.254`, `${subnet}.10`,
    `${subnet}.50`,  `${subnet}.150`,
  ];

  // Puis on scanne le reste du sous-réseau par batch de 20
  const allHosts = [...priorityHosts];
  for (let i = 2; i <= 253; i++) {
    const ip = `${subnet}.${i}`;
    if (!allHosts.includes(ip)) allHosts.push(ip);
  }

  let scanned = 0;

  // Scan par batch parallèle
  const BATCH_SIZE = 20;
  for (let i = 0; i < allHosts.length; i += BATCH_SIZE) {
    const batch = allHosts.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (ip) => {
      for (const fingerprint of CONTROLLER_FINGERPRINTS) {
        for (const port of fingerprint.ports) {
          for (const path of fingerprint.paths) {
            const t0  = Date.now();
            const res = await probeHost(ip, port, path);

            if (res.ok) {
              const responseTime = Date.now() - t0;
              const confidence   = confidenceScore(fingerprint, res.data, responseTime);

              // Éviter les doublons (même IP détectée par plusieurs fingerprints)
              const existing = found.find(f => f.ip === ip);
              if (!existing || confidence > existing.confidence) {
                if (existing) {
                  Object.assign(existing, { brand: fingerprint.brand, label: fingerprint.label, port, confidence });
                } else {
                  found.push({
                    brand:      fingerprint.brand,
                    label:      fingerprint.label,
                    ip,
                    port,
                    protocol:   port === 443 || port === 8443 ? 'https' : 'http',
                    confidence,
                    responseTime,
                  });
                }
              }
              return; // on a trouvé ce qu'on cherchait pour cette IP
            }
          }
        }
      }
    }));

    scanned += batch.length;
    if (onProgress) {
      onProgress(Math.round((scanned / allHosts.length) * 100));
    }

    // Si on a déjà trouvé quelque chose avec haute confiance, on peut s'arrêter tôt
    if (found.some(f => f.confidence > 90) && scanned > 50) break;
  }

  // Trier par confiance décroissante
  return found.sort((a, b) => b.confidence - a.confidence);
}

// ── Test de connexion avec credentials ───────────────────────────────────────
async function testConnection(brand, ip, port, user, password) {
  const endpoints = {
    assa_abloy: { path: '/api/v1/auth', method: 'post', body: { username: user, password } },
    dormakaba:  { path: '/api/v1/auth', method: 'post', body: { login: user, password } },
    salto:      { path: '/salto/api/v1/login', method: 'post', body: { user, password } },
  };

  const ep       = endpoints[brand] || endpoints.assa_abloy;
  const protocol = port === 443 || port === 8443 ? 'https' : 'http';

  try {
    const res = await axios[ep.method](
      `${protocol}://${ip}:${port}${ep.path}`,
      ep.body,
      { timeout: 5000, validateStatus: () => true }
    );

    if (res.status === 200 || res.status === 201) {
      return { ok: true, token: res.data?.token || res.data?.access_token || null };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { scanNetwork, testConnection, getLocalSubnet };
