// tests/rechargement-version.test.js
//
// Rôle    : prouver le rechargement de la page après un déploiement (web/src/rechargement.js, web/src/pilotage.js) : la
//           première empreinte reçue est retenue, la même à la reconnexion ne fait rien, une autre déclenche le
//           rechargement, mais pas tant qu'un minuteur tourne ou sonne, qu'une recette est ouverte, que l'écran Enfants
//           est ouvert ou que le bandeau sonnette est affiché, ni avant 60 s sans toucher ; une empreinte absente
//           (serveur plus ancien) n'est jamais comparée.
// Entrées : aucune (règles sans DOM).
// Sorties : node --test.
// Pièges  : etatMinuteurs a la forme de minuteurs.etat(ms) : { enCours, sonnants, ... }.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rechargementVersionBloque } from '../web/src/pilotage.js';
import { creerSuiviVersion, doitRechargerVersion } from '../web/src/rechargement.js';

const RIEN = { enCours: [], sonnants: [] };
const libre = {
  recetteOuverte: false, etatMinuteurs: RIEN, sonnetteVisible: false, ecranActif: 'accueil',
};

test('empreinte : la première est retenue, la même à la reconnexion ne fait rien, une autre annonce une nouvelle version', () => {
  const version = creerSuiviVersion();
  version.observer(null);
  version.observer(undefined);
  assert.equal(version.nouvelle(), false, 'serveur sans empreinte : rien à comparer');
  version.observer('aaaa000011112222');
  version.observer('aaaa000011112222');
  assert.equal(version.nouvelle(), false, 'serveur redémarré sans déploiement');
  version.observer(null);
  assert.equal(version.nouvelle(), false);
  version.observer('bbbb000011112222');
  assert.equal(version.nouvelle(), true);
  version.observer('aaaa000011112222');
  assert.equal(version.nouvelle(), true, 'une fois annoncée, la nouvelle version reste à charger');
});

test('rechargement après déploiement : seulement avec une nouvelle version, rien qui bloque et 60 s sans toucher', () => {
  assert.equal(doitRechargerVersion({ nouvelle: false, bloque: false, inactifMs: 600_000 }), false);
  assert.equal(doitRechargerVersion({ nouvelle: true, bloque: false, inactifMs: 59_999 }), false, 'quelqu\'un vient de toucher l\'écran');
  assert.equal(doitRechargerVersion({ nouvelle: true, bloque: true, inactifMs: 600_000 }), false);
  assert.equal(doitRechargerVersion({ nouvelle: true, bloque: false, inactifMs: 60_000 }), true);
});

test('ce qui bloque : minuteur qui tourne ou qui sonne, recette ouverte, écran Enfants, bandeau sonnette ; pas le mode Photos', () => {
  assert.equal(rechargementVersionBloque(libre), false);
  assert.equal(rechargementVersionBloque({ ...libre, etatMinuteurs: { enCours: [{ id: 1 }], sonnants: [] } }), true);
  assert.equal(rechargementVersionBloque({ ...libre, etatMinuteurs: { enCours: [], sonnants: [{ id: 1 }] } }), true);
  assert.equal(rechargementVersionBloque({ ...libre, recetteOuverte: true }), true);
  assert.equal(rechargementVersionBloque({ ...libre, ecranActif: 'enfants' }), true);
  assert.equal(rechargementVersionBloque({ ...libre, sonnetteVisible: true }), true);
  assert.equal(rechargementVersionBloque({ ...libre, ecranActif: 'photos' }), false);
  assert.equal(rechargementVersionBloque({ ...libre, ecranActif: 'maison' }), false);
});
