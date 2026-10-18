// tests/agenda-dom.test.js
//
// Rôle    : prouver, sur un faux DOM (tests/faux-dom.js), ce que les calculs sans DOM ne couvrent pas dans l'écran
//           Agenda en grille (web/src/ecrans/agenda.js) : états « pas encore lu » et « aucun agenda relié », blocs
//           posés à leur place (top, hauteur, gauche et largeur, côte à côte quand ils se chevauchent, nombre de lignes)
//           avec la classe de leur personne et l'heure avant le titre, bloc « +N » et ses pastilles, colonne
//           d'aujourd'hui et ligne de l'heure dans la bonne colonne, rangée journée repliée sans barre, boutons de
//           semaine (désactivés hors de la fenêtre lue, et sans effet alors), retour à la semaine en cours en entrant
//           dans l'écran, fiche ouverte par un toucher sur un bloc, un « +N » ou une barre (même un peu à côté d'un
//           bloc), refermée au toucher et en quittant l'écran.
// Entrées : faux DOM ; valeur agenda du flux écrite ici ; horloge monotone de la page remplacée (performance.now) pour
//           passer l'anti-répétition de 300 ms entre deux touchers.
// Sorties : node --test.
// Pièges  : le faux DOM ne propage pas les événements : on touche le nœud qui porte l'écouteur (zone des heures,
//           rangée journée, boutons, couche de la fiche). La zone des heures reçoit un rectangle de 1 520 x 778 px
//           (7 colonnes de 217 px, une ligne de barres) : un px du doigt vaut un px de la grille. De 7 h à 19 h, une
//           minute vaut 778 / 720 px.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { projeterEvenement } from '../serveur/ha/agenda.js';
import {
  appuyer, installerFauxDom, parClasse, poser, texte,
} from './faux-dom.js';

installerFauxDom();
const { creerAgenda } = await import('../web/src/ecrans/agenda.js');

let horloge = 0;
performance.now = () => horloge;
after(() => { delete performance.now; });
const toucher = (noeud, x, y) => {
  horloge += 400;
  appuyer(noeud, x, y);
};

const MERCREDI_7H = Date.parse('2026-10-14T05:00:00Z');
const ev = (debut, fin, titre, personne, lieu) => projeterEvenement({
  start: debut, end: fin, summary: titre, ...(lieu ? { location: lieu } : {}),
}, personne);
const AGENDA = {
  personnes: ['Thomas', 'Agathe'],
  fenetre: { debut: '2026-10-05', fin: '2026-11-02' },
  calendriers: [{ id: 'calendar.domicile', nom: 'Domicile', personne: 'Thomas', etat: 'ok' }, { id: 'calendar.ecole', nom: 'École', personne: 'Agathe', etat: 'erreur' }],
  evenements: [
    ev('2026-10-14', '2026-10-15', 'Sortie scolaire', 'Agathe'),
    ev('2026-10-14T09:30:00+02:00', '2026-10-14T10:30:00+02:00', 'Dentiste', 'Thomas', 'Cabinet du centre'),
    ev('2026-10-14T14:00:00+02:00', '2026-10-14T16:00:00+02:00', 'Atelier poterie', 'Agathe'),
    ev('2026-10-15T10:00:00+02:00', '2026-10-15T11:00:00+02:00', 'Réunion', 'Thomas'),
    ev('2026-10-15T10:30:00+02:00', '2026-10-15T11:30:00+02:00', 'Coiffeur', 'Agathe'),
    ev('2026-10-16T08:30:00+02:00', '2026-10-16T09:30:00+02:00', 'Réunion d\'équipe', 'Thomas'),
    ev('2026-10-16T08:30:00+02:00', '2026-10-16T09:30:00+02:00', 'Orthophoniste', 'Agathe'),
    ev('2026-10-16T08:30:00+02:00', '2026-10-16T09:30:00+02:00', 'Piscine', 'Thomas'),
  ],
};
const visibles = (racine, classe) => parClasse(racine, classe).filter((n) => {
  for (let m = n; m; m = m.parentNode) if (m.hidden) return false;
  return true;
});

