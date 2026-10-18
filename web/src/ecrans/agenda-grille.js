// web/src/ecrans/agenda-grille.js
//
// Rôle    : la géométrie de la semaine en grille de l'écran Agenda (décision de Thomas du 14/10 : « un vrai
//           calendrier », comme Google Agenda en vue semaine), sans DOM : la hauteur des heures selon la rangée
//           « journée entière », la plage horaire, la place des blocs des rendez-vous à l'heure (hauteur selon la
//           durée, côte à côte quand ils se chevauchent vraiment), les lignes de la rangée journée, et ce qu'un toucher
//           vise.
// Entrées : des segments d'un jour { debut, fin } en minutes depuis minuit (heure de Paris, 0 à 1440), plus leur
//           contenu (dont personne, couleur, initiale et fiche), que placerBlocs recopie tel quel ; des barres de la
//           rangée journée { debut, fin } en numéros de jour de la semaine (0 = lundi, fin EXCLUE), plus leur contenu
//           et leur fiche ([entrées]).
// Sorties : hauteurHeures(lignesJournee) -> px de la zone des heures (828, 778 ou 732 selon 0, 1 ou 2 lignes de
//           barres) ; lignesJournee(cases) -> 0, 1 ou 2 ;
//           plageHoraire(segments) -> { debut, fin } en heures entières (7 h à 19 h, élargie de 6 h à 23 h au plus) ;
//           placerBlocs(segments, plage, hauteur) -> blocs : { type: 'bloc', ...segment } ou { type: 'plus', jour,
//           texte: '+2', personnes: [{ couleur, initiale, personne }], fiche }, chacun avec { top, hauteur } (px dans
//           la zone des heures), { gauche, largeur } (fractions de la colonne du jour), { lignes, serre, coupeHaut,
//           coupeBas } ;
//           placerJournees(barres) -> cases [{ type: 'barre', debut, fin, ligne, coupeAvant, coupeApres, ...contenu }
//           ou { type: 'plus', debut, fin, ligne, texte: '+2', fiche }] ;
//           blocTouche(blocs, jour, x, y) -> le bloc visé (x : fraction de la colonne, y : px) ou null ;
//           caseTouchee(cases, jour, ligne) -> la case de la rangée journée visée ou null.
// Pièges  :
//   - Les px sont ceux de agenda.css, qui les suit : la carte garde 828 px pour la rangée journée et les heures ; la
//     rangée journée n'en prend que ce qu'il lui faut (0 sans barre, 50 pour une ligne, 96 pour deux) et le reste va
//     aux heures (la grille tient dans les 1 080 px sans défilement : seule l'échelle change). Texte des blocs de 26 px
//     sur des lignes de 27 px, 2 px de marge en haut et en bas : de 7 h à 19 h, une heure fait 67 px dessinés sans
//     barre, 63 avec une ligne de barres, 59 avec deux, soit deux lignes de texte (« 13:00 Rendez-vous » puis
//     « kiné ») ; quand la plage s'élargit, l'échelle se tasse et un rendez-vous d'une heure peut n'avoir qu'une ligne.
//     hauteur est la hauteur DESSINÉE : 2 px de moins que la place, pour que deux rendez-vous qui se suivent ne se
//     touchent pas.
//   - Plage : 7 h à 19 h (la journée de la famille ; plus large, une heure ne tenait plus deux lignes de texte dès
//     qu'il y avait des barres de journée) ; un rendez-vous qui commence avant 7 h ou finit après 19 h l'élargit à
//     l'heure pleine, mais jamais avant 6 h ni après 23 h. Ce qui sort de la plage (un retour de soirée « fin 01:00 », un train à 5 h) est
//     collé au bord, coupé (coins carrés, coupeHaut et coupeBas), et son heure reste la vraie : la nuit vide ne tasse
//     plus toute la semaine. Un segment entièrement hors de la plage ne l'élargit pas.
//   - Chevauchements sur les VRAIES heures : deux rendez-vous qui se suivent (09:00-09:30 puis 09:30-10:00) restent
//     l'un sous l'autre, en pleine largeur ; le premier est raccourci au besoin pour ne pas couvrir le suivant. Seul un
//     rendez-vous de moins de 30 min compte pour 30 min (il ne tiendrait pas une ligne avant le suivant). Les blocs qui
//     se recouvrent, même par l'intermédiaire d'un troisième, forment une grappe : chacun prend la première colonne
//     libre ; deux colonnes au plus (une demi-colonne fait 107 px, un tiers n'aurait montré qu'une initiale) : au-delà,
//     tout ce qui n'est pas dans la première colonne est réuni dans UN bloc « +N » à droite, avec les pastilles des
//     personnes, qui ouvre la fiche en liste. Un bloc de la première colonne prend toute la largeur si rien ne le gêne
//     à droite.
//   - Hauteur minimale : 30 px dessinés (une ligne). Un bloc plus court (rendez-vous court suivi d'un autre, échelle
//     tassée) est « serré » (moins de 29 px) : sa ligne de texte prend toute sa hauteur (agenda.js pose line-height).
//   - Texte d'un bloc (agenda.js) : l'heure d'abord, puis le titre, au fil du texte sur lignes lignes (une seule :
//     ellipse sur la ligne ; plusieurs : -webkit-line-clamp).
//   - Rangée journée : LIGNES_JOURNEE lignes. Chaque barre prend la première ligne libre sur tous ses jours (les plus
//     tôt d'abord, puis les plus longues). S'il en faudrait plus, la dernière ligne montre, jour par jour, la seule
//     barre qui y reste (jours consécutifs réunis) ou « +N » quand il en reste plusieurs ; la fiche de « +N » les
//     liste.
//   - Toucher (blocTouche) : un bloc est souvent plus petit que les 96 px demandés pour un doigt (conception §1.2).
//     Le bloc sous le doigt d'abord ; sinon le plus proche au-dessus ou au-dessous dans la même colonne du jour, à
//     40 px au plus : un bloc isolé se touche donc sur au moins 110 px de haut.

