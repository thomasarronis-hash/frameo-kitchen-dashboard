// web/src/ecrans/accueil-donnees.js
//
// Rôle    : calculer, sans DOM, tout ce que l'écran Accueil affiche, à partir de l'état reçu du serveur et
//           de l'heure corrigée : textes prêts à écrire, pictogrammes, cartes à montrer ou non.
// Entrées : donnees (etat.js : entites, meteo, courses, air, pluie, semaine, menu, agenda, tempo, enfants), ms (heure corrigée par
//           le serveur).
// Sorties : vueAccueil(donnees, ms) -> { heure, date, meteo, repas, courses, air, semaine, alarme, tempo, ficheTempo, enfants } ;
//           chaque morceau aussi, pour les tests : pluieDansLHeure, vueMeteo, vueCourses, vueAir, vueSemaine,
//           alarmeAccueil ;
//           meteo.pluie : « 0,6 mm dans l'heure » (écrit après une goutte), ou null (heure sèche ou inconnue) ;
//           air : { libelle, classe, indice: « indice 29 », pollen: « Graminées · élevé », « Pas de pollen » ou null } ;
//           repas est le bloc « Ce soir » / « Ce midi » (repasAffiche de repas-donnees.js) ;
//           alarme est le gros bouton Alarme : { libelle, alerte, ouvertures, ouverturesAlerte } (ouvertures : « tout
//           fermé », « 2 ouvertures » ; ouverturesAlerte vrai s'il y en a une d'ouverte), ou null tant que l'alarme
//           n'est pas lue ;
//           chaque jour de la semaine porte ses lignes de repas (repas) et ses lignes d'agenda (agenda : [{
//           evenements: [{ texte, couleur, initiale, personne }], plus }], couleur et initiale de la personne,
//           agenda-donnees.js), et sa pastille Tempo (tempo : pastilleDuJour de tempo.js, pour aujourd'hui et demain
//           seulement, null sinon) ; tempo est la case de la barre du bas la veille d'un jour rouge ou blanc
//           (caseTempo, ou null), ficheTempo le contenu de la fiche qu'ouvrent la pastille et la case ; enfants est la
//           case du matin des enfants (caseAccueil d'enfants-donnees.js : de 5 h à fin_routine (9 h) les deux visages, ou null). L'encart
//           « Aujourd'hui » est calculé à part (aujourdhui-donnees.js).
// Pièges  :
//   - Aucune donnée inventée : une valeur absente donne null (rien d'affiché) ou un état vide explicite.
//   - Heures d'Open-Meteo en heure locale de Paris sans décalage (« 2026-10-11T14:15 ») : comparées en
//     texte à heureLocaleParis(ms), même format, donc ordre du texte = ordre du temps.
//   - Pluie au pas de 15 min : chaque valeur est le cumul des 15 minutes qui PRÉCÈDENT son heure
//     [S, doc Open-Meteo]. « Dans l'heure » = les pas dont l'heure tombe dans les 60 minutes qui viennent. Rien n'est
//     écrit quand l'heure est sèche (14/10 : un détail n'apparaît que s'il sert ; l'écran Météo dit « Pas de pluie »).
//   - Indice européen de l'air (EAQI) : seuils de l'Agence européenne de l'environnement (repris par la doc
//     Open-Meteo), libellés d'Atmo France : < 20 bon, < 40 moyen, < 60 dégradé, < 80 mauvais, < 100 très
//     mauvais, au-delà extrêmement mauvais.
//   - Pollens : maximum du jour de Paris calculé par le serveur. La carte donne le taxon dominant avec son niveau
//     (« Graminées · élevé », le plus fort niveau, puis la plus forte concentration : pollensDuJour de air.js, la même
//     règle et les mêmes mots que l'écran Météo, sans concentration en grains/m³ qui ne parle à personne) ; « Pas de
//     pollen » sous le niveau faible ; rien sans donnée.
//   - Plus de carte « À faire » (décision de Thomas du 14/10) : encre et piles faibles étaient déjà dans les alertes de
//     la page Aujourd'hui, comme les rappels nouveaux (draps, Tempo).
//   - Tempo (choix de Thomas du 14/10) : pastille à côté d'aujourd'hui et de demain dans « La semaine » (la couleur du
//     jour de la ligne, « ? » gris si inconnue, pointillés si pré-annoncée), case « Demain rouge » (ou blanc, plus
//     discrète) dans la barre du bas dès la pré-annonce, « Heures creuses, les machines ! » à partir de 22 h ;
//     seulement du 1er novembre au 31 mars (décision de Thomas du 14/10 : hors période, rien de Tempo sur l'Accueil) ;
//     règles dans tempo.js.
//   - Enfants (choix de Thomas du 14/10, partie 4) : le matin, de 5 h à fin_routine (9 h), la case des deux visages (étoile dorée
//     quand la routine de l'un est finie, aucun chiffre) prend dans la barre du bas la place de Wi-Fi invités, et passe
//     avant la case Tempo (qui revient à la fin de la routine, 9 h : les machines se lancent le soir, l'alerte de la page Aujourd'hui dit
//     déjà « Demain rouge » le matin).
//   - Alarme : état en français et résumé des ouvertures, de maison-donnees.js (lecture seule ; le bouton ouvre la
//     vue Alarme de l'écran Maison).
//   - La semaine écarte un jour déjà passé (de minuit à la relecture horaire du serveur). Son pictogramme
//     vient de code_ciel, le ciel des heures de jour calculé par le serveur (sources/open-meteo.js), et non
//     du code quotidien d'Open-Meteo (la pire heure des 24). Ses repas : le soir, plus le midi le week-end
//     (lignesSemaine) ; rien pour un jour hors du menu publié.
//   - La semaine, agenda : chaque jour garde DEUX lignes de texte au plus sous sa météo, pour que les 7 lignes
//     restent égales et que la colonne ne déborde jamais. Sans événement, les repas comme avant. Avec des
//     événements : s'il y a des repas, UNE ligne de repas (le soir s'il y a midi et soir ; le midi d'un jour de
//     week-end avant 14h est déjà en grand dans « Ce midi ») et UNE ligne d'agenda (« +N » pour le reste) ; sans
//     repas, deux lignes d'agenda : une par personne s'il y en a plusieurs ce jour-là (la première, puis toutes les
//     autres), sinon un rendez-vous chacune (« +N » sur la seconde). Le premier rendez-vous de chaque personne est
//     toujours sur la ligne (agenda-donnees.js : chacun sa part et son ellipse), jamais caché par celui d'une autre ;
//     un autre rendez-vous n'y entre que s'il tient en entier : 34 caractères par ligne de 26 px (12,3 px par
//     caractère en moyenne, pastille de 28 px, « +N » réservé, mesuré sur capture du 13/10). Chaque rendez-vous
//     porte la pastille de sa personne (couleur et initiale), jamais la couleur seule.
//   - Mise en forme des nombres (espace insécable, trait d'union pour le signe moins) : format.js.

