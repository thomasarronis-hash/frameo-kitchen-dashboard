// tests/cadence.test.js
//
// Rôle    : prouver la cadence des photos (serveur/cadence.js) : chaque bloc est découpé en morceaux qui partent à leur
//           tour (pas de rafale vers le Wi-Fi du cadre, constat du 14/10), le débit est PARTAGÉ entre les flux (une paire
//           de portraits ne va pas deux fois plus vite), un silence n'accumule aucun crédit, le contenu arrive intact et
//           un flux détruit s'arrête ; valeurs de production écrites en dur (256 Ko/s, 4 Ko).
// Entrées : de vrais minuteurs, à un débit de test (4 Ko toutes les 10 ms) pour rester rapide.
// Sorties : node --test.
// Pièges  : les durées sont mesurées sur l'horloge réelle : on vérifie des minimums (jamais plus vite que la cadence)
//           et une marge large au-dessus, pour ne pas dépendre de la charge de la machine.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { creerCadence, DEBIT_PHOTOS, MORCEAU_PHOTOS } from '../serveur/cadence.js';

const MORCEAU = 4096;
const PAS_MS = 10;
const cadenceDeTest = () => creerCadence({ octetsParSeconde: (MORCEAU * 1000) / PAS_MS, morceau: MORCEAU });

// Fait passer octets dans un flux de la cadence ; rend { recu (Buffer), morceaux (tailles), duree (ms) }.
async function traverser(cadence, octets) {
  const debut = Date.now();
  const morceaux = [];
  const recus = [];
  for await (const part of Readable.from([octets]).pipe(cadence.flux())) {
    morceaux.push(part.length);
    recus.push(part);
  }
  return { recu: Buffer.concat(recus), morceaux, duree: Date.now() - debut };
}

test('cadence : valeurs de production, 256 Ko/s en morceaux de 4 Ko', () => {
  assert.equal(DEBIT_PHOTOS, 262144);
  assert.equal(MORCEAU_PHOTOS, 4096);
});

test('cadence : un bloc de 40 Ko part en 10 morceaux de 4 Ko au plus, espacés (jamais d\'un coup), contenu intact', async () => {
  const octets = Buffer.from(Array.from({ length: 40 * 1024 }, (_v, i) => i % 251));
  const { recu, morceaux, duree } = await traverser(cadenceDeTest(), octets);
  assert.deepEqual(recu, octets);
  assert.deepEqual(morceaux, Array(10).fill(4096));
  assert.ok(duree >= 9 * PAS_MS - 5, `9 attentes de 10 ms au moins (${duree} ms)`);
  assert.ok(duree < 10000, `sans traîner (${duree} ms ; marge large : la suite complète charge la machine)`);
});

test('cadence : débit partagé, deux photos en même temps vont chacune à moitié vitesse', async () => {
  const cadence = cadenceDeTest();
  const debut = Date.now();
  const [a, b] = await Promise.all([traverser(cadence, Buffer.alloc(40 * 1024, 1)), traverser(cadence, Buffer.alloc(40 * 1024, 2))]);
  const total = Date.now() - debut;
  assert.equal(a.recu.length + b.recu.length, 80 * 1024);
  assert.ok(a.recu.every((o) => o === 1) && b.recu.every((o) => o === 2), 'pas de mélange entre les flux');
  assert.ok(total >= 19 * PAS_MS - 5, `20 morceaux au total, 19 attentes au moins (${total} ms)`);
});

test('cadence : un silence n\'accumule pas de crédit (pas de rafale de rattrapage)', async () => {
  const cadence = cadenceDeTest();
  await traverser(cadence, Buffer.alloc(MORCEAU));
  await new Promise((resoudre) => { setTimeout(resoudre, 100); });
  const { duree } = await traverser(cadence, Buffer.alloc(40 * 1024));
  assert.ok(duree >= 9 * PAS_MS - 5, `après 100 ms de silence, toujours un morceau toutes les 10 ms (${duree} ms)`);
});

test('cadence : un flux détruit s\'arrête et ne retient plus le débit des autres', async () => {
  const cadence = cadenceDeTest();
  const flux = cadence.flux();
  let recus = 0;
  flux.on('data', (part) => { recus += part.length; });
  flux.on('error', () => {});
  flux.write(Buffer.alloc(400 * 1024));
  await new Promise((resoudre) => { setTimeout(resoudre, 3 * PAS_MS); });
  flux.destroy();
  const vus = recus;
  await new Promise((resoudre) => { setTimeout(resoudre, 5 * PAS_MS); });
  assert.equal(recus, vus, 'plus rien après la destruction');
  assert.ok(vus < 400 * 1024);
  const { duree } = await traverser(cadence, Buffer.alloc(MORCEAU));
  assert.ok(duree < 60 * PAS_MS, `un autre flux repart sans attendre les 100 morceaux abandonnés (${duree} ms)`);
});
