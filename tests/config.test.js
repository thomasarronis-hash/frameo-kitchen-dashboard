// tests/config.test.js
//
// Rôle    : prouver serveur/config.js : production par défaut (web/dist, routes /dev fermées), développement
//           seulement si NODE_ENV vaut exactement « development » (web/), dossiers relatifs à la racine du
//           projet ou absolus, deux clés d'appareil différentes, clé du Clevo créée en 600 si elle manque (en
//           développement seulement), ACTIONS_REELLES, ACTIONS_MAISON et ACTIONS_VOITURE vrais seulement pour « 1 » et
//           indépendants,
//           AGENDA_CALENDRIERS lu comme une liste blanche de calendriers associés chacun à une personne (vide par
//           défaut ; calendrier mal formé, sans prénom ou répété refusé), WIFI_INVITES_FICHIER absent par défaut,
//           GO2RTC_URL et GO2RTC_FLUX_SONNETTE (pas de direct vidéo sans nom de flux, nom et URL contrôlés), Immich (pas
//           de clé par défaut, fichier de clé pas encore déposé toléré, IMMICH_SOURCE : toute la photothèque par défaut,
//           favoris, ou album avec son uuid ; valeurs ambiguës refusées) et IMMICH_DEMO refusé hors développement.
// Entrées : tests/fixtures/config/jeton-factice, cle-factice et cle-clevo-factice (valeurs factices, versionnées).
// Sorties : node --test.
// Pièges  : chargerConfig lit (et en développement, crée) de vrais fichiers de clés : chaque appel reçoit des
//           chemins EXPLICITES, jamais les valeurs par défaut de ~/.config/cadre. Les clés à créer le sont dans
//           un dossier temporaire (os.tmpdir(), donc TMPDIR), supprimé à la fin du test.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  chargerConfig, lireCalendriers, lireImmich, lireLieu,
} from '../serveur/config.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(RACINE, 'tests', 'fixtures', 'config');
const ENV = {
  HA_JETON_FICHIER: join(FIXTURES, 'jeton-factice'),
  CLE_CADRE_FICHIER: join(FIXTURES, 'cle-factice'),
  CLE_CLEVO_FICHIER: join(FIXTURES, 'cle-clevo-factice'),
};

function dossierTemporaire(t) {
  const dossier = mkdtempSync(join(tmpdir(), 'cadre-config-'));
  t.after(() => rmSync(dossier, { recursive: true, force: true }));
  return dossier;
}

test('production par défaut : web/dist, data/menus, data/etat, dev et actions réelles faux', () => {
  const config = chargerConfig(ENV);
  assert.equal(config.dev, false);
  assert.equal(config.dossierWeb, join(RACINE, 'web', 'dist'));
  assert.equal(config.dossierMenus, join(RACINE, 'data', 'menus'));
  assert.equal(config.dossierEtat, join(RACINE, 'data', 'etat'));
  assert.equal(config.actionsReelles, false);
  assert.equal(config.cleClevoCreee, false);
  assert.deepEqual(Object.keys(config.cles), ['cadre', 'clevo']);
  assert.notEqual(config.cles.cadre, config.cles.clevo);
});

test('NODE_ENV=development : web/ servi tel quel, dev vrai ; toute autre valeur reste en production', () => {
  const dev = chargerConfig({ ...ENV, NODE_ENV: 'development' });
  assert.equal(dev.dev, true);
  assert.equal(dev.dossierWeb, join(RACINE, 'web'));
  for (const autre of ['production', 'Development', 'dev', '']) {
    assert.equal(chargerConfig({ ...ENV, NODE_ENV: autre }).dev, false, autre);
  }
});

