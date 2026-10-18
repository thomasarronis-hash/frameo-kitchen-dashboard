// web/src/ecrans/aujourdhui.js
//
// Rôle    : l'écran « Aujourd'hui » (décision de Thomas du 14/10) : tout ce qui est prévu aujourd'hui, une grande carte
//           par sujet, icône, titre court et l'essentiel en gros, sans phrases : Météo (matin, après-midi, soir), Repas
//           (gamelle ou midi, plat du soir, temps, bouton Recette), Rendez-vous (heure en gros, pastille de la
//           personne, titre, puis une ligne « Journée »), À prévoir (les rappels du menu), la bande des Alertes
//           seulement s'il y en a, et en haut à droite l'entrée Tempo (pastille du jour) qui ouvre la fiche Tempo.
// Entrées : le conteneur (#ecran) ; actions { ouvrirRecette(repasId) } ; mettreAJour(vue) avec la vue de
//           aujourdhui-donnees.js (vueAujourdhui).
// Sorties : creerAujourdhui(conteneur, actions) -> { racine, mettreAJour(vue), entrer() } (entrer referme la fiche Tempo).
// Pièges  :
//   - On y arrive par l'encart « Aujourd'hui » de l'Accueil ; le menu reste visible (aucune entrée n'y est marquée
//     active), et la page revient à l'Accueil après 60 s sans toucher comme les autres écrans (pilotage.js).
//   - Vue préconstruite (3 périodes, 7 rendez-vous et la ligne « Journée », 3 rappels, 4 alertes) : une mise à jour
//     ne change que textes,
//     icônes, classes et hidden, et seulement ce qui change (dom.js). Le nombre de lignes montrées est réglé par la
//     vue (place mesurée, voir aujourdhui-donnees.js) ; « + N autres » prend la place de la dernière ligne.
//   - Places stables : les quatre cartes sont toujours là, chacune avec son état vide écrit (« Météo pas encore
//     reçue », « Menu pas encore publié », « Rien de prévu », « Rien à prévoir »...) ; seule la bande des alertes
//     apparaît et disparaît (classe aujourdhui-avec-alertes sur la grille).
//   - Le bouton Recette est une NAVIGATION : sur pointerdown (conception §1.2) ; il n'existe que si la recette existe.
//   - Entrée Tempo (pastille et « Tempo », 96 px) : posée dans le coin haut droit, hors de la grille (l'en-tête garde
//     ses 79 px mesurés, les cartes ne bougent pas) ; toute l'année, pour que la fiche reste à un toucher quand l'Accueil
//     ne montre rien de Tempo (avril à octobre, décision de Thomas). Ouvrir la fiche est une NAVIGATION (pointerdown).
//   - Rendez-vous à l'heure d'abord (« 09:30 » en chiffres de 48 px ; « fin 00:30 » est un mot, en texte gras, classe
//     aujourdhui-rdv-mot : en Fraunces de 48 px, il ne tenait pas dans la colonne), puis une seule ligne « Journée »
//     pour les événements sur toute la journée (pastille et titre de chacun, « +N » pour le reste : ligne de
//     rendez-vous de composants/rendez-vous.js). « Rien de prévu » seulement s'il n'y a ni l'un ni l'autre.

