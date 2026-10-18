// serveur/app.js
//
// Rôle    : l'application HTTP du BFF, sous forme de plugin Fastify : page statique, puis /api protégée,
//           et les routes /dev en développement seulement.
//           Séparée d'index.js pour que les tests la montent avec de fausses sources, sans HA ni réseau.
// Entrées : options { cles: { cadre, clevo }, version, empreinte, dossierWeb, dev, port, codeAppairage, connexion,
//           sources, actions, actionsMaison, actionsVoiture, actionsClim, photoSonnette, directSonnette, wifiInvitesFichier, immich,
//           dossierEtat, draps, enfants, modeParent, intervallePingMs } ;
//           empreinte (serveur/empreinte.js, null sans dossier web) part dans l'instantané du flux et dans /api/sante ;
//           draps (SourceDraps, aussi dans sources pour le flux) sert la route des draps, absente sans lui (tests) ;
//           enfants (SourceEnfants, aussi dans sources) sert les routes du tableau des enfants, absentes sans lui (tests),
//           avec modeParent (enfants/mode-parent.js ; créé par routes/enfants.js s'il n'est pas donné) ;
//           sources.menu et sources.courses servent aussi aux routes menu et courses ; photoSonnette (lire()) est le
//           suivi des coups de sonnette (serveur/ha/sonnette.js), qui note l'empreinte de chaque photo lue ;
//           actions.simulation, actionsMaison.simulation, actionsVoiture.simulation et actionsClim.simulation partent dans
//           l'instantané du flux,
//           avec la présence du direct vidéo (directSonnette, null sans go2rtc configuré) et des photos (immich, null sans
//           clé Immich) ; port et codeAppairage ne servent qu'aux routes /dev.
// Sorties : GET /api/sante (publique) ; avec une clé (cadre ou Clevo) : GET /api/flux, GET /api/menu,
//           POST /api/action/:nom, POST /api/drive-pret, POST /api/draps/:lit, /api/enfants/* (routes/enfants.js),
//           GET /api/sonnette.jpg, GET /api/sonnette.mjpeg,
//           GET /api/wifi-invites, GET /api/photos/lot, GET /api/photos/<id>.jpg ; avec la clé du Clevo seulement :
//           GET /api/courses, GET /api/etat ; 404 JSON pour le reste de /api ; le dossier web s'il existe (et son
//           sous-dossier public/ à la racine) ; /dev/* si dev est vrai.
// Pièges  :
//   - La sécurité tient à l'emboîtement des contextes : /api porte la limite de débit ; /api/sante y est
//     enregistré HORS du sous-contexte « privé » qui porte exigerCle. Toute nouvelle route qui touche à la
//     maison va dans le sous-contexte privé ; celles du Clevo seul ajoutent reserverAuClevo (securite.js),
//     qui lit requete.appareil posé par exigerCle.
//   - Les touches de télécommande (POST /api/action/appletv_touche et tv_touche) sont hors limite globale mais
//     plafonnées à 10 par seconde par leur propre compteur de contexte (securite.js, conception §2.5).
//   - Le 404 propre à /api fait passer les URL inconnues (et les méthodes non prévues, OPTIONS, POST...)
//     par la limite de débit : le 404 racine de Fastify ne la verrait pas.
//   - Erreur imprévue sous /api (5xx) : journalisée en entier, mais la réponse ne dit que
//     { erreur: "erreur_interne" } (le message d'une erreur de fichier contient des chemins du serveur, que
//     l'écran Courses afficherait). Les refus voulus (4xx : JSON mal formé, corps trop gros, limite de débit)
//     gardent la réponse de Fastify, qui dit au client ce qui ne va pas.
//   - Le dossier web (web/ en développement, web/dist en production, voir config.js) est servi sans clé :
//     il ne contient aucun secret. S'il n'existe pas, rien n'est servi hors de /api. Son sous-dossier
//     public/ est servi lui aussi à la racine, comme le fait Vite : /polices/... et /icones.svg marchent
//     donc pareil avec les sources et avec un build (où public/ est déjà recopié à la racine).
//   - Servi SANS route joker (wildcard: false) : une route « /* » attraperait aussi /api/inconnue, hors du
//     contexte /api et donc hors limite. Contrepartie : la liste des fichiers est relevée au démarrage.
//     Un fichier MODIFIÉ est servi à jour (relu à chaque requête) ; un fichier AJOUTÉ demande un
//     redémarrage du serveur (en développement comme après un nouveau build).
//   - Le journal (et son masquage) est réglé à la création de Fastify : voir optionsJournal() dans securite.js.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { enregistrerLimite, exigerCle } from './securite.js';
import routesActions from './routes/actions.js';
import routesCourses from './routes/courses.js';
import routesDev from './routes/dev.js';
import routesDraps from './routes/draps.js';
import routesEnfants from './routes/enfants.js';
import routesEtat from './routes/etat.js';
import routesFlux from './routes/flux.js';
import routesMenu from './routes/menu.js';
import routesPhotos from './routes/photos.js';
import routesSante from './routes/sante.js';
import routesSonnette from './routes/sonnette.js';
import routesWifi from './routes/wifi.js';