const LIGNES_JOURNEE = 2;
const ZONE = 828;
const HAUTEURS_JOURNEE = [0, 50, 96];
const PLAGE_DEFAUT = { debut: 7, fin: 19 };
const PLAGE_MAX = { debut: 6, fin: 23 };
const HAUTEUR_MIN_BLOC = 32;
const ECART_BLOCS = 2;
const LIGNE_TEXTE = 27;
const MARGE_TEXTE = 4;
const MARGE_HAUT = 2;
const MINUTES_MIN_GRAPPE = 30;
const COLONNES_MAX = 2;
const TOLERANCE_PX = 40;

export const hauteurHeures = (lignes) => ZONE - HAUTEURS_JOURNEE[lignes];

export function lignesJournee(cases) {
  return cases.reduce((lignes, c) => Math.max(lignes, c.ligne + 1), 0);
}

export function plageHoraire(segments) {
  let debut = PLAGE_DEFAUT.debut;
  let fin = PLAGE_DEFAUT.fin;
  segments.forEach((s) => {
    if (s.fin > PLAGE_MAX.debut * 60) debut = Math.min(debut, Math.max(PLAGE_MAX.debut, Math.floor(s.debut / 60)));
    if (s.debut < PLAGE_MAX.fin * 60) fin = Math.max(fin, Math.min(PLAGE_MAX.fin, Math.ceil(s.fin / 60)));
  });
  return { debut, fin };
}

