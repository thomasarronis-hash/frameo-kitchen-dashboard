// serveur/ha/actions-voiture.js
//
// Rôle    : les COMMANDES de la voiture que le cadre peut demander (POST /api/action/:nom, décision de Thomas du 14/10 :
//           toutes, sans protection contre les enfants) : voiture_commande (commencer la charge, démarrer la clim, appel
//           de phares, klaxon : button.press) et voiture_niveau (niveaux de charge minimal et cible : number.set_value) ;
//           exécution réelle ou simulée, sous le garde-fou ACTIONS_VOITURE, séparé de ceux des courses et de la maison.
// Entrées : creerActionsVoiture({ connexion, voitures, source, reelles, journal, monotone }) : ConnexionHA
//           (ecrireVoiture), voitures = config.voitures (lireVoitures), source = SourceVoitures (valeur : la projection,
//           commandes disponibles et bornes actuelles des niveaux), reelles = config.actionsVoiture (ACTIONS_VOITURE=1),
//           monotone = horloge monotone en ms (performance.now ; une fausse dans les tests).
//           Corps : voiture_commande { voiture: nom de VOITURES, commande: charger | clim | phares | klaxon } ;
//           voiture_niveau { voiture, reglage: charge_min | charge_cible, valeur: entier de 0 à 100 }.
// Sorties : ACTIONS_VOITURE (nom -> { schema, attendu }), ECART_COMMANDE_MS (30 s), ECART_REGLAGE_MS (10 s),
//           BUDGET_HORAIRE (10 commandes par heure glissante, toutes voitures) ;
//           creerActionsVoiture(...) -> { executer(nom, corps), connait(nom), simulation } : executer résout { ok: true,
//           simulation } ou rejette une ErreurAction (actions.js) : 404 action_inconnue, 400 corps_invalide (dont valeur
//           hors des bornes ou pas multiple du pas), 404 voiture_inconnue, 404 commande_absente (rôle pas dans VOITURES),
//           503 commande_indisponible (entité absente ou indisponible dans HA), 503 bornes_inconnues (niveau pas encore
//           lu), 429 trop_tot (écart par rôle ou budget horaire), 502 action_echouee ; simulation part dans l'instantané
//           (simulation_voiture) pour le « Mode essai » de l'écran Voitures.
// Pièges  :
//   - Simulation par défaut : sans ACTIONS_VOITURE=1, AUCUNE méthode de la connexion HA n'est appelée ; la réponse a la
//     même forme qu'en réel (ces services de HA ne renvoient rien) et le journal dit « simulation ». Toutes les règles
//     (corps, voiture, bornes, anti-rafale) s'appliquent pareil : le mode essai montre ce que ferait le réel.
//   - entity_id FIGÉ au démarrage depuis VOITURES (ecrituresVoitures de voitures.js), jamais lu dans le corps : le corps
//     ne désigne qu'un nom de voiture et un rôle. verifierActions (actions.js) contrôle la table au démarrage :
//     button.press et number.set_value sur ces entités-là seulement, rien d'autre (ni alarme, ni Freebox...).
//   - AUCUN entity_id dans les messages, réponses ou journaux : il contient la plaque d'immatriculation tant que Thomas ne
//     le renomme pas. Le journal dit « Mégane · klaxon » ; le message d'un échec de HA (qui peut citer l'entité, par
//     exemple « Value 50 for number.x is outside valid range ») est journalisé avec chaque entity_id de VOITURES
//     remplacé par « voiture · rôle », et la réponse 502 ne le reprend pas (la page dit « La Mégane ne répond pas »).
//   - Niveaux : la valeur est contrôlée contre min, max et step ACTUELS de l'entité (lus par SourceVoitures, ils
//     peuvent changer côté Renault) : hors bornes ou pas sur la grille min + k x pas : 400. Bornes inconnues : 503.
//   - Quota de l'API Renault : 60 requêtes par heure et par compte, et HA en prend déjà presque tout pour ses relevés
//     (intervalle calculé sur ce quota). Deux limites, 429 trop_tot au-delà de l'une ou de l'autre :
//     1. écart par rôle (contre la rafale d'un même bouton) : une même commande d'une même voiture au plus toutes les
//        30 s, un même réglage au plus toutes les 10 s ; à lui seul, il laisserait passer 20 appels par minute ;
//     2. BUDGET HORAIRE, la vraie protection du quota : 10 commandes au plus sur une heure glissante, tous rôles et
//        TOUTES voitures confondus (le quota est par compte, et le cadre ne sait pas quelles voitures partagent un
//        compte My Renault). Au-delà, les relevés de HA échoueraient : capteurs unavailable, plus d'alerte du soir.
//     Ce n'est PAS une protection contre les enfants (choix de Thomas : aucune). Compté à l'acceptation (après les
//     contrôles, avant l'envoi), même si HA échoue ensuite : un appel raté a pu partir vers Renault. Un refus ne
//     consomme rien (ni le créneau du rôle, ni le budget). Horloge monotone : un réglage de l'heure du serveur n'ouvre
//     ni ne bloque rien.
//   - Nom cherché par Object.hasOwn : « constructor » ou « __proto__ » ne sont pas des actions de la voiture.

