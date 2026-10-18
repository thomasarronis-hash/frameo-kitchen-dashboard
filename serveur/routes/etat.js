// serveur/routes/etat.js
//
// Rôle    : le drapeau « Prêt pour le drive » : POST /api/drive-pret (bouton de l'écran Courses) le pose,
//           GET /api/etat le rend à outils/cadre.mjs etat, que /courses lit.
// Entrées : { dossierEtat } (config.js : data/etat, local au serveur).
// Sorties : POST /api/drive-pret -> 200 { pret_le } (heure ISO 8601 en UTC), écrit <dossierEtat>/drive.json ;
//           GET /api/etat -> 200 { drive_pret_le } (null si jamais posé ou fichier illisible), 403 avec la clé du cadre.
// Pièges  :
//   - GET /api/etat est réservé à la clé du Clevo ; POST /api/drive-pret accepte les deux clés.
//   - Écriture atomique (serveur/etat-local.js : fichier caché au nom unique puis renommage) : drive.json n'est
//     jamais lu à moitié écrit, et deux appuis simultanés (cadre et Clevo) ne se marchent pas dessus. Le dossier est
//     créé au premier appui (en Docker, data/etat est monté en écriture).
//   - Limite dédiée de 10 par minute et par IP : un bouton, pas une rafale.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ecrireAtomique } from '../etat-local.js';
import { limiteDediee, reserverAuClevo } from '../securite.js';

const FICHIER = 'drive.json';
const APPUIS_PAR_MINUTE = 10;

async function lireDrivePret(dossierEtat, journal) {
  try {
    const { pret_le: pretLe } = JSON.parse(await readFile(join(dossierEtat, FICHIER), 'utf8'));
    if (typeof pretLe === 'string' && !Number.isNaN(Date.parse(pretLe))) return pretLe;
    journal.warn(`${FICHIER} sans date valide : drapeau ignoré`);
  } catch (err) {
    if (err.code !== 'ENOENT') journal.warn(`${FICHIER} illisible, drapeau ignoré (${err.message})`);
  }
  return null;
}

export default async function routesEtat(app, { dossierEtat }) {
  app.post('/drive-pret', { onRequest: limiteDediee(app, APPUIS_PAR_MINUTE) }, async (requete, reponse) => {
    const pretLe = new Date().toISOString();
    await ecrireAtomique(dossierEtat, FICHIER, { pret_le: pretLe });
    requete.log.info(`prêt pour le drive, signalé par ${requete.appareil}`);
    reponse.header('cache-control', 'no-store');
    return { pret_le: pretLe };
  });

  app.get('/etat', { onRequest: reserverAuClevo }, async (requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    return { drive_pret_le: await lireDrivePret(dossierEtat, requete.log) };
  });
}