function monter() {
  const { conteneur } = installerFauxDom();
  const agenda = creerAgenda(conteneur);
  const un = (classe) => parClasse(conteneur, classe)[0];
  un('agenda-heures').rectangle = {
    left: 0, top: 0, width: 1520, height: 778,
  };
  un('agenda-journee').rectangle = {
    left: 0, top: 0, width: 1520, height: 50,
  };
  const boutons = parClasse(conteneur, 'agenda-navigation')[0].childNodes;
  return {
    conteneur, agenda, un, precedente: boutons[0], cetteSemaine: boutons[1], suivante: boutons[2],
  };
}

test('états : « Agenda pas encore lu » avant le flux, « Aucun agenda relié » sans calendrier ; ni grille ni boutons', () => {
  const { conteneur, agenda, un } = monter();
  assert.deepEqual(visibles(conteneur, 'page-vide-titre').map(texte), ['Agenda pas encore lu']);
  assert.equal(un('agenda-semaine').hidden, true);
  assert.equal(un('agenda-navigation').hidden, true);
  agenda.mettreAJour({
    personnes: [], fenetre: null, calendriers: [], evenements: [],
  }, MERCREDI_7H);
  assert.deepEqual(visibles(conteneur, 'page-vide-titre').map(texte), ['Aucun agenda relié']);
  assert.equal(texte(un('agenda-titre')), 'Agenda');
});

test('grille : blocs à leur place avec la couleur de leur personne, heure puis titre, lignes, barre de la journée, aujourd\'hui en avant, alerte', () => {
  const { conteneur, agenda, un } = monter();
  agenda.mettreAJour(AGENDA, MERCREDI_7H);
  assert.equal(un('agenda-semaine').hidden, false);
  assert.equal(texte(un('agenda-titre')), 'Cette semaine · du 12 au 18 octobre');
  assert.deepEqual(visibles(conteneur, 'agenda-legende-nom').map(texte), ['Thomas', 'Agathe']);
  assert.equal(texte(un('agenda-alerte')), 'École (Agathe) : lecture en échec, dernière version gardée');
  const jours = parClasse(conteneur, 'agenda-jour');
  assert.deepEqual(jours.map((j) => j.classList.contains('agenda-jour-auj')), [false, false, true, false, false, false, false]);
  const colonnes = parClasse(conteneur, 'agenda-colonne');
  assert.equal(colonnes.length, 7);
  const mercredi = visibles(colonnes[2], 'agenda-bloc');
  assert.deepEqual(mercredi.map((b) => [b.className, b.style.top, b.style.height, b.style.left, b.style.width, parClasse(b, 'agenda-bloc-texte')[0].style.webkitLineClamp]), [
    ['agenda-bloc personne-1', '162px', '63px', 'calc(0.0000% + 1px)', 'calc(100.0000% - 2px)', '2'],
    ['agenda-bloc personne-2', '454px', '128px', 'calc(0.0000% + 1px)', 'calc(100.0000% - 2px)', '4'],
  ]);
  assert.deepEqual(visibles(mercredi[0], 'agenda-initiale').map(texte), ['T']);
  assert.equal(texte(mercredi[0]), 'T09:30Dentiste', 'l\'initiale, l\'heure puis le titre');
  assert.equal(mercredi[1].getAttribute('aria-label'), 'Agathe : Atelier poterie, 14:00');
  const jeudi = visibles(colonnes[3], 'agenda-bloc');
  assert.deepEqual(jeudi.map((b) => [texte(b), b.style.left, b.style.width, b.classList.contains('agenda-bloc-etroit')]), [
    ['T10:00Réunion', 'calc(0.0000% + 1px)', 'calc(50.0000% - 2px)', true],
    ['A10:30Coiffeur', 'calc(50.0000% + 1px)', 'calc(50.0000% - 2px)', true],
  ], 'chevauchement : côte à côte, initiale et heure serrées');
  const vendredi = visibles(colonnes[4], 'agenda-bloc');
  assert.deepEqual(vendredi.map((b) => [b.className, b.style.left, b.style.width]), [
    ['agenda-bloc personne-1 agenda-bloc-etroit', 'calc(0.0000% + 1px)', 'calc(50.0000% - 2px)'],
    ['agenda-bloc agenda-bloc-plus agenda-bloc-etroit', 'calc(50.0000% + 1px)', 'calc(50.0000% - 2px)'],
  ], 'trois à la fois : le premier, puis « +2 »');
  assert.deepEqual([visibles(vendredi[1], 'agenda-bloc-titre').map(texte), visibles(vendredi[1], 'agenda-plus-personne').map(texte)], [['+2'], ['A', 'T']]);
  assert.equal(visibles(vendredi[1], 'agenda-bloc-tete').length, 0, 'ni initiale ni heure sur « +N »');
  const barres = visibles(conteneur, 'agenda-barre');
  assert.deepEqual(barres.map((b) => [b.className, b.style.gridColumn, b.style.gridRow, texte(b)]), [['agenda-barre personne-2', '3 / 4', '2', 'ASortie scolaire']]);
  assert.ok(un('agenda-semaine').classList.contains('agenda-journee-lignes-1'));
  assert.equal(un('agenda-journee').hidden, false);
  assert.deepEqual([un('agenda-heures-auj').hidden, un('agenda-heures-auj').style.left], [false, '28.5714%'], 'colonne du mercredi en avant');
  assert.deepEqual([un('agenda-maintenant').hidden, un('agenda-maintenant').style.left, un('agenda-maintenant').style.top], [false, '28.5714%', '0px'], 'ligne de 7:00 dans la colonne du mercredi');
});