import Ajv2020 from 'ajv/dist/2020.js';
import { ErreurAction, verifierActions } from './actions.js';
import { ecrituresVoitures, ROLES_COMMANDES, ROLES_NIVEAUX } from './voitures.js';

export const ECART_COMMANDE_MS = 30_000;
export const ECART_REGLAGE_MS = 10_000;
export const BUDGET_HORAIRE = 10;
const HEURE_MS = 3_600_000;
const MINUTE_MS = 60_000;
const NOM_VOITURE = { type: 'string', minLength: 1, maxLength: 20 };
const objet = (proprietes) => ({
  type: 'object', additionalProperties: false, required: Object.keys(proprietes), properties: proprietes,
});

export const ACTIONS_VOITURE = Object.freeze({
  voiture_commande: {
    schema: objet({ voiture: NOM_VOITURE, commande: { enum: ROLES_COMMANDES } }),
    attendu: `{ "voiture": nom de VOITURES, "commande": ${ROLES_COMMANDES.join(', ')} }`,
  },
  voiture_niveau: {
    schema: objet({
      voiture: NOM_VOITURE, reglage: { enum: ROLES_NIVEAUX }, valeur: { type: 'integer', minimum: 0, maximum: 100 },
    }),
    attendu: `{ "voiture": nom de VOITURES, "reglage": ${ROLES_NIVEAUX.join(', ')}, "valeur": entier de 0 à 100 }`,
  },
});

const ajv = new Ajv2020();
const VALIDATEURS = Object.fromEntries(Object.entries(ACTIONS_VOITURE).map(([nom, { schema }]) => [nom, ajv.compile(schema)]));
const connue = (nom) => typeof nom === 'string' && Object.hasOwn(ACTIONS_VOITURE, nom);
const surLaGrille = (valeur, { min, pas }) => {
  const rang = (valeur - min) / pas;
  return Math.abs(rang - Math.round(rang)) < 1e-9;
};

// Remplace chaque entity_id de VOITURES par « voiture · rôle » (le plus long d'abord : sensor.x_b2 avant sensor.x_b).
function masqueur(voitures) {
  const remplacements = voitures
    .flatMap(({ nom, entites }) => Object.entries(entites).map(([role, entityId]) => [entityId, `${nom} · ${role}`]))
    .sort(([a], [b]) => b.length - a.length);
  return (texte) => remplacements.reduce((resultat, [id, libelle]) => resultat.replaceAll(id, libelle), String(texte));
}

// La table au format de verifierActions (actions.js), chaque entrée nommée « voiture · rôle ».
function tableVerifiable(ecritures) {
  return Object.fromEntries(ecritures.map(({ nom, role, service, entityId }) => {
    const [domaine, action] = service.split('.');
    return [`${nom} · ${role}`, { domaine, service: action, entity_id: entityId }];
  }));
}

function verifierNiveau(projection, libelle, valeur) {
  const niveau = projection ? projection.niveaux[libelle.role] : null;
  if (!niveau) {
    throw new ErreurAction(503, 'bornes_inconnues', `${libelle.texte} : réglage pas encore lu dans Home Assistant`);
  }
  if (valeur < niveau.min || valeur > niveau.max || !surLaGrille(valeur, niveau)) {
    const bornes = `de ${niveau.min} à ${niveau.max}, par pas de ${niveau.pas}`;
    throw new ErreurAction(400, 'corps_invalide', `corps invalide pour voiture_niveau : ${libelle.texte} ${bornes}`);
  }
}

