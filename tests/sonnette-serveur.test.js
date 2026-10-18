// tests/sonnette-serveur.test.js
//
// Rôle    : prouver la sonnette côté serveur : la photo (serveur/ha/photo-sonnette.js, GET /api/sonnette.jpg) lue
//           par l'API REST de HA avec le jeton en en-tête (jamais dans l'URL), entité figée, no-store, refus de HA,
//           réponse qui n'est pas une image, délai et taille plafonnés (lecture en morceaux comprise), aucune
//           redirection suivie ; le suivi des coups de sonnette (serveur/ha/sonnette.js : photo « en cours », « du
//           coup », « d'avant le coup », dernier coup vu, jamais un passage unavailable vers off) ; le direct (serveur/sources/direct-sonnette.js,
//           GET /api/sonnette.mjpeg) relayé depuis go2rtc, coupé au départ du client et au bout de sa durée maximale,
//           2 directs au plus, 404 sans flux configuré, 502 si go2rtc ne répond pas comme prévu.
// Entrées : un faux Home Assistant et un faux go2rtc, vrais serveurs HTTP sur 127.0.0.1 (port choisi par le système).
// Sorties : node --test.
// Pièges  : le direct ne finit jamais de lui-même : les tests lisent quelques images puis abandonnent la requête, et
//           attendent que le faux go2rtc voie la fermeture (preuve que la lecture amont est bien abandonnée).

import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { creerPhotoSonnette } from '../serveur/ha/photo-sonnette.js';
import { SourceSonnette } from '../serveur/ha/sonnette.js';
import { creerDirectSonnette } from '../serveur/sources/direct-sonnette.js';
import { CLE, monter } from './aides.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const JETON = 'jeton-factice-ha-0000';

async function serveur(t, gerer) {
  const requetes = [];
  const srv = http.createServer((req, res) => {
    requetes.push({ url: req.url, autorisation: req.headers.authorization, req, res });
    gerer(req, res);
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  t.after(() => {
    srv.closeAllConnections();
    srv.close();
  });
  return { url: `http://127.0.0.1:${srv.address().port}`, requetes };
}

test('photo : GET de camera_proxy sur camera.sonnette_derniere_photo, jeton en en-tête, jamais dans l\'URL', async (t) => {
  const ha = await serveur(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': JPEG.length });
    res.end(JPEG);
  });
  const photo = creerPhotoSonnette({ haUrl: ha.url, jeton: JETON });
  assert.deepEqual(await photo.lire(), { type: 'image/jpeg', octets: JPEG });
  assert.equal(ha.requetes[0].url, '/api/camera_proxy/camera.sonnette_derniere_photo?width=960&height=540');
  assert.equal(ha.requetes[0].autorisation, `Bearer ${JETON}`);
  assert.ok(!ha.requetes[0].url.includes(JETON));
});

test('photo : refus de HA, type inattendu, trop grosse, délai dépassé, HA injoignable : rejet au message clair', async (t) => {
  const cas = {
    '/refus': (res) => { res.writeHead(401, { 'content-type': 'text/plain' }); res.end('401: Unauthorized'); },
    '/texte': (res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>'); },
    '/grosse': (res) => { res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(4 * 1024 * 1024) }); res.end(); },
    '/lente': () => {},
  };
  const ha = await serveur(t, (req, res) => {
    const prefixe = Object.keys(cas).find((p) => req.url.startsWith(p));
    cas[prefixe](res);
  });
  const lire = (chemin, options = {}) => creerPhotoSonnette({ haUrl: `${ha.url}${chemin}`, jeton: JETON, ...options }).lire();
  await assert.rejects(lire('/refus'), /Home Assistant répond 401/);
  await assert.rejects(lire('/texte'), /type inattendu \(text\/html\)/);
  await assert.rejects(lire('/grosse'), /trop grosse/);
  await assert.rejects(lire('/lente', { delaiMs: 100 }), /injoignable \(délai dépassé\)/);
  await assert.rejects(creerPhotoSonnette({ haUrl: 'http://127.0.0.1:1', jeton: JETON }).lire(), /Home Assistant injoignable/);
});

