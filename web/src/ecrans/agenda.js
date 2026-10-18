// web/src/ecrans/agenda.js
//
// Rôle    : l'écran Agenda, la semaine en grille (décision de Thomas du 14/10 : « un vrai calendrier », comme Google
//           Agenda en vue semaine) : sept colonnes du lundi au dimanche, aujourd'hui en avant, une rangée « journée
//           entière » en haut, puis les heures de haut en bas avec les rendez-vous en blocs de la couleur de leur
//           personne, et la ligne rouge de l'heure actuelle. En-tête : la semaine montrée, la légende des personnes,
//           une alerte si un calendrier manque, et les boutons semaine précédente, « Cette semaine », semaine suivante.
//           Toucher un rendez-vous ouvre sa fiche (titre complet, horaire, lieu, personne), qu'un toucher referme.
// Entrées : le conteneur (#ecran) ; mettreAJour(agenda, ms) avec la valeur agenda du flux et l'heure corrigée ;
//           entrer() et quitter() appelés par le routeur.
// Sorties : creerAgenda(conteneur) -> { racine, mettreAJour(agenda, ms), entrer(), quitter() }.
// Pièges  :
//   - La semaine montrée (decalage) est l'état de l'écran : la vue est recalculée ici (vueAgenda de agenda-donnees.js)
//     à chaque message du flux, à chaque minute et à chaque changement de semaine. entrer() ramène à la semaine en
//     cours (ouvrir l'Agenda par le menu, ou y revenir après le retour à l'Accueil des 60 s, montre toujours
//     aujourd'hui) ; quitter() referme la fiche.
//   - Vue préconstruite : les blocs (par colonne de jour), les barres de la rangée journée et les entrées de la fiche
//     viennent de réserves qui ne font que grandir (une semaine chargée crée ses nœuds une fois, ensuite tout est
//     réutilisé) ; une mise à jour ne change que textes, classes, styles de position et hidden, et seulement ce qui
//     change (dom.js, et la mémoire des styles posés de placer()).
//   - Toucher : UN geste par zone (rangée journée, zone des heures), qui calcule ce qui est visé depuis la position du
//     doigt (blocTouche et caseTouchee de agenda-grille.js) : un bloc plus petit qu'un doigt se touche quand même, à
//     40 px près. Coordonnées rapportées au rectangle de la zone : justes même quand la scène est mise à l'échelle
//     (scene.js). Ouvrir une fiche ou changer de semaine part au lever du doigt (surAppui, garde commune à tout
//     l'écran contre les touches fantômes) ; la fiche se referme au poser du doigt, n'importe où sur l'écran Agenda,
//     et ce toucher ne fait rien d'autre (la couche de la fiche couvre tout l'écran).
//   - La rangée « journée entière » ne prend que ses lignes de barres (0, 1 ou 2 : classe agenda-journee-lignes-N de
//     la carte, masquée sans barre) et la zone des heures grandit d'autant (vue.hauteurHeures, agenda-grille.js).
//   - Un bloc écrit l'heure d'abord, puis le titre (« 13:00 Rendez-vous kiné », comme « La semaine » de l'Accueil),
//     sur le nombre de lignes qui tiennent (une seule : ellipse ; un bloc « serré » prend line-height à sa hauteur) ;
//     « +N » (plus de deux rendez-vous à la fois) montre les pastilles des personnes et ouvre la fiche en liste.
//   - Les boutons hors de la fenêtre lue sont désactivés ([disabled] de base.css) et le geste revérifie la vue :
//     un toucher sur un bouton désactivé ne fait rien.
//   - Lecture seule : rien ne s'écrit dans un calendrier, aucune action vers HA.
//   - États : « Agenda pas encore lu » avant le premier message du serveur, puis « Aucun agenda relié » (une phrase
//     pour la famille, la marche à suivre de Thomas est dans le README, « Agenda »), ou la grille.

