// tests/sprite.test.js
//
// Rôle    : prouver le chargement du sprite d'icônes dans la page (web/src/sprite.js) : demandé en cache « no-cache »,
//           posé une fois en tête de body, masqué sans display: none ; nouvel essai après un échec (réseau, HTTP, réponse
//           sans symbole) avec les attentes 5 s, 10 s, 30 s puis 60 s ; et les icônes (web/src/dom.js) qui pointent vers
//           le document (#i-...), jamais vers le fichier externe.
// Entrées : un faux document juste assez riche pour sprite.js (createElement, innerHTML lu par motifs, querySelector,
//           body.insertBefore) ; une fausse requête et une fausse attente.
// Sorties : node --test.
// Pièges  : le faux document ne parse pas le HTML : innerHTML retient le texte et querySelector répond d'après lui.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chargerSprite, ESSAIS_MS } from '../web/src/sprite.js';
import { installerFauxDom } from './faux-dom.js';

const SPRITE = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="i-clim" viewBox="0 0 24 24"></symbol></svg>';

function fauxDocument() {
  const poses = [];
  const svg = {
    attributs: {},
    style: {},
    setAttribute(nom, valeur) { this.attributs[nom] = valeur; },
  };
  const document = {
    createElement: () => {
      const hote = { innerHTML: '' };
      hote.querySelector = () => (/<svg[\s>]/.test(hote.innerHTML)
        ? Object.assign(svg, { querySelector: () => (/<symbol /.test(hote.innerHTML) ? {} : null) })
        : null);
      return hote;
    },
    body: { firstChild: 'premier', insertBefore: (noeud, avant) => poses.push({ noeud, avant }) },
  };
  return { document, poses, svg };
}

const reponse = (texte, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 503, text: () => Promise.resolve(texte) });

test('sprite : demandé en no-cache, posé une fois en tête de body, masqué sans display: none', async () => {
  const { document, poses, svg } = fauxDocument();
  const demandes = [];
  await chargerSprite({ requete: (url, options) => { demandes.push([url, options]); return reponse(SPRITE); }, document, attendre: () => assert.fail('aucune attente') });
  assert.deepEqual(demandes, [['/icones.svg', { cache: 'no-cache' }]]);
  assert.equal(poses.length, 1);
  assert.equal(poses[0].avant, 'premier');
  assert.deepEqual(svg.attributs, { width: '0', height: '0', 'aria-hidden': 'true', 'data-sprite': '' });
  assert.deepEqual(svg.style, { position: 'absolute', overflow: 'hidden' });
});

test('sprite : échecs (réseau, HTTP, réponse sans symbole) puis réussite, attentes 5 s, 10 s, 30 s, 60 s, 60 s', async () => {
  const { document, poses } = fauxDocument();
  const reponses = [
    () => Promise.reject(new Error('réseau')),
    () => reponse('', false),
    () => reponse('<html>erreur</html>'),
    () => reponse('<svg></svg>'),
    () => Promise.reject(new Error('réseau')),
    () => reponse(SPRITE),
  ];
  const attentes = [];
  const fini = chargerSprite({
    requete: () => reponses.shift()(),
    document,
    attendre: (rappel, ms) => { attentes.push(ms); setImmediate(rappel); },
  });
  await fini;
  assert.deepEqual(attentes, [5000, 10000, 30000, 60000, 60000]);
  assert.deepEqual(ESSAIS_MS, [5000, 10000, 30000, 60000]);
  assert.equal(poses.length, 1, 'posé une seule fois');
});

test('icônes : elles pointent vers le sprite posé dans la page (#i-...), jamais vers /icones.svg', async () => {
  installerFauxDom();
  const { icone, changerIcone } = await import('../web/src/dom.js');
  const svg = icone('i-clim');
  assert.equal(svg.firstChild.getAttribute('href'), '#i-clim');
  changerIcone(svg, 'i-flocon');
  assert.equal(svg.firstChild.getAttribute('href'), '#i-flocon');
});
