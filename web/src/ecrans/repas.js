// web/src/ecrans/repas.js
//
// Rôle    : l'écran Repas (conception §1.5) : les 9 repas du cycle, du samedi midi au vendredi soir, sur 7 lignes
//           (midi et soir), aujourd'hui en avant ; étiquettes, temps, « Recette à venir » ; toucher un repas qui
//           a sa recette ouvre la recette pas à pas. Aucune action de modification (Q18, non retenues).
// Entrées : le conteneur (#ecran) ; actions { ouvrirRecette(repasId) } ; mettreAJour(vue) avec la vue de
//           repas-donnees.js (vueRepas).
// Sorties : creerRepas(conteneur, actions) -> { racine, mettreAJour(vue) }.
// Pièges  :
//   - Vue préconstruite : 7 jours, 2 cellules par jour, 4 étiquettes par cellule (toutes celles du schéma) ;
//     une mise à jour ne change que textes, classes et hidden (dom.js).
//   - Les midis de semaine sont des gamelles (plat de la veille) : affichés en retrait, sans toucher possible.
//     Une cellule vide (pas de gamelle prévue) est masquée : chaque cellule a sa colonne fixée (repas-midi,
//     repas-soir dans repas.css), la cellule du soir ne glisse donc pas dans la colonne du midi.
//   - Ouvrir la recette est une navigation : sur pointerdown (§1.2). Une cellule sans recette ne réagit pas.
//   - Le titre du plat tient sur 2 lignes de 28 px jusqu'à 70 caractères environ (mesuré) ; au-delà (le schéma
//     en permet 80), il finit par une ellipse, et le titre complet est dans l'en-tête de la recette. La ligne
//     du dessous (temps, « Recette à venir », étiquettes, accompagnement) ne déborde jamais : l'accompagnement
//     se coupe d'abord, puis la ligne elle-même. Une carte avec recette porte une flèche à droite, dans un
//     <span> : l'attribut hidden n'agit pas sur un élément SVG (masquer() de dom.js vise les éléments HTML).

import { ecrire, element, icone, masquer } from '../dom.js';

const JOURS = 7;
const ETIQUETTES_MAX = 4;

function construireCellule(actions, creneau) {
  const racine = element('div', `repas-cellule repas-${creneau}`);
  const plat = element('p', 'repas-plat');
  const accompagnement = element('span', 'repas-accompagnement');
  const meta = element('p', 'repas-meta');
  const temps = element('span', 'repas-temps');
  const aVenir = element('span', 'repas-a-venir', 'Recette à venir');
  meta.appendChild(temps);
  meta.appendChild(aVenir);
  const etiquettes = [];
  for (let i = 0; i < ETIQUETTES_MAX; i += 1) {
    const etiquette = element('span', 'repas-etiquette');
    etiquettes.push(etiquette);
    meta.appendChild(etiquette);
  }
  meta.appendChild(accompagnement);
  const fleche = element('span', 'repas-fleche');
  fleche.appendChild(icone('i-next', 'repas-fleche-icone'));
  racine.appendChild(plat);
  racine.appendChild(meta);
  racine.appendChild(fleche);

  let repasId = null;
  racine.addEventListener('pointerdown', () => {
    if (repasId) actions.ouvrirRecette(repasId);
  });

  return {
    racine,
    mettreAJour(cellule) {
      masquer(racine, cellule === null);
      if (!cellule) {
        repasId = null;
        return;
      }
      racine.classList.toggle('repas-gamelle', cellule.gamelle);
      racine.classList.toggle('repas-avec-recette', !cellule.gamelle && cellule.recette);
      repasId = !cellule.gamelle && cellule.recette ? cellule.id : null;
      ecrire(plat, cellule.gamelle ? `Gamelle · ${cellule.titre}` : cellule.titre);
      const accomp = cellule.gamelle ? '' : cellule.accompagnement;
      masquer(accompagnement, accomp === '');
      ecrire(accompagnement, accomp);
      masquer(meta, cellule.gamelle);
      masquer(fleche, true);
      if (cellule.gamelle) return;
      ecrire(temps, cellule.temps);
      etiquettes.forEach((noeud, i) => {
        masquer(noeud, i >= cellule.etiquettes.length);
        if (i < cellule.etiquettes.length) ecrire(noeud, cellule.etiquettes[i]);
      });
      masquer(aVenir, cellule.recette);
      masquer(fleche, !cellule.recette);
    },
  };
}

export function creerRepas(conteneur, actions) {
  const racine = element('section', 'ecran-page repas');
  const entete = element('header', 'page-entete');
  entete.appendChild(element('h2', 'intitule', 'Repas de la semaine'));
  const titre = element('p', 'page-titre');
  entete.appendChild(titre);
  racine.appendChild(entete);

  const message = element('div', 'page-vide');
  const messageTitre = element('p', 'page-vide-titre');
  message.appendChild(messageTitre);
  message.appendChild(element('p', 'page-vide-texte', 'Le menu de la semaine arrive ici quand /menu le publie, en général le samedi.'));
  racine.appendChild(message);

  const grille = element('div', 'repas-grille');
  const colonnes = element('div', 'repas-colonnes');
  colonnes.appendChild(element('span', ''));
  colonnes.appendChild(element('span', 'intitule', 'Midi'));
  colonnes.appendChild(element('span', 'intitule', 'Soir'));
  grille.appendChild(colonnes);
  const jours = [];
  for (let i = 0; i < JOURS; i += 1) {
    const ligne = element('div', 'repas-jour');
    const nom = element('span', 'repas-nom');
    const midi = construireCellule(actions, 'midi');
    const soir = construireCellule(actions, 'soir');
    ligne.appendChild(nom);
    ligne.appendChild(midi.racine);
    ligne.appendChild(soir.racine);
    grille.appendChild(ligne);
    jours.push({ ligne, nom, midi, soir });
  }
  racine.appendChild(grille);
  conteneur.appendChild(racine);

  return {
    racine,
    mettreAJour(vue) {
      ecrire(titre, vue.titre);
      masquer(message, vue.message === null);
      masquer(grille, vue.message !== null);
      if (vue.message !== null) {
        ecrire(messageTitre, vue.message);
        return;
      }
      jours.forEach((noeuds, i) => {
        const jour = vue.jours[i];
        masquer(noeuds.ligne, !jour);
        if (!jour) return;
        noeuds.ligne.classList.toggle('repas-jour-auj', jour.aujourdhui);
        ecrire(noeuds.nom, jour.nom);
        noeuds.midi.mettreAJour(jour.midi);
        noeuds.soir.mettreAJour(jour.soir);
      });
    },
  };
}