test('DOSSIER_WEB, DOSSIER_MENUS, DOSSIER_ETAT : relatifs à la racine du projet, ou absolus ; vide = valeur par défaut', () => {
  assert.equal(chargerConfig({ ...ENV, DOSSIER_WEB: 'tests/fixtures/web-sources' }).dossierWeb, join(RACINE, 'tests', 'fixtures', 'web-sources'));
  assert.equal(chargerConfig({ ...ENV, DOSSIER_WEB: FIXTURES }).dossierWeb, FIXTURES);
  assert.equal(chargerConfig({ ...ENV, DOSSIER_WEB: '  ' }).dossierWeb, join(RACINE, 'web', 'dist'));
  assert.equal(chargerConfig({ ...ENV, DOSSIER_MENUS: '/srv/menus' }).dossierMenus, '/srv/menus');
  assert.equal(chargerConfig({ ...ENV, DOSSIER_ETAT: 'autre/etat' }).dossierEtat, join(RACINE, 'autre', 'etat'));
});

test('ACTIONS_REELLES : vrai seulement pour « 1 » exactement', () => {
  assert.equal(chargerConfig({ ...ENV, ACTIONS_REELLES: '1' }).actionsReelles, true);
  for (const autre of ['0', 'true', 'oui', ' 1', '1 ', '01', '']) {
    assert.equal(chargerConfig({ ...ENV, ACTIONS_REELLES: autre }).actionsReelles, false, JSON.stringify(autre));
  }
});

test('ACTIONS_MAISON : vrai seulement pour « 1 » exactement, indépendant de ACTIONS_REELLES', () => {
  assert.equal(chargerConfig(ENV).actionsMaison, false, 'simulé par défaut');
  assert.equal(chargerConfig({ ...ENV, ACTIONS_MAISON: '1' }).actionsMaison, true);
  for (const autre of ['0', 'true', 'oui', ' 1', '1 ', '01', '']) {
    assert.equal(chargerConfig({ ...ENV, ACTIONS_MAISON: autre }).actionsMaison, false, JSON.stringify(autre));
  }
  const courses = chargerConfig({ ...ENV, ACTIONS_REELLES: '1' });
  assert.deepEqual([courses.actionsReelles, courses.actionsMaison], [true, false], 'ACTIONS_REELLES=1 n\'ouvre pas la maison');
  const maison = chargerConfig({ ...ENV, ACTIONS_MAISON: '1' });
  assert.deepEqual([maison.actionsReelles, maison.actionsMaison], [false, true], 'ACTIONS_MAISON=1 n\'ouvre pas les courses');
});

test('ACTIONS_VOITURE : vrai seulement pour « 1 » exactement, indépendant de ACTIONS_REELLES et ACTIONS_MAISON', () => {
  const drapeaux = (autres) => {
    const config = chargerConfig({ ...ENV, ...autres });
    return [config.actionsReelles, config.actionsMaison, config.actionsVoiture];
  };
  assert.deepEqual(drapeaux({}), [false, false, false]);
  assert.deepEqual(drapeaux({ ACTIONS_VOITURE: '1' }), [false, false, true], 'ACTIONS_VOITURE=1 n\'ouvre ni les courses ni la maison');
  assert.deepEqual(drapeaux({ ACTIONS_REELLES: '1', ACTIONS_MAISON: '1' }), [true, true, false], 'les deux autres n\'ouvrent pas la voiture');
  for (const autre of ['0', 'true', 'oui', ' 1', '1 ', '01', '']) {
    assert.equal(drapeaux({ ACTIONS_VOITURE: autre })[2], false, JSON.stringify(autre));
  }
});

test('WIFI_INVITES_FICHIER : absent par défaut ; chemin relatif à la racine du projet, absolu, ou ~/', () => {
  assert.equal(chargerConfig(ENV).wifiInvitesFichier, null);
  assert.equal(chargerConfig({ ...ENV, WIFI_INVITES_FICHIER: '  ' }).wifiInvitesFichier, null);
  assert.equal(chargerConfig({ ...ENV, WIFI_INVITES_FICHIER: '/run/cadre/wifi_invites.json' }).wifiInvitesFichier, '/run/cadre/wifi_invites.json');
  assert.equal(chargerConfig({ ...ENV, WIFI_INVITES_FICHIER: 'secrets/wifi_invites.json' }).wifiInvitesFichier, join(RACINE, 'secrets', 'wifi_invites.json'));
});

