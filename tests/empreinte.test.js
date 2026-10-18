// tests/empreinte.test.js
//
// Rôle    : prouver l'empreinte du contenu servi (serveur/empreinte.js) et son trajet jusqu'à la page : stable tant que
//           rien ne change, différente dès qu'un fichier est modifié, ajouté, retiré ou renommé, null sans dossier ; elle
//           part dans l'instantané du flux (et pas dans les maj) et dans /api/sante. Le dossier web réel en a une.
// Entrées : un dossier web temporaire (os.tmpdir()) ; web/ du dépôt ; l'application montée par tests/aides.js.
// Sorties : node --test.
// Pièges  : l'empreinte est calculée par index.js au démarrage ; ici on la calcule et on la passe à l'application,
//           comme index.js.

import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { empreinteDossier } from '../serveur/empreinte.js';
import {
  CLE, FausseSource, monter, ouvrirFlux, VERSION,
} from './aides.js';

const WEB = fileURLToPath(new URL('../web', import.meta.url));

function dossierWeb(t) {
  const dossier = mkdtempSync(join(tmpdir(), 'cadre-web-'));
  t.after(() => rmSync(dossier, { recursive: true, force: true }));
  mkdirSync(join(dossier, 'src'));
  writeFileSync(join(dossier, 'index.html'), '<p>page</p>');
  writeFileSync(join(dossier, 'src', 'main.js'), 'export const a = 1;');
  return dossier;
}

test('empreinte : 16 caractères hexadécimaux, stable, changée par une modification, un ajout, un renommage ou un retrait', (t) => {
  const dossier = dossierWeb(t);
  const vues = new Set();
  const noter = () => {
    const empreinte = empreinteDossier(dossier);
    assert.match(empreinte, /^[0-9a-f]{16}$/);
    vues.add(empreinte);
    return empreinte;
  };
  const depart = noter();
  assert.equal(empreinteDossier(dossier), depart, 'rien ne change : même empreinte');
  writeFileSync(join(dossier, 'src', 'main.js'), 'export const a = 2;');
  noter();
  writeFileSync(join(dossier, 'src', 'tempo.js'), 'export const b = 1;');
  noter();
  renameSync(join(dossier, 'src', 'tempo.js'), join(dossier, 'src', 'tempo2.js'));
  noter();
  unlinkSync(join(dossier, 'src', 'tempo2.js'));
  writeFileSync(join(dossier, 'src', 'main.js'), 'export const a = 1;');
  assert.equal(noter(), depart, 'même contenu, même empreinte');
  assert.equal(vues.size, 4);
});

test('empreinte : null sans dossier web ; le vrai dossier web/ du dépôt en a une', () => {
  assert.equal(empreinteDossier('/inexistant/web'), null);
  assert.match(empreinteDossier(WEB), /^[0-9a-f]{16}$/);
});

test('empreinte : dans l\'instantané du flux et dans /api/sante, jamais dans une maj', async (t) => {
  const semaine = new FausseSource(null);
  const { app } = await monter({ empreinte: 'a1b2c3d4e5f60718', sources: { semaine } });
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const flux = await ouvrirFlux(`${adresse}/api/flux`, { 'x-cadre-cle': CLE });
  t.after(() => flux.fermer());
  const instantane = await flux.lireEvenement();
  assert.equal(instantane.donnees.empreinte, 'a1b2c3d4e5f60718');
  semaine.publier({ jours: [] });
  const maj = await flux.lireEvenement();
  assert.deepEqual(maj.donnees, { semaine: { jours: [] } });
  const sante = await app.inject({ method: 'GET', url: '/api/sante' });
  assert.deepEqual(sante.json(), { ha: 'ok', version: VERSION, empreinte: 'a1b2c3d4e5f60718' });
});
