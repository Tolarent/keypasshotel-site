# KeyPass — Backend

Serveur Node.js qui tourne localement sur le PC de réception de l'hôtel.

## Structure

```
keypass-backend/
├── server.js                  ← point d'entrée
├── config.env                 ← configuration (rempli par le wizard)
├── start-keypass.bat          ← lancement manuel Windows
├── services/
│   ├── scanner.js             ← détection automatique réseau
│   ├── locks.js               ← communication contrôleurs serrures
│   ├── passkit.js             ← génération fichiers .pkpass Apple Wallet
│   └── mailer.js              ← envoi emails avec QR code
├── routes/
│   ├── keys.js                ← CRUD clés + téléchargement pass
│   └── setup.js               ← configuration initiale
├── db/
│   └── database.js            ← SQLite local
├── scripts/
│   └── install-service.js     ← service Windows
├── passes/
│   ├── templates/             ← template .pkpass (logo, icônes)
│   └── generated/             ← fichiers .pkpass générés
└── certs/                     ← certificats Apple (à fournir)
```

## Installation

```bash
npm install
```

## Lancement dev

```bash
npm run dev
```

## Lancement production (Windows)

Double-cliquer sur `start-keypass.bat`

Ou installer en service Windows (démarrage automatique) :
```bash
npm run install-service
```

## Configuration Apple Wallet

1. Créer un compte Apple Developer (99$/an) sur developer.apple.com
2. Créer un "Pass Type ID" : `pass.hotel.keypass.[nom-hotel]`
3. Télécharger le certificat et le convertir en .pem :
   ```bash
   openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out certs/pass-cert.pem
   openssl pkcs12 -in Certificates.p12 -nocerts -nodes -out certs/pass-key.pem
   ```
4. Télécharger le certificat WWDR d'Apple :
   https://www.apple.com/certificateauthority/
5. Remplir `config.env` avec APPLE_PASS_TYPE_ID et APPLE_TEAM_ID

## API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /api/health | Statut du serveur |
| GET | /api/stats | Stats dashboard |
| GET | /api/keys | Toutes les clés |
| GET | /api/keys/active | Clés actives |
| POST | /api/keys | Créer une clé |
| DELETE | /api/keys/:id | Révoquer une clé |
| GET | /api/passes/download?token=... | Télécharger le .pkpass |
| POST | /api/setup/scan | Scanner le réseau |
| POST | /api/setup/connect | Configurer le contrôleur |
| POST | /api/setup/import-rooms | Importer les chambres |
| POST | /api/setup/test-lock | Tester la connexion |
| POST | /api/setup/test-smtp | Tester l'email |

## Support

07 68 79 27 36 — contact@keypass.hotel
