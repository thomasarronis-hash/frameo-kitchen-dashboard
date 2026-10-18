// tests/immich.test.js
//
// Rôle    : prouver le client Immich (serveur/sources/immich.js) et ses routes (serveur/routes/photos.js) contre un faux
//           Immich : corps exact du lot (filtre IMAGE, timeline, hors corbeille, puis album, favoris ou rien de plus pour toute
//           la photothèque, 100 photos, EXIF), clé
//           en x-api-key et jamais dans l'URL, projection { id, portrait, legende } refiltrée, revérification avant
//           chaque photo (410 : corbeille, archive, plus favorite, supprimée), seules les photos d'un lot rendu
//           relayées (410 sans appel à Immich sinon, album compris), miniature preview relayée en flux et en no-store,
//           erreurs d'Immich en 502 au message clair, réponse JSON en morceaux plafonnée pendant la lecture, aucune
//           redirection suivie, uuid contrôlé (400), routes sans clé (404 « à configurer »), transfert abandonné quand
//           le cadre s'en va, au bout de sa durée maximale ou quand la photo dépasse sa taille maximale.
// Entrées : un faux Immich, vrai serveur HTTP sur 127.0.0.1 (port choisi par le système), dont chaque test règle les
//           réponses ; l'application montée par tests/aides.js.
// Sorties : node --test.
// Pièges  : la clé factice est cherchée dans les URL reçues et dans le journal du serveur : elle ne doit apparaître
//           dans aucun des deux.

import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';
import {
  corpsRecherche, creerImmich, ErreurImmich, lireVersion, PHOTOS_PAR_LOT,
} from '../serveur/sources/immich.js';
import { CLE, monter } from './aides.js';

const CLE_IMMICH = 'cle-immich-factice-ne-doit-jamais-sortir';
const ALBUM = '3f6c2a1e-8b4d-4c2a-9e1f-0a1b2c3d4e5f';
const ID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3, 4, 0xff, 0xd9]);

function asset(n, champs = {}) {
  return {
    id: ID(n),
    type: 'IMAGE',
    isTrashed: false,
    isFavorite: true,
    visibility: 'timeline',
    width: 1440,
    height: 1080,
    localDateTime: '2024-07-14T16:20:00.000Z',
    fileCreatedAt: '2024-07-14T14:20:00.000Z',
    exifInfo: {
      city: 'Annecy', country: 'France', dateTimeOriginal: '2024-07-14T14:20:00.000Z', exifImageWidth: 1440, exifImageHeight: 1080, orientation: '1', latitude: 45.9, longitude: 6.1,
    },
    ...champs,
  };
}

// Faux Immich : gerer(req, res, corps) répond ; chaque requête est notée (méthode, url, clé, corps JSON).
async function fauxImmich(t, gerer) {
  const requetes = [];
  const fermetures = [];
  const serveur = http.createServer((req, res) => {
    let texte = '';
    req.on('data', (bout) => { texte += bout; });
    req.on('end', () => {
      const requete = { methode: req.method, url: req.url, cle: req.headers['x-api-key'], corps: texte ? JSON.parse(texte) : null };
      requetes.push(requete);
      res.on('close', () => fermetures.push(req.url));
      gerer(req, res, requete);
    });
  });
  serveur.listen(0, '127.0.0.1');
  await once(serveur, 'listening');
  t.after(() => {
    serveur.closeAllConnections();
    serveur.close();
  });
  return { url: `http://127.0.0.1:${serveur.address().port}`, requetes, fermetures };
}

const json = (res, statut, donnees) => {
  res.writeHead(statut, { 'content-type': 'application/json' });
  res.end(JSON.stringify(donnees));
};

// Immich ordinaire : le lot donné, chaque asset revérifié tel quel, la miniature en JPEG.
function immichOrdinaire(lot, { verification = (id) => lot.find((a) => a.id === id), miniature } = {}) {
  return (req, res) => {
    if (req.url === '/api/search/random') return json(res, 200, lot);
    const trouve = /^\/api\/assets\/([^/?]+)(\/thumbnail)?/.exec(req.url);
    if (!trouve) return json(res, 404, { message: 'introuvable' });
    if (!trouve[2]) {
      const a = verification(trouve[1]);
      return a ? json(res, 200, a) : json(res, 400, { message: 'Not found or no asset.read access' });
    }
    if (miniature) return miniature(req, res);
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': JPEG.length });
    return res.end(JPEG);
  };
}

