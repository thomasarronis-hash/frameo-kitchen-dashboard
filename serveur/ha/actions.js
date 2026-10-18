// serveur/ha/actions.js
//
// Rôle    : LISTE BLANCHE des actions de COURSES que le cadre peut demander (POST /api/action/:nom) : pour chacune
//           le service HA, l'entité FIGÉE et le schéma du corps ; exécution réelle ou simulée. Les actions maison
//           (télécommandes, direct de la sonnette) et celles de la voiture (commandes de la Mégane) ont chacune leur
//           propre table et leur propre garde-fou : serveur/ha/actions-maison.js et actions-voiture.js, qui reprennent
//           verifierActions et ErreurAction d'ici.
// Entrées : creerActions({ connexion, courses, reelles, journal }) : ConnexionHA (ecrire), SourceCourses
//           (actualiser, simuler), reelles = config.actionsReelles (ACTIONS_REELLES=1).
// Sorties : ACTIONS (nom -> { domaine, service, entity_id, schema, attendu, donnees(corps) }),
//           verifierActions(table, { scripts, voiture, clim }) (scripts : les seuls script.* permis dans cette table,
//           aucun par défaut ; voiture : les seules entités button.* et number.* permises, celles des commandes de
//           VOITURES, aucune par défaut ; clim : les seules entités climate.* et switch.* permises, celles de CLIMS, aucune
//           par défaut) ;
//           creerActions(...) -> { executer(nom, corps), simulation } : executer résout { ok: true, simulation } ou
//           rejette une ErreurAction { statusCode, code, message } : 404 action_inconnue, 400 corps_invalide, 502
//           action_echouee ; simulation (booléen) dit le mode, repris dans l'instantané du flux pour que l'écran
//           Courses affiche « mode essai ».
// Pièges  :
//   - Simulation par défaut : sans ACTIONS_REELLES=1, AUCUNE méthode de la connexion HA n'est appelée (ni
//     écriture ni relecture) ; la copie locale des courses change et part dans le flux, et le journal dit
//     « simulation ». La réponse a la même forme qu'en réel (ces services de HA ne renvoient rien).
//   - En réel : écriture par connexion.ecrire (qui revérifie sa propre liste et ACTIONS_REELLES), puis relecture
//     de la liste avant de répondre, pour que l'écran et l'appelant voient le nouvel état.
//   - entity_id figé dans la table, jamais lu dans le corps ; un article est toujours désigné par son uid.
//   - verifierActions() refuse au chargement tout domaine, service ou entité interdits (conception §2.4) :
//     Freebox, alarm_center et son select (contournent le panneau à code), TOUT le domaine alarm_control_panel
//     (décision de Thomas du 13/10 : le cadre n'arme ni ne désarme), notify, shell_command, les script.* hors de
//     la liste donnée (aucun pour les courses), remote.turn_off ; une entité d'un autre domaine que le service ; et
//     tout button ou number hors de la liste voiture donnée (aucun pour les courses et la maison), ou avec un autre
//     service que button.press et number.set_value. Ce dernier message ne cite pas l'entité (plaque de la voiture).
//     De même, tout climate ou switch hors de la liste clim donnée (aucun pour les courses, la maison et la voiture), ou
//     avec un autre service que ceux des clims (SERVICES_CLIM) : un switch de la Freebox reste interdit avant tout.
//   - Corps validés par ajv (draft 2020-12), additionalProperties: false partout. Le message de refus dit la
//     forme attendue (champ attendu de la table), en français.
//   - Texte d'un article : ni contrôles, ni sauts de ligne, ni inversions bidi, ni demi-paire de substitution
//     isolée (liste et raisons dans partage/caracteres-invisibles.js) : une demi-paire ferait couper à HA toute la
//     connexion du serveur, et un caractère bidi maquillerait l'article dans l'appli HA.
//   - Nom cherché par Object.hasOwn : « constructor » ou « __proto__ » sont des actions inconnues.

import Ajv2020 from 'ajv/dist/2020.js';
import { INVISIBLES } from '../../partage/caracteres-invisibles.js';
import { SERVICES_CLIM } from './clims.js';

const ENTITE_COURSES = 'todo.shopping_list';
const TEXTE_ARTICLE = { type: 'string', minLength: 1, maxLength: 60, pattern: `^(?=.*\\S)[^${INVISIBLES}]+$` };
const UID = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' };
const objet = (proprietes) => ({
  type: 'object', additionalProperties: false, required: Object.keys(proprietes), properties: proprietes,
});