import { niveauAir, PAS_DE_POLLEN, pollensDuJour } from '../air.js';
import { cielHA, cielWmo } from '../ciel.js';
import {
  ESP, estNombre, nombreFr, temperature,
} from '../format.js';
import {
  ajouterJours, dateParis, heureLocaleParis, jourAbrege, texteDate, texteHeure,
} from '../heure.js';
import {
  caseTempo, ficheTempo, pastilleDuJour, tempoSurAccueil, vueTempo,
} from '../tempo.js';
import { evenementsDuJour, ligneDeRendezVous, parPersonne } from './agenda-donnees.js';
import { caseAccueil } from './enfants-donnees.js';
import { etatAlarme, vueOuvertures } from './maison-donnees.js';
import { lignesSemaine, repasAffiche } from './repas-donnees.js';

const HEURE_MS = 3600000;
const ARTICLES_MAX = 4;
const JOURS_SEMAINE = 7;
const RENDEZ_VOUS_PAR_LIGNE = 2;
const CARACTERES_LIGNE_SEMAINE = 34;

export function pluieDansLHeure(pluie, ms) {
  if (!pluie) return null;
  const debut = heureLocaleParis(ms);
  const fin = heureLocaleParis(ms + HEURE_MS);
  const valeurs = pluie.pas
    .filter((pas) => pas.time > debut && pas.time <= fin && estNombre(pas.precipitation))
    .map((pas) => pas.precipitation);
  if (valeurs.length === 0) return null;
  const cumul = valeurs.reduce((somme, valeur) => somme + valeur, 0);
  return cumul > 0 ? `${nombreFr(cumul)}${ESP}${pluie.unite} dans l'heure` : null;
}

export function vueMeteo(entites, pluie, ms) {
  const meteo = entites['weather.forecast_maison'];
  if (!meteo) return null;
  const ciel = cielHA(meteo.state);
  return {
    temperature: temperature(meteo.attributes.temperature, meteo.attributes.temperature_unit),
    picto: ciel.picto,
    libelle: ciel.libelle,
    pluie: pluieDansLHeure(pluie, ms),
  };
}

export function vueCourses(courses) {
  if (!courses) return { titre: 'Courses', articles: [], message: 'Liste pas encore lue' };
  const aFaire = courses.articles.filter((article) => article.status === 'needs_action');
  return {
    titre: `Courses · ${aFaire.length}`,
    articles: aFaire.slice(0, ARTICLES_MAX).map((article) => article.summary),
    message: aFaire.length === 0 ? 'Liste vide' : null,
  };
}