const lireTout = async (flux) => {
  const morceaux = [];
  for await (const morceau of flux) morceaux.push(morceau);
  return Buffer.concat(morceaux);
};

test('lot : POST /api/search/random, filtre exact (toute la photothèque, album OU favoris), 100 photos avec EXIF, clé en x-api-key seulement', async (t) => {
  const immich = await fauxImmich(t, immichOrdinaire([asset(1)]));
  assert.equal(PHOTOS_PAR_LOT, 100);
  const parAlbum = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'album', albumId: ALBUM } });
  const parFavoris = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' } });
  const toutes = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'tout' } });
  assert.deepEqual([parAlbum.source, parFavoris.source, toutes.source], ['album', 'favoris', 'tout']);
  await parAlbum.lot();
  await parFavoris.lot();
  await toutes.lot();
  const filtreCommun = { type: { eq: 'IMAGE' }, visibility: { eq: 'timeline' }, trashedAt: { eq: null } };
  assert.deepEqual(immich.requetes[0], {
    methode: 'POST', url: '/api/search/random', cle: CLE_IMMICH, corps: { size: 100, withExif: true, filter: { ...filtreCommun, albumIds: { any: [ALBUM] } } },
  });
  assert.deepEqual(immich.requetes[1].corps, { size: 100, withExif: true, filter: { ...filtreCommun, isFavorite: { eq: true } } });
  assert.deepEqual(immich.requetes[2].corps, { size: 100, withExif: true, filter: filtreCommun }, 'toute la photothèque : images de la chronologie, hors corbeille, rien de plus');
  assert.deepEqual(corpsRecherche({ type: 'favoris' }), immich.requetes[1].corps);
  assert.ok(immich.requetes.every((r) => !r.url.includes(CLE_IMMICH)), 'la clé ne passe jamais dans l\'URL');
});

test('lot : projection { id, portrait, legende } sans GPS ; portrait par les dimensions affichées, sinon l\'EXIF et son orientation', async (t) => {
  const exif = (champs) => ({ ...asset(0).exifInfo, ...champs });
  const lot = [
    asset(1),
    asset(2, { width: 1080, height: 1440 }),
    asset(3, { width: null, height: null, exifInfo: exif({ exifImageWidth: 4032, exifImageHeight: 3024, orientation: '6' }) }),
    asset(4, { width: null, height: null, exifInfo: exif({ exifImageWidth: 4032, exifImageHeight: 3024, orientation: '1' }) }),
    asset(5, { width: null, height: null, exifInfo: exif({ exifImageWidth: null, exifImageHeight: null }) }),
    asset(6, { exifInfo: exif({ city: null }) }),
    asset(7, { localDateTime: '2023-03-12T15:00:00.000Z', exifInfo: exif({ city: null, country: null, dateTimeOriginal: '2023-03-12T14:00:00.000Z' }) }),
    asset(8, { exifInfo: exif({ dateTimeOriginal: null }) }),
    asset(9, { exifInfo: undefined }),
  ];
  const immich = await fauxImmich(t, immichOrdinaire(lot));
  const photos = await creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' } }).lot();
  assert.deepEqual(photos, [
    { id: ID(1), portrait: false, legende: 'Annecy · juillet 2024' },
    { id: ID(2), portrait: true, legende: 'Annecy · juillet 2024' },
    { id: ID(3), portrait: true, legende: 'Annecy · juillet 2024' },
    { id: ID(4), portrait: false, legende: 'Annecy · juillet 2024' },
    { id: ID(5), portrait: false, legende: 'Annecy · juillet 2024' },
    { id: ID(6), portrait: false, legende: 'France · juillet 2024' },
    { id: ID(7), portrait: false, legende: 'Mars 2023' },
    { id: ID(8), portrait: false, legende: 'Annecy' },
    { id: ID(9), portrait: false, legende: null },
  ]);
  assert.ok(!JSON.stringify(photos).includes('45.9'), 'aucune coordonnée');
});

