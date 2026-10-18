// web/src/composants/minuteurs.js
//
// Rôle    : l'interface des minuteurs (conception §1.5) : le tiroir (régler -1 / +1 / +5 min, démarrer ; liste des
//           minuteurs en cours avec +1 min et Annuler) et l'alerte plein écran de fin, qui reste jusqu'au toucher.
// Entrées : creerTiroir(conteneur, { lancer(dureeMs) -> vrai si lancé, ajouter(id), annuler(id), retablir(id) ->
//           vrai si rétabli }) ; creerAlerte(conteneur, { arreter(), prolonger(id, dureeMs) }) ; mettreAJour avec
//           l'état de web/src/minuteurs.js (et l'heure corrigée pour le tiroir), à chaque tick (une fois par
//           seconde) et après chaque geste.
// Sorties : creerTiroir(...) -> { ouvrir(), fermer(), estOuvert(), mettreAJour(etat, ms) } ;
//           creerAlerte(...) -> { mettreAJour(sonnants), estVisible() }.
// Pièges  :
//   - Vues préconstruites (MINUTEURS_MAX lignes) : le tick ne change que les textes qui bougent (dom.js).
//   - Ouvrir le tiroir est une navigation (pointerdown, côté appelant) ; tous ses boutons sont des actions sur
//     pointerup avec tolérance et anti-répétition (composants/appui.js), UNE anti-répétition pour toute la liste
//     (les lignes bougent). Toucher le voile à gauche le referme.
//   - Annuler : la ligne reste 5 s à sa place, « Annulé », avec Rétablir là où était « +1 min » ; la place
//     d'Annuler reste vide (visibility, pas display : rien ne glisse sous le doigt), un second toucher au même
//     endroit ne fait donc rien. « +1 min » et Annuler sont écartés de 32 px.
//   - Le réglage revient à 5 min à chaque ouverture ; il est borné de 1 min à 6 h (reglerDuree).
//   - Alerte : un toucher N'IMPORTE OÙ l'arrête (mains mouillées, pas de cible à viser), sauf sur « Encore
//     N min », qui relance le minuteur pour le temps de plus prévu par la recette (« 35 à 40 min ») ou 1 min.
//     Elle passe au-dessus de tout, nuit et tiroir compris, et indique l'heure de fin (une sonnerie après un
//     rechargement peut être en retard : on le voit). Au-delà de 3 minuteurs qui sonnent, les 2 premiers ont
//     leur ligne et les autres sont nommés ensemble (vueAlerte) : la consigne reste à l'écran.

import { ecrire, element, icone, masquer } from '../dom.js';
import { texteHeure } from '../heure.js';
import {
  ALERTE_LIGNES_MAX, MINUTEURS_MAX, reglerDuree, texteDureeCourte, vueAlerte, vueTiroir,
} from '../minuteurs.js';
import { creerGarde, surAppui } from './appui.js';

const MINUTE_MS = 60000;
const DUREE_DEFAUT_MS = 5 * MINUTE_MS;
const REGLAGES = [['1 min', -MINUTE_MS, 'i-minus'], ['1 min', MINUTE_MS, 'i-plus'], ['5 min', 5 * MINUTE_MS, 'i-plus']];

function bouton(classe, texte, nomIcone) {
  const noeud = element('button', classe);
  noeud.type = 'button';
  if (nomIcone) noeud.appendChild(icone(nomIcone, 'bouton-fort-icone'));
  const libelle = element('span', '', texte);
  noeud.appendChild(libelle);
  return { noeud, libelle };
}

