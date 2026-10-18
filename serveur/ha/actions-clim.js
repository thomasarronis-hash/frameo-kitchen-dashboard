// serveur/ha/actions-clim.js
//
// Rôle    : les COMMANDES des clims que le cadre peut demander (POST /api/action/:nom, décision de Thomas du 16/10 : le
//           panneau entier, sans protection contre les enfants) : marche et arrêt, mode, consigne, ventilation, oscillations
//           et options (Eco, Boost, Sommeil, Ioniseur, « Pas sur moi », Hors-gel) ; exécution réelle ou simulée, sous le
//           garde-fou ACTIONS_CLIM, séparé de ceux des courses, de la maison et de la voiture.
// Entrées : creerActionsClim({ connexion, clims, source, reelles, journal, monotone }) : ConnexionHA (ecrireClim),
//           clims = config.clims (lireClims), source = SourceClims (valeur : la projection, ce que chaque clim accepte),
//           reelles = config.actionsClim (ACTIONS_CLIM=1), monotone = horloge monotone en ms (performance.now ; une fausse
//           dans les tests).
//           Corps (clim : un nom de CLIMS) : clim_marche { clim, marche } ; clim_mode { clim, mode } ; clim_consigne { clim,
//           valeur } ; clim_ventilation { clim, ventilation } ; clim_oscillation { clim, sens, actif } ; clim_option { clim,
//           option, actif }.
// Sorties : ACTIONS_CLIM (nom -> { schema, attendu }), ECART_MS (2 s), BUDGET_HORAIRE (120 commandes par heure glissante) ;
//           creerActionsClim(...) -> { executer(nom, corps), connait(nom), simulation } : executer résout { ok: true,
//           simulation } ou rejette une ErreurAction (actions.js) : 404 action_inconnue, 400 corps_invalide (dont consigne
//           hors des bornes ou pas sur la grille), 404 clim_inconnue, 404 commande_absente (option pas dans CLIMS), 503
//           commande_indisponible (clim ou option indisponible dans HA, valeur que la clim n'accepte pas, option que la clim
//           refuse de changer maintenant), 503 bornes_inconnues (consigne pas encore lue), 429 trop_tot, 502
//           action_echouee ; simulation part dans l'instantané (simulation_clim) pour le « Mode essai » de l'écran Clims.
// Pièges  :
//   - Simulation par défaut : sans ACTIONS_CLIM=1, AUCUNE méthode de la connexion HA n'est appelée ; même réponse qu'en
//     réel et journal « simulation ». Toutes les règles (corps, clim, valeurs acceptées, anti-rafale) s'appliquent pareil.
//   - entity_id FIGÉ au démarrage depuis CLIMS (ecrituresClims de clims.js), jamais lu dans le corps : le corps ne
//     désigne qu'un nom de clim et une commande. verifierActions (actions.js) contrôle la table au démarrage : services
//     climate et switch sur ces entités-là seulement, rien d'autre.
//   - Valeur contrôlée contre ce que la clim dit accepter MAINTENANT (projection de SourceClims) : un mode, une
//     ventilation ou un sens d'oscillation absent : 503 ; consigne hors des bornes ou pas sur la grille min + k x pas :
//     400 ; option dont writable_now vaut false (clim éteinte, par exemple) : 503.
//   - Anti-rafale (cloud Bosch, quota inconnu ; ce n'est PAS une protection contre les enfants, il n'y en a aucune, choix
//     de Thomas) : une même commande d'une même clim au plus toutes les 2 s (un mode, une option ou un sens comptent
//     chacun à part), et 120 commandes au plus sur une heure glissante, toutes clims confondues. Compté à l'acceptation,
//     même si HA échoue ensuite ; un refus ne consomme rien. Horloge monotone.
//   - Nom cherché par Object.hasOwn : « constructor » ou « __proto__ » ne sont pas des actions des clims.

import Ajv2020 from 'ajv/dist/2020.js';
import { ErreurAction, verifierActions } from './actions.js';
import {
  ecrituresClims, MODES, ROLES_OPTIONS, SENS, VENTILATIONS,
} from './clims.js';

export const ECART_MS = 2_000;
export const BUDGET_HORAIRE = 120;
const HEURE_MS = 3_600_000;
const MINUTE_MS = 60_000;
const NOM_CLIM = { type: 'string', minLength: 1, maxLength: 20 };
const objet = (proprietes) => ({
  type: 'object', additionalProperties: false, required: Object.keys(proprietes), properties: proprietes,
});

