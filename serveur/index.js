// serveur/index.js
//
// Rôle    : point d'entrée du BFF (npm start) : configuration, connexion à Home Assistant, sources du flux
//           (menus compris), actions de la liste blanche, serveur HTTP, arrêt propre.
// Entrées : variables d'environnement (config.js, .env.example), lues aussi dans .env par npm start.
// Sorties : serveur HTTP sur HOTE:PORT ; journaux JSON (pino) sur la sortie standard ; code 1 si la
//           configuration est invalide.
// Pièges  :
//   - Le serveur écoute même si HA est injoignable : /api/sante répond alors ha: "ko", et la connexion
//     se fait en arrière-plan dès que HA revient.
//   - SIGTERM (docker stop) ou SIGINT (Ctrl+C) : fermeture des flux SSE, de la connexion HA et des
//     minuteries, puis sortie.
//   - Actions simulées par défaut : sans ACTIONS_REELLES=1, rien n'est écrit dans HA pour les courses
//     (serveur/ha/actions.js) ; sans ACTIONS_MAISON=1, rien n'est envoyé à la maison (télécommandes, direct de la
//     sonnette : serveur/ha/actions-maison.js) ; sans ACTIONS_VOITURE=1, rien n'est envoyé à la voiture (commandes de la
//     Mégane : serveur/ha/actions-voiture.js) ; sans ACTIONS_CLIM=1, rien n'est envoyé aux clims (serveur/ha/actions-clim.js) ;
//     la connexion revérifie chacun des quatre. Le câblage des quatre drapeaux est dans garde-fous.js (testé). Chaque mode est rappelé au démarrage, en avertissement s'il est réel.
//   - Sonnette : la photo est lue par l'API REST de HA (même URL et même jeton) à travers le suivi des coups de
//     sonnette (ha/sonnette.js : de quand date la photo, partie dans le flux sous « sonnette »), le direct vidéo dans
//     go2rtc seulement si GO2RTC_FLUX_SONNETTE est donné ; sinon la page ne propose pas de direct.
//   - En développement, la clé du Clevo est créée si elle manque (config.js) : la création est journalisée,
//     jamais la valeur.
//   - NODE_ENV=development (npm run dev) sert web/ tel quel et ouvre les routes /dev, réservées à la
//     boucle locale (routes/dev.js). Un avertissement le rappelle au démarrage et donne l'adresse
//     d'appairage, avec son code tiré au hasard à chaque démarrage (seul ce journal le connaît).
//   - Les sources Open-Meteo sont reprises telles que creerSourcesOpenMeteo les rend (air, pluie, semaine) :
//     aucune n'est oubliée dans le flux ni dans l'arrêt. Les sources des menus et de l'agenda suivent le même
//     cycle de vie. L'agenda ne lit que les calendriers de AGENDA_CALENDRIERS (aucun par défaut), que
//     SourceEntites ajoute à sa liste blanche (nom seul) ; chacun y est associé à sa personne (config.js).
//   - Photos Immich : sans clé (IMMICH_CLE_FICHIER vide ou fichier pas encore déposé), aucun appel à Immich et un seul
//     message au démarrage ; avec une clé, la version d'Immich est lue au démarrage (route publique) et journalisée,
//     avec un avertissement avant la 3.2 (le filtre du lot n'existe qu'à partir d'elle). La clé n'est jamais
//     journalisée.
//   - IMMICH_DEMO=1 (développement seulement, config.js refuse ailleurs) : un faux Immich local
//     (sources/immich-demo.js, importé dynamiquement, absent de l'image Docker) remplace l'URL et la clé ; il est
//     arrêté avec le serveur.
//   - Les menus et les draps (fichiers locaux, lecture rapide) sont lus AVANT l'écoute : une page qui se reconnecte
//     pendant un redémarrage recevrait sinon un instantané sans menu (« Menu pas encore publié », recette refermée) ou
//     des draps « pas encore notés ».
//   - Empreinte du contenu servi (empreinte.js) calculée une fois, avant l'écoute : elle part dans l'instantané du flux
//     et dans /api/sante, et la page se recharge d'elle-même quand elle change (déploiement).
//   - EDF Tempo (sources/tempo.js) : JSON public de RTE, repli api-couleur-tempo.fr, filet tempo.json dans DOSSIER_ETAT ;
//     son propre rythme de lecture (6 h 05, puis toutes les 30 min tant que demain n'est pas connu, 10 h 45, 11 h 15,
//     12 h 30), User-Agent avec la version du serveur. Les draps (sources/draps.js) s'écrivent dans DOSSIER_ETAT par
//     POST /api/draps/:lit, jamais dans HA.
//   - Voitures (ha/voitures.js) : seules les entités de VOITURES (aucune par défaut) sont lues, sur la même collection
//     d'entités que SourceEntites, et projetées sous le nom donné dans VOITURES ; seules celles des rôles de commande
//     peuvent être écrites (ha/actions-voiture.js) ; le journal cite les noms et les rôles, jamais les entity_id (la
//     plaque d'immatriculation y est souvent).
//   - Clims (ha/clims.js) : seules les entités de CLIMS (aucune par défaut) sont lues, sur la même collection d'entités,
//     et projetées sous le nom donné dans CLIMS ; écrites seulement par ha/actions-clim.js.
//   - Tableau des enfants (sources/enfants.js) : barème lu et validé au démarrage dans config/enfants.json (un barème
//     faux arrête le serveur, code 1, comme une configuration invalide) ; état dans DOSSIER_ETAT/enfants, lu avant
//     l'écoute (comme les draps), jamais dans HA ; son minuteur interne (fin du minuteur d'écran, minutes perdues,
//     journée suivante) démarre et s'arrête avec les sources périodiques.

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import Fastify from 'fastify';
import application from './app.js';
import { chargerConfig } from './config.js';
import { chargerBareme } from './enfants/bareme.js';
import { creerConnexion, creerEcritures } from './garde-fous.js';
import { SourceAgenda } from './ha/agenda.js';
import { SourceClims } from './ha/clims.js';
import { SourceCourses } from './ha/courses.js';
import { SourceEntites } from './ha/entites.js';
import { SourceMeteo } from './ha/meteo.js';
import { creerPhotoSonnette } from './ha/photo-sonnette.js';
import { SourceSonnette } from './ha/sonnette.js';
import { SourceVoitures } from './ha/voitures.js';
import { empreinteDossier } from './empreinte.js';
import { optionsJournal } from './securite.js';
import { SourceMenus } from './sources/menus.js';
import { creerDirectSonnette } from './sources/direct-sonnette.js';
import { SourceDraps } from './sources/draps.js';
import { SourceEnfants } from './sources/enfants.js';
import { creerImmich, lireVersion } from './sources/immich.js';
import { creerSourcesOpenMeteo } from './sources/open-meteo.js';
import { SourceTempo } from './sources/tempo.js';