test('lot : refiltré ici (vidéo, corbeille, archive, dossier verrouillé, plus favorite en mode favoris, identifiant mal formé)', async (t) => {
  const lot = [
    asset(1), asset(2, { type: 'VIDEO' }), asset(3, { isTrashed: true }), asset(4, { visibility: 'archive' }), asset(5, { visibility: 'locked' }),
    asset(6, { isFavorite: false }), asset(7, { id: '../../api/admin' }), asset(8, { id: ID(8).toUpperCase() }),
  ];
  const immich = await fauxImmich(t, immichOrdinaire(lot));
  const favoris = await creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' } }).lot();
  assert.deepEqual(favoris.map((p) => p.id), [ID(1)]);
  const album = await creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'album', albumId: ALBUM } }).lot();
  assert.deepEqual(album.map((p) => p.id), [ID(1), ID(6)], 'en mode album, une photo non favorite reste montrable');
  const toutes = await creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'tout' } }).lot();
  assert.deepEqual(toutes.map((p) => p.id), [ID(1), ID(6)], 'toute la photothèque : ni vidéo, ni corbeille, ni archivée, ni dossier verrouillé');
});

test('lot : clé refusée, erreur d\'Immich, réponse inattendue ou illisible, trop grosse, délai, Immich injoignable -> ErreurImmich 502', async (t) => {
  const cas = {
    401: (res) => json(res, 401, { message: 'Invalid API key' }),
    403: (res) => json(res, 403, { message: 'Missing required permission: asset.read' }),
    500: (res) => json(res, 500, { message: 'boum' }),
    objet: (res) => json(res, 200, { items: [] }),
    texte: (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('<html>'); },
    gros: (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(6 * 1024 * 1024) }); res.end(); },
    lent: () => {},
  };
  let courant = null;
  const immich = await fauxImmich(t, (_req, res) => cas[courant](res));
  const client = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' }, delaiMs: 200 });
  const attendus = {
    401: /lot de photos : clé refusée par Immich \(401\)/,
    403: /clé refusée par Immich \(403\)/,
    500: /lot de photos : Immich répond 500/,
    objet: /lot de photos : réponse inattendue/,
    texte: /lot de photos : réponse illisible/,
    gros: /lot de photos : réponse trop grosse/,
    lent: /Immich injoignable \(délai dépassé/,
  };
  for (const [nom, motif] of Object.entries(attendus)) {
    courant = nom;
    await assert.rejects(client.lot(), (err) => err instanceof ErreurImmich && err.statusCode === 502 && motif.test(err.message) && !err.message.includes(CLE_IMMICH), nom);
  }
  await assert.rejects(creerImmich({ url: 'http://127.0.0.1:1', cle: CLE_IMMICH, source: { type: 'favoris' } }).lot(), /Immich injoignable/);
});

test('sans clé : aucun client (null), donc aucun appel à Immich ; la version se lit sans clé', async (t) => {
  assert.equal(creerImmich({ url: 'http://127.0.0.1:1', cle: null, source: { type: 'favoris' } }), null);
  const immich = await fauxImmich(t, (req, res) => json(res, 200, { major: 3, minor: 2, patch: 0, prerelease: null }));
  assert.equal(await lireVersion(immich.url), '3.2.0');
  assert.deepEqual([immich.requetes[0].url, immich.requetes[0].cle], ['/api/server/version', undefined]);
});

test('photo : revérifiée par GET /api/assets/<id>, puis miniature preview (version retouchée) relayée telle quelle', async (t) => {
  const immich = await fauxImmich(t, immichOrdinaire([asset(1)]));
  const client = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' } });
  await client.lot();
  const photo = await client.photo(ID(1), new AbortController().signal);
  assert.deepEqual([photo.type, photo.taille], ['image/jpeg', JPEG.length]);
  assert.deepEqual(await lireTout(photo.corps), JPEG);
  assert.deepEqual(immich.requetes.slice(1).map((r) => [r.methode, r.url, r.cle]), [
    ['GET', `/api/assets/${ID(1)}`, CLE_IMMICH],
    ['GET', `/api/assets/${ID(1)}/thumbnail?size=preview&edited=true`, CLE_IMMICH],
  ]);
});

