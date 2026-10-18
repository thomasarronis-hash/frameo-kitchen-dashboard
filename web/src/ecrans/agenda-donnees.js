// web/src/ecrans/agenda-donnees.js
//
// Rôle    : calculer, sans DOM, ce que la page montre de l'agenda familial (serveur/ha/agenda.js) : l'écran Agenda (la
//           semaine en grille, décision de Thomas du 14/10 : sept colonnes du lundi au dimanche, heures de haut en
//           bas, rendez-vous en blocs colorés par personne), et les rendez-vous d'un jour pour la colonne « La semaine »
//           de l'Accueil et pour la page Aujourd'hui.
// Entrées : agenda, la valeur du flux { personnes, fenetre: { debut, fin }, calendriers: [{ id, nom, personne, etat }],
//           evenements: [{ personne, titre, debut, fin, journee, lieu }] } ou null ; ms (heure corrigée par le
//           serveur) ; une date « 2026-10-14 » ; decalage, la semaine voulue par rapport à celle d'aujourd'hui.
// Sorties : personnesDe(agenda) -> [{ nom, couleur, initiale }] (couleur de 1 à 4, dans l'ordre des personnes) ;
//           evenementsDuJour(agenda, date, ms) -> rendez-vous de ce jour, rangés : { horaire, court, titre, lieu,
//           couleur, initiale, personne } (horaire : « 09:30 », « Journée », ou « fin 00:30 » pour un rendez-vous
//           commencé la veille ; court : « 09:30 Dentiste », ou le titre seul s'il dure la journée ou a commencé la
//           veille) ;
//           ligneDeRendezVous(evenements, max, caracteres) -> { evenements: [{ texte, couleur, initiale, personne }],
//           plus } : ce qui tient sur une ligne de texte (colonne « La semaine »), le reste compté dans plus ;
//           parPersonne(evenements) -> [[rendez-vous de la 1re personne du jour], [de la 2e]...] dans l'ordre de leur
//           premier rendez-vous (« La semaine » : une ligne par personne un jour sans repas) ;
//           vueAgenda(agenda, ms, decalage) -> { etat } : « attente » (rien reçu) ou « vide » (aucun calendrier
//           configuré) ; ou, etat « ok » : { decalage (celui montré, ramené dans la fenêtre lue), titre (« Cette
//           semaine · du 12 au 18 octobre »), legende [{ nom, couleur, initiale }], alerte (calendriers absents de HA
//           ou en échec, en clair, ou null), navigation { precedente, suivante, cetteSemaine }, jours [{ nom: 'Lun',
//           numero: '12', aujourdhui }] (7), aujourdhui (colonne d'aujourd'hui, -1 hors de la semaine en cours),
//           graduations [{ texte: '7 h', top }], lignesJournee (0, 1 ou 2 lignes de barres), hauteurHeures (px de
//           la zone des heures, qui en dépend), journee (cases de la rangée journée entière, agenda-grille.js), blocs
//           (rendez-vous à l'heure placés, agenda-grille.js, chacun avec jour, titre, horaire, couleur, initiale,
//           personne et fiche ; ou « +N » quand plus de deux se chevauchent), maintenant ({ jour, top } de la ligne de
//           l'heure, ou null) }. Chaque bloc, barre et « +N » porte sa fiche : [{ titre, horaire (« Mercredi 14
//           octobre, de 09:30 à 10:00 »), lieu, personne, couleur, initiale }].
// Pièges  :
//   - Journée entière : debut et fin sont des dates, la fin EXCLUE (un événement du 14 finit le 15). Sinon des
//     heures avec décalage (« 2026-10-14T09:30:00+02:00 ») : jour et heure recalculés à l'heure de Paris
//     (heure.js), jamais lus dans le texte. Un rendez-vous qui finit à minuit pile ne déborde pas sur le lendemain.
//   - evenementsDuJour écarte un rendez-vous à l'heure déjà fini (le serveur garde toute la fenêtre lue, semaine
//     passée comprise, pour la grille). Un événement sur la journée reste affiché toute la journée. Rangement dans un
//     jour : journée entière (ou commencé la veille) d'abord, puis par heure de début, puis par titre.
//   - Couleur et initiale par PERSONNE (décision de Thomas du 13/10 : un seul agenda, une couleur par personne) :
//     rang du prénom dans agenda.personnes, 4 couleurs puis on recommence (--personne-1 à 4 de jetons.css).
//     L'initiale est la première lettre du prénom, ou les deux premières si deux prénoms commencent par la même.
//   - Ligne de rendez-vous au fil du texte (ligneDeRendezVous) : le PREMIER rendez-vous de CHAQUE personne du jour est
//     toujours montré (au plus max) : un rendez-vous d'Agathe à 8h ne fait plus disparaître ceux de Thomas de l'Accueil
//     (la demande : voir ceux des deux). Chacun a alors sa part de la ligne et sa propre ellipse (rendez-vous.css), sa
//     pastille restant visible. Les autres rendez-vous ne s'ajoutent que s'ils tiennent EN ENTIER dans le nombre de
//     caractères de la ligne (une pastille compte pour 3 caractères, « · » pour 2), dans l'ordre, jusqu'au premier
//     qui ne tient pas ; « +N » compte le reste. Le nombre de caractères de chaque ligne est mesuré sur capture par
//     l'écran qui l'emploie (accueil-donnees.js).
//   - Grille (vueAgenda) : la semaine du lundi au dimanche, à l'heure de Paris, y compris ce qui est déjà passé.
//     Un rendez-vous à l'heure de moins de 24 h va dans la grille, coupé en deux s'il passe minuit (le second morceau
//     dit « fin 00:30 ») ; une journée entière, ou un rendez-vous à l'heure de 24 h ou plus, va dans la rangée du haut,
//     en barre sur tous ses jours (coupée au bord de la semaine). La place à l'heure suit l'heure de l'horloge
//     (partiesParis) et non la durée écoulée : le 25/10, un rendez-vous de 01:30 à 03:30 couvre deux heures de grille
//     bien qu'il en dure trois, comme sur un agenda papier.
//   - Navigation : seules les semaines de la fenêtre lue par le serveur s'ouvrent (la précédente et les deux suivantes
//     d'habitude ; au passage du lundi, en attendant la relecture du serveur, la fenêtre de la veille donne deux
//     semaines en arrière et une en avant). Un decalage hors de la fenêtre est ramené à son bord.
//   - Ligne de l'heure actuelle : seulement dans la semaine en cours et dans la plage affichée.

