// serveur/ha/connexion.js
//
// Rôle    : tenir LA connexion WebSocket du BFF vers Home Assistant, la rétablir seule après une coupure,
//           et exposer son état. Seul point du serveur qui parle à HA.
// Entrées : { url, jeton, journal, actionsReelles, actionsMaison, actionsVoiture, ecrituresVoiture, actionsClim,
//           ecrituresClim, delaiLectureMs, connecter } ; jeton longue durée de l'utilisateur « Mur » (non admin) ; actionsReelles vrai seulement si
//           ACTIONS_REELLES vaut 1, actionsMaison vrai seulement si ACTIONS_MAISON vaut 1, actionsVoiture vrai seulement si
//           ACTIONS_VOITURE vaut 1, actionsClim vrai seulement si ACTIONS_CLIM vaut 1 (config.js) : quatre verrous
//           indépendants ; ecrituresVoiture, les couples « service entity_id » des commandes de VOITURES (garde-fous.js,
//           d'après ecrituresVoitures de voitures.js), aucun par défaut ; ecrituresClim, ceux des clims de CLIMS
//           (ecrituresClims de clims.js), aucun par défaut ; delaiLectureMs, délai d'une lecture (25 s) ; connecter, createConnection de la bibliothèque
//           (un faux dans les tests).
// Sorties : ConnexionHA (EventEmitter) :
//           - etat : 'ok' ou 'ko', et l'événement 'etat' à chaque bascule ;
//           - 'connectee' (une seule fois, avec la Connection de la bibliothèque) pour s'abonner aux entités ;
//           - 'prete' à chaque connexion et reconnexion, pour relire ce qui a pu changer pendant la coupure ;
//           - lire(service, entityId, donnees) : appel avec return_response, limité à weather.get_forecasts,
//             todo.get_items et calendar.get_events, chacun sur une entité de son propre domaine (garde-fou de
//             lecture), rejeté au bout de delaiLectureMs sans réponse ;
//           - ecrire(service, entityId, donnees) : appel sans réponse, limité à todo.add_item, todo.update_item,
//             todo.remove_item et todo.remove_completed_items sur todo.shopping_list, et seulement si
//             actionsReelles est vrai (garde-fou d'écriture des courses) ;
//           - ecrireMaison(service, entityId, donnees) : appel sans réponse, limité aux 4 couples de ECRITURES_MAISON
//             (touches des deux télécommandes, appli de l'Apple TV, direct de la sonnette), et seulement si
//             actionsMaison est vrai (garde-fou d'écriture maison, SÉPARÉ) ;
//           - ecrireVoiture(service, entityId, donnees) : appel sans réponse, limité à button.press et number.set_value
//             sur les entités des commandes de VOITURES (ecrituresVoiture), et seulement si actionsVoiture est vrai
//             (garde-fou d'écriture de la voiture, SÉPARÉ des deux autres) ;
//           - ecrireClim(service, entityId, donnees) : appel sans réponse, limité aux services climate.* et switch.* des
//             clims sur les entités de CLIMS (ecrituresClim), et seulement si actionsClim est vrai (garde-fou d'écriture
//             des clims, SÉPARÉ des trois autres). Aucun autre service n'est joignable par ce
//             module : ni l'alarme (aucun service alarm_control_panel, décision de Thomas du 13/10), ni la Freebox, ni
//             les notifications, ni un autre script.
// Pièges  :
//   - WebSocket natif de Node 22 (global), sans le paquet ws. createLongLivedTokenAuth n'utilise ni
//     window ni location (seules les fonctions OAuth de la bibliothèque en ont besoin).
//   - Première connexion : reprise maison avec attente croissante (1 à 30 s) ; la bibliothèque, elle,
//     réessaierait toutes les secondes. Ensuite, c'est la bibliothèque qui reconnecte (attente de 0 à 5 s)
//     et qui rejoue les abonnements (subscribe_entities).
//   - Les garde-fous d'écriture sont le dernier verrou : serveur/ha/actions.js et actions-maison.js simulent déjà
//     tout quand leur variable ne vaut pas 1, mais une erreur de câblage ne peut pas écrire pour autant. Ils
//     refusent AVANT de regarder la connexion : un refus ne dépend jamais de l'état de HA. ACTIONS_REELLES=1
//     n'ouvre ni la maison ni la voiture, ACTIONS_MAISON=1 ni les courses ni la voiture, ACTIONS_VOITURE=1 ni les
//     courses ni la maison ; ACTIONS_CLIM=1 n'ouvre que les clims, et aucun des trois autres ne les ouvre.
//   - Écritures maison : couples (service, entité) exacts ; les touches et les applis permises sont vérifiées
//     avant, par le schéma de actions-maison.js.
//   - Écritures de la voiture : couples donnés à la création, vérifiés tout de suite (button.press sur un button.*,
//     number.set_value sur un number.*, sinon Error au démarrage) : aucun couple maison, d'alarme ou de courses ne peut
//     entrer par là. Les messages de refus ne citent JAMAIS l'entity_id (la plaque d'immatriculation y est souvent).
//   - ERR_INVALID_AUTH (jeton révoqué ou faux) : on S'ARRÊTE, état ko, sans boucle. Chaque échec crée une
//     notification « Login attempt failed » dans HA, et un bannissement d'IP si login_attempts_threshold
//     est réglé, ce qui bloquerait aussi le jeton suivant.
//   - Une coupure Wi-Fi ne ferme pas toujours la socket (TCP à moitié ouvert, aucun événement close) :
//     ping toutes les 30 s, et sans réponse en 10 s, reconnexion forcée.
//   - Une lecture qui ne répond jamais (calendar.get_events d'un CalDAV iCloud ou Google muet : HA passe par Internet à
//     chaque appel) est rejetée au bout de 25 s (« délai dépassé ») : sinon la source qui l'attend (socle Source, une
//     lecture à la fois) resterait bloquée pour de bon, sans erreur, le ping gardant la connexion en vie. La réponse
//     tardive éventuelle est ignorée.

