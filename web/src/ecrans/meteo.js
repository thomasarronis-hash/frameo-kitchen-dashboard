// web/src/ecrans/meteo.js
//
// Rôle    : l'écran Météo (conception §1.5, allégé le 14/10) : en tête le temps qu'il fait, lu de loin (pictogramme,
//           température en grand, ciel, et le vent seulement s'il est fort) ; une carte « Prochaines heures » avec à
//           gauche la pluie dans l'heure (« Pas de
//           pluie », ou 4 barres de 15 min et le total) et à droite le bandeau des 48 heures, heure par heure (on le fait
//           défiler du doigt) ; dessous les 7 jours et le panneau air et pollens ; une ligne de crédits en pied.
// Entrées : le conteneur (#ecran) ; mettreAJour(vue) avec la vue de meteo-donnees.js (vueMeteoEcran).
// Sorties : creerMeteo(conteneur) -> { racine, mettreAJour(vue) }.
// Pièges  :
//   - Vue préconstruite (48 colonnes d'heures, 4 barres, 7 jours, une ligne par taxon) : une mise à jour ne change
//     que textes, icônes, classes, hidden et la hauteur des barres (dom.js, règle de Wes §1.2).
//   - Ce qui n'a rien à dire est masqué (hidden), jamais écrit à vide ou à zéro : pluie d'une heure, pluie et vent
//     d'un jour, vent de l'en-tête, barres d'une heure sèche, air de demain, lignes de pollens. Sans aucune heure
//     pluvieuse sur 48 h, la rangée de la pluie disparaît aussi (classe meteo-heures-seches, la carte rapetisse).
//   - Pluie et vent d'un jour ont chacun leur colonne fixe dans la grille de la ligne (meteo.css) : masquer la pluie
//     ne fait pas glisser le vent dans sa colonne.
//   - 48 colonnes de 84 px ne tiennent pas dans la carte (15 environ visibles) : le bandeau défile à
//     l'horizontale (touch-action: pan-x, meteo.css). Le nom du jour (première heure, puis minuit) déborde
//     sur les colonnes suivantes, dont la case du jour est vide, et un filet marque minuit.
//   - Hauteur d'une barre : transform scaleY (base en bas), pas d'animation de hauteur ; un quart d'heure sec dans une
//     heure pluvieuse garde un trait de base visible (classe meteo-barre-nulle).
//   - La température actuelle est le plus gros chiffre de l'écran (96 px, conception §1.2) ; l'indice de l'air, plus
//     petit, est écrit « indice 29 » : seul et en grand, il se lisait comme une température.
//   - Chaque bloc a son état vide écrit : « Météo pas encore reçue », « Prévisions heure par heure pas encore
//     reçues », « Pluie au quart d'heure pas encore reçue », « Prévisions sur 7 jours pas encore reçues », « Air
//     et pollens pas encore reçus ».

