// serveur/config.js
//
// Rôle    : lire la configuration du BFF (variables d'environnement) et ses secrets : le jeton Home Assistant
//           et les deux clés d'appareil (celle du cadre, celle du Clevo).
// Entrées : process.env (voir .env.example) : HA_URL, HA_JETON_FICHIER, CLE_CADRE_FICHIER, CLE_CLEVO_FICHIER,
//           PORT, HOTE, DOSSIER_WEB, DOSSIER_MENUS, DOSSIER_ETAT, ACTIONS_REELLES, ACTIONS_MAISON, ACTIONS_VOITURE,
//           ACTIONS_CLIM, AGENDA_CALENDRIERS,
//           WIFI_INVITES_FICHIER, GO2RTC_URL, GO2RTC_FLUX_SONNETTE, IMMICH_URL, IMMICH_CLE_FICHIER, IMMICH_SOURCE,
//           IMMICH_ALBUM_ID, IMMICH_DEMO, HA_DEMO, VOITURES, CLIMS, LIEU_NOM, LIEU_LATITUDE, LIEU_LONGITUDE, et NODE_ENV
//           (« development » pour npm run dev).
// Sorties : chargerConfigHA() -> { haUrl, haJeton } (sert aussi à outils/verif-ha.mjs) ;
//           lireCalendriers(env) -> les calendriers de AGENDA_CALENDRIERS, [{ id, personne }] dans l'ordre donné
//           (sert aussi à outils/verif-ha.mjs) ; lireVoitures(env) -> les voitures de VOITURES, [{ nom, entites: { batterie,
//           branchee, autonomie?, charge?, activite?, restant?, charger?, clim?, phares?, klaxon?, charge_min?,
//           charge_cible? } }] dans l'ordre donné (sert aussi à outils/verif-ha.mjs) ; lireClims(env) -> les clims de
//           CLIMS, [{ nom, entites: { climat, eco?, boost?, sommeil?, ioniseur?, pas_sur_moi?, hors_gel? } }] dans l'ordre
//           donné (sert aussi à outils/verif-ha.mjs) ;
//           chargerConfig()   -> le même objet plus { cles: { cadre, clevo }, cleClevoCreee, port, hote, version,
//           dossierWeb, dossierMenus, dossierEtat, actionsReelles, actionsMaison, actionsVoiture, actionsClim, calendriers,
//           voitures, clims, lieu, haDemo,
//           wifiInvitesFichier,
//           go2rtc: { url, flux } (flux null : pas de direct vidéo), immich: { url, cle, cheminCle, cleAbsente, source,
//           demo }, dev } ; immich.cle vaut null sans clé (photos à configurer), immich.source { type: 'tout' },
//           { type: 'favoris' } ou { type: 'album', albumId } ; lireImmich(env, dev) -> le même objet immich (sert aussi à
//           outils/verif-immich.mjs) ; lireLieu(env) -> { nom, latitude, longitude }, le lieu de la météo.
//           Une configuration invalide lève une Error au message en français, sans jamais citer un secret.
// Pièges  :
//   - Les valeurs par défaut sont celles du développement sur le Clevo (HA du M900, écoute sur
//     127.0.0.1). En Docker : HA_URL=http://host.docker.internal:8123 et HOTE=0.0.0.0.
//   - « ~/ » en tête de chemin est développé ici : une variable d'environnement ne passe pas par le shell.
//   - Le jeton doit être celui de l'utilisateur HA « Mur » (non admin), JAMAIS ~/homeassistant/ha_token
//     du M900 (admin). outils/verif-ha.mjs refuse un jeton admin.
//   - Deux clés d'appareil de 32 caractères au moins (64 en hexadécimal pour 32 octets aléatoires), qui
//     doivent différer : chacune se révoque seule (changer son fichier puis redémarrer), et seule celle du
//     Clevo ouvre /api/etat et GET /api/courses (conception §2.5).
//   - En développement SEULEMENT, la clé du Clevo est créée (32 octets aléatoires, fichier en 600) si son
//     fichier n'existe pas : cleClevoCreee le dit à index.js, qui le journalise. En production, un fichier
//     absent est une erreur, comme pour les autres secrets.
//   - actionsReelles n'est vrai QUE si ACTIONS_REELLES vaut exactement « 1 » : sinon les actions courses_* sont
//     simulées et rien n'est écrit dans HA (conception §6.0 b, accord de Thomas). La connexion HA le revérifie.
//   - actionsMaison, garde-fou SÉPARÉ, n'est vrai QUE si ACTIONS_MAISON vaut exactement « 1 » : sinon les actions
//     maison (télécommandes, direct de la sonnette, serveur/ha/actions-maison.js) sont simulées, quel que soit
//     ACTIONS_REELLES (conception §6.0 c, accord séparé de Thomas). La connexion HA le revérifie aussi.
//   - actionsVoiture, troisième garde-fou SÉPARÉ, n'est vrai QUE si ACTIONS_VOITURE vaut exactement « 1 » : sinon les
//     commandes de la voiture (serveur/ha/actions-voiture.js : charge, clim, appel de phares, klaxon, niveaux de charge)
//     sont simulées, quels que soient ACTIONS_REELLES et ACTIONS_MAISON. La connexion HA le revérifie aussi.
//   - actionsClim, quatrième garde-fou SÉPARÉ, n'est vrai QUE si ACTIONS_CLIM vaut exactement « 1 » : sinon les commandes
//     des clims (serveur/ha/actions-clim.js) sont simulées, quels que soient les trois autres. La connexion le revérifie.
//   - WIFI_INVITES_FICHIER : chemin du fichier secret du Wi-Fi invités (wifi_invites.json), absent par défaut ;
//     il est relu à chaque demande (serveur/sources/wifi-invites.js) : le déposer ne demande pas de redémarrage.
//   - GO2RTC_URL (défaut : go2rtc du M900, http://192.168.1.187:1984 ; en Docker http://host.docker.internal:1984)
//     et GO2RTC_FLUX_SONNETTE (nom du flux de la sonnette dans GET /api/streams de go2rtc, vide par défaut) : sans
//     nom de flux, pas de direct vidéo ni de bouton « Voir le direct » (serveur/sources/direct-sonnette.js). À laisser
//     vide tant que go2rtc écoute le réseau local sans authentification (README, « Sonnette »).
//     Le nom est le numéro de série de la sonnette : il reste hors du dépôt (.env, ou ~/cadre/.env sur le M900).
//   - dev n'est vrai QUE si NODE_ENV vaut exactement « development » : il ouvre les routes /dev (app.js).
//     Toute autre valeur, ou son absence (Docker, npm start), donne la production.
//   - AGENDA_CALENDRIERS : « calendar.domicile=Thomas,calendar.travail=Thomas », chaque calendrier associé à la
//     personne dont il porte les rendez-vous (espaces tolérés autour des virgules et du signe égal), vide par
//     défaut (aucun agenda relié : l'écran Agenda le dit). C'est une liste blanche : seuls ces calendriers sont
//     lus (calendar.get_events, serveur/ha/agenda.js). Le prénom ne sert que d'étiquette (initiale et couleur sur
//     la page, une couleur PAR PERSONNE, dans l'ordre de première apparition) : 1 à 20 lettres, espaces, traits
//     d'union ou apostrophes. Un calendrier mal formé, sans prénom ou répété est refusé au démarrage.
//   - VOITURES (choix de Thomas du 14/10, écran Voitures) : vide par défaut (« Voiture pas encore reliée »). Une voiture :
//     « Mégane: batterie=sensor.x, branchee=binary_sensor.y, autonomie=sensor.z, charge=sensor.t, activite=sensor.u,
//     restant=sensor.v », deux au plus, séparées par « ; » (espaces tolérés). Le nom est celui que la page affiche (jamais
//     le friendly_name de HA, qui contient la plaque) : 1 à 20 lettres, chiffres, espaces, traits d'union ou
//     apostrophes. batterie et branchee sont obligatoires (l'alerte du soir en a besoin), les autres facultatifs, dont
//     les commandes (décision de Thomas du 14/10) : charger, clim, phares, klaxon (button) et charge_min, charge_cible
//     (number). Chaque rôle n'accepte que son domaine (ROLES de ha/voitures.js : sensor, binary_sensor pour branchee,
//     button ou number pour les commandes) : jamais device_tracker ni select ; un entity_id qui parle de position ou de
//     kilométrage est refusé. C'est une liste blanche : seules ces entités sont lues, et seules celles des commandes
//     peuvent être écrites (sous ACTIONS_VOITURE). Les messages d'erreur citent le nom et le rôle, jamais l'entity_id
//     (la plaque y est tant que Thomas ne le renomme pas) ; la valeur reste hors du dépôt (.env, ou ~/cadre/.env sur le
//     M900).
//   - CLIMS (choix de Thomas du 16/10, écran Clims) : vide par défaut (« Clims pas encore reliées »). Une clim :
//     « Salon: climat=climate.x, eco=switch.y, boost=switch.z... », deux au plus, séparées par « ; » (espaces tolérés).
//     Nom affiché comme pour VOITURES (1 à 20 lettres, chiffres, espaces, traits d'union ou apostrophes). climat
//     (climate) est obligatoire, les options (eco, boost, sommeil, ioniseur, pas_sur_moi, hors_gel : switch) sont
//     facultatives. Chaque rôle n'accepte que son domaine (ROLES de ha/clims.js). C'est une liste blanche : seules ces
//     entités sont lues, et écrites sous ACTIONS_CLIM.
//   - Photos Immich (conception M4) : IMMICH_URL (défaut : Immich du M900, http://192.168.1.187:2283 ; en Docker
//     http://host.docker.internal:2283) ; IMMICH_CLE_FICHIER, fichier secret de la clé API (lecture seule : asset.read et
//     asset.view), vide par défaut : pas de clé, pas de mode Photos sur le cadre, AUCUN appel à Immich. Variable donnée
//     mais fichier encore absent (clé pas encore créée) : même chose, cleAbsente le dit à index.js qui le journalise ;
//     un fichier présent mais mal formé empêche le démarrage, comme les autres secrets. Source des photos (choix de
//     Thomas du 14/10 : au hasard dans toute la photothèque) : IMMICH_SOURCE = tout (par défaut), favoris ou album, avec
//     IMMICH_ALBUM_ID (uuid) pour album seulement (IMMICH_FAVORIS, qui n'a jamais servi en production, n'existe plus).
//     Une valeur inconnue, un album sans uuid ou mal formé, un uuid sans IMMICH_SOURCE=album sont refusés au démarrage :
//     une valeur ambiguë ne doit pas montrer d'autres photos que celles voulues.
//   - IMMICH_DEMO=1 : faux Immich de démonstration (serveur/sources/immich-demo.js), seulement avec
//     NODE_ENV=development ; ailleurs, le démarrage est REFUSÉ avec un message clair (une démo ne doit jamais tourner
//     en production, et une variable oubliée dans le compose se voit au déploiement).
//   - LIEU_NOM, LIEU_LATITUDE, LIEU_LONGITUDE : le lieu des prévisions Open-Meteo (air, pollens, pluie, semaine) et le
//     nom écrit après la date sur l'Accueil. Paris par défaut ; les trois se donnent ensemble ou pas du tout (des
//     coordonnées sans le nom, ou l'inverse, afficheraient la météo d'un endroit sous le nom d'un autre).
//   - HA_DEMO=1 : faux Home Assistant de démonstration (serveur/sources/ha-demo.js, lancé par outils/demo.mjs), seulement
//     avec NODE_ENV=development, et jamais avec un garde-fou ACTIONS_* à 1 : la démo ne peut rien écrire nulle part.
//   - DOSSIER_WEB, DOSSIER_MENUS et DOSSIER_ETAT : relatifs à la racine du projet, ou absolus. Par défaut
//     web/ en développement comme en production (sources servies telles quelles, sans étape de construction) ; data/menus et
//     data/etat (ignorés par git ; montés depuis ~/cadre/data en Docker).

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIMS_MAX, ROLES as ROLES_CLIM } from './ha/clims.js';
import {
  MOTS_INTERDITS, ROLES, ROLES_REQUIS, VOITURES_MAX,
} from './ha/voitures.js';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const LONGUEUR_MIN_CLE = 32;
const MOTIF_CALENDRIER = /^calendar\.[a-z0-9_]+$/;
const MOTIF_PRENOM = /^\p{L}[\p{L}' -]{0,19}$/u;
const MOTIF_NOM_VOITURE = /^[\p{L}\d][\p{L}\d' -]{0,19}$/u;
const MOTIF_ENTITE_VOITURE = /^(sensor|binary_sensor|button|number)\.[a-z0-9_]+$/;
const MOTIF_ENTITE_CLIM = /^(climate|switch)\.[a-z0-9_]+$/;
const MOTIF_ROLE = /^[a-z][a-z_]{0,11}$/;
const MOTIF_URL = /^https?:\/\/[^/]+$/;
const MOTIF_FLUX = /^[A-Za-z0-9_-]{1,64}$/;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SOURCES_IMMICH = ['tout', 'favoris', 'album'];
const MOTIF_NOM_LIEU = /^[\p{L}\d][\p{L}\d' -]{0,29}$/u;
const LIEU_PAR_DEFAUT = Object.freeze({ nom: 'Paris', latitude: 48.8566, longitude: 2.3522 });

const PAR_DEFAUT = {
  HA_URL: 'http://192.168.1.187:8123',
  HA_JETON_FICHIER: '~/.config/cadre/ha_token_dev',
  CLE_CADRE_FICHIER: '~/.config/cadre/cle_dev',
  CLE_CLEVO_FICHIER: '~/.config/cadre/cle_clevo_dev',
  PORT: '8020',
  HOTE: '127.0.0.1',
  DOSSIER_MENUS: join('data', 'menus'),
  DOSSIER_ETAT: join('data', 'etat'),
  GO2RTC_URL: 'http://192.168.1.187:1984',
  IMMICH_URL: 'http://192.168.1.187:2283',
};
const DOSSIER_WEB_PAR_DEFAUT = { dev: 'web', production: 'web' };

function valeur(env, nom) {
  const brute = env[nom];
  return brute === undefined || brute.trim() === '' ? PAR_DEFAUT[nom] : brute.trim();
}

function developperChemin(chemin) {
  return chemin.startsWith('~/') ? join(homedir(), chemin.slice(2)) : chemin;
}

const cheminProjet = (chemin) => resolve(RACINE, developperChemin(chemin));

// Lit un fichier de secret ; le message d'erreur ne donne que le chemin, jamais le contenu.
function lireSecret(nomVariable, chemin) {
  let contenu;
  try {
    contenu = readFileSync(chemin, 'utf8').trim();
  } catch (err) {
    throw new Error(`${nomVariable} : fichier illisible (${chemin}) : ${err.code ?? err.message}`);
  }
  if (contenu === '' || /\s/.test(contenu)) {
    throw new Error(`${nomVariable} : le fichier ${chemin} doit contenir une seule valeur, sans espace`);
  }
  return contenu;
}

function lireCle(nomVariable, chemin) {
  const cle = lireSecret(nomVariable, chemin);
  if (cle.length < LONGUEUR_MIN_CLE) {
    throw new Error(`${nomVariable} : la clé de ${chemin} est trop courte (${LONGUEUR_MIN_CLE} caractères au moins)`);
  }
  return cle;
}

// Développement : crée la clé si le fichier n'existe pas ('wx' : jamais d'écrasement). Renvoie vrai si créée.
function creerCleSiAbsente(chemin) {
  if (existsSync(chemin)) return false;
  mkdirSync(dirname(chemin), { recursive: true, mode: 0o700 });
  writeFileSync(chemin, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  return true;
}

export function chargerConfigHA(env = process.env) {
  const haUrl = valeur(env, 'HA_URL').replace(/\/+$/, '');
  if (!MOTIF_URL.test(haUrl)) {
    throw new Error(`HA_URL doit être de la forme http://hote:port, sans chemin (reçu : ${haUrl})`);
  }
  const haJeton = lireSecret('HA_JETON_FICHIER', developperChemin(valeur(env, 'HA_JETON_FICHIER')));
  return { haUrl, haJeton };
}

export function lireCalendriers(env = process.env) {
  const brute = (env.AGENDA_CALENDRIERS || '').trim();
  if (brute === '') return [];
  const calendriers = brute.split(',').map((element) => {
    const [id, personne, ...reste] = element.split('=').map((partie) => partie.trim());
    if (!MOTIF_CALENDRIER.test(id)) {
      throw new Error(`AGENDA_CALENDRIERS : « ${element.trim()} » ne commence pas par un entity_id de calendrier (calendar.nom=Prénom, en minuscules, séparés par des virgules)`);
    }
    if (personne === undefined || reste.length > 0 || !MOTIF_PRENOM.test(personne)) {
      throw new Error(`AGENDA_CALENDRIERS : ${id} sans prénom valable (calendar.nom=Prénom, 20 lettres au plus)`);
    }
    return Object.freeze({ id, personne });
  });
  const doublon = calendriers.find((calendrier, i) => calendriers.findIndex((autre) => autre.id === calendrier.id) !== i);
  if (doublon) throw new Error(`AGENDA_CALENDRIERS : ${doublon.id} est donné deux fois`);
  return calendriers;
}

// Une voiture : « Nom: role=entity_id, role=entity_id... ». Les messages citent le nom et le rôle, jamais l'entity_id
// (il contient souvent la plaque d'immatriculation).
function lireVoiture(texte) {
  const deuxPoints = texte.indexOf(':');
  const nom = (deuxPoints === -1 ? '' : texte.slice(0, deuxPoints)).trim();
  if (!MOTIF_NOM_VOITURE.test(nom)) {
    throw new Error('VOITURES : chaque voiture commence par son nom affiché suivi de deux-points (Mégane: batterie=sensor.nom,...), 20 lettres ou chiffres au plus');
  }
  const entites = {};
  texte.slice(deuxPoints + 1).split(',').forEach((element, rang) => {
    const [role, entityId, ...reste] = element.split('=').map((partie) => partie.trim());
    if (!Object.hasOwn(ROLES, role)) {
      // Le texte fautif n'est recopié que s'il a la forme d'un rôle : un rôle oublié ou « : » au lieu de « = » y met
      // l'entity_id, donc la plaque, qui finirait dans les journaux Docker.
      const cite = MOTIF_ROLE.test(role) ? `rôle inconnu « ${role} »` : `élément n° ${rang + 1} sans rôle reconnu (forme rôle=entity_id)`;
      throw new Error(`VOITURES : ${nom}, ${cite} (rôles : ${Object.keys(ROLES).join(', ')})`);
    }
    if (entites[role]) throw new Error(`VOITURES : ${nom}, ${role} est donné deux fois`);
    if (reste.length > 0 || !MOTIF_ENTITE_VOITURE.test(entityId || '') || !entityId.startsWith(`${ROLES[role]}.`)) {
      throw new Error(`VOITURES : ${nom}, ${role} : entity_id de ${ROLES[role]} attendu (${ROLES[role]}.nom, en minuscules)`);
    }
    if (MOTS_INTERDITS.test(entityId)) {
      throw new Error(`VOITURES : ${nom}, ${role} : position et kilométrage ne sont jamais lus (entité refusée)`);
    }
    entites[role] = entityId;
  });
  const manquant = ROLES_REQUIS.find((role) => !entites[role]);
  if (manquant) throw new Error(`VOITURES : ${nom} sans ${manquant} (${ROLES_REQUIS.join(' et ')} sont obligatoires)`);
  return Object.freeze({ nom, entites: Object.freeze(entites) });
}

export function lireVoitures(env = process.env) {
  const brute = (env.VOITURES || '').trim();
  if (brute === '') return [];
  const voitures = brute.split(';').map((texte) => lireVoiture(texte.trim()));
  if (voitures.length > VOITURES_MAX) throw new Error(`VOITURES : ${VOITURES_MAX} voitures au plus (place mesurée de l'écran Voitures)`);
  const noms = voitures.map((voiture) => voiture.nom);
  const nomRepete = noms.find((nom, i) => noms.indexOf(nom) !== i);
  if (nomRepete) throw new Error(`VOITURES : ${nomRepete} est donné deux fois`);
  const ids = voitures.flatMap((voiture) => Object.values(voiture.entites));
  if (new Set(ids).size !== ids.length) throw new Error('VOITURES : une même entité sert deux fois');
  return voitures;
}

// Une clim : « Nom: role=entity_id, role=entity_id... ».
function lireClim(texte) {
  const deuxPoints = texte.indexOf(':');
  const nom = (deuxPoints === -1 ? '' : texte.slice(0, deuxPoints)).trim();
  if (!MOTIF_NOM_VOITURE.test(nom)) {
    throw new Error('CLIMS : chaque clim commence par son nom affiché suivi de deux-points (Salon: climat=climate.nom,...), 20 lettres ou chiffres au plus');
  }
  const entites = {};
  texte.slice(deuxPoints + 1).split(',').forEach((element, rang) => {
    const [role, entityId, ...reste] = element.split('=').map((partie) => partie.trim());
    if (!Object.hasOwn(ROLES_CLIM, role)) {
      const cite = MOTIF_ROLE.test(role) ? `rôle inconnu « ${role} »` : `élément n° ${rang + 1} sans rôle reconnu (forme rôle=entity_id)`;
      throw new Error(`CLIMS : ${nom}, ${cite} (rôles : ${Object.keys(ROLES_CLIM).join(', ')})`);
    }
    if (entites[role]) throw new Error(`CLIMS : ${nom}, ${role} est donné deux fois`);
    if (reste.length > 0 || !MOTIF_ENTITE_CLIM.test(entityId || '') || !entityId.startsWith(`${ROLES_CLIM[role]}.`)) {
      throw new Error(`CLIMS : ${nom}, ${role} : entity_id de ${ROLES_CLIM[role]} attendu (${ROLES_CLIM[role]}.nom, en minuscules)`);
    }
    entites[role] = entityId;
  });
  if (!entites.climat) throw new Error(`CLIMS : ${nom} sans climat (l'entité climate est obligatoire)`);
  return Object.freeze({ nom, entites: Object.freeze(entites) });
}

export function lireClims(env = process.env) {
  const brute = (env.CLIMS || '').trim();
  if (brute === '') return [];
  const clims = brute.split(';').map((texte) => lireClim(texte.trim()));
  if (clims.length > CLIMS_MAX) throw new Error(`CLIMS : ${CLIMS_MAX} clims au plus (place mesurée de l'écran Clims)`);
  const noms = clims.map((clim) => clim.nom);
  const nomRepete = noms.find((nom, i) => noms.indexOf(nom) !== i);
  if (nomRepete) throw new Error(`CLIMS : ${nomRepete} est donné deux fois`);
  const ids = clims.flatMap((clim) => Object.values(clim.entites));
  if (new Set(ids).size !== ids.length) throw new Error('CLIMS : une même entité sert deux fois');
  return clims;
}

function lireGo2rtc(env) {
  const url = valeur(env, 'GO2RTC_URL').replace(/\/+$/, '');
  if (!MOTIF_URL.test(url)) throw new Error(`GO2RTC_URL doit être de la forme http://hote:port, sans chemin (reçu : ${url})`);
  const flux = (env.GO2RTC_FLUX_SONNETTE || '').trim();
  if (flux !== '' && !MOTIF_FLUX.test(flux)) {
    throw new Error('GO2RTC_FLUX_SONNETTE : lettres, chiffres, _ et - seulement (nom du flux dans /api/streams de go2rtc)');
  }
  return Object.freeze({ url, flux: flux === '' ? null : flux });
}

// Un drapeau qui ne prend que « 1 » ou rien : toute autre valeur est une erreur (et non un « non » silencieux).
function drapeau(env, nom, message) {
  const brute = (env[nom] || '').trim();
  if (brute !== '' && brute !== '1') throw new Error(`${nom} : 1 ou vide (${message})`);
  return brute === '1';
}

// Les photos montrées : toute la photothèque (par défaut), les favoris, ou un album (avec son uuid).
function lireSourceImmich(env) {
  const type = (env.IMMICH_SOURCE || '').trim() || 'tout';
  if (!SOURCES_IMMICH.includes(type)) throw new Error(`IMMICH_SOURCE : tout, favoris ou album (reçu : ${type})`);
  const albumId = (env.IMMICH_ALBUM_ID || '').trim().toLowerCase();
  if (type !== 'album') {
    if (albumId !== '') throw new Error('IMMICH_ALBUM_ID donné sans IMMICH_SOURCE=album : choisir la source (tout, favoris ou album)');
    return Object.freeze({ type });
  }
  if (!MOTIF_UUID.test(albumId)) {
    throw new Error('IMMICH_ALBUM_ID : identifiant d\'album attendu avec IMMICH_SOURCE=album (uuid, 8-4-4-4-12 chiffres hexadécimaux, lu dans l\'adresse de l\'album)');
  }
  return Object.freeze({ type, albumId });
}

export function lireImmich(env = process.env, dev = env.NODE_ENV === 'development') {
  const url = valeur(env, 'IMMICH_URL').replace(/\/+$/, '');
  if (!MOTIF_URL.test(url)) throw new Error(`IMMICH_URL doit être de la forme http://hote:port, sans chemin (reçu : ${url})`);
  const source = lireSourceImmich(env);
  const demo = drapeau(env, 'IMMICH_DEMO', 'démonstration en développement seulement');
  if (demo && !dev) throw new Error('IMMICH_DEMO=1 n\'existe qu\'en développement (NODE_ENV=development) : retirer cette variable');
  const fichier = (env.IMMICH_CLE_FICHIER || '').trim();
  const cheminCle = fichier === '' ? null : cheminProjet(fichier);
  const cleAbsente = cheminCle !== null && !existsSync(cheminCle);
  return Object.freeze({
    url,
    cle: cheminCle === null || cleAbsente ? null : lireSecret('IMMICH_CLE_FICHIER', cheminCle),
    cheminCle,
    cleAbsente,
    source,
    demo,
  });
}

// Le lieu de la météo : les trois variables ensemble, ou aucune (Paris).
export function lireLieu(env = process.env) {
  const noms = ['LIEU_NOM', 'LIEU_LATITUDE', 'LIEU_LONGITUDE'];
  const [nom, latitude, longitude] = noms.map((variable) => (env[variable] || '').trim());
  const donnees = [nom, latitude, longitude].filter((brute) => brute !== '').length;
  if (donnees === 0) return LIEU_PAR_DEFAUT;
  if (donnees !== noms.length) throw new Error(`${noms.join(', ')} : les trois ensemble, ou aucune (Paris par défaut)`);
  if (!MOTIF_NOM_LIEU.test(nom)) throw new Error('LIEU_NOM : 1 à 30 lettres, chiffres, espaces, traits d\'union ou apostrophes');
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error(`LIEU_LATITUDE : nombre entre -90 et 90, point décimal (reçu : ${latitude})`);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error(`LIEU_LONGITUDE : nombre entre -180 et 180, point décimal (reçu : ${longitude})`);
  return Object.freeze({ nom, latitude: lat, longitude: lon });
}

export function chargerConfig(env = process.env) {
  const port = Number(valeur(env, 'PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT doit être un entier entre 1 et 65535 (reçu : ${env.PORT})`);
  }
  const dev = env.NODE_ENV === 'development';
  const cheminCleClevo = developperChemin(valeur(env, 'CLE_CLEVO_FICHIER'));
  const cleClevoCreee = dev && creerCleSiAbsente(cheminCleClevo);
  const cles = Object.freeze({
    cadre: lireCle('CLE_CADRE_FICHIER', developperChemin(valeur(env, 'CLE_CADRE_FICHIER'))),
    clevo: lireCle('CLE_CLEVO_FICHIER', cheminCleClevo),
  });
  if (cles.cadre === cles.clevo) {
    throw new Error('CLE_CADRE_FICHIER et CLE_CLEVO_FICHIER donnent la même clé : il en faut deux différentes');
  }
  const { version } = JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8'));
  const dossierWeb = env.DOSSIER_WEB?.trim() || DOSSIER_WEB_PAR_DEFAUT[dev ? 'dev' : 'production'];
  const wifi = (env.WIFI_INVITES_FICHIER || '').trim();
  const haDemo = drapeau(env, 'HA_DEMO', 'démonstration en développement seulement');
  if (haDemo && !dev) throw new Error('HA_DEMO=1 n\'existe qu\'en développement (NODE_ENV=development) : retirer cette variable');
  const gardeFou = ['ACTIONS_REELLES', 'ACTIONS_MAISON', 'ACTIONS_VOITURE', 'ACTIONS_CLIM'].find((nom) => env[nom] === '1');
  if (haDemo && gardeFou) throw new Error(`HA_DEMO=1 avec ${gardeFou}=1 : la démonstration reste en mode essai, retirer ${gardeFou}`);
  return Object.freeze({
    ...chargerConfigHA(env),
    cles,
    cleClevoCreee,
    port,
    hote: valeur(env, 'HOTE'),
    version,
    dossierWeb: cheminProjet(dossierWeb),
    dossierMenus: cheminProjet(valeur(env, 'DOSSIER_MENUS')),
    dossierEtat: cheminProjet(valeur(env, 'DOSSIER_ETAT')),
    actionsReelles: env.ACTIONS_REELLES === '1',
    actionsMaison: env.ACTIONS_MAISON === '1',
    actionsVoiture: env.ACTIONS_VOITURE === '1',
    actionsClim: env.ACTIONS_CLIM === '1',
    calendriers: Object.freeze(lireCalendriers(env)),
    voitures: Object.freeze(lireVoitures(env)),
    clims: Object.freeze(lireClims(env)),
    wifiInvitesFichier: wifi === '' ? null : cheminProjet(wifi),
    go2rtc: lireGo2rtc(env),
    immich: lireImmich(env, dev),
    lieu: lireLieu(env),
    haDemo,
    dev,
  });
}
