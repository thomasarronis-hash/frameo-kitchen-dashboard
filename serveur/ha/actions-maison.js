// serveur/ha/actions-maison.js
//
// Rôle    : LISTE BLANCHE des actions MAISON que le cadre peut demander (POST /api/action/:nom) : touches des deux
//           télécommandes (Apple TV, télé TCL), appli de l'Apple TV, direct de la sonnette ; pour chacune le service
//           HA, l'entité FIGÉE et le schéma du corps ; exécution réelle ou simulée, sous le garde-fou ACTIONS_MAISON,
//           séparé de celui des courses (ACTIONS_REELLES).
// Entrées : creerActionsMaison({ connexion, entites, reelles, journal }) : ConnexionHA (ecrireMaison), SourceEntites
//           (valeur : la source_list de media_player.sejour_sejour), reelles = config.actionsMaison
//           (ACTIONS_MAISON=1).
// Sorties : ACTIONS_MAISON (nom -> { domaine, service, entity_id, schema, attendu, donnees(corps), telecommande }),
//           TOUCHES_APPLE_TV, TOUCHES_TELE ; creerActionsMaison(...) -> { executer(nom, corps), connait(nom),
//           telecommande(nom), simulation } : executer résout { ok: true, simulation } ou rejette une ErreurAction
//           (actions.js) : 404 action_inconnue, 400 corps_invalide, 503 applis_inconnues, 502 action_echouee ;
//           telecommande(nom) dit si l'action est une touche de télécommande (comptée à part : 10 par seconde, hors
//           limite globale, voir securite.js et app.js) ; simulation part dans l'instantané (simulation_maison) pour
//           le bandeau « Mode essai » de l'écran Maison.
// Pièges  :
//   - Simulation par défaut : sans ACTIONS_MAISON=1, AUCUNE méthode de la connexion HA n'est appelée ; la réponse a
//     la même forme qu'en réel (ces services de HA ne renvoient rien) et le journal dit « simulation ».
//   - Décision de Thomas du 13/10 : le cadre est loin de l'entrée, il n'arme ni ne désarme l'alarme. Aucune action
//     d'alarme ici, et verifierActions (actions.js) refuse au chargement tout le domaine alarm_control_panel, les
//     scripts autres que script.sonnette_direct, remote.turn_off (il déconnecte l'intégration Apple TV au lieu
//     d'éteindre), la Freebox, notify et shell_command.
//   - Touches en liste blanche, réduites à celles que l'écran affiche (conception §2.4, adaptée) : play_pause
//     remplace play et pause (un seul bouton lecture/pause), skip_* et top_menu ne sont pas proposés ; POWER de la
//     télé attend le test du Screenless service.
//   - Appli de l'Apple TV : la source doit figurer dans la source_list ACTUELLE de media_player.sejour_sejour (lue
//     dans SourceEntites), en simulation comme en réel. Liste encore inconnue (HA pas encore lu) : 503.
//   - entity_id figé dans la table, jamais lu dans le corps ; corps validés par ajv, additionalProperties: false.
//   - Nom cherché par Object.hasOwn : « constructor » ou « __proto__ » ne sont pas des actions maison.

import Ajv2020 from 'ajv/dist/2020.js';
import { ErreurAction, verifierActions } from './actions.js';

const ENTITE_APPLIS = 'media_player.sejour_sejour';
export const TOUCHES_APPLE_TV = Object.freeze([
  'up', 'down', 'left', 'right', 'select', 'menu', 'home', 'play_pause', 'volume_up', 'volume_down', 'wakeup', 'suspend',
]);
export const TOUCHES_TELE = Object.freeze([
  'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'BACK', 'HOME', 'MEDIA_PLAY_PAUSE', 'VOLUME_UP', 'VOLUME_DOWN', 'MUTE',
]);
const objet = (proprietes) => ({
  type: 'object', additionalProperties: false, required: Object.keys(proprietes), properties: proprietes,
});

