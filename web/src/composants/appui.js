// web/src/composants/appui.js
//
// Rôle    : les gestes des ACTIONS (cocher, étapes, minuteurs, boutons de confirmation) selon la conception §1.2 :
//           déclenchement au lever du doigt (pointerup), seulement si le doigt a bougé de moins de 20 px, et pas
//           deux fois en 300 ms (doigts mouillés, touches fantômes) ; et l'appui long d'une seconde (supprimer un
//           article), prévu en appui-long.js au §3.2 et réuni ici parce que c'est la même machine à états.
// Entrées : creerGeste({ monotone, garde, tolerancePx }) : horloge monotone en ms (performance.now, une fausse dans les
//           tests), garde = anti-répétition partagée (creerGarde), propre au geste si absente, tolérance 20 px par défaut ;
//           surAppui(noeud, action, garde) ; surAppuiLong(noeud, { court, long, dureeMs, tolerancePx, retour }, garde)
//           (par défaut : une seconde, 20 px, avec retour ; le geste parent, composants/geste-parent.js, prend 3 s, 40 px
//           et aucun retour).
// Sorties : creerGeste(...) -> { poser(x, y), bouger(x, y) -> vrai quand le geste vient d'être annulé (doigt
//           parti au-delà de la tolérance), lever(x, y) -> vrai si l'appui court compte,
//           long() -> vrai si l'appui long se déclenche, annuler() } ; surAppui et surAppuiLong branchent ces
//           gestes sur les événements pointer d'un nœud ; creerGarde() ; ANTI_REPETITION_MS (300 ms).
// Pièges  :
//   - La NAVIGATION (menu, ouvrir un écran) reste sur pointerdown, ailleurs (règle de Wes) : un écran ouvert au
//     poser du doigt reçoit le lever sur un de ses boutons, qui ne réagit pas puisqu'il n'a pas vu le poser.
//   - Au toucher, Chromium capture le pointeur sur l'élément du poser : le lever arrive au même nœud même hors
//     de lui, d'où le contrôle de distance. Un défilement (liste des courses) envoie pointercancel : annulé.
//   - Après un appui long, le lever ne déclenche pas l'appui court.
//   - Page cachée pendant un appui long (Réglages d'Android ouverts, écran éteint) : annulé à visibilitychange, sinon
//     le minuteur, gelé en arrière-plan, partirait au retour alors que le doigt est levé depuis longtemps. L'écouteur
//     n'existe que pendant l'appui. Aucun état ne survit à un appui perdu : le poser suivant repart de zéro.
//   - Capture du pointeur perdue (lostpointercapture : nœud retiré de la page, capture relâchée) : annulé aussi. Celle
//     qui suit un lever normal ne fait rien (appui déjà fini). Un nœud seulement MASQUÉ garde la capture : l'écran qui
//     le porte vérifie lui-même qu'il est encore affiché quand le geste aboutit (ecrans/enfants.js).
//   - Appui long suivi par son doigt (pointerId) : un DEUXIÈME doigt posé sur le même nœud pendant l'appui l'annule sans
//     le relancer ; les mouvements, lever et annulation d'un autre doigt sont ignorés. Rien ne survit à l'échéance : une
//     fois l'appui fini (lever, minuteur, doigt parti), le poser suivant repart de zéro, quel que soit son doigt.
//   - Pendant l'appui long, la classe appui-long-en-cours est posée (remplissage d'une seconde en transform,
//     dans les feuilles ; anneau qui se remplit sur les cases rondes des enfants, anneau.css) : on voit que quelque
//     chose se prépare. La durée du remplissage est écrite dans la feuille, celle du geste ici : les deux vont ensemble.
//     retour: false ne pose rien (geste parent).
//   - Le minuteur de l'appui long est un setTimeout lié au geste, pas un tick de rendu : il ne contredit pas la
//     règle du tick unique.
//   - Une LISTE dont les lignes peuvent bouger après un geste (articles de courses, minuteurs du tiroir) donne la
//     même garde à toutes ses lignes : sans elle, chaque ligne a sa propre anti-répétition, et une touche
//     fantôme sur la ligne qui vient de prendre la place de la précédente passerait.

