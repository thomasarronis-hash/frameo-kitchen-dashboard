// web/src/ecrans/meteo-donnees.js
//
// Rôle    : calculer, sans DOM, tout ce que l'écran Météo affiche (conception §1.5, allégé le 14/10 : « ok mais trop
//           verbeux ») : le temps qu'il fait (température en grand, ciel), le bandeau des 48 prochaines heures, la pluie dans
//           l'heure en 4 quarts d'heure, les 7 jours, l'air et les pollens du jour, la ligne des crédits.
// Entrées : donnees (etat.js : entites, meteo, pluie, semaine, air), ms (heure corrigée par le serveur).
// Sorties : vueMeteoEcran(donnees, ms) -> { maintenant, heures, dansLHeure, jours, air, credits } ; chaque morceau
//           aussi, pour les tests :
//           vueMaintenant(entites) -> { temperature: « 16° » ou null, picto, libelle: « Nuageux », vent: « 45 km/h » ou
//             null } ou null ;
//           vueHeures(meteo, entites, ms) -> { etiquettePluie, avecPluie, heures: [{ heure, jour, picto, libelle,
//             temperature, pluie }] } ou null (jour : nom du jour à minuit, et sur la première heure s'il reste au moins
//             3 colonnes avant minuit ; pluie : « 1,3 » ou null ; avecPluie : au moins une heure pluvieuse) ;
//           vueDansLHeure(pluie, ms) -> { total: « 2,9 mm » ou null (heure sèche), pas: [{ heure, part }] } ou null
//             (part de 0 à 1 ; heure : fin du quart d'heure) ;
//           vueJours(semaine, ms) -> [{ nom, aujourdhui, picto, libelle, maxi, mini, pluie, vent }] ou null (pluie et
//             vent : texte avec unité, ou null sous leur seuil) ;
//           vueAirPollens(air, ms) -> { classe, libelle, indice: « indice 29 » (comme l'Accueil : un nombre seul se
//             lisait comme une température), demain: { classe, libelle } ou null, pollens: { lignes: [{ nom, niveau,
//             rang }], message } } ou null ;
//           credits(entites) -> la ligne des crédits.
// Pièges  :
//   - Sources : l'actuel et l'heure par heure viennent de weather.forecast_maison (met.no via HA) ; les 7 jours,
//     la pluie au quart d'heure, l'air et les pollens d'Open-Meteo. Aucune n'est mélangée à une autre.
//   - Unités lues dans les données, jamais écrites en dur : attributs de l'entité météo (temperature_unit,
//     precipitation_unit, wind_speed_unit), unités d'Open-Meteo (daily_units, minutely_15_units). Les seuils sont
//     posés en km/h et en mm, et la valeur est convertie depuis son unité avant d'être comparée (EN_KMH, EN_MM) :
//     une unité inconnue ne passe jamais le seuil (rien n'est affiché plutôt qu'un seuil faux).
//   - Ce qui ne s'affiche que s'il sert (décision du 14/10) :
//     . vent (en tête et sur les 7 jours) : seulement à partir de 40 km/h (vent moyen), le début de la force 6 de
//       Beaufort (39 à 49 km/h, « grosses branches agitées, parapluie difficile à tenir », échelle citée de mémoire
//       [S]) ; en dessous, on ne le remarque pas en sortant ;
//     . pluie d'une heure : seulement si met.no en prévoit (plus de 0), et la rangée de la pluie seulement si une des
//       48 heures en a (avecPluie) ;
//     . pluie d'un jour : seulement au-delà de 0,5 mm (en dessous, quelques gouttes qui ne changent rien à la
//       journée) ;
//     . air de demain : seulement si son niveau (maximum du jour) est pire que celui d'aujourd'hui (maximum du jour,
//       ou l'indice actuel si la réponse n'a pas aujourd'hui) : comparer le maximum de demain à l'indice du moment
//       l'annoncerait « pire » presque chaque jour, un maximum dépassant toujours une valeur de la journée ;
//     . pollens : seulement les taxons présents aujourd'hui (niveau faible ou plus, seuils [S] de air.js), du plus
//       fort au plus faible ; sinon une seule ligne « Pas de pollen », ou « Pollens : pas de donnée » si aucun taxon
//       n'a de valeur (pollensDuJour de air.js, la même règle que l'Accueil) ;
//     . plus de libellé du ciel sur les jours (le pictogramme suffit, le libellé reste son étiquette lue), plus de
//       probabilité de pluie, plus de valeur par quart d'heure (le total suffit).
//   - Heures de HA en UTC avec décalage (« 2026-10-13T16:00:00+00:00 ») : remises à l'heure de Paris par heure.js.
//     Une heure commencée reste affichée jusqu'à sa fin (début d'heure en UTC = début d'heure à Paris, les
//     décalages de Paris étant des heures entières).
//   - Nom du jour de la première heure : « Aujourd'hui » (177 px en capitales de 22 px) déborde sur les colonnes
//     suivantes (84 px chacune) ; à moins de 3 colonnes avant minuit, il chevauchait « Demain » (« AUJOURDDEMAIN »,
//     chaque soir dès 21 h environ) : il n'est alors pas écrit, les heures avant « Demain » sont celles d'aujourd'hui.
//   - Pluie d'une heure sans son unité dans la case : « 1,3 mm » fait 90 px en 26 px gras pour une colonne de 84 px
//     (mesuré dans Chrome). L'unité est dans l'étiquette lue de la goutte (etiquettePluie) et sur les 7 jours.
//   - Pluie dans l'heure : mêmes quarts d'heure que la ligne de l'Accueil (pluieDansLHeure d'accueil-donnees.js :
//     ceux dont l'heure de fin tombe dans les 60 minutes qui viennent, chacun cumulant les 15 minutes qui le
//     précèdent), même cumul ; la hauteur d'une barre est sa part du plus fort des 4, avec un plancher de 1 unité
//     (1 mm en 15 min, pluie franche [S]) pour qu'une bruine ne remplisse pas la barre.
//   - Crédits sur une ligne (obligation des licences) : l'attribution de HA est une phrase anglaise de 82 caractères ;
//     elle devient « met.no » quand elle cite met.no, et reste telle quelle sinon (autre fournisseur dans HA).