test('go2rtc : M900 par défaut et pas de flux (pas de direct vidéo) ; URL sans chemin et nom de flux simple exigés', () => {
  assert.deepEqual(chargerConfig(ENV).go2rtc, { url: 'http://192.168.1.187:1984', flux: null });
  assert.deepEqual(chargerConfig({ ...ENV, GO2RTC_URL: 'http://host.docker.internal:1984/', GO2RTC_FLUX_SONNETTE: ' T8210FACTICE ' }).go2rtc,
    { url: 'http://host.docker.internal:1984', flux: 'T8210FACTICE' });
  assert.throws(() => chargerConfig({ ...ENV, GO2RTC_URL: 'http://h:1984/api' }), /GO2RTC_URL doit être/);
  for (const mauvais of ['a&src=autre', 'nom avec espace', '../x', 'x'.repeat(65), 'flux?']) {
    assert.throws(() => chargerConfig({ ...ENV, GO2RTC_FLUX_SONNETTE: mauvais }), /GO2RTC_FLUX_SONNETTE/, mauvais);
  }
});

test('développement : la clé du Clevo absente est créée (64 caractères hexadécimaux, fichier en 600) puis réutilisée', (t) => {
  const chemin = join(dossierTemporaire(t), 'sous-dossier', 'cle_clevo_dev');
  const premiere = chargerConfig({ ...ENV, NODE_ENV: 'development', CLE_CLEVO_FICHIER: chemin });
  assert.equal(premiere.cleClevoCreee, true);
  assert.match(premiere.cles.clevo, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(chemin, 'utf8'), premiere.cles.clevo);
  assert.equal(statSync(chemin).mode & 0o777, 0o600);
  const seconde = chargerConfig({ ...ENV, NODE_ENV: 'development', CLE_CLEVO_FICHIER: chemin });
  assert.equal(seconde.cleClevoCreee, false);
  assert.equal(seconde.cles.clevo, premiere.cles.clevo);
});

test('production : une clé du Clevo absente est une erreur (rien n\'est créé)', (t) => {
  const chemin = join(dossierTemporaire(t), 'cle_clevo');
  assert.throws(() => chargerConfig({ ...ENV, CLE_CLEVO_FICHIER: chemin }), /^Error: CLE_CLEVO_FICHIER : fichier illisible/);
  assert.throws(() => statSync(chemin), /ENOENT/);
});

test('deux fichiers qui donnent la même clé sont refusés ; une clé trop courte aussi', () => {
  assert.throws(() => chargerConfig({ ...ENV, CLE_CLEVO_FICHIER: ENV.CLE_CADRE_FICHIER }), /il en faut deux différentes/);
  assert.throws(() => chargerConfig({ ...ENV, CLE_CLEVO_FICHIER: ENV.HA_JETON_FICHIER }), /trop courte/);
});

test('AGENDA_CALENDRIERS : vide par défaut, calendriers et personnes dans l\'ordre donné (espaces tolérés)', () => {
  assert.deepEqual(chargerConfig(ENV).calendriers, []);
  assert.deepEqual(chargerConfig({ ...ENV, AGENDA_CALENDRIERS: '  ' }).calendriers, []);
  assert.deepEqual(chargerConfig({ ...ENV, AGENDA_CALENDRIERS: 'calendar.domicile=Thomas,calendar.travail=Thomas' }).calendriers, [
    { id: 'calendar.domicile', personne: 'Thomas' },
    { id: 'calendar.travail', personne: 'Thomas' },
  ]);
  assert.deepEqual(lireCalendriers({ AGENDA_CALENDRIERS: ' calendar.domicile = Thomas , calendar.domicile_2=Marie-Lou,calendar.ecole=Léa ' }), [
    { id: 'calendar.domicile', personne: 'Thomas' },
    { id: 'calendar.domicile_2', personne: 'Marie-Lou' },
    { id: 'calendar.ecole', personne: 'Léa' },
  ]);
  const config = chargerConfig({ ...ENV, AGENDA_CALENDRIERS: 'calendar.domicile=Thomas' });
  assert.ok(Object.isFrozen(config.calendriers) && Object.isFrozen(config.calendriers[0]));
});

