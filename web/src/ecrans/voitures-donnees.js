// web/src/ecrans/voitures-donnees.js
//
// Rôle    : les voitures (choix de Thomas du 14/10 : une Renault Mégane électrique), sans DOM (testé) : une carte par
//           voiture pour l'écran Voitures (pourcentage, jauge, autonomie, icône d'état, grisée si la donnée est vieille ;
//           commandes et niveaux de charge disponibles), les règles des commandes (réglage pas à pas, message d'une ligne)
//           et l'alerte du soir de la page Aujourd'hui (batterie à 25 % ou moins à partir de 18 h, voiture pas branchée).
// Entrées : voitures du flux (serveur/ha/voitures.js : null avant le premier instantané, [] sans voiture configurée,
//           sinon [{ nom, batterie, autonomie: { valeur, unite } | null, branchee, charge, vu_le, fin_charge, commandes,
//           niveaux: { charge_min, charge_cible } }]) ; simulation_voiture du flux ; ms, l'heure corrigée par le serveur ;
//           pour les réglages, une horloge monotone en ms (performance.now).
// Sorties : vueVoitures(voitures, ms, simulation) -> { etat (attente, vide ou ok), essai (vrai : bandeau « Mode essai »),
//           cartes: [{ nom, pourcentage (« 72 » ou « ? »), unite (« % », null si inconnu), niveau (0 à 1), bas, autonomie,
//           etat (en-charge, programmee, erreur, branchee, debranchee, inconnu), icone, libelle, detail, perimee,
//           commandes (clés de COMMANDES disponibles, dans cet ordre), niveaux ({ charge_min, charge_cible } : { valeur,
//           min, max, pas } ou null), pilotable }] } ; alertesVoitures(voitures, ms) -> [{ icone, titre, valeur }] ;
//           creerReglage({ ecartMs }) -> { affichee(niveau, ms), enCours(), appuyer(sens, niveau, ms), echue(niveau, ms), recu(valeur,
//           reponse, ms) } ; messageVoiture(reponse, nom) ; COMMANDES, REGLAGES ; SEUIL_ALERTE (25), HEURE_ALERTE (18),
//           CARTES_MAX (2, comme VOITURES_MAX du serveur), CLES_ETAT (les états possibles, classes de l'écran),
//           ATTENTE_REGLAGE_MS (1,5 s), ECART_REGLAGE_MS (10 s, comme le serveur, mais compté depuis la réponse ; écart
//           par défaut de creerReglage, que l'écran Clims ramène à celui de son serveur, 2 s).
// Pièges  :
//   - Le nom vient de VOITURES (serveur), jamais du friendly_name de HA, qui contient la plaque.
//   - État de la carte, dans cet ordre : erreur de charge, en charge, charge programmée, puis branchée ou débranchée
//     (capteur de la prise) ; rien de connu : « État inconnu », sans icône.
//   - « prête vers 6 h 40 » seulement pendant une charge, si l'heure de fin est connue et pas encore passée.
//   - Donnée de plus de 6 h (heure de la dernière activité de la batterie, vu_le) : carte grisée et « vu il y a 9 h » à
//     la place du détail (au-delà de 48 h, en jours). Sans vu_le, la carte n'est jamais grisée : on ne sait pas.
//   - Alerte : à partir de 18 h (heure de Paris) jusqu'à minuit, batterie à 25 % ou moins (« alerte à 25 % », choix de
//     Thomas : 25 % pile compte) et prise débranchée (branchee faux). Batterie ou prise inconnue : pas d'alerte (jamais de fausse alerte).
//     Une donnée vieille donne quand même l'alerte : une voiture garée débranchée ne renvoie plus rien, et c'est
//     justement le cas à signaler. Pas sur l'Accueil (choix de Thomas) : page Aujourd'hui et compteur de son encart.
//   - Pourcentage inconnu (capteur indisponible, intégration en panne) : « ? », jauge vide.
//   - Commandes (décision de Thomas du 14/10 : toutes, un simple appui, aucune protection contre les enfants) :
//     seulement celles que le flux donne (configurées dans VOITURES et disponibles dans HA). Un serveur plus ancien,
//     sans commandes ni niveaux : rien à piloter, la carte reste comme avant. Un niveau aux bornes incohérentes : null.
//   - Réglage pas à pas (creerReglage, un par réglage de chaque voiture) : chaque appui part de la valeur affichée,
//     ajoute ou retire un pas, reste dans les bornes et sur la grille min + k x pas ; la valeur part une fois le doigt
//     au repos depuis 1,5 s (ATTENTE_REGLAGE_MS) ; revenue à la valeur actuelle, elle ne part pas. Pendant l'envoi
//     (number.set_value attend l'API Renault, souvent plusieurs secondes), la valeur partie reste affichée (en vol) et
//     rien d'autre ne part. Envoyée pour de vrai, elle reste affichée (attendue) jusqu'à ce que le flux la rapporte, au
//     plus 2 min ; en mode essai ou après un refus, l'affichage revient tout de suite à la valeur du flux.
//   - Écart entre deux envois d'un même réglage : 10 s comptées depuis la RÉPONSE au précédent, pas depuis son départ.
//     Le serveur compte ses 10 s à la réception (anti-rafale du quota Renault) : compté au départ, un premier envoi
//     plus lent à arriver que le second (Wi-Fi du cadre qui décroche) faisait refuser le second en 429 et perdre la
//     valeur choisie. La réponse arrive toujours après la réception du serveur, donc 10 s après elle suffisent, quelle
//     que soit la latence (poster rend toujours la main, au plus 10 s après le départ).
//   - messageVoiture : une ligne courte pour la famille (« Envoyé », « Mode essai : rien n'est envoyé », « Trop tôt,
//     réessayer dans un moment », « La Mégane ne répond pas »), jamais le nom d'un service HA. « La » devant le nom :
//     c'est un modèle de voiture (la Mégane, la Zoé).