let config;
let bareme;
try {
  config = chargerConfig();
  bareme = chargerBareme();
} catch (err) {
  console.error(`Configuration invalide : ${err.message}`);
  process.exit(1);
}

const app = Fastify({ logger: optionsJournal() });
const journal = (module) => app.log.child({ module });

const connexion = creerConnexion(config, journal('ha'));
const entites = new SourceEntites(connexion, { calendriers: config.calendriers.map((calendrier) => calendrier.id) });
const meteo = new SourceMeteo(connexion, entites, journal('meteo'));
const agenda = new SourceAgenda(connexion, entites, config.calendriers, journal('agenda'));
const courses = new SourceCourses(connexion, entites, journal('courses'));
const voitures = new SourceVoitures(connexion, config.voitures);
const clims = new SourceClims(connexion, config.clims);
const sonnette = new SourceSonnette({
  photo: creerPhotoSonnette({ haUrl: config.haUrl, jeton: config.haJeton }), entites, journal: journal('sonnette'),
});
const sourcesOpenMeteo = creerSourcesOpenMeteo(journal('open-meteo'), config.lieu);
const menu = new SourceMenus({ dossier: config.dossierMenus, journal: journal('menus') });
const tempo = new SourceTempo({ dossier: config.dossierEtat, journal: journal('tempo'), version: config.version });
const draps = new SourceDraps({ dossier: config.dossierEtat, journal: journal('draps') });
const enfants = new SourceEnfants({ dossier: join(config.dossierEtat, 'enfants'), bareme, journal: journal('enfants') });
const sourcesPeriodiques = [meteo, courses, agenda, sonnette, ...Object.values(sourcesOpenMeteo), menu, tempo, enfants];
const {
  actions, actionsMaison, actionsVoiture, actionsClim,
} = creerEcritures(config, {
  connexion, entites, courses, voitures, clims, journal,
});
const directSonnette = creerDirectSonnette({ url: config.go2rtc.url, flux: config.go2rtc.flux });
const codeAppairage = config.dev ? randomBytes(12).toString('hex') : null;
const demoImmich = config.immich.demo ? await (await import('./sources/immich-demo.js')).demarrerImmichDemo() : null;
const reglagesImmich = demoImmich ? { ...config.immich, url: demoImmich.url, cle: demoImmich.cle } : config.immich;
const immich = creerImmich(reglagesImmich);

