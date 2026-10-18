// tests/wifi.test.js
//
// Rôle    : prouver le Wi-Fi invités côté serveur (serveur/sources/wifi-invites.js, serveur/routes/wifi.js) :
//           échappement de la chaîne WIFI: (\ ; , : " dans le nom et le mot de passe), T:WPA pour WPA, WPA2 et
//           WPA3, réseau ouvert sans P, fichier absent = « à configurer », fichier invalide refusé sans jamais
//           recopier son contenu (ni dans la réponse ni dans le journal), route protégée par la clé, no-store.
// Entrées : fichiers temporaires écrits dans os.tmpdir() (TMPDIR), supprimés à la fin.
// Sorties : node --test.
// Pièges  : les mots de passe des fichiers de test sont factices mais reconnaissables (« Secret-factice... ») :
//           s'ils apparaissent dans un message d'erreur ou dans le journal, le test échoue.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chaineQr, echapperWifi, lireWifiInvites } from '../serveur/sources/wifi-invites.js';
import { CLE, monter } from './aides.js';

const journalMuet = { warn() {} };

function dossierTemporaire(t) {
  const dossier = mkdtempSync(join(tmpdir(), 'cadre-wifi-'));
  t.after(() => rmSync(dossier, { recursive: true, force: true }));
  return dossier;
}

function fichier(t, contenu) {
  const chemin = join(dossierTemporaire(t), 'wifi_invites.json');
  writeFileSync(chemin, typeof contenu === 'string' ? contenu : JSON.stringify(contenu));
  return chemin;
}

test('échappement : \\ ; , : et " précédés d\'une barre oblique inverse, la barre d\'abord, rien d\'autre', () => {
  assert.equal(echapperWifi('simple'), 'simple');
  assert.equal(echapperWifi('a;b,c:d"e\\f'), 'a\\;b\\,c\\:d\\"e\\\\f');
  assert.equal(echapperWifi('\\;'), '\\\\\\;', 'la barre puis le point-virgule, chacun échappé une seule fois');
  assert.equal(echapperWifi('Café Wi-Fi 2,4 GHz'), 'Café Wi-Fi 2\\,4 GHz');
  assert.equal(echapperWifi('éàç€ \'*?!'), 'éàç€ \'*?!');
});

test('chaîne du QR : T:WPA pour WPA, WPA2 et WPA3 ; nopass sans P ; nom et mot de passe échappés', () => {
  for (const securite of ['WPA', 'WPA2', 'WPA3']) {
    assert.equal(chaineQr({ ssid: 'Freebox-ABC123', mot_de_passe: 'motdepasse', securite }), 'WIFI:T:WPA;S:Freebox-ABC123;P:motdepasse;;', securite);
  }
  assert.equal(chaineQr({ ssid: 'Invités', securite: 'nopass' }), 'WIFI:T:nopass;S:Invités;;');
  assert.equal(chaineQr({ ssid: 'Mai;son', mot_de_passe: 'a:b,c"d\\e;', securite: 'WPA2' }), 'WIFI:T:WPA;S:Mai\\;son;P:a\\:b\\,c\\"d\\\\e\\;;;');
});

test('fichier absent ou variable vide : « à configurer », sans erreur', async (t) => {
  assert.deepEqual(await lireWifiInvites(null, journalMuet), { configure: false });
  assert.deepEqual(await lireWifiInvites(join(dossierTemporaire(t), 'absent.json'), journalMuet), { configure: false });
});

test('fichier valable : nom, mot de passe et chaîne du QR ; réseau ouvert : mot de passe null', async (t) => {
  assert.deepEqual(await lireWifiInvites(fichier(t, { ssid: 'Freebox-ABC123', mot_de_passe: 'Secret-factice;1', securite: 'WPA2' }), journalMuet), {
    configure: true, ssid: 'Freebox-ABC123', mot_de_passe: 'Secret-factice;1', chaine_qr: 'WIFI:T:WPA;S:Freebox-ABC123;P:Secret-factice\\;1;;',
  });
  assert.deepEqual(await lireWifiInvites(fichier(t, { ssid: 'Ouvert', securite: 'nopass' }), journalMuet), {
    configure: true, ssid: 'Ouvert', mot_de_passe: null, chaine_qr: 'WIFI:T:nopass;S:Ouvert;;',
  });
  const cleBrute = 'ab'.repeat(32);
  assert.equal((await lireWifiInvites(fichier(t, { ssid: 'X', mot_de_passe: cleBrute, securite: 'WPA' }), journalMuet)).mot_de_passe, cleBrute, 'clé brute de 64 hexadécimaux');
});