import { EventEmitter } from 'node:events';
import { callService, createConnection, createLongLivedTokenAuth, ERR_INVALID_AUTH } from 'home-assistant-js-websocket';

const SERVICES_LECTURE = new Set(['weather.get_forecasts', 'todo.get_items', 'calendar.get_events']);
const SERVICES_ECRITURE = new Set(['todo.add_item', 'todo.update_item', 'todo.remove_item', 'todo.remove_completed_items']);
const ENTITES_ECRITURE = new Set(['todo.shopping_list']);
const SERVICES_VOITURE = new Set(['button.press', 'number.set_value']);
const MOTIF_ECRITURE_VOITURE = /^(button\.press button|number\.set_value number)\.[a-z0-9_]+$/;
const MOTIF_ECRITURE_CLIM = /^(climate\.(turn_on|turn_off|set_hvac_mode|set_temperature|set_fan_mode|set_swing_mode|set_swing_horizontal_mode) climate|switch\.(turn_on|turn_off) switch)\.[a-z0-9_]+$/;
const ECRITURES_MAISON = new Set([
  'remote.send_command remote.sejour_sejour',
  'media_player.select_source media_player.sejour_sejour',
  'remote.send_command remote.smart_tv_pro_2',
  'script.turn_on script.sonnette_direct',
]);
const ATTENTES_PREMIERE_CONNEXION_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const DELAI_LECTURE_MS = 25_000;
const INTERVALLE_PING_MS = 30_000;
const DELAI_PONG_MS = 10_000;

// La bibliothèque rejette avec un code numérique (ERR_*) ou un objet { code, message } venu de HA.
const NOMS_ERREURS = { 1: 'ERR_CANNOT_CONNECT', 2: 'ERR_INVALID_AUTH', 3: 'ERR_CONNECTION_LOST', 4: 'ERR_HASS_HOST_REQUIRED' };
function decrireErreur(err) {
  if (typeof err === 'number') return NOMS_ERREURS[err] ?? `erreur ${err}`;
  if (err?.code && err?.message) return `${err.code} : ${err.message}`;
  return err?.message ?? String(err);
}