test('grille : un bloc d\'une ligne, un bloc « serré » (line-height à sa hauteur), la rangée journée repliée sans barre', () => {
  const { conteneur, agenda, un } = monter();
  agenda.mettreAJour({
    ...AGENDA,
    evenements: [
      ev('2026-10-13T09:00:00+02:00', '2026-10-13T09:30:00+02:00', 'Kiné', 'Agathe'),
      ev('2026-10-13T09:30:00+02:00', '2026-10-13T10:00:00+02:00', 'Appel banque', 'Thomas'),
      ev('2026-10-13T05:00:00+02:00', '2026-10-13T05:15:00+02:00', 'Train', 'Thomas'),
      ev('2026-10-13T22:00:00+02:00', '2026-10-13T22:30:00+02:00', 'Tard', 'Thomas'),
    ],
  }, MERCREDI_7H);
  assert.ok(un('agenda-semaine').classList.contains('agenda-journee-lignes-0'));
  assert.equal(un('agenda-journee').hidden, true);
  const mardi = visibles(parClasse(conteneur, 'agenda-colonne')[1], 'agenda-bloc');
  assert.deepEqual(mardi.map((b) => [texte(b), b.className, b.style.lineHeight]), [
    ['T05:00Train', 'agenda-bloc personne-1 agenda-bloc-une-ligne agenda-bloc-coupe-haut', ''],
    ['A09:00Kiné', 'agenda-bloc personne-2 agenda-bloc-une-ligne', '23px'],
    ['T09:30Appel banque', 'agenda-bloc personne-1 agenda-bloc-une-ligne', ''],
    ['T22:00Tard', 'agenda-bloc personne-1 agenda-bloc-une-ligne', ''],
  ], 'de 7 h à 23 h : le train de 5 h, avant 6 h, collé en haut sans élargir la grille ; le kiné, suivi de l\'appel, raccourci et serré');
});

