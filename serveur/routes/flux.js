// serveur/routes/flux.js
//
// Rôle    : GET /api/flux, flux SSE vers la page : « instantane » à la connexion (tout l'état connu), puis
//           « maj » (ou « menu ») à chaque changement, et « ping » toutes les 20 s.
// Entrées : ConnexionHA (etat, événement 'etat') ; sources { nom: { valeur, événement 'maj' } }
//           (entites, meteo, courses, agenda, sonnette, air, pluie, semaine, menu, draps, tempo, voitures, clims, enfants) ; simulation (vrai si les actions de courses
//           sont simulées, serveur/ha/actions.js), simulationMaison (vrai si les actions maison sont simulées,
//           serveur/ha/actions-maison.js), simulationVoiture (vrai si les commandes de la voiture sont simulées,
//           serveur/ha/actions-voiture.js), simulationClim (vrai si les commandes des clims sont simulées,
//           serveur/ha/actions-clim.js), directVideo (vrai si un flux go2rtc de la sonnette est configuré),
//           photosConfigurees (vrai si une clé Immich est configurée, serveur/sources/immich.js), empreinte (du contenu
//           servi, serveur/empreinte.js, ou null) ; intervallePingMs (20 s, réduit dans les tests).
// Sorties : événements SSE, une ligne data: en JSON chacun :
//           instantane { heure_serveur, ha, simulation, simulation_maison, simulation_voiture, simulation_clim,
//           direct_video, photos_configurees, empreinte, entites, meteo, courses, agenda, sonnette, air, pluie, semaine,
//           menu, draps, tempo, voitures, clims, enfants } (retry: 3000) ;
//           voitures (serveur/ha/voitures.js) : [{ nom, batterie, autonomie, branchee, charge, vu_le, fin_charge, commandes,
//           niveaux }], [] sans VOITURES, jamais d'entity_id ni de friendly_name ;
//           clims (serveur/ha/clims.js) : [{ nom, disponible, mode, modes, temperature, consigne, ventilation, ventilations,
//           oscillation, options }], [] sans CLIMS, jamais d'entity_id ni de friendly_name ;
//           enfants (serveur/enfants/projection.js) : barème et état du jour du tableau des enfants (étapes, minutes ou
//           étoiles, minuteur d'écran, points, demande d'échange, boutique, motifs), valeur complète à chaque maj ;
//           empreinte change à chaque déploiement : la page compare celle d'une reconnexion à la première reçue et se
//           recharge d'elle-même (web/src/rechargement.js) ; simulation, simulation_maison, simulation_voiture et
//           simulation_clim valent
//           true seulement si les actions correspondantes sont simulées, direct_video seulement si GET
//           /api/sonnette.mjpeg est servi, photos_configurees seulement si GET /api/photos/lot peut répondre (modes
//           fixés au démarrage ; false : pas de mode Photos, la page ne demande rien) ;
//           maj { ha } ou { <nom de source>: fragment } (entites : seules les entités changées, null si
//           disparue ; autres sources : valeur complète) ;
//           menu { menu } quand le menu retenu change (nouvelle publication, nouveau cycle, menu retiré : null) ;
//           ping { heure_serveur } (retry: 3000).
//           heure_serveur est en millisecondes depuis 1970 : la page en tire le décalage de son horloge.
// Pièges  :
//   - reply.hijack() : Fastify ne gère plus la réponse. Les en-têtes déjà posés (limite de débit) sont
//     recopiés à la main dans writeHead.
//   - La déconnexion se lit sur la RÉPONSE ('close') : la requête d'un GET sans corps est close tout de suite.
//   - preClose ferme les flux ouverts, sinon app.close() attendrait des clients qui ne partent jamais.
//   - JSON.stringify n'émet jamais de saut de ligne brut : une seule ligne data: par événement suffit.
//   - simulation, simulation_maison, simulation_voiture, simulation_clim, direct_video, photos_configurees et empreinte ne
//     changent qu'au redémarrage du serveur (ACTIONS_REELLES, ACTIONS_MAISON, ACTIONS_VOITURE, ACTIONS_CLIM,
//     GO2RTC_FLUX_SONNETTE, IMMICH_CLE_FICHIER,
//     déploiement) : l'instantané suffit, sans maj. Toute valeur autre que true (absente, mal formée) donne false : la
//     page n'affiche « mode essai » que sur un signal explicite.
//   - Le menu part sous son propre nom d'événement (conception §2.3) : une publication n'est pas une simple
//     mise à jour d'état (la page peut refermer une recette d'un autre menu). Ses données ont la même forme
//     qu'une maj ({ menu }) : la page les range dans son magasin de la même façon.
//   - Un client qui reste connecté sans lire (onglet figé, curl suspendu par Ctrl+Z) ne se voit pas : la
//     connexion reste ouverte, sans erreur ni 'close', et ce qui lui est destiné s'accumule en mémoire.
//     Au-delà de 256 Ko en attente (une vingtaine d'instantanés), il est coupé ; la page se reconnecte
//     d'elle-même (chien de garde de 45 s) et reçoit un instantané neuf.

