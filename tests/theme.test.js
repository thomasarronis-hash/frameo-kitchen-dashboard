// tests/theme.test.js
//
// Rôle    : prouver la bascule de thème de web/src/theme.js : jour au-dessus de -6°, soir en dessous avec
//           une hystérésis de 1°, nuit de 20 h 30 à 6 h heure de Paris (minuit et changement d'heure du
//           25/10/2026 compris), élévation inconnue, apparence (classe et luminosité), ?theme= et sa seule
//           garde côté page : le thème n'est forcé que si /dev/reglages répond 200 avec theme_force.
// Entrées : instants UTC construits à la main (Date.UTC), élévations choisies.
// Sorties : node --test.
// Pièges  : le 25/10/2026 à 01:00 UTC, Paris passe de 03:00 CEST (UTC+2) à 02:00 CET (UTC+1). Les cas
//           retenus donneraient un autre résultat avec un décalage fixe de +2 h : c'est ce qui prouve que
//           l'heure vient bien du fuseau Europe/Paris.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apparence, demanderThemeForce, themeDemande, themePour } from '../web/src/theme.js';

const utc = (texte) => Date.parse(`${texte}Z`);
const JOUR = 30;
const NUIT_NOIRE = -30;

test('nuit de 20 h 30 à 6 h heure de Paris, quel que soit le soleil', () => {
  assert.equal(themePour(utc('2026-10-11T18:29'), NUIT_NOIRE, 'soir'), 'soir', '20:29');
  assert.equal(themePour(utc('2026-10-11T18:30'), NUIT_NOIRE, 'soir'), 'nuit', '20:30');
  assert.equal(themePour(utc('2026-10-12T03:59'), NUIT_NOIRE, 'nuit'), 'nuit', '05:59');
  assert.equal(themePour(utc('2026-10-12T04:00'), NUIT_NOIRE, 'nuit'), 'soir', '06:00, soleil bas');
  assert.equal(themePour(utc('2026-06-21T04:00'), JOUR, 'nuit'), 'jour', '06:00 en juin, soleil levé');
  assert.equal(themePour(utc('2026-06-21T03:30'), JOUR, 'nuit'), 'nuit', '05:30 en juin : nuit même avec du soleil');
  assert.equal(themePour(utc('2026-06-21T18:29'), JOUR, 'jour'), 'jour', '20:29 en juin, soleil encore haut');
  assert.equal(themePour(utc('2026-06-21T18:30'), JOUR, 'jour'), 'nuit', '20:30 en juin : nuit même avec du soleil');
});

test('minuit : la nuit continue d\'un jour sur l\'autre', () => {
  assert.equal(themePour(utc('2026-10-11T21:59'), NUIT_NOIRE, 'nuit'), 'nuit', '23:59');
  assert.equal(themePour(utc('2026-10-11T22:00'), NUIT_NOIRE, 'nuit'), 'nuit', '00:00');
  assert.equal(themePour(utc('2026-12-31T23:00'), NUIT_NOIRE, 'nuit'), 'nuit', '00:00 le 1er janvier (CET)');
});

test('changement d\'heure du 25/10/2026 : heures de Paris, pas un décalage fixe', () => {
  // Veille, encore en CEST (UTC+2).
  assert.equal(themePour(utc('2026-10-24T03:59'), NUIT_NOIRE, 'nuit'), 'nuit', '24/10 05:59 CEST');
  assert.equal(themePour(utc('2026-10-24T04:00'), NUIT_NOIRE, 'nuit'), 'soir', '24/10 06:00 CEST');
  // Heure répétée : 02:30 CEST puis 02:30 CET, nuit les deux fois.
  assert.equal(themePour(utc('2026-10-25T00:30'), NUIT_NOIRE, 'nuit'), 'nuit', '02:30 CEST');
  assert.equal(themePour(utc('2026-10-25T01:30'), NUIT_NOIRE, 'nuit'), 'nuit', '02:30 CET');
  // Après le changement (CET, UTC+1) : 04:30 UTC = 05:30 à Paris (un +2 fixe dirait 06:30).
  assert.equal(themePour(utc('2026-10-25T04:30'), NUIT_NOIRE, 'nuit'), 'nuit', '25/10 05:30 CET');
  assert.equal(themePour(utc('2026-10-25T05:00'), NUIT_NOIRE, 'nuit'), 'soir', '25/10 06:00 CET');
  // Le soir : 19:29 UTC = 20:29 à Paris (un +2 fixe dirait 21:29, donc nuit).
  assert.equal(themePour(utc('2026-10-25T19:29'), NUIT_NOIRE, 'soir'), 'soir', '25/10 20:29 CET');
  assert.equal(themePour(utc('2026-10-25T19:30'), NUIT_NOIRE, 'soir'), 'nuit', '25/10 20:30 CET');
});

