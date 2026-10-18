// serveur/empreinte.js
//
// Rôle    : l'empreinte du contenu servi à la page (DOSSIER_WEB), calculée une fois au démarrage : la page la reçoit dans
//           l'instantané du flux et se recharge d'elle-même quand une reconnexion en annonce une autre (nouveau
//           déploiement, web/src/rechargement.js) ; /api/sante la donne aussi, pour vérifier un déploiement.
// Entrées : empreinteDossier(dossier) : le dossier web (config.js : web/ en développement et dans l'image Docker).
// Sorties : 16 caractères hexadécimaux (début d'un SHA-256), ou null si le dossier n'existe pas (rien n'est servi).
// Pièges  :
//   - Chemins relatifs ET contenus entrent dans le calcul, fichiers triés par chemin : un fichier renommé, ajouté ou
//     retiré change l'empreinte, l'ordre de lecture du disque non.
//   - Calculée au démarrage seulement : en développement, un fichier modifié sans redémarrer le serveur ne change pas
//     l'empreinte (la page ne se recharge pas d'elle-même, comme avant). En production, chaque déploiement redémarre le
//     conteneur.
//   - Lecture synchrone avant l'écoute : quelques centaines de Ko (polices comprises), une fois.
//   - Elle ne dit rien de secret : la page qu'elle résume est publique.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LONGUEUR = 16;

export function empreinteDossier(dossier) {
  if (!existsSync(dossier)) return null;
  const hachage = createHash('sha256');
  const fichiers = readdirSync(dossier, { recursive: true })
    .map(String)
    .filter((relatif) => statSync(join(dossier, relatif)).isFile())
    .sort();
  for (const relatif of fichiers) {
    hachage.update(`${relatif}\0`);
    hachage.update(readFileSync(join(dossier, relatif)));
    hachage.update('\0');
  }
  return hachage.digest('hex').slice(0, LONGUEUR);
}
