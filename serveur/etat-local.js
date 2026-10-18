// serveur/etat-local.js
//
// Rôle    : les fichiers d'état local du serveur (DOSSIER_ETAT : data/etat en développement, ~/cadre/data/etat sur le
//           M900), écrits par le cadre sans passer par Home Assistant : drive.json, draps.json, tempo.json (dernière
//           couleur Tempo valide), enfants/ (journées et registre des points, serveur/enfants/stockage.js). Écriture
//           atomique, lecture plafonnée et validée, fichier abîmé mis de côté (jamais écrasé).
// Entrées : ecrireAtomique(dossier, nom, donnees, { tailleMax }) ; lireEtatLocal(dossier, nom, { valider, journal,
//           tailleMax }) : valider = fonction de compilerValidateur (source.js), qui lève sur une donnée non conforme ;
//           tailleMax en octets, facultatif (16 Ko par défaut, TAILLE_MAX_ETAT) ; mettreDeCote(dossier, nom, raison,
//           journal).
// Sorties : ecrireAtomique -> promesse ; lireEtatLocal -> promesse des données validées, ou null quand le fichier est
//           absent (premier démarrage) ou abîmé (trop gros, JSON illisible, non conforme : mis de côté, journalisé en
//           erreur) ; LÈVE sur une erreur d'accès (droits, trop de fichiers ouverts, disque) : rien n'est perdu, l'action
//           échoue et la lecture suivante réessaie ; mettreDeCote -> promesse du nouveau nom (ou null s'il n'a pas pu être
//           renommé) ; TAILLE_MAX_ETAT, SUFFIXE_ABIME.
// Pièges  :
//   - Écriture dans un fichier caché au nom unique (randomUUID) puis renommage : le fichier n'est jamais lu à moitié
//     écrit, et deux écritures simultanées ne se marchent pas dessus (le second renommage gagne, entier).
//   - Le dossier est créé à la première écriture (en Docker, data/etat est monté en écriture).
//   - Plafond vérifié AVANT la lecture (stat) et à l'écriture : un fichier gonflé ne remplit pas la mémoire du
//     conteneur, et le serveur n'écrit jamais plus qu'il ne relira.
//   - Fichier abîmé (une faute de frappe dans une correction à la main, un champ en trop) : renommé en
//     « <nom>.abime-AAAAMMJJ-HHMMSS » AVANT que le serveur reparte de zéro, sinon la première écriture qui suit
//     l'écraserait (les points de Timo perdus sans retour, alors qu'il ne perd jamais de points par punition : seuls un
//     échange, l'annulation d'un point libre ou le −1 d'un parent en retirent, serveur/enfants/registre.js). Pour le
//     récupérer : corriger le fichier mis de côté, arrêter le serveur, lui rendre son nom, redémarrer (README).
//   - Une erreur d'accès n'est PAS un fichier abîmé : le fichier est peut-être intact, on ne le renomme pas et on ne
//     repart pas de zéro (l'appelant échoue, le socle Source ou l'action suivante réessaie).

import { randomUUID } from 'node:crypto';
import {
  mkdir, readFile, rename, stat, writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

export const TAILLE_MAX_ETAT = 16 * 1024;
export const SUFFIXE_ABIME = '.abime-';

export async function ecrireAtomique(dossier, nom, donnees, { tailleMax = TAILLE_MAX_ETAT } = {}) {
  const texte = `${JSON.stringify(donnees)}\n`;
  if (Buffer.byteLength(texte) > tailleMax) throw new Error(`${nom} : plus de ${tailleMax} octets, pas écrit`);
  await mkdir(dossier, { recursive: true });
  const temporaire = join(dossier, `.${nom}.${randomUUID()}`);
  await writeFile(temporaire, texte);
  await rename(temporaire, join(dossier, nom));
}

// Horodatage UTC compact du nom mis de côté (20261014-073512) : deux mises de côté ne se recouvrent pas.
const horodatage = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export async function mettreDeCote(dossier, nom, raison, journal) {
  const nouveau = `${nom}${SUFFIXE_ABIME}${horodatage()}`;
  try {
    await rename(join(dossier, nom), join(dossier, nouveau));
    journal.error(`${nom} abîmé (${raison}) : mis de côté sous ${nouveau}, le serveur repart de zéro`);
    return nouveau;
  } catch (err) {
    journal.error(`${nom} abîmé (${raison}) et pas mis de côté (${err.code ?? err.message})`);
    throw err;
  }
}

export async function lireEtatLocal(dossier, nom, { valider, journal, tailleMax = TAILLE_MAX_ETAT }) {
  const chemin = join(dossier, nom);
  let texte;
  try {
    const { size } = await stat(chemin);
    if (size > tailleMax) {
      await mettreDeCote(dossier, nom, `${size} octets, plus de ${tailleMax}`, journal);
      return null;
    }
    texte = await readFile(chemin, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return valider(JSON.parse(texte));
  } catch (err) {
    await mettreDeCote(dossier, nom, err.message, journal);
    return null;
  }
}