test('fichier invalide : refusé avec sa raison, JAMAIS son contenu (réponse et journal)', async (t) => {
  const cas = [
    ['{"ssid":"Freebox","mot_de_passe":"Secret-factice-1","securite":"WPA2"', /n'est pas du JSON valable/],
    [{ ssid: 'Freebox', mot_de_passe: 'Secret-factice-2', securite: 'WEP' }, /securite : WPA, WPA2, WPA3 ou nopass/],
    [{ ssid: 'Freebox', mot_de_passe: 'court', securite: 'WPA2' }, /mot_de_passe : 8 à 63/],
    [{ ssid: 'Freebox', mot_de_passe: `Secret-factice-${'x'.repeat(60)}`, securite: 'WPA2' }, /mot_de_passe : 8 à 63/],
    [{ ssid: 'Freebox', mot_de_passe: 'Secret-factice-é', securite: 'WPA2' }, /ASCII imprimables/],
    [{ ssid: 'Freebox', securite: 'WPA3' }, /mot_de_passe/],
    [{ ssid: 'Ouvert', mot_de_passe: 'Secret-factice-3', securite: 'nopass' }, /vide pour un réseau sans mot de passe/],
    [{ ssid: '', mot_de_passe: 'Secret-factice-4', securite: 'WPA2' }, /ssid : 1 à 32 octets/],
    [{ ssid: 'é'.repeat(17), mot_de_passe: 'Secret-factice-5', securite: 'WPA2' }, /ssid : 1 à 32 octets/],
    [{ ssid: 'Freebox', mot_de_passe: 'Secret-factice-6', securite: 'WPA2', expire: false }, /champ inconnu « expire »/],
    [['Freebox', 'Secret-factice-7'], /un objet JSON est attendu/],
  ];
  for (const [contenu, motif] of cas) {
    const lignes = [];
    const resultat = await lireWifiInvites(fichier(t, contenu), { warn: (m) => lignes.push(m) });
    assert.equal(resultat.configure, false, JSON.stringify(contenu));
    assert.match(resultat.probleme, motif);
    assert.equal(lignes.length, 1);
    assert.ok(!/Secret-factice/.test(JSON.stringify(resultat) + lignes.join('')), `contenu recopié : ${JSON.stringify(resultat)} ${lignes}`);
  }
});

test('route GET /api/wifi-invites : clé exigée, no-store, configuré ou non, relu à chaque demande', async (t) => {
  const chemin = join(dossierTemporaire(t), 'wifi_invites.json');
  const { app, journal } = await monter({ wifiInvitesFichier: chemin });
  t.after(() => app.close());
  const lire = () => app.inject({ method: 'GET', url: '/api/wifi-invites', headers: { 'x-cadre-cle': CLE } });
  assert.equal((await app.inject({ method: 'GET', url: '/api/wifi-invites' })).statusCode, 401);
  let reponse = await lire();
  assert.equal(reponse.statusCode, 200);
  assert.equal(reponse.headers['cache-control'], 'no-store');
  assert.deepEqual(reponse.json(), { configure: false });
  writeFileSync(chemin, JSON.stringify({ ssid: 'Freebox-ABC123', mot_de_passe: 'Secret-factice-8', securite: 'WPA2' }));
  reponse = await lire();
  assert.deepEqual(reponse.json(), {
    configure: true, ssid: 'Freebox-ABC123', mot_de_passe: 'Secret-factice-8', chaine_qr: 'WIFI:T:WPA;S:Freebox-ABC123;P:Secret-factice-8;;',
  });
  assert.ok(!journal().includes('Secret-factice'), 'le mot de passe ne va jamais au journal');
});