import { ESP, majuscule } from '../format.js';
import {
  ajouterJours, dateParis, ecartJours, jourAbrege, lundiDe, partiesParis, texteHeure, texteJourIso, texteJourMois,
} from '../heure.js';
import {
  hauteurHeures, lignesJournee, placerBlocs, placerJournees, plageHoraire,
} from './agenda-grille.js';

const COULEURS = 4;
const MINUTES_JOUR = 1440;
const JOUR_MS = 86400000;
const PASTILLE_CARACTERES = 3;
const SEPARATEUR_CARACTERES = 2;
const NOTES = { absent: 'introuvable dans Home Assistant', erreur: 'lecture en échec, dernière version gardée' };

const lettres = (texte) => Array.from(texte);

function initiale(nom, tous) {
  const premiere = lettres(nom)[0].toUpperCase();
  const partagee = tous.some((autre) => autre !== nom && lettres(autre)[0].toUpperCase() === premiere);
  return partagee && lettres(nom).length > 1 ? premiere + lettres(nom)[1].toLowerCase() : premiere;
}

export function personnesDe(agenda) {
  const noms = agenda ? agenda.personnes : [];
  return noms.map((nom, rang) => ({ nom, couleur: (rang % COULEURS) + 1, initiale: initiale(nom, noms) }));
}

// Bornes d'un événement : dates de Paris couvertes [premier, dernier] et instants (ms) pour les événements à l'heure.
function bornes(evenement) {
  if (evenement.journee) return { premier: evenement.debut, dernier: ajouterJours(evenement.fin, -1) };
  const debutMs = Date.parse(evenement.debut);
  const finMs = Date.parse(evenement.fin);
  return {
    premier: dateParis(debutMs), dernier: dateParis(Math.max(debutMs, finMs - 1)), debutMs, finMs,
  };
}

function horaireDuJour(evenement, b, date) {
  if (evenement.journee) return 'Journée';
  if (b.premier === date) return texteHeure(b.debutMs);
  return b.dernier === date ? `fin ${texteHeure(b.finMs)}` : 'Journée';
}

function personneDe(evenement, personnes) {
  return personnes.filter((p) => p.nom === evenement.personne)[0]
    || { nom: evenement.personne, couleur: 1, initiale: initiale(evenement.personne, []) };
}

