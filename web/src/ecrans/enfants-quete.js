// web/src/ecrans/enfants-quete.js
//
// Rôle    : le chemin de la quête du matin de Timo (variante B « les quêtes », choix de Thomas du 14/10) : une case ronde par
//           étape (pictogramme dessiné au trait, pièce « +5 », cadenas des étapes qu'un parent valide), son avatar posé sur
//           la case en cours, le coffre au bout, la barre discrète du temps jusqu'au départ (sauge) et le bouton « Annuler »
//           des 5 s qui suivent une coche.
// Entrées : creerChemin(parent, { cocher(id, noeud), annuler(id) }) ; mettreAJour(vue de quete-donnees.js vueQuete, visage
//           de l'enfant d'enfants-donnees.js, ms) ; entretenir(ms, vue) chaque seconde (barre du temps, fin de l'annulation).
// Sorties : { racine, mettreAJour(vue, visage, ms), entretenir(ms, vue), caseDe(id) -> nœud de la case, coffre }.
// Pièges  :
//   - Géométrie fixe (scène de 1920x1080, carte de 1 304 x 888) : les cases sont réparties sur deux rangées en S (aller de
//     gauche à droite, retour de droite à gauche), coffre compris, quel que soit le nombre d'étapes (7 au plus, barème) ;
//     le tracé pointillé passe par leurs centres (Catmull-Rom converti en courbes de Bézier). Cases de 200 px, cibles bien
//     au-delà des 96 px (conception §1.2), libellé de 30 px sous chacune.
//   - Valider = appui long d'une seconde avec un anneau qui se remplit (anneau.js, appui.js) ; un toucher court ne fait
//     rien. Une étape déjà cochée, en attente, pas encore permise (« Levé » avant 6 h 30) ou passée (routine finie)
//     n'envoie rien.
//   - Vue préconstruite pour 7 cases au plus (barème) : une mise à jour ne change que classes, textes, icônes, hidden et la
//     position de l'avatar (transform, avec transition : il saute d'une case à l'autre). L'avatar se pose en haut à gauche
//     de sa case : à droite, il cacherait le cadenas des étapes qu'un parent valide.
//   - Rien de punitif : pas de croix, pas de rouge ; « à faire » est une case blanche, « en attente » un contour en
//     pointillés et le sablier dans le cadenas, « passée » (pas faite à la fin de la routine) une case grise.

