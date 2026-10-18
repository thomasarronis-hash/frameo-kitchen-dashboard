// web/src/ecrans/repas-donnees.js
//
// Rôle    : calculer, sans DOM, ce que la page montre du menu de la semaine : l'écran Repas (7 jours, midi et
//           soir), le bloc « Ce soir » / « Ce midi » de l'Accueil et les repas de la colonne « La semaine ».
// Entrées : menu (partage/schema-menu-v1.json, reçu par le flux, ou null), ms (heure corrigée par le serveur),
//           une date « 2026-10-12 ».
// Sorties : vueRepas(menu, ms) -> { titre, message, jours: [{ date, nom, aujourdhui, midi, soir }] } ;
//           repasAffiche(menu, ms) -> { intitule, titre, details, repasId, message } ;
//           lignesSemaine(menu, date, ms) -> textes des repas de ce jour pour « La semaine » ;
//           repasDuJour(menu, date) -> { midi, soir, gamelle } ; trouverRepas(menu, id).
//           Une cellule de repas : { id, titre, accompagnement, temps, etiquettes, recette (booléen), gamelle:
//           false } ; un midi de semaine : { gamelle: true, titre } (le plat de la veille), ou null.
// Pièges  :
//   - Les midis de semaine ne sont pas dans le menu : ce sont les gamelles du plat cuisiné « +2 » la veille,
//     retrouvé par gamelles.pour (conception §1.5). Le midi du samedi et du dimanche, lui, est un vrai repas.
//   - « Ce midi » seulement quand le menu a un repas de midi ce jour-là (le week-end) et avant 14h ; sinon
//     « Ce soir ». Hors du cycle (ou sans menu) : « Menu pas encore publié », jamais un plat inventé.
//   - Le serveur ne garde que le menu dont le cycle couvre aujourd'hui, mais la page peut le recevoir juste
//     avant minuit et l'afficher après : chaque calcul revérifie que la date est dans le cycle.
//   - repasId n'est donné que si la recette existe (statut commande) : pas de bouton Recette vers « Recette à
//     venir ».
//   - Étiquettes dans l'ordre du menu, en toutes lettres (frigo_seul -> « frigo seul »).
//   - « La semaine » : le week-end, « Midi · » et « Soir · », une ligne chacun ; un jour à un seul repas (soirs
//     de semaine) a son titre seul, que l'écran laisse aller sur 2 lignes. Aujourd'hui après 14h, le midi est
//     passé : seul le soir reste, sur 2 lignes lui aussi (« Ce soir » l'affiche en 90 px sur une ligne, coupé :
//     le titre complet doit être lisible quelque part sur l'Accueil).

import {
  ajouterJours, dateParis, jourAbrege, partiesParis, texteDuree, texteJourIso,
} from '../heure.js';

const HEURE_BASCULE_MIDI = 14;
const PAS_PUBLIE = 'Menu pas encore publié';
const ETIQUETTES = { plaisir: 'plaisir', poisson: 'poisson', frigo_seul: 'frigo seul', sans_viande: 'sans viande' };

function datesDuCycle(cycle) {
  const dates = [];
  for (let date = cycle.debut; date <= cycle.fin; date = ajouterJours(date, 1)) dates.push(date);
  return dates;
}

const dansLeCycle = (menu, date) => Boolean(menu) && date >= menu.cycle.debut && date <= menu.cycle.fin;
const tempsTexte = (repas) => texteDuree(repas.temps_min * 60000);

export function trouverRepas(menu, id) {
  if (!menu) return null;
  return menu.repas.filter((repas) => repas.id === id)[0] || null;
}

export function repasDuJour(menu, date) {
  const duJour = (creneau) => menu.repas.filter((repas) => repas.date === date && repas.creneau === creneau)[0] || null;
  const gamelle = menu.repas.filter((repas) => repas.gamelles && repas.gamelles.pour === date)[0] || null;
  return { midi: duJour('midi'), soir: duJour('soir'), gamelle };
}

function cellule(repas) {
  return {
    id: repas.id,
    titre: repas.titre,
    accompagnement: repas.accompagnement || '',
    temps: tempsTexte(repas),
    etiquettes: repas.tags.map((tag) => ETIQUETTES[tag]),
    recette: repas.recette !== null,
    gamelle: false,
  };
}

function midiDuJour(jour) {
  if (jour.midi) return cellule(jour.midi);
  return jour.gamelle ? { gamelle: true, titre: jour.gamelle.titre } : null;
}

export function vueRepas(menu, ms) {
  if (!menu) return { titre: 'Repas de la semaine', message: PAS_PUBLIE, jours: [] };
  const aujourdhui = dateParis(ms);
  return {
    titre: `Du ${texteJourIso(menu.cycle.debut)} au ${texteJourIso(menu.cycle.fin)}`,
    message: null,
    jours: datesDuCycle(menu.cycle).map((date) => {
      const jour = repasDuJour(menu, date);
      return {
        date,
        nom: `${jourAbrege(date)} ${Number(date.slice(8))}`,
        aujourdhui: date === aujourdhui,
        midi: midiDuJour(jour),
        soir: jour.soir ? cellule(jour.soir) : null,
      };
    }),
  };
}

export function repasAffiche(menu, ms) {
  const aujourdhui = dateParis(ms);
  if (!dansLeCycle(menu, aujourdhui)) return { intitule: 'Ce soir', titre: null, details: '', repasId: null, message: PAS_PUBLIE };
  const jour = repasDuJour(menu, aujourdhui);
  const midi = jour.midi !== null && partiesParis(ms).heure < HEURE_BASCULE_MIDI;
  const repas = midi ? jour.midi : jour.soir;
  const intitule = midi ? 'Ce midi' : 'Ce soir';
  if (!repas) return { intitule, titre: null, details: '', repasId: null, message: 'Pas de repas prévu' };
  return {
    intitule,
    titre: repas.titre,
    details: repas.accompagnement ? `${tempsTexte(repas)} · ${repas.accompagnement}` : tempsTexte(repas),
    repasId: repas.recette !== null ? repas.id : null,
    message: null,
  };
}

export function lignesSemaine(menu, date, ms) {
  if (!dansLeCycle(menu, date)) return [];
  const jour = repasDuJour(menu, date);
  const midiPasse = date === dateParis(ms) && partiesParis(ms).heure >= HEURE_BASCULE_MIDI;
  if (jour.midi && jour.soir && !midiPasse) return [`Midi · ${jour.midi.titre}`, `Soir · ${jour.soir.titre}`];
  return jour.soir ? [jour.soir.titre] : [];
}
