// web/src/format.js
//
// Rôle    : mise en forme partagée par les vues calculées et les écrans (Accueil, Aujourd'hui, Météo, Agenda) : espace
//           insécable, décimales à la française, températures, valeur suivie de son unité, majuscule initiale,
//           « + N autres ».
// Entrées : nombres et unités tels que les donne le flux (attributs de HA, unités d'Open-Meteo) ; textes.
// Sorties : ESP (espace insécable) ; estNombre(v) ; nombreFr(v) « 2,4 » (une décimale au plus) ;
//           temperature(v, unite) « 14° », « -3° », « 57 °F » ou null ; avecUnite(v, unite) « 2,4 mm » ou null ;
//           majuscule(texte) « Mercredi 14 octobre » ; texteAutres(n) « + 1 autre », « + 3 autres ».
// Pièges  :
//   - Aucune unité n'est écrite ici en dur : elle vient toujours des données. Seul « °C » est abrégé en « ° »
//     (le cadre est réglé en °C, toute autre unité reste écrite en entier).
//   - Espace insécable devant « : », « % » et toute unité autre que °C : pas de retour à la ligne au milieu
//     d'une valeur.
//   - Températures négatives avec le trait d'union « - » et non le signe moins U+2212 : dans Fraunces en grand
//     corps, U+2212 est un filet très fin, invisible à 2 m (constaté sur capture), et « -3° » se lirait « 3° ».
//   - Module sans DOM : importé tel quel par les tests sous Node.

export const ESP = '\u00a0';
const MOINS = '-';

export const estNombre = (valeur) => typeof valeur === 'number' && isFinite(valeur);

export const nombreFr = (valeur) => String(Math.round(valeur * 10) / 10).replace('.', ',');

export function temperature(valeur, unite) {
  if (!estNombre(valeur)) return null;
  const arrondi = Math.round(valeur);
  const texte = arrondi < 0 ? MOINS + Math.abs(arrondi) : String(arrondi);
  return unite === '°C' ? `${texte}°` : `${texte}${ESP}${unite || ''}`;
}

export function avecUnite(valeur, unite) {
  if (!estNombre(valeur)) return null;
  return unite ? `${nombreFr(valeur)}${ESP}${unite}` : nombreFr(valeur);
}

export const majuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);

export const texteAutres = (n) => (n === 1 ? '+ 1 autre' : `+ ${n} autres`);
