// web/src/ecrans/maison-donnees.js
//
// Rôle    : calculer, sans DOM, ce que montrent l'écran Maison et le gros bouton Alarme de l'Accueil : l'état de
//           l'alarme en français (lecture seule), les 9 ouvertures (ouvertes en tête, depuis quand, pile faible), les
//           télécommandes (état de l'Apple TV et de la télé, applis), la sonnette (dernier coup), l'entretien (encres,
//           piles faibles).
// Entrées : entites (etat.js : la projection du serveur, serveur/ha/entites.js) ; ms, l'heure corrigée par le serveur ;
//           pour la sonnette, la clé sonnette du flux (serveur/ha/sonnette.js : { dernier_coup, photo, photo_le }).
// Sorties : OUVERTURES ; PILES (les 12 piles suivies, nommées pour la famille) ; etatAlarme(entite, ms) -> { libelle,
//           ton, depuis } ou null ; vueOuvertures(entites, ms) -> { lignes: [{ nom, etat, libelle, depuis, pileFaible }],
//           ouvertes, indisponibles, resume, detail, resumeCourt } ; texteDepuis(iso, ms) ; texteQuand(iso, ms) ;
//           vueTelecommandes(entites) ; vueSonnette(entites, suivi, ms) -> { dernier, cameraDisponible } ;
//           encres(entites), pilesFaibles(entites), vueEntretien(entites) (encres et piles servent aussi aux alertes de
//           la page Aujourd'hui, aujourdhui-donnees.js) ; decouperMotDePasse(texte) -> [{ texte, chiffres }] (Wi-Fi
//           invités : les chiffres à part, pour les distinguer des lettres).
// Pièges  :
//   - Alarme en LECTURE SEULE (décision de Thomas du 13/10) : rien ici ne prépare une action ; ton vaut « alerte »
//     (déclenchée), « arme » (Maison, Nuit, Absent...), « desarme » ou « neutre » (indisponible, inconnu).
//   - Les 9 ouvertures portent des noms féminins (porte, baie vitrée, fenêtre, porte-fenêtre) : « Ouverte »,
//     « Fermée », « ouverte depuis 14 h 32 », « fermée depuis hier ». Les noms sont écrits ici (ceux de HA finissent
//     par « Sensor open ») ; l'ordre de la table est celui de l'inventaire.
//   - Tri : ouvertes d'abord, puis indisponibles, puis fermées, chaque groupe dans l'ordre de la table (des places
//     stables, qu'on retrouve d'un coup d'œil). « Tout est fermé » seulement si AUCUN capteur n'est indisponible :
//     sinon « Aucune ouverture signalée » et le nombre de capteurs indisponibles.
//   - « depuis » vient de last_changed : un redémarrage de HA le remet à l'heure du redémarrage (« fermée depuis »
//     veut alors dire « au moins depuis »). Aujourd'hui : l'heure (« depuis 14 h 32 ») ; hier ; un jour de la semaine
//     jusqu'à 6 jours ; au-delà, la date (« depuis le 3 octobre »).
//   - Pile faible d'une ouverture : binary_sensor.<même nom>_battery_low à on (ces capteurs font partie des 12 piles
//     suivies).
//   - Piles faibles : noms écrits ici avec le type d'appareil (« Capteur porte d'entrée », « Détecteur du garage »),
//     les mêmes que ceux de la vue Alarme ; ceux de HA (« Baie vitrée droit Battery low », « Garage Battery low ») ne
//     disaient pas quoi changer. Les 12 entités sont celles de serveur/ha/entites.js (test qui les relie). Garage et
//     salon : les deux détecteurs de mouvement T8910 ; alarme intérieure : nom donné dans HA, appareil non vérifié.
//   - Dernier coup de sonnette : seulement un passage à on VU par le serveur (dernier_coup du suivi). Sans lui (serveur
//     redémarré depuis), le last_changed de HA peut être un redémarrage du pont Eufy (unavailable vers off) : la page
//     dit alors « dernier changement », pas « dernier coup ».
//   - Encre sous 15 % : alerte (même seuil que les alertes de la page Aujourd'hui) ; unité % exigée, sinon niveau inconnu.

import { ESP } from '../format.js';
import {
  ajouterJours, dateParis, nomJour, texteHeureLongue, texteJourMois,
} from '../heure.js';

