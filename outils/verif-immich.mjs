#!/usr/bin/env node
// outils/verif-immich.mjs (npm run verif-immich)
//
// Rôle    : vérifier, en LECTURE SEULE, ce que le mode Photos demandera à Immich (conception §2.7, M4) : la version
//           installée (le filtre du lot demande la 3.2), puis, si la clé est configurée, un lot réel (nombre de photos,
//           portraits, exemples de légendes) et une photo revérifiée et lue jusqu'au bout. À relancer après la création de
//           la clé et après chaque mise à jour d'Immich.
// Entrées : les mêmes variables que le serveur (IMMICH_URL, IMMICH_CLE_FICHIER, IMMICH_SOURCE, IMMICH_ALBUM_ID ; .env
//           lu par npm run verif-immich).
// Sorties : un bilan à l'écran. Code de sortie : 0 si tout va (ou s'il n'y a pas encore de clé : seule la version est
//           lue) ; 1 si Immich est trop ancien, si le lot est vide ou si une photo ne se lit pas ; 2 si Immich est
//           injoignable ou refuse la clé, ou si la configuration est invalide.
// Pièges  :
//   - Passe par serveur/sources/immich.js : exactement les mêmes requêtes que le serveur (POST /api/search/random,
//     GET /api/assets/<id>, GET /api/assets/<id>/thumbnail), aucune écriture.
//   - La clé n'est jamais affichée ; les légendes affichées ne sont que ville et mois (jamais de coordonnées).

import { lireImmich } from '../serveur/config.js';
import { creerImmich, lireVersion } from '../serveur/sources/immich.js';

let reglages;
try {
  reglages = lireImmich();
} catch (err) {
  console.error(`Configuration invalide : ${err.message}`);
  process.exit(2);
}

let version;
try {
  version = await lireVersion(reglages.url);
} catch (err) {
  console.error(`Immich injoignable sur ${reglages.url} : ${err.message}`);
  process.exit(2);
}
const [majeure, mineure] = version.split('.').map(Number);
const assezRecent = majeure > 3 || (majeure === 3 && mineure >= 2);
console.log(`Immich ${version} sur ${reglages.url} : ${assezRecent ? 'ok' : 'TROP ANCIEN (le filtre du lot demande la 3.2)'}`);
if (!reglages.cle) {
  console.log(reglages.cleAbsente ? `Pas de clé : ${reglages.cheminCle} n'existe pas encore.` : 'Pas de clé : IMMICH_CLE_FICHIER est vide.');
  console.log('Le cadre masque l\'entrée Photos de son menu et ne demande rien à Immich.');
  process.exit(assezRecent ? 0 : 1);
}

const immich = creerImmich(reglages);
console.log(`Source : ${reglages.source.type}${reglages.source.albumId ? ` ${reglages.source.albumId}` : ''} (IMMICH_SOURCE)`);
let lot;
try {
  lot = await immich.lot();
} catch (err) {
  console.error(`Lot refusé : ${err.message}`);
  process.exit(2);
}
const portraits = lot.filter((photo) => photo.portrait).length;
console.log(`Lot : ${lot.length} photo(s), dont ${portraits} portrait(s) ; légendes : ${lot.slice(0, 3).map((photo) => photo.legende || '(aucune)').join(' ; ') || '(aucune)'}`);
if (lot.length === 0) {
  console.log('Lot vide : la source choisie (photothèque, favoris ou album) ne contient aucune photo visible pour cette clé.');
  process.exit(1);
}

try {
  const photo = await immich.photo(lot[0].id, new AbortController().signal);
  let octets = 0;
  for await (const morceau of photo.corps) octets += morceau.length;
  console.log(`Photo ${lot[0].id} : ${photo.type}, ${octets} octets, revérifiée puis lue en entier`);
} catch (err) {
  console.error(`Photo illisible : ${err.message}`);
  process.exit(1);
}
process.exit(assezRecent ? 0 : 1);