export class ConnexionHA extends EventEmitter {
  #auth;
  #connecter;
  #delaiLectureMs;
  #journal;
  #actionsReelles;
  #actionsMaison;
  #actionsVoiture;
  #ecrituresVoiture;
  #actionsClim;
  #ecrituresClim;
  #conn = null;
  #etat = 'ko';
  #arretee = false;
  #minuteurPing = null;
  #attente = null;

  constructor({
    url, jeton, journal, actionsReelles = false, actionsMaison = false, actionsVoiture = false, ecrituresVoiture = [],
    actionsClim = false, ecrituresClim = [], delaiLectureMs = DELAI_LECTURE_MS, connecter = createConnection,
  }) {
    super();
    this.#auth = createLongLivedTokenAuth(url, jeton);
    this.#connecter = connecter;
    this.#delaiLectureMs = delaiLectureMs;
    this.#journal = journal;
    this.#actionsReelles = actionsReelles === true;
    this.#actionsMaison = actionsMaison === true;
    this.#actionsVoiture = actionsVoiture === true;
    if (!ecrituresVoiture.every((couple) => MOTIF_ECRITURE_VOITURE.test(couple))) {
      throw new Error('ecrituresVoiture : seuls button.press sur un button et number.set_value sur un number sont permis');
    }
    this.#ecrituresVoiture = new Set(ecrituresVoiture);
    this.#actionsClim = actionsClim === true;
    if (!ecrituresClim.every((couple) => MOTIF_ECRITURE_CLIM.test(couple))) {
      throw new Error('ecrituresClim : seuls les services des clims sur un climate et turn_on ou turn_off sur un switch sont permis');
    }
    this.#ecrituresClim = new Set(ecrituresClim);
  }

  get etat() {
    return this.#etat;
  }

  // Résout à la première connexion réussie, ou à l'abandon (jeton refusé, arrêt demandé).
  async demarrer() {
    for (let essai = 0; !this.#arretee; essai += 1) {
      try {
        const conn = await this.#connecter({ auth: this.#auth });
        if (this.#arretee) {
          conn.close();
          return;
        }
        this.#brancher(conn);
        return;
      } catch (err) {
        if (err === ERR_INVALID_AUTH) {
          this.#journal.error('jeton Home Assistant refusé : connexion abandonnée (vérifier HA_JETON_FICHIER)');
          return;
        }
        const attenteMs = ATTENTES_PREMIERE_CONNEXION_MS[Math.min(essai, ATTENTES_PREMIERE_CONNEXION_MS.length - 1)];
        this.#journal.warn(`Home Assistant injoignable (${decrireErreur(err)}), nouvel essai dans ${attenteMs / 1000} s`);
        await new Promise((reveiller) => {
          this.#attente = { minuteur: setTimeout(reveiller, attenteMs), reveiller };
        });
      }
    }
  }

