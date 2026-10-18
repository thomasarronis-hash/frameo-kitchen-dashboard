// tests/draps.test.js
//
// Rôle    : prouver les draps côté serveur (serveur/sources/draps.js, serveur/routes/draps.js) : la date est calculée par le
//           serveur à l'heure de Paris (aujourd'hui, hier, avant-hier, y compris juste après minuit et au changement de
//           mois), jamais prise dans le corps ; liste fermée des lits ; draps.json écrit de façon atomique, relu et validé
//           au démarrage (abîmé, non conforme ou trop gros : mis de côté, jamais écrasé ; erreur d'accès : rien de remis à
//           null) ; trois appuis simultanés ne se perdent pas ; la
//           valeur part dans le flux ; clé exigée ; limite de 10 appuis par minute.
// Entrées : un dossier d'état temporaire (os.tmpdir()) ; une horloge fixe ; l'application montée par tests/aides.js.
// Sorties : node --test.
// Pièges  : la source est la même pour la route et pour le flux (index.js la met dans les deux) : le test aussi.

import assert from 'node:assert/strict';
import {
  chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LITS, SourceDraps } from '../serveur/sources/draps.js';
import { CLE, monter, ouvrirFlux } from './aides.js';

const CADRE = { 'x-cadre-cle': CLE, 'content-type': 'application/json' };

function journalCapture() {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m) };
}

function dossierEtat(t) {
  const racine = mkdtempSync(join(tmpdir(), 'cadre-draps-'));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  return join(racine, 'etat');
}

async function preparer(t, quand, { dossier = dossierEtat(t) } = {}) {
  const draps = new SourceDraps({ dossier, journal: journalCapture(), maintenant: () => Date.parse(quand) });
  await draps.actualiser();
  const monte = await monter({ draps, sources: { draps } });
  t.after(() => monte.app.close());
  return { ...monte, draps, dossier };
}

const marquer = (app, lit, corps, entetes = CADRE) => app.inject({ method: 'POST', url: `/api/draps/${lit}`, headers: entetes, payload: JSON.stringify(corps) });

test('draps : la date vient du serveur, à l\'heure de Paris : aujourd\'hui, hier, avant-hier (00:30 à Paris = la veille en UTC)', async (t) => {
  const { app, dossier } = await preparer(t, '2026-10-14T00:30:00+02:00');
  assert.deepEqual((await marquer(app, 'timo', { quand: 'aujourdhui' })).json(), { lit: 'timo', change_le: '2026-10-14' });
  assert.deepEqual((await marquer(app, 'pablo', { quand: 'hier' })).json(), { lit: 'pablo', change_le: '2026-10-13' });
  assert.deepEqual((await marquer(app, 'parents', { quand: 'avant-hier' })).json(), { lit: 'parents', change_le: '2026-10-12' });
  assert.deepEqual(JSON.parse(readFileSync(join(dossier, 'draps.json'), 'utf8')), {
    lits: { timo: '2026-10-14', pablo: '2026-10-13', parents: '2026-10-12' },
  });
  assert.deepEqual(readdirSync(dossier), ['draps.json'], 'aucun fichier caché restant');
});

test('draps : avant-hier au changement de mois et d\'heure (1er novembre à 01:00, heure d\'hiver)', async (t) => {
  const { app } = await preparer(t, '2026-11-01T01:00:00+01:00');
  assert.equal((await marquer(app, 'timo', { quand: 'avant-hier' })).json().change_le, '2026-10-30');
});

test('draps : lit hors liste 404, date fournie, mot inconnu ou corps absent 400 ; rien n\'est écrit', async (t) => {
  const { app, dossier } = await preparer(t, '2026-10-14T09:00:00+02:00');
  assert.deepEqual(LITS, ['timo', 'pablo', 'parents']);
  const inconnu = await marquer(app, 'chambre-amis', { quand: 'aujourdhui' });
  assert.deepEqual([inconnu.statusCode, inconnu.json()], [404, { erreur: 'lit_inconnu' }]);
  for (const corps of [{ quand: 'aujourdhui', date: '2020-01-01' }, { quand: '2026-10-01' }, { quand: 'demain' }, {}]) {
    const reponse = await marquer(app, 'timo', corps);
    assert.equal(reponse.statusCode, 400, JSON.stringify(corps));
    assert.equal(reponse.json().erreur, 'corps_invalide');
  }
  const sansCorps = await app.inject({ method: 'POST', url: '/api/draps/timo', headers: { 'x-cadre-cle': CLE } });
  assert.equal(sansCorps.statusCode, 400);
  assert.throws(() => readdirSync(dossier), /ENOENT/, 'dossier jamais créé : rien d\'écrit');
});

