#!/usr/bin/env node
// outils/cadre.mjs
//
// Rôle    : l'outil du Clevo pour le cadre cuisine, appelé par /menu et /courses (Claude Code) ou à la main :
//           vérifier et publier le menu de la semaine, lister les menus publiés, lire l'état (drapeau « Prêt pour
//           le drive » et liste de courses partagée), cocher des articles après confirmation.
// Entrées : node outils/cadre.mjs <commande> [arguments] :
//             verifier <fichier.json>   valide le menu (partage/valider-menu.js, le même validateur que le serveur) ;
//             publier <fichier.json>    valide, puis envoie le menu sous le nom <cycle.debut>.json ;
//             liste                     menus publiés (sur le M900 par rsync --list-only, ou CADRE_DEST_LOCAL) ;
//             etat                      GET /api/etat et GET /api/courses, en JSON sur la sortie standard ;
//             cocher <uid>...           pour chaque article, demande « o » sur l'entrée standard, puis POST
//                                       /api/action/courses_cocher.
//           Variables : CADRE_DEST_LOCAL (dossier où publier et lister à la place du M900 : tests, développement),
//           CADRE_URL (défaut http://192.168.1.187:8020), CADRE_CLE_FICHIER (défaut ~/.config/cadre/cle, sinon la
//           clé de développement ~/.config/cadre/cle_clevo_dev).
// Sorties : texte en français (etat : JSON). Codes de sortie : 0 réussi, 1 menu invalide ou erreur, 2 impossible
//           en l'état (clé SSH absente, clé du Clevo introuvable, usage).
// Pièges  :
//   - publier et liste passent par rsync et la clé dédiée ~/.ssh/cadre_menus, bridée côté M900 par rrsync
//     (-no-del, dossier cadre/data/menus). Tant que cette clé n'existe pas (création avec l'accord de Thomas,
//     conception §6.3), la commande affiche ce qu'elle lancerait et s'arrête (code 2) sans rien envoyer.
//   - rsync ne reçoit JAMAIS le nom de fichier donné en argument : publier écrit le texte DÉJÀ VALIDÉ dans un
//     fichier ordinaire d'un dossier privé (mkdtemp, 700) et passe son chemin absolu après « -- ». Un nom qui
//     commence par « - » (« --rsh=... ») ne devient donc pas une option, le fichier ne peut pas changer entre la
//     validation et l'envoi, et un lien symbolique (que rsync sauterait en rendant 0) n'existe pas. Le dossier
//     privé est supprimé ensuite, envoi réussi ou non. rsync est lancé sans shell (arguments en tableau).
//   - ssh avec BatchMode=yes, sans agent (IdentityAgent=none) et sans ~/.ssh/config (-F /dev/null) : une clé
//     refusée par le M900 (ligne rrsync pas encore posée, ou retirée pour révoquer, §6.0) échoue net, sans
//     fenêtre de mot de passe (SSH_ASKPASS de KDE) qui donnerait à rsync tous les droits du compte. La clé du
//     M900 doit déjà être dans ~/.ssh/known_hosts (sinon refus, sans question). La clé cadre_menus ne doit pas
//     avoir de phrase de passe (rien ne peut la demander).
//   - Le nom publié vient du menu (cycle.debut), jamais du fichier local : une republication remplace la
//     précédente. rsync et la copie locale écrivent un fichier caché puis le renomment : le serveur ne lit
//     jamais un menu à moitié écrit (il ignore les fichiers qui commencent par un point).
//   - liste sur le M900 : rrsync -no-del laisse lire le dossier (il n'interdit que la suppression) ; la sortie de
//     rsync --list-only est affichée telle quelle (noms, tailles, dates), sans revalider les menus.
//   - cocher : toute réponse autre que « o » ou « oui », et la fin de l'entrée standard (Claude Code sans
//     terminal), vaut NON. Rien n'est coché sans un « o » tapé pour CET article. Le texte de l'article (venu de
//     HA, donc d'un iPhone) est affiché avec ses caractères invisibles écrits en clair (\u202e...) : une inversion
//     bidi ne peut pas maquiller ce qu'on confirme.
//   - La clé n'est jamais affichée ni passée en argument : seulement dans l'en-tête X-Cadre-Cle.

import { spawn } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { rendreVisible } from '../partage/caracteres-invisibles.js';
import { validerMenu } from '../partage/valider-menu.js';

const URL_PAR_DEFAUT = 'http://192.168.1.187:8020';
const DESTINATION_M900 = 'thomas@192.168.1.187:';
const DELAI_REQUETE_MS = 10_000;
const USAGE = `usage : node outils/cadre.mjs <commande>
  verifier <fichier.json>   valide le menu de la semaine
  publier <fichier.json>    valide puis publie (M900, ou CADRE_DEST_LOCAL=<dossier>)
  liste                     menus publiés (M900, ou CADRE_DEST_LOCAL=<dossier>)
  etat                      drapeau « Prêt pour le drive » et liste de courses (JSON)
  cocher <uid>...           coche des articles, avec confirmation pour chacun`;