import { TAXONS } from '../air.js';
import {
  changerIcone, ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';

const HEURES = 48;
const BARRES = 4;
const JOURS = 7;

// Pictogramme lu (role img et étiquette) : ciel d'une heure ou d'un jour, goutte, vent.
function pictoLisible(nom, classe, etiquette) {
  const picto = icone(nom, classe);
  picto.removeAttribute('aria-hidden');
  picto.setAttribute('role', 'img');
  if (etiquette) etiqueter(picto, etiquette);
  return picto;
}

// Icône suivie d'un texte (pluie ou vent) : { racine, picto, texte }.
function valeurIllustree(classe, nom, etiquette) {
  const racine = element('span', classe);
  const picto = pictoLisible(nom, `${classe}-icone`, etiquette);
  const texte = element('span', `${classe}-texte`);
  racine.appendChild(picto);
  racine.appendChild(texte);
  return { racine, picto, texte };
}

function construireDansLHeure() {
  const racine = element('div', 'meteo-dans-lheure');
  racine.appendChild(element('p', 'meteo-sous-titre', 'Dans l\'heure'));
  const resume = element('p', 'meteo-resume');
  const barresBloc = element('div', 'meteo-barres');
  const barres = [];
  for (let i = 0; i < BARRES; i += 1) {
    const colonne = element('div', 'meteo-barre-colonne');
    const piste = element('div', 'meteo-barre-piste');
    const barre = element('div', 'meteo-barre');
    piste.appendChild(barre);
    const heure = element('span', 'meteo-barre-heure');
    colonne.appendChild(piste);
    colonne.appendChild(heure);
    barresBloc.appendChild(colonne);
    barres.push({ colonne, barre, heure });
  }
  const total = valeurIllustree('meteo-total', 'i-drop', 'Pluie');
  [resume, barresBloc, total.racine].forEach((noeud) => racine.appendChild(noeud));
  return {
    racine, resume, bloc: barresBloc, barres, total,
  };
}

function construireHeures() {
  const carte = element('section', 'carte meteo-heures');
  carte.appendChild(element('h2', 'intitule meteo-heures-titre', 'Prochaines heures'));
  const bande = element('div', 'meteo-bande');
  const dansLHeure = construireDansLHeure();
  const defile = element('div', 'meteo-defile');
  const liste = element('div', 'meteo-heures-liste');
  const heures = [];
  for (let i = 0; i < HEURES; i += 1) {
    const colonne = element('div', 'meteo-heure');
    const jour = element('span', 'meteo-heure-jour');
    const heure = element('span', 'meteo-heure-h');
    const picto = pictoLisible(null, 'meteo-heure-picto');
    const temperature = element('span', 'meteo-heure-temp chiffres');
    const pluie = valeurIllustree('meteo-heure-pluie', 'i-drop');
    [jour, heure, picto, temperature, pluie.racine].forEach((noeud) => colonne.appendChild(noeud));
    liste.appendChild(colonne);
    heures.push({
      colonne, jour, heure, picto, temperature, pluie,
    });
  }
  defile.appendChild(liste);
  bande.appendChild(dansLHeure.racine);
  bande.appendChild(defile);
  carte.appendChild(bande);
  const vide = element('p', 'meteo-vide', 'Prévisions heure par heure pas encore reçues');
  carte.appendChild(vide);
  return {
    racine: carte, bande, dansLHeure, defile, liste, heures, vide,
  };
}

function construireJours() {
  const carte = element('section', 'carte meteo-jours');
  carte.appendChild(element('h2', 'intitule', '7 jours'));
  const vide = element('p', 'meteo-vide', 'Prévisions sur 7 jours pas encore reçues');
  carte.appendChild(vide);
  const lignes = [];
  for (let i = 0; i < JOURS; i += 1) {
    const ligne = element('div', 'meteo-jour');
    const nom = element('span', 'meteo-jour-nom');
    const picto = pictoLisible(null, 'meteo-jour-picto');
    const maxi = element('span', 'meteo-jour-maxi chiffres');
    const mini = element('span', 'meteo-jour-mini chiffres');
    const pluie = valeurIllustree('meteo-jour-pluie', 'i-drop', 'Pluie');
    const vent = valeurIllustree('meteo-jour-vent', 'i-wind', 'Vent');
    [nom, picto, maxi, mini, pluie.racine, vent.racine].forEach((noeud) => ligne.appendChild(noeud));
    carte.appendChild(ligne);
    lignes.push({
      ligne, nom, picto, maxi, mini, pluie, vent,
    });
  }
  return { racine: carte, vide, lignes };
}

function construireAir() {
  const carte = element('section', 'carte meteo-air');
  carte.appendChild(element('h2', 'intitule', 'Air et pollens'));
  const vide = element('p', 'meteo-vide', 'Air et pollens pas encore reçus');
  const contenu = element('div', 'meteo-air-contenu');
  const niveau = element('div', 'meteo-air-niveau');
  const pastille = element('span', 'air-pastille meteo-air-pastille');
  const libelle = element('span', 'meteo-air-libelle');
  const indice = element('span', 'meteo-air-indice');
  [pastille, libelle, indice].forEach((noeud) => niveau.appendChild(noeud));
  const demain = element('p', 'meteo-air-demain');
  demain.appendChild(element('span', '', 'Demain'));
  const demainPastille = element('span', 'air-pastille');
  const demainLibelle = element('span', 'meteo-air-demain-libelle');
  demain.appendChild(demainPastille);
  demain.appendChild(demainLibelle);
  const pollens = element('div', 'meteo-pollens');
  const titrePollens = element('p', 'meteo-pollens-titre', 'Pollens');
  pollens.appendChild(titrePollens);
  const lignes = [];
  for (let i = 0; i < TAXONS.length; i += 1) {
    const ligne = element('p', 'meteo-pollen');
    const nom = element('span', 'meteo-pollen-nom');
    const niveauPollen = element('span', 'meteo-pollen-niveau');
    ligne.appendChild(nom);
    ligne.appendChild(niveauPollen);
    pollens.appendChild(ligne);
    lignes.push({ ligne, nom, niveau: niveauPollen });
  }
  const message = element('p', 'meteo-pollens-message');
  pollens.appendChild(message);
  [niveau, demain, pollens].forEach((noeud) => contenu.appendChild(noeud));
  carte.appendChild(vide);
  carte.appendChild(contenu);
  return {
    racine: carte, vide, contenu, pastille, indice, libelle, demain, demainPastille, demainLibelle, titrePollens, lignes, message,
  };
}

// Valeur d'une pluie ou d'un vent : masquée quand elle vaut null.
function majValeur(noeuds, texte) {
  masquer(noeuds.racine, texte === null);
  ecrire(noeuds.texte, texte || '');
}

function classePastille(base, classe) {
  return `${base} ${classe ? `air-${classe}` : 'air-inconnu'}`;
}

function changerClasse(noeud, classe) {
  if (noeud.className !== classe) noeud.className = classe;
}

function majDansLHeure(noeuds, dansLHeure) {
  const pluvieuse = dansLHeure !== null && dansLHeure.total !== null;
  masquer(noeuds.resume, pluvieuse);
  ecrire(noeuds.resume, dansLHeure ? 'Pas de pluie' : 'Pluie au quart d\'heure pas encore reçue');
  masquer(noeuds.bloc, !pluvieuse);
  majValeur(noeuds.total, pluvieuse ? dansLHeure.total : null);
  if (!pluvieuse) return;
  noeuds.barres.forEach((n, i) => {
    const p = dansLHeure.pas[i];
    masquer(n.colonne, !p);
    if (!p) return;
    ecrire(n.heure, p.heure);
    n.barre.classList.toggle('meteo-barre-nulle', p.part === 0);
    const transformation = `scaleY(${Math.max(p.part, 0.02).toFixed(3)})`;
    if (n.barre.style.transform !== transformation) n.barre.style.transform = transformation;
  });
}

function majHeures(noeuds, heures, dansLHeure) {
  masquer(noeuds.vide, heures !== null);
  masquer(noeuds.bande, heures === null && dansLHeure === null);
  masquer(noeuds.defile, heures === null);
  majDansLHeure(noeuds.dansLHeure, dansLHeure);
  noeuds.liste.classList.toggle('meteo-heures-seches', heures !== null && !heures.avecPluie);
  const liste = heures ? heures.heures : [];
  noeuds.heures.forEach((n, i) => {
    const h = liste[i];
    masquer(n.colonne, !h);
    if (!h) return;
    n.colonne.classList.toggle('meteo-heure-minuit', i > 0 && h.jour !== null);
    ecrire(n.jour, h.jour || '');
    ecrire(n.heure, h.heure);
    changerIcone(n.picto, h.picto);
    etiqueter(n.picto, h.libelle);
    ecrire(n.temperature, h.temperature || '');
    majValeur(n.pluie, h.pluie);
    if (h.pluie !== null) etiqueter(n.pluie.picto, heures.etiquettePluie);
  });
}

function majJours(noeuds, jours) {
  masquer(noeuds.vide, jours !== null);
  const liste = jours || [];
  noeuds.lignes.forEach((n, i) => {
    const jour = liste[i];
    masquer(n.ligne, !jour);
    if (!jour) return;
    n.ligne.classList.toggle('meteo-jour-auj', jour.aujourdhui);
    ecrire(n.nom, jour.nom);
    changerIcone(n.picto, jour.picto);
    etiqueter(n.picto, jour.libelle);
    ecrire(n.maxi, jour.maxi || '');
    ecrire(n.mini, jour.mini || '');
    majValeur(n.pluie, jour.pluie);
    majValeur(n.vent, jour.vent);
  });
}

function majAir(noeuds, air) {
  masquer(noeuds.vide, air !== null);
  masquer(noeuds.contenu, air === null);
  if (!air) return;
  changerClasse(noeuds.pastille, classePastille('air-pastille meteo-air-pastille', air.classe));
  ecrire(noeuds.indice, air.indice);
  masquer(noeuds.indice, air.indice === '');
  ecrire(noeuds.libelle, air.libelle);
  masquer(noeuds.demain, air.demain === null);
  if (air.demain) {
    changerClasse(noeuds.demainPastille, classePastille('air-pastille', air.demain.classe));
    ecrire(noeuds.demainLibelle, air.demain.libelle);
  }
  const { lignes, message } = air.pollens;
  masquer(noeuds.titrePollens, lignes.length === 0);
  noeuds.lignes.forEach((n, i) => {
    const ligne = lignes[i];
    masquer(n.ligne, !ligne);
    if (!ligne) return;
    ecrire(n.nom, ligne.nom);
    ecrire(n.niveau, ligne.niveau);
    changerClasse(n.niveau, `meteo-pollen-niveau meteo-pollen-${ligne.rang}`);
  });
  masquer(noeuds.message, message === null);
  ecrire(noeuds.message, message || '');
}

// En tête : pictogramme, température en grand, ciel, vent s'il est fort.
function construireMaintenant(entete) {
  const ligne = element('div', 'meteo-maintenant');
  const picto = pictoLisible(null, 'meteo-maintenant-picto');
  const temperature = element('span', 'meteo-maintenant-temp chiffres chiffres-affiche');
  const libelle = element('span', 'meteo-maintenant-ciel');
  const vent = valeurIllustree('meteo-vent', 'i-wind', 'Vent');
  [picto, temperature, libelle, vent.racine].forEach((noeud) => ligne.appendChild(noeud));
  entete.appendChild(ligne);
  return {
    mettreAJour(maintenant) {
      masquer(picto, !maintenant || !maintenant.picto);
      masquer(temperature, !maintenant || maintenant.temperature === null);
      ecrire(libelle, maintenant ? maintenant.libelle : 'Météo pas encore reçue');
      majValeur(vent, maintenant ? maintenant.vent : null);
      if (!maintenant) return;
      changerIcone(picto, maintenant.picto);
      etiqueter(picto, maintenant.libelle);
      ecrire(temperature, maintenant.temperature || '');
    },
  };
}

export function creerMeteo(conteneur) {
  const racine = element('section', 'ecran-page meteo');
  const entete = element('header', 'page-entete');
  entete.appendChild(element('h2', 'intitule', 'Météo'));
  const maintenant = construireMaintenant(entete);
  racine.appendChild(entete);

  const corps = element('div', 'meteo-corps');
  const heures = construireHeures();
  const bas = element('div', 'meteo-bas');
  const jours = construireJours();
  const air = construireAir();
  bas.appendChild(jours.racine);
  bas.appendChild(air.racine);
  const credits = element('p', 'meteo-credit');
  [heures.racine, bas, credits].forEach((noeud) => corps.appendChild(noeud));
  racine.appendChild(corps);
  conteneur.appendChild(racine);

  return {
    racine,
    mettreAJour(vue) {
      maintenant.mettreAJour(vue.maintenant);
      majHeures(heures, vue.heures, vue.dansLHeure);
      majJours(jours, vue.jours);
      majAir(air, vue.air);
      ecrire(credits, vue.credits);
    },
  };
}
