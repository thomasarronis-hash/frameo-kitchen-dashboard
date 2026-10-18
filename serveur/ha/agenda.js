// serveur/ha/agenda.js
//
// Rôle    : UN SEUL agenda familial : les événements des calendriers de la liste blanche AGENDA_CALENDRIERS
//           (intégrations CalDAV pour iCloud et Google Calendar de HA) sur quatre semaines (la précédente, la semaine
//           en cours et les deux suivantes), lus par calendar.get_events, projetés au strict nécessaire, rattachés à
//           leur personne, fusionnés, triés et sans doublon, pour l'écran Agenda (la semaine en grille et sa
//           navigation), la colonne « La semaine » et la page Aujourd'hui.
// Entrées : ConnexionHA (lire, événement 'prete', etat), SourceEntites (valeur, recue, événement 'maj' ; les
//           calendriers configurés y sont avec leur nom seul, voir entites.js), calendriers [{ id, personne }]
//           (config.js, dans l'ordre de AGENDA_CALENDRIERS), journal, maintenant (horloge en ms, Date.now par défaut ;
//           une fausse dans les tests).
// Sorties : SourceAgenda : valeur { personnes, fenetre, calendriers, evenements } (null avant la première lecture),
//           événement 'maj' quand elle change :
//           - personnes : les prénoms dans l'ordre de première apparition dans AGENDA_CALENDRIERS (la page en tire
//             la couleur et l'initiale de chacun) ;
//           - fenetre : { debut, fin }, les dates de Paris lues (« 2026-10-05 », fin EXCLUE : le lundi qui suit la
//             dernière semaine lue) ; la page n'ouvre que les semaines qu'elle couvre ; null sans calendrier ;
//           - calendriers : [{ id, nom, personne, etat }] ; etat vaut « ok », « absent » (entité inconnue de HA :
//             intégration pas encore ajoutée, nom mal recopié) ou « erreur » (lecture refusée : événements de la
//             lecture précédente gardés) ;
//           - evenements : [{ personne, titre, debut, fin, journee, lieu }], triés par début (heure de Paris), une
//             journée entière avant les événements à l'heure du même jour, puis par titre, puis dans l'ordre de
//             AGENDA_CALENDRIERS (tri stable) ; debut et fin tels que HA les donne : « 2026-10-14 » pour un
//             événement sur la journée (fin EXCLUE : le lendemain du dernier jour), « 2026-10-14T09:30:00+02:00 »
//             sinon ; journee le dit ; lieu vaut null quand il n'y en a pas.
//           fenetreDeLecture(ms), projeterEvenement(evenement, personne), lieuSansLien(texte), fusionner(listes) : pour
//           les tests.
// Pièges  :
//   - Liste vide (cas par défaut, aucun agenda relié) : { personnes: [], fenetre: null, calendriers: [], evenements: [] }
//     publié tout de suite, sans aucun appel à HA ; l'écran Agenda affiche alors « Aucun agenda relié ».
//   - Lecture seule : calendar.get_events avec return_response, autorisé par le garde-fou de connexion.js, tous les
//     calendriers EN PARALLÈLE, chacun avec son propre échec : un calendrier lent (CalDAV muet, coupé par le délai de
//     25 s de connexion.js) ne retient pas la publication des autres. UN appel par calendrier et par lecture, comme
//     avant l'écran en grille : la fenêtre s'est élargie, pas le nombre d'appels.
//   - Fenêtre (fenetreDeLecture) : du lundi de la semaine précédente à 00:00 au lundi qui suit la deuxième semaine
//     suivante à 00:00, heure de Paris, soit 28 jours (start_date_time et end_date_time, avec le décalage de Paris de
//     CHAQUE borne : la fenêtre du 14/10 commence en heure d'été et finit en heure d'hiver). Les événements déjà
//     passés de la fenêtre restent (la grille montre toute la semaine) ; la page écarte elle-même les rendez-vous
//     finis là où il le faut (« La semaine », page Aujourd'hui). La fenêtre glisse le lundi, à la relecture suivante.
//   - Relu toutes les 15 min, à chaque reconnexion à HA, et à chaque changement d'un calendrier configuré
//     (son état passe à on au début d'un événement et à off à sa fin, son nom peut changer, il peut apparaître
//     ou disparaître). La première lecture attend les premiers états de HA (SourceEntites.recue) : sans eux,
//     tous les calendriers paraîtraient absents.
//   - Projection : titre (summary, espaces de bord retirés), début, fin, journée entière, lieu, personne. Ni
//     description ni participants : une description d'invitation contient souvent des liens de visio, des
//     numéros, des adresses de courriel. Le lieu d'une invitation aussi (Zoom y met https://zoom.us/j/...?pwd=...) :
//     tout lien du lieu devient « Visio » avant de sortir, le reste du texte (salle, adresse) est gardé. L'identifiant
//     du calendrier ne part pas non plus : la page colore par personne, pas par calendrier.
//   - Doublons : un même rendez-vous peut être dans deux calendriers d'une même personne (invitation acceptée
//     dans le calendrier du travail et recopiée dans celui du domicile). Même personne, même titre et même début
//     : un seul est gardé, celui du premier calendrier de la liste. Deux personnes au même rendez-vous gardent
//     chacune le leur (chacune a sa pastille).
//   - Un calendrier qui échoue n'efface pas les autres : il garde ses événements de la lecture précédente et
//     passe en « erreur » (journalisé). Une réponse de forme inattendue compte comme un échec.

