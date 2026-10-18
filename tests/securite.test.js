// tests/securite.test.js
//
// Rôle    : prouver la protection de /api (serveur/securite.js, serveur/app.js) : 401 sans clé ou avec une
//           mauvaise clé, 200 avec la clé en cookie OU en en-tête, /api/sante et la page statique publics,
//           clé jamais écrite dans les journaux, limite de 300 requêtes par minute sur TOUT /api (routes
//           inconnues et méthodes non prévues comprises, avec ou sans web/dist), dossier public/ servi à la
//           racine, HEAD /api/menu (contrôle d'appairage de la page) protégé comme le reste, routes /dev absentes
//           en production ; en développement, réservées à la boucle locale, à
//           un en-tête Host local exact (DNS rebinding) et, pour l'appairage, au code du journal (adb reverse).
// Entrées : application montée par tests/aides.js ; tests/fixtures/web-dist/ comme faux web/dist,
//           tests/fixtures/web-sources/ comme faux web/ (avec public/).
// Sorties : node --test.
// Pièges  : les 200 sur /api/flux se testent sur un vrai port (flux sans fin, voir aides.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MASQUE } from '../serveur/securite.js';
import { CLE, CODE_APPAIRAGE, HOTE_DEV, monter, ouvrirFlux, PORT_DEV, VERSION } from './aides.js';

const DOSSIER_WEB = fileURLToPath(new URL('./fixtures/web-dist', import.meta.url));
const DOSSIER_SOURCES = fileURLToPath(new URL('./fixtures/web-sources', import.meta.url));

test('401 sur /api/flux sans clé, avec une mauvaise clé ou une clé de mauvaise longueur', async (t) => {
  const { app } = await monter();
  t.after(() => app.close());
  const cas = [
    {},
    { 'x-cadre-cle': 'mauvaise' },
    { 'x-cadre-cle': `${CLE.slice(0, -1)}0` },
    { cookie: `cadre_cle=${CLE}x` },
    { cookie: 'autre=1' },
  ];
  for (const headers of cas) {
    const reponse = await app.inject({ method: 'GET', url: '/api/flux', headers });
    assert.equal(reponse.statusCode, 401, JSON.stringify(headers));
    assert.deepEqual(reponse.json(), { erreur: 'non_appaire', message: 'Cadre non appairé' });
  }
});

test('200 sur /api/flux avec la clé en cookie, puis en en-tête', async (t) => {
  const { app } = await monter();
  t.after(() => app.close());
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  for (const enTetes of [{ cookie: `cadre_cle=${CLE}` }, { 'x-cadre-cle': CLE }]) {
    const flux = await ouvrirFlux(`${adresse}/api/flux`, enTetes);
    assert.equal(flux.reponse.status, 200);
    assert.match(flux.reponse.headers.get('content-type'), /^text\/event-stream/);
    assert.equal((await flux.lireEvenement()).nom, 'instantane');
    flux.fermer();
  }
});

test('HEAD /api/menu : 401 sans clé, 200 sans corps avec la clé (la page s\'en sert pour dire « Cadre non appairé »)', async (t) => {
  const { app } = await monter();
  t.after(() => app.close());
  const sans = await app.inject({ method: 'HEAD', url: '/api/menu' });
  assert.equal(sans.statusCode, 401);
  const avec = await app.inject({ method: 'HEAD', url: '/api/menu', headers: { cookie: `cadre_cle=${CLE}` } });
  assert.equal(avec.statusCode, 200);
  assert.equal(avec.body, '');
});

test('/api/sante est public et ne dit que l\'état de HA, la version et l\'empreinte de la page', async (t) => {
  const { app, connexion } = await monter({ empreinte: '0123456789abcdef' });
  t.after(() => app.close());
  let reponse = await app.inject({ method: 'GET', url: '/api/sante' });
  assert.equal(reponse.statusCode, 200);
  assert.deepEqual(reponse.json(), { ha: 'ok', version: VERSION, empreinte: '0123456789abcdef' });
  connexion.etat = 'ko';
  reponse = await app.inject({ method: 'GET', url: '/api/sante' });
  assert.deepEqual(reponse.json(), { ha: 'ko', version: VERSION, empreinte: '0123456789abcdef' });
});