export function evenementsDuJour(agenda, date, ms) {
  if (!agenda) return [];
  const personnes = personnesDe(agenda);
  return agenda.evenements
    .map((evenement) => ({ evenement, b: bornes(evenement) }))
    .filter(({ evenement, b }) => b.premier <= date && date <= b.dernier && (evenement.journee || b.finMs > ms))
    .sort((x, y) => {
      const rangX = x.evenement.journee || x.b.premier < date ? 0 : 1;
      const rangY = y.evenement.journee || y.b.premier < date ? 0 : 1;
      if (rangX !== rangY) return rangX - rangY;
      if (rangX === 1 && x.b.debutMs !== y.b.debutMs) return x.b.debutMs - y.b.debutMs;
      return x.evenement.titre < y.evenement.titre ? -1 : Number(x.evenement.titre > y.evenement.titre);
    })
    .map(({ evenement, b }) => {
      const horaire = horaireDuJour(evenement, b, date);
      const aLHeure = !evenement.journee && b.premier === date;
      const personne = personneDe(evenement, personnes);
      return {
        horaire,
        court: aLHeure ? `${horaire} ${evenement.titre}` : evenement.titre,
        titre: evenement.titre,
        lieu: evenement.lieu,
        couleur: personne.couleur,
        initiale: personne.initiale,
        personne: personne.nom,
      };
    });
}

export function parPersonne(evenements) {
  const groupes = [];
  const rangs = {};
  evenements.forEach((e) => {
    if (rangs[e.personne] === undefined) {
      rangs[e.personne] = groupes.length;
      groupes.push([]);
    }
    groupes[rangs[e.personne]].push(e);
  });
  return groupes;
}

export function ligneDeRendezVous(evenements, max, caracteres) {
  const cout = (e, rang) => e.court.length + PASTILLE_CARACTERES + (rang > 0 ? SEPARATEUR_CARACTERES : 0);
  const choisis = parPersonne(evenements).slice(0, max).map((groupe) => evenements.indexOf(groupe[0]));
  let longueur = choisis.reduce((somme, i, rang) => somme + cout(evenements[i], rang), 0);
  for (let i = 0; i < evenements.length && choisis.length < max; i += 1) {
    if (choisis.indexOf(i) === -1) {
      const cette = cout(evenements[i], choisis.length);
      if (longueur + cette > caracteres) break;
      choisis.push(i);
      longueur += cette;
    }
  }
  return {
    evenements: choisis.sort((a, b) => a - b).map((i) => evenements[i]).map((e) => ({
      texte: e.court, couleur: e.couleur, initiale: e.initiale, personne: e.personne,
    })),
    plus: evenements.length - choisis.length,
  };
}

function alerteCalendriers(calendriers) {
  const textes = calendriers
    .filter((c) => NOTES[c.etat])
    .map((c) => `${c.nom} (${c.personne})${ESP}: ${NOTES[c.etat]}`);
  return textes.length > 0 ? textes.join(' · ') : null;
}

const minutesParis = (ms) => {
  const p = partiesParis(ms);
  return p.heure * 60 + p.minute;
};

// Horaire complet de la fiche : « Mercredi 14 octobre, de 09:30 à 10:00 », « Du samedi 17 octobre au lundi 19
// octobre »...
function texteHoraire(evenement, b) {
  if (evenement.journee) {
    if (b.premier === b.dernier) return `${majuscule(texteJourIso(b.premier))}, toute la journée`;
    return `Du ${texteJourIso(b.premier)} au ${texteJourIso(b.dernier)}`;
  }
  const debut = texteHeure(b.debutMs);
  const fin = texteHeure(b.finMs);
  if (b.premier === b.dernier) return `${majuscule(texteJourIso(b.premier))}, ${debut === fin ? `à ${debut}` : `de ${debut} à ${fin}`}`;
  return `Du ${texteJourIso(b.premier)} à ${debut} au ${texteJourIso(dateParis(b.finMs))} à ${fin}`;
}

// Les événements de la semaine qui commence le lundi donné : segments à l'heure (un par jour couvert) et barres de la
// rangée journée entière.
function repartir(evenements, lundi, personnes) {
  const segments = [];
  const barres = [];
  evenements.forEach((evenement) => {
    const b = bornes(evenement);
    const qui = personneDe(evenement, personnes);
    const contenu = {
      titre: evenement.titre,
      couleur: qui.couleur,
      initiale: qui.initiale,
      personne: qui.nom,
      fiche: [{
        titre: evenement.titre, horaire: texteHoraire(evenement, b), lieu: evenement.lieu, personne: qui.nom, couleur: qui.couleur, initiale: qui.initiale,
      }],
    };
    const premier = ecartJours(lundi, b.premier);
    const dernier = ecartJours(lundi, b.dernier);
    if (dernier < 0 || premier > 6) return;
    if (evenement.journee || b.finMs - b.debutMs >= JOUR_MS) {
      barres.push(Object.assign({
        debut: Math.max(0, premier), fin: Math.min(7, dernier + 1), coupeAvant: premier < 0, coupeApres: dernier > 6,
      }, contenu));
      return;
    }
    for (let jour = Math.max(0, premier); jour <= Math.min(6, dernier); jour += 1) {
      const date = ajouterJours(lundi, jour);
      segments.push(Object.assign({
        jour,
        debut: date === b.premier ? minutesParis(b.debutMs) : 0,
        fin: date === dateParis(b.finMs) ? minutesParis(b.finMs) : MINUTES_JOUR,
        horaire: date === b.premier ? texteHeure(b.debutMs) : `fin ${texteHeure(b.finMs)}`,
      }, contenu));
    }
  });
  return { segments, barres };
}

