// tests/enfants-bareme.test.js
//
// Rôle    : prouver le barème du tableau des enfants (config/enfants.json, serveur/enfants/bareme.js) : il est conforme et
//           porte EXACTEMENT les valeurs de Thomas du 14/10 (README « Tableau des enfants » ; tout le matin de Timo
//           en confiance et 10 points libres par jour depuis le 14/10 en fin d'après-midi, la validation par un parent
//           restant permise au barème) ; ses couleurs et pictogrammes existent dans la page ; un barème faux est refusé au
//           démarrage avec un message en français qui dit où ; il part bien dans l'image Docker.
// Entrées : config/enfants.json, web/styles/jetons.css, web/public/icones.svg, Dockerfile, deploiement/deployer.sh,
//           .dockerignore ; barèmes abîmés fabriqués ici.
// Sorties : node --test.
// Pièges  : changer une valeur du barème fait échouer ce test exprès : c'est une décision de Thomas, pas un réglage.

import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CHEMIN_BAREME, chargerBareme, trouverEnfant, validerBareme,
} from '../serveur/enfants/bareme.js';
import { PLAFOND_POINTS_JOUR } from '../serveur/enfants/registre.js';

const brut = () => JSON.parse(readFileSync(CHEMIN_BAREME, 'utf8'));
const lireWeb = (chemin) => readFileSync(fileURLToPath(new URL(`../web/${chemin}`, import.meta.url)), 'utf8');

test('barème : conforme, gelé, et le matin de Timo est celui de Thomas (minutes, tout en confiance, 6 h 30, plafond 32, départ 8 h 10, fin 9 h)', () => {
  const bareme = chargerBareme();
  assert.ok(Object.isFrozen(bareme) && Object.isFrozen(bareme.enfants[0].etapes[0]), 'barème gelé');
  assert.equal(bareme.depart, '08:10');
  assert.equal(bareme.fin_routine, '09:00', 'la routine du matin se referme à 9 h (choix de Thomas du 14/10)');
  const timo = trouverEnfant(bareme, 'timo');
  assert.deepEqual(
    { type: timo.type, plafond: timo.plafond, points: timo.points },
    { type: 'minutes', plafond: 32, points: true },
  );
  assert.deepEqual(timo.etapes.map(({
    id, valeur, validation, apres = null,
  }) => [id, valeur, validation, apres]), [
    ['leve', 10, 'enfant', '06:30'],
    ['dejeuner', 5, 'enfant', null],
    ['dents', 3, 'enfant', null],
    ['habille', 5, 'enfant', null],
    ['cartable', 5, 'enfant', null],
    ['calme', 4, 'enfant', null],
  ]);
  assert.equal(timo.etapes.reduce((total, etape) => total + etape.valeur, 0), 32, 'les étapes font juste le maximum de 32 min');
});

test('barème : Pablo a trois étapes à étoiles puis « Ensuite : une histoire », pas de minutes ni de points ; boutique 30, 60, 90 ; 1 point par action, 10 points libres par jour', () => {
  const bareme = chargerBareme();
  const pablo = trouverEnfant(bareme, 'pablo');
  assert.deepEqual({ type: pablo.type, points: pablo.points, plafond: pablo.plafond }, { type: 'etoiles', points: false, plafond: undefined });
  assert.deepEqual(pablo.etapes.map(({ id, valeur, validation }) => [id, valeur, validation]), [
    ['petit-dejeuner', 1, 'enfant'], ['dents', 1, 'enfant'], ['chaussures', 1, 'enfant'],
  ]);
  assert.equal(pablo.ensuite.libelle, 'Une histoire');
  assert.deepEqual(bareme.boutique.map(({ libelle, prix }) => [libelle, prix]), [['Petit cadeau', 30], ['Moyen cadeau', 60], ['Gros cadeau', 90]]);
  assert.equal(bareme.points.par_action, 1);
  assert.equal(bareme.points.plafond_libre, 10, 'bouton +1 sans mode parent : 10 par journée (décision du 14/10 en fin d\'après-midi)');
  assert.ok(bareme.points.motifs.length > 0 && bareme.points.motifs.length <= 6, 'une petite liste de motifs');
  assert.deepEqual(bareme.enfants.filter((enfant) => enfant.points).map((enfant) => enfant.id), ['timo'], 'seul Timo a des points et la boutique');
});