import { carteTitree } from '../composants/carte.js';
import { creerLigneRendezVous, creerPastille, majPastille } from '../composants/rendez-vous.js';
import { creerFicheTempo, creerPastilleTempo, majPastilleTempo } from '../composants/tempo.js';
import {
  changerIcone, ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';
import { texteAutres } from '../format.js';

const PERIODES = 3;
const RENDEZ_VOUS = 7;
const RAPPELS = 3;
const ALERTES = 4;
const JOURNEES = 2;
const MESSAGES_RENDEZ_VOUS = { attente: 'Agenda pas encore lu', vide: 'Aucun agenda relié' };

function carte(parent, classe, titre, nomIcone) {
  const { racine } = carteTitree('section', `aujourdhui-carte ${classe}`, titre, nomIcone);
  parent.appendChild(racine);
  return racine;
}

function majPlus(noeud, plus) {
  masquer(noeud, plus === 0);
  ecrire(noeud, texteAutres(plus));
}

function construireMeteo(grille) {
  const racine = carte(grille, 'aujourdhui-meteo', 'Météo', 'i-sun');
  const vide = element('p', 'aujourdhui-vide');
  const liste = element('div', 'aujourdhui-periodes');
  const periodes = [];
  for (let i = 0; i < PERIODES; i += 1) {
    const colonne = element('div', 'aujourdhui-periode');
    const nom = element('span', 'aujourdhui-periode-nom');
    const ciel = element('div', 'aujourdhui-periode-ciel');
    const picto = icone(null, 'aujourdhui-periode-picto');
    picto.removeAttribute('aria-hidden');
    picto.setAttribute('role', 'img');
    const temperature = element('span', 'aujourdhui-periode-temp chiffres chiffres-affiche');
    ciel.appendChild(picto);
    ciel.appendChild(temperature);
    const pluie = element('p', 'aujourdhui-pluie');
    pluie.appendChild(icone('i-drop', 'aujourdhui-pluie-icone'));
    const pluieTexte = element('span', '');
    pluie.appendChild(pluieTexte);
    [nom, ciel, pluie].forEach((noeud) => colonne.appendChild(noeud));
    liste.appendChild(colonne);
    periodes.push({
      colonne, nom, picto, temperature, pluie, pluieTexte,
    });
  }
  racine.appendChild(vide);
  racine.appendChild(liste);
  return {
    mettreAJour(meteo) {
      const visibles = meteo ? meteo.periodes : [];
      masquer(vide, visibles.length > 0);
      ecrire(vide, meteo ? 'Plus de prévisions pour aujourd\'hui' : 'Météo pas encore reçue');
      masquer(liste, visibles.length === 0);
      periodes.forEach((n, i) => {
        const periode = visibles[i];
        masquer(n.colonne, !periode);
        if (!periode) return;
        ecrire(n.nom, periode.nom);
        changerIcone(n.picto, periode.picto);
        etiqueter(n.picto, periode.libelle);
        ecrire(n.temperature, periode.temperature || '');
        masquer(n.pluie, periode.pluie === null);
        ecrire(n.pluieTexte, periode.pluie || '');
      });
    },
  };
}

function construireRepas(grille, actions) {
  const racine = carte(grille, 'aujourdhui-repas', 'Repas', 'i-fork');
  const vide = element('p', 'aujourdhui-vide');
  const midi = element('div', 'aujourdhui-repas-ligne');
  const midiIntitule = element('span', 'aujourdhui-repas-intitule');
  const midiTitre = element('span', 'aujourdhui-repas-midi');
  midi.appendChild(midiIntitule);
  midi.appendChild(midiTitre);
  const soir = element('div', 'aujourdhui-repas-ligne');
  soir.appendChild(element('span', 'aujourdhui-repas-intitule', 'Soir'));
  const plat = element('span', 'aujourdhui-plat');
  soir.appendChild(plat);
  const bas = element('div', 'aujourdhui-repas-bas');
  const temps = element('span', 'aujourdhui-temps');
  temps.appendChild(icone('i-timer', 'aujourdhui-temps-icone'));
  const tempsTexte = element('span', '');
  temps.appendChild(tempsTexte);
  const bouton = element('button', 'bouton-fort bouton-recette');
  bouton.type = 'button';
  bouton.appendChild(icone('i-fork', 'bouton-fort-icone'));
  bouton.appendChild(element('span', '', 'Recette'));
  let repasId = null;
  bouton.addEventListener('pointerdown', () => {
    if (repasId) actions.ouvrirRecette(repasId);
  });
  bas.appendChild(temps);
  bas.appendChild(bouton);
  [vide, midi, soir, bas].forEach((noeud) => racine.appendChild(noeud));
  return {
    mettreAJour(repas) {
      masquer(vide, repas.message === null);
      if (repas.message !== null) ecrire(vide, repas.message);
      masquer(midi, repas.midi === null);
      if (repas.midi) {
        ecrire(midiIntitule, repas.midi.intitule);
        ecrire(midiTitre, repas.midi.titre);
      }
      masquer(soir, repas.soir === null);
      masquer(bas, repas.soir === null);
      if (!repas.soir) return;
      ecrire(plat, repas.soir.titre);
      ecrire(tempsTexte, repas.soir.temps);
      repasId = repas.soir.repasId;
      masquer(bouton, repasId === null);
    },
  };
}

function construireRendezVous(grille) {
  const racine = carte(grille, 'aujourdhui-rdv', 'Rendez-vous', 'i-cal');
  const vide = element('p', 'aujourdhui-vide');
  const liste = element('ul', 'aujourdhui-liste');
  const lignes = [];
  for (let i = 0; i < RENDEZ_VOUS; i += 1) {
    const ligne = element('li', 'aujourdhui-rdv-ligne');
    const horaire = element('span', 'aujourdhui-rdv-horaire');
    const pastille = creerPastille('aujourdhui-pastille');
    const titre = element('span', 'aujourdhui-rdv-titre');
    [horaire, pastille, titre].forEach((noeud) => ligne.appendChild(noeud));
    liste.appendChild(ligne);
    lignes.push({
      ligne, horaire, pastille, titre,
    });
  }
  const plus = element('p', 'aujourdhui-plus');
  const journee = element('div', 'aujourdhui-rdv-ligne aujourdhui-journee');
  journee.appendChild(element('span', 'aujourdhui-rdv-horaire aujourdhui-rdv-mot', 'Journée'));
  const journees = creerLigneRendezVous(journee, { nombre: JOURNEES, classe: 'aujourdhui-journee-liste' });
  [vide, liste, plus, journee].forEach((noeud) => racine.appendChild(noeud));
  return {
    mettreAJour(rendezVous) {
      masquer(vide, rendezVous.lignes.length > 0 || rendezVous.journee !== null);
      ecrire(vide, MESSAGES_RENDEZ_VOUS[rendezVous.etat] || 'Rien de prévu');
      lignes.forEach((n, i) => {
        const rdv = rendezVous.lignes[i];
        masquer(n.ligne, !rdv);
        if (!rdv) return;
        const classe = `aujourdhui-rdv-horaire ${rdv.aLHeure ? 'chiffres' : 'aujourdhui-rdv-mot'}`;
        if (n.horaire.className !== classe) n.horaire.className = classe;
        ecrire(n.horaire, rdv.horaire);
        majPastille(n.pastille, rdv);
        ecrire(n.titre, rdv.titre);
      });
      majPlus(plus, rendezVous.plus);
      masquer(journee, rendezVous.journee === null);
      journees.mettreAJour(rendezVous.journee);
    },
  };
}

function construireRappels(grille) {
  const racine = carte(grille, 'aujourdhui-rappels', 'À prévoir', 'i-note');
  const vide = element('p', 'aujourdhui-vide', 'Rien à prévoir');
  const liste = element('ul', 'aujourdhui-liste');
  const lignes = [];
  for (let i = 0; i < RAPPELS; i += 1) {
    const ligne = element('li', 'aujourdhui-rappel');
    const moment = element('span', 'aujourdhui-rappel-moment');
    const texte = element('p', 'aujourdhui-rappel-texte');
    ligne.appendChild(moment);
    ligne.appendChild(texte);
    liste.appendChild(ligne);
    lignes.push({ ligne, moment, texte });
  }
  const plus = element('p', 'aujourdhui-plus');
  [vide, liste, plus].forEach((noeud) => racine.appendChild(noeud));
  return {
    mettreAJour(rappels) {
      masquer(vide, rappels.lignes.length > 0);
      lignes.forEach((n, i) => {
        const rappel = rappels.lignes[i];
        masquer(n.ligne, !rappel);
        if (!rappel) return;
        ecrire(n.moment, rappel.moment);
        ecrire(n.texte, rappel.texte);
      });
      majPlus(plus, rappels.plus);
    },
  };
}

function construireAlertes(grille) {
  const racine = carte(grille, 'aujourdhui-alertes', 'Alertes', 'i-alert');
  const liste = element('ul', 'aujourdhui-alertes-liste');
  const lignes = [];
  for (let i = 0; i < ALERTES; i += 1) {
    const ligne = element('li', 'aujourdhui-alerte');
    const picto = icone(null, 'aujourdhui-alerte-icone');
    const textes = element('span', 'aujourdhui-alerte-textes');
    const titre = element('span', 'aujourdhui-alerte-titre');
    const valeur = element('span', 'aujourdhui-alerte-valeur');
    textes.appendChild(titre);
    textes.appendChild(valeur);
    ligne.appendChild(picto);
    ligne.appendChild(textes);
    liste.appendChild(ligne);
    lignes.push({
      ligne, picto, titre, valeur,
    });
  }
  const plus = element('li', 'aujourdhui-alerte aujourdhui-plus');
  liste.appendChild(plus);
  racine.appendChild(liste);
  return {
    racine,
    mettreAJour(alertes) {
      lignes.forEach((n, i) => {
        const alerte = alertes.lignes[i];
        masquer(n.ligne, !alerte);
        if (!alerte) return;
        changerIcone(n.picto, alerte.icone);
        ecrire(n.titre, alerte.titre);
        ecrire(n.valeur, alerte.valeur);
      });
      majPlus(plus, alertes.plus);
    },
  };
}

function construireTempo(racine) {
  const fiche = creerFicheTempo(racine);
  const bouton = element('button', 'bouton-doux aujourdhui-tempo');
  bouton.type = 'button';
  const pastille = creerPastilleTempo('tempo-pastille-entree');
  bouton.appendChild(pastille);
  bouton.appendChild(element('span', '', 'Tempo'));
  racine.appendChild(bouton);
  let contenu = null;
  bouton.addEventListener('pointerdown', () => {
    if (contenu) fiche.ouvrir(contenu);
  });
  return {
    fiche,
    mettreAJour(tempo) {
      masquer(bouton, tempo === null);
      contenu = tempo ? tempo.fiche : null;
      if (!tempo) return;
      majPastilleTempo(pastille, tempo.pastille);
      etiqueter(bouton, `Fiche Tempo, ${tempo.pastille.etiquette}`);
      if (fiche.ouverte()) fiche.ouvrir(contenu);
    },
  };
}

export function creerAujourdhui(conteneur, actions) {
  const racine = element('section', 'ecran-page aujourdhui');
  const entete = element('header', 'page-entete');
  entete.appendChild(element('h2', 'intitule', 'Aujourd\'hui'));
  const titre = element('p', 'page-titre');
  entete.appendChild(titre);
  racine.appendChild(entete);
  const grille = element('div', 'aujourdhui-grille');
  const meteo = construireMeteo(grille);
  const repas = construireRepas(grille, actions);
  const rendezVous = construireRendezVous(grille);
  const rappels = construireRappels(grille);
  const alertes = construireAlertes(grille);
  racine.appendChild(grille);
  const tempo = construireTempo(racine);
  conteneur.appendChild(racine);

  return {
    racine,
    entrer() {
      tempo.fiche.fermer();
    },
    mettreAJour(vue) {
      tempo.mettreAJour(vue.tempo);
      ecrire(titre, vue.titre);
      meteo.mettreAJour(vue.meteo);
      repas.mettreAJour(vue.repas);
      rendezVous.mettreAJour(vue.rendezVous);
      rappels.mettreAJour(vue.rappels);
      const avecAlertes = vue.alertes.lignes.length > 0;
      masquer(alertes.racine, !avecAlertes);
      grille.classList.toggle('aujourdhui-avec-alertes', avecAlertes);
      alertes.mettreAJour(vue.alertes);
    },
  };
}