class ErreurOutil extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const citer = (argument) => (/^[\w@%+=:,./-]+$/.test(argument) ? argument : `'${argument.replace(/'/g, "'\\''")}'`);

function lireMenu(fichier) {
  if (!fichier) throw new ErreurOutil(`fichier du menu manquant\n${USAGE}`, 2);
  let texte;
  try {
    texte = readFileSync(fichier, 'utf8');
  } catch (err) {
    throw new ErreurOutil(`${fichier} illisible (${err.code || err.message})`);
  }
  try {
    return { menu: JSON.parse(texte), texte };
  } catch (err) {
    throw new ErreurOutil(`${fichier} : JSON invalide (${err.message})`);
  }
}

function exigerValide(fichier) {
  const lu = lireMenu(fichier);
  const { valide, erreurs } = validerMenu(lu.menu);
  if (!valide) throw new ErreurOutil(`menu invalide : ${fichier}\n${erreurs.map((erreur) => `  - ${erreur}`).join('\n')}`);
  return lu;
}

function resume(menu) {
  const recettes = menu.repas.filter((repas) => repas.recette !== null).length;
  return `menu du ${menu.cycle.debut} au ${menu.cycle.fin}, statut ${menu.statut}, ${recettes} recette(s) sur 9, mis à jour le ${menu.maj_le}`;
}

function executer([programme, ...args]) {
  return new Promise((resoudre, rejeter) => {
    const enfant = spawn(programme, args, { stdio: 'inherit' });
    enfant.on('error', (err) => rejeter(new ErreurOutil(`${programme} introuvable ou impossible à lancer (${err.code || err.message})`)));
    enfant.on('close', resoudre);
  });
}

const cleSsh = () => join(homedir(), '.ssh', 'cadre_menus');
const commandeRsync = (cle, args) => [
  'rsync', '-e', `ssh -F /dev/null -i ${cle} -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes`, ...args,
];

// Tant que la clé dédiée n'existe pas : refus (code 2), avec la commande qui serait lancée, sans rien lancer.
function exigerCleSsh(cle, quoi, commande) {
  if (existsSync(cle)) return;
  throw new ErreurOutil([
    `${quoi} impossible : la clé ${cle} n'existe pas encore. Rien n'a été lancé.`,
    'Elle se crée avec l\'accord de Thomas, avec la ligne rrsync dans ~/.ssh/authorized_keys du M900 (conception §6.3).',
    `Commande qui serait lancée : ${commande.map(citer).join(' ')}`,
  ].join('\n'), 2);
}

function verifier([fichier]) {
  const { menu } = exigerValide(fichier);
  console.log(`valide : ${resume(menu)}`);
}

async function publier([fichier]) {
  const { menu, texte } = exigerValide(fichier);
  const nom = `${menu.cycle.debut}.json`;
  const dossierLocal = process.env.CADRE_DEST_LOCAL;
  if (dossierLocal) {
    mkdirSync(dossierLocal, { recursive: true });
    const temporaire = join(dossierLocal, `.${nom}.${process.pid}`);
    writeFileSync(temporaire, texte);
    chmodSync(temporaire, 0o644);
    renameSync(temporaire, join(dossierLocal, nom));
    console.log(`publié en local : ${join(dossierLocal, nom)} (${resume(menu)})`);
    return;
  }
  const cle = cleSsh();
  const argsRsync = (source) => ['--chmod=F644', '--', source, `${DESTINATION_M900}${nom}`];
  exigerCleSsh(cle, 'publication vers le M900', commandeRsync(cle, argsRsync(join(tmpdir(), 'cadre-publier-XXXXXX', nom))));
  const dossierPrive = mkdtempSync(join(tmpdir(), 'cadre-publier-'));
  try {
    const copieValidee = join(dossierPrive, nom);
    writeFileSync(copieValidee, texte, { mode: 0o600 });
    const code = await executer(commandeRsync(cle, argsRsync(copieValidee)));
    if (code !== 0) throw new ErreurOutil(`rsync a échoué (code ${code}) : menu non publié`);
  } finally {
    rmSync(dossierPrive, { recursive: true, force: true });
  }
  console.log(`publié sur le M900 : ${nom} (${resume(menu)})`);
}

