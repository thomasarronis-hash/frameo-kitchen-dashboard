// outils/apercu.mjs
//
// Rôle    : voir le vrai tableau de bord du M900 dans un navigateur du Clevo, sans copier de clé dans le
//           navigateur. Relais local : chaque requête reçue sur 127.0.0.1 est transmise au serveur du M900
//           avec l'en-tête X-Cadre-Cle de la clé du Clevo.
// Entrées : CADRE_URL (défaut http://192.168.1.187:8020), CADRE_CLE_FICHIER (défaut ~/.config/cadre/cle),
//           PORT_APERCU (défaut 8021).
// Sorties : http://127.0.0.1:8021 ; Ctrl+C pour arrêter.
// Pièges  :
//   - N'écoute que sur 127.0.0.1 : la clé ne sort pas du Clevo, mais tout programme local peut passer
//     par le relais tant qu'il tourne. Ne le laisse pas tourner pour rien.
//   - Les actions passent pour de vrai : avec ACTIONS_REELLES=1 sur le M900, cocher une course ici la coche
//     dans Home Assistant.
//   - Le flux SSE est relayé sans tampon (pipe) pour que les mises à jour arrivent en direct.

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';

const cible = new URL(process.env.CADRE_URL || 'http://192.168.1.187:8020');
const fichierCle = (process.env.CADRE_CLE_FICHIER || '~/.config/cadre/cle').replace(/^~\//, `${homedir()}/`);
const port = Number(process.env.PORT_APERCU || 8021);
const cle = readFileSync(fichierCle, 'utf8').trim();

// En-têtes du navigateur à ne pas transmettre : l'hôte (remplacé), et tout ce qui porterait une autre clé.
const RETIRES = new Set(['host', 'cookie', 'x-cadre-cle', 'origin', 'referer', 'connection']);

const serveur = http.createServer((requete, reponse) => {
  const entetes = {};
  for (const [nom, valeur] of Object.entries(requete.headers)) {
    if (!RETIRES.has(nom)) entetes[nom] = valeur;
  }
  entetes['x-cadre-cle'] = cle;
  const sortante = http.request(
    { hostname: cible.hostname, port: cible.port, path: requete.url, method: requete.method, headers: entetes },
    (amont) => {
      reponse.writeHead(amont.statusCode, amont.headers);
      amont.pipe(reponse);
    },
  );
  sortante.on('error', (err) => {
    if (!reponse.headersSent) reponse.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    reponse.end(`Serveur du M900 injoignable : ${err.message}\n`);
  });
  // « close » de la réponse, pas de la requête : celle-ci se ferme dès son corps lu, ce qui couperait le flux SSE.
  reponse.on('close', () => sortante.destroy());
  requete.pipe(sortante);
});

serveur.listen(port, '127.0.0.1', () => {
  console.log(`Aperçu du tableau de bord : http://127.0.0.1:${port} (relais vers ${cible.origin}, Ctrl+C pour arrêter)`);
});