test('photo : 410 si mise à la corbeille, archivée, verrouillée, plus favorite (mode favoris seulement), devenue vidéo ou introuvable ; la miniature n\'est pas demandée', async (t) => {
  const etats = {
    1: asset(1, { isTrashed: true }), 2: asset(2, { visibility: 'archive' }), 3: asset(3, { visibility: 'locked' }), 4: asset(4, { isFavorite: false }), 5: asset(5, { type: 'VIDEO' }),
  };
  const lot = [1, 2, 3, 4, 5, 6].map((n) => asset(n));
  const immich = await fauxImmich(t, immichOrdinaire(lot, { verification: (id) => Object.values(etats).find((a) => a.id === id) }));
  const client = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' } });
  assert.equal((await client.lot()).length, 6, 'toutes montrables au moment du lot');
  for (const n of [1, 2, 3, 4, 5, 6]) {
    await assert.rejects(client.photo(ID(n), new AbortController().signal), (err) => err.statusCode === 410, `photo ${n}`);
  }
  assert.ok(immich.requetes.every((r) => !r.url.includes('/thumbnail')), 'aucune miniature demandée pour une photo retirée');
  const album = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'album', albumId: ALBUM } });
  await album.lot();
  await album.photo(ID(4), new AbortController().signal).then((photo) => lireTout(photo.corps));
  const toutes = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'tout' } });
  await toutes.lot();
  await toutes.photo(ID(4), new AbortController().signal).then((photo) => lireTout(photo.corps));
  for (const n of [1, 2, 3, 5]) {
    await assert.rejects(toutes.photo(ID(n), new AbortController().signal), (err) => err.statusCode === 410, `toute la photothèque, photo ${n}`);
  }
});

test('photo : seule une photo d\'un lot rendu est relayée ; hors lot (album compris) ou lot trop ancien, 410 SANS appel à Immich', async (t) => {
  const horsAlbum = asset(9, { isFavorite: false });
  const immich = await fauxImmich(t, immichOrdinaire([asset(1)], { verification: (id) => [asset(1), horsAlbum].find((a) => a.id === id) }));
  let horloge = Date.parse('2026-10-14T08:00:00Z');
  const album = creerImmich({
    url: immich.url, cle: CLE_IMMICH, source: { type: 'album', albumId: ALBUM }, maintenant: () => horloge,
  });
  await assert.rejects(album.photo(ID(9), new AbortController().signal), { statusCode: 410, message: 'photo absente des derniers lots' });
  assert.equal(immich.requetes.length, 0, 'aucune requête vers Immich pour une photo jamais rendue');
  await album.lot();
  await assert.rejects(album.photo(ID(9), new AbortController().signal), { statusCode: 410 });
  assert.deepEqual(immich.requetes.map((r) => r.url), ['/api/search/random'], 'photo hors album : toujours aucun appel');
  await album.photo(ID(1), new AbortController().signal).then((photo) => lireTout(photo.corps));
  horloge += 2 * 3600_000 + 1;
  const avant = immich.requetes.length;
  await assert.rejects(album.photo(ID(1), new AbortController().signal), { statusCode: 410 }, 'lot de plus de 2 h : plus relayée');
  assert.equal(immich.requetes.length, avant);
});

test('photo : miniature refusée, type inattendu, trop grosse, identifiant mal formé -> erreur claire, rien de relayé', async (t) => {
  const miniatures = {
    1: (res) => json(res, 500, { message: 'boum' }),
    2: (res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>'); },
    3: (res) => { res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(16 * 1024 * 1024) }); res.end(); },
    4: (res) => json(res, 404, { message: 'Asset media not found' }),
  };
  const lot = [1, 2, 3, 4].map((n) => asset(n));
  const immich = await fauxImmich(t, immichOrdinaire(lot, { miniature: (req, res) => miniatures[Number(req.url.slice(36, 48))](res) }));
  const client = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' } });
  await client.lot();
  const signal = () => new AbortController().signal;
  await assert.rejects(client.photo(ID(1), signal()), { statusCode: 502, message: 'miniature : Immich répond 500' });
  await assert.rejects(client.photo(ID(2), signal()), { statusCode: 502, message: 'miniature : type inattendu (text/html)' });
  await assert.rejects(client.photo(ID(3), signal()), { statusCode: 502, message: 'miniature trop grosse' });
  await assert.rejects(client.photo(ID(4), signal()), { statusCode: 410 });
  await assert.rejects(client.photo('../../server/version', signal()), { statusCode: 400 });
});

