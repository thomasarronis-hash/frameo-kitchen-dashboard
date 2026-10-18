// tests/meteo-dom.test.js
//
// Rôle    : prouver, sur un faux DOM (tests/faux-dom.js), ce que la vue sans DOM ne couvre pas dans l'écran Météo allégé
//           du 14/10 : en tête la température et le ciel ; ce qui n'a rien à dire est masqué et non écrit à vide (vent
//           de l'en-tête, barres d'une heure sèche, goutte des heures sans pluie et rangée de la pluie sur 48 h sèches,
//           pluie et vent d'un jour, air de demain, lignes de pollens), et réapparaît quand il sert ; hauteur de chaque
//           barre de pluie et trait de base d'un quart d'heure sec ; l'indice de l'air écrit « indice 25 » ; une seule
//           ligne de crédits.
// Entrées : faux DOM ; vues fabriquées par les vrais calculs (vueMeteoEcran) sur les fixtures réelles, modifiées ici.
// Sorties : node --test.
// Pièges  : un nœud est visible si ni lui ni un de ses parents n'est hidden (le faux DOM ne calcule pas de mise en page).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { installerFauxDom, parClasse, texte } from './faux-dom.js';

installerFauxDom();
const { projeter } = await import('../serveur/ha/entites.js');
const { analyserAir, analyserPluie, analyserSemaine } = await import('../serveur/sources/open-meteo.js');
const { creerMeteo } = await import('../web/src/ecrans/meteo.js');
const { vueMeteoEcran } = await import('../web/src/ecrans/meteo-donnees.js');

const lire = (nom) => JSON.parse(readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), 'utf8'));
const ESP = ' ';
const A_14H20 = Date.parse('2026-10-11T12:20:00Z');
const visible = (n) => {
  for (let m = n; m; m = m.parentNode) if (m.hidden) return false;
  return true;
};
const visibles = (racine, classe) => parClasse(racine, classe).filter(visible);

// Données réelles du 11/10 (sèches, vent faible, pas de pollen) ; modifier(donnees) les change avant le calcul.
function donnees(modifier = () => {}) {
  const d = {
    entites: projeter(Object.fromEntries(lire('ha_states.json').map((etat) => [etat.entity_id, etat]))),
    meteo: lire('ha-meteo-horaire.json'),
    pluie: analyserPluie(lire('open-meteo-pluie.json')),
    semaine: analyserSemaine(lire('open-meteo-semaine.json'), '2026-10-11T14:00'),
    air: analyserAir(lire('open-meteo-air.json'), '2026-10-11'),
  };
  // L'horaire de HA date du 13/10 : on le décale de deux jours pour qu'il commence à l'heure du test.
  d.meteo.horaire.forEach((h) => { h.datetime = new Date(Date.parse(h.datetime) - 2 * 864e5).toISOString(); });
  modifier(d);
  return d;
}

function rendre(d) {
  const { conteneur } = installerFauxDom();
  const meteo = creerMeteo(conteneur);
  meteo.mettreAJour(vueMeteoEcran(d, A_14H20));
  return conteneur;
}

test('journée sèche et calme : température et ciel sans vent, « Pas de pluie » sans barres, aucune goutte ni vent, « Pas de pollen »', () => {
  const ecran = rendre(donnees());
  assert.deepEqual(visibles(ecran, 'meteo-maintenant-temp').map(texte), ['14°']);
  assert.deepEqual(visibles(ecran, 'meteo-maintenant-ciel').map(texte), ['Éclaircies']);
  assert.equal(parClasse(ecran, 'meteo-maintenant-picto')[0].getAttribute('aria-label'), 'Éclaircies');
  assert.equal(visibles(ecran, 'meteo-vent').length, 0);
  assert.deepEqual(visibles(ecran, 'meteo-resume').map(texte), ['Pas de pluie']);
  assert.equal(visibles(ecran, 'meteo-barres').length, 0);
  assert.equal(visibles(ecran, 'meteo-total').length, 0);
  assert.equal(visibles(ecran, 'meteo-heure').length, 48);
  assert.equal(visibles(ecran, 'meteo-heure-pluie').length, 0, 'aucune heure pluvieuse : aucune goutte');
  assert.ok(parClasse(ecran, 'meteo-heures-liste')[0].classList.contains('meteo-heures-seches'), 'ni la rangée de la pluie');
  assert.equal(visibles(ecran, 'meteo-jour').length, 7);
  assert.equal(visibles(ecran, 'meteo-jour-pluie').length + visibles(ecran, 'meteo-jour-vent').length, 0);
  assert.deepEqual(visibles(ecran, 'meteo-air-indice').map(texte), ['indice 25']);
  assert.deepEqual(visibles(ecran, 'meteo-air-libelle').map(texte), ['Moyen']);
  assert.ok(parClasse(ecran, 'meteo-air-pastille')[0].classList.contains('air-aqi-2'));
  assert.equal(visibles(ecran, 'meteo-air-demain').length, 0, 'demain moyen comme maintenant');
  assert.equal(visibles(ecran, 'meteo-pollens-titre').length + visibles(ecran, 'meteo-pollen').length, 0, 'plus de tableau de taxons à « aucun »');
  assert.deepEqual(visibles(ecran, 'meteo-pollens-message').map(texte), ['Pas de pollen']);
  assert.deepEqual(parClasse(ecran, 'meteo-credit').map(texte), [`Sources${ESP}: met.no · Open-Meteo.com (CC BY 4.0) · CAMS/Copernicus`]);
});