export const ACTIONS = Object.freeze({
  courses_ajouter: {
    domaine: 'todo', service: 'add_item', entity_id: ENTITE_COURSES,
    schema: objet({ texte: TEXTE_ARTICLE }),
    attendu: '{ "texte": 1 à 60 caractères, pas seulement des espaces, sans caractère invisible }',
    donnees: ({ texte }) => ({ item: texte.trim() }),
  },
  courses_cocher: {
    domaine: 'todo', service: 'update_item', entity_id: ENTITE_COURSES,
    schema: objet({ uid: UID, fait: { type: 'boolean' } }),
    attendu: '{ "uid": identifiant de l\'article, "fait": true ou false }',
    donnees: ({ uid, fait }) => ({ item: uid, status: fait ? 'completed' : 'needs_action' }),
  },
  courses_supprimer: {
    domaine: 'todo', service: 'remove_item', entity_id: ENTITE_COURSES,
    schema: objet({ uid: UID }),
    attendu: '{ "uid": identifiant de l\'article }',
    donnees: ({ uid }) => ({ item: uid }),
  },
  courses_vider_coches: {
    domaine: 'todo', service: 'remove_completed_items', entity_id: ENTITE_COURSES,
    schema: objet({}),
    attendu: '{} (corps vide)',
    donnees: () => ({}),
  },
});

const ENTITES_INTERDITES = [/^switch\.freebox_/, /^button\.freebox_/, /^alarm_control_panel\./, /^select\.alarm_center_guard_mode$/];
const DOMAINES_INTERDITS = new Set(['notify', 'shell_command', 'alarm_control_panel']);
const SERVICES_INTERDITS = new Set(['remote.turn_off']);
const SERVICES_VOITURE = Object.freeze({ button: 'press', number: 'set_value' });

export function verifierActions(table, { scripts = [], voiture = [], clim = [] } = {}) {
  for (const [nom, { domaine, service, entity_id: entite }] of Object.entries(table)) {
    if (DOMAINES_INTERDITS.has(domaine)) throw new Error(`actions : domaine interdit ${domaine} (${nom})`);
    if (domaine === 'script' && !scripts.includes(entite)) throw new Error(`actions : script non permis ${entite} (${nom})`);
    if (SERVICES_INTERDITS.has(`${domaine}.${service}`)) throw new Error(`actions : service interdit ${domaine}.${service} (${nom})`);
    if (ENTITES_INTERDITES.some((motif) => motif.test(entite))) throw new Error(`actions : entité interdite ${entite} (${nom})`);
    if (entite.split('.')[0] !== domaine) throw new Error(`actions : ${entite} n'est pas du domaine ${domaine} (${nom})`);
    if (Object.hasOwn(SERVICES_VOITURE, domaine) && (SERVICES_VOITURE[domaine] !== service || !voiture.includes(entite))) {
      throw new Error(`actions : ${domaine}.${service} réservé aux commandes de voiture de VOITURES (${nom})`);
    }
    if (Object.hasOwn(SERVICES_CLIM, domaine) && (!SERVICES_CLIM[domaine].includes(service) || !clim.includes(entite))) {
      throw new Error(`actions : ${domaine}.${service} réservé aux clims de CLIMS (${nom})`);
    }
  }
}
verifierActions(ACTIONS);

const ajv = new Ajv2020();
const VALIDATEURS = Object.fromEntries(Object.entries(ACTIONS).map(([nom, { schema }]) => [nom, ajv.compile(schema)]));

export class ErreurAction extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function creerActions({ connexion, courses, reelles, journal }) {
  async function executer(nom, corps) {
    if (!Object.hasOwn(ACTIONS, nom)) throw new ErreurAction(404, 'action_inconnue', `action inconnue : ${nom}`);
    const action = ACTIONS[nom];
    if (!VALIDATEURS[nom](corps)) throw new ErreurAction(400, 'corps_invalide', `corps invalide pour ${nom}, attendu : ${action.attendu}`);
    const service = `${action.domaine}.${action.service}`;
    const donnees = action.donnees(corps);

    if (!reelles) {
      try {
        courses.simuler(service, donnees);
      } catch (err) {
        throw new ErreurAction(502, 'action_echouee', err.message);
      }
      journal.info(`simulation : ${nom} (${service} sur ${action.entity_id}), rien n'est écrit dans Home Assistant`);
      return { ok: true, simulation: true };
    }

    try {
      await connexion.ecrire(service, action.entity_id, donnees);
    } catch (err) {
      journal.error(`${nom} : échec de ${service} (${err.message})`);
      throw new ErreurAction(502, 'action_echouee', err.message);
    }
    journal.info(`${nom} : ${service} sur ${action.entity_id}`);
    await courses.actualiser();
    return { ok: true, simulation: false };
  }

  return { executer, simulation: !reelles };
}
