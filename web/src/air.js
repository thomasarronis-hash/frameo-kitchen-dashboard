// web/src/air.js
//
// Rôle    : niveaux lisibles de la qualité de l'air (indice européen) et des pollens par taxon, partagés par la
//           carte « Air et pollens » de l'Accueil, le panneau de l'écran Météo et les alertes de la page Aujourd'hui :
//           la même donnée s'écrit partout de la même façon (« Moyen », « Graminées » et « élevé », « Pas de pollen »).
// Entrées : un indice européen (nombre) ; une clé de taxon d'Open-Meteo et sa concentration (grains/m³, maximum
//           du jour calculé par serveur/sources/open-meteo.js) ; le jour de la réponse { alder_pollen, ... }.
// Sorties : niveauAir(indice) -> { libelle, classe, rang } (rang 1 = bon ... 6 = extrêmement mauvais) ;
//           TAXONS, la liste [{ cle, nom, moyen, eleve }] dans l'ordre d'affichage ;
//           niveauPollen(taxon, valeur) -> { rang, libelle } (0 aucun, 1 faible, 2 moyen, 3 élevé) ou null si la
//           valeur est inconnue ;
//           pollensDuJour(jour) -> { lignes: [{ nom: 'Graminées', niveau: 'élevé', rang }], message } : les taxons
//           présents (niveau faible ou plus), du plus fort au plus faible (à niveau égal, la plus forte
//           concentration d'abord) ; message « Pas de pollen » s'il n'y en a aucun, « Pollens : pas de donnée » si
//           aucun taxon n'a de valeur (jour absent compris), sinon null ; PAS_DE_POLLEN, ce premier message.
// Pièges  :
//   - Indice européen (EAQI) : seuils de l'Agence européenne de l'environnement (repris par la doc Open-Meteo),
//     libellés d'Atmo France : < 20 bon, < 40 moyen, < 60 dégradé, < 80 mauvais, < 100 très mauvais, au-delà
//     extrêmement mauvais.
//   - Pollens, seuils de niveau [S] : seuils de travail, AUCUN référentiel n'a été relu pour les poser (pas
//     d'accès réseau hors Open-Meteo pendant ce travail). « Élevé » reprend, de mémoire, l'ordre de grandeur
//     des « high pollen days » de la prise de position EAACI de 2017 (Pfaar et al., Allergy) : 100 grains/m³
//     pour le bouleau, 50 pour les graminées ; les autres taxons sont rangés par analogie (arbres comme le
//     bouleau, herbacées comme les graminées) et l'ambroisie, allergisante à faible dose, passe en « moyen »
//     dès 5. À remplacer par les seuils EAACI ou RNSA transcrits à la main (conception §4).
//   - En dessous de 1 grain/m³ (simple trace, 0,1 de graminées le 11/10), le niveau est « aucun ». On ne dit
//     jamais « Pas de pollen » sans donnée.
//   - Module sans DOM : importé tel quel par les tests sous Node.

import { ESP, majuscule } from './format.js';

const NIVEAUX_AIR = [
  [20, 'Bon'], [40, 'Moyen'], [60, 'Dégradé'], [80, 'Mauvais'], [100, 'Très mauvais'], [Infinity, 'Extrêmement mauvais'],
];
const NIVEAUX_POLLEN = ['aucun', 'faible', 'moyen', 'élevé'];
const POLLEN_NOTABLE = 1;

export const PAS_DE_POLLEN = 'Pas de pollen';

export const TAXONS = [
  { cle: 'alder_pollen', nom: 'aulne', moyen: 10, eleve: 100 },
  { cle: 'birch_pollen', nom: 'bouleau', moyen: 10, eleve: 100 },
  { cle: 'olive_pollen', nom: 'olivier', moyen: 10, eleve: 100 },
  { cle: 'grass_pollen', nom: 'graminées', moyen: 10, eleve: 50 },
  { cle: 'mugwort_pollen', nom: 'armoise', moyen: 10, eleve: 50 },
  { cle: 'ragweed_pollen', nom: 'ambroisie', moyen: 5, eleve: 50 },
];

export function niveauAir(indice) {
  const rang = NIVEAUX_AIR.findIndex((niveau) => indice < niveau[0]) + 1;
  return { libelle: NIVEAUX_AIR[rang - 1][1], classe: `aqi-${rang}`, rang };
}

export function niveauPollen(taxon, valeur) {
  if (typeof valeur !== 'number' || !isFinite(valeur)) return null;
  let rang = 0;
  if (valeur >= taxon.eleve) rang = 3;
  else if (valeur >= taxon.moyen) rang = 2;
  else if (valeur >= POLLEN_NOTABLE) rang = 1;
  return { rang, libelle: NIVEAUX_POLLEN[rang] };
}

export function pollensDuJour(jour) {
  const taxons = TAXONS.map((taxon) => ({
    nom: taxon.nom, valeur: jour ? jour[taxon.cle] : null, niveau: jour ? niveauPollen(taxon, jour[taxon.cle]) : null,
  }));
  const lignes = taxons
    .filter((t) => t.niveau && t.niveau.rang > 0)
    .sort((a, b) => b.niveau.rang - a.niveau.rang || b.valeur - a.valeur)
    .map((t) => ({ nom: majuscule(t.nom), niveau: t.niveau.libelle, rang: t.niveau.rang }));
  let message = null;
  if (lignes.length === 0) message = taxons.some((t) => t.niveau) ? PAS_DE_POLLEN : `Pollens${ESP}: pas de donnée`;
  return { lignes, message };
}