import { niveauAir, pollensDuJour } from '../air.js';
import { cielHA, cielWmo } from '../ciel.js';
import {
  avecUnite, ESP, estNombre, nombreFr, temperature,
} from '../format.js';
import {
  ajouterJours, dateParis, heureLocaleParis, jourAbrege, partiesParis,
} from '../heure.js';

const ENTITE_METEO = 'weather.forecast_maison';
const HEURE_MS = 3600000;
const HEURES = 48;
const JOURS = 7;
const PLANCHER_BARRE = 1;
const COLONNES_NOM_JOUR = 3;
const SEUIL_VENT_KMH = 40;
const SEUIL_PLUIE_JOUR_MM = 0.5;
const EN_KMH = {
  'km/h': 1, 'm/s': 3.6, mph: 1.609344, 'mp/h': 1.609344, kn: 1.852,
};
const EN_MM = { mm: 1, in: 25.4, inch: 25.4 };
const OPEN_METEO = 'Open-Meteo.com (CC BY 4.0) · CAMS/Copernicus';

const entier = (valeur) => (estNombre(valeur) ? Math.round(valeur) : null);

// Valeur convertie vers l'unité d'un seuil, ou null (valeur absente, unité inconnue).
function convertie(valeur, unite, facteurs) {
  return estNombre(valeur) && Object.prototype.hasOwnProperty.call(facteurs, unite) ? valeur * facteurs[unite] : null;
}

function ventFort(valeur, unite) {
  const kmh = convertie(valeur, unite, EN_KMH);
  return kmh !== null && kmh >= SEUIL_VENT_KMH ? avecUnite(entier(valeur), unite) : null;
}

function nomDuJour(date, aujourdhui) {
  if (date === aujourdhui) return 'Aujourd\'hui';
  if (date === ajouterJours(aujourdhui, 1)) return 'Demain';
  return `${jourAbrege(date)} ${Number(date.slice(8))}`;
}

export function vueMaintenant(entites) {
  const meteo = entites[ENTITE_METEO];
  if (!meteo) return null;
  const a = meteo.attributes;
  const ciel = cielHA(meteo.state);
  return {
    temperature: temperature(a.temperature, a.temperature_unit),
    picto: ciel.picto,
    libelle: ciel.libelle,
    vent: ventFort(a.wind_speed, a.wind_speed_unit),
  };
}

