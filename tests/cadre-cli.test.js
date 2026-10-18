// tests/cadre-cli.test.js
//
// Rôle    : prouver outils/cadre.mjs de bout en bout, en le lançant comme le feront /menu et /courses :
//           verifier (menu du 10/10 accepté, 3 menus cassés refusés), publier vers un dossier local
//           (CADRE_DEST_LOCAL : nom tiré du cycle, droits 644, fichier caché puis renommé), refus clair et sans
//           envoi quand la clé SSH ~/.ssh/cadre_menus n'existe pas ; avec un FAUX rsync : options ssh sans repli
//           sur un mot de passe, copie validée passée après « -- » (un fichier nommé « --rsh=... » n'injecte
//           rien), dossier privé supprimé, échec de rsync rendu ; liste locale et distante ; etat et cocher contre
//           un vrai serveur de test (simulation, clé du Clevo), confirmation exigée pour chaque article, texte
//           de l'article affiché avec ses caractères invisibles en clair.
// Entrées : tests/fixtures/menu-2026-10-10.json et tests/fixtures/menus-casses/ ; une maison temporaire
//           (HOME, et TMPDIR dedans) par test dans os.tmpdir() ; l'application montée par tests/aides.js.
// Sorties : node --test.
// Pièges  :
//   - L'outil tourne dans un processus enfant avec un environnement VIDE (HOME temporaire, PATH vide) : il ne
//     voit ni ~/.ssh ni ~/.config/cadre de Thomas, et même s'il tentait rsync ou ssh, il ne les trouverait
//     pas. Aucun test ne peut donc joindre le M900.
//   - Les tests du faux rsync mettent dans PATH un seul dossier, qui ne contient que ce faux rsync (un script
//     Node qui note ses arguments et lit la source, sans rien envoyer) ; la « clé » ~/.ssh/cadre_menus est un
//     fichier factice de la maison temporaire.
//   - Le serveur de test tourne dans CE processus : l'enfant est lancé de façon asynchrone (spawn), sinon
//     un appel bloquant figerait le serveur qu'il interroge.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SourceCourses } from '../serveur/ha/courses.js';
import { CLE, CLE_CLEVO, monter } from './aides.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(RACINE, 'outils', 'cadre.mjs');
const FIXTURE = join(RACINE, 'tests', 'fixtures', 'menu-2026-10-10.json');
const CASSES = join(RACINE, 'tests', 'fixtures', 'menus-casses');

function maisonTemporaire(t) {
  const maison = mkdtempSync(join(tmpdir(), 'cadre-cli-'));
  mkdirSync(join(maison, 'tmp'));
  t.after(() => rmSync(maison, { recursive: true, force: true }));
  return maison;
}

