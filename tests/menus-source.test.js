// tests/menus-source.test.js
//
// Rôle    : prouver serveur/sources/menus.js : choix du menu dont le cycle couvre aujourd'hui (heure de Paris,
//           maj_le comparé en instants), fichiers invalides ignorés et journalisés, dernière version valide
//           gardée après une republication ratée, fichiers cachés ignorés, dossier absent sans erreur,
//           surveillance du dossier (sans attendre le sondage de 60 s), et événement menu dans le flux SSE.
// Entrées : tests/fixtures/menu-2026-10-10.json, copié dans un dossier temporaire (os.tmpdir(), donc TMPDIR).
// Sorties : node --test.
// Pièges  :
//   - L'horloge de la source est remplacée (maintenant) : le test ne dépend pas du jour où il tourne.
//   - Le test de surveillance attend un vrai événement fs.watch (au plus 5 s) ; le sondage de 60 s ne peut
//     pas tomber pendant ce temps.

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { choisirMenu, SourceMenus } from '../serveur/sources/menus.js';
import { CLE, monter, ouvrirFlux } from './aides.js';

const MENU = JSON.parse(readFileSync(new URL('./fixtures/menu-2026-10-10.json', import.meta.url), 'utf8'));

function journalCapture() {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m) };
}

function preparer(t, { maintenant = new Date('2026-10-11T10:00:00Z'), creerDossier = true } = {}) {
  const racine = mkdtempSync(join(tmpdir(), 'cadre-menus-'));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  const dossier = join(racine, 'menus');
  if (creerDossier) mkdirSync(dossier);
  const horloge = { maintenant };
  const journal = journalCapture();
  const source = new SourceMenus({ dossier, journal, maintenant: () => horloge.maintenant });
  t.after(() => source.arreter());
  return { dossier, horloge, journal, source };
}

function ecrireMenu(dossier, nom, menu) {
  writeFileSync(join(dossier, nom), typeof menu === 'string' ? menu : JSON.stringify(menu));
}

const variante = (menu, changements) => ({ ...structuredClone(menu), ...changements });

test('choisirMenu : cycle qui couvre aujourd\'hui, bornes comprises ; aucun sinon', () => {
  const menus = [{ nom: '2026-10-10.json', menu: MENU }];
  for (const jour of ['2026-10-10', '2026-10-13', '2026-10-16']) assert.equal(choisirMenu(menus, jour), MENU, jour);
  for (const jour of ['2026-10-09', '2026-10-17']) assert.equal(choisirMenu(menus, jour), null, jour);
});

test('choisirMenu : plusieurs menus couvrent le jour, le plus récent par maj_le, comparé en instants', () => {
  const ancien = variante(MENU, { maj_le: '2026-10-09T20:00:00+02:00' });
  const recent = variante(MENU, { maj_le: '2026-10-09T19:00:00Z' });
  assert.equal(choisirMenu([{ nom: 'a.json', menu: ancien }, { nom: 'b.json', menu: recent }], '2026-10-12'), recent);
  assert.equal(choisirMenu([{ nom: 'b.json', menu: recent }, { nom: 'a.json', menu: ancien }], '2026-10-12'), recent);
});

test('heure de Paris : le vendredi à 23:59:59 le menu est encore là, à minuit (22:00 UTC) il ne l\'est plus', async (t) => {
  const { dossier, horloge, source } = preparer(t, { maintenant: new Date('2026-10-16T21:59:59Z') });
  ecrireMenu(dossier, '2026-10-10.json', MENU);
  assert.deepEqual(await source.lire(), MENU);
  horloge.maintenant = new Date('2026-10-16T22:00:00Z');
  assert.equal(await source.lire(), null);
  horloge.maintenant = new Date('2026-10-09T22:00:00Z');
  assert.deepEqual(await source.lire(), MENU, 'samedi 10 à 0:00 à Paris, encore vendredi en UTC');
});

