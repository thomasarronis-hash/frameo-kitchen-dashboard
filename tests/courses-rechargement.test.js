// tests/courses-rechargement.test.js
//
// Rôle    : prouver, sans DOM, la liste de l'écran Courses (web/src/ecrans/courses-donnees.js : tri, mise à jour
//           optimiste puis réconciliation avec le flux, refus, filet de 10 s, article coché qui garde sa place
//           tant qu'on touche la liste, question de « Vider les cochés » qui nomme les articles, règle du texte)
//           et le rechargement
//           quotidien (web/src/rechargement.js : journée qui commence à 4h à Paris, report tant qu'un minuteur
//           tourne, qu'une recette est ouverte ou qu'on vient de toucher l'écran).
// Entrées : fausse horloge monotone ; instants UTC construits à la main.
// Sorties : node --test.
// Pièges  : la réponse HTTP d'une action et la nouvelle liste du flux arrivent dans un ordre quelconque : les deux
//           ordres sont testés.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  creerCoursesLocales, texteArticle, texteViderCoches, trierArticles,
} from '../web/src/ecrans/courses-donnees.js';
import { doitRecharger, journeeDeRechargement } from '../web/src/rechargement.js';

const utc = (texte) => Date.parse(`${texte}Z`);
const article = (uid, summary, status = 'needs_action') => ({ uid, summary, status });
const resume = (vue) => vue.articles.map((a) => `${a.summary}${a.status === 'completed' ? ' (coché)' : ''}${a.enAttente ? ' …' : ''}`);

function monter() {
  let temps = 0;
  const locales = creerCoursesLocales({ monotone: () => temps });
  return { locales, avancer: (ms) => { temps += ms; } };
}

test('tri : articles à faire d\'abord, cochés ensuite, ordre de HA gardé dans chaque groupe', () => {
  const tries = trierArticles([article('a', 'lait', 'completed'), article('b', 'pain'), article('c', 'œufs', 'completed'), article('d', 'beurre')]);
  assert.deepEqual(tries.map((a) => a.uid), ['b', 'd', 'a', 'c']);
});

test('liste pas encore lue, puis vue avec compteurs', () => {
  const { locales } = monter();
  assert.deepEqual(locales.vue(), { lue: false, articles: [], aFaire: 0, coches: 0 });
  locales.recevoir({ articles: [article('a', 'lait', 'completed'), article('b', 'pain')] });
  const vue = locales.vue();
  assert.deepEqual([vue.lue, vue.aFaire, vue.coches], [true, 1, 1]);
  assert.deepEqual(resume(vue), ['pain', 'lait (coché)']);
});

test('ajout optimiste : visible tout de suite (uid local, en attente), remplacé par le vrai article du flux', () => {
  const { locales } = monter();
  locales.recevoir({ articles: [article('a', 'lait')] });
  const op = locales.operation('ajouter', { texte: 'crème fraîche' });
  assert.deepEqual(resume(locales.vue()), ['lait', 'crème fraîche …']);
  assert.equal(locales.vue().articles[1].uid, `local-${op.id}`);
  // Le flux arrive avant la réponse HTTP : la réponse retire l'opération.
  locales.recevoir({ articles: [article('a', 'lait'), article('x9', 'crème fraîche')] });
  assert.deepEqual(resume(locales.vue()), ['lait', 'crème fraîche'], 'pas de doublon en attendant la réponse');
  locales.reussir(op);
  assert.deepEqual(resume(locales.vue()), ['lait', 'crème fraîche']);
});

test('ajout d\'un texte déjà présent dans la liste : la copie locale reste visible jusqu\'au nouvel article', () => {
  const { locales } = monter();
  locales.recevoir({ articles: [article('a', 'pain')] });
  locales.operation('ajouter', { texte: 'pain' });
  assert.deepEqual(resume(locales.vue()), ['pain', 'pain …']);
  locales.recevoir({ articles: [article('a', 'pain'), article('b', 'pain')] });
  assert.deepEqual(resume(locales.vue()), ['pain', 'pain']);
});

