// web/src/photos.js
//
// Rôle    : les règles du diaporama du mode Photos, sans DOM (testées) : tenir le lot venu du serveur (relu toutes les
//           30 min, nouvel essai 5 min après un échec), composer chaque vue (un paysage, une PAIRE de portraits côte à
//           côte, ou un portrait seul), ne précharger que la vue suivante, passer à la suivante sur une photo
//           indisponible ou trop lente à venir (20 s), et dire quand basculer (30 s, et seulement une fois la suivante
//           chargée).
// Entrées : creerDiaporama() ; ms : horloge MONOTONE de la page (performance.now), pas l'heure murale ; le lot tel que
//           GET /api/photos/lot le rend ([{ id, portrait, legende }]).
// Sorties : creerDiaporama() -> {
//             besoinDeLot(ms), lotDemande(), recevoirLot(lot, ms), echecLot(ms), pretes() (au moins une photo à
//             montrer) ;
//             aPrecharger(ms) -> la vue suivante { cle, disposition: 'paysage' | 'paire' | 'portrait', photos: [{ id,
//               legende }] } ou null (une vue pas prête au bout de 20 s est abandonnée et remplacée) ;
//             imageChargee(cle, id) ; imageEchouee(cle, id, ms) ; vuePrete() (la vue suivante est chargée : le mode
//             Photos peut s'ouvrir sans écran vide) ;
//             aBasculer(ms) ; basculer(ms) -> la vue désormais affichée ; enPanne(ms) (rien d'affiché et pause après
//             des échecs) ; arreter() (sortie du mode Photos) }
//           photosValides(lot) ; URL_PHOTO(id) ; DUREE_PHOTO_MS (30 s), DUREE_FONDU_MS (1,5 s), RELIRE_LOT_MS (30 min),
//           NOUVEL_ESSAI_LOT_MS (5 min), ECHECS_AVANT_PAUSE (3), PAUSE_APRES_ECHECS_MS (1 min), DELAI_CHARGEMENT_MS
//           (20 s).
// Pièges  :
//   - Mémoire du cadre (2 Go, appli mesurée de 205 à 370 Mo) : une seule vue préchargée à la fois, donc deux images
//     au plus en attente (une paire), plus la vue affichée. La page vide le calque quitté une fois le fondu fini.
//   - Paires : un portrait prend le PREMIER autre portrait de la file (même plus loin), sinon il est montré seul ;
//     sur fond Ardoise dans les deux cas (CSS).
//   - Photo indisponible (410, réseau) : retirée du lot pour de bon ; l'autre photo de sa vue revient en tête de file
//     (un portrait retrouve une paire) ; la vue affichée reste à l'écran jusqu'à ce qu'une suivante soit chargée :
//     jamais d'écran vide. Après 3 échecs de suite, pause d'une minute (un Immich en panne ne reçoit pas 100
//     demandes d'affilée) et lot redemandé tout de suite : le serveur ne relaie que les photos de ses lots récents
//     (serveur/sources/immich.js), un lot d'avant son redémarrage n'a plus cours.
//   - Vue trop lente (constat du 14/10 sur le cadre) : le Wi-Fi du cadre (puce RK915) décroche par moments ; une
//     photo dont le transfert cale ne finit JAMAIS (ni load ni error : le serveur coupe au bout de 30 s, mais le cadre
//     ne reçoit pas la coupure), et le diaporama restait sur un écran vide. Une vue pas prête 20 s après avoir été
//     composée compte donc comme un échec : ses photos pas encore chargées sont retirées du lot (une photo chargée
//     revient en tête de file), et la page remplace les src, ce qui abandonne le transfert. Le décodage compte dans
//     ces 20 s : une photo de 1440 px arrive en moins d'une seconde quand le Wi-Fi va bien.
//   - File épuisée avant la relecture du lot (petit album) : on repart du même lot, sans la vue affichée ; un lot
//     d'une seule photo la laisse simplement à l'écran.
//   - Un lot neuf ne remet pas en file les photos de la vue affichée ni de la vue préchargée (pas de doublon
//     immédiat). Une relecture qui échoue garde l'ancien lot : le diaporama continue.
//   - Le retrait d'une photo d'un ALBUM n'est vu qu'à la relecture du lot (30 min, critère M4 : 60 min au plus) ; la
//     corbeille, elle, est revérifiée par le serveur à chaque photo.
//   - Identifiants contrôlés (uuid en minuscules) avant de servir dans une URL, même venant du serveur.

export const DUREE_PHOTO_MS = 30000;
export const DUREE_FONDU_MS = 1500;
export const RELIRE_LOT_MS = 30 * 60000;
export const NOUVEL_ESSAI_LOT_MS = 5 * 60000;
export const ECHECS_AVANT_PAUSE = 3;
export const PAUSE_APRES_ECHECS_MS = 60000;
export const DELAI_CHARGEMENT_MS = 20000;
const MOTIF_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const URL_PHOTO = (id) => `/api/photos/${id}.jpg`;

