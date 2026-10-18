// web/src/ecrans/recette.js
//
// Rôle    : la recette pas à pas (conception §1.5), sous-écran plein écran (menu masqué par main.js) : à gauche
//           les ingrédients cochables, à droite l'étape en grand avec « Étape 3/7 », le badge du four, le bouton
//           « Lancer <minuteur> <durée> » et de très gros boutons Précédent / Suivant ; les astuces en dernière
//           page ; un bouton Fermer.
// Entrées : le conteneur (#ecran) ; actions { fermer(), lancerMinuteur({ libelle, dureeMs, surplusMs }),
//           ouvrirMinuteurs(), coches (creerCoches de recette-donnees.js), trouverMinuteur(libelle) } ; le menu
//           (flux) et l'id du repas.
// Sorties : creerRecette(conteneur, actions) -> { racine, ouvrir(menu, repasId) -> vrai si la recette existe,
//           fermer(), mettreAJourMenu(menu) -> vrai si la recette ouverte existe toujours, mettreAJourMinuteur(ms)
//           (à chaque tick : temps restant du minuteur de l'étape), ouverte() -> id du repas ou null }.
// Pièges  :
//   - Actions sur pointerup avec tolérance et anti-répétition (composants/appui.js) : un doigt mouillé qui glisse
//     ne tourne pas la page, deux touches fantômes ne sautent pas deux étapes.
//   - La page de chaque recette est gardée en mémoire pendant la session : fermer la recette pour regarder
//     l'Accueil puis la rouvrir reprend à la même étape.
//   - Si le minuteur de l'étape tourne déjà (même nom), le bouton montre son temps restant et ouvre le tiroir au
//     lieu d'en lancer un second.
//   - Une nouvelle publication du menu peut retirer la recette ouverte (autre semaine, recette remise à null) :
//     mettreAJourMenu le dit et main.js ferme le sous-écran ; sinon le contenu est relu (texte corrigé).
//   - Vue préconstruite : 30 ingrédients et 10 astuces au plus (bornes du schéma), masqués s'ils ne servent pas.

import { ecrire, element, icone, masquer } from '../dom.js';
import { texteRestant } from '../minuteurs.js';
import { surAppui } from '../composants/appui.js';
import { trouverRepas } from './repas-donnees.js';
import { enteteRecette, vuePage } from './recette-donnees.js';

const INGREDIENTS_MAX = 30;
const ASTUCES_MAX = 10;

function bouton(classe, nomIcone, texte, iconeApres) {
  const noeud = element('button', classe);
  noeud.type = 'button';
  const libelle = element('span', '', texte);
  if (nomIcone && !iconeApres) noeud.appendChild(icone(nomIcone, 'bouton-fort-icone'));
  noeud.appendChild(libelle);
  if (nomIcone && iconeApres) noeud.appendChild(icone(nomIcone, 'bouton-fort-icone'));
  return { noeud, libelle };
}

function construireIngredients(surBascule) {
  const carte = element('section', 'carte recette-ingredients');
  const tete = element('h2', 'intitule recette-ingredients-tete');
  tete.appendChild(element('span', '', 'Ingrédients'));
  const compte = element('span', 'recette-compte');
  tete.appendChild(compte);
  carte.appendChild(tete);
  const liste = element('ul', 'recette-liste');
  const lignes = [];
  for (let i = 0; i < INGREDIENTS_MAX; i += 1) {
    const ligne = element('li', 'recette-ingredient');
    const caseCoche = element('span', 'recette-case');
    caseCoche.appendChild(icone('i-check', 'recette-coche'));
    const texte = element('span', 'recette-ingredient-texte');
    ligne.appendChild(caseCoche);
    ligne.appendChild(texte);
    surAppui(ligne, () => surBascule(i));
    liste.appendChild(ligne);
    lignes.push({ ligne, texte });
  }
  carte.appendChild(liste);
  return { racine: carte, compte, lignes };
}