const INTERVALLE_PING_MS = 20_000;
const RETRY_MS = 3_000;
const PLAFOND_EN_ATTENTE_OCTETS = 256 * 1024;
const EVENEMENTS_DEDIES = new Set(['menu']);

export function evenementSSE(nom, donnees, { retry } = {}) {
  return `event: ${nom}\n${retry ? `retry: ${retry}\n` : ''}data: ${JSON.stringify(donnees)}\n\n`;
}

function instantane(connexion, sources, modes) {
  const donnees = { heure_serveur: Date.now(), ha: connexion.etat, ...modes };
  for (const [nom, source] of Object.entries(sources)) donnees[nom] = source.valeur;
  return donnees;
}

export default async function routesFlux(app, {
  connexion, sources, simulation, simulationMaison, simulationVoiture, simulationClim, directVideo, photosConfigurees,
  empreinte = null, intervallePingMs = INTERVALLE_PING_MS,
}) {
  const modes = {
    simulation: simulation === true,
    simulation_maison: simulationMaison === true,
    simulation_voiture: simulationVoiture === true,
    simulation_clim: simulationClim === true,
    direct_video: directVideo === true,
    photos_configurees: photosConfigurees === true,
    empreinte,
  };
  const clients = new Set();
  const diffuser = (texte) => {
    for (const res of clients) {
      if (res.writableLength > PLAFOND_EN_ATTENTE_OCTETS) {
        app.log.warn({ en_attente: res.writableLength }, 'client du flux qui ne lit plus : connexion coupée');
        clients.delete(res);
        res.destroy();
      } else {
        res.write(texte);
      }
    }
  };

  const desabonnements = [];
  const ecouter = (emetteur, evenement, traiter) => {
    emetteur.on(evenement, traiter);
    desabonnements.push(() => emetteur.off(evenement, traiter));
  };
  ecouter(connexion, 'etat', (etat) => diffuser(evenementSSE('maj', { ha: etat })));
  for (const [nom, source] of Object.entries(sources)) {
    const evenement = EVENEMENTS_DEDIES.has(nom) ? nom : 'maj';
    ecouter(source, 'maj', (fragment) => diffuser(evenementSSE(evenement, { [nom]: fragment })));
  }

  const minuteurPing = setInterval(() => {
    diffuser(evenementSSE('ping', { heure_serveur: Date.now() }, { retry: RETRY_MS }));
  }, intervallePingMs);
  minuteurPing.unref();

  app.addHook('preClose', async () => {
    for (const res of clients) res.end();
    clients.clear();
  });
  app.addHook('onClose', async () => {
    clearInterval(minuteurPing);
    for (const desabonner of desabonnements) desabonner();
  });

  app.get('/flux', (requete, reponse) => {
    reponse.hijack();
    const res = reponse.raw;
    res.writeHead(200, {
      ...reponse.getHeaders(),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(evenementSSE('instantane', instantane(connexion, sources, modes), { retry: RETRY_MS }));
    clients.add(res);
    requete.log.info({ clients: clients.size }, 'client du flux connecté');
    res.on('close', () => {
      clients.delete(res);
      requete.log.info({ clients: clients.size }, 'client du flux déconnecté');
    });
  });
}