const TOLERANCE_PX = 20;
export const ANTI_REPETITION_MS = 300;
const DUREE_APPUI_LONG_MS = 1000;
const CLASSE_EN_COURS = 'appui-long-en-cours';
const monotonePage = () => performance.now();

export function creerGarde() {
  return { dernier: -Infinity };
}

export function creerGeste({ monotone, garde = creerGarde(), tolerancePx = TOLERANCE_PX }) {
  let pose = null;
  let annule = false;
  let longDeclenche = false;

  const loin = (x, y) => Math.abs(x - pose.x) > tolerancePx || Math.abs(y - pose.y) > tolerancePx;

  return {
    poser(x, y) {
      pose = { x, y };
      annule = false;
      longDeclenche = false;
    },
    bouger(x, y) {
      if (!pose || annule || !loin(x, y)) return false;
      annule = true;
      return true;
    },
    long() {
      if (!pose || annule || longDeclenche) return false;
      longDeclenche = true;
      garde.dernier = monotone();
      return true;
    },
    lever(x, y) {
      if (!pose) return false;
      const compte = !annule && !longDeclenche && !loin(x, y) && monotone() - garde.dernier >= ANTI_REPETITION_MS;
      pose = null;
      if (compte) garde.dernier = monotone();
      return compte;
    },
    annuler() {
      pose = null;
    },
  };
}

export function surAppui(noeud, action, garde) {
  const geste = creerGeste({ monotone: monotonePage, garde });
  noeud.addEventListener('pointerdown', (e) => geste.poser(e.clientX, e.clientY));
  noeud.addEventListener('pointermove', (e) => geste.bouger(e.clientX, e.clientY));
  noeud.addEventListener('pointerup', (e) => {
    if (geste.lever(e.clientX, e.clientY)) action(e);
  });
  noeud.addEventListener('pointercancel', () => geste.annuler());
}

export function surAppuiLong(noeud, {
  court, long, dureeMs = DUREE_APPUI_LONG_MS, tolerancePx = TOLERANCE_PX, retour = true,
}, garde) {
  const geste = creerGeste({ monotone: monotonePage, garde, tolerancePx });
  let minuteur = null;
  let doigt = null;
  const autreDoigt = (e) => e.pointerId !== doigt;

  function finir() {
    clearTimeout(minuteur);
    minuteur = null;
    document.removeEventListener('visibilitychange', siCachee);
    if (retour) noeud.classList.remove(CLASSE_EN_COURS);
  }
  function annuler() {
    finir();
    geste.annuler();
  }
  function siCachee() {
    if (document.hidden) annuler();
  }
  function siMemeDoigt(rappel) {
    return (e) => {
      if (!autreDoigt(e)) rappel(e);
    };
  }

  noeud.addEventListener('pointerdown', (e) => {
    if (minuteur !== null) {
      annuler();
      return;
    }
    doigt = e.pointerId;
    geste.poser(e.clientX, e.clientY);
    document.addEventListener('visibilitychange', siCachee);
    if (retour) noeud.classList.add(CLASSE_EN_COURS);
    minuteur = setTimeout(() => {
      finir();
      if (geste.long()) long();
    }, dureeMs);
  });
  noeud.addEventListener('pointermove', siMemeDoigt((e) => {
    if (geste.bouger(e.clientX, e.clientY)) finir();
  }));
  noeud.addEventListener('pointerup', siMemeDoigt((e) => {
    finir();
    if (geste.lever(e.clientX, e.clientY)) court();
  }));
  noeud.addEventListener('pointercancel', siMemeDoigt(annuler));
  noeud.addEventListener('lostpointercapture', siMemeDoigt(annuler));
}