test('la page statique (web/dist) est servie sans clé, une route /api inconnue ne l\'est pas', async (t) => {
  const { app } = await monter({ dossierWeb: DOSSIER_WEB });
  t.after(() => app.close());
  const page = await app.inject({ method: 'GET', url: '/' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /page statique de test/);
  const inconnue = await app.inject({ method: 'GET', url: '/api/inconnue' });
  assert.equal(inconnue.statusCode, 404);
  assert.deepEqual(inconnue.json(), { erreur: 'introuvable' });
});

test('la clé n\'apparaît jamais dans les journaux, cookie, x-cadre-cle et authorization sont masqués', async (t) => {
  const { app, journal } = await monter();
  t.after(() => app.close());
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  const flux = await ouvrirFlux(`${adresse}/api/flux`, { cookie: `cadre_cle=${CLE}`, 'x-cadre-cle': CLE, authorization: `Bearer ${CLE}` });
  await flux.lireEvenement();
  flux.fermer();
  await app.inject({ method: 'GET', url: '/api/flux', headers: { 'x-cadre-cle': `${CLE}-fausse` } });

  const texte = journal();
  assert.ok(texte.includes('incoming request'), 'les requêtes doivent être journalisées');
  assert.ok(!texte.includes(CLE), 'clé trouvée dans les journaux');
  for (const champ of ['"cookie"', '"x-cadre-cle"', '"authorization"']) {
    assert.ok(texte.includes(`${champ}:"${MASQUE}"`), `${champ} non masqué`);
  }
});

test('limite de débit : 300 requêtes par minute et par IP sur /api, requêtes sans clé comprises', async (t) => {
  const { app } = await monter();
  t.after(() => app.close());
  for (let i = 0; i < 150; i += 1) {
    assert.equal((await app.inject({ method: 'GET', url: '/api/sante' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/flux' })).statusCode, 401);
  }
  const refus = await app.inject({ method: 'GET', url: '/api/flux' });
  assert.equal(refus.statusCode, 429);
  assert.match(refus.json().message, /^Trop de requêtes/);
  assert.equal((await app.inject({ method: 'GET', url: '/api/sante' })).statusCode, 429);
});

test('limite de débit : les routes inconnues et méthodes non prévues sous /api comptent aussi, avec ou sans web/dist', async (t) => {
  const cas = [
    { dossierWeb: '/inexistant', method: 'GET', url: '/api/inconnue' },
    { dossierWeb: DOSSIER_WEB, method: 'GET', url: '/api/inconnue' },
    { dossierWeb: DOSSIER_WEB, method: 'GET', url: '/%61pi/inconnue' },
    { dossierWeb: '/inexistant', method: 'OPTIONS', url: '/api/flux' },
    { dossierWeb: '/inexistant', method: 'POST', url: '/api/sante' },
  ];
  for (const { dossierWeb, method, url } of cas) {
    const { app } = await monter({ dossierWeb });
    t.after(() => app.close());
    for (let i = 0; i < 300; i += 1) {
      assert.equal((await app.inject({ method, url })).statusCode, 404, `${method} ${url} (${dossierWeb})`);
    }
    assert.equal((await app.inject({ method, url })).statusCode, 429, `${method} ${url} (${dossierWeb}) : 301e requête`);
    assert.equal((await app.inject({ method: 'GET', url: '/api/sante' })).statusCode, 429);
  }
});

test('le sous-dossier public/ du dossier web est servi à la racine, comme avec Vite', async (t) => {
  const { app } = await monter({ dossierWeb: DOSSIER_SOURCES });
  t.after(() => app.close());
  assert.match((await app.inject({ method: 'GET', url: '/' })).body, /sources web de test/);
  const publicRacine = await app.inject({ method: 'GET', url: '/public-test.txt' });
  assert.equal(publicRacine.statusCode, 200);
  assert.equal(publicRacine.body, 'fichier public de test\n');
});

test('production : les routes /dev n\'existent pas', async (t) => {
  const { app } = await monter({ dossierWeb: DOSSIER_WEB });
  t.after(() => app.close());
  for (const url of ['/dev/appairer', '/dev/reglages']) {
    const reponse = await app.inject({ method: 'GET', url });
    assert.equal(reponse.statusCode, 404, url);
    assert.equal(reponse.headers['set-cookie'], undefined, url);
  }
});

const LOCAL = { host: HOTE_DEV };
const appairer = (suite = '') => `/dev/appairer?code=${CODE_APPAIRAGE}${suite}`;

test('développement : /dev/appairer avec le bon code pose le cookie de la clé (HttpOnly, SameSite=Strict) et renvoie vers la page', async (t) => {
  const { app, journal } = await monter({ dev: true });
  t.after(() => app.close());
  const reponse = await app.inject({ method: 'GET', url: appairer(), headers: LOCAL });
  assert.equal(reponse.statusCode, 302);
  assert.equal(reponse.headers.location, '/');
  assert.equal(reponse.headers['set-cookie'], `cadre_cle=${CLE}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict`);
  assert.ok(!reponse.body.includes(CLE), 'clé dans le corps de la réponse');
  assert.ok(!journal().includes(CLE), 'clé dans les journaux');

  const cookie = reponse.headers['set-cookie'].split(';')[0];
  assert.equal((await app.inject({ method: 'GET', url: '/api/flux', headers: { cookie: `${cookie}x` } })).statusCode, 401);
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  const flux = await ouvrirFlux(`${adresse}/api/flux`, { cookie });
  assert.equal(flux.reponse.status, 200, 'le cookie posé ouvre bien le flux');
  flux.fermer();
});

test('développement : sans le code d\'appairage, ou avec un faux code, ni cookie ni redirection', async (t) => {
  const { app } = await monter({ dev: true });
  t.after(() => app.close());
  for (const url of ['/dev/appairer', '/dev/appairer?code=', `/dev/appairer?code=${CODE_APPAIRAGE}x`, `/dev/appairer?code=${CODE_APPAIRAGE.slice(1)}`, '/dev/appairer?theme=soir']) {
    const reponse = await app.inject({ method: 'GET', url, headers: LOCAL });
    assert.equal(reponse.statusCode, 403, url);
    assert.equal(reponse.headers['set-cookie'], undefined, url);
    assert.ok(!reponse.body.includes(CLE), url);
  }
});

test('développement : le thème demandé n\'est recopié que s\'il est connu (pas de redirection ouverte)', async (t) => {
  const { app } = await monter({ dev: true });
  t.after(() => app.close());
  const cas = [
    [appairer('&theme=soir'), '/?theme=soir'],
    [appairer('&theme=nuit'), '/?theme=nuit'],
    [appairer('&theme=//exemple.org'), '/'],
    [appairer('&theme=jour%0D%0ASet-Cookie:x=1'), '/'],
  ];
  for (const [url, attendu] of cas) {
    assert.equal((await app.inject({ method: 'GET', url, headers: LOCAL })).headers.location, attendu, url);
  }
  const reglages = await app.inject({ method: 'GET', url: '/dev/reglages', headers: LOCAL });
  assert.deepEqual(reglages.json(), { theme_force: true });
});

test('développement : les routes /dev refusent toute requête hors de la boucle locale', async (t) => {
  const { app } = await monter({ dev: true });
  t.after(() => app.close());
  for (const remoteAddress of ['192.168.1.50', '::ffff:192.168.1.50', '10.0.0.2']) {
    for (const url of [appairer(), '/dev/reglages']) {
      const reponse = await app.inject({ method: 'GET', url, remoteAddress, headers: LOCAL });
      assert.equal(reponse.statusCode, 403, `${url} depuis ${remoteAddress}`);
      assert.equal(reponse.headers['set-cookie'], undefined);
    }
  }
  for (const remoteAddress of ['127.0.0.1', '::1']) {
    assert.equal((await app.inject({ method: 'GET', url: '/dev/reglages', remoteAddress, headers: LOCAL })).statusCode, 200, remoteAddress);
  }
});

test('développement : depuis la boucle locale, un en-tête Host étranger est refusé (DNS rebinding), les noms locaux exacts passent', async (t) => {
  const { app } = await monter({ dev: true });
  t.after(() => app.close());
  const refuses = ['attaquant.example', `attaquant.example:${PORT_DEV}`, `127.0.0.1:${PORT_DEV + 1}`, '127.0.0.1', `127.0.0.1.attaquant.example:${PORT_DEV}`, `localhost.:${PORT_DEV}`];
  for (const host of refuses) {
    for (const url of [appairer(), '/dev/reglages']) {
      const reponse = await app.inject({ method: 'GET', url, headers: { host } });
      assert.equal(reponse.statusCode, 403, `${url} avec Host: ${host}`);
      assert.equal(reponse.headers['set-cookie'], undefined, host);
    }
  }
  for (const host of [`127.0.0.1:${PORT_DEV}`, `localhost:${PORT_DEV}`, `[::1]:${PORT_DEV}`, `LOCALHOST:${PORT_DEV}`]) {
    assert.equal((await app.inject({ method: 'GET', url: appairer(), headers: { host } })).statusCode, 302, host);
  }
});