export function creerTiroir(conteneur, actions) {
  let duree = DUREE_DEFAUT_MS;
  let vues = [];

  const voile = element('div', 'tiroir-voile');
  const panneau = element('aside', 'tiroir');
  const entete = element('header', 'tiroir-entete');
  entete.appendChild(element('h2', 'tiroir-titre', 'Minuteurs'));
  const fermer = bouton('bouton-doux tiroir-fermer', 'Fermer', 'i-close');
  entete.appendChild(fermer.noeud);

  const reglage = element('section', 'tiroir-reglage');
  reglage.appendChild(element('h3', 'intitule', 'Nouveau minuteur'));
  const affichageDuree = element('span', 'tiroir-duree chiffres');
  const demarrer = bouton('bouton-fort tiroir-demarrer', 'Démarrer', 'i-timer');
  reglage.appendChild(affichageDuree);
  reglage.appendChild(demarrer.noeud);
  REGLAGES.forEach(([texte, delta, nomIcone]) => {
    const b = bouton('bouton-doux tiroir-regler', texte, nomIcone);
    surAppui(b.noeud, () => {
      duree = reglerDuree(duree, delta);
      ecrire(affichageDuree, texteDureeCourte(duree));
    });
    reglage.appendChild(b.noeud);
  });
  const message = element('p', 'tiroir-message', `${MINUTEURS_MAX} minuteurs au plus : en arrêter un d'abord`);
  message.hidden = true;
  reglage.appendChild(message);

  const liste = element('ul', 'tiroir-liste');
  const vide = element('p', 'tiroir-vide', 'Aucun minuteur en cours');
  const gardeListe = creerGarde();
  const lignes = [];
  for (let i = 0; i < MINUTEURS_MAX; i += 1) {
    const ligne = element('li', 'tiroir-minuteur');
    const textes = element('div', 'tiroir-minuteur-textes');
    const libelle = element('span', 'tiroir-minuteur-nom');
    const temps = element('span', 'tiroir-minuteur-temps chiffres');
    textes.appendChild(libelle);
    textes.appendChild(temps);
    const plus = bouton('bouton-doux tiroir-plus', '1 min', 'i-plus');
    const annuler = bouton('bouton-doux tiroir-annuler', 'Annuler', 'i-close');
    surAppui(plus.noeud, () => {
      const vue = vues[i];
      if (!vue) return;
      if (!vue.annule) actions.ajouter(vue.id);
      else masquer(message, actions.retablir(vue.id));
    }, gardeListe);
    surAppui(annuler.noeud, () => {
      if (vues[i] && !vues[i].annule) actions.annuler(vues[i].id);
    }, gardeListe);
    [textes, plus.noeud, annuler.noeud].forEach((noeud) => ligne.appendChild(noeud));
    liste.appendChild(ligne);
    lignes.push({ ligne, libelle, temps, plus });
  }

  [entete, reglage, liste, vide].forEach((noeud) => panneau.appendChild(noeud));
  conteneur.appendChild(voile);
  conteneur.appendChild(panneau);
  conteneur.hidden = true;

  const fermerTiroir = () => {
    masquer(conteneur, true);
  };
  surAppui(fermer.noeud, fermerTiroir);
  voile.addEventListener('pointerdown', fermerTiroir);
  surAppui(demarrer.noeud, () => masquer(message, actions.lancer(duree)));

  return {
    ouvrir() {
      duree = DUREE_DEFAUT_MS;
      ecrire(affichageDuree, texteDureeCourte(duree));
      masquer(message, true);
      masquer(conteneur, false);
    },
    fermer: fermerTiroir,
    estOuvert: () => !conteneur.hidden,
    mettreAJour(etat, ms) {
      if (conteneur.hidden) return;
      vues = vueTiroir(etat, ms);
      masquer(vide, vues.length > 0);
      lignes.forEach((noeuds, i) => {
        const vue = vues[i];
        masquer(noeuds.ligne, !vue);
        if (!vue) return;
        ecrire(noeuds.libelle, vue.libelle);
        ecrire(noeuds.temps, vue.temps);
        ecrire(noeuds.plus.libelle, vue.annule ? 'Rétablir' : '1 min');
        noeuds.ligne.classList.toggle('tiroir-minuteur-annule', vue.annule);
      });
    },
  };
}

export function creerAlerte(conteneur, actions) {
  let sonnants = [];
  const tete = element('div', 'alerte-tete');
  tete.appendChild(icone('i-bell', 'alerte-icone'));
  tete.appendChild(element('p', 'alerte-titre', 'Minuteur terminé'));
  const liste = element('ul', 'alerte-liste');
  const lignes = [];
  for (let i = 0; i < ALERTE_LIGNES_MAX; i += 1) {
    const ligne = element('li', 'alerte-ligne');
    const textes = element('div', 'alerte-textes');
    const nom = element('span', 'alerte-nom');
    const fin = element('span', 'alerte-fin');
    textes.appendChild(nom);
    textes.appendChild(fin);
    const encore = bouton('alerte-bouton alerte-encore', '', 'i-plus');
    surAppui(encore.noeud, () => {
      const minuteur = sonnants[i];
      if (minuteur) actions.prolonger(minuteur.id, minuteur.surplusMs || MINUTE_MS);
    });
    ligne.appendChild(textes);
    ligne.appendChild(encore.noeud);
    liste.appendChild(ligne);
    lignes.push({ ligne, nom, fin, encore: encore.libelle });
  }
  const autres = element('p', 'alerte-autres');
  const arreter = element('p', 'alerte-arreter', 'Toucher l\'écran pour arrêter la sonnerie');
  [tete, liste, autres, arreter].forEach((noeud) => conteneur.appendChild(noeud));
  conteneur.hidden = true;
  conteneur.setAttribute('role', 'alertdialog');

  surAppui(conteneur, (e) => {
    if (e.target.closest && e.target.closest('.alerte-encore')) return;
    actions.arreter();
  });

  return {
    mettreAJour(nouveaux) {
      const vue = vueAlerte(nouveaux);
      sonnants = vue.lignes;
      masquer(conteneur, nouveaux.length === 0);
      masquer(autres, vue.autres === null);
      if (vue.autres !== null) ecrire(autres, vue.autres);
      lignes.forEach((noeuds, i) => {
        const minuteur = sonnants[i];
        masquer(noeuds.ligne, !minuteur);
        if (!minuteur) return;
        ecrire(noeuds.nom, minuteur.libelle);
        ecrire(noeuds.fin, `terminé à ${texteHeure(minuteur.fin)}`);
        ecrire(noeuds.encore, `Encore ${texteDureeCourte(minuteur.surplusMs || MINUTE_MS)}`);
      });
    },
    estVisible: () => !conteneur.hidden,
  };
}