export function creerActionsVoiture({
  connexion, voitures, source, reelles, journal, monotone = () => performance.now(),
}) {
  const ecritures = ecrituresVoitures(voitures);
  verifierActions(tableVerifiable(ecritures), { voiture: ecritures.map((ecriture) => ecriture.entityId) });
  const cibles = new Map(ecritures.map((ecriture) => [`${ecriture.nom}|${ecriture.role}`, ecriture]));
  const masquer = masqueur(voitures);
  const derniers = new Map();
  const acceptees = [];

  function cible(nom, corps) {
    if (!voitures.some((voiture) => voiture.nom === corps.voiture)) {
      throw new ErreurAction(404, 'voiture_inconnue', `voiture inconnue : ${corps.voiture}`);
    }
    const role = nom === 'voiture_commande' ? corps.commande : corps.reglage;
    const ecriture = cibles.get(`${corps.voiture}|${role}`);
    if (!ecriture) throw new ErreurAction(404, 'commande_absente', `${corps.voiture} · ${role} : pas dans VOITURES`);
    return ecriture;
  }

  // Écart par rôle puis budget horaire (acceptees : instants d'acceptation de la dernière heure, toutes voitures) ;
  // rien n'est retenu si l'un des deux refuse.
  function retenir(ecriture, texte) {
    const ecart = ROLES_NIVEAUX.includes(ecriture.role) ? ECART_REGLAGE_MS : ECART_COMMANDE_MS;
    const cle = `${ecriture.nom}|${ecriture.role}`;
    const maintenant = monotone();
    const reste = derniers.has(cle) ? derniers.get(cle) + ecart - maintenant : 0;
    if (reste > 0) {
      const quota = `${texte} au plus toutes les ${ecart / 1000} s (quota de l'API Renault)`;
      throw new ErreurAction(429, 'trop_tot', `trop tôt : ${quota}, réessayer dans ${Math.ceil(reste / 1000)} s`);
    }
    while (acceptees.length > 0 && acceptees[0] + HEURE_MS <= maintenant) acceptees.shift();
    if (acceptees.length >= BUDGET_HORAIRE) {
      const minutes = Math.ceil((acceptees[0] + HEURE_MS - maintenant) / MINUTE_MS);
      const quota = `${BUDGET_HORAIRE} commandes par heure au plus pour les voitures (quota de l'API Renault)`;
      throw new ErreurAction(429, 'trop_tot', `trop tôt : ${quota}, réessayer dans ${minutes} min`);
    }
    derniers.set(cle, maintenant);
    acceptees.push(maintenant);
  }

  async function executer(nom, corps) {
    if (!connue(nom)) throw new ErreurAction(404, 'action_inconnue', `action inconnue : ${nom}`);
    if (!VALIDATEURS[nom](corps)) {
      throw new ErreurAction(400, 'corps_invalide', `corps invalide pour ${nom}, attendu : ${ACTIONS_VOITURE[nom].attendu}`);
    }
    const ecriture = cible(nom, corps);
    const texte = `${ecriture.nom} · ${ecriture.role}`;
    const projection = source.valeur.find((voiture) => voiture.nom === ecriture.nom);
    if (nom === 'voiture_niveau') verifierNiveau(projection, { role: ecriture.role, texte }, corps.valeur);
    else if (!projection || !projection.commandes.includes(ecriture.role)) {
      throw new ErreurAction(503, 'commande_indisponible', `${texte} : indisponible dans Home Assistant`);
    }
    retenir(ecriture, texte);
    const donnees = nom === 'voiture_niveau' ? { value: corps.valeur } : {};
    const detail = nom === 'voiture_niveau' ? ` ${corps.valeur}` : '';

    if (!reelles) {
      journal.info(`simulation : ${nom} (${texte}, ${ecriture.service}${detail}), rien n'est envoyé à la voiture`);
      return { ok: true, simulation: true };
    }
    try {
      await connexion.ecrireVoiture(ecriture.service, ecriture.entityId, donnees);
    } catch (err) {
      journal.error(`${nom} : ${texte}, échec de ${ecriture.service} (${masquer(err.message)})`);
      const message = `${texte} : Home Assistant n'a pas pris la commande (détail au journal du serveur)`;
      throw new ErreurAction(502, 'action_echouee', message);
    }
    journal.info(`${nom} : ${texte} (${ecriture.service}${detail})`);
    return { ok: true, simulation: false };
  }

  return { executer, connait: connue, simulation: !reelles };
}
