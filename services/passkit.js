// services/passkit.js
// Compatible passkit-generator v3.5.7
// - Format carte bancaire (storeCard)
// - Sans QR code visible
// - Design personnalisable par hôtel
// - Différents designs selon type de chambre (standard / suite / presidentielle)

const { PKPass } = require('passkit-generator');
const path       = require('path');
const fs         = require('fs');
const QRCode     = require('qrcode');

const TEMPLATE_DIR = path.join(__dirname, '..', 'passes', 'templates.pass');
const OUTPUT_DIR   = path.join(__dirname, '..', 'passes', 'generated');
const DESIGNS_DIR  = path.join(__dirname, '..', 'passes', 'designs');




// ── Thèmes selon type de chambre ──────────────────────────────────────────────
const ROOM_THEMES = {
  standard: {
    backgroundColor: 'rgb(10, 10, 26)',
    foregroundColor: 'rgb(212, 175, 55)',
    labelColor:      'rgb(134, 134, 139)',
  },
  suite: {
    backgroundColor: 'rgb(20, 10, 5)',
    foregroundColor: 'rgb(240, 208, 96)',
    labelColor:      'rgb(180, 150, 80)',
  },
  presidentielle: {
    backgroundColor: 'rgb(5, 5, 5)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor:      'rgb(200, 200, 200)',
  },
};

// Détecte le type de chambre depuis le nom ou un champ explicite
function detectRoomType(roomType) {
  if (!roomType) return 'standard';
  const t = roomType.toLowerCase();
  if (t.includes('presiden') || t.includes('président')) return 'presidentielle';
  if (t.includes('suite')) return 'suite';
  return 'standard';
}