import { ESP } from '../format.js';
import { partiesParis, texteHeureLongue } from '../heure.js';

export const SEUIL_ALERTE = 25;
export const HEURE_ALERTE = 18;
export const CARTES_MAX = 2;
export const ATTENTE_REGLAGE_MS = 1500;
export const ECART_REGLAGE_MS = 10000;
export const COMMANDES = [
  { cle: 'charger', libelle: 'Charger' },
  { cle: 'clim', libelle: 'Clim' },
  { cle: 'phares', libelle: 'Phares' },
  { cle: 'klaxon', libelle: 'Klaxon' },
];
export const REGLAGES = [
  { cle: 'charge_min', libelle: 'Charge mini' },
  { cle: 'charge_cible', libelle: 'Charge cible' },
];
const GARDE_ATTENDUE_MS = 120000;
const MESSAGE_ESSAI = 'Mode essai : rien n\'est envoyé';
const PERIME_MS = 6 * 3600000;
const HEURE_MS = 3600000;
const JOUR_MS = 86400000;
const JOURS_A_PARTIR_DE_H = 48;
const ETATS = {
  erreur: { icone: 'i-alert', libelle: 'Erreur de charge' },
  'en-charge': { icone: 'i-eclair', libelle: 'En charge' },
  programmee: { icone: 'i-moon', libelle: 'Charge programmée' },
  branchee: { icone: 'i-prise', libelle: 'Branchée' },
  debranchee: { icone: 'i-debranchee', libelle: 'Débranchée' },
  inconnu: { icone: null, libelle: 'État inconnu' },
};
export const CLES_ETAT = Object.keys(ETATS);

function cleEtat(voiture) {
  if (voiture.charge === 'charge_error') return 'erreur';
  if (voiture.charge === 'charge_in_progress') return 'en-charge';
  if (voiture.charge === 'waiting_for_a_planned_charge') return 'programmee';
  if (voiture.branchee === true) return 'branchee';
  if (voiture.branchee === false) return 'debranchee';
  return 'inconnu';
}

const instant = (texte) => (typeof texte === 'string' ? Date.parse(texte) : NaN);
const fini = (valeur) => typeof valeur === 'number' && isFinite(valeur);

function niveauValide(niveau) {
  if (!niveau || ![niveau.valeur, niveau.min, niveau.max, niveau.pas].every(fini)) return null;
  if (niveau.min >= niveau.max || niveau.pas <= 0) return null;
  return { valeur: niveau.valeur, min: niveau.min, max: niveau.max, pas: niveau.pas };
}

function pilotage(voiture) {
  const disponibles = Array.isArray(voiture.commandes) ? voiture.commandes : [];
  const niveaux = {};
  REGLAGES.forEach(({ cle }) => { niveaux[cle] = niveauValide(voiture.niveaux && voiture.niveaux[cle]); });
  const commandes = COMMANDES.map(({ cle }) => cle).filter((cle) => disponibles.indexOf(cle) !== -1);
  return { commandes, niveaux, pilotable: commandes.length > 0 || REGLAGES.some(({ cle }) => niveaux[cle] !== null) };
}

function texteVu(vuLe, ms) {
  const age = ms - instant(vuLe);
  if (!(age > PERIME_MS)) return null;
  const heures = Math.floor(age / HEURE_MS);
  if (heures < JOURS_A_PARTIR_DE_H) return `vu il y a ${heures}${ESP}h`;
  return `vu il y a ${Math.floor(age / JOUR_MS)}${ESP}jours`;
}