const empreinte = empreinteDossier(config.dossierWeb);

await app.register(application, {
  cles: config.cles,
  version: config.version,
  empreinte,
  dossierWeb: config.dossierWeb,
  dev: config.dev,
  port: config.port,
  codeAppairage,
  connexion,
  sources: {
    entites, meteo, courses, agenda, sonnette, ...sourcesOpenMeteo, menu, draps, tempo, voitures, clims, enfants,
  },
  actions,
  actionsMaison,
  actionsVoiture,
  actionsClim,
  photoSonnette: sonnette,
  directSonnette,
  wifiInvitesFichier: config.wifiInvitesFichier,
  immich,
  dossierEtat: config.dossierEtat,
  draps,
  enfants,
});
if (config.actionsReelles) {
  app.log.warn('ACTIONS_REELLES=1 : les actions courses_* écrivent dans Home Assistant (todo.shopping_list)');
} else {
  app.log.info('actions simulées (ACTIONS_REELLES absent ou différent de 1) : rien n\'est écrit dans Home Assistant');
}
if (config.actionsMaison) {
  app.log.warn('ACTIONS_MAISON=1 : les télécommandes et le direct de la sonnette agissent pour de vrai dans Home Assistant');
} else {
  app.log.info('actions maison simulées (ACTIONS_MAISON absent ou différent de 1) : rien n\'est envoyé à la maison');
}
if (config.actionsVoiture) {
  app.log.warn('ACTIONS_VOITURE=1 : les commandes de la voiture (charge, clim, phares, klaxon, niveaux) agissent pour de vrai');
} else {
  app.log.info('commandes de la voiture simulées (ACTIONS_VOITURE absent ou différent de 1) : rien n\'est envoyé à la voiture');
}
if (config.actionsClim) {
  app.log.warn('ACTIONS_CLIM=1 : les commandes des clims (marche, mode, consigne, ventilation, options) agissent pour de vrai');
} else {
  app.log.info('commandes des clims simulées (ACTIONS_CLIM absent ou différent de 1) : rien n\'est envoyé aux clims');
}
app.log.info(directSonnette
  ? `direct de la sonnette : flux go2rtc configuré sur ${config.go2rtc.url} (nom non journalisé)`
  : 'direct de la sonnette : pas de flux go2rtc (GO2RTC_FLUX_SONNETTE vide), pas de direct sur le cadre');
