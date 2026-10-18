// outils/demo.mjs
//
// Rôle    : lancer le tableau de bord en démonstration, sans Home Assistant ni Immich : le vrai serveur
//           (serveur/index.js) en développement, branché sur le faux Home Assistant (HA_DEMO=1) et le faux Immich
//           (IMMICH_DEMO=1), avec le menu d'exemple recalé sur la semaine en cours. Tout est en « Mode essai ».
// Entrées : tests/fixtures (menu, états, météo, agenda) et tests/fixtures/config (jeton et clés factices) ; PORT
//           (défaut 8020) ; Internet pour Open-Meteo (Paris) et Tempo, facultatif (sans lui, ces cases restent vides).
// Sorties : un dossier temporaire (menus et état local, effacé à la sortie), puis le serveur ; l'adresse à ouvrir dans
//           Chrome (/dev/appairer?code=...) est écrite dans le journal au démarrage.
// Pièges  :
//   - Le .env n'est pas lu (npm run demo ne passe pas --env-file) et les variables de la démo écrasent celles du shell :
//     une vraie configuration ne peut pas brancher la démo sur une vraie maison.
//   - Les clés factices des tests ne valent que sur 127.0.0.1 : la démo n'écoute jamais le réseau.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateParis } from '../serveur/heure-paris.js';
import {
  CALENDRIERS_DEMO, CLIMS_DEMO, VOITURES_DEMO, decalageSemaines, decalerDates,
} from '../serveur/sources/ha-demo.js';

const fixture = (chemin) => fileURLToPath(new URL(`../tests/fixtures/${chemin}`, import.meta.url));

const dossier = mkdtempSync(join(tmpdir(), 'cadre-demo-'));
mkdirSync(join(dossier, 'menus'));
mkdirSync(join(dossier, 'etat'));
const decalage = decalageSemaines(dateParis());
const menu = decalerDates(readFileSync(fixture('menu-2026-10-10.json'), 'utf8'), decalage);
writeFileSync(join(dossier, 'menus', 'demo.json'), menu);
process.on('exit', () => rmSync(dossier, { recursive: true, force: true }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

Object.assign(process.env, {
  NODE_ENV: 'development',
  HA_DEMO: '1',
  IMMICH_DEMO: '1',
  HA_URL: 'http://127.0.0.1:8123',
  HA_JETON_FICHIER: fixture('config/jeton-factice'),
  CLE_CADRE_FICHIER: fixture('config/cle-factice'),
  CLE_CLEVO_FICHIER: fixture('config/cle-clevo-factice'),
  HOTE: '127.0.0.1',
  PORT: process.env.PORT || '8020',
  DOSSIER_MENUS: join(dossier, 'menus'),
  DOSSIER_ETAT: join(dossier, 'etat'),
  AGENDA_CALENDRIERS: CALENDRIERS_DEMO,
  VOITURES: VOITURES_DEMO,
  CLIMS: CLIMS_DEMO,
  IMMICH_CLE_FICHIER: '',
  IMMICH_SOURCE: '',
  IMMICH_ALBUM_ID: '',
  WIFI_INVITES_FICHIER: '',
  GO2RTC_FLUX_SONNETTE: '',
  ACTIONS_REELLES: '',
  ACTIONS_MAISON: '',
  ACTIONS_VOITURE: '',
  ACTIONS_CLIM: '',
});
console.log(`démo : menu de la semaine du ${JSON.parse(menu).cycle.debut}, état local dans ${dossier} (effacé à la sortie)`);
await import('../serveur/index.js');
