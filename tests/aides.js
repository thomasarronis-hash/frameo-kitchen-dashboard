// tests/aides.js
//
// Rôle    : monter l'application du BFF (serveur/app.js) pour les tests, avec une fausse connexion HA,
//           de fausses sources et un journal capturé en mémoire.
// Entrées : monter({ dossierWeb, dev, intervallePingMs, sources, actions, actionsMaison, actionsVoiture, actionsClim,
//           photoSonnette,
//           directSonnette, wifiInvitesFichier, immich, dossierEtat, draps, enfants, modeParent, empreinte }) ; en développement,
//           les routes /dev reçoivent PORT_DEV et CODE_APPAIRAGE (HOTE_DEV est l'en-tête Host qu'elles acceptent).
//           Sans sources.menu, une fausse source de menu vide est ajoutée EN TÊTE (l'instantané commence donc par
//           menu) ; sans actions, des actions simulées sur sources.courses ; sans actionsMaison, des actions maison
//           simulées sur sources.entites (ou des entités vides) ; sans actionsVoiture, des commandes de voiture simulées
//           sans aucune voiture configurée (sources.voitures ou une valeur vide) ; sans actionsClim, des commandes de clim
//           simulées sans aucune clim configurée (sources.clims ou une valeur vide) ; sans photoSonnette, une photo qui échoue
//           (« pas de photo dans ce test ») ; sans directSonnette, pas de direct vidéo ; sans wifiInvitesFichier, aucun ;
//           sans immich, pas de clé Immich (photos à configurer) ;
//           sans dossierEtat, un dossier inexistant (les tests qui écrivent passent un dossier temporaire) ; sans draps,
//           pas de route des draps ; sans enfants, pas de routes des enfants (modeParent : celui des routes par défaut) ;
//           sans empreinte, null (pas de page servie).
// Sorties : { app, connexion, sources, journal } ; journal() renvoie tout le texte journalisé ;
//           CLE (clé du cadre) et CLE_CLEVO ; ouvrirFlux(url, enTetes) lit un flux SSE réel et renvoie
//           { reponse, lireEvenement, fermer }.
// Pièges  : le flux SSE ne se termine jamais, inject() de Fastify attendrait sans fin : les tests du flux
//           écoutent sur un vrai port (0 = choisi par le système, sur 127.0.0.1) et lisent avec fetch.
//           La fausse connexion n'a ni lire ni ecrire : un test qui en a besoin passe sa propre source.

import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import application from '../serveur/app.js';
import { creerActions } from '../serveur/ha/actions.js';
import { creerActionsClim } from '../serveur/ha/actions-clim.js';
import { creerActionsMaison } from '../serveur/ha/actions-maison.js';
import { creerActionsVoiture } from '../serveur/ha/actions-voiture.js';
import { optionsJournal } from '../serveur/securite.js';

export const CLE = 'cle-de-test-0123456789abcdef0123456789abcdef';
export const CLE_CLEVO = 'cle-clevo-de-test-0123456789abcdef0123456789';
export const VERSION = '0.0.0-test';
export const PORT_DEV = 8020;
export const HOTE_DEV = `127.0.0.1:${PORT_DEV}`;
export const CODE_APPAIRAGE = 'code-appairage-de-test-0123';

export class FausseSource extends EventEmitter {
  constructor(valeur) {
    super();
    this.valeur = valeur;
  }

  publier(valeur) {
    this.valeur = valeur;
    this.emit('maj', valeur);
  }
}

const photoAbsente = { lire: async () => { throw new Error('pas de photo dans ce test'); } };

export async function monter({
  dossierWeb = '/inexistant', dev = false, intervallePingMs, sources: sourcesTest = {}, actions, actionsMaison, actionsVoiture,
  actionsClim, photoSonnette = photoAbsente, directSonnette = null, wifiInvitesFichier = null, immich = null, dossierEtat = '/inexistant/etat',
  draps = null, enfants = null, modeParent, empreinte = null,
} = {}) {
  const lignes = [];
  // forceCloseConnections : fetch (undici) ouvre parfois une connexion d'avance, restée vide ; sans cette
  // option, app.close() l'attendrait jusqu'à 4 s (délai de maintien d'undici).
  const app = Fastify({ logger: optionsJournal({ flux: { write: (ligne) => lignes.push(ligne) } }), forceCloseConnections: true });
  const connexion = new EventEmitter();
  connexion.etat = 'ok';
  const sources = { menu: new FausseSource(null), ...sourcesTest };
  await app.register(application, {
    cles: { cadre: CLE, clevo: CLE_CLEVO },
    version: VERSION,
    empreinte,
    dossierWeb,
    dev,
    port: PORT_DEV,
    codeAppairage: CODE_APPAIRAGE,
    connexion,
    sources,
    actions: actions || creerActions({ connexion, courses: sources.courses, reelles: false, journal: app.log }),
    actionsMaison: actionsMaison || creerActionsMaison({
      connexion, entites: sources.entites || { valeur: {} }, reelles: false, journal: app.log,
    }),
    actionsVoiture: actionsVoiture || creerActionsVoiture({
      connexion, voitures: [], source: sources.voitures || { valeur: [] }, reelles: false, journal: app.log,
    }),
    actionsClim: actionsClim || creerActionsClim({
      connexion, clims: [], source: sources.clims || { valeur: [] }, reelles: false, journal: app.log,
    }),
    photoSonnette,
    directSonnette,
    wifiInvitesFichier,
    immich,
    dossierEtat,
    draps,
    enfants,
    modeParent,
    intervallePingMs,
  });
  return { app, connexion, sources, journal: () => lignes.join('') };
}

export async function ouvrirFlux(url, enTetes = {}) {
  const abandon = new AbortController();
  const reponse = await fetch(url, { headers: enTetes, signal: abandon.signal });
  const lecteur = reponse.body.pipeThrough(new TextDecoderStream()).getReader();
  let tampon = '';

  // Renvoie le prochain événement complet : { nom, retry, donnees, brut }.
  async function lireEvenement() {
    while (!tampon.includes('\n\n')) {
      const { value, done } = await lecteur.read();
      if (done) throw new Error('flux terminé');
      tampon += value;
    }
    const fin = tampon.indexOf('\n\n');
    const brut = tampon.slice(0, fin + 2);
    tampon = tampon.slice(fin + 2);
    return {
      nom: /^event: (.+)$/m.exec(brut)?.[1],
      retry: /^retry: (\d+)$/m.exec(brut)?.[1],
      donnees: JSON.parse(/^data: (.+)$/m.exec(brut)[1]),
      brut,
    };
  }

  return { reponse, lireEvenement, fermer: () => abandon.abort() };
}