// Garde les photos à l'identifiant bien formé, une seule fois chacune, sous la forme { id, portrait, legende }.
export function photosValides(lot) {
  const valides = [];
  const vus = {};
  (Array.isArray(lot) ? lot : []).forEach((photo) => {
    if (!photo || typeof photo.id !== 'string' || !MOTIF_ID.test(photo.id) || vus[photo.id]) return;
    vus[photo.id] = true;
    valides.push({ id: photo.id, portrait: photo.portrait === true, legende: typeof photo.legende === 'string' ? photo.legende : null });
  });
  return valides;
}

const ids = (vue) => (vue ? vue.photos.map((photo) => photo.id) : []);
const sauf = (photos, exclus) => photos.filter((photo) => exclus.indexOf(photo.id) === -1);

export function creerDiaporama() {
  let lot = [];
  let file = [];
  let lotLe = null;
  let lotEnCours = false;
  let essaiApres = 0;
  let numero = 0;
  let prochaine = null;
  let actuelle = null;
  let echecs = 0;
  let pauseJusqua = 0;

  function vue(photos, disposition, ms) {
    numero += 1;
    return {
      cle: numero,
      disposition,
      photos: photos.map((photo) => ({ id: photo.id, legende: photo.legende })),
      sources: photos,
      chargees: [],
      prete: false,
      composeeLe: ms,
    };
  }

  function composer(ms) {
    if (file.length === 0) file = sauf(lot, ids(actuelle));
    if (file.length === 0) return null;
    const premiere = file.shift();
    if (!premiere.portrait) return vue([premiere], 'paysage', ms);
    const autre = file.findIndex((photo) => photo.portrait);
    if (autre === -1) return vue([premiere], 'portrait', ms);
    return vue([premiere, file.splice(autre, 1)[0]], 'paire', ms);
  }

  // La vue suivante échoue : les photos retirées quittent le lot pour de bon, les autres reviennent en tête de file ;
  // un seul échec compté, pause après ECHECS_AVANT_PAUSE de suite.
  function abandonner(retirees, ms) {
    lot = sauf(lot, retirees);
    file = sauf(prochaine.sources, retirees).concat(file);
    prochaine = null;
    if (lot.length === 0) {
      lotLe = null;
      essaiApres = ms + NOUVEL_ESSAI_LOT_MS;
    }
    echecs += 1;
    if (echecs >= ECHECS_AVANT_PAUSE) {
      echecs = 0;
      pauseJusqua = ms + PAUSE_APRES_ECHECS_MS;
      lotLe = null;
    }
  }

  return {
    besoinDeLot: (ms) => !lotEnCours && ms >= essaiApres && (lotLe === null || ms - lotLe >= RELIRE_LOT_MS),
    lotDemande() {
      lotEnCours = true;
    },
    recevoirLot(recu, ms) {
      lotEnCours = false;
      lotLe = ms;
      lot = photosValides(recu);
      file = sauf(lot, ids(actuelle).concat(ids(prochaine)));
    },
    echecLot(ms) {
      lotEnCours = false;
      essaiApres = ms + NOUVEL_ESSAI_LOT_MS;
    },
    pretes: () => lot.length > 0,
    aPrecharger(ms) {
      if (prochaine !== null && !prochaine.prete && ms - prochaine.composeeLe >= DELAI_CHARGEMENT_MS) {
        abandonner(ids(prochaine).filter((id) => prochaine.chargees.indexOf(id) === -1), ms);
      }
      if (prochaine === null && ms >= pauseJusqua) prochaine = composer(ms);
      return prochaine;
    },
    imageChargee(cle, id) {
      if (!prochaine || prochaine.cle !== cle || ids(prochaine).indexOf(id) === -1) return;
      if (prochaine.chargees.indexOf(id) === -1) prochaine.chargees.push(id);
      prochaine.prete = prochaine.chargees.length === prochaine.photos.length;
    },
    imageEchouee(cle, id, ms) {
      if (!prochaine || prochaine.cle !== cle) return;
      abandonner([id], ms);
    },
    vuePrete: () => prochaine !== null && prochaine.prete,
    aBasculer: (ms) => prochaine !== null && prochaine.prete && (actuelle === null || ms - actuelle.depuis >= DUREE_PHOTO_MS),
    basculer(ms) {
      actuelle = { cle: prochaine.cle, disposition: prochaine.disposition, photos: prochaine.photos, depuis: ms };
      prochaine = null;
      echecs = 0;
      return actuelle;
    },
    enPanne: (ms) => actuelle === null && (ms < pauseJusqua || lot.length === 0),
    arreter() {
      if (prochaine) file = prochaine.sources.concat(file);
      prochaine = null;
      actuelle = null;
      echecs = 0;
      pauseJusqua = 0;
    },
  };
}