test('photo : en morceaux sans Content-Length, lecture abandonnée dès le plafond ; aucune redirection suivie', async (t) => {
  let ecrits = 0;
  let ferme = false;
  const ha = await serveur(t, async (_req, res) => {
    res.on('close', () => { ferme = true; });
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    const morceau = Buffer.alloc(16 * 1024, 1);
    while (!ferme && ecrits < 40 * 1024 * 1024) {
      ecrits += morceau.length;
      if (!res.write(morceau)) await once(res, 'drain').catch(() => {});
    }
    res.end();
  });
  await assert.rejects(creerPhotoSonnette({ haUrl: ha.url, jeton: JETON, tailleMax: 64 * 1024 }).lire(), /photo de la sonnette : trop grosse/);
  for (let i = 0; i < 100 && !ferme; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ferme, 'la connexion vers HA est fermée');
  assert.ok(ecrits < 20 * 1024 * 1024, `lecture arrêtée près du plafond (${ecrits} octets écrits sur 40 Mo)`);

  const redirections = [];
  const fauxFetch = async (_adresse, options) => {
    redirections.push(options.redirect);
    return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
  };
  await creerPhotoSonnette({ haUrl: 'http://ha.invalid', jeton: JETON, requete: fauxFetch }).lire();
  assert.deepEqual(redirections, ['error'], 'une redirection n\'emporte pas le jeton ailleurs');
});

test('route GET /api/sonnette.jpg : clé exigée, image relayée en no-store, 502 si HA ne la donne pas', async (t) => {
  let echec = false;
  const photoSonnette = { lire: async () => { if (echec) throw new Error('photo de la sonnette : Home Assistant répond 500'); return { type: 'image/jpeg', octets: JPEG }; } };
  const { app } = await monter({ photoSonnette });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/api/sonnette.jpg' })).statusCode, 401);
  let reponse = await app.inject({ method: 'GET', url: '/api/sonnette.jpg?n=123', headers: { 'x-cadre-cle': CLE } });
  assert.equal(reponse.statusCode, 200);
  assert.equal(reponse.headers['content-type'], 'image/jpeg');
  assert.equal(reponse.headers['cache-control'], 'no-store');
  assert.deepEqual(reponse.rawPayload, JPEG);
  echec = true;
  reponse = await app.inject({ method: 'GET', url: '/api/sonnette.jpg', headers: { 'x-cadre-cle': CLE } });
  assert.equal(reponse.statusCode, 502);
  assert.deepEqual(reponse.json(), { erreur: 'photo_indisponible', message: 'photo de la sonnette : Home Assistant répond 500' });
});

