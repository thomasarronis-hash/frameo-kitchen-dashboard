// web/src/ciel.js
//
// Rôle    : traduire l'état du ciel en pictogramme (symbole de web/public/icones.svg) et en libellé
//           français, pour les deux vocabulaires reçus : codes WMO d'Open-Meteo (colonne « La semaine ») et
//           conditions de Home Assistant (météo actuelle de weather.forecast_maison, met.no).
// Entrées : un code WMO (entier ou null), une condition HA (chaîne, ou unavailable / unknown).
// Sorties : cielWmo(code) et cielHA(condition) -> { picto, libelle } ; picto vaut null quand on ne sait
//           pas (donnée absente ou valeur inconnue) : la page n'affiche alors aucun pictogramme plutôt
//           qu'un ciel inventé.
// Pièges  :
//   - Codes WMO de la doc Open-Meteo (table « WMO Weather interpretation codes ») : 0 à 3, 45, 48, 51 à 57,
//     61 à 67, 71 à 77, 80 à 86, 95 à 99. Tout autre code est inconnu.
//   - Conditions HA : la liste fixe de l'intégration weather (clear-night, cloudy, exceptional, fog, hail,
//     lightning, lightning-rainy, partlycloudy, pouring, rainy, snowy, snowy-rainy, sunny, windy,
//     windy-variant). met.no ne distingue pas le jour de la nuit, sauf clear-night.
//   - Module sans DOM : importé tel quel par les tests sous Node.

const SOLEIL = 'i-sun';
const ECLAIRCIES = 'i-partly';
const NUAGE = 'i-cloud';
const BROUILLARD = 'i-fog';
const PLUIE = 'i-rain';
const NEIGE = 'i-snow';
const ORAGE = 'i-storm';
const VENT = 'i-wind';
const LUNE = 'i-moon';

const WMO = {
  0: [SOLEIL, 'Ensoleillé'],
  1: [SOLEIL, 'Peu nuageux'],
  2: [ECLAIRCIES, 'Éclaircies'],
  3: [NUAGE, 'Couvert'],
  45: [BROUILLARD, 'Brouillard'],
  48: [BROUILLARD, 'Brouillard givrant'],
  51: [PLUIE, 'Bruine légère'],
  53: [PLUIE, 'Bruine'],
  55: [PLUIE, 'Bruine dense'],
  56: [PLUIE, 'Bruine verglaçante'],
  57: [PLUIE, 'Bruine verglaçante'],
  61: [PLUIE, 'Pluie faible'],
  63: [PLUIE, 'Pluie'],
  65: [PLUIE, 'Forte pluie'],
  66: [PLUIE, 'Pluie verglaçante'],
  67: [PLUIE, 'Pluie verglaçante'],
  71: [NEIGE, 'Neige faible'],
  73: [NEIGE, 'Neige'],
  75: [NEIGE, 'Forte neige'],
  77: [NEIGE, 'Grains de neige'],
  80: [PLUIE, 'Averses'],
  81: [PLUIE, 'Averses'],
  82: [PLUIE, 'Fortes averses'],
  85: [NEIGE, 'Averses de neige'],
  86: [NEIGE, 'Fortes averses de neige'],
  95: [ORAGE, 'Orage'],
  96: [ORAGE, 'Orage et grêle'],
  99: [ORAGE, 'Orage et grêle'],
};

const HA = {
  'clear-night': [LUNE, 'Nuit claire'],
  cloudy: [NUAGE, 'Nuageux'],
  exceptional: [null, 'Conditions exceptionnelles'],
  fog: [BROUILLARD, 'Brouillard'],
  hail: [NEIGE, 'Grêle'],
  lightning: [ORAGE, 'Orage'],
  'lightning-rainy': [ORAGE, 'Orage et pluie'],
  partlycloudy: [ECLAIRCIES, 'Éclaircies'],
  pouring: [PLUIE, 'Forte pluie'],
  rainy: [PLUIE, 'Pluie'],
  snowy: [NEIGE, 'Neige'],
  'snowy-rainy': [NEIGE, 'Pluie et neige'],
  sunny: [SOLEIL, 'Ensoleillé'],
  windy: [VENT, 'Venteux'],
  'windy-variant': [VENT, 'Venteux et nuageux'],
};

const INCONNU = { picto: null, libelle: '' };

function decrire(entree) {
  return entree ? { picto: entree[0], libelle: entree[1] } : INCONNU;
}

export function cielWmo(code) {
  return Object.prototype.hasOwnProperty.call(WMO, code) ? decrire(WMO[code]) : INCONNU;
}

export function cielHA(condition) {
  if (condition === 'unavailable' || condition === 'unknown') return { picto: null, libelle: 'Météo indisponible' };
  return Object.prototype.hasOwnProperty.call(HA, condition) ? decrire(HA[condition]) : INCONNU;
}