export const ACTIONS_CLIM = Object.freeze({
  clim_marche: {
    schema: objet({ clim: NOM_CLIM, marche: { type: 'boolean' } }),
    attendu: '{ "clim": nom de CLIMS, "marche": true ou false }',
  },
  clim_mode: {
    schema: objet({ clim: NOM_CLIM, mode: { enum: MODES } }),
    attendu: `{ "clim": nom de CLIMS, "mode": ${MODES.join(', ')} }`,
  },
  clim_consigne: {
    schema: objet({ clim: NOM_CLIM, valeur: { type: 'number', minimum: 0, maximum: 50 } }),
    attendu: '{ "clim": nom de CLIMS, "valeur": degrés de 0 à 50 }',
  },
  clim_ventilation: {
    schema: objet({ clim: NOM_CLIM, ventilation: { enum: VENTILATIONS } }),
    attendu: `{ "clim": nom de CLIMS, "ventilation": ${VENTILATIONS.join(', ')} }`,
  },
  clim_oscillation: {
    schema: objet({ clim: NOM_CLIM, sens: { enum: Object.keys(SENS) }, actif: { type: 'boolean' } }),
    attendu: `{ "clim": nom de CLIMS, "sens": ${Object.keys(SENS).join(', ')}, "actif": true ou false }`,
  },
  clim_option: {
    schema: objet({ clim: NOM_CLIM, option: { enum: ROLES_OPTIONS }, actif: { type: 'boolean' } }),
    attendu: `{ "clim": nom de CLIMS, "option": ${ROLES_OPTIONS.join(', ')}, "actif": true ou false }`,
  },
});

const ajv = new Ajv2020();
const VALIDATEURS = Object.fromEntries(Object.entries(ACTIONS_CLIM).map(([nom, { schema }]) => [nom, ajv.compile(schema)]));
const connue = (nom) => typeof nom === 'string' && Object.hasOwn(ACTIONS_CLIM, nom);
const surLaGrille = (valeur, { min, pas }) => {
  const rang = (valeur - min) / pas;
  return Math.abs(rang - Math.round(rang)) < 1e-9;
};
const indisponible = (texte) => new ErreurAction(503, 'commande_indisponible', `${texte} : indisponible dans Home Assistant`);

// La table au format de verifierActions (actions.js), chaque entrée nommée « clim · rôle · service ».
function tableVerifiable(ecritures) {
  return Object.fromEntries(ecritures.map(({ nom, role, service, entityId }) => {
    const [domaine, action] = service.split('.');
    return [`${nom} · ${role} · ${service}`, { domaine, service: action, entity_id: entityId }];
  }));
}

// Ce que demande le corps : rôle visé, service, données, clé de l'anti-rafale et texte du journal ; contrôlé contre la
// projection (ce que la clim accepte maintenant).
function demande(nom, corps, projection) {
  const texte = `${corps.clim} · ${nom.replace('clim_', '')}`;
  if (nom === 'clim_option') {
    const etat = projection.options.find((entree) => entree.cle === corps.option);
    const libelle = `${corps.clim} · ${corps.option}`;
    if (!etat) throw indisponible(libelle);
    if (!etat.modifiable) {
      throw new ErreurAction(503, 'commande_indisponible', `${libelle} : la clim ne permet pas de la changer maintenant`);
    }
    return {
      role: corps.option, service: `switch.${corps.actif ? 'turn_on' : 'turn_off'}`, donnees: {}, cle: libelle,
      texte: `${libelle} ${corps.actif ? 'activée' : 'coupée'}`,
    };
  }
  if (!projection.disponible) throw indisponible(texte);
  if (nom === 'clim_marche') {
    return {
      role: 'climat', service: `climate.${corps.marche ? 'turn_on' : 'turn_off'}`, donnees: {}, cle: texte,
      texte: `${corps.clim} · ${corps.marche ? 'marche' : 'arrêt'}`,
    };
  }
  if (nom === 'clim_mode') {
    if (!projection.modes.includes(corps.mode)) throw indisponible(`${texte} ${corps.mode}`);
    return {
      role: 'climat', service: 'climate.set_hvac_mode', donnees: { hvac_mode: corps.mode }, cle: texte,
      texte: `${texte} ${corps.mode}`,
    };
  }
  if (nom === 'clim_consigne') {
    const bornes = projection.consigne;
    if (!bornes) throw new ErreurAction(503, 'bornes_inconnues', `${texte} : pas encore lue dans Home Assistant`);
    if (corps.valeur < bornes.min || corps.valeur > bornes.max || !surLaGrille(corps.valeur, bornes)) {
      const attendu = `de ${bornes.min} à ${bornes.max}, par pas de ${bornes.pas}`;
      throw new ErreurAction(400, 'corps_invalide', `corps invalide pour clim_consigne : ${corps.clim} ${attendu}`);
    }
    return {
      role: 'climat', service: 'climate.set_temperature', donnees: { temperature: corps.valeur }, cle: texte,
      texte: `${texte} ${corps.valeur}`,
    };
  }
  if (nom === 'clim_ventilation') {
    if (!projection.ventilations.includes(corps.ventilation)) throw indisponible(`${texte} ${corps.ventilation}`);
    return {
      role: 'climat', service: 'climate.set_fan_mode', donnees: { fan_mode: corps.ventilation }, cle: texte,
      texte: `${texte} ${corps.ventilation}`,
    };
  }
  const libelle = `${texte} ${corps.sens}`;
  if (projection.oscillation[corps.sens] === null) throw indisponible(libelle);
  return {
    role: 'climat',
    service: `climate.set_${SENS[corps.sens]}`,
    donnees: { [SENS[corps.sens]]: corps.actif ? 'on' : 'off' },
    cle: libelle,
    texte: `${libelle} ${corps.actif ? 'on' : 'off'}`,
  };
}