function pollenDominant(jour) {
  const pollens = pollensDuJour(jour);
  if (pollens.lignes.length > 0) return `${pollens.lignes[0].nom} · ${pollens.lignes[0].niveau}`;
  return pollens.message === PAS_DE_POLLEN ? PAS_DE_POLLEN : null;
}

export function vueAir(air, ms) {
  if (!air) return null;
  const indice = air.actuel.european_aqi;
  const niveau = estNombre(indice) ? niveauAir(indice) : null;
  const aujourdhui = dateParis(ms);
  const jour = air.jours.find((candidat) => candidat.date === aujourdhui);
  return {
    libelle: niveau ? niveau.libelle : 'Indice indisponible',
    classe: niveau ? niveau.classe : null,
    indice: estNombre(indice) ? `indice ${Math.round(indice)}` : '',
    pollen: jour ? pollenDominant(jour) : null,
  };
}

// Deux lignes au plus sous la météo d'un jour : repas puis agenda (règle détaillée dans l'en-tête).
function lignesDuJour(menu, agenda, date, ms) {
  const repas = lignesSemaine(menu, date, ms);
  const evenements = evenementsDuJour(agenda, date, ms);
  if (evenements.length === 0) return { repas, agenda: [] };
  if (repas.length > 0) {
    return { repas: [repas[repas.length - 1]], agenda: [ligneDeRendezVous(evenements, RENDEZ_VOUS_PAR_LIGNE, CARACTERES_LIGNE_SEMAINE)] };
  }
  const groupes = parPersonne(evenements);
  const premiere = groupes.length > 1 ? groupes[0] : evenements.slice(0, 1);
  const reste = evenements.filter((e) => premiere.indexOf(e) === -1);
  const agendaSeul = [ligneDeRendezVous(premiere, 1, CARACTERES_LIGNE_SEMAINE)];
  if (reste.length > 0) agendaSeul.push(ligneDeRendezVous(reste, groupes.length > 2 ? RENDEZ_VOUS_PAR_LIGNE : 1, CARACTERES_LIGNE_SEMAINE));
  return { repas: [], agenda: agendaSeul };
}

export function vueSemaine(semaine, ms, menu, agenda, tempo) {
  if (!semaine) return null;
  const aujourdhui = dateParis(ms);
  const avecTempo = tempoSurAccueil(ms) ? [aujourdhui, ajouterJours(aujourdhui, 1)] : [];
  const unite = semaine.unites.temperature_2m_max;
  return semaine.jours
    .filter((jour) => jour.date >= aujourdhui)
    .slice(0, JOURS_SEMAINE)
    .map((jour) => {
      const ciel = cielWmo(jour.code_ciel);
      const lignes = lignesDuJour(menu, agenda, jour.date, ms);
      return {
        jour: jourAbrege(jour.date),
        aujourdhui: jour.date === aujourdhui,
        picto: ciel.picto,
        libelle: ciel.libelle,
        maxi: temperature(jour.temperature_2m_max, unite),
        mini: temperature(jour.temperature_2m_min, unite),
        repas: lignes.repas,
        agenda: lignes.agenda,
        tempo: avecTempo.indexOf(jour.date) !== -1 ? pastilleDuJour(tempo, jour.date) : null,
      };
    });
}

export function alarmeAccueil(entites, ms) {
  const etat = etatAlarme(entites['alarm_control_panel.alarme_maison'], ms);
  if (!etat) return null;
  const ouvertures = vueOuvertures(entites, ms);
  return {
    libelle: etat.libelle, alerte: etat.ton === 'alerte', ouvertures: ouvertures.resumeCourt, ouverturesAlerte: ouvertures.ouvertes > 0,
  };
}

export function vueAccueil(donnees, ms) {
  const entites = donnees.entites;
  const tempo = vueTempo(donnees.tempo, ms);
  return {
    heure: texteHeure(ms),
    date: donnees.semaine && donnees.semaine.lieu ? `${texteDate(ms)} · ${donnees.semaine.lieu}` : texteDate(ms),
    meteo: vueMeteo(entites, donnees.pluie, ms),
    repas: repasAffiche(donnees.menu, ms),
    courses: vueCourses(donnees.courses),
    air: vueAir(donnees.air, ms),
    semaine: vueSemaine(donnees.semaine, ms, donnees.menu, donnees.agenda, donnees.tempo),
    alarme: alarmeAccueil(entites, ms),
    tempo: caseTempo(tempo),
    ficheTempo: ficheTempo(tempo),
    enfants: caseAccueil(donnees.enfants, ms),
  };
}