function carte(voiture, ms) {
  const cle = cleEtat(voiture);
  const vu = texteVu(voiture.vu_le, ms);
  const fin = instant(voiture.fin_charge);
  let detail = vu;
  if (vu === null && cle === 'en-charge' && fin > ms) detail = `prête vers ${texteHeureLongue(fin)}`;
  const connue = voiture.batterie !== null;
  return {
    nom: voiture.nom,
    pourcentage: connue ? String(voiture.batterie) : '?',
    unite: connue ? '%' : null,
    niveau: connue ? voiture.batterie / 100 : 0,
    bas: connue && voiture.batterie <= SEUIL_ALERTE,
    autonomie: voiture.autonomie ? `${voiture.autonomie.valeur}${ESP}${voiture.autonomie.unite}` : null,
    etat: cle,
    icone: ETATS[cle].icone,
    libelle: ETATS[cle].libelle,
    detail,
    perimee: vu !== null,
    ...pilotage(voiture),
  };
}

export function vueVoitures(voitures, ms, simulation) {
  if (!voitures) return { etat: 'attente', essai: false, cartes: [] };
  if (voitures.length === 0) return { etat: 'vide', essai: false, cartes: [] };
  const cartes = voitures.slice(0, CARTES_MAX).map((voiture) => carte(voiture, ms));
  return { etat: 'ok', essai: simulation === true && cartes.some((c) => c.pilotable), cartes };
}

// Valeur dans les bornes, sur la grille min + k x pas.
function borner(valeur, { min, max, pas }) {
  const surGrille = min + Math.round((valeur - min) / pas) * pas;
  return Math.min(max, Math.max(min, surGrille));
}

export function creerReglage({ ecartMs = ECART_REGLAGE_MS } = {}) {
  let brouillon = null;
  let enVol = null;
  let dernierAppui = 0;
  let derniereReponse = -Infinity;
  let attendue = null;

  // Valeur de référence : celle envoyée pour de vrai tant que le flux ne l'a pas rapportée (2 min au plus), sinon le flux.
  function base(niveau, ms) {
    if (attendue && (niveau.valeur === attendue.valeur || ms - attendue.depuis >= GARDE_ATTENDUE_MS)) attendue = null;
    return attendue ? attendue.valeur : niveau.valeur;
  }

  // Valeur affichée : celle en cours de choix, sinon celle en route vers le serveur, sinon la référence.
  function affichee(niveau, ms) {
    if (brouillon !== null) return brouillon;
    return enVol !== null ? enVol : base(niveau, ms);
  }

  return {
    affichee,
    enCours: () => brouillon !== null,
    appuyer(sens, niveau, ms) {
      brouillon = borner(affichee(niveau, ms) + sens * niveau.pas, niveau);
      dernierAppui = ms;
      return brouillon;
    },
    echue(niveau, ms) {
      if (brouillon === null) return null;
      if (!niveau) {
        brouillon = null;
        return null;
      }
      const auRepos = ms - dernierAppui >= ATTENTE_REGLAGE_MS;
      if (enVol !== null || !auRepos || ms - derniereReponse < ecartMs) return null;
      const valeur = borner(brouillon, niveau);
      brouillon = null;
      if (valeur === base(niveau, ms)) return null;
      enVol = valeur;
      return valeur;
    },
    recu(valeur, reponse, ms) {
      const reelle = reponse.ok && !(reponse.donnees && reponse.donnees.simulation === true);
      enVol = null;
      derniereReponse = ms;
      attendue = reelle ? { valeur, depuis: ms } : null;
    },
  };
}

export function messageVoiture(reponse, nom) {
  if (reponse.ok) return reponse.donnees && reponse.donnees.simulation === true ? MESSAGE_ESSAI : 'Envoyé';
  if (reponse.statut === 429) return 'Trop tôt, réessayer dans un moment';
  if (reponse.statut === 0) return 'Pas de réponse du serveur du cadre';
  if (reponse.statut === 502 || reponse.statut === 503) return `La ${nom} ne répond pas`;
  return 'Commande refusée par le serveur';
}

export function alertesVoitures(voitures, ms) {
  if (!voitures || partiesParis(ms).heure < HEURE_ALERTE) return [];
  return voitures
    .filter((voiture) => voiture.batterie !== null && voiture.batterie <= SEUIL_ALERTE && voiture.branchee === false)
    .map((voiture) => ({ icone: 'i-voiture', titre: voiture.nom, valeur: `${voiture.batterie}${ESP}% · à brancher` }));
}