// Semaines ouvertes à la navigation, en décalages par rapport à la semaine d'aujourd'hui : celles de la fenêtre lue.
function bornesNavigation(fenetre, lundi) {
  return {
    min: Math.min(0, -Math.floor(ecartJours(fenetre.debut, lundi) / 7)),
    max: Math.max(0, Math.floor(ecartJours(lundi, fenetre.fin) / 7) - 1),
  };
}

function relatif(decalage) {
  if (decalage === 0) return 'Cette semaine';
  if (decalage === 1) return 'Semaine prochaine';
  if (decalage === -1) return 'Semaine dernière';
  return decalage > 0 ? `Dans ${decalage} semaines` : `Il y a ${-decalage} semaines`;
}

// « du 12 au 18 octobre », « du 28 septembre au 4 octobre », « du 26 octobre au 1er novembre ».
function texteSemaine(lundi) {
  const dimanche = ajouterJours(lundi, 6);
  const debut = lundi.slice(0, 7) === dimanche.slice(0, 7) ? texteJourMois(lundi).split(' ')[0] : texteJourMois(lundi);
  return `du ${debut} au ${texteJourMois(dimanche)}`;
}

export function vueAgenda(agenda, ms, decalageVoulu) {
  if (!agenda) return { etat: 'attente' };
  if (agenda.calendriers.length === 0) return { etat: 'vide' };
  const aujourdhui = dateParis(ms);
  const lundiActuel = lundiDe(aujourdhui);
  const bornesSemaines = bornesNavigation(agenda.fenetre, lundiActuel);
  const decalage = Math.min(bornesSemaines.max, Math.max(bornesSemaines.min, decalageVoulu));
  const lundi = ajouterJours(lundiActuel, 7 * decalage);
  const personnes = personnesDe(agenda);
  const { segments, barres } = repartir(agenda.evenements, lundi, personnes);
  const journee = placerJournees(barres);
  const lignes = lignesJournee(journee);
  const hauteur = hauteurHeures(lignes);
  const plage = plageHoraire(segments);
  const pxMinute = hauteur / ((plage.fin - plage.debut) * 60);
  const colonneAujourdhui = decalage === 0 ? ecartJours(lundi, aujourdhui) : -1;
  const jours = [];
  let blocs = [];
  for (let jour = 0; jour < 7; jour += 1) {
    const date = ajouterJours(lundi, jour);
    jours.push({ nom: jourAbrege(date), numero: String(Number(date.slice(8))), aujourdhui: jour === colonneAujourdhui });
    blocs = blocs.concat(placerBlocs(segments.filter((s) => s.jour === jour), plage, hauteur));
  }
  const graduations = [];
  for (let heure = plage.debut; heure < plage.fin; heure += 1) {
    graduations.push({ texte: `${heure}${ESP}h`, top: Math.round((heure - plage.debut) * 60 * pxMinute) });
  }
  const minutes = minutesParis(ms);
  const dansPlage = minutes >= plage.debut * 60 && minutes <= plage.fin * 60;
  return {
    etat: 'ok',
    decalage,
    titre: `${relatif(decalage)} · ${texteSemaine(lundi)}`,
    legende: personnes,
    alerte: alerteCalendriers(agenda.calendriers),
    navigation: { precedente: decalage > bornesSemaines.min, suivante: decalage < bornesSemaines.max, cetteSemaine: decalage !== 0 },
    jours,
    aujourdhui: colonneAujourdhui,
    graduations,
    lignesJournee: lignes,
    hauteurHeures: hauteur,
    journee,
    blocs,
    maintenant: colonneAujourdhui >= 0 && dansPlage
      ? { jour: colonneAujourdhui, top: Math.round((minutes - plage.debut * 60) * pxMinute) } : null,
  };
}