test('jour au-dessus de -6°, soir en dessous, sans thème précédent', () => {
  const midi = utc('2026-10-11T10:00');
  assert.equal(themePour(midi, -5.9, null), 'jour');
  assert.equal(themePour(midi, -6, null), 'soir');
  assert.equal(themePour(midi, -6.1, null), 'soir');
  assert.equal(themePour(midi, 32.4, null), 'jour');
});

test('hystérésis de 1° : de jour, soir sous -6,5° ; de soir, jour au-dessus de -5,5°', () => {
  const crepuscule = utc('2026-10-11T17:30');
  assert.equal(themePour(crepuscule, -6.2, 'jour'), 'jour');
  assert.equal(themePour(crepuscule, -6.5, 'jour'), 'jour');
  assert.equal(themePour(crepuscule, -6.6, 'jour'), 'soir');
  assert.equal(themePour(crepuscule, -5.8, 'soir'), 'soir');
  assert.equal(themePour(crepuscule, -5.5, 'soir'), 'soir');
  assert.equal(themePour(crepuscule, -5.4, 'soir'), 'jour');
  // Au sortir de la nuit, le seuil simple s'applique.
  assert.equal(themePour(utc('2026-06-21T04:00'), -5.9, 'nuit'), 'jour');
});

test('élévation inconnue : le jour ou le soir affiché est gardé, sinon soir', () => {
  const midi = utc('2026-10-11T10:00');
  for (const inconnue of [null, undefined, NaN, '12']) {
    assert.equal(themePour(midi, inconnue, 'jour'), 'jour');
    assert.equal(themePour(midi, inconnue, 'soir'), 'soir');
    assert.equal(themePour(midi, inconnue, null), 'soir');
    assert.equal(themePour(midi, inconnue, 'nuit'), 'soir');
  }
});

test('apparence : classe et luminosité ; un toucher la nuit montre l\'Ardoise à 0,4', () => {
  assert.deepEqual(apparence('jour', false), { classe: 'jour', luminosite: 0.6 });
  assert.deepEqual(apparence('soir', false), { classe: 'soir', luminosite: 0.3 });
  assert.deepEqual(apparence('nuit', false), { classe: 'nuit', luminosite: 0.05 });
  assert.deepEqual(apparence('nuit', true), { classe: 'soir', luminosite: 0.3 });
  assert.deepEqual(apparence('jour', true), { classe: 'jour', luminosite: 0.6 });
});

test('?theme= : seuls jour, soir et nuit sont reconnus', () => {
  assert.equal(themeDemande('?theme=soir'), 'soir');
  assert.equal(themeDemande('?a=1&theme=nuit'), 'nuit');
  assert.equal(themeDemande('?theme=jour'), 'jour');
  assert.equal(themeDemande('?theme=rouge'), null);
  assert.equal(themeDemande('?theme='), null);
  assert.equal(themeDemande(''), null);
});

// Faux fetch de /dev/reglages : statut et corps choisis, appels notés.
function reglages(statut, corps) {
  const appels = [];
  const lire = async (url) => {
    appels.push(url);
    return { status: statut, json: async () => (corps instanceof Error ? Promise.reject(corps) : corps) };
  };
  return { appels, lire };
}

test('thème forcé : seulement si /dev/reglages répond 200 avec theme_force (serveur de développement)', async () => {
  const dev = reglages(200, { theme_force: true });
  assert.equal(await demanderThemeForce('?theme=soir', dev.lire), 'soir');
  assert.deepEqual(dev.appels, ['/dev/reglages']);
  const production = reglages(404, { message: 'Route GET:/dev/reglages not found', error: 'Not Found', statusCode: 404 });
  assert.equal(await demanderThemeForce('?theme=soir', production.lire), null, 'production : 404');
  assert.equal(await demanderThemeForce('?theme=soir', reglages(403, { erreur: 'interdit' }).lire), null, '403 hors boucle locale');
  assert.equal(await demanderThemeForce('?theme=soir', reglages(302, { theme_force: true }).lire), null, 'statut autre que 200, même avec theme_force');
  assert.equal(await demanderThemeForce('?theme=soir', reglages(200, {}).lire), null, 'JSON sans theme_force');
  assert.equal(await demanderThemeForce('?theme=soir', reglages(200, { theme_force: 'oui' }).lire), null, 'theme_force autre que true');
  assert.equal(await demanderThemeForce('?theme=soir', reglages(200, new SyntaxError('JSON illisible')).lire), null, 'corps illisible');
  assert.equal(await demanderThemeForce('?theme=soir', async () => { throw new TypeError('Failed to fetch'); }), null, 'erreur réseau');
  assert.equal(await demanderThemeForce('?theme=soir', () => { throw new Error('levée tout de suite'); }), null, 'erreur synchrone');
});

test('thème forcé : sans ?theme= valable, /dev/reglages n\'est même pas demandé', async () => {
  const dev = reglages(200, { theme_force: true });
  assert.equal(await demanderThemeForce('', dev.lire), null);
  assert.equal(await demanderThemeForce('?theme=rouge', dev.lire), null);
  assert.deepEqual(dev.appels, []);
});