import { creerGarde, surAppui } from '../composants/appui.js';
import { creerPastille, majPastille } from '../composants/rendez-vous.js';
import {
  ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';
import { texteAutres } from '../format.js';
import { vueAgenda } from './agenda-donnees.js';
import { blocTouche, caseTouchee } from './agenda-grille.js';

const LEGENDE = 6;
const GRADUATIONS = 24;
const ENTREES_FICHE = 3;
const PERSONNES_PLUS = 4;
const LIGNES_CLASSES = ['agenda-journee-lignes-0', 'agenda-journee-lignes-1', 'agenda-journee-lignes-2'];
const pourcent = (fraction) => `${(fraction * 100).toFixed(4)}%`;

// Pose un style seulement s'il change (le navigateur réécrit certaines valeurs à la relecture : on compare à la
// valeur posée, gardée à côté du nœud).
function placer(n, propriete, valeur) {
  if (n.styles[propriete] === valeur) return;
  n.styles[propriete] = valeur;
  n.racine.style[propriete] = valeur;
}

function noeudPlace(balise, classe) {
  return { racine: element(balise, classe), styles: {} };
}

function bouton(classe, nomIcone, texte, etiquette) {
  const noeud = element('button', classe);
  noeud.type = 'button';
  noeud.appendChild(icone(nomIcone, 'bouton-fort-icone'));
  if (texte) noeud.appendChild(element('span', '', texte));
  if (etiquette) etiqueter(noeud, etiquette);
  return noeud;
}

// Un bloc : l'initiale de la personne et l'heure (insécables, agenda-bloc-tete), puis le titre, au fil du texte dans
// agenda-bloc-texte (agenda.css) ; ou, pour « +N » (plus de deux rendez-vous en même temps), le texte « +N » et les
// pastilles des personnes.
function construireBloc(colonne) {
  const n = noeudPlace('div', 'agenda-bloc');
  n.texte = noeudPlace('div', 'agenda-bloc-texte');
  n.tete = element('span', 'agenda-bloc-tete');
  n.initiale = element('span', 'agenda-initiale');
  n.heure = element('span', 'agenda-bloc-heure');
  n.tete.appendChild(n.initiale);
  n.tete.appendChild(n.heure);
  n.titre = element('span', 'agenda-bloc-titre');
  n.personnes = [];
  for (let i = 0; i < PERSONNES_PLUS; i += 1) n.personnes.push(creerPastille('agenda-plus-personne'));
  [n.tete, n.titre].concat(n.personnes).forEach((noeud) => n.texte.racine.appendChild(noeud));
  n.racine.appendChild(n.texte.racine);
  colonne.appendChild(n.racine);
  return n;
}

function classeBloc(bloc) {
  const classes = ['agenda-bloc', bloc.type === 'plus' ? 'agenda-bloc-plus' : `personne-${bloc.couleur}`];
  if (bloc.lignes === 1) classes.push('agenda-bloc-une-ligne');
  if (bloc.largeur < 1) classes.push('agenda-bloc-etroit');
  if (bloc.coupeHaut) classes.push('agenda-bloc-coupe-haut');
  if (bloc.coupeBas) classes.push('agenda-bloc-coupe-bas');
  return classes.join(' ');
}

function majBloc(n, bloc) {
  const plus = bloc.type === 'plus';
  masquer(n.racine, false);
  const classe = classeBloc(bloc);
  if (n.racine.className !== classe) n.racine.className = classe;
  placer(n, 'top', `${bloc.top}px`);
  placer(n, 'height', `${bloc.hauteur}px`);
  placer(n, 'left', `calc(${pourcent(bloc.gauche)} + 1px)`);
  placer(n, 'width', `calc(${pourcent(bloc.largeur)} - 2px)`);
  placer(n.texte, 'webkitLineClamp', String(bloc.lignes));
  placer(n, 'lineHeight', bloc.serre ? `${bloc.hauteur}px` : '');
  masquer(n.tete, plus);
  if (!plus) {
    ecrire(n.initiale, bloc.initiale);
    ecrire(n.heure, bloc.horaire);
  }
  ecrire(n.titre, plus ? bloc.texte : bloc.titre);
  n.personnes.forEach((pastille, i) => {
    const qui = plus ? bloc.personnes[i] : null;
    masquer(pastille, !qui);
    if (qui) majPastille(pastille, qui);
  });
  etiqueter(n.racine, plus ? `${bloc.texte} : ${bloc.fiche.map((e) => e.titre).join(', ')}` : `${bloc.personne} : ${bloc.titre}, ${bloc.horaire}`);
}

function construireBarre(rangee) {
  const n = noeudPlace('div', 'agenda-barre');
  n.initiale = element('span', 'agenda-initiale');
  n.texte = element('span', '');
  n.racine.appendChild(n.initiale);
  n.racine.appendChild(n.texte);
  rangee.appendChild(n.racine);
  return n;
}

function majBarre(n, c) {
  masquer(n.racine, false);
  const plus = c.type === 'plus';
  const classe = plus ? 'agenda-barre agenda-barre-plus'
    : `agenda-barre personne-${c.couleur}${c.coupeAvant ? ' agenda-barre-coupe-avant' : ''}${c.coupeApres ? ' agenda-barre-coupe-apres' : ''}`;
  if (n.racine.className !== classe) n.racine.className = classe;
  placer(n, 'gridColumn', `${c.debut + 1} / ${c.fin + 1}`);
  placer(n, 'gridRow', String(2 + 2 * c.ligne));
  masquer(n.initiale, plus);
  if (!plus) ecrire(n.initiale, c.initiale);
  ecrire(n.texte, plus ? c.texte : c.titre);
  etiqueter(n.racine, plus ? `${c.texte} : ${c.fiche.map((e) => e.titre).join(', ')}` : `${c.personne} : ${c.titre}`);
}

function construireEntete(racine, naviguer, garde) {
  const entete = element('header', 'page-entete agenda-entete');
  const textes = element('div', 'agenda-entete-textes');
  const titre = element('h2', 'page-titre agenda-titre');
  const ligne = element('div', 'agenda-sous-titre');
  const legende = element('ul', 'agenda-legende');
  const personnes = [];
  for (let i = 0; i < LEGENDE; i += 1) {
    const item = element('li', 'agenda-legende-personne');
    const pastille = creerPastille('agenda-pastille');
    const nom = element('span', 'agenda-legende-nom');
    item.appendChild(pastille);
    item.appendChild(nom);
    legende.appendChild(item);
    personnes.push({ item, pastille, nom });
  }
  const alerte = element('p', 'agenda-alerte');
  ligne.appendChild(legende);
  ligne.appendChild(alerte);
  textes.appendChild(titre);
  textes.appendChild(ligne);
  const navigation = element('div', 'agenda-navigation');
  const precedente = bouton('bouton-doux agenda-fleche', 'i-prev', '', 'Semaine précédente');
  const cetteSemaine = bouton('bouton-fort agenda-cette-semaine', 'i-today', 'Cette semaine');
  const suivante = bouton('bouton-doux agenda-fleche', 'i-next', '', 'Semaine suivante');
  [precedente, cetteSemaine, suivante].forEach((b) => navigation.appendChild(b));
  surAppui(precedente, () => naviguer('precedente'), garde);
  surAppui(cetteSemaine, () => naviguer('cetteSemaine'), garde);
  surAppui(suivante, () => naviguer('suivante'), garde);
  entete.appendChild(textes);
  entete.appendChild(navigation);
  racine.appendChild(entete);

  return {
    mettreAJour(vue) {
      const ok = vue.etat === 'ok';
      ecrire(titre, ok ? vue.titre : 'Agenda');
      masquer(ligne, !ok);
      masquer(navigation, !ok);
      if (!ok) return;
      personnes.forEach((n, i) => {
        const personne = vue.legende[i];
        masquer(n.item, !personne);
        if (!personne) return;
        majPastille(n.pastille, { couleur: personne.couleur, initiale: personne.initiale, personne: personne.nom });
        ecrire(n.nom, personne.nom);
      });
      masquer(alerte, vue.alerte === null);
      ecrire(alerte, vue.alerte || '');
      precedente.disabled = !vue.navigation.precedente;
      cetteSemaine.disabled = !vue.navigation.cetteSemaine;
      suivante.disabled = !vue.navigation.suivante;
    },
  };
}

function construireFiche(racine) {
  const couche = element('div', 'agenda-fiche-couche');
  couche.hidden = true;
  couche.appendChild(element('div', 'agenda-voile'));
  const fiche = element('div', 'carte agenda-fiche');
  fiche.setAttribute('role', 'dialog');
  fiche.appendChild(icone('i-close', 'agenda-fiche-fermer'));
  const entrees = [];
  for (let i = 0; i < ENTREES_FICHE; i += 1) {
    const entree = element('div', 'agenda-fiche-entree');
    const qui = element('p', 'agenda-fiche-qui');
    const pastille = creerPastille('agenda-fiche-pastille');
    const nom = element('span', 'agenda-fiche-nom');
    qui.appendChild(pastille);
    qui.appendChild(nom);
    const titre = element('p', 'agenda-fiche-titre');
    const horaire = element('p', 'agenda-fiche-horaire');
    const lieu = element('p', 'agenda-fiche-lieu');
    lieu.appendChild(icone('i-pin', 'agenda-fiche-lieu-icone'));
    const lieuTexte = element('span', '');
    lieu.appendChild(lieuTexte);
    [qui, titre, horaire, lieu].forEach((noeud) => entree.appendChild(noeud));
    fiche.appendChild(entree);
    entrees.push({
      entree, pastille, nom, titre, horaire, lieu, lieuTexte,
    });
  }
  const plus = element('p', 'agenda-fiche-plus');
  fiche.appendChild(plus);
  couche.appendChild(fiche);
  racine.appendChild(couche);
  couche.addEventListener('pointerdown', () => masquer(couche, true));

  return {
    ouvrir(contenu) {
      entrees.forEach((n, i) => {
        const e = contenu[i];
        masquer(n.entree, !e);
        if (!e) return;
        majPastille(n.pastille, e);
        ecrire(n.nom, e.personne);
        ecrire(n.titre, e.titre);
        ecrire(n.horaire, e.horaire);
        masquer(n.lieu, e.lieu === null);
        ecrire(n.lieuTexte, e.lieu || '');
      });
      const reste = contenu.length - ENTREES_FICHE;
      masquer(plus, reste <= 0);
      ecrire(plus, texteAutres(reste));
      masquer(couche, false);
    },
    fermer: () => masquer(couche, true),
  };
}

export function creerAgenda(conteneur) {
  const racine = element('section', 'ecran-page agenda');
  const garde = creerGarde();
  let decalage = 0;
  let vue = { etat: 'attente' };
  let donnees = null;

  function rendre() {
    if (donnees === null) return;
    vue = vueAgenda(donnees.agenda, donnees.ms, decalage);
    if (vue.etat === 'ok') decalage = vue.decalage;
    dessiner();
  }

  function naviguer(sens) {
    if (vue.etat !== 'ok' || !vue.navigation[sens]) return;
    decalage = { precedente: decalage - 1, suivante: decalage + 1, cetteSemaine: 0 }[sens];
    rendre();
  }

  const entete = construireEntete(racine, naviguer, garde);

  const message = element('div', 'page-vide');
  const messageTitre = element('p', 'page-vide-titre');
  const messageTexte = element('p', 'page-vide-texte');
  message.appendChild(messageTitre);
  message.appendChild(messageTexte);
  racine.appendChild(message);

  const semaine = element('div', 'carte agenda-semaine');
  semaine.appendChild(element('div', 'agenda-coin'));
  const jours = element('div', 'agenda-jours');
  const enTetes = [];
  for (let i = 0; i < 7; i += 1) {
    const jour = element('div', 'agenda-jour');
    const nom = element('span', 'agenda-jour-nom');
    const numero = element('span', 'agenda-jour-numero');
    jour.appendChild(nom);
    jour.appendChild(numero);
    jours.appendChild(jour);
    enTetes.push({ jour, nom, numero });
  }
  semaine.appendChild(jours);
  semaine.appendChild(element('div', 'agenda-coin'));
  const journee = element('div', 'agenda-journee');
  const fondsJournee = [];
  for (let i = 0; i < 7; i += 1) {
    const fond = element('div', 'agenda-fond-jour');
    fond.style.gridColumn = String(i + 1);
    journee.appendChild(fond);
    fondsJournee.push(fond);
  }
  const barres = [];
  semaine.appendChild(journee);
  const graduation = element('div', 'agenda-graduation');
  const heures = element('div', 'agenda-heures');
  const fondAujourdhui = noeudPlace('div', 'agenda-heures-auj');
  heures.appendChild(fondAujourdhui.racine);
  const lignes = element('div', 'agenda-lignes');
  heures.appendChild(lignes);
  const graduations = [];
  for (let i = 0; i < GRADUATIONS; i += 1) {
    const texte = noeudPlace('span', 'agenda-graduation-heure');
    const trait = noeudPlace('span', 'agenda-ligne-heure');
    graduation.appendChild(texte.racine);
    lignes.appendChild(trait.racine);
    graduations.push({ texte, trait });
  }
  const colonnes = [];
  for (let i = 0; i < 7; i += 1) {
    const colonne = element('div', 'agenda-colonne');
    heures.appendChild(colonne);
    colonnes.push({ colonne, blocs: [] });
  }
  const maintenant = noeudPlace('div', 'agenda-maintenant');
  heures.appendChild(maintenant.racine);
  semaine.appendChild(graduation);
  semaine.appendChild(heures);
  racine.appendChild(semaine);
  const fiche = construireFiche(racine);
  conteneur.appendChild(racine);

  // Position du doigt dans une zone de la grille : colonne du jour, place dans sa largeur (fraction), fraction de la
  // hauteur. Le doigt levé peut avoir glissé de quelques px hors de la zone (appui.js) : la colonne reste dans 0..6, la
  // ligne de la rangée journée dans 0..1.
  function viser(zone, e) {
    const r = zone.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 7;
    const jour = Math.min(6, Math.max(0, Math.floor(x)));
    return { jour, x: x - jour, y: (e.clientY - r.top) / r.height };
  }
  surAppui(heures, (e) => {
    if (vue.etat !== 'ok') return;
    const p = viser(heures, e);
    const bloc = blocTouche(vue.blocs, p.jour, p.x, p.y * vue.hauteurHeures);
    if (bloc) fiche.ouvrir(bloc.fiche);
  }, garde);
  surAppui(journee, (e) => {
    if (vue.etat !== 'ok' || vue.lignesJournee === 0) return;
    const p = viser(journee, e);
    const ligne = Math.min(vue.lignesJournee - 1, Math.max(0, Math.floor(p.y * vue.lignesJournee)));
    const visee = caseTouchee(vue.journee, p.jour, ligne);
    if (visee) fiche.ouvrir(visee.fiche);
  }, garde);

  function dessinerHeures() {
    graduations.forEach((g, i) => {
      const graduationVue = vue.graduations[i];
      masquer(g.texte.racine, !graduationVue);
      masquer(g.trait.racine, !graduationVue);
      if (!graduationVue) return;
      ecrire(g.texte.racine, graduationVue.texte);
      placer(g.texte, 'top', `${graduationVue.top}px`);
      placer(g.trait, 'top', `${graduationVue.top}px`);
    });
    masquer(fondAujourdhui.racine, vue.aujourdhui < 0);
    if (vue.aujourdhui >= 0) placer(fondAujourdhui, 'left', pourcent(vue.aujourdhui / 7));
    colonnes.forEach((c, jour) => {
      const blocsDuJour = vue.blocs.filter((b) => b.jour === jour);
      while (c.blocs.length < blocsDuJour.length) c.blocs.push(construireBloc(c.colonne));
      c.blocs.forEach((n, i) => {
        if (blocsDuJour[i]) majBloc(n, blocsDuJour[i]);
        else masquer(n.racine, true);
      });
    });
    masquer(maintenant.racine, vue.maintenant === null);
    if (vue.maintenant === null) return;
    placer(maintenant, 'left', pourcent(vue.maintenant.jour / 7));
    placer(maintenant, 'top', `${vue.maintenant.top}px`);
  }

  function dessiner() {
    const ok = vue.etat === 'ok';
    entete.mettreAJour(vue);
    masquer(message, ok);
    masquer(semaine, !ok);
    if (vue.etat === 'attente') {
      ecrire(messageTitre, 'Agenda pas encore lu');
      ecrire(messageTexte, 'Les rendez-vous arrivent dès que la maison répond.');
    } else if (vue.etat === 'vide') {
      ecrire(messageTitre, 'Aucun agenda relié');
      ecrire(messageTexte, 'Les calendriers de la famille ne sont pas encore reliés au cadre (AGENDA_CALENDRIERS sur le serveur).');
    }
    if (!ok) return;
    LIGNES_CLASSES.forEach((nom, lignes) => semaine.classList.toggle(nom, vue.lignesJournee === lignes));
    masquer(journee, vue.lignesJournee === 0);
    enTetes.forEach((n, i) => {
      const jour = vue.jours[i];
      n.jour.classList.toggle('agenda-jour-auj', jour.aujourdhui);
      ecrire(n.nom, jour.nom);
      ecrire(n.numero, jour.numero);
      fondsJournee[i].classList.toggle('agenda-fond-auj', jour.aujourdhui);
    });
    while (barres.length < vue.journee.length) barres.push(construireBarre(journee));
    barres.forEach((n, i) => {
      if (vue.journee[i]) majBarre(n, vue.journee[i]);
      else masquer(n.racine, true);
    });
    dessinerHeures();
  }

  dessiner();

  return {
    racine,
    mettreAJour(agenda, ms) {
      donnees = { agenda, ms };
      rendre();
    },
    entrer() {
      decalage = 0;
      fiche.fermer();
      rendre();
    },
    quitter: () => fiche.fermer(),
  };
}