// Faux go2rtc : /api/stream.mjpeg?src=<nom> envoie une image toutes les 20 ms tant que le client lit.
async function fauxGo2rtc(t, { type = 'multipart/x-mixed-replace; boundary=frame', statut = 200 } = {}) {
  const fermetures = [];
  const go2rtc = await serveur(t, (req, res) => {
    res.writeHead(statut, { 'content-type': type });
    const minuteur = setInterval(() => res.write(Buffer.concat([Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n'), JPEG, Buffer.from('\r\n')])), 20);
    req.on('close', () => {
      clearInterval(minuteur);
      fermetures.push(req.url);
    });
  });
  return { ...go2rtc, fermetures };
}

async function attendre(condition, message) {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await new Promise((resoudre) => setTimeout(resoudre, 20));
  }
  assert.fail(message);
}

async function lireUnPeu(url) {
  const abandon = new AbortController();
  const reponse = await fetch(url, { headers: { 'x-cadre-cle': CLE }, signal: abandon.signal });
  const lecteur = reponse.body.getReader();
  let recu = Buffer.alloc(0);
  while (recu.length < 3 * JPEG.length) recu = Buffer.concat([recu, Buffer.from((await lecteur.read()).value)]);
  return { reponse, recu, abandonner: () => abandon.abort() };
}

test('direct : relayé tel quel depuis /api/stream.mjpeg?src=<flux>, lecture amont abandonnée au départ du client', async (t) => {
  const go2rtc = await fauxGo2rtc(t);
  const { app } = await monter({ directSonnette: creerDirectSonnette({ url: go2rtc.url, flux: 'T8210FACTICE' }) });
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const { reponse, recu, abandonner } = await lireUnPeu(`${adresse}/api/sonnette.mjpeg`);
  assert.equal(reponse.status, 200);
  assert.equal(reponse.headers.get('content-type'), 'multipart/x-mixed-replace; boundary=frame');
  assert.equal(reponse.headers.get('cache-control'), 'no-store');
  assert.ok(recu.includes(JPEG));
  assert.equal(go2rtc.requetes[0].url, '/api/stream.mjpeg?src=T8210FACTICE');
  abandonner();
  await attendre(() => go2rtc.fermetures.length === 1, 'go2rtc n\'a pas vu la fermeture : ffmpeg tournerait pour personne');
  assert.equal((await fetch(`${adresse}/api/sonnette.mjpeg`)).status, 401, 'clé exigée');
});

test('direct : coupé au bout de sa durée maximale, 2 directs au plus à la fois', async (t) => {
  const go2rtc = await fauxGo2rtc(t);
  const direct = creerDirectSonnette({ url: go2rtc.url, flux: 'T8210FACTICE', dureeMaxMs: 300 });
  const { app } = await monter({ directSonnette: direct });
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const premier = await lireUnPeu(`${adresse}/api/sonnette.mjpeg`);
  const second = await lireUnPeu(`${adresse}/api/sonnette.mjpeg`);
  const troisieme = await fetch(`${adresse}/api/sonnette.mjpeg`, { headers: { 'x-cadre-cle': CLE } });
  assert.equal(troisieme.status, 429);
  assert.equal((await troisieme.json()).erreur, 'direct_indisponible');
  await attendre(() => go2rtc.fermetures.length === 2, 'les deux directs n\'ont pas été coupés au bout de 300 ms');
  premier.abandonner();
  second.abandonner();
  const apres = await lireUnPeu(`${adresse}/api/sonnette.mjpeg`);
  assert.equal(apres.reponse.status, 200, 'les places sont libérées');
  apres.abandonner();
});

test('direct : un client qui ne lit plus puis part fait quand même fermer go2rtc (socket saturée)', async (t) => {
  const grosse = Buffer.alloc(256 * 1024, 0x41);
  const fermetures = [];
  const go2rtc = await serveur(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
    const minuteur = setInterval(() => res.write(grosse), 5);
    res.on('close', () => {
      clearInterval(minuteur);
      fermetures.push(req.url);
    });
  });
  const { app } = await monter({ directSonnette: creerDirectSonnette({ url: go2rtc.url, flux: 'T8210FACTICE' }) });
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const abandon = new AbortController();
  const reponse = await fetch(`${adresse}/api/sonnette.mjpeg`, { headers: { 'x-cadre-cle': CLE }, signal: abandon.signal });
  await reponse.body.getReader().read();
  await new Promise((resoudre) => setTimeout(resoudre, 1500));
  assert.equal(fermetures.length, 0, 'toujours ouvert tant que le client est là');
  abandon.abort();
  await attendre(() => fermetures.length === 1, 'go2rtc reste ouvert après le départ d\'un client qui ne lisait plus');
});

test('direct : 404 sans flux configuré, 502 si go2rtc est injoignable ou ne répond pas en MJPEG', async (t) => {
  assert.equal(creerDirectSonnette({ url: 'http://127.0.0.1:1', flux: null }), null);
  const sansFlux = await monter();
  t.after(() => sansFlux.app.close());
  const reponse = await sansFlux.app.inject({ method: 'GET', url: '/api/sonnette.mjpeg', headers: { 'x-cadre-cle': CLE } });
  assert.equal(reponse.statusCode, 404);
  assert.equal(reponse.json().erreur, 'direct_non_configure');

  const html = await fauxGo2rtc(t, { type: 'text/html' });
  const erreur = await fauxGo2rtc(t, { statut: 500 });
  for (const url of ['http://127.0.0.1:1', html.url, erreur.url]) {
    const { app } = await monter({ directSonnette: creerDirectSonnette({ url, flux: 'T8210FACTICE' }) });
    t.after(() => app.close());
    const refus = await app.inject({ method: 'GET', url: '/api/sonnette.mjpeg', headers: { 'x-cadre-cle': CLE } });
    assert.equal(refus.statusCode, 502, url);
    assert.equal(refus.json().erreur, 'direct_indisponible');
  }
  await attendre(() => html.fermetures.length === 1 && erreur.fermetures.length === 1, 'réponse refusée mais lecture amont pas abandonnée');
});

// Suivi des coups de sonnette : fausse photo dont les octets changent à la demande, fausses entités.
function suivi({ attenteMs = 150 } = {}) {
  const photo = { octets: Buffer.from('photo du matin'), lectures: 0 };
  photo.lire = async () => {
    photo.lectures += 1;
    return { type: 'image/jpeg', octets: photo.octets };
  };
  const entites = new EventEmitter();
  const journal = { info() {}, warn() {}, error() {} };
  const source = new SourceSonnette({
    photo, entites, journal, pasMs: 10, attenteMs,
  });
  const valeurs = [];
  source.on('maj', (valeur) => valeurs.push(valeur));
  source.demarrer();
  const sonner = (state, quand) => entites.emit('maj', { 'binary_sensor.doorbell_ringing': { state, last_changed: quand, attributes: {} } });
  return {
    photo, source, valeurs, sonner,
  };
}
const attendreQue = async (condition) => {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((r) => setTimeout(r, 5));
};

test('suivi : au coup de sonnette, photo « en cours » puis « du coup » dès que HA l\'a réécrite, avec l\'heure où elle est vue', async (t) => {
  const { photo, source, valeurs, sonner } = suivi();
  t.after(() => source.arreter());
  assert.deepEqual(source.valeur, { dernier_coup: null, photo: 'inconnue', photo_le: null }, 'aucun coup vu : photo d\'heure inconnue');
  const coup = new Date().toISOString();
  sonner('on', coup);
  assert.deepEqual(source.valeur, { dernier_coup: coup, photo: 'en_cours', photo_le: null });
  await attendreQue(() => photo.lectures >= 3);
  photo.octets = Buffer.from('photo du visiteur');
  await attendreQue(() => source.valeur.photo === 'du_coup');
  assert.equal(source.valeur.photo, 'du_coup');
  assert.ok(Date.now() - Date.parse(source.valeur.photo_le) < 2000, 'photo_le : quand le serveur l\'a vue');
  const lectures = photo.lectures;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(photo.lectures, lectures, 'plus de relecture une fois la photo vue');
  assert.deepEqual(valeurs.map((v) => v.photo), ['en_cours', 'du_coup']);
});

test('suivi : pas de nouvelle photo dans l\'attente -> « avant_coup » ; une photo tardive, lue ensuite, passe en « du_coup »', async (t) => {
  const { photo, source, sonner } = suivi({ attenteMs: 60 });
  t.after(() => source.arreter());
  sonner('on', new Date().toISOString());
  await attendreQue(() => source.valeur.photo === 'avant_coup');
  assert.equal(source.valeur.photo, 'avant_coup', 'la photo de HA date d\'avant ce coup');
  await source.lire();
  assert.equal(source.valeur.photo, 'avant_coup', 'même photo : toujours d\'avant');
  photo.octets = Buffer.from('photo arrivée tard');
  await source.lire();
  assert.equal(source.valeur.photo, 'du_coup');
});

test('suivi : un passage à off (redémarrage de HA ou du pont), un coup déjà vu ou un on vieux de plus de 2 min n\'attendent aucune photo', async (t) => {
  const { photo, source, valeurs, sonner } = suivi();
  t.after(() => source.arreter());
  sonner('off', new Date().toISOString());
  sonner('unavailable', new Date().toISOString());
  assert.deepEqual(valeurs, [], 'off et unavailable ne sont pas des coups de sonnette');
  const vieux = new Date(Date.now() - 3 * 60000).toISOString();
  sonner('on', vieux);
  assert.deepEqual(source.valeur, { dernier_coup: vieux, photo: 'inconnue', photo_le: null }, 'vieux coup noté, photo d\'heure inconnue');
  sonner('on', vieux);
  assert.equal(valeurs.length, 1, 'le même coup (même last_changed) ne compte qu\'une fois');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(photo.lectures, 0, 'aucune lecture de photo pour un vieux coup');
});
