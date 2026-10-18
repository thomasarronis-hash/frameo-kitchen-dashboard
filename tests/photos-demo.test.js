// tests/photos-demo.test.js
//
// Rôle    : prouver que le faux Immich de démonstration (serveur/sources/immich-demo.js) n'existe pas en production et
//           qu'il fait bien tourner la vraie chaîne en développement : config.js refuse IMMICH_DEMO=1 hors de
//           NODE_ENV=development (tests/config.test.js), aucun module du serveur ne l'importe en dur (seul index.js, par
//           import dynamique sous IMMICH_DEMO), .dockerignore l'exclut de l'image ; ses réponses passent par le vrai
//           client et les vraies routes (lot dans un ordre connu, photo mise à la corbeille en 410, images PNG, clé exigée).
// Entrées : les fichiers du dépôt (serveur/, .dockerignore, Dockerfile) ; le faux Immich lancé sur 127.0.0.1.
// Sorties : node --test.
// Pièges  : le contrôle des imports se fait par motifs sur le texte des modules : un import écrit autrement (chaîne
//           construite) passerait, d'où aussi l'exclusion de l'image Docker, qui ne dépend pas du code.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { demarrerImmichDemo } from '../serveur/sources/immich-demo.js';
import { creerImmich } from '../serveur/sources/immich.js';
import { CLE, monter } from './aides.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8');

test('la démonstration n\'entre pas dans l\'image Docker et n\'est importée en dur par aucun module du serveur', () => {
  const ignores = lire('.dockerignore').split('\n').map((ligne) => ligne.trim());
  assert.ok(ignores.includes('serveur/sources/immich-demo.js'), '.dockerignore doit exclure le faux Immich');
  assert.match(lire('Dockerfile'), /^COPY serveur\/ serveur\/$/m, 'le Dockerfile copie serveur/ en entier : l\'exclusion passe par .dockerignore');
  const modules = readdirSync(join(RACINE, 'serveur'), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => join('serveur', f));
  const importeurs = modules.filter((chemin) => /immich-demo\.js/.test(lire(chemin).replace(/^\/\/.*$/gm, '')));
  assert.deepEqual(importeurs, [join('serveur', 'index.js')], 'seul index.js en parle');
  const index = lire('serveur/index.js');
  assert.doesNotMatch(index, /^import .*immich-demo/m, 'jamais d\'import statique');
  assert.match(index, /config\.immich\.demo \? await \(await import\('\.\/sources\/immich-demo\.js'\)\)/, 'import dynamique sous IMMICH_DEMO seulement');
});

test('démonstration : lot dans un ordre connu, photo mise à la corbeille en 410, images PNG relayées, clé exigée', async (t) => {
  const demo = await demarrerImmichDemo();
  t.after(() => demo.arreter());
  const intrus = creerImmich({ url: demo.url, cle: 'pas-la-bonne-cle', source: { type: 'tout' } });
  await assert.rejects(intrus.lot(), /clé refusée par Immich \(401\)/);

  const { app } = await monter({ immich: creerImmich({ url: demo.url, cle: demo.cle, source: { type: 'tout' } }) });
  t.after(() => app.close());
  const avecCle = (url) => app.inject({ url, headers: { 'x-cadre-cle': CLE } });
  const lot = (await avecCle('/api/photos/lot')).json();
  assert.deepEqual(lot.map((photo) => [photo.id.slice(-1), photo.portrait, photo.legende]), [
    ['1', false, 'Annecy · juillet 2024'],
    ['2', true, 'Biarritz · août 2023'],
    ['3', true, 'Chambéry · mai 2025'],
    ['4', true, 'Suisse · décembre 2024'],
    ['5', false, 'Annecy · octobre 2025'],
    ['6', true, 'Mars 2023'],
    ['7', false, null],
  ]);
  for (const photo of lot) {
    const reponse = await avecCle(`/api/photos/${photo.id}.jpg`);
    if (photo.id.endsWith('2')) {
      assert.equal(reponse.statusCode, 410, 'mise à la corbeille après le lot');
      continue;
    }
    assert.equal(reponse.statusCode, 200, photo.id);
    assert.equal(reponse.headers['content-type'], 'image/png');
    assert.deepEqual([...reponse.rawPayload.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
    const largeur = reponse.rawPayload.readUInt32BE(16);
    const hauteur = reponse.rawPayload.readUInt32BE(20);
    assert.equal(hauteur > largeur, photo.portrait, `dimensions de ${photo.id}`);
  }
});