// Les grappes de segments qui se recouvrent (sur leurs vraies heures, 30 min au moins), chacun avec sa colonne.
function grappes(tries) {
  const toutes = [];
  let grappe = null;
  let finGrappe = -Infinity;
  tries.forEach((t) => {
    if (grappe === null || t.debut >= finGrappe) {
      grappe = { membres: [], colonnes: [] };
      toutes.push(grappe);
    }
    finGrappe = Math.max(finGrappe, t.finGrappe);
    let colonne = 0;
    while (colonne < grappe.colonnes.length && grappe.colonnes[colonne] > t.debut) colonne += 1;
    grappe.colonnes[colonne] = t.finGrappe;
    t.colonne = colonne;
    grappe.membres.push(t);
  });
  return toutes;
}

const seRecouvrent = (a, b) => a.debut < b.finGrappe && b.debut < a.finGrappe;

// Le bloc « +N » qui réunit les membres d'une grappe hors de la première colonne.
function blocPlus(groupe) {
  const personnes = [];
  groupe.forEach((t) => {
    if (personnes.every((p) => p.personne !== t.segment.personne)) {
      personnes.push({ couleur: t.segment.couleur, initiale: t.segment.initiale, personne: t.segment.personne });
    }
  });
  return {
    segment: {
      type: 'plus', jour: groupe[0].segment.jour, texte: `+${groupe.length}`, personnes, fiche: groupe.map((t) => t.segment.fiche[0]),
    },
    debut: Math.min.apply(null, groupe.map((t) => t.debut)),
    fin: Math.max.apply(null, groupe.map((t) => t.fin)),
    coupeHaut: groupe.some((t) => t.coupeHaut),
    coupeBas: groupe.some((t) => t.coupeBas),
  };
}

// Place de chaque bloc d'une grappe : { t, gauche, largeur } (t : le segment ou le bloc « +N »).
function disposer({ membres, colonnes }) {
  if (colonnes.length > COLONNES_MAX) {
    const premiers = membres.filter((t) => t.colonne === 0);
    const plus = blocPlus(membres.filter((t) => t.colonne > 0));
    const zone = { debut: plus.debut, finGrappe: Math.max(plus.fin, plus.debut + MINUTES_MIN_GRAPPE) };
    return premiers.map((t) => ({ t, gauche: 0, largeur: seRecouvrent(t, zone) ? 0.5 : 1 }))
      .concat([{ t: plus, gauche: 0.5, largeur: 0.5 }]);
  }
  return membres.map((t) => {
    const gene = membres.some((u) => u.colonne > t.colonne && seRecouvrent(t, u));
    return { t, gauche: t.colonne / colonnes.length, largeur: gene || t.colonne > 0 ? 1 / colonnes.length : 1 };
  });
}

export function placerBlocs(segments, plage, hauteur) {
  const pxMinute = hauteur / ((plage.fin - plage.debut) * 60);
  const haut = plage.debut * 60;
  const bas = plage.fin * 60;
  const tries = segments
    .map((segment) => {
      const debut = Math.min(bas, Math.max(haut, segment.debut));
      const fin = Math.min(bas, Math.max(haut, segment.fin));
      return {
        segment, debut, fin, finGrappe: Math.max(fin, debut + MINUTES_MIN_GRAPPE), coupeHaut: segment.debut < haut, coupeBas: segment.fin > bas,
      };
    })
    .sort((a, b) => a.debut - b.debut || b.fin - a.fin);
  const places = [];
  grappes(tries).forEach((grappe) => {
    disposer(grappe).forEach(({ t, gauche, largeur }) => {
      const pleine = Math.max(HAUTEUR_MIN_BLOC, Math.round((t.fin - t.debut) * pxMinute));
      places.push({
        t, gauche, largeur, pleine, top: Math.min(Math.round((t.debut - haut) * pxMinute), hauteur - pleine),
      });
    });
  });
  // Un bloc ne couvre pas le suivant qu'il a au-dessous de lui dans la même place horizontale.
  return places.map((p) => {
    const suivants = places.filter((q) => q.t.debut > p.t.debut && q.top > p.top
      && q.gauche < p.gauche + p.largeur && p.gauche < q.gauche + q.largeur);
    const place = suivants.reduce((min, q) => Math.min(min, q.top - p.top), p.pleine);
    const dessinee = place - ECART_BLOCS;
    return Object.assign({ type: 'bloc' }, p.t.segment, {
      top: p.top,
      hauteur: dessinee,
      gauche: p.gauche,
      largeur: p.largeur,
      lignes: Math.max(1, Math.floor((dessinee - MARGE_TEXTE) / LIGNE_TEXTE)),
      serre: dessinee < LIGNE_TEXTE + MARGE_HAUT,
      coupeHaut: p.t.coupeHaut,
      coupeBas: p.t.coupeBas,
    });
  });
}