// ── Génère le .pkpass ─────────────────────────────────────────────────────────
async function generatePass({
  keyId,
  guestName,
  hotelName,
  hotelId,         // identifiant unique de l'hôtel pour charger son design
  roomNumber,
  roomType,        // 'standard' | 'suite' | 'presidentielle'
  checkin,
  checkout,
  zones,
  qrToken,
  passSerial,
}) {
  
  const theme    = ROOM_THEMES[detectRoomType(roomType)] || ROOM_THEMES.standard;
  const typeLabel = detectRoomType(roomType) === 'presidentielle' ? 'SUITE PRÉSIDENTIELLE'
                  : detectRoomType(roomType) === 'suite'          ? 'SUITE'
                  : 'CLÉ DIGITALE';

  // Lire les fichiers du template de base
  const templateFiles = {};
  const files = fs.readdirSync(TEMPLATE_DIR);
  for (const file of files) {
    const filePath = path.join(TEMPLATE_DIR, file);
    templateFiles[file] = fs.readFileSync(filePath);
  }

  // Charger l'image de fond personnalisée de l'hôtel si elle existe
  // L'hôtel peut uploader : strip.png (750x284px recommandé pour storeCard)
  // Depuis le dashboard → on sauvegarde dans passes/designs/{hotelId}/strip.png
  if (hotelId) {
    const hotelDesignDir = path.join(DESIGNS_DIR, hotelId);
    const stripPath      = path.join(hotelDesignDir, 'strip.png');
    const strip2xPath    = path.join(hotelDesignDir, 'strip@2x.png');
    const logoPath       = path.join(hotelDesignDir, 'logo.png');
    const logo2xPath     = path.join(hotelDesignDir, 'logo@2x.png');

    if (fs.existsSync(stripPath))   templateFiles['strip.png']    = fs.readFileSync(stripPath);
    if (fs.existsSync(strip2xPath)) templateFiles['strip@2x.png'] = fs.readFileSync(strip2xPath);
    if (fs.existsSync(logoPath))    templateFiles['logo.png']     = fs.readFileSync(logoPath);
    if (fs.existsSync(logo2xPath))  templateFiles['logo@2x.png']  = fs.readFileSync(logo2xPath);
  }

  // pass.json — format storeCard = carte bancaire horizontale, sans QR code
  const passJson = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
    teamIdentifier:     process.env.APPLE_TEAM_ID,
    serialNumber:       passSerial,
    description:        `${hotelName} — Chambre ${roomNumber}`,
    organizationName:   hotelName,

    // Couleurs selon type de chambre
    backgroundColor: theme.backgroundColor,
    foregroundColor: theme.foregroundColor,
    labelColor:      theme.labelColor,

    // Dates de validité
    expirationDate: new Date(checkout + 'T23:59:59').toISOString(),

    // ── storeCard = format carte bancaire ──────────────────────────────────────
    storeCard: {
      headerFields: [
        {
          key:   'room',
          label: 'CHAMBRE',
          value: roomNumber,
        }
      ],
      primaryFields: [
        {
          key:   'hotel',
          label: typeLabel,
          value: hotelName,
        }
      ],
      secondaryFields: [
        { key: 'checkin',  label: 'ARRIVÉE', value: formatDate(checkin)  },
        { key: 'checkout', label: 'DÉPART',  value: formatDate(checkout) },
      ],
      auxiliaryFields: [
        {
          key:   'guest',
          label: 'CLIENT',
          value: guestName,
        },
        ...(zones && zones.length > 0 ? [{
          key:   'zones',
          label: 'ACCÈS',
          value: zones.join(' · '),
        }] : []),
      ],
      // Dos de la carte — infos complètes
      backFields: [
        { key: 'hotel_phone',   label: 'Réception',       value: process.env.HOTEL_PHONE || '' },
        { key: 'support',       label: 'Support KeyPass', value: '07 68 79 27 36' },
        { key: 'key_id',        label: 'Référence clé',   value: keyId },
        { key: 'checkin_full',  label: 'Check-in',        value: checkin },
        { key: 'checkout_full', label: 'Check-out',       value: checkout },
        { key: 'nfc_info',      label: 'Ouverture',       value: 'Approchez votre iPhone de la serrure pour ouvrir votre chambre.' },
      ],
    },

    // Pas de barcodes — le token NFC est géré côté backend via le serial
    // Le qrToken est stocké dans le serial pour être récupéré par notre backend
    // quand le sticker NFC de la porte déclenche l'ouverture
  };

  // Écraser le pass.json dans les fichiers template
  templateFiles['pass.json'] = Buffer.from(JSON.stringify(passJson));

  const pass = new PKPass(templateFiles, {
    wwdr: Buffer.from(process.env.APPLE_WWDR_BASE64 || "", "base64"),
    signerCert: Buffer.from(process.env.APPLE_CERT_BASE64 || "", "base64"),
    signerKey: Buffer.from(process.env.APPLE_KEY_BASE64 || "", "base64"),
  });

  const buffer   = pass.getAsBuffer();
  const filePath = path.join(OUTPUT_DIR, `${passSerial}.pkpass`);
  fs.writeFileSync(filePath, buffer);

  return { filePath, buffer };
}

// ── Génère le QR code image pour l'email / affichage réception ───────────────
// (utilisé pour envoyer la carte au client, pas affiché sur la carte elle-même)
async function generateQRImage(qrToken) {
  const url = `${process.env.DASHBOARD_URL}/api/passes/download?token=${qrToken}`;
  const buffer = await QRCode.toBuffer(url, {
    errorCorrectionLevel: 'H',
    width:  400,
    margin: 2,
    color: { dark: '#1d1d1f', light: '#ffffff' },
  });
  return buffer;
}

// ── Sauvegarde le design d'un hôtel (appelé depuis le dashboard) ─────────────
function saveHotelDesign(hotelId, filename, imageBuffer) {
  const hotelDesignDir = path.join(DESIGNS_DIR, hotelId);
  
  fs.writeFileSync(path.join(hotelDesignDir, filename), imageBuffer);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function getPassPath(serial) {
  return path.join(OUTPUT_DIR, `${serial}.pkpass`);
}

module.exports = { generatePass, generateQRImage, saveHotelDesign, getPassPath };
