// services/mailer.js
// Envoie le QR code par email au client avec un template HTML propre

const nodemailer = require('nodemailer');

// ── Transporter SMTP ──────────────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

// ── Email principal : envoi du QR code ───────────────────────────────────────
async function sendKeyEmail({
  to,
  guestName,
  hotelName,
  roomNumber,
  checkin,
  checkout,
  zones,
  qrImageBuffer,  // Buffer PNG du QR code
  pkpassBuffer,   // Buffer .pkpass (pièce jointe cliquable)
}) {
  const transporter = createTransporter();
  const fromName    = process.env.SMTP_FROM_NAME || hotelName;
  const checkinFmt  = formatDate(checkin);
  const checkoutFmt = formatDate(checkout);
  const zonesText   = zones?.length ? zones.join(', ') : null;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Votre clé digitale</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#07071a;border-radius:16px 16px 0 0;padding:28px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
          Key<span style="color:#d4af37;">Pass</span>
        </td>
        <td align="right" style="font-size:11px;color:rgba(255,255,255,0.35);letter-spacing:1px;text-transform:uppercase;">
          Clé Digitale
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Hotel name banner -->
  <tr><td style="background:linear-gradient(135deg,#1a1a2e,#0f3460);padding:20px 32px;border-bottom:1px solid rgba(212,175,55,0.2);">
    <div style="font-size:11px;color:#d4af37;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Votre hébergement</div>
    <div style="font-size:20px;font-weight:700;color:#ffffff;">${hotelName}</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#ffffff;padding:32px;">

    <p style="margin:0 0 20px;font-size:16px;color:#1d1d1f;line-height:1.5;">
      Bonjour <strong>${guestName}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#86868b;line-height:1.6;">
      Votre clé digitale est prête. Scannez le QR code ci-dessous avec votre iPhone 
      pour l'ajouter dans Apple Wallet — puis approchez votre téléphone de la serrure 
      pour ouvrir votre chambre.
    </p>

    <!-- Reservation info -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;border-radius:12px;margin-bottom:28px;">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #e8e8ed;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:11px;color:#86868b;letter-spacing:1px;text-transform:uppercase;">Chambre</td>
              <td align="right" style="font-size:22px;font-weight:800;color:#d4af37;letter-spacing:2px;">${roomNumber}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid #e8e8ed;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:#86868b;">Arrivée</td>
              <td align="right" style="font-size:13px;font-weight:600;color:#1d1d1f;">${checkinFmt}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 20px;${zonesText ? 'border-bottom:1px solid #e8e8ed;' : ''}">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:#86868b;">Départ</td>
              <td align="right" style="font-size:13px;font-weight:600;color:#1d1d1f;">${checkoutFmt}</td>
            </tr>
          </table>
        </td>
      </tr>
      ${zonesText ? `
      <tr>
        <td style="padding:14px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:#86868b;">Accès inclus</td>
              <td align="right" style="font-size:13px;color:#1d1d1f;">${zonesText}</td>
            </tr>
          </table>
        </td>
      </tr>` : ''}
    </table>

    <!-- QR Code -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td align="center">
        <div style="display:inline-block;background:#ffffff;border:1px solid #e8e8ed;border-radius:16px;padding:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <img src="cid:qrcode" width="200" height="200" alt="QR Code" style="display:block;border-radius:4px;"/>
        </div>
        <p style="margin:12px 0 0;font-size:12px;color:#86868b;text-align:center;">
          Scannez avec l'appareil photo de votre iPhone
        </p>
      </td></tr>
    </table>

    <!-- Add to Wallet button (lien direct) -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr><td align="center">
        <a href="cid:pkpass" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:980px;font-size:14px;font-weight:600;letter-spacing:0.2px;">
          Ajouter à Apple Wallet
        </a>
      </td></tr>
    </table>

    <!-- Instructions -->
    <div style="background:#f5f5f7;border-radius:12px;padding:20px 22px;margin-bottom:8px;">
      <div style="font-size:12px;font-weight:600;color:#1d1d1f;margin-bottom:12px;letter-spacing:0.3px;">COMMENT ÇA MARCHE</div>
      ${['Scannez le QR code avec votre iPhone (appareil photo)',
         'Tapez "Ajouter" pour ajouter la clé dans Apple Wallet',
         'Approchez votre iPhone de la serrure pour ouvrir',
         'La clé expire automatiquement à votre check-out'].map((step, i) => `
      <div style="display:flex;align-items:flex-start;margin-bottom:${i < 3 ? '10px' : '0'};">
        <span style="background:#d4af37;color:#07071a;font-size:10px;font-weight:700;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:10px;margin-top:1px;">${i+1}</span>
        <span style="font-size:13px;color:#1d1d1f;line-height:1.4;">${step}</span>
      </div>`).join('')}
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#07071a;border-radius:0 0 16px 16px;padding:20px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:12px;color:rgba(255,255,255,0.3);line-height:1.6;">
          ${hotelName}<br>
          Cette clé est personnelle et ne peut pas être partagée.<br>
          <span style="color:#d4af37;">Propulsé par KeyPass</span>
        </td>
      </tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  await transporter.sendMail({
    from:    `"${fromName}" <${process.env.SMTP_USER}>`,
    to,
    subject: `Votre clé digitale — ${hotelName}, Chambre ${roomNumber}`,
    html,
    attachments: [
      // QR code inline dans le body
      {
        filename:    'qrcode.png',
        content:     qrImageBuffer,
        encoding:    'base64',
        cid:         'qrcode',
      },
      // Fichier .pkpass en pièce jointe (clic = ouverture directe dans Wallet)
      {
        filename:    'cle-hotel.pkpass',
        content:     pkpassBuffer,
        contentType: 'application/vnd.apple.pkpass',
        cid:         'pkpass',
      },
    ],
  });
}

// ── Test SMTP (depuis Paramètres) ─────────────────────────────────────────────
async function testSMTP() {
  try {
    const t = createTransporter();
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function formatDate(str) {
  return new Date(str).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
}

module.exports = { sendKeyEmail, testSMTP };
