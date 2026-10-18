// serveur/routes/wifi.js
//
// Rôle    : GET /api/wifi-invites, le Wi-Fi invités à montrer sur l'écran Maison (QR code, nom et mot de passe).
// Entrées : { fichier } (WIFI_INVITES_FICHIER de config.js, null par défaut), lu par serveur/sources/wifi-invites.js.
// Sorties : 200 { configure: true, ssid, mot_de_passe, chaine_qr } ; 200 { configure: false } sans fichier ;
//           200 { configure: false, probleme } si le fichier est invalide (la raison, jamais son contenu).
// Pièges  :
//   - Clé du cadre OU du Clevo (contexte privé de app.js), Cache-Control no-store : le mot de passe n'est jamais
//     dans le flux SSE (qui part à chaque connexion), seulement dans cette réponse, demandée quand on touche
//     « Afficher » ; la page l'efface au bout de 2 min.
//   - Toujours 200 : un Wi-Fi invités pas encore configuré est un état normal, que l'écran explique.
//   - Le journal de la requête ne contient que l'URL : jamais le mot de passe.

import { lireWifiInvites } from '../sources/wifi-invites.js';

export default async function routesWifi(app, { fichier }) {
  app.get('/wifi-invites', async (requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    return lireWifiInvites(fichier, requete.log);
  });
}