test('AGENDA_CALENDRIERS : autre domaine, majuscules, élément vide, prénom absent ou invalide, calendrier répété refusés au démarrage', () => {
  const mauvais = [
    'todo.shopping_list=Thomas', 'calendar.Domicile=Thomas', 'calendar.domicile=Thomas,,calendar.travail=Thomas', 'domicile=Thomas',
    'calendar.=Thomas', 'calendar.a b=Thomas', 'calendar.domicile', 'calendar.domicile=', 'calendar.domicile=Thomas=Agathe',
    'calendar.domicile=Th0mas', 'calendar.domicile=<b>', 'calendar.domicile=Un prénom beaucoup trop long',
  ];
  for (const valeur of mauvais) {
    assert.throws(() => lireCalendriers({ AGENDA_CALENDRIERS: valeur }), /^Error: AGENDA_CALENDRIERS : /, valeur);
  }
  assert.throws(() => lireCalendriers({ AGENDA_CALENDRIERS: 'calendar.domicile' }), /sans prénom valable/);
  assert.throws(() => lireCalendriers({ AGENDA_CALENDRIERS: 'calendar.domicile=Thomas,calendar.domicile=Agathe' }), /donné deux fois/);
});

const ALBUM = '3f6c2a1e-8b4d-4c2a-9e1f-0a1b2c3d4e5f';

test('Immich : M900 par défaut, pas de clé (photos à configurer), toute la photothèque par défaut, pas de démonstration', () => {
  assert.deepEqual(chargerConfig(ENV).immich, {
    url: 'http://192.168.1.187:2283', cle: null, cheminCle: null, cleAbsente: false, source: { type: 'tout' }, demo: false,
  });
  assert.deepEqual(lireImmich({ IMMICH_SOURCE: ' tout ' }).source, { type: 'tout' });
  assert.deepEqual(lireImmich({ IMMICH_SOURCE: 'favoris' }).source, { type: 'favoris' });
  assert.deepEqual(lireImmich({ IMMICH_SOURCE: 'album', IMMICH_ALBUM_ID: ` ${ALBUM.toUpperCase()} ` }).source, { type: 'album', albumId: ALBUM }, 'uuid remis en minuscules');
  assert.equal(lireImmich({ IMMICH_URL: 'http://host.docker.internal:2283/' }).url, 'http://host.docker.internal:2283');
});

test('Immich : clé lue dans son fichier ; fichier donné mais pas encore déposé = pas de clé (cleAbsente) ; fichier vide refusé', (t) => {
  const dossier = dossierTemporaire(t);
  const chemin = join(dossier, 'immich_cle');
  const absente = lireImmich({ IMMICH_CLE_FICHIER: chemin });
  assert.deepEqual([absente.cle, absente.cleAbsente, absente.cheminCle], [null, true, chemin]);
  writeFileSync(chemin, 'cle-api-immich-factice-0123456789\n', { mode: 0o600 });
  const lue = lireImmich({ IMMICH_CLE_FICHIER: chemin });
  assert.deepEqual([lue.cle, lue.cleAbsente], ['cle-api-immich-factice-0123456789', false]);
  writeFileSync(chemin, '   ');
  assert.throws(() => lireImmich({ IMMICH_CLE_FICHIER: chemin }), /IMMICH_CLE_FICHIER : le fichier .* doit contenir une seule valeur/);
  assert.equal(lireImmich({ IMMICH_CLE_FICHIER: '  ' }).cheminCle, null);
});