import { compilerValidateur, Source } from '../source.js';

const INTERVALLE_MS = 15 * 60_000;
const SEMAINES_AVANT = 1;
const SEMAINES_APRES = 2;
const JOUR_MS = 86_400_000;
const DATE_OU_HEURE = '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}))?$';
const FORMAT_PARIS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const validerReponse = compilerValidateur({
  type: 'object',
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        required: ['start', 'end', 'summary'],
        properties: {
          start: { type: 'string', pattern: DATE_OU_HEURE },
          end: { type: 'string', pattern: DATE_OU_HEURE },
          summary: { type: 'string' },
          location: { type: 'string' },
        },
      },
    },
  },
});

const parties = (ms) => Object.fromEntries(FORMAT_PARIS.formatToParts(new Date(ms)).map(({ type, value }) => [type, value]));
const dateDe = (ms) => new Date(ms).toISOString().slice(0, 10);

// « 2026-10-05 » -> « 2026-10-05T00:00:00+02:00 » : minuit de Paris avec son décalage du jour. À 00:00 UTC, il est 01:00
// (hiver) ou 02:00 (été) à Paris le même jour, et les changements d'heure n'ont lieu qu'à 01:00 UTC : l'heure de Paris
// à 00:00 UTC de cette date EST le décalage de son minuit.
function minuitParis(date) {
  const decalage = Number(parties(Date.parse(`${date}T00:00:00Z`)).hour) % 24;
  return `${date}T00:00:00+0${decalage}:00`;
}

// La fenêtre lue à l'instant ms : { debut, fin } (dates de Paris, fin exclue) et les bornes à passer à HA.
export function fenetreDeLecture(ms) {
  const p = parties(ms);
  const aujourdhui = Date.UTC(p.year, p.month - 1, p.day);
  const lundi = aujourdhui - ((new Date(aujourdhui).getUTCDay() + 6) % 7) * JOUR_MS;
  const debut = dateDe(lundi - 7 * SEMAINES_AVANT * JOUR_MS);
  const fin = dateDe(lundi + 7 * (SEMAINES_APRES + 1) * JOUR_MS);
  return { debut, fin, start_date_time: minuitParis(debut), end_date_time: minuitParis(fin) };
}