async function liste() {
  const dossierLocal = process.env.CADRE_DEST_LOCAL;
  if (!dossierLocal) {
    const cle = cleSsh();
    const commande = commandeRsync(cle, ['--list-only', '--', DESTINATION_M900]);
    exigerCleSsh(cle, 'liste du M900', commande);
    const code = await executer(commande);
    if (code !== 0) throw new ErreurOutil(`rsync a échoué (code ${code}) : liste du M900 non lue`);
    return;
  }
  const noms = existsSync(dossierLocal)
    ? readdirSync(dossierLocal).filter((nom) => nom.endsWith('.json') && !nom.startsWith('.')).sort()
    : [];
  if (noms.length === 0) console.log(`aucun menu publié dans ${dossierLocal}`);
  for (const nom of noms) {
    try {
      const { menu } = lireMenu(join(dossierLocal, nom));
      const { valide, erreurs } = validerMenu(menu);
      console.log(valide ? `${nom} : ${resume(menu)}` : `${nom} : INVALIDE, ignoré par le serveur (${erreurs.length} erreur(s))`);
    } catch (err) {
      console.log(`${nom} : ILLISIBLE, ignoré par le serveur (${err.message})`);
    }
  }
}

function lireCle() {
  const maison = join(homedir(), '.config', 'cadre');
  const candidats = process.env.CADRE_CLE_FICHIER ? [process.env.CADRE_CLE_FICHIER] : [join(maison, 'cle'), join(maison, 'cle_clevo_dev')];
  const chemin = candidats.find((candidat) => existsSync(candidat));
  if (!chemin) throw new ErreurOutil(`clé du Clevo introuvable (${candidats.join(', ')})`, 2);
  const cle = readFileSync(chemin, 'utf8').trim();
  if (cle === '') throw new ErreurOutil(`clé du Clevo vide : ${chemin}`, 2);
  return cle;
}

async function appeler(methode, chemin, cle, corps) {
  const base = (process.env.CADRE_URL || URL_PAR_DEFAUT).replace(/\/+$/, '');
  let reponse;
  try {
    reponse = await fetch(`${base}${chemin}`, {
      method: methode,
      headers: { 'x-cadre-cle': cle, ...(corps ? { 'content-type': 'application/json' } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(DELAI_REQUETE_MS),
    });
  } catch (err) {
    throw new ErreurOutil(`serveur du cadre injoignable (${base}) : ${(err.cause && err.cause.code) || err.message}`);
  }
  const donnees = await reponse.json().catch(() => null);
  if (reponse.ok) return donnees;
  const raisons = { 401: 'clé refusée', 403: 'cette clé n\'est pas celle du Clevo' };
  throw new ErreurOutil(`${methode} ${chemin} : HTTP ${reponse.status}, ${raisons[reponse.status] || (donnees && donnees.message) || 'erreur'}`);
}

async function etat() {
  const cle = lireCle();
  const [etatServeur, courses] = await Promise.all([appeler('GET', '/api/etat', cle), appeler('GET', '/api/courses', cle)]);
  console.log(JSON.stringify({ drive_pret_le: etatServeur.drive_pret_le, articles: courses.articles }, null, 2));
}

async function cocher(uids) {
  if (uids.length === 0) throw new ErreurOutil(`aucun uid à cocher\n${USAGE}`, 2);
  const cle = lireCle();
  const { articles } = await appeler('GET', '/api/courses', cle);
  const lecteur = createInterface({ input: process.stdin, terminal: false });
  const reponses = lecteur[Symbol.asyncIterator]();
  let coches = 0;
  try {
    for (const uid of uids) {
      const article = articles.find((candidat) => candidat.uid === uid);
      if (!article) {
        console.log(`${rendreVisible(uid)} : absent de la liste, ignoré`);
        continue;
      }
      const nom = rendreVisible(article.summary);
      if (article.status === 'completed') {
        console.log(`« ${nom} » (${uid}) : déjà coché`);
        continue;
      }
      process.stdout.write(`Cocher « ${nom} » (${uid}) ? [o/N] `);
      const { value, done } = await reponses.next();
      const reponse = done ? '' : value.trim().toLowerCase();
      if (reponse !== 'o' && reponse !== 'oui') {
        console.log(done ? '\n  non coché (aucune réponse)' : '  non coché');
        continue;
      }
      const { simulation } = await appeler('POST', '/api/action/courses_cocher', cle, { uid, fait: true });
      coches += 1;
      console.log(simulation ? '  coché (simulation : le serveur n\'écrit pas dans Home Assistant)' : '  coché');
    }
  } finally {
    lecteur.close();
  }
  console.log(`${coches} article(s) coché(s) sur ${uids.length} demandé(s)`);
}

const COMMANDES = { verifier, publier, liste, etat, cocher };
const [commande, ...args] = process.argv.slice(2);
try {
  if (!commande || !Object.hasOwn(COMMANDES, commande)) throw new ErreurOutil(USAGE, 2);
  await COMMANDES[commande](args);
} catch (err) {
  if (!(err instanceof ErreurOutil)) throw err;
  console.error(err.message);
  process.exitCode = err.code;
}