test('Immich : source inconnue, album sans uuid ou mal formé, uuid sans IMMICH_SOURCE=album, URL avec chemin refusés au démarrage', () => {
  for (const mauvais of ['Tout', 'favori', 'albums', 'aléatoire']) {
    assert.throws(() => lireImmich({ IMMICH_SOURCE: mauvais }), /IMMICH_SOURCE : tout, favoris ou album/, mauvais);
  }
  for (const mauvais of ['', 'album-cuisine', `${ALBUM}x`, ALBUM.slice(1), '../albums']) {
    assert.throws(() => lireImmich({ IMMICH_SOURCE: 'album', IMMICH_ALBUM_ID: mauvais }), /IMMICH_ALBUM_ID : identifiant d'album attendu/, mauvais);
  }
  for (const source of [undefined, 'tout', 'favoris']) {
    assert.throws(() => lireImmich({ IMMICH_SOURCE: source, IMMICH_ALBUM_ID: ALBUM }), /IMMICH_ALBUM_ID donné sans IMMICH_SOURCE=album/, String(source));
  }
  assert.throws(() => lireImmich({ IMMICH_URL: 'http://192.168.1.187:2283/api' }), /IMMICH_URL doit être/);
});

test('IMMICH_DEMO=1 : seulement en développement ; en production le démarrage est refusé (la démonstration n\'y existe pas)', () => {
  assert.equal(chargerConfig({ ...ENV, NODE_ENV: 'development', IMMICH_DEMO: '1' }).immich.demo, true);
  for (const nodeEnv of [undefined, 'production', 'Development', '']) {
    assert.throws(() => chargerConfig({ ...ENV, NODE_ENV: nodeEnv, IMMICH_DEMO: '1' }), /IMMICH_DEMO=1 n'existe qu'en développement/, String(nodeEnv));
  }
  assert.throws(() => lireImmich({ IMMICH_DEMO: 'oui' }, true), /IMMICH_DEMO : 1 ou vide/);
  assert.equal(chargerConfig({ ...ENV, IMMICH_DEMO: '' }).immich.demo, false);
});

test('LIEU_* : Paris par défaut, les trois variables ensemble, coordonnées bornées', () => {
  assert.deepEqual(lireLieu({}), { nom: 'Paris', latitude: 48.8566, longitude: 2.3522 });
  assert.deepEqual(chargerConfig(ENV).lieu, { nom: 'Paris', latitude: 48.8566, longitude: 2.3522 });
  assert.deepEqual(lireLieu({ LIEU_NOM: ' Saint-Malo ', LIEU_LATITUDE: '48.6493', LIEU_LONGITUDE: '-2.0257' }), { nom: 'Saint-Malo', latitude: 48.6493, longitude: -2.0257 });
  assert.throws(() => lireLieu({ LIEU_NOM: 'Lyon' }), /les trois ensemble/);
  assert.throws(() => lireLieu({ LIEU_LATITUDE: '45.76', LIEU_LONGITUDE: '4.83' }), /les trois ensemble/);
  assert.throws(() => lireLieu({ LIEU_NOM: 'Lyon', LIEU_LATITUDE: '45,76', LIEU_LONGITUDE: '4.83' }), /LIEU_LATITUDE : nombre entre -90 et 90/);
  assert.throws(() => lireLieu({ LIEU_NOM: 'Lyon', LIEU_LATITUDE: '45.76', LIEU_LONGITUDE: '200' }), /LIEU_LONGITUDE : nombre entre -180 et 180/);
  assert.throws(() => lireLieu({ LIEU_NOM: '<b>', LIEU_LATITUDE: '45.76', LIEU_LONGITUDE: '4.83' }), /LIEU_NOM : 1 à 30 lettres/);
});