export const OUVERTURES = [
  { cle: 'porte_d_entree', nom: 'Porte d\'entrée' },
  { cle: 'baie_vitree_gauche', nom: 'Baie vitrée gauche' },
  { cle: 'baie_vitree_droit', nom: 'Baie vitrée droite' },
  { cle: 'baie_vitree_centrale', nom: 'Baie vitrée centrale' },
  { cle: 'fenetre_salon', nom: 'Fenêtre salon' },
  { cle: 'fenetre_chambre', nom: 'Fenêtre chambre' },
  { cle: 'fenetre_cuisine', nom: 'Fenêtre cuisine' },
  { cle: 'porte_garage', nom: 'Porte du garage' },
  { cle: 'porte_fenetre_bureau', nom: 'Porte-fenêtre bureau' },
];

const ETATS_ALARME = {
  disarmed: ['Désarmée', 'desarme'],
  armed_home: ['Maison', 'arme'],
  armed_night: ['Nuit', 'arme'],
  armed_away: ['Absent', 'arme'],
  armed_vacation: ['Vacances', 'arme'],
  armed_custom_bypass: ['Personnalisée', 'arme'],
  arming: ['Armement…', 'arme'],
  pending: ['En attente', 'alerte'],
  disarming: ['Désarmement…', 'desarme'],
  triggered: ['Déclenchée', 'alerte'],
  unavailable: ['Indisponible', 'neutre'],
  unknown: ['État inconnu', 'neutre'],
};
const ETATS_MEDIA = {
  off: 'éteinte',
  standby: 'en veille',
  idle: 'allumée',
  on: 'allumée',
  playing: 'lecture en cours',
  paused: 'en pause',
  buffering: 'chargement',
  unavailable: 'injoignable',
  unknown: 'état inconnu',
};
const ORDRE_ETATS = { ouverte: 0, inconnue: 1, fermee: 2 };
const LIBELLES = { ouverte: 'Ouverte', fermee: 'Fermée', inconnue: 'Indisponible' };
const SEUIL_ENCRE = 15;
const ENCRES = [['sensor.hp_deskjet_2800_series_black_ink', 'Encre noire'], ['sensor.hp_deskjet_2800_series_tri_color_ink', 'Encre couleur']];
export const PILES = OUVERTURES.map(({ cle, nom }) => ({ cle, nom: `Capteur ${nom.charAt(0).toLowerCase()}${nom.slice(1)}` })).concat([
  { cle: 'garage', nom: 'Détecteur du garage' },
  { cle: 'salon', nom: 'Détecteur du salon' },
  { cle: 'alarme_interieur', nom: 'Alarme intérieure' },
]);

const pluriel = (n, mot) => `${n}${ESP}${mot}${n > 1 ? 's' : ''}`;

// « depuis 14 h 32 », « depuis hier », « depuis lundi », « depuis le 3 octobre » (null si l'heure est illisible).
export function texteDepuis(iso, ms) {
  const quand = Date.parse(iso);
  if (!isFinite(quand)) return null;
  const jour = dateParis(quand);
  const aujourdhui = dateParis(ms);
  if (jour >= aujourdhui) return `depuis ${texteHeureLongue(quand)}`;
  if (jour === ajouterJours(aujourdhui, -1)) return 'depuis hier';
  if (jour > ajouterJours(aujourdhui, -7)) return `depuis ${nomJour(jour)}`;
  return `depuis le ${texteJourMois(jour)}`;
}

// « aujourd'hui à 11 h 49 », « hier à 11 h 49 », « lundi à 11 h 49 », « le 8 octobre à 11 h 49 ».
export function texteQuand(iso, ms) {
  const quand = Date.parse(iso);
  if (!isFinite(quand)) return null;
  const jour = dateParis(quand);
  const aujourdhui = dateParis(ms);
  const heure = `à ${texteHeureLongue(quand)}`;
  if (jour >= aujourdhui) return `aujourd'hui ${heure}`;
  if (jour === ajouterJours(aujourdhui, -1)) return `hier ${heure}`;
  if (jour > ajouterJours(aujourdhui, -7)) return `${nomJour(jour)} ${heure}`;
  return `le ${texteJourMois(jour)} ${heure}`;
}

export function etatAlarme(entite, ms) {
  if (!entite) return null;
  const [libelle, ton] = ETATS_ALARME[entite.state] || [entite.state, 'neutre'];
  return { libelle, ton, depuis: ton === 'neutre' ? null : texteDepuis(entite.last_changed, ms) };
}

function ligneOuverture({ cle, nom }, entites, ms) {
  const capteur = entites[`binary_sensor.${cle}_sensor_open`];
  const pile = entites[`binary_sensor.${cle}_battery_low`];
  let etat = 'inconnue';
  if (capteur && capteur.state === 'on') etat = 'ouverte';
  else if (capteur && capteur.state === 'off') etat = 'fermee';
  const depuis = capteur ? texteDepuis(capteur.last_changed, ms) : null;
  return {
    nom,
    etat,
    libelle: LIBELLES[etat],
    depuis: depuis === null ? null : `${LIBELLES[etat].toLowerCase()} ${depuis}`,
    pileFaible: Boolean(pile && pile.state === 'on'),
  };
}