app.log.info(config.wifiInvitesFichier ? `Wi-Fi invités lu dans ${config.wifiInvitesFichier}` : 'Wi-Fi invités : WIFI_INVITES_FICHIER vide (à configurer)');
const { type: typePhotos, albumId } = config.immich.source;
const sourcePhotos = { tout: 'toute la photothèque', favoris: 'les favoris', album: `l'album ${albumId}` }[typePhotos];
if (demoImmich) {
  app.log.warn(`IMMICH_DEMO=1 : faux Immich de démonstration sur ${demoImmich.url} (images fabriquées, développement seulement)`);
} else if (immich) {
  app.log.info(`photos : Immich sur ${config.immich.url}, ${sourcePhotos} (lecture seule)`);
  lireVersion(config.immich.url).then((version) => {
    const [majeure, mineure] = version.split('.').map(Number);
    if (majeure > 3 || (majeure === 3 && mineure >= 2)) app.log.info(`photos : Immich ${version}`);
    else app.log.warn(`photos : Immich ${version}, le lot de photos demande Immich 3.2 ou plus (filtre « filter » de /search/random)`);
  }, (err) => app.log.warn(`photos : version d'Immich illisible (${err.message})`));
} else if (config.immich.cleAbsente) {
  app.log.warn(`photos : IMMICH_CLE_FICHIER donné mais ${config.immich.cheminCle} n'existe pas encore : « Photos Immich à configurer »`);
} else {
  app.log.info('photos : pas de clé Immich (IMMICH_CLE_FICHIER vide) : « Photos Immich à configurer », aucun appel à Immich');
}
if (config.cleClevoCreee) app.log.warn('clé de développement du Clevo créée (CLE_CLEVO_FICHIER, fichier en 600)');
app.log.info(`menus lus dans ${config.dossierMenus}, état local dans ${config.dossierEtat} (drive, draps, tempo, enfants)`);
app.log.info(`enfants : barème de ${bareme.enfants.length} enfant(s), ${bareme.boutique.length} cadeau(x) (config/enfants.json)`);
app.log.info(`empreinte du contenu servi : ${empreinte || 'aucune (dossier web absent)'}`);
app.log.info(config.calendriers.length > 0
  ? `agenda : ${config.calendriers.map((c) => `${c.id} (${c.personne})`).join(', ')} (calendar.get_events, lecture seule)`
  : 'agenda : aucun calendrier configuré (AGENDA_CALENDRIERS vide)');
app.log.info(config.voitures.length > 0
  ? `voitures : ${config.voitures.map((v) => `${v.nom} (${Object.keys(v.entites).join(', ')})`).join(', ')}`
  : 'voitures : aucune configurée (VOITURES vide), « Voiture pas encore reliée »');
app.log.info(config.clims.length > 0
  ? `clims : ${config.clims.map((c) => `${c.nom} (${Object.keys(c.entites).join(', ')})`).join(', ')}`
  : 'clims : aucune configurée (CLIMS vide), « Clims pas encore reliées »');
if (config.dev) {
  app.log.warn(`mode développement : page servie depuis ${config.dossierWeb}, routes /dev actives (boucle locale seulement)`);
  app.log.warn(`appairage du navigateur de développement : http://127.0.0.1:${config.port}/dev/appairer?code=${codeAppairage}`);
}
app.addHook('onClose', async () => {
  for (const source of sourcesPeriodiques) source.arreter();
  connexion.arreter();
  if (demoImmich) demoImmich.arreter();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info(`${signal} reçu : arrêt du serveur`);
    await app.close();
    process.exit(0);
  });
}

await Promise.all([menu.actualiser(), draps.actualiser(), enfants.actualiser()]);
await app.listen({ host: config.hote, port: config.port });
for (const source of sourcesPeriodiques) source.demarrer();
connexion.demarrer();