test('barème : chaque couleur est un jeton de jetons.css (jour et soir), chaque pictogramme un symbole du sprite', () => {
  const bareme = chargerBareme();
  const [jour, soir] = lireWeb('styles/jetons.css').replace(/\/\*[\s\S]*?\*\//g, '').split('.theme-soir');
  for (const { couleur } of bareme.enfants) {
    assert.match(jour, new RegExp(`--${couleur}:`), `--${couleur} absent du jour`);
    assert.match(soir, new RegExp(`--${couleur}:`), `--${couleur} absent du soir`);
  }
  const sprite = lireWeb('public/icones.svg');
  const pictos = [
    ...bareme.enfants.flatMap((enfant) => [...enfant.etapes, ...(enfant.ensuite ? [enfant.ensuite] : [])]),
    ...bareme.points.motifs, ...bareme.boutique,
  ].map((element) => element.picto);
  for (const picto of [...pictos, ...bareme.enfants.map((enfant) => enfant.avatar)]) {
    assert.ok(sprite.includes(`<symbol id="${picto}"`), `${picto} absent du sprite`);
  }
});

test('barème : chaque enfant a son petit personnage dessiné (avatar), distinct de celui de son frère', () => {
  const bareme = chargerBareme();
  assert.deepEqual(bareme.enfants.map(({ id, avatar }) => [id, avatar]), [['timo', 'i-renard'], ['pablo', 'i-ourson']]);
});

test('barèmes faux : refusés avec un message en français qui dit où', () => {
  const casses = [
    [(b) => { b.enfants[0].bonus = 5; }, /\/enfants\/0 : champ inconnu : bonus/],
    [(b) => { b.enfants[0].plafond = 40; }, /plafond : 40 dépasse la somme des étapes \(32\)/],
    [(b) => { delete b.enfants[0].plafond; }, /champ obligatoire manquant : plafond/],
    [(b) => { b.enfants[1].plafond = 3; }, /plafond réservé au type minutes/],
    [(b) => { b.enfants[0].etapes[1].id = 'dents'; }, /\/enfants\/0\/etapes : identifiant « dents » répété/],
    [(b) => { b.enfants[0].etapes[0].apres = '03:30'; }, /etapes\/0\/apres : entre 04:00/],
    [(b) => { b.enfants[0].etapes[0].apres = '6h30'; }, /etapes\/0\/apres : forme inattendue/],
    [(b) => { b.enfants[0].etapes[0].libelle = 'Levé tôt mais pas trop tôt'; }, /libelle : au plus 24 caractères/],
    [(b) => { b.enfants[0].etapes[0].picto = 'reveil'; }, /picto : forme inattendue/],
    [(b) => { delete b.enfants[1].avatar; }, /\/enfants\/1 : champ obligatoire manquant : avatar/],
    [(b) => { b.enfants[0].etapes[0].validation = 'maman'; }, /validation : valeur attendue parmi enfant, parent/],
    [(b) => { b.enfants[0].etapes.push(...b.enfants[1].etapes, { ...b.enfants[1].etapes[0], id: 'x' }, { ...b.enfants[1].etapes[0], id: 'y' }); }, /etapes : au plus 7 éléments/],
    [(b) => { b.enfants[0].points = false; }, /boutique : aucun enfant n'a de points/],
    [(b) => { b.version = 2; }, /\/version : valeur attendue : 1/],
    [(b) => { b.minutes_perdues = '03:00'; }, /minutes_perdues : après 04:00/],
    [(b) => { delete b.fin_routine; }, /champ obligatoire manquant : fin_routine/],
    [(b) => { b.fin_routine = '08:00'; }, /fin_routine : entre le départ \(08:10\) et l'heure des minutes perdues/],
    [(b) => { b.fin_routine = '20:00'; }, /fin_routine : entre le départ/],
    [(b) => { b.enfants[0].etapes[0].apres = '10:30'; }, /etapes\/0\/apres : entre 04:00 et la fin de la routine \(09:00\)/],
    [(b) => { b.boutique[1].prix = 0; }, /boutique\/1\/prix : au moins 1/],
    [(b) => { b.points.motifs[1].id = 'range'; }, /motifs : identifiant « range » répété/],
    [(b) => { delete b.points.plafond_libre; }, /\/points : champ obligatoire manquant : plafond_libre/],
    [(b) => { b.points.plafond_libre = 0; }, /\/points\/plafond_libre : au moins 1/],
    [(b) => { b.points.plafond_libre = PLAFOND_POINTS_JOUR + 1; }, /\/points\/plafond_libre : au plus 20/],
    [(b) => { b.points.plafond_libre = '10'; }, /\/points\/plafond_libre : type attendu : integer/],
  ];
  for (const [casser, attendu] of casses) {
    const bareme = brut();
    casser(bareme);
    assert.throws(() => validerBareme(bareme), (err) => {
      assert.match(err.message, /^barème des enfants non conforme : /);
      assert.match(err.message, attendu);
      return true;
    }, String(attendu));
  }
});

test('barème : la validation par un parent reste permise (étape en attente), et le plafond des points libres peut aller jusqu\'au plafond de gains du registre', () => {
  const bareme = brut();
  bareme.enfants[0].etapes.find((etape) => etape.id === 'calme').validation = 'parent';
  bareme.points.plafond_libre = PLAFOND_POINTS_JOUR;
  const valide = validerBareme(bareme);
  assert.equal(trouverEnfant(valide, 'timo').etapes.find((etape) => etape.id === 'calme').validation, 'parent');
  assert.equal(valide.points.plafond_libre, 20, 'même borne que PLAFOND_POINTS_JOUR (registre.js) : les deux vont ensemble');
});

test('barème illisible (absent ou JSON abîmé) : erreur claire au démarrage', (t) => {
  const dossier = mkdtempSync(join(tmpdir(), 'cadre-bareme-'));
  t.after(() => rmSync(dossier, { recursive: true, force: true }));
  assert.throws(() => chargerBareme(join(dossier, 'absent.json')), /barème des enfants illisible .*ENOENT/);
  writeFileSync(join(dossier, 'abime.json'), '{ "version": 1, ');
  assert.throws(() => chargerBareme(join(dossier, 'abime.json')), /barème des enfants illisible/);
});

test('barème dans l\'image : le Dockerfile copie config/, deployer.sh l\'envoie, .dockerignore ne l\'écarte pas (sinon le serveur ne démarre pas)', () => {
  const lire = (chemin) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
  assert.match(lire('Dockerfile'), /^COPY config\/ config\/$/m);
  assert.match(lire('deploiement/deployer.sh'), /^\s+package\.json .* serveur partage config web \\$/m);
  assert.doesNotMatch(lire('.dockerignore'), /^config/m);
});
