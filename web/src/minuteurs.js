// web/src/minuteurs.js
//
// Rôle    : les minuteurs de cuisine, sans DOM : plusieurs minuteurs nommés, fin en heure corrigée par le
//           serveur, gardés dans localStorage (un rechargement ne les perd pas), échéances et textes.
// Entrées : creerMinuteurs({ stockage (stockage.js) }) ; chaque opération reçoit l'heure corrigée (ms,
//           heure.js) : le module ne lit aucune horloge lui-même.
// Sorties : creerMinuteurs(...) -> {
//             etat(ms) -> { enCours: [...], sonnants: [...], annules: [...] } triés par fin (sonnant = fin atteinte,
//               pas encore arrêté ; annulé = retiré du tiroir depuis moins de 5 s, encore rétablissable) ;
//               lancer({ libelle, dureeMs, surplusMs }, ms) -> le minuteur, ou null s'il y en a déjà
//               MINUTEURS_MAX ; ajouter(id, ms) (+1 min sur un minuteur en cours) ; annuler(id, ms) (Annuler du
//               tiroir : rétablissable pendant 5 s) ; retablir(id, ms) -> vrai si rétabli ; arreter(id) (sonnerie
//               arrêtée : sans retour) ; prolonger(id, dureeMs, ms) (relance un minuteur qui sonne) ;
//               trouver(libelle) (le minuteur en cours ou qui sonne de ce nom) ; nomLibre() « Minuteur 2 » ;
//               nombre() (en cours et qui sonnent, sans regarder l'heure) }
//           minuteur = { id, libelle, fin (ms corrigées), surplusMs (temps de plus proposé à la fin, 0 sinon) } ;
//           reglerDuree(ms, deltaMs) (réglage du tiroir, borné de 1 min à 6 h) ; texteRestant(ms) « 4:05 »,
//           « 1:02:03 » ; texteDureeCourte(ms) « 35 min », « 1 h 05 », « 45 s » ; vuePastille(etat, ms) ;
//           vueTiroir(etat, ms) -> lignes du tiroir [{ id, libelle, temps, annule }] ; vueAlerte(sonnants) ->
//           { lignes, autres } ; ALERTE_LIGNES_MAX (3).
// Pièges  :
//   - La fin est une heure CORRIGÉE (horloge du serveur), pas l'horloge du cadre, qui peut être fausse ou
//     sauter : au rechargement, main.js n'évalue les échéances qu'une fois l'horloge réglée (ou après 10 s
//     sans serveur, pour qu'un minuteur sonne quand même).
//   - Un minuteur qui sonne reste dans la liste (et dans localStorage) jusqu'au toucher : s'il finit pendant un
//     rechargement, il sonne au chargement suivant. Fini depuis plus d'une heure (cadre éteint, page fermée),
//     il est oublié : une sonnerie si tardive n'aurait plus de sens.
//   - Le temps restant est arrondi à la seconde SUPÉRIEURE : « 0:01 » jusqu'à la fin, jamais « 0:00 » avant
//     la sonnerie.
//   - Ce qui vient de localStorage est revalidé (forme, longueur du nom, nombres finis) : une entrée abîmée est
//     ignorée, pas une panne.
//   - MINUTEURS_MAX (5) : ce que le tiroir affiche sans défiler ; au-delà, « Démarrer » le dit.
//   - Annuler depuis le tiroir ne fait pas disparaître la ligne : elle reste 5 s À SA PLACE (« Annulé », bouton
//     Rétablir), puis s'en va. Sans cela, le minuteur suivant remontait sous le doigt, et un second toucher
//     (« ça n'a pas marché ? ») l'annulait aussi, sans retour possible. Les annulés vivent en mémoire seulement :
//     un rechargement ne les rétablit pas.
//   - Alerte : au-delà de 3 minuteurs qui sonnent ensemble, les 2 premiers ont leur ligne et les autres sont
//     nommés sur une ligne « et 2 autres : … » ; sinon la consigne « Toucher l'écran » sortait de l'écran.

const CLE = 'minuteurs';
const MINUTE_MS = 60000;
const PEREMPTION_MS = 3600000;
const LIBELLE_MAX = 30;
export const MINUTEURS_MAX = 5;
const DUREE_REGLAGE_MIN_MS = MINUTE_MS;
const DUREE_REGLAGE_MAX_MS = 6 * 3600000;
const DELAI_RETABLIR_MS = 5000;
export const ALERTE_LIGNES_MAX = 3;

const deuxChiffres = (n) => (n < 10 ? '0' : '') + n;
const estNombre = (valeur) => typeof valeur === 'number' && isFinite(valeur);

function valide(minuteur) {
  return Boolean(minuteur) && typeof minuteur.id === 'string' && typeof minuteur.libelle === 'string'
    && minuteur.libelle.length > 0 && minuteur.libelle.length <= LIBELLE_MAX
    && estNombre(minuteur.fin) && estNombre(minuteur.surplusMs) && minuteur.surplusMs >= 0;
}

function nouvelId() {
  return `m${Math.random().toString(36).slice(2, 10)}`;
}