// Faux rsync (seul programme du PATH) et fausse clé ssh : le faux note ses arguments dans <maison>/rsync.json et,
// pour la source qui suit « -- », son contenu et sa nature (fichier ordinaire ou non) ; il sort avec FAUX_RSYNC_CODE.
function preparerFauxRsync(maison) {
  const bin = join(maison, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'rsync'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const i = args.indexOf('--');
const source = i === -1 ? null : args[i + 1];
const lue = source && !source.includes(':') ? { chemin: source, contenu: fs.readFileSync(source, 'utf8'), ordinaire: fs.lstatSync(source).isFile() } : null;
fs.writeFileSync(process.env.HOME + '/rsync.json', JSON.stringify({ args, lue }));
process.exit(Number(process.env.FAUX_RSYNC_CODE || 0));
`);
  chmodSync(join(bin, 'rsync'), 0o755);
  mkdirSync(join(maison, '.ssh'));
  writeFileSync(join(maison, '.ssh', 'cadre_menus'), 'fausse clé de test\n', { mode: 0o600 });
  return { PATH: bin };
}

const SSH_ATTENDU = (maison) => `ssh -F /dev/null -i ${maison}/.ssh/cadre_menus -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes`;

function lancer(maison, args, { env = {}, entree = '' } = {}) {
  return new Promise((resoudre, rejeter) => {
    const enfant = spawn(process.execPath, [CLI, ...args], { cwd: maison, env: { HOME: maison, PATH: '', TMPDIR: join(maison, 'tmp'), ...env } });
    let sortie = '';
    let erreurs = '';
    enfant.stdout.on('data', (morceau) => { sortie += morceau; });
    enfant.stderr.on('data', (morceau) => { erreurs += morceau; });
    enfant.on('error', rejeter);
    enfant.on('close', (code) => resoudre({ code, sortie, erreurs }));
    enfant.stdin.end(entree);
  });
}

test('verifier : le menu du 10/10 est valide (code 0)', async (t) => {
  const { code, sortie } = await lancer(maisonTemporaire(t), ['verifier', FIXTURE]);
  assert.equal(code, 0);
  assert.equal(sortie, 'valide : menu du 2026-10-10 au 2026-10-16, statut commande, 9 recette(s) sur 9, mis à jour le 2026-10-09T18:34:00+02:00\n');
});

test('verifier : les 3 menus cassés sont refusés (code 1) avec leur motif', async (t) => {
  const maison = maisonTemporaire(t);
  const cas = [
    ['creneau-manquant.json', /créneau manquant, mardi 13\/10 soir/],
    ['gamelles-mal-placees.json', /samedi 10\/10 soir \(2026-10-10-soir\) : gamelles interdites/],
    ['duree-max-trop-courte.json', /duree_max_s \(1800\) inférieure à duree_s \(2100\)/],
  ];
  for (const [nom, motif] of cas) {
    const { code, sortie, erreurs } = await lancer(maison, ['verifier', join(CASSES, nom)]);
    assert.equal(code, 1, nom);
    assert.equal(sortie, '', nom);
    assert.match(erreurs, /^menu invalide : /, nom);
    assert.match(erreurs, motif, nom);
  }
});

test('verifier : fichier absent, JSON invalide, argument manquant', async (t) => {
  const maison = maisonTemporaire(t);
  writeFileSync(join(maison, 'faux.json'), '{ pas du JSON');
  assert.match((await lancer(maison, ['verifier', join(maison, 'absent.json')])).erreurs, /absent\.json illisible \(ENOENT\)/);
  assert.match((await lancer(maison, ['verifier', join(maison, 'faux.json')])).erreurs, /faux\.json : JSON invalide/);
  const sansFichier = await lancer(maison, ['verifier']);
  assert.equal(sansFichier.code, 2);
  assert.match(sansFichier.erreurs, /fichier du menu manquant/);
  assert.equal((await lancer(maison, ['inconnue'])).code, 2);
});

test('publier en local (CADRE_DEST_LOCAL) : nommé d\'après le cycle, contenu identique, droits 644, sans fichier caché restant', async (t) => {
  const maison = maisonTemporaire(t);
  const destination = join(maison, 'data', 'menus');
  const { code, sortie } = await lancer(maison, ['publier', FIXTURE], { env: { CADRE_DEST_LOCAL: destination } });
  assert.equal(code, 0);
  assert.match(sortie, /^publié en local : .*\/data\/menus\/2026-10-10\.json \(menu du 2026-10-10 au 2026-10-16/);
  assert.deepEqual(readdirSync(destination), ['2026-10-10.json']);
  assert.equal(readFileSync(join(destination, '2026-10-10.json'), 'utf8'), readFileSync(FIXTURE, 'utf8'));
  assert.equal(statSync(join(destination, '2026-10-10.json')).mode & 0o777, 0o644);

  const liste = await lancer(maison, ['liste'], { env: { CADRE_DEST_LOCAL: destination } });
  assert.equal(liste.code, 0);
  assert.match(liste.sortie, /^2026-10-10\.json : menu du 2026-10-10 au 2026-10-16, statut commande/);
});

test('publier : un menu invalide n\'est jamais publié', async (t) => {
  const maison = maisonTemporaire(t);
  const destination = join(maison, 'menus');
  const { code, erreurs } = await lancer(maison, ['publier', join(CASSES, 'gamelles-mal-placees.json')], { env: { CADRE_DEST_LOCAL: destination } });
  assert.equal(code, 1);
  assert.match(erreurs, /gamelles interdites/);
  assert.equal(existsSync(destination), false);
});

test('publier vers le M900 sans la clé ~/.ssh/cadre_menus : refus clair (code 2), commande affichée, rien d\'envoyé', async (t) => {
  const maison = maisonTemporaire(t);
  const { code, sortie, erreurs } = await lancer(maison, ['publier', FIXTURE]);
  assert.equal(code, 2);
  assert.equal(sortie, '');
  assert.match(erreurs, new RegExp(`^publication vers le M900 impossible : la clé ${maison}/\\.ssh/cadre_menus n'existe pas encore\\. Rien n'a été lancé\\.`));
  assert.match(erreurs, /accord de Thomas/);
  assert.ok(erreurs.includes(`Commande qui serait lancée : rsync -e '${SSH_ATTENDU(maison)}' --chmod=F644 -- ${maison}/tmp/cadre-publier-XXXXXX/2026-10-10.json thomas@192.168.1.187:2026-10-10.json`), erreurs);
  assert.deepEqual(readdirSync(join(maison, 'tmp')), [], 'aucun dossier privé créé');
});

test('publier vers le M900 : la copie VALIDÉE part après « -- », jamais le nom donné ; ssh sans repli sur un mot de passe', async (t) => {
  const maison = maisonTemporaire(t);
  const env = preparerFauxRsync(maison);
  const piege = "--rsh=sh -c 'id -un > preuve-injection' x";
  copyFileSync(FIXTURE, join(maison, piege));
  const { code, sortie, erreurs } = await lancer(maison, ['publier', piege], { env });
  assert.equal(code, 0, erreurs);
  assert.match(sortie, /^publié sur le M900 : 2026-10-10\.json \(menu du 2026-10-10 au 2026-10-16/);
  const { args, lue } = JSON.parse(readFileSync(join(maison, 'rsync.json'), 'utf8'));
  assert.deepEqual(args.slice(0, 4), ['-e', SSH_ATTENDU(maison), '--chmod=F644', '--']);
  assert.match(args[4], new RegExp(`^${maison}/tmp/cadre-publier-[^/]+/2026-10-10\\.json$`), 'source = copie dans le dossier privé');
  assert.equal(args[5], 'thomas@192.168.1.187:2026-10-10.json');
  assert.equal(args.length, 6);
  assert.ok(!args.some((arg) => arg.includes('rsh') || arg.includes('preuve')), 'le nom piégé n\'arrive jamais à rsync');
  assert.deepEqual(lue, { chemin: args[4], contenu: readFileSync(FIXTURE, 'utf8'), ordinaire: true });
  assert.equal(existsSync(join(maison, 'preuve-injection')), false);
  assert.deepEqual(readdirSync(join(maison, 'tmp')), [], 'dossier privé supprimé après l\'envoi');
});

test('publier vers le M900 : un lien symbolique est publié par sa copie validée ; un échec de rsync est rendu (code 1)', async (t) => {
  const maison = maisonTemporaire(t);
  const env = preparerFauxRsync(maison);
  symlinkSync(FIXTURE, join(maison, 'lien.json'));
  let resultat = await lancer(maison, ['publier', 'lien.json'], { env });
  assert.equal(resultat.code, 0, resultat.erreurs);
  assert.equal(JSON.parse(readFileSync(join(maison, 'rsync.json'), 'utf8')).lue.ordinaire, true);

  resultat = await lancer(maison, ['publier', 'lien.json'], { env: { ...env, FAUX_RSYNC_CODE: '23' } });
  assert.equal(resultat.code, 1);
  assert.equal(resultat.sortie, '');
  assert.match(resultat.erreurs, /^rsync a échoué \(code 23\) : menu non publié/);
  assert.deepEqual(readdirSync(join(maison, 'tmp')), [], 'dossier privé supprimé même après un échec');
});

test('liste sans CADRE_DEST_LOCAL : refus clair sans la clé (code 2) ; avec elle, rsync --list-only sur le dossier du M900', async (t) => {
  const sansCle = maisonTemporaire(t);
  const refus = await lancer(sansCle, ['liste']);
  assert.equal(refus.code, 2);
  assert.match(refus.erreurs, /^liste du M900 impossible : la clé .*cadre_menus n'existe pas encore/);

  const maison = maisonTemporaire(t);
  const { code, erreurs } = await lancer(maison, ['liste'], { env: preparerFauxRsync(maison) });
  assert.equal(code, 0, erreurs);
  assert.deepEqual(JSON.parse(readFileSync(join(maison, 'rsync.json'), 'utf8')).args, ['-e', SSH_ATTENDU(maison), '--list-only', '--', 'thomas@192.168.1.187:']);
});

// Serveur en simulation ; la liste vient d'une fausse lecture de HA (todo.get_items), lue une fois au départ.
const ITEMS_DE_TEST = [
  { uid: 'u1', summary: 'lait', status: 'needs_action' },
  { uid: 'u2', summary: 'crème fraîche', status: 'needs_action' },
  { uid: 'u3', summary: 'pain', status: 'completed' },
];

async function serveurDeTest(t, items = ITEMS_DE_TEST) {
  const connexion = Object.assign(new EventEmitter(), { etat: 'ok', lire: async () => ({ items: structuredClone(items) }) });
  const courses = new SourceCourses(connexion, new EventEmitter(), { warn() {} });
  await courses.actualiser();
  const etat = mkdtempSync(join(tmpdir(), 'cadre-cli-etat-'));
  t.after(() => rmSync(etat, { recursive: true, force: true }));
  const { app } = await monter({ sources: { courses }, dossierEtat: etat });
  t.after(() => app.close());
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, adresse, courses };
}

function ecrireCle(maison, nom, valeur) {
  mkdirSync(join(maison, '.config', 'cadre'), { recursive: true });
  writeFileSync(join(maison, '.config', 'cadre', nom), valeur, { mode: 0o600 });
}

test('etat : drapeau et liste de courses en JSON, avec la clé de développement du Clevo', async (t) => {
  const { app, adresse } = await serveurDeTest(t);
  const maison = maisonTemporaire(t);
  ecrireCle(maison, 'cle_clevo_dev', CLE_CLEVO);
  let resultat = await lancer(maison, ['etat'], { env: { CADRE_URL: adresse } });
  assert.equal(resultat.code, 0, resultat.erreurs);
  const lu = JSON.parse(resultat.sortie);
  assert.equal(lu.drive_pret_le, null);
  assert.deepEqual(lu.articles.map((a) => a.uid), ['u1', 'u2', 'u3']);

  const { pret_le: pretLe } = (await app.inject({ method: 'POST', url: '/api/drive-pret', headers: { 'x-cadre-cle': CLE } })).json();
  resultat = await lancer(maison, ['etat'], { env: { CADRE_URL: adresse } });
  assert.equal(JSON.parse(resultat.sortie).drive_pret_le, pretLe);
});

test('etat : ~/.config/cadre/cle passe avant la clé de développement ; la clé du cadre est refusée (403)', async (t) => {
  const { adresse } = await serveurDeTest(t);
  const maison = maisonTemporaire(t);
  ecrireCle(maison, 'cle_clevo_dev', CLE_CLEVO);
  ecrireCle(maison, 'cle', CLE);
  const resultat = await lancer(maison, ['etat'], { env: { CADRE_URL: adresse } });
  assert.equal(resultat.code, 1);
  assert.match(resultat.erreurs, /HTTP 403, cette clé n'est pas celle du Clevo/);
  assert.ok(!resultat.erreurs.includes(CLE) && !resultat.sortie.includes(CLE), 'clé affichée');
});

test('etat : sans clé (code 2) ou serveur injoignable (code 1)', async (t) => {
  const maison = maisonTemporaire(t);
  const sansCle = await lancer(maison, ['etat'], { env: { CADRE_URL: 'http://127.0.0.1:9' } });
  assert.equal(sansCle.code, 2);
  assert.match(sansCle.erreurs, /clé du Clevo introuvable/);
  ecrireCle(maison, 'cle_clevo_dev', CLE_CLEVO);
  const injoignable = await lancer(maison, ['etat'], { env: { CADRE_URL: 'http://127.0.0.1:9' } });
  assert.equal(injoignable.code, 1);
  assert.match(injoignable.erreurs, /serveur du cadre injoignable \(http:\/\/127\.0\.0\.1:9\)/);
});

test('cocher : une confirmation par article ; « o » coche, « n » et la fin de l\'entrée ne cochent pas', async (t) => {
  const { courses, adresse } = await serveurDeTest(t);
  const maison = maisonTemporaire(t);
  ecrireCle(maison, 'cle', CLE_CLEVO);
  const resultat = await lancer(maison, ['cocher', 'u1', 'u2', 'u3', 'u9'], { env: { CADRE_URL: adresse }, entree: 'o\nn\n' });
  assert.equal(resultat.code, 0, resultat.erreurs);
  assert.match(resultat.sortie, /Cocher « lait » \(u1\) \? \[o\/N\]   coché \(simulation : le serveur n'écrit pas dans Home Assistant\)/);
  assert.match(resultat.sortie, /Cocher « crème fraîche » \(u2\) \? \[o\/N\]   non coché/);
  assert.match(resultat.sortie, /« pain » \(u3\) : déjà coché/);
  assert.match(resultat.sortie, /u9 : absent de la liste, ignoré/);
  assert.match(resultat.sortie, /1 article\(s\) coché\(s\) sur 4 demandé\(s\)/);
  assert.deepEqual(courses.valeur.articles.map((a) => [a.uid, a.status]), [['u1', 'completed'], ['u2', 'needs_action'], ['u3', 'completed']]);

  const sansReponse = await lancer(maison, ['cocher', 'u2'], { env: { CADRE_URL: adresse } });
  assert.match(sansReponse.sortie, /non coché \(aucune réponse\)/);
  assert.equal(courses.valeur.articles[1].status, 'needs_action', 'fin de l\'entrée standard : rien n\'est coché');
});

test('cocher : un article noté avec une inversion bidi est affiché avec ses caractères invisibles en clair', async (t) => {
  const { adresse } = await serveurDeTest(t, [{ uid: 'u7', summary: 'lait\u202e tsiur', status: 'needs_action' }]);
  const maison = maisonTemporaire(t);
  ecrireCle(maison, 'cle', CLE_CLEVO);
  const resultat = await lancer(maison, ['cocher', 'u7'], { env: { CADRE_URL: adresse }, entree: 'n\n' });
  assert.match(resultat.sortie, /Cocher « lait\\u202e tsiur » \(u7\) \? \[o\/N\]/);
  assert.ok(!resultat.sortie.includes('\u202e'), 'le caractère lui-même n\'est jamais écrit');
});
