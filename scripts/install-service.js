// scripts/install-service.js
// Enregistre KeyPass comme service Windows — démarre automatiquement au boot
// À exécuter une seule fois lors de l'installation : node scripts/install-service.js

const path = require('path');

try {
  const Service = require('node-windows').Service;

  const svc = new Service({
    name:        'KeyPass',
    description: 'KeyPass — Système de clés digitales hôtelières',
    script:      path.join(__dirname, '..', 'server.js'),
    nodeOptions:  [],
    env: [{
      name:  'NODE_ENV',
      value: 'production',
    }],
  });

  svc.on('install', () => {
    svc.start();
    console.log('✅ Service KeyPass installé et démarré.');
    console.log('   Il se relancera automatiquement à chaque démarrage de Windows.');
    console.log('   Pour le désinstaller : node scripts/uninstall-service.js');
  });

  svc.on('alreadyinstalled', () => {
    console.log('ℹ️  Le service KeyPass est déjà installé.');
  });

  svc.on('error', (err) => {
    console.error('❌ Erreur lors de l\'installation :', err);
    console.log('\nAlternative : lancer start-keypass.bat manuellement à chaque démarrage.');
  });

  svc.install();

} catch (err) {
  // node-windows non disponible (ex: sur macOS/Linux)
  console.log('ℹ️  node-windows non disponible sur cette plateforme.');
  console.log('   Sur macOS : utiliser launchd ou PM2.');
  console.log('   Sur Linux  : utiliser systemd.');
  console.log('\n   Exemple PM2 (multiplateforme) :');
  console.log('   npm install -g pm2');
  console.log('   pm2 start server.js --name keypass');
  console.log('   pm2 startup && pm2 save');
}