export function creerRecette(conteneur, actions) {
  let menu = null;
  let repas = null;
  let page = 0;
  let minuteurPage = null;
  let dernierMs = 0;
  const pages = {};

  const racine = element('section', 'recette');
  const entete = element('header', 'recette-entete');
  const fermer = bouton('bouton-doux recette-fermer', 'i-close', 'Fermer');
  const titres = element('div', 'recette-titres');
  const titre = element('h2', 'recette-titre');
  const details = element('p', 'recette-details');
  titres.appendChild(titre);
  titres.appendChild(details);
  entete.appendChild(fermer.noeud);
  entete.appendChild(titres);

  const corps = element('div', 'recette-corps');
  const ingredients = construireIngredients(basculer);
  const etape = element('section', 'carte recette-etape');
  const etapeTete = element('div', 'recette-etape-tete');
  const numero = element('h2', 'intitule recette-numero');
  const four = element('span', 'recette-four');
  four.appendChild(icone('i-oven', 'recette-four-icone'));
  const fourTexte = element('span', '');
  four.appendChild(fourTexte);
  etapeTete.appendChild(numero);
  etapeTete.appendChild(four);
  const texte = element('p', 'recette-texte');
  const astuces = element('ul', 'recette-astuces');
  const lignesAstuces = [];
  for (let i = 0; i < ASTUCES_MAX; i += 1) {
    const ligne = element('li', 'recette-astuce');
    lignesAstuces.push(ligne);
    astuces.appendChild(ligne);
  }
  const lancer = bouton('bouton-fort recette-lancer', 'i-timer', '');
  const nav = element('div', 'recette-nav');
  const precedent = bouton('bouton-doux recette-precedent', 'i-prev', 'Précédent');
  const suivant = bouton('bouton-fort recette-suivant', 'i-next', 'Suivant', true);
  nav.appendChild(precedent.noeud);
  nav.appendChild(suivant.noeud);
  [etapeTete, texte, astuces, lancer.noeud, nav].forEach((noeud) => etape.appendChild(noeud));
  corps.appendChild(ingredients.racine);
  corps.appendChild(etape);
  racine.appendChild(entete);
  racine.appendChild(corps);
  racine.hidden = true;
  conteneur.appendChild(racine);

  function rendreIngredients() {
    const liste = repas.recette.ingredients;
    const coches = actions.coches.lire(menu.cycle.debut, repas.id);
    ingredients.lignes.forEach((noeuds, i) => {
      masquer(noeuds.ligne, i >= liste.length);
      if (i >= liste.length) return;
      ecrire(noeuds.texte, liste[i]);
      noeuds.ligne.classList.toggle('recette-ingredient-coche', coches.indexOf(i) !== -1);
    });
    const nombre = coches.filter((i) => i < liste.length).length;
    ecrire(ingredients.compte, `${nombre} sur ${liste.length}`);
  }

  function rendrePage() {
    const vue = vuePage(repas.recette, page);
    page = vue.index;
    pages[repas.id] = page;
    ecrire(numero, vue.numero);
    masquer(four, vue.four === null);
    if (vue.four !== null) ecrire(fourTexte, vue.four);
    masquer(texte, vue.astuces !== null);
    ecrire(texte, vue.texte);
    const listeAstuces = vue.astuces || [];
    masquer(astuces, vue.astuces === null);
    lignesAstuces.forEach((ligne, i) => {
      masquer(ligne, i >= listeAstuces.length);
      if (i < listeAstuces.length) ecrire(ligne, listeAstuces[i]);
    });
    minuteurPage = vue.minuteur;
    masquer(lancer.noeud, minuteurPage === null);
    majLancer();
    precedent.noeud.disabled = !vue.precedent;
    suivant.noeud.disabled = !vue.suivant;
  }

  function majLancer() {
    if (!minuteurPage) return;
    const enCours = actions.trouverMinuteur(minuteurPage.libelle);
    if (!enCours) {
      ecrire(lancer.libelle, minuteurPage.texte);
      return;
    }
    const reste = enCours.fin > dernierMs ? texteRestant(enCours.fin - dernierMs) : 'terminé';
    ecrire(lancer.libelle, `${minuteurPage.libelle} · ${reste}`);
  }

  function basculer(index) {
    if (!repas || index >= repas.recette.ingredients.length) return;
    actions.coches.basculer(menu.cycle.debut, repas.id, index);
    rendreIngredients();
  }

  function charger(nouveauMenu, repasId) {
    const trouve = trouverRepas(nouveauMenu, repasId);
    if (!trouve || !trouve.recette) return false;
    menu = nouveauMenu;
    repas = trouve;
    const tete = enteteRecette(repas);
    ecrire(titre, tete.titre);
    ecrire(details, tete.details);
    rendreIngredients();
    rendrePage();
    return true;
  }

  surAppui(fermer.noeud, () => actions.fermer());
  surAppui(precedent.noeud, () => {
    page -= 1;
    rendrePage();
  });
  surAppui(suivant.noeud, () => {
    page += 1;
    rendrePage();
  });
  surAppui(lancer.noeud, () => {
    if (!minuteurPage) return;
    if (actions.trouverMinuteur(minuteurPage.libelle)) actions.ouvrirMinuteurs();
    else actions.lancerMinuteur(minuteurPage);
  });

  return {
    racine,
    ouvrir(nouveauMenu, repasId) {
      page = pages[repasId] || 0;
      if (!charger(nouveauMenu, repasId)) return false;
      racine.hidden = false;
      return true;
    },
    fermer() {
      repas = null;
      minuteurPage = null;
      racine.hidden = true;
    },
    mettreAJourMenu(nouveauMenu) {
      if (!repas) return false;
      return charger(nouveauMenu, repas.id);
    },
    mettreAJourMinuteur(ms) {
      dernierMs = ms;
      majLancer();
    },
    ouverte: () => (repas ? repas.id : null),
  };
}