import { creerAvatar } from '../composants/avatar.js';
import { creerAnneau } from '../composants/anneau.js';
import { surAppui, surAppuiLong } from '../composants/appui.js';
import {
  changerIcone, ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';

const NS_SVG = 'http://www.w3.org/2000/svg';
const CASES_MAX = 7;
const LARGEUR = 1304;
const RANGEES = [330, 690];
const MARGE_X = 170;
const VAGUE = 24;
const AVATAR_AU_DESSUS = 196;
const AVATAR_A_GAUCHE = 120;
const STATUTS = ['a_faire', 'attente', 'valide'];
const ETATS = { a_faire: 'à faire', attente: 'en attente d\'un parent', valide: 'fait' };

// Centres des cases puis du coffre (n étapes + 1), en S sur deux rangées.
export function positions(nombre) {
  const total = nombre + 1;
  const premiere = Math.ceil(total / 2);
  const points = [];
  for (let i = 0; i < total; i += 1) {
    const rangee = i < premiere ? 0 : 1;
    const dansRangee = rangee === 0 ? i : i - premiere;
    const compte = rangee === 0 ? premiere : total - premiere;
    const pas = compte > 1 ? (LARGEUR - 2 * MARGE_X) / (compte - 1) : 0;
    const x = rangee === 0 ? MARGE_X + dansRangee * pas : LARGEUR - MARGE_X - (compte === 1 ? (LARGEUR - 2 * MARGE_X) / 2 : dansRangee * pas);
    points.push({ x: Math.round(x), y: RANGEES[rangee] + (i % 2 === 0 ? -VAGUE : VAGUE) });
  }
  return points;
}

// Tracé lissé (Catmull-Rom) qui passe par chaque point, avec un détour à droite entre les deux rangées.
export function trace(points) {
  const premiere = Math.ceil(points.length / 2);
  const chemin = [{ x: 40, y: points[0].y }].concat(points.slice(0, premiere));
  if (points.length > premiere) chemin.push({ x: LARGEUR - 40, y: (RANGEES[0] + RANGEES[1]) / 2 });
  const suite = chemin.concat(points.slice(premiere));
  let d = `M${suite[0].x} ${suite[0].y}`;
  for (let i = 0; i < suite.length - 1; i += 1) {
    const p0 = suite[Math.max(0, i - 1)];
    const p1 = suite[i];
    const p2 = suite[i + 1];
    const p3 = suite[Math.min(suite.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${Math.round(c1.x)} ${Math.round(c1.y)} ${Math.round(c2.x)} ${Math.round(c2.y)} ${p2.x} ${p2.y}`;
  }
  return d;
}

function construireCase(conteneur, actions) {
  const bouton = element('button', 'quete-case');
  bouton.type = 'button';
  const disque = element('span', 'quete-disque');
  const picto = icone(null, 'quete-picto');
  disque.appendChild(picto);
  bouton.appendChild(creerAnneau());
  bouton.appendChild(disque);
  const piece = element('span', 'quete-piece chiffres');
  const cadenas = element('span', 'quete-cadenas');
  const iconeCadenas = icone('i-cadenas', 'quete-cadenas-icone');
  cadenas.appendChild(iconeCadenas);
  const libelle = element('span', 'quete-libelle');
  const tot = element('span', 'quete-tot');
  tot.appendChild(icone('i-moon', 'quete-tot-icone'));
  const totTexte = element('span', '');
  tot.appendChild(totTexte);
  [piece, cadenas, libelle, tot].forEach((noeud) => bouton.appendChild(noeud));
  conteneur.appendChild(bouton);
  const etat = { id: null, permis: false };
  surAppuiLong(bouton, {
    court: () => {},
    long: () => {
      if (etat.permis) actions.cocher(etat.id, bouton);
    },
  });
  return {
    bouton, picto, piece, cadenas, iconeCadenas, libelle, tot, totTexte, etat,
  };
}

function rendreCase(n, vue, point) {
  n.etat.id = vue.id;
  n.etat.permis = vue.statut === 'a_faire' && vue.tot === null && !vue.passee;
  const gauche = `${point.x - 100}px`;
  const haut = `${point.y - 100}px`;
  if (n.bouton.style.left !== gauche) n.bouton.style.left = gauche;
  if (n.bouton.style.top !== haut) n.bouton.style.top = haut;
  changerIcone(n.picto, vue.picto);
  ecrire(n.piece, vue.valeur);
  ecrire(n.libelle, vue.libelle);
  masquer(n.cadenas, !vue.parent);
  changerIcone(n.iconeCadenas, vue.statut === 'attente' ? 'i-sablier' : 'i-cadenas');
  masquer(n.tot, vue.tot === null);
  ecrire(n.totTexte, vue.tot || '');
  STATUTS.forEach((statut) => n.bouton.classList.toggle(`quete-case-${statut}`, vue.statut === statut));
  n.bouton.classList.toggle('quete-case-en-cours', vue.enCours);
  n.bouton.classList.toggle('quete-case-tot', vue.tot !== null);
  n.bouton.classList.toggle('quete-case-passee', vue.passee);
  etiqueter(n.bouton, `${vue.libelle}, ${vue.valeur} minutes, ${vue.passee ? 'fini pour ce matin' : ETATS[vue.statut]}`);
}

function construireTemps(carte) {
  const temps = element('div', 'quete-temps');
  const piste = element('span', 'quete-temps-piste');
  const reste = element('span', 'quete-temps-reste');
  piste.appendChild(reste);
  const heure = element('span', 'quete-temps-heure chiffres');
  temps.appendChild(piste);
  temps.appendChild(heure);
  carte.appendChild(temps);
  return { temps, reste, heure };
}

function construireAnnuler(carte, actions) {
  const bouton = element('button', 'quete-annuler bouton-doux');
  bouton.type = 'button';
  const picto = icone(null, 'quete-annuler-picto');
  bouton.appendChild(picto);
  bouton.appendChild(icone('i-back', 'bouton-fort-icone'));
  bouton.appendChild(element('span', '', 'Annuler'));
  const barre = element('span', 'quete-annuler-barre');
  bouton.appendChild(barre);
  bouton.hidden = true;
  carte.appendChild(bouton);
  let id = null;
  let jusqua = 0;
  surAppui(bouton, () => {
    if (id) actions.annuler(id);
  });
  return {
    mettreAJour(annulation, ms) {
      masquer(bouton, annulation === null);
      if (!annulation) {
        id = null;
        return;
      }
      changerIcone(picto, annulation.picto);
      if (annulation.id !== id || annulation.jusqua !== jusqua) {
        id = annulation.id;
        jusqua = annulation.jusqua;
        barre.style.transition = 'none';
        barre.style.transform = `scaleX(${Math.max(0, Math.min(1, (jusqua - ms) / 5000))})`;
        if (typeof barre.getBoundingClientRect === 'function') barre.getBoundingClientRect();
        barre.style.transition = `transform ${Math.max(0, jusqua - ms)}ms linear`;
        barre.style.transform = 'scaleX(0)';
      }
    },
  };
}

export function creerChemin(parent, actions) {
  const racine = element('div', 'carte quete-carte');
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('class', 'quete-trace');
  svg.setAttribute('viewBox', `0 0 ${LARGEUR} 888`);
  svg.setAttribute('aria-hidden', 'true');
  const ligne = document.createElementNS(NS_SVG, 'path');
  svg.appendChild(ligne);
  racine.appendChild(svg);
  const temps = construireTemps(racine);
  const coffre = element('div', 'quete-coffre');
  const dessinCoffre = icone('i-coffre', 'quete-coffre-dessin');
  coffre.appendChild(dessinCoffre);
  racine.appendChild(coffre);
  const cases = [];
  for (let i = 0; i < CASES_MAX; i += 1) cases.push(construireCase(racine, actions));
  const avatar = creerAvatar('quete-avatar');
  racine.appendChild(avatar.racine);
  const annuler = construireAnnuler(racine, actions);
  parent.appendChild(racine);
  let nombre = -1;
  let points = [];

  function entretenir(ms, vue) {
    masquer(temps.temps, vue.temps === null);
    if (vue.temps) {
      const echelle = `scaleX(${vue.temps.fraction.toFixed(4)})`;
      if (temps.reste.style.transform !== echelle) temps.reste.style.transform = echelle;
      ecrire(temps.heure, vue.temps.heure);
    }
    annuler.mettreAJour(vue.annulation, ms);
  }

  return {
    racine,
    coffre,
    caseDe(id) {
      const trouvee = cases.filter((n) => n.etat.id === id)[0];
      return trouvee ? trouvee.bouton : null;
    },
    mettreAJour(vue, visage, ms) {
      if (vue.cases.length !== nombre) {
        nombre = vue.cases.length;
        points = positions(nombre);
        ligne.setAttribute('d', trace(points));
        coffre.style.left = `${points[nombre].x - 130}px`;
        coffre.style.top = `${points[nombre].y - 110}px`;
      }
      cases.forEach((n, i) => {
        masquer(n.bouton, i >= nombre);
        if (i < nombre) rendreCase(n, vue.cases[i], points[i]);
      });
      changerIcone(dessinCoffre, vue.coffre.ouvert ? 'i-coffreouvert' : 'i-coffre');
      coffre.classList.toggle('quete-coffre-ouvert', vue.coffre.ouvert);
      etiqueter(coffre, vue.coffre.ouvert ? 'Coffre ouvert' : 'Coffre fermé');
      avatar.mettreAJour({ ...visage, fini: false });
      const ici = points[Math.min(vue.avatar, nombre)];
      const transformation = `translate(${ici.x - AVATAR_A_GAUCHE}px, ${ici.y - AVATAR_AU_DESSUS}px)`;
      if (avatar.racine.style.transform !== transformation) avatar.racine.style.transform = transformation;
      entretenir(ms, vue);
    },
    entretenir,
  };
}