  arreter() {
    this.#arretee = true;
    if (this.#attente) {
      clearTimeout(this.#attente.minuteur);
      this.#attente.reveiller();
    }
    clearInterval(this.#minuteurPing);
    this.#conn?.close();
    this.#definirEtat('ko');
  }

  async lire(service, entityId, donnees) {
    if (!SERVICES_LECTURE.has(service)) throw new Error(`service refusé, lecture seule : ${service}`);
    const [domaine, action] = service.split('.');
    if (typeof entityId !== 'string' || !entityId.startsWith(`${domaine}.`)) {
      throw new Error(`lecture refusée : ${service} sur ${entityId}, hors de son domaine`);
    }
    if (this.#etat !== 'ok') throw new Error('Home Assistant non connecté');
    let minuteur;
    const expiration = new Promise((_resoudre, rejeter) => {
      minuteur = setTimeout(() => rejeter(new Error(`délai dépassé (${this.#delaiLectureMs / 1000} s)`)), this.#delaiLectureMs);
    });
    try {
      const { response } = await Promise.race([callService(this.#conn, domaine, action, donnees, { entity_id: entityId }, true), expiration]);
      return response?.[entityId];
    } catch (err) {
      throw new Error(`${service} : ${decrireErreur(err)}`);
    } finally {
      clearTimeout(minuteur);
    }
  }

  async ecrire(service, entityId, donnees) {
    if (!SERVICES_ECRITURE.has(service) || !ENTITES_ECRITURE.has(entityId)) {
      throw new Error(`écriture refusée, hors liste : ${service} sur ${entityId}`);
    }
    if (!this.#actionsReelles) throw new Error('écriture refusée : ACTIONS_REELLES ne vaut pas 1');
    await this.#appeler(service, entityId, donnees);
  }

  async ecrireMaison(service, entityId, donnees) {
    if (!ECRITURES_MAISON.has(`${service} ${entityId}`)) {
      throw new Error(`écriture maison refusée, hors liste : ${service} sur ${entityId}`);
    }
    if (!this.#actionsMaison) throw new Error('écriture maison refusée : ACTIONS_MAISON ne vaut pas 1');
    await this.#appeler(service, entityId, donnees);
  }

  async ecrireVoiture(service, entityId, donnees) {
    if (!this.#ecrituresVoiture.has(`${service} ${entityId}`)) {
      const cite = SERVICES_VOITURE.has(service) ? service : 'service non permis';
      throw new Error(`écriture voiture refusée, hors liste : ${cite}`);
    }
    if (!this.#actionsVoiture) throw new Error('écriture voiture refusée : ACTIONS_VOITURE ne vaut pas 1');
    await this.#appeler(service, entityId, donnees);
  }

  async ecrireClim(service, entityId, donnees) {
    if (!this.#ecrituresClim.has(`${service} ${entityId}`)) {
      throw new Error(`écriture clim refusée, hors liste : ${service} sur ${entityId}`);
    }
    if (!this.#actionsClim) throw new Error('écriture clim refusée : ACTIONS_CLIM ne vaut pas 1');
    await this.#appeler(service, entityId, donnees);
  }

  async #appeler(service, entityId, donnees) {
    if (this.#etat !== 'ok') throw new Error('Home Assistant non connecté');
    const [domaine, action] = service.split('.');
    try {
      await callService(this.#conn, domaine, action, donnees, { entity_id: entityId });
    } catch (err) {
      throw new Error(`${service} : ${decrireErreur(err)}`);
    }
  }

  #brancher(conn) {
    this.#conn = conn;
    conn.addEventListener('ready', () => {
      this.#journal.info('connexion à Home Assistant rétablie');
      this.#pret();
    });
    conn.addEventListener('disconnected', () => {
      this.#journal.warn('connexion à Home Assistant perdue, reprise automatique');
      this.#definirEtat('ko');
    });
    conn.addEventListener('reconnect-error', (_conn, err) => {
      this.#journal.error(`reconnexion à Home Assistant refusée (${decrireErreur(err)}) : arrêt des essais`);
      this.arreter();
    });
    this.#journal.info(`connecté à Home Assistant ${conn.haVersion}`);
    this.emit('connectee', conn);
    this.#pret();
    this.#surveiller();
  }

  #pret() {
    this.#definirEtat('ok');
    this.emit('prete');
  }

  #definirEtat(etat) {
    if (etat === this.#etat) return;
    this.#etat = etat;
    this.emit('etat', etat);
  }

  #surveiller() {
    this.#minuteurPing = setInterval(async () => {
      if (this.#etat !== 'ok') return;
      const conn = this.#conn;
      let minuteur;
      const expiration = new Promise((resoudre) => {
        minuteur = setTimeout(resoudre, DELAI_PONG_MS, 'expire');
      });
      // Un ping rejeté (connexion perdue) est déjà traité par l'événement 'disconnected'.
      const issue = await Promise.race([conn.ping().then(() => 'pong', () => 'perdu'), expiration]);
      clearTimeout(minuteur);
      if (issue === 'expire' && this.#etat === 'ok') {
        this.#journal.warn(`Home Assistant ne répond plus au ping (${DELAI_PONG_MS / 1000} s) : reconnexion forcée`);
        this.#definirEtat('ko');
        conn.reconnect(true);
      }
    }, INTERVALLE_PING_MS);
    this.#minuteurPing.unref();
  }
}