const TOUCHES_PAR_SECONDE = 10;

export default async function application(app, {
  cles, version, empreinte = null, dossierWeb, dev = false, port, codeAppairage, connexion, sources, actions, actionsMaison,
  actionsVoiture, actionsClim, photoSonnette, directSonnette, wifiInvitesFichier, immich, dossierEtat, draps = null,
  enfants = null, modeParent, intervallePingMs,
}) {
  const telecommande = {
    concerne: (requete) => requete.method === 'POST' && actionsMaison.telecommande(requete.params && requete.params.nom),
    max: TOUCHES_PAR_SECONDE,
    fenetreMs: 1000,
  };
  const racinesWeb = [dossierWeb, join(dossierWeb, 'public')].filter((dossier) => existsSync(dossier));
  if (racinesWeb.length > 0) {
    await app.register(fastifyStatic, { root: racinesWeb, wildcard: false });
  }
  if (dev) await app.register(routesDev, { cle: cles.cadre, port, codeAppairage });

  await app.register(async (api) => {
    await enregistrerLimite(api, telecommande);
    api.setNotFoundHandler((_requete, reponse) => reponse.code(404).send({ erreur: 'introuvable' }));
    api.setErrorHandler((err, requete, reponse) => {
      const statut = err.statusCode >= 400 ? err.statusCode : 500;
      if (statut < 500) return reponse.send(err);
      requete.log.error({ err }, 'erreur interne');
      return reponse.code(statut).header('cache-control', 'no-store').send({ erreur: 'erreur_interne' });
    });
    await api.register(routesSante, { connexion, version, empreinte });

    await api.register(async (prive) => {
      await prive.register(fastifyCookie);
      prive.decorateRequest('appareil', null);
      prive.addHook('onRequest', exigerCle(cles));
      await prive.register(routesFlux, {
        connexion,
        sources,
        simulation: actions.simulation,
        simulationMaison: actionsMaison.simulation,
        simulationVoiture: actionsVoiture.simulation,
        simulationClim: actionsClim.simulation,
        directVideo: Boolean(directSonnette),
        photosConfigurees: Boolean(immich),
        empreinte,
        intervallePingMs,
      });
      await prive.register(routesMenu, { menus: sources.menu });
      await prive.register(routesCourses, { courses: sources.courses });
      await prive.register(routesActions, {
        actions, actionsMaison, actionsVoiture, actionsClim,
      });
      await prive.register(routesEtat, { dossierEtat });
      if (draps) await prive.register(routesDraps, { draps });
      if (enfants) await prive.register(routesEnfants, { enfants, modeParent });
      await prive.register(routesSonnette, { photo: photoSonnette, direct: directSonnette });
      await prive.register(routesWifi, { fichier: wifiInvitesFichier });
      await prive.register(routesPhotos, { immich });
    });
  }, { prefix: '/api' });
}