export function creerActionsClim({
  connexion, clims, source, reelles, journal, monotone = () => performance.now(),
}) {
  const ecritures = ecrituresClims(clims);
  verifierActions(tableVerifiable(ecritures), { clim: [...new Set(ecritures.map((ecriture) => ecriture.entityId))] });
  const cibles = new Map(ecritures.map((ecriture) => [`${ecriture.nom}|${ecriture.role}|${ecriture.service}`, ecriture]));
  const derniers = new Map();
  const acceptees = [];

  // Écart par commande puis budget horaire (acceptees : instants d'acceptation de la dernière heure, toutes clims) ; rien
  // n'est retenu si l'un des deux refuse.
  function retenir(cle) {
    const maintenant = monotone();
    const reste = derniers.has(cle) ? derniers.get(cle) + ECART_MS - maintenant : 0;
    if (reste > 0) {
      throw new ErreurAction(429, 'trop_tot', `trop tôt : ${cle} au plus toutes les ${ECART_MS / 1000} s, réessayer dans ${Math.ceil(reste / 1000)} s`);
    }
    while (acceptees.length > 0 && acceptees[0] + HEURE_MS <= maintenant) acceptees.shift();
    if (acceptees.length >= BUDGET_HORAIRE) {
      const minutes = Math.ceil((acceptees[0] + HEURE_MS - maintenant) / MINUTE_MS);
      throw new ErreurAction(429, 'trop_tot', `trop tôt : ${BUDGET_HORAIRE} commandes par heure au plus pour les clims, réessayer dans ${minutes} min`);
    }
    derniers.set(cle, maintenant);
    acceptees.push(maintenant);
  }

  async function executer(nom, corps) {
    if (!connue(nom)) throw new ErreurAction(404, 'action_inconnue', `action inconnue : ${nom}`);
    if (!VALIDATEURS[nom](corps)) {
      throw new ErreurAction(400, 'corps_invalide', `corps invalide pour ${nom}, attendu : ${ACTIONS_CLIM[nom].attendu}`);
    }
    if (!clims.some((clim) => clim.nom === corps.clim)) throw new ErreurAction(404, 'clim_inconnue', `clim inconnue : ${corps.clim}`);
    if (nom === 'clim_option' && !cibles.has(`${corps.clim}|${corps.option}|switch.turn_on`)) {
      throw new ErreurAction(404, 'commande_absente', `${corps.clim} · ${corps.option} : pas dans CLIMS`);
    }
    const projection = source.valeur.find((clim) => clim.nom === corps.clim);
    if (!projection) throw indisponible(corps.clim);
    const voulue = demande(nom, corps, projection);
    const ecriture = cibles.get(`${corps.clim}|${voulue.role}|${voulue.service}`);
    retenir(voulue.cle);

    if (!reelles) {
      journal.info(`simulation : ${voulue.texte} (${voulue.service}), rien n'est envoyé à la clim`);
      return { ok: true, simulation: true };
    }
    try {
      await connexion.ecrireClim(ecriture.service, ecriture.entityId, voulue.donnees);
    } catch (err) {
      journal.error(`${voulue.texte} : échec de ${voulue.service} (${err.message})`);
      throw new ErreurAction(502, 'action_echouee', `${voulue.texte} : Home Assistant n'a pas pris la commande (détail au journal du serveur)`);
    }
    journal.info(`${voulue.texte} (${voulue.service})`);
    return { ok: true, simulation: false };
  }

  return { executer, connait: connue, simulation: !reelles };
}