export function vueOuvertures(entites, ms) {
  const lignes = OUVERTURES.map((ouverture) => ligneOuverture(ouverture, entites, ms))
    .map((ligne, rang) => ({ ligne, rang }))
    .sort((a, b) => (ORDRE_ETATS[a.ligne.etat] - ORDRE_ETATS[b.ligne.etat]) || (a.rang - b.rang))
    .map(({ ligne }) => ligne);
  const ouvertes = lignes.filter((ligne) => ligne.etat === 'ouverte').length;
  const indisponibles = lignes.filter((ligne) => ligne.etat === 'inconnue').length;
  const aucunCapteur = indisponibles === lignes.length;
  let resume = 'Tout est fermé';
  let resumeCourt = 'tout fermé';
  if (ouvertes > 0) {
    resume = pluriel(ouvertes, 'ouverture');
    resumeCourt = resume;
  } else if (aucunCapteur) {
    resume = 'Capteurs indisponibles';
    resumeCourt = 'capteurs indisponibles';
  } else if (indisponibles > 0) {
    resume = 'Aucune ouverture signalée';
    resumeCourt = 'à vérifier';
  }
  return {
    lignes,
    ouvertes,
    indisponibles,
    resume,
    detail: indisponibles > 0 && !aucunCapteur ? `${pluriel(indisponibles, 'capteur')} indisponible${indisponibles > 1 ? 's' : ''}` : null,
    resumeCourt,
  };
}

const etatMedia = (entite) => (entite ? ETATS_MEDIA[entite.state] || entite.state : 'inconnue de la maison');
const joignable = (entite) => Boolean(entite) && entite.state !== 'unavailable';

export function vueTelecommandes(entites) {
  const appleTv = entites['media_player.sejour_sejour'];
  const applis = appleTv && Array.isArray(appleTv.attributes.source_list) ? appleTv.attributes.source_list : [];
  return {
    appletv: { etat: `Apple TV${ESP}: ${etatMedia(appleTv)}`, joignable: joignable(entites['remote.sejour_sejour']), applis },
    tele: { etat: `Télé${ESP}: ${etatMedia(entites['media_player.smart_tv_pro_2_2'])}`, joignable: joignable(entites['remote.smart_tv_pro_2']) },
  };
}

function texteDernierCoup(sonnerie, suivi, ms) {
  const coup = suivi && suivi.dernier_coup ? texteQuand(suivi.dernier_coup, ms) : null;
  if (coup !== null) return `Dernier coup de sonnette${ESP}: ${coup}`;
  const changement = sonnerie ? texteQuand(sonnerie.last_changed, ms) : null;
  return changement === null ? 'Aucun coup de sonnette connu' : `Sonnette, dernier changement${ESP}: ${changement}`;
}

export function vueSonnette(entites, suivi, ms) {
  const camera = entites['camera.sonnette_derniere_photo'];
  return {
    dernier: texteDernierCoup(entites['binary_sensor.doorbell_ringing'], suivi, ms),
    cameraDisponible: Boolean(camera) && camera.state !== 'unavailable',
  };
}

export function encres(entites) {
  return ENCRES.map(([entityId, nom]) => {
    const encre = entites[entityId];
    const valeur = encre ? Number(encre.state) : NaN;
    const niveau = encre && encre.attributes.unit_of_measurement === '%' && isFinite(valeur) ? valeur : null;
    return {
      nom, niveau, texte: niveau === null ? 'niveau inconnu' : `${niveau}${ESP}%`, alerte: niveau !== null && niveau < SEUIL_ENCRE,
    };
  });
}

const entitePile = (cle) => `binary_sensor.${cle}_battery_low`;

export function pilesFaibles(entites) {
  return PILES.filter(({ cle }) => entites[entitePile(cle)] && entites[entitePile(cle)].state === 'on').map(({ nom }) => nom);
}

export function vueEntretien(entites) {
  return {
    encres: encres(entites),
    piles: pilesFaibles(entites),
    capteurs: PILES.filter(({ cle }) => entites[entitePile(cle)]).length,
  };
}

// « Ab3dE5fG » -> [{ texte: 'Ab', chiffres: false }, { texte: '3', chiffres: true }, ...] : la page écrit les chiffres
// d'une autre couleur (0 et O, 1 et l ne se confondent plus).
export function decouperMotDePasse(texte) {
  return (texte.match(/[0-9]+|[^0-9]+/g) || []).map((morceau) => ({ texte: morceau, chiffres: /^[0-9]/.test(morceau) }));
}
