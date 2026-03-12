const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendKeyEmail({ to, guestName, hotelName, roomNumber, checkin, checkout, zones, qrImageBuffer }) {
  const zonesText = zones.length > 0 ? `<p>Accès : ${zones.join(', ')}</p>` : '';
  
  const { data, error } = await resend.emails.send({
    from: 'KeyPass <contact@keypasshotel.com>',
    to,
    subject: `Votre clé digitale — Chambre ${roomNumber}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #b8860b;">Bienvenue, ${guestName} !</h2>
        <p>Votre clé digitale pour <strong>${hotelName}</strong> est prête.</p>
        <p><strong>Chambre :</strong> ${roomNumber}</p>
        <p><strong>Arrivée :</strong> ${checkin}</p>
        <p><strong>Départ :</strong> ${checkout}</p>
        ${zonesText}
        <p>Scannez le QR code ci-joint pour ajouter votre clé à Apple Wallet.</p>
        <hr>
        <p style="color: #999; font-size: 12px;">KeyPass — La clé de votre chambre dans votre poche</p>
      </div>
    `,
    attachments: qrImageBuffer ? [{
      filename: 'cle-acces.png',
      content: qrImageBuffer.toString('base64'),
    }] : [],
  });

  if (error) throw new Error(error.message);
  return data;
}

module.exports = { sendKeyEmail };