const libre = (occupee, barre) => {
  for (let jour = barre.debut; jour < barre.fin; jour += 1) if (occupee[jour]) return false;
  return true;
};

// La dernière ligne quand les barres débordent : jour par jour, la barre restante seule (jours consécutifs réunis) ou
// « +N ».
function derniereLigne(restantes, ligne) {
  const cases = [];
  let suite = null;
  for (let jour = 0; jour < 7; jour += 1) {
    const ici = restantes.filter((b) => b.debut <= jour && jour < b.fin);
    const coupeApres = ici.length === 1 && (ici[0].coupeApres || ici[0].fin > jour + 1);
    if (ici.length === 1 && suite !== null && suite.barre === ici[0]) {
      suite.case.fin = jour + 1;
      suite.case.coupeApres = coupeApres;
    } else if (ici.length === 1) {
      suite = {
        barre: ici[0],
        case: Object.assign({}, ici[0], {
          debut: jour, fin: jour + 1, ligne, coupeAvant: ici[0].coupeAvant || ici[0].debut < jour, coupeApres,
        }),
      };
      cases.push(suite.case);
    } else {
      suite = null;
      if (ici.length > 1) {
        cases.push({
          type: 'plus', debut: jour, fin: jour + 1, ligne, texte: `+${ici.length}`, fiche: ici.map((b) => b.fiche[0]),
        });
      }
    }
  }
  return cases;
}

export function placerJournees(barres) {
  const triees = barres.slice().sort((a, b) => a.debut - b.debut || (b.fin - b.debut) - (a.fin - a.debut));
  const occupation = [];
  const placees = triees.map((barre) => {
    let ligne = 0;
    while (occupation[ligne] && !libre(occupation[ligne], barre)) ligne += 1;
    occupation[ligne] = occupation[ligne] || [];
    for (let jour = barre.debut; jour < barre.fin; jour += 1) occupation[ligne][jour] = true;
    return Object.assign({}, barre, { type: 'barre', ligne });
  });
  if (occupation.length <= LIGNES_JOURNEE) return placees;
  const derniere = LIGNES_JOURNEE - 1;
  return placees.filter((b) => b.ligne < derniere).concat(derniereLigne(placees.filter((b) => b.ligne >= derniere), derniere));
}

export function blocTouche(blocs, jour, x, y) {
  const colonne = blocs.filter((b) => b.jour === jour && x >= b.gauche && x <= b.gauche + b.largeur);
  const dessous = colonne.filter((b) => y >= b.top && y <= b.top + b.hauteur);
  if (dessous.length > 0) return dessous[dessous.length - 1];
  let proche = null;
  let ecart = TOLERANCE_PX;
  colonne.forEach((b) => {
    const distance = y < b.top ? b.top - y : y - (b.top + b.hauteur);
    if (distance <= ecart) {
      proche = b;
      ecart = distance;
    }
  });
  return proche;
}

export function caseTouchee(cases, jour, ligne) {
  const duJour = cases.filter((c) => c.debut <= jour && jour < c.fin);
  const visee = duJour.filter((c) => c.ligne === ligne)[0];
  if (visee) return visee;
  return duJour.length === 1 ? duJour[0] : null;
}
