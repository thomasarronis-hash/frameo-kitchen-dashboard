// web/src/ecrans/enfants-parent.js
//
// Rôle    : la page du mode parent (choix de Thomas du 14/10, partie 4), pour l'enfant de l'écran : ses étapes du matin
//           (valider ou refuser celles qui attendent un parent, cocher un oubli, décocher une étape cochée par erreur), +1
//           point à Timo (gros boutons, motif facultatif : Bravo, rangé, mis la table, aidé), −1 à côté de son solde (un
//           point donné par erreur, décision du 14/10 en fin d'après-midi), sa demande d'échange (valider ou refuser), et ses
//           7 derniers jours en pastilles.
// Entrées : creerPageParent(parent, { decider(etape, decision), cocher(etape), decocher(etape), point(motif), retirer(),
//           echange(demande, decision) }) ; mettreAJour(vue de parent-donnees.js vueParent).
// Sorties : { racine, mettreAJour(vue) }.
// Pièges  :
//   - Ouverte seulement pendant les 60 s du mode parent (enfants.js) ; chaque bouton est un toucher simple (lever du
//     doigt) : le geste parent (appui long de 3 s sur un visage) a déjà prouvé qu'un adulte est là.
//   - −1 grisé à 0 point : le solde ne descend jamais sous 0 (le serveur refuse aussi un point déjà échangé). C'est une
//     correction, pas une punition : Timo ne perd jamais de points pour une bêtise.
//   - Un seul enfant à la fois, historique compris (jamais de comparaison entre frères).
//   - Vue préconstruite : 7 étapes, 4 motifs (Bravo et les 3 du barème ; 6 motifs au plus au barème, les 3 premiers
//     seulement : la conception le dit), 7 jours.