test('un article coché garde sa place tant qu\'on touche la liste ; trié 4 s après la dernière coche, ou en quittant l\'écran', () => {
  const { locales, avancer } = monter();
  locales.recevoir({ articles: [article('l', 'Lait'), article('b', 'Beurre'), article('f', 'Farine')] });
  locales.reussir(locales.operation('cocher', { uid: 'l', fait: true }));
  assert.deepEqual(resume(locales.vue()), ['Lait (coché) …', 'Beurre', 'Farine'], 'Beurre ne prend pas la place sous le doigt');
  locales.recevoir({ articles: [article('l', 'Lait', 'completed'), article('b', 'Beurre'), article('f', 'Farine')] });
  avancer(3000);
  locales.operation('cocher', { uid: 'f', fait: true });
  avancer(3999);
  assert.equal(locales.purger(), false);
  assert.deepEqual(resume(locales.vue()), ['Lait (coché)', 'Beurre', 'Farine (coché) …'], 'chaque coche repousse le tri');
  avancer(1);
  assert.equal(locales.purger(), true, 'liste laissée tranquille 4 s : triée');
  assert.deepEqual(resume(locales.vue()), ['Beurre', 'Lait (coché)', 'Farine (coché) …']);

  locales.recevoir({ articles: [article('l', 'Lait', 'completed'), article('b', 'Beurre'), article('f', 'Farine', 'completed')] });
  locales.operation('cocher', { uid: 'f', fait: false });
  assert.deepEqual(resume(locales.vue()), ['Beurre', 'Lait (coché)', 'Farine …'], 'décoché : reste à sa place, parmi les cochés');
  locales.defiger();
  assert.deepEqual(resume(locales.vue()), ['Beurre', 'Farine …', 'Lait (coché)'], 'en quittant l\'écran : trié');
});

test('réponse avant le flux : l\'opération reste affichée jusqu\'à la liste suivante (pas de retour en arrière)', () => {
  const { locales } = monter();
  locales.recevoir({ articles: [article('a', 'lait'), article('b', 'pain')] });
  const op = locales.operation('cocher', { uid: 'a', fait: true });
  locales.reussir(op);
  assert.deepEqual(resume(locales.vue()), ['lait (coché) …', 'pain']);
  locales.recevoir({ articles: [article('a', 'lait', 'completed'), article('b', 'pain')] });
  assert.deepEqual(resume(locales.vue()), ['lait (coché)', 'pain']);
});

test('refus du serveur : l\'opération est retirée, l\'écran revient à l\'état du serveur', () => {
  const { locales } = monter();
  locales.recevoir({ articles: [article('a', 'lait'), article('b', 'pain', 'completed')] });
  const op = locales.operation('supprimer', { uid: 'a' });
  const vider = locales.operation('vider', {});
  assert.deepEqual(resume(locales.vue()), []);
  locales.echouer(op);
  assert.deepEqual(resume(locales.vue()), ['lait']);
  locales.echouer(vider);
  assert.deepEqual(resume(locales.vue()), ['lait', 'pain (coché)']);
});

test('filet : une opération réussie sans liste du flux derrière disparaît au bout de 10 s', () => {
  const { locales, avancer } = monter();
  locales.recevoir({ articles: [article('a', 'lait', 'completed')] });
  const op = locales.operation('cocher', { uid: 'a', fait: true });
  locales.reussir(op);
  avancer(4_000);
  assert.equal(locales.purger(), true, 'tri de la liste laissée tranquille');
  avancer(5_999);
  assert.equal(locales.purger(), false);
  assert.equal(locales.vue().articles[0].enAttente, true);
  avancer(1);
  assert.equal(locales.purger(), true);
  assert.equal(locales.vue().articles[0].enAttente, false);
});

test('opération sur un article disparu entre-temps (supprimé depuis l\'iPhone) : ignorée', () => {
  const { locales } = monter();
  locales.recevoir({ articles: [article('a', 'lait')] });
  locales.operation('cocher', { uid: 'a', fait: true });
  locales.recevoir({ articles: [article('b', 'pain')] });
  assert.deepEqual(resume(locales.vue()), ['pain']);
});