test('boutons de semaine : suivante jusqu\'à la dernière semaine lue, puis désactivée et sans effet ; « Cette semaine » ramène ; entrer() aussi', () => {
  const { conteneur, agenda, un, precedente, cetteSemaine, suivante } = monter();
  agenda.mettreAJour(AGENDA, MERCREDI_7H);
  assert.deepEqual([precedente.disabled, cetteSemaine.disabled, suivante.disabled], [false, true, false]);
  toucher(suivante);
  assert.equal(texte(un('agenda-titre')), 'Semaine prochaine · du 19 au 25 octobre');
  assert.equal(un('agenda-heures-auj').hidden, true, 'pas d\'aujourd\'hui dans une autre semaine');
  assert.equal(un('agenda-maintenant').hidden, true);
  assert.equal(visibles(conteneur, 'agenda-bloc').length, 0);
  toucher(suivante);
  assert.equal(suivante.disabled, true);
  toucher(suivante);
  assert.equal(texte(un('agenda-titre')), 'Dans 2 semaines · du 26 octobre au 1er novembre', 'rien au-delà de la fenêtre');
  agenda.mettreAJour(AGENDA, MERCREDI_7H + 60000);
  assert.equal(texte(un('agenda-titre')), 'Dans 2 semaines · du 26 octobre au 1er novembre', 'la minute suivante garde la semaine montrée');
  toucher(cetteSemaine);
  assert.equal(texte(un('agenda-titre')), 'Cette semaine · du 12 au 18 octobre');
  toucher(precedente);
  assert.deepEqual([texte(un('agenda-titre')), precedente.disabled], ['Semaine dernière · du 5 au 11 octobre', true]);
  agenda.entrer();
  assert.equal(texte(un('agenda-titre')), 'Cette semaine · du 12 au 18 octobre', 'rouvrir l\'écran montre la semaine en cours');
});

test('fiche : un toucher sur un bloc (ou à 30 px dessous) l\'ouvre, un toucher n\'importe où la referme ; barre de la journée ; quitter la referme', () => {
  const { conteneur, agenda, un } = monter();
  agenda.mettreAJour(AGENDA, MERCREDI_7H);
  const couche = un('agenda-fiche-couche');
  assert.equal(couche.hidden, true);
  const mercredi = 2 * (1520 / 7);
  toucher(un('agenda-heures'), mercredi + 50, 140);
  assert.equal(couche.hidden, false);
  assert.deepEqual(visibles(conteneur, 'agenda-fiche-titre').map(texte), ['Dentiste']);
  assert.deepEqual(visibles(conteneur, 'agenda-fiche-horaire').map(texte), ['Mercredi 14 octobre, de 09:30 à 10:30']);
  assert.deepEqual(visibles(conteneur, 'agenda-fiche-lieu').map(texte), ['Cabinet du centre']);
  assert.deepEqual(visibles(conteneur, 'agenda-fiche-nom').map(texte), ['Thomas']);
  poser(couche);
  assert.equal(couche.hidden, true);
  toucher(un('agenda-heures'), mercredi + 50, 162 + 63 + 30);
  assert.deepEqual([couche.hidden, visibles(conteneur, 'agenda-fiche-titre').map(texte)], [false, ['Dentiste']], 'un bloc de 63 px se touche aussi juste dessous');
  poser(couche);
  toucher(un('agenda-heures'), mercredi + 50, 300);
  assert.equal(couche.hidden, true, 'trop loin de tout bloc : rien');
  const vendredi = 4 * (1520 / 7);
  toucher(un('agenda-heures'), vendredi + 160, 110);
  assert.deepEqual(visibles(conteneur, 'agenda-fiche-titre').map(texte), ['Orthophoniste', 'Piscine'], 'le « +2 » ouvre la fiche en liste');
  poser(couche);
  toucher(un('agenda-journee'), mercredi + 50, 20);
  assert.deepEqual([couche.hidden, visibles(conteneur, 'agenda-fiche-titre').map(texte)], [false, ['Sortie scolaire']]);
  assert.deepEqual(visibles(conteneur, 'agenda-fiche-horaire').map(texte), ['Mercredi 14 octobre, toute la journée']);
  assert.equal(visibles(conteneur, 'agenda-fiche-lieu').length, 0, 'sans lieu, pas de ligne');
  agenda.quitter();
  assert.equal(couche.hidden, true);
});