// Liens avec ou sans schéma (https://..., www...., zoom.us/j/...) : tout ce qui suit, mot de passe compris, part avec.
const LIEN = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/)[^\s()<>"]*/gi;

// « Salle B, https://meet.google.com/abc » -> « Salle B, Visio » ; plusieurs liens de suite ne font qu'une « Visio ».
export function lieuSansLien(texte) {
  return texte
    .replace(LIEN, 'Visio')
    .replace(/Visio(?:[\s,;·|-]+Visio)+/g, 'Visio')
    .replace(/\s+/g, ' ')
    .trim();
}

export function projeterEvenement(evenement, personne) {
  const lieu = typeof evenement.location === 'string' ? lieuSansLien(evenement.location) : '';
  return {
    personne,
    titre: evenement.summary.trim(),
    debut: evenement.start,
    fin: evenement.end,
    journee: evenement.start.length === 10,
    lieu: lieu === '' ? null : lieu,
  };
}

// « 2026-10-14T09:30 » à l'heure de Paris ; une journée entière commence à « 2026-10-14T00:00 » mais passe avant.
function cleDeTri(evenement) {
  if (evenement.journee) return `${evenement.debut}T00:00 0`;
  const p = parties(Date.parse(evenement.debut));
  return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute} 1`;
}

// listes : les événements projetés de chaque calendrier, dans l'ordre de AGENDA_CALENDRIERS.
export function fusionner(listes) {
  const vus = new Set();
  const gardes = [];
  for (const evenements of listes) {
    for (const evenement of evenements) {
      const cle = JSON.stringify([evenement.personne, evenement.titre, evenement.debut]);
      if (vus.has(cle)) continue;
      vus.add(cle);
      gardes.push({ cle: cleDeTri(evenement), evenement });
    }
  }
  return gardes
    .sort((a, b) => {
      if (a.cle !== b.cle) return a.cle < b.cle ? -1 : 1;
      return a.evenement.titre.localeCompare(b.evenement.titre, 'fr');
    })
    .map(({ evenement }) => evenement);
}

export class SourceAgenda extends Source {
  #connexion;
  #entites;
  #calendriers;
  #personnes;
  #maintenant;
  #derniers = new Map();

  constructor(connexion, entites, calendriers, journal, maintenant = Date.now) {
    super('agenda', journal);
    this.#connexion = connexion;
    this.#entites = entites;
    this.#calendriers = calendriers;
    this.#maintenant = maintenant;
    this.#personnes = calendriers.map((c) => c.personne).filter((personne, i, toutes) => toutes.indexOf(personne) === i);
  }

  demarrer() {
    if (this.#calendriers.length === 0) {
      this.publier({
        personnes: [], fenetre: null, calendriers: [], evenements: [],
      });
      return;
    }
    this.#connexion.on('prete', () => {
      if (this.#entites.recue) this.actualiser();
    });
    this.#entites.on('maj', (fragment) => {
      if (this.valeur === null || this.#calendriers.some((c) => c.id in fragment)) this.actualiser();
    });
    this.repeter(INTERVALLE_MS, () => this.#connexion.etat === 'ok' && this.#entites.recue);
  }

  // Un calendrier : sa ligne pour la page, et ses événements (ceux de la lecture précédente s'il échoue), ou null s'il
  // est absent de HA.
  async #lireCalendrier({ id, personne }, etat, bornes) {
    const calendrier = {
      id, nom: (etat && etat.attributes.friendly_name) || id, personne, etat: etat ? 'ok' : 'absent',
    };
    if (!etat) {
      this.#derniers.delete(id);
      return { calendrier, evenements: null };
    }
    try {
      const reponse = await this.#connexion.lire('calendar.get_events', id, bornes);
      this.#derniers.set(id, validerReponse(reponse).events.map((evenement) => projeterEvenement(evenement, personne)));
    } catch (err) {
      calendrier.etat = 'erreur';
      this.journal.warn(`agenda : ${id} illisible, événements précédents gardés (${err.message})`);
    }
    return { calendrier, evenements: this.#derniers.get(id) || [] };
  }

  async lire() {
    const etats = this.#entites.valeur;
    const fenetre = fenetreDeLecture(this.#maintenant());
    const bornes = { start_date_time: fenetre.start_date_time, end_date_time: fenetre.end_date_time };
    const lus = await Promise.all(this.#calendriers.map((c) => this.#lireCalendrier(c, etats[c.id], bornes)));
    return {
      personnes: this.#personnes,
      fenetre: { debut: fenetre.debut, fin: fenetre.fin },
      calendriers: lus.map((lu) => lu.calendrier),
      evenements: fusionner(lus.filter((lu) => lu.evenements !== null).map((lu) => lu.evenements)),
    };
  }
}