export function creerMinuteurs({ stockage }) {
  const lus = stockage.lire(CLE);
  let liste = Array.isArray(lus) ? lus.filter(valide) : [];
  let annules = [];

  const enregistrer = () => stockage.ecrire(CLE, liste);
  const parId = (id) => liste.filter((minuteur) => minuteur.id === id)[0] || null;
  const tries = () => liste.slice().sort((a, b) => a.fin - b.fin);

  function oublierPerimes(ms) {
    const avant = liste.length;
    liste = liste.filter((minuteur) => minuteur.fin > ms - PEREMPTION_MS);
    if (liste.length !== avant) enregistrer();
  }

  return {
    etat(ms) {
      oublierPerimes(ms);
      annules = annules.filter((annule) => annule.jusqua > ms);
      const tous = tries();
      return {
        enCours: tous.filter((minuteur) => minuteur.fin > ms),
        sonnants: tous.filter((minuteur) => minuteur.fin <= ms),
        annules: annules.map((annule) => annule.minuteur).sort((a, b) => a.fin - b.fin),
      };
    },
    lancer({ libelle, dureeMs, surplusMs = 0 }, ms) {
      if (liste.length >= MINUTEURS_MAX) return null;
      const minuteur = { id: nouvelId(), libelle: String(libelle).slice(0, LIBELLE_MAX), fin: ms + dureeMs, surplusMs };
      liste.push(minuteur);
      enregistrer();
      return minuteur;
    },
    ajouter(id, ms) {
      const minuteur = parId(id);
      if (!minuteur || minuteur.fin <= ms) return;
      minuteur.fin += MINUTE_MS;
      enregistrer();
    },
    annuler(id, ms) {
      const minuteur = parId(id);
      if (!minuteur) return;
      liste = liste.filter((candidat) => candidat !== minuteur);
      annules.push({ minuteur, jusqua: ms + DELAI_RETABLIR_MS });
      enregistrer();
    },
    retablir(id, ms) {
      const annule = annules.filter((candidat) => candidat.minuteur.id === id && candidat.jusqua > ms)[0];
      if (!annule || liste.length >= MINUTEURS_MAX) return false;
      annules = annules.filter((candidat) => candidat !== annule);
      liste.push(annule.minuteur);
      enregistrer();
      return true;
    },
    arreter(id) {
      liste = liste.filter((minuteur) => minuteur.id !== id);
      enregistrer();
    },
    prolonger(id, dureeMs, ms) {
      const minuteur = parId(id);
      if (!minuteur) return;
      minuteur.fin = ms + dureeMs;
      minuteur.surplusMs = 0;
      enregistrer();
    },
    trouver(libelle) {
      return liste.filter((minuteur) => minuteur.libelle === libelle)[0] || null;
    },
    nombre: () => liste.length,
    nomLibre() {
      for (let n = 1; ; n += 1) {
        const nom = `Minuteur ${n}`;
        if (!liste.some((minuteur) => minuteur.libelle === nom)) return nom;
      }
    },
  };
}

export function reglerDuree(dureeMs, deltaMs) {
  return Math.min(DUREE_REGLAGE_MAX_MS, Math.max(DUREE_REGLAGE_MIN_MS, dureeMs + deltaMs));
}

export function texteRestant(ms) {
  const secondes = Math.max(0, Math.ceil(ms / 1000));
  const heures = Math.floor(secondes / 3600);
  const minutes = Math.floor((secondes % 3600) / 60);
  const reste = secondes % 60;
  return heures > 0 ? `${heures}:${deuxChiffres(minutes)}:${deuxChiffres(reste)}` : `${minutes}:${deuxChiffres(reste)}`;
}

export function texteDureeCourte(ms) {
  const secondes = Math.round(ms / 1000);
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.floor(secondes / 60);
  const reste = secondes % 60;
  if (minutes < 60) return reste === 0 ? `${minutes} min` : `${minutes} min ${deuxChiffres(reste)}`;
  const heures = Math.floor(minutes / 60);
  const minutesRestantes = minutes % 60;
  return minutesRestantes === 0 ? `${heures} h` : `${heures} h ${deuxChiffres(minutesRestantes)}`;
}

// Pastille : le minuteur qui sonne d'abord, sinon le plus proche de sa fin, et combien d'autres tournent.
export function vuePastille(etat, ms) {
  const tous = etat.sonnants.concat(etat.enCours);
  if (tous.length === 0) return null;
  const premier = tous[0];
  return {
    libelle: premier.libelle,
    temps: premier.fin <= ms ? 'Terminé' : texteRestant(premier.fin - ms),
    sonne: premier.fin <= ms,
    autres: tous.length > 1 ? `+${tous.length - 1}` : '',
  };
}

// Tiroir : minuteurs en cours et annulés depuis moins de 5 s, mêlés et triés par fin (chacun garde sa place) ;
// MINUTEURS_MAX lignes au plus (un minuteur lancé juste après une annulation fait partir l'annulé le plus tardif).
export function vueTiroir(etat, ms) {
  const lignes = etat.enCours.map((minuteur) => ({ minuteur, annule: false }))
    .concat(etat.annules.map((minuteur) => ({ minuteur, annule: true })));
  lignes.sort((a, b) => a.minuteur.fin - b.minuteur.fin);
  for (let i = lignes.length - 1; i >= 0 && lignes.length > MINUTEURS_MAX; i -= 1) {
    if (lignes[i].annule) lignes.splice(i, 1);
  }
  return lignes.map(({ minuteur, annule }) => ({
    id: minuteur.id,
    libelle: minuteur.libelle,
    temps: annule ? 'Annulé' : texteRestant(minuteur.fin - ms),
    annule,
  }));
}

// Alerte : jusqu'à 3 minuteurs, une ligne chacun ; au-delà, 2 lignes et les autres nommés ensemble.
export function vueAlerte(sonnants) {
  if (sonnants.length <= ALERTE_LIGNES_MAX) return { lignes: sonnants, autres: null };
  const lignes = sonnants.slice(0, ALERTE_LIGNES_MAX - 1);
  const reste = sonnants.slice(lignes.length);
  return { lignes, autres: `et ${reste.length} autres : ${reste.map((minuteur) => minuteur.libelle).join(', ')}` };
}