test('draps : clé exigée ; 10 appuis par minute au plus', async (t) => {
  const { app } = await preparer(t, '2026-10-14T09:00:00+02:00');
  assert.equal((await marquer(app, 'timo', { quand: 'aujourdhui' }, { 'content-type': 'application/json' })).statusCode, 401);
  for (let i = 0; i < 10; i += 1) assert.equal((await marquer(app, LITS[i % 3], { quand: 'aujourdhui' })).statusCode, 200);
  assert.equal((await marquer(app, 'timo', { quand: 'aujourdhui' })).statusCode, 429);
});

test('draps : trois appuis simultanés, trois lits notés ; la valeur part dans le flux', async (t) => {
  const { app, draps } = await preparer(t, '2026-10-14T09:00:00+02:00');
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  const flux = await ouvrirFlux(`${adresse}/api/flux`, { 'x-cadre-cle': CLE });
  t.after(() => flux.fermer());
  assert.deepEqual((await flux.lireEvenement()).donnees.draps, { timo: null, pablo: null, parents: null });
  const reponses = await Promise.all(LITS.map((lit) => marquer(app, lit, { quand: 'hier' })));
  assert.deepEqual(reponses.map((r) => r.statusCode), [200, 200, 200]);
  assert.deepEqual(draps.valeur, { timo: '2026-10-13', pablo: '2026-10-13', parents: '2026-10-13' });
  const recues = [];
  for (let i = 0; i < 3; i += 1) recues.push((await flux.lireEvenement()).donnees.draps);
  assert.deepEqual(recues.at(-1), { timo: '2026-10-13', pablo: '2026-10-13', parents: '2026-10-13' });
});

test('draps.json relu au démarrage ; abîmé, non conforme ou trop gros : mis de côté et journalisé, aucun lit noté', async (t) => {
  const dossier = dossierEtat(t);
  const lire = async () => {
    const journal = journalCapture();
    const draps = new SourceDraps({ dossier, journal });
    await draps.actualiser();
    return { valeur: draps.valeur, journal: journal.lignes.join('\n') };
  };
  assert.deepEqual((await lire()).valeur, { timo: null, pablo: null, parents: null }, 'premier démarrage : aucun fichier');
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, 'draps.json'), JSON.stringify({ lits: { timo: '2026-10-01', pablo: null, parents: '2026-09-30' } }));
  assert.deepEqual((await lire()).valeur, { timo: '2026-10-01', pablo: null, parents: '2026-09-30' });
  for (const abime of ['{ abîmé', JSON.stringify({ lits: { timo: 'hier', pablo: null, parents: null } }), JSON.stringify({ lits: { timo: null } }),
    JSON.stringify({ lits: { timo: null, pablo: null, parents: null, amis: '2026-10-01' } }), 'x'.repeat(20_000)]) {
    readdirSync(dossier).filter((f) => f.includes('.abime-')).forEach((f) => rmSync(join(dossier, f)));
    writeFileSync(join(dossier, 'draps.json'), abime);
    const { valeur, journal } = await lire();
    assert.deepEqual(valeur, { timo: null, pablo: null, parents: null }, abime.slice(0, 40));
    assert.match(journal, /draps\.json abîmé \(.+\) : mis de côté sous draps\.json\.abime-/);
    const copies = readdirSync(dossier).filter((f) => f.startsWith('draps.json.abime-'));
    assert.equal(readFileSync(join(dossier, copies[0]), 'utf8'), abime, 'contenu d\'origine gardé');
  }
});

test('draps : un appui relit le fichier avant d\'écrire ; lecture du démarrage en échec (droits), les deux autres lits ne sont jamais remis à null', async (t) => {
  const dossier = dossierEtat(t);
  mkdirSync(dossier, { recursive: true });
  const original = JSON.stringify({ lits: { timo: '2026-10-01', pablo: '2026-10-02', parents: '2026-09-30' } });
  writeFileSync(join(dossier, 'draps.json'), original);
  chmodSync(join(dossier, 'draps.json'), 0o000);
  const draps = new SourceDraps({ dossier, journal: journalCapture(), maintenant: () => Date.parse('2026-10-14T09:00:00+02:00') });
  await draps.actualiser();
  assert.equal(draps.valeur, null, 'lecture en échec : aucune valeur inventée');
  await assert.rejects(draps.marquer('timo', 'aujourdhui'), (err) => err.code === 'EACCES');
  chmodSync(join(dossier, 'draps.json'), 0o600);
  assert.equal(readFileSync(join(dossier, 'draps.json'), 'utf8'), original, 'rien d\'écrasé');
  await draps.marquer('timo', 'aujourdhui');
  assert.deepEqual(draps.valeur, { timo: '2026-10-14', pablo: '2026-10-02', parents: '2026-09-30' });
});
