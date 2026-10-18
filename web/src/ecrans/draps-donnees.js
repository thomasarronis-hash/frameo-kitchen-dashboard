// web/src/ecrans/draps-donnees.js
//
// Rôle    : les draps (demande d'Agathe du 14/10), sans DOM (testé) : pour chaque lit, depuis quand ils sont changés, quand
//           vient le prochain changement (cycle de 15 jours), la jauge du cycle et le ton de la carte (Maison > Entretien) ;
//           et les alertes de la page Aujourd'hui (rappel dès 2 jours avant l'échéance, puis « à changer » le jour J et en
//           retard).
// Entrées : draps du flux ({ timo, pablo, parents } : « AAAA-MM-JJ » du dernier changement, ou null ; null avant le
//           premier instantané) ; ms, l'heure corrigée par le serveur.
// Sorties : LITS [{ id, nom }] dans l'ordre des cartes ; dateDuChangement(quand, ms) (aujourdhui, hier, avant-hier ->
//           « AAAA-MM-JJ », pour l'affichage avant l'envoi) ; vueDraps(draps, ms) -> [{ id, nom, depuis, prochain,
//           progression (0 à 1), ton (inconnu, ok, bientot, alerte) }] ; alertesDraps(draps, ms) -> [{ icone, titre,
//           valeur }], la plus urgente d'abord.
// Pièges  :
//   - Le serveur seul décide de la date enregistrée (heure de Paris) ; la page compte les jours avec l'heure corrigée
//     par le serveur (dateParis), jamais avec l'horloge brute du cadre.
//   - Cycle de 15 jours et rappel 2 jours avant (choix de Thomas : rappel au 13e jour) ; le jour J et après :
//     « à changer ». Un lit jamais noté n'a ni rappel ni alerte (pas de fausse alerte au premier démarrage) : la
//     carte dit « pas encore noté ».
//   - Une date du serveur en avance sur la page (horloge pas encore réglée) compte pour aujourd'hui, jamais pour
//     « dans -1 jour ».
//   - Pas de pavé : une ligne courte chacun (« changés il y a 3 jours », « prochain dans 12 jours ») ; l'alerte d'un retard
//     dit « draps, 3 jours de retard » (la case des alertes, au quart de la largeur, coupait une phrase plus longue).
//   - Alertes rangées par urgence (le plus de retard d'abord, puis à changer, puis le rappel le plus proche), à ordre égal
//     dans l'ordre des cartes : la page Aujourd'hui n'en montre que 3 avant « + N autres », et un simple rappel à J-2 ne
//     doit pas cacher des draps en retard (relecture du 14/10).

import { ESP } from '../format.js';
import { ajouterJours, dateParis, ecartJours } from '../heure.js';

export const LITS = [
  { id: 'timo', nom: 'Lit de Timo' },
  { id: 'pablo', nom: 'Lit de Pablo' },
  { id: 'parents', nom: 'Notre chambre' },
];
const CYCLE_JOURS = 15;
const RAPPEL_JOURS = 2;
const RECUL = { aujourdhui: 0, hier: 1, 'avant-hier': 2 };

const jours = (n) => `${n}${ESP}jour${n > 1 ? 's' : ''}`;

export function dateDuChangement(quand, ms) {
  return ajouterJours(dateParis(ms), -RECUL[quand]);
}

function etatLit(change, aujourdhui) {
  if (!change) return { etat: 'inconnu', depuisJours: null, restant: null };
  const depuisJours = Math.max(0, ecartJours(change, aujourdhui));
  const restant = CYCLE_JOURS - depuisJours;
  let etat = 'ok';
  if (restant < 0) etat = 'retard';
  else if (restant === 0) etat = 'a-changer';
  else if (restant <= RAPPEL_JOURS) etat = 'bientot';
  return { etat, depuisJours, restant };
}

function texteDepuis({ etat, depuisJours }) {
  if (etat === 'inconnu') return 'pas encore noté';
  if (depuisJours === 0) return 'changés aujourd\'hui';
  if (depuisJours === 1) return 'changés hier';
  return `changés il y a ${jours(depuisJours)}`;
}

function texteProchain({ etat, restant }) {
  if (etat === 'inconnu') return 'à noter le jour du changement';
  if (etat === 'a-changer') return 'à changer';
  if (etat === 'retard') return `à changer, ${jours(-restant)} de retard`;
  return restant === 1 ? 'prochain demain' : `prochain dans ${jours(restant)}`;
}

const TONS = {
  inconnu: 'inconnu', ok: 'ok', bientot: 'bientot', 'a-changer': 'alerte', retard: 'alerte',
};

export function vueDraps(draps, ms) {
  const aujourdhui = dateParis(ms);
  return LITS.map((lit) => {
    const etat = etatLit(draps ? draps[lit.id] : null, aujourdhui);
    return {
      id: lit.id,
      nom: lit.nom,
      depuis: texteDepuis(etat),
      prochain: texteProchain(etat),
      progression: etat.etat === 'inconnu' ? 0 : Math.min(1, etat.depuisJours / CYCLE_JOURS),
      ton: TONS[etat.etat],
    };
  });
}

export function alertesDraps(draps, ms) {
  const aujourdhui = dateParis(ms);
  const alertes = [];
  LITS.forEach((lit, rang) => {
    const etat = etatLit(draps ? draps[lit.id] : null, aujourdhui);
    let valeur = null;
    if (etat.etat === 'bientot') valeur = etat.restant === 1 ? 'draps demain' : `draps dans ${jours(etat.restant)}`;
    else if (etat.etat === 'a-changer') valeur = 'draps à changer';
    else if (etat.etat === 'retard') valeur = `draps, ${jours(-etat.restant)} de retard`;
    if (valeur) {
      alertes.push({
        alerte: { icone: 'i-lit', titre: lit.nom, valeur }, restant: etat.restant, rang,
      });
    }
  });
  return alertes.sort((a, b) => (a.restant - b.restant) || (a.rang - b.rang)).map((entree) => entree.alerte);
}
