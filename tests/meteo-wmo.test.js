// tests/meteo-wmo.test.js
//
// Rôle    : prouver web/src/ciel.js : chaque code WMO documenté par Open-Meteo et chaque condition de
//           Home Assistant donne un libellé français et un pictogramme qui existe dans le sprite ; un code
//           ou une condition inconnus ne donnent ni pictogramme ni libellé inventés.
// Entrées : web/public/icones.svg (identifiants des symboles).
// Sorties : node --test.
// Pièges  : la liste des codes est recopiée ici depuis la doc Open-Meteo (table « WMO Weather
//           interpretation codes »), indépendamment du module testé.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cielHA, cielWmo } from '../web/src/ciel.js';

const SPRITE = readFileSync(new URL('../web/public/icones.svg', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const SYMBOLES = new Set([...SPRITE.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
const CODES_WMO = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
const CONDITIONS_HA = ['clear-night', 'cloudy', 'exceptional', 'fog', 'hail', 'lightning', 'lightning-rainy', 'partlycloudy',
  'pouring', 'rainy', 'snowy', 'snowy-rainy', 'sunny', 'windy', 'windy-variant'];

test('chaque code WMO documenté a un libellé et un pictogramme du sprite', () => {
  for (const code of CODES_WMO) {
    const { picto, libelle } = cielWmo(code);
    assert.ok(libelle.length > 0, `code ${code} sans libellé`);
    assert.ok(SYMBOLES.has(picto), `code ${code} : pictogramme ${picto} absent du sprite`);
  }
});

test('quelques correspondances WMO attendues', () => {
  assert.deepEqual(cielWmo(0), { picto: 'i-sun', libelle: 'Ensoleillé' });
  assert.deepEqual(cielWmo(2), { picto: 'i-partly', libelle: 'Éclaircies' });
  assert.deepEqual(cielWmo(3), { picto: 'i-cloud', libelle: 'Couvert' });
  assert.deepEqual(cielWmo(45), { picto: 'i-fog', libelle: 'Brouillard' });
  assert.deepEqual(cielWmo(63), { picto: 'i-rain', libelle: 'Pluie' });
  assert.deepEqual(cielWmo(73), { picto: 'i-snow', libelle: 'Neige' });
  assert.deepEqual(cielWmo(95), { picto: 'i-storm', libelle: 'Orage' });
});

test('code WMO inconnu ou absent : ni pictogramme ni libellé', () => {
  for (const code of [4, 10, 50, 100, -1, null, undefined, NaN]) {
    assert.deepEqual(cielWmo(code), { picto: null, libelle: '' }, String(code));
  }
});

test('chaque condition HA a un libellé ; un pictogramme du sprite sauf « exceptionnel »', () => {
  for (const condition of CONDITIONS_HA) {
    const { picto, libelle } = cielHA(condition);
    assert.ok(libelle.length > 0, `${condition} sans libellé`);
    if (condition === 'exceptional') assert.equal(picto, null);
    else assert.ok(SYMBOLES.has(picto), `${condition} : pictogramme ${picto} absent du sprite`);
  }
  assert.deepEqual(cielHA('partlycloudy'), { picto: 'i-partly', libelle: 'Éclaircies' });
  assert.deepEqual(cielHA('clear-night'), { picto: 'i-moon', libelle: 'Nuit claire' });
});

test('météo HA indisponible ou condition inconnue', () => {
  assert.deepEqual(cielHA('unavailable'), { picto: null, libelle: 'Météo indisponible' });
  assert.deepEqual(cielHA('unknown'), { picto: null, libelle: 'Météo indisponible' });
  assert.deepEqual(cielHA('tornado'), { picto: null, libelle: '' });
  assert.deepEqual(cielHA(undefined), { picto: null, libelle: '' });
});