export const ACTIONS_MAISON = Object.freeze({
  appletv_touche: {
    domaine: 'remote', service: 'send_command', entity_id: 'remote.sejour_sejour', telecommande: true,
    schema: objet({ touche: { enum: TOUCHES_APPLE_TV } }),
    attendu: `{ "touche": ${TOUCHES_APPLE_TV.join(', ')} }`,
    donnees: ({ touche }) => ({ command: touche }),
  },
  appletv_appli: {
    domaine: 'media_player', service: 'select_source', entity_id: ENTITE_APPLIS, telecommande: false,
    schema: objet({ source: { type: 'string', minLength: 1, maxLength: 100 } }),
    attendu: '{ "source": une appli de la liste de l\'Apple TV }',
    donnees: ({ source }) => ({ source }),
  },
  tv_touche: {
    domaine: 'remote', service: 'send_command', entity_id: 'remote.smart_tv_pro_2', telecommande: true,
    schema: objet({ touche: { enum: TOUCHES_TELE } }),
    attendu: `{ "touche": ${TOUCHES_TELE.join(', ')} }`,
    donnees: ({ touche }) => ({ command: touche }),
  },
  sonnette_direct: {
    domaine: 'script', service: 'turn_on', entity_id: 'script.sonnette_direct', telecommande: false,
    schema: objet({}),
    attendu: '{} (corps vide)',
    donnees: () => ({}),
  },
});
verifierActions(ACTIONS_MAISON, { scripts: ['script.sonnette_direct'] });

const ajv = new Ajv2020();
const VALIDATEURS = Object.fromEntries(Object.entries(ACTIONS_MAISON).map(([nom, { schema }]) => [nom, ajv.compile(schema)]));
const connue = (nom) => typeof nom === 'string' && Object.hasOwn(ACTIONS_MAISON, nom);

// La source demandée doit être dans la liste actuelle de l'Apple TV (projetée par serveur/ha/entites.js).
function verifierSource(entites, source) {
  const entite = entites.valeur[ENTITE_APPLIS];
  const liste = entite && Array.isArray(entite.attributes.source_list) ? entite.attributes.source_list : null;
  if (liste === null) throw new ErreurAction(503, 'applis_inconnues', 'liste des applis de l\'Apple TV pas encore lue');
  if (!liste.includes(source)) {
    throw new ErreurAction(400, 'corps_invalide', `corps invalide pour appletv_appli : « ${source} » n'est pas dans la liste des applis de l'Apple TV`);
  }
}

export function creerActionsMaison({ connexion, entites, reelles, journal }) {
  async function executer(nom, corps) {
    if (!connue(nom)) throw new ErreurAction(404, 'action_inconnue', `action inconnue : ${nom}`);
    const action = ACTIONS_MAISON[nom];
    if (!VALIDATEURS[nom](corps)) throw new ErreurAction(400, 'corps_invalide', `corps invalide pour ${nom}, attendu : ${action.attendu}`);
    if (nom === 'appletv_appli') verifierSource(entites, corps.source);
    const service = `${action.domaine}.${action.service}`;
    const donnees = action.donnees(corps);
    const detail = Object.keys(donnees).length > 0 ? ` ${JSON.stringify(donnees)}` : '';

    if (!reelles) {
      journal.info(`simulation : ${nom} (${service} sur ${action.entity_id}${detail}), rien n'est envoyé à la maison`);
      return { ok: true, simulation: true };
    }
    try {
      await connexion.ecrireMaison(service, action.entity_id, donnees);
    } catch (err) {
      journal.error(`${nom} : échec de ${service} (${err.message})`);
      throw new ErreurAction(502, 'action_echouee', err.message);
    }
    journal.info(`${nom} : ${service} sur ${action.entity_id}${detail}`);
    return { ok: true, simulation: false };
  }

  return {
    executer,
    connait: connue,
    telecommande: (nom) => connue(nom) && ACTIONS_MAISON[nom].telecommande,
    simulation: !reelles,
  };
}