import { surAppui } from '../composants/appui.js';
import {
  changerIcone, ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';

const ETAPES_MAX = 7;
const MOTIFS_MAX = 4;
const JOURS = 7;
const ACTIONS = [
  { cle: 'valider', classe: 'bouton-fort', icone: 'i-check', texte: 'Valider' },
  { cle: 'refuser', classe: 'bouton-doux', icone: 'i-close', texte: 'Refuser' },
  { cle: 'cocher', classe: 'bouton-doux', icone: 'i-check', texte: 'Cocher' },
  { cle: 'decocher', classe: 'bouton-doux', icone: 'i-back', texte: 'Décocher' },
];
const ETATS = ['a_faire', 'attente', 'valide'];

function bouton(classe, picto, texte) {
  const noeud = element('button', classe);
  noeud.type = 'button';
  noeud.appendChild(icone(picto, 'bouton-fort-icone'));
  noeud.appendChild(element('span', '', texte));
  return noeud;
}

function construireEtape(liste, actions) {
  const ligne = element('li', 'parent-etape');
  const picto = icone(null, 'parent-etape-picto');
  const libelle = element('span', 'parent-etape-nom');
  const etat = icone(null, 'parent-etape-etat');
  const boutons = element('span', 'parent-etape-boutons');
  const id = { valeur: null };
  const parCle = {};
  ACTIONS.forEach((action) => {
    const noeud = bouton(`${action.classe} parent-action`, action.icone, action.texte);
    surAppui(noeud, () => {
      if (!id.valeur) return;
      if (action.cle === 'valider' || action.cle === 'refuser') actions.decider(id.valeur, action.cle);
      else actions[action.cle](id.valeur);
    });
    parCle[action.cle] = noeud;
    boutons.appendChild(noeud);
  });
  [picto, libelle, etat, boutons].forEach((noeud) => ligne.appendChild(noeud));
  liste.appendChild(ligne);
  return {
    ligne, picto, libelle, etat, parCle, id,
  };
}

function construirePoints(parent, actions) {
  const carte = element('section', 'carte parent-points');
  carte.appendChild(element('h2', 'intitule', 'Points'));
  const ligneSolde = element('div', 'parent-solde-ligne');
  const solde = element('p', 'parent-solde');
  solde.appendChild(icone('i-etoile', 'parent-solde-etoile'));
  const soldeTexte = element('span', 'chiffres');
  solde.appendChild(soldeTexte);
  const retirer = element('button', 'bouton-doux parent-retirer');
  retirer.type = 'button';
  retirer.appendChild(icone('i-minus', 'parent-retirer-icone'));
  retirer.appendChild(element('span', 'parent-retirer-texte chiffres', '1'));
  etiqueter(retirer, 'Retirer un point donné par erreur');
  surAppui(retirer, () => {
    if (!retirer.disabled) actions.retirer();
  });
  ligneSolde.appendChild(solde);
  ligneSolde.appendChild(retirer);
  carte.appendChild(ligneSolde);
  const grille = element('div', 'parent-motifs');
  const motifs = [];
  for (let i = 0; i < MOTIFS_MAX; i += 1) {
    const noeud = element('button', 'bouton-doux parent-motif');
    noeud.type = 'button';
    const picto = icone(null, 'parent-motif-picto');
    const plus = element('span', 'parent-motif-plus chiffres', '+1');
    const libelle = element('span', 'parent-motif-nom');
    [picto, plus, libelle].forEach((enfant) => noeud.appendChild(enfant));
    const motif = { id: null };
    surAppui(noeud, () => actions.point(motif.id));
    grille.appendChild(noeud);
    motifs.push({
      noeud, picto, libelle, motif,
    });
  }
  carte.appendChild(grille);
  const demande = element('div', 'parent-demande');
  demande.appendChild(element('h2', 'intitule', 'Demande'));
  const cadeau = element('p', 'parent-cadeau');
  const pictoCadeau = icone(null, 'parent-cadeau-picto');
  const nomCadeau = element('span', 'parent-cadeau-nom');
  const prixCadeau = element('span', 'parent-cadeau-prix chiffres');
  [pictoCadeau, nomCadeau, prixCadeau].forEach((noeud) => cadeau.appendChild(noeud));
  const boutonsDemande = element('div', 'parent-demande-boutons');
  const valider = bouton('bouton-fort', 'i-check', 'Valider');
  const refuser = bouton('bouton-doux', 'i-close', 'Refuser');
  boutonsDemande.appendChild(valider);
  boutonsDemande.appendChild(refuser);
  [cadeau, boutonsDemande].forEach((noeud) => demande.appendChild(noeud));
  carte.appendChild(demande);
  parent.appendChild(carte);
  const idDemande = { valeur: null };
  surAppui(valider, () => {
    if (idDemande.valeur) actions.echange(idDemande.valeur, 'valider');
  });
  surAppui(refuser, () => {
    if (idDemande.valeur) actions.echange(idDemande.valeur, 'refuser');
  });
  return {
    carte, soldeTexte, retirer, motifs, demande, pictoCadeau, nomCadeau, prixCadeau, valider, idDemande,
  };
}

function construireHistorique(parent) {
  const carte = element('section', 'carte parent-historique');
  carte.appendChild(element('h2', 'intitule', '7 jours'));
  const liste = element('ul', 'parent-jours');
  const jours = [];
  for (let i = 0; i < JOURS; i += 1) {
    const ligne = element('li', 'parent-jour');
    const nom = element('span', 'parent-jour-nom');
    const pastille = element('span', 'parent-pastille');
    const valeur = element('span', 'parent-jour-valeur');
    [nom, pastille, valeur].forEach((noeud) => ligne.appendChild(noeud));
    liste.appendChild(ligne);
    jours.push({
      ligne, nom, pastille, valeur,
    });
  }
  carte.appendChild(liste);
  const attente = element('p', 'parent-historique-attente', 'Lecture…');
  carte.appendChild(attente);
  parent.appendChild(carte);
  return { carte, jours, attente };
}

function rendreEtapes(etapes, vue) {
  etapes.forEach((n, i) => {
    const etape = vue.etapes[i];
    masquer(n.ligne, !etape);
    if (!etape) return;
    n.id.valeur = etape.id;
    changerIcone(n.picto, etape.picto);
    ecrire(n.libelle, etape.libelle);
    changerIcone(n.etat, { a_faire: null, attente: 'i-sablier', valide: 'i-check' }[etape.statut]);
    ETATS.forEach((statut) => n.ligne.classList.toggle(`parent-etape-${statut}`, etape.statut === statut));
    ACTIONS.forEach((action) => masquer(n.parCle[action.cle], etape.actions.indexOf(action.cle) === -1));
  });
}

function rendrePoints(points, vue) {
  masquer(points.carte, vue.points === null);
  if (!vue.points) return;
  ecrire(points.soldeTexte, String(vue.points.solde));
  if (points.retirer.disabled !== !vue.points.retirable) points.retirer.disabled = !vue.points.retirable;
  points.motifs.forEach((n, i) => {
    const motif = vue.points.motifs[i];
    masquer(n.noeud, !motif);
    if (!motif) return;
    n.motif.id = motif.id;
    changerIcone(n.picto, motif.picto);
    ecrire(n.libelle, motif.libelle);
  });
  masquer(points.demande, vue.demande === null);
  points.idDemande.valeur = vue.demande ? vue.demande.id : null;
  if (!vue.demande) return;
  changerIcone(points.pictoCadeau, vue.demande.picto);
  ecrire(points.nomCadeau, vue.demande.libelle);
  ecrire(points.prixCadeau, String(vue.demande.prix));
  points.valider.disabled = !vue.demande.possible;
}

function rendreHistorique(historique, vue) {
  masquer(historique.attente, vue.historique !== null);
  historique.jours.forEach((n, i) => {
    const jour = vue.historique ? vue.historique[i] : null;
    masquer(n.ligne, !jour);
    if (!jour) return;
    ecrire(n.nom, jour.jour);
    ecrire(n.valeur, jour.valeur);
    ['pleine', 'moitie', 'vide'].forEach((etat) => n.pastille.classList.toggle(`parent-pastille-${etat}`, jour.etat === etat));
  });
}

export function creerPageParent(parent, actions) {
  const racine = element('div', 'parent');
  const carteEtapes = element('section', 'carte parent-etapes');
  carteEtapes.appendChild(element('h2', 'intitule', 'Étapes du matin'));
  const liste = element('ul', 'parent-liste');
  const etapes = [];
  for (let i = 0; i < ETAPES_MAX; i += 1) etapes.push(construireEtape(liste, actions));
  carteEtapes.appendChild(liste);
  racine.appendChild(carteEtapes);
  const points = construirePoints(racine, actions);
  const historique = construireHistorique(racine);
  parent.appendChild(racine);

  return {
    racine,
    mettreAJour(vue) {
      racine.classList.toggle('parent-sans-points', vue.points === null);
      rendreEtapes(etapes, vue);
      rendrePoints(points, vue);
      rendreHistorique(historique, vue);
    },
  };
}