test('pluie, vent fort, air pire demain et pollens : chaque détail apparaît à sa place, et seulement là', () => {
  const ecran = rendre(donnees((d) => {
    d.entites['weather.forecast_maison'].attributes.wind_speed = 48.2;
    d.pluie.pas.forEach((p, i) => { p.precipitation = [0, 0, 0.6, 1.2, 0.3, 0, 0, 0][i]; });
    d.meteo.horaire[2].precipitation = 1.25;
    Object.assign(d.semaine.jours[1], { precipitation_sum: 11.5, wind_speed_10m_max: 18 });
    Object.assign(d.semaine.jours[3], { precipitation_sum: 0.4, wind_speed_10m_max: 52 });
    d.air.jours[1].european_aqi = 47;
    Object.assign(d.air.jours[0], { grass_pollen: 64, ragweed_pollen: 7 });
  }));
  assert.equal(texte(parClasse(ecran, 'meteo-maintenant')[0]), `14°Éclaircies48${ESP}km/h`);
  assert.deepEqual(visibles(ecran, 'meteo-vent-texte').map(texte), [`48${ESP}km/h`]);
  assert.equal(visibles(ecran, 'meteo-resume').length, 0);
  assert.equal(visibles(ecran, 'meteo-barre-colonne').length, 4);
  assert.deepEqual(visibles(ecran, 'meteo-barre-heure').map(texte), ['14:30', '14:45', '15:00', '15:15']);
  const barres = visibles(ecran, 'meteo-barre');
  assert.deepEqual(barres.map((b) => b.style.transform), ['scaleY(0.020)', 'scaleY(0.500)', 'scaleY(1.000)', 'scaleY(0.250)'], '0, 0,6, 1,2 et 0,3 mm : part du plus fort (1,2), trait de base à 0');
  assert.deepEqual(barres.map((b) => b.classList.contains('meteo-barre-nulle')), [true, false, false, false], 'le quart d\'heure sec garde un trait visible');
  assert.deepEqual(visibles(ecran, 'meteo-total-texte').map(texte), [`2,1${ESP}mm`]);
  const gouttes = visibles(ecran, 'meteo-heure-pluie');
  assert.deepEqual(gouttes.map(texte), ['1,3'], 'une seule heure pluvieuse : une seule goutte');
  assert.equal(parClasse(ecran, 'meteo-heures-liste')[0].classList.contains('meteo-heures-seches'), false, 'rangée de la pluie présente');
  assert.equal(parClasse(gouttes[0], 'meteo-heure-pluie-icone')[0].getAttribute('aria-label'), 'Pluie en mm');
  const lignes = visibles(ecran, 'meteo-jour');
  const details = (ligne) => [...visibles(ligne, 'meteo-jour-pluie'), ...visibles(ligne, 'meteo-jour-vent')].map(texte);
  assert.deepEqual(lignes.map(details), [[], [`11,5${ESP}mm`], [], [`52${ESP}km/h`], [], [], []], 'pluie de 0,4 mm et vent de 18 km/h masqués');
  assert.deepEqual(visibles(ecran, 'meteo-air-demain-libelle').map(texte), ['dégradé']);
  assert.deepEqual(visibles(ecran, 'meteo-pollens-titre').map(texte), ['Pollens']);
  assert.deepEqual(visibles(ecran, 'meteo-pollen').map((n) => [texte(parClasse(n, 'meteo-pollen-nom')[0]), parClasse(n, 'meteo-pollen-niveau')[0].className]), [
    ['Graminées', 'meteo-pollen-niveau meteo-pollen-3'],
    ['Ambroisie', 'meteo-pollen-niveau meteo-pollen-2'],
  ]);
  assert.equal(visibles(ecran, 'meteo-pollens-message').length, 0);
});

test('avant toute donnée : chaque bloc dit ce qu\'il attend', () => {
  const { conteneur } = installerFauxDom();
  creerMeteo(conteneur).mettreAJour(vueMeteoEcran({
    entites: {}, meteo: null, pluie: null, semaine: null, air: null,
  }, A_14H20));
  assert.equal(texte(parClasse(conteneur, 'meteo-maintenant')[0]), 'Météo pas encore reçue');
  assert.equal(visibles(conteneur, 'meteo-maintenant-temp').length + visibles(conteneur, 'meteo-maintenant-picto').length, 0);
  assert.deepEqual(visibles(conteneur, 'meteo-vide').map(texte), [
    'Prévisions heure par heure pas encore reçues', 'Prévisions sur 7 jours pas encore reçues', 'Air et pollens pas encore reçus',
  ]);
  assert.equal(visibles(conteneur, 'meteo-bande').length, 0);
});