export function vueHeures(meteo, entites, ms) {
  if (!meteo) return null;
  const entite = entites[ENTITE_METEO];
  const a = entite ? entite.attributes : {};
  const debutHeure = ms - (ms % HEURE_MS);
  const aujourdhui = dateParis(ms);
  const retenues = meteo.horaire.filter((h) => Date.parse(h.datetime) >= debutHeure).slice(0, HEURES);
  const minuit = retenues.findIndex((h, i) => i > 0 && partiesParis(Date.parse(h.datetime)).heure === 0);
  const premierNomme = minuit === -1 || minuit >= COLONNES_NOM_JOUR;
  const heures = retenues.map((h, i) => {
    const instant = Date.parse(h.datetime);
    const parties = partiesParis(instant);
    const ciel = cielHA(h.condition);
    const nomme = (i === 0 && premierNomme) || (i > 0 && parties.heure === 0);
    return {
      heure: `${parties.heure}h`,
      jour: nomme ? nomDuJour(dateParis(instant), aujourdhui) : null,
      picto: ciel.picto,
      libelle: ciel.libelle,
      temperature: temperature(h.temperature, a.temperature_unit),
      pluie: estNombre(h.precipitation) && h.precipitation > 0 ? nombreFr(h.precipitation) : null,
    };
  });
  return {
    etiquettePluie: a.precipitation_unit ? `Pluie en ${a.precipitation_unit}` : 'Pluie',
    avecPluie: heures.some((h) => h.pluie !== null),
    heures,
  };
}

export function vueDansLHeure(pluie, ms) {
  if (!pluie) return null;
  const debut = heureLocaleParis(ms);
  const fin = heureLocaleParis(ms + HEURE_MS);
  const pas = pluie.pas.filter((p) => p.time > debut && p.time <= fin);
  const connues = pas.filter((p) => estNombre(p.precipitation)).map((p) => p.precipitation);
  if (connues.length === 0) return null;
  const cumul = connues.reduce((somme, valeur) => somme + valeur, 0);
  const plafond = Math.max.apply(null, [PLANCHER_BARRE].concat(connues));
  return {
    total: cumul > 0 ? avecUnite(cumul, pluie.unite) : null,
    pas: pas.map((p) => ({
      heure: p.time.slice(11, 16),
      part: estNombre(p.precipitation) ? p.precipitation / plafond : 0,
    })),
  };
}

export function vueJours(semaine, ms) {
  if (!semaine) return null;
  const aujourdhui = dateParis(ms);
  const u = semaine.unites;
  return semaine.jours
    .filter((jour) => jour.date >= aujourdhui)
    .slice(0, JOURS)
    .map((jour) => {
      const ciel = cielWmo(jour.code_ciel);
      const mm = convertie(jour.precipitation_sum, u.precipitation_sum, EN_MM);
      return {
        nom: nomDuJour(jour.date, aujourdhui),
        aujourdhui: jour.date === aujourdhui,
        picto: ciel.picto,
        libelle: ciel.libelle,
        maxi: temperature(jour.temperature_2m_max, u.temperature_2m_max),
        mini: temperature(jour.temperature_2m_min, u.temperature_2m_min),
        pluie: mm !== null && mm > SEUIL_PLUIE_JOUR_MM ? avecUnite(jour.precipitation_sum, u.precipitation_sum) : null,
        vent: ventFort(jour.wind_speed_10m_max, u.wind_speed_10m_max),
      };
    });
}

export function vueAirPollens(air, ms) {
  if (!air) return null;
  const aujourdhui = dateParis(ms);
  const jourDe = (date) => air.jours.filter((jour) => jour.date === date)[0];
  const indice = air.actuel.european_aqi;
  const niveau = estNombre(indice) ? niveauAir(indice) : null;
  const niveauDuJour = (jour) => (jour && estNombre(jour.european_aqi) ? niveauAir(jour.european_aqi) : null);
  const reference = niveauDuJour(jourDe(aujourdhui)) || niveau;
  const niveauDemain = niveauDuJour(jourDe(ajouterJours(aujourdhui, 1)));
  return {
    classe: niveau ? niveau.classe : null,
    libelle: niveau ? niveau.libelle : 'Indice indisponible',
    indice: niveau ? `indice ${Math.round(indice)}` : '',
    demain: niveau && reference && niveauDemain && niveauDemain.rang > reference.rang
      ? { classe: niveauDemain.classe, libelle: niveauDemain.libelle.toLowerCase() }
      : null,
    pollens: pollensDuJour(jourDe(aujourdhui)),
  };
}

export function credits(entites) {
  const meteo = entites[ENTITE_METEO];
  const attribution = meteo ? meteo.attributes.attribution : null;
  const sources = [];
  if (attribution) sources.push(/met\.no/.test(attribution) ? 'met.no' : attribution);
  sources.push(OPEN_METEO);
  return `Sources${ESP}: ${sources.join(' · ')}`;
}

export function vueMeteoEcran(donnees, ms) {
  return {
    maintenant: vueMaintenant(donnees.entites),
    heures: vueHeures(donnees.meteo, donnees.entites, ms),
    dansLHeure: vueDansLHeure(donnees.pluie, ms),
    jours: vueJours(donnees.semaine, ms),
    air: vueAirPollens(donnees.air, ms),
    credits: credits(donnees.entites),
  };
}