test('photo : sans Content-Length, coupée au-delà de la taille maximale ; transfert abandonné quand le cadre s\'en va', async (t) => {
  const immich = await fauxImmich(t, immichOrdinaire([asset(1), asset(2)], {
    miniature: (req, res) => {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      if (req.url.includes(ID(1))) res.end(Buffer.alloc(4096, 1));
      else res.write(JPEG);
    },
  }));
  const client = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' }, tailleMax: 1000 });
  await client.lot();
  const grosse = await client.photo(ID(1), new AbortController().signal);
  assert.equal(grosse.taille, null);
  await assert.rejects(lireTout(grosse.corps), /photo trop grosse/);

  const cadre = new AbortController();
  const lente = await client.photo(ID(2), cadre.signal);
  lente.corps.on('error', () => {});
  cadre.abort();
  for (let i = 0; i < 100 && !immich.fermetures.some((url) => url.includes(`${ID(2)}/thumbnail`)); i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.ok(immich.fermetures.some((url) => url.includes(`${ID(2)}/thumbnail`)), 'Immich n\'a pas vu la fin du transfert');
});

test('routes : clé du cadre exigée ; sans clé Immich, 404 « à configurer » ; uuid contrôlé avant tout (400)', async (t) => {
  const { app } = await monter();
  t.after(() => app.close());
  assert.equal((await app.inject({ url: '/api/photos/lot' })).statusCode, 401);
  assert.equal((await app.inject({ url: `/api/photos/${ID(1)}.jpg` })).statusCode, 401);
  const avecCle = (url) => app.inject({ url, headers: { 'x-cadre-cle': CLE } });
  for (const url of ['/api/photos/lot', `/api/photos/${ID(1)}.jpg`]) {
    const reponse = await avecCle(url);
    assert.equal(reponse.statusCode, 404, url);
    assert.deepEqual(reponse.json(), { erreur: 'photos_non_configurees', message: 'Photos Immich à configurer (IMMICH_CLE_FICHIER)' });
    assert.equal(reponse.headers['cache-control'], 'no-store');
  }
  for (const mauvais of ['abc.jpg', `${ID(1)}`, `${ID(1)}.png`, `${ID(1).toUpperCase()}.jpg`, '..%2F..%2Fserver%2Fversion.jpg', `${ID(1)}x.jpg`]) {
    const reponse = await avecCle(`/api/photos/${mauvais}`);
    assert.equal(reponse.statusCode, 400, mauvais);
    assert.equal(reponse.json().erreur, 'photo_invalide');
  }
});

test('routes : lot en no-store, photo relayée avec son type, 410 et 502 en JSON ; la clé Immich n\'apparaît jamais au journal', async (t) => {
  const lot = [asset(1), asset(2, { width: 1080, height: 1440 })];
  let panne = false;
  const immich = await fauxImmich(t, (req, res, requete) => {
    if (panne) return json(res, 503, { message: 'en maintenance' });
    return immichOrdinaire(lot, { verification: (id) => (id === ID(2) ? asset(2, { isTrashed: true }) : asset(1)) })(req, res, requete);
  });
  const { app, journal } = await monter({ immich: creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' } }) });
  t.after(() => app.close());
  const avecCle = (url) => app.inject({ url, headers: { 'x-cadre-cle': CLE } });

  let reponse = await avecCle('/api/photos/lot');
  assert.equal(reponse.statusCode, 200);
  assert.equal(reponse.headers['cache-control'], 'no-store');
  assert.deepEqual(reponse.json(), [{ id: ID(1), portrait: false, legende: 'Annecy · juillet 2024' }, { id: ID(2), portrait: true, legende: 'Annecy · juillet 2024' }]);

  reponse = await avecCle(`/api/photos/${ID(1)}.jpg`);
  assert.equal(reponse.statusCode, 200);
  assert.equal(reponse.headers['content-type'], 'image/jpeg');
  assert.equal(reponse.headers['cache-control'], 'no-store');
  assert.equal(reponse.headers['content-length'], String(JPEG.length));
  assert.deepEqual(reponse.rawPayload, JPEG);

  reponse = await avecCle(`/api/photos/${ID(2)}.jpg`);
  assert.equal(reponse.statusCode, 410);
  assert.deepEqual(reponse.json(), { erreur: 'photo_retiree', message: 'photo retirée (corbeille, archive ou filtre)' });

  panne = true;
  reponse = await avecCle('/api/photos/lot');
  assert.equal(reponse.statusCode, 502);
  assert.deepEqual(reponse.json(), { erreur: 'photos_indisponibles', message: 'lot de photos : Immich répond 503' });
  reponse = await avecCle(`/api/photos/${ID(1)}.jpg`);
  assert.equal(reponse.statusCode, 502);
  assert.equal(reponse.json().erreur, 'photo_indisponible');

  assert.ok(journal().includes('lot de photos : Immich répond 503'), 'les pannes sont journalisées');
  assert.ok(!journal().includes(CLE_IMMICH), 'la clé Immich n\'est jamais journalisée');
});

test('route photo : une coupure en amont détruit la réponse (le navigateur voit une erreur d\'image, jamais une image tronquée)', async (t) => {
  const immich = await fauxImmich(t, immichOrdinaire([asset(1)], {
    miniature: (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.write(Buffer.alloc(600, 1));
      setTimeout(() => res.end(Buffer.alloc(4096, 1)), 100);
    },
  }));
  const { app } = await monter({ immich: creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' }, tailleMax: 1000 }) });
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  assert.equal((await fetch(`${adresse}/api/photos/lot`, { headers: { 'x-cadre-cle': CLE } })).status, 200);
  const reponse = await fetch(`${adresse}/api/photos/${ID(1)}.jpg`, { headers: { 'x-cadre-cle': CLE } });
  assert.equal(reponse.status, 200);
  await assert.rejects(reponse.arrayBuffer(), 'corps interrompu, pas une fin normale');
});

test('lot en morceaux sans Content-Length : lecture abandonnée dès le plafond de 5 Mo, jamais lue en entier', async (t) => {
  let ecrits = 0;
  let ferme = false;
  const immich = await fauxImmich(t, async (_req, res) => {
    res.on('close', () => { ferme = true; });
    res.writeHead(200, { 'content-type': 'application/json' });
    const morceau = Buffer.alloc(64 * 1024, 0x20);
    res.write('[');
    while (!ferme && ecrits < 60 * 1024 * 1024) {
      ecrits += morceau.length;
      if (!res.write(morceau)) await once(res, 'drain').catch(() => {});
    }
    res.end(']');
  });
  const client = creerImmich({ url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' } });
  await assert.rejects(client.lot(), { statusCode: 502, message: 'lot de photos : réponse trop grosse' });
  for (let i = 0; i < 100 && !ferme; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ferme, 'la connexion vers Immich est fermée');
  assert.ok(ecrits < 30 * 1024 * 1024, `lecture arrêtée près du plafond (${ecrits} octets écrits sur 60 Mo)`);
});

test('aucune redirection suivie (la clé ne part pas ailleurs) ; transfert d\'une photo coupé au bout de sa durée maximale', async (t) => {
  const options = [];
  const fauxFetch = async (adresse, opts) => {
    options.push(opts.redirect);
    if (adresse.endsWith('/api/search/random')) return new Response(JSON.stringify([asset(1)]), { headers: { 'content-type': 'application/json' } });
    if (adresse.endsWith('/thumbnail?size=preview&edited=true')) return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
    if (adresse.endsWith('/api/server/version')) return new Response(JSON.stringify({ major: 3, minor: 2, patch: 0 }));
    return new Response(JSON.stringify(asset(1)), { headers: { 'content-type': 'application/json' } });
  };
  const client = creerImmich({
    url: 'http://immich.invalid', cle: CLE_IMMICH, source: { type: 'favoris' }, requete: fauxFetch,
  });
  await client.lot();
  await lireTout((await client.photo(ID(1), new AbortController().signal)).corps);
  await lireVersion('http://immich.invalid', fauxFetch);
  assert.deepEqual(options, ['error', 'error', 'error', 'error'], 'redirect: error sur le lot, la vérification, la miniature et la version');

  const immich = await fauxImmich(t, immichOrdinaire([asset(1)], {
    miniature: (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.write(JPEG);
    },
  }));
  const lent = creerImmich({
    url: immich.url, cle: CLE_IMMICH, source: { type: 'favoris' }, dureeMaxMs: 150,
  });
  await lent.lot();
  const photo = await lent.photo(ID(1), new AbortController().signal);
  await assert.rejects(lireTout(photo.corps), 'transfert interrompu au bout de dureeMaxMs, pas une image tronquée rendue entière');
  for (let i = 0; i < 100 && !immich.fermetures.some((url) => url.includes('/thumbnail')); i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.ok(immich.fermetures.some((url) => url.includes('/thumbnail')), 'Immich voit la fin du transfert');
});