test('fichiers invalides ignorés et journalisés une fois ; cachés et non JSON ignorés sans bruit', async (t) => {
  const { dossier, journal, source } = preparer(t);
  ecrireMenu(dossier, 'casse.json', variante(MENU, { statut: 'brouillon' }));
  ecrireMenu(dossier, 'illisible.json', '{ pas du JSON');
  ecrireMenu(dossier, '.2026-10-10.json.Xy12Ab', '{ moitié');
  ecrireMenu(dossier, 'notes.txt', 'rien');
  assert.equal(await source.lire(), null);
  assert.equal(await source.lire(), null);
  const texte = journal.lignes.join('\n');
  assert.match(texte, /menus : casse\.json ignoré, invalide : statut : valeur attendue parmi "valide", "commande"/);
  assert.match(texte, /menus : illisible\.json ignoré, invalide : fichier illisible ou JSON invalide/);
  assert.equal(journal.lignes.length, 2, 'un seul message par version de fichier, rien pour les fichiers cachés ou non JSON');
  ecrireMenu(dossier, '2026-10-10.json', MENU);
  assert.deepEqual(await source.lire(), MENU);
});

test('republication ratée sous le même nom : la dernière version valide reste retenue', async (t) => {
  const { dossier, journal, source } = preparer(t);
  ecrireMenu(dossier, '2026-10-10.json', MENU);
  assert.deepEqual(await source.lire(), MENU);
  const casse = structuredClone(MENU);
  casse.repas.pop();
  ecrireMenu(dossier, '2026-10-10.json', casse);
  assert.deepEqual(await source.lire(), MENU);
  assert.match(journal.lignes.join('\n'), /2026-10-10\.json ignoré, invalide \(sa dernière version valide reste retenue\) : .*créneau manquant, vendredi 16\/10 soir/);
  const corrige = variante(MENU, { maj_le: '2026-10-10T08:00:00+02:00' });
  ecrireMenu(dossier, '2026-10-10.json', corrige);
  assert.deepEqual(await source.lire(), corrige);
});

test('maj publiée seulement quand le menu retenu change ; fichier retiré : null', async (t) => {
  const { dossier, source } = preparer(t);
  const maj = [];
  source.on('maj', (valeur) => maj.push(valeur));
  ecrireMenu(dossier, '2026-10-10.json', MENU);
  await source.actualiser();
  await source.actualiser();
  unlinkSync(join(dossier, '2026-10-10.json'));
  await source.actualiser();
  assert.deepEqual(maj, [MENU, null]);
});

test('dossier absent : aucun menu, journalisé une fois ; le menu est lu dès que le dossier apparaît', async (t) => {
  const { dossier, journal, source } = preparer(t, { creerDossier: false });
  assert.equal(await source.lire(), null);
  assert.equal(await source.lire(), null);
  assert.equal(journal.lignes.filter((l) => /dossier .* absent/.test(l)).length, 1);
  mkdirSync(dossier);
  ecrireMenu(dossier, '2026-10-10.json', MENU);
  assert.deepEqual(await source.lire(), MENU);
});

test('surveillance : un menu déposé est vu par fs.watch, sans attendre le sondage de 60 s', async (t) => {
  const { dossier, source } = preparer(t);
  source.demarrer();
  await source.actualiser();
  const arrivee = once(source, 'maj');
  const temoin = setTimeout(() => source.emit('maj', 'trop tard'), 5_000);
  t.after(() => clearTimeout(temoin));
  ecrireMenu(dossier, '2026-10-10.json', MENU);
  const [valeur] = await arrivee;
  assert.deepEqual(valeur, MENU);
});

test('flux : la clé menu de l\'instantané, puis l\'événement menu à la publication, sans rechargement', async (t) => {
  const { dossier, source } = preparer(t);
  await source.actualiser();
  const { app } = await monter({ sources: { menu: source } });
  t.after(() => app.close());
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  const flux = await ouvrirFlux(`${adresse}/api/flux`, { 'x-cadre-cle': CLE });
  const instantane = await flux.lireEvenement();
  assert.equal(instantane.donnees.menu, null);
  ecrireMenu(dossier, '2026-10-10.json', MENU);
  await source.actualiser();
  const evenement = await flux.lireEvenement();
  flux.fermer();
  assert.equal(evenement.nom, 'menu');
  assert.deepEqual(evenement.donnees, { menu: MENU });
  const route = await app.inject({ method: 'GET', url: '/api/menu', headers: { 'x-cadre-cle': CLE } });
  assert.equal(route.statusCode, 200);
  assert.deepEqual(route.json(), { menu: MENU });
});