test('texte d\'un article : bords retirés, 1 à 60 caractères, pas que des espaces, pas de caractère de contrôle', () => {
  assert.equal(texteArticle('  lait  '), 'lait');
  assert.equal(texteArticle('x'.repeat(60)), 'x'.repeat(60));
  assert.equal(texteArticle('x'.repeat(61)), null);
  assert.equal(texteArticle('   '), null);
  assert.equal(texteArticle(''), null);
  assert.equal(texteArticle('pain\u0007'), null);
  assert.equal(texteArticle(undefined), null);
  for (const invisible of ['\uD800', 'lait\u0085', 'a\u2028b', 'lait\u202e', '\u2066x\u2069']) assert.equal(texteArticle(invisible), null, JSON.stringify(invisible));
  assert.equal(texteArticle('crème 🥛'), 'crème 🥛', 'un émoji (paire complète) passe');
});

test('« Vider les cochés » nomme ce qui part : 1 à 3 articles en entier, au-delà 2 noms et « et N autres »', () => {
  const coche = (summary) => article(summary, summary, 'completed');
  assert.equal(texteViderCoches([article('a', 'pain')]), null);
  assert.equal(texteViderCoches([coche('lait'), article('a', 'pain')]), 'Retirer « lait » ?');
  assert.equal(texteViderCoches([coche('lait'), coche('beurre')]), 'Retirer « lait » et « beurre » ?');
  assert.equal(texteViderCoches([coche('lait'), coche('beurre'), coche('œufs')]), 'Retirer « lait », « beurre » et « œufs » ?');
  assert.equal(texteViderCoches([coche('lait'), coche('beurre'), coche('œufs'), coche('café')]), 'Retirer « lait », « beurre » et 2 autres ?');
});

test('rechargement : la journée commence à 4h, heure de Paris, y compris la nuit du changement d\'heure', () => {
  assert.equal(journeeDeRechargement(utc('2026-10-11T01:59')), '2026-10-10', '03:59 à Paris');
  assert.equal(journeeDeRechargement(utc('2026-10-11T02:00')), '2026-10-11', '04:00 à Paris');
  assert.equal(journeeDeRechargement(utc('2026-10-24T22:30')), '2026-10-24', '25/10, 00:30 (CEST)');
  assert.equal(journeeDeRechargement(utc('2026-10-25T02:30')), '2026-10-24', '25/10, 03:30 (CET, après le recul)');
  assert.equal(journeeDeRechargement(utc('2026-10-25T03:00')), '2026-10-25', '25/10, 04:00 (CET)');
  assert.equal(journeeDeRechargement(utc('2026-03-01T03:00')), '2026-03-01');
  assert.equal(journeeDeRechargement(utc('2026-03-01T02:00')), '2026-02-28', 'veille en fin de mois');
});

test('rechargement : à 4h passé, sauf horloge pas encore réglée, minuteur ou recette (reporté), ou toucher récent', () => {
  const reference = journeeDeRechargement(utc('2026-10-11T10:00'));
  const a4h01 = utc('2026-10-12T02:01');
  const calme = { reference, ms: a4h01, bloque: false, inactifMs: 600_000 };
  assert.equal(doitRecharger({ ...calme, ms: utc('2026-10-12T01:59') }), false, 'avant 4h');
  assert.equal(doitRecharger(calme), true);
  assert.equal(doitRecharger({ ...calme, reference: null }), false, 'référence pas encore relevée (horloge non réglée)');
  assert.equal(doitRecharger({ ...calme, bloque: true }), false, 'un minuteur tourne : reporté');
  assert.equal(doitRecharger({ ...calme, ms: utc('2026-10-12T05:40'), bloque: false }), true, 'minuteur fini à 7h40 : rechargement alors');
  assert.equal(doitRecharger({ ...calme, inactifMs: 59_999 }), false, 'quelqu\'un vient de toucher l\'écran');
});
