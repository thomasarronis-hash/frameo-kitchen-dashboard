// web/src/etat.js
//
// Rôle    : magasin d'état de la page, alimenté par le flux du serveur (instantane, puis maj et menu).
// Entrées : recevoirInstantane(donnees) et recevoirMaj(donnees), appelés par api.js avec le JSON du flux
//           (l'événement menu, de données { menu }, passe par recevoirMaj comme une maj).
// Sorties : creerEtat() -> { lire(), recevoirInstantane(), recevoirMaj(), abonner(rappel) } ;
//           lire() -> { ha, entites, meteo, courses, agenda, sonnette, air, pluie, semaine, menu, draps, tempo, voitures, clims,
//           enfants, simulation, simulation_maison, simulation_voiture, simulation_clim, direct_video, photos_configurees, empreinte } (null tant que non
//           reçu, entites vaut {} au départ ; draps : { timo, pablo, parents } dates du dernier changement,
//           serveur/sources/draps.js ; tempo : couleurs EDF Tempo, serveur/sources/tempo.js ; voitures : [] sans voiture
//           configurée, sinon une entrée par voiture, serveur/ha/voitures.js ; clims : [] sans clim configurée, sinon une
//           entrée par clim, serveur/ha/clims.js ; enfants : barème et état du jour du tableau des
//           enfants, serveur/enfants/projection.js ; empreinte : du contenu servi, lue par rechargement.js ; sonnette : suivi
//           des coups de sonnette et de la photo, serveur/ha/sonnette.js ; menu peut rester null : « Menu pas encore
//           publié » ; simulation vaut true quand le serveur simule les actions de courses, simulation_maison celles de la
//           maison, simulation_voiture les commandes de la voiture, simulation_clim celles des clims, direct_video quand il relaie la vidéo de la sonnette,
//           photos_configurees quand il a une clé Immich ; agenda vaut { personnes: [], fenetre: null, calendriers: [],
//           evenements: [] } quand aucun calendrier n'est configuré, sinon fenetre { debut, fin } est la période lue, dont la
//           grille de l'Agenda tire les semaines ouvertes à la navigation, serveur/ha/agenda.js).
// Pièges  :
//   - entites arrive en fragments : seules les entités changées, null pour une entité disparue
//     (serveur/ha/entites.js). Les autres clés arrivent entières et remplacent l'ancienne valeur.
//   - Un instantane remplace TOUT (connexion ou reconnexion) : une entité disparue pendant une coupure
//     ne doit pas rester affichée.
//   - heure_serveur n'est pas gardé ici : api.js le donne à l'horloge (heure.js).
//   - Clés inconnues ignorées : un serveur plus récent ne casse pas une page plus ancienne.

const CLES = [
  'ha', 'meteo', 'courses', 'agenda', 'sonnette', 'air', 'pluie', 'semaine', 'menu', 'draps', 'tempo', 'voitures', 'clims', 'enfants', 'simulation',
  'simulation_maison', 'simulation_voiture', 'simulation_clim', 'direct_video', 'photos_configurees', 'empreinte',
];

function etatVide() {
  return {
    ha: null, entites: {}, meteo: null, courses: null, agenda: null, sonnette: null, air: null, pluie: null, semaine: null, menu: null,
    draps: null, tempo: null, voitures: null, clims: null, enfants: null, simulation: null, simulation_maison: null, simulation_voiture: null,
    simulation_clim: null, direct_video: null, photos_configurees: null, empreinte: null,
  };
}

export function creerEtat() {
  let donnees = etatVide();
  const abonnes = [];

  const prevenir = () => abonnes.forEach((rappel) => rappel(donnees));

  function fusionnerEntites(fragment) {
    Object.keys(fragment || {}).forEach((entityId) => {
      if (fragment[entityId] === null) delete donnees.entites[entityId];
      else donnees.entites[entityId] = fragment[entityId];
    });
  }

  return {
    lire: () => donnees,
    recevoirInstantane(recu) {
      donnees = etatVide();
      CLES.forEach((cle) => {
        if (recu[cle] !== undefined) donnees[cle] = recu[cle];
      });
      fusionnerEntites(recu.entites);
      prevenir();
    },
    recevoirMaj(recu) {
      Object.keys(recu).forEach((cle) => {
        if (cle === 'entites') fusionnerEntites(recu.entites);
        else if (CLES.indexOf(cle) !== -1) donnees[cle] = recu[cle];
      });
      prevenir();
    },
    abonner(rappel) {
      abonnes.push(rappel);
    },
  };
}
