// web/src/ecrans/recette-donnees.js
//
// Rôle    : calculer, sans DOM, ce que montre la recette pas à pas : l'en-tête, chaque page (une par étape, puis
//           les astuces), le minuteur et le four d'une étape ; et garder les ingrédients cochés.
// Entrées : un repas du menu (partage/schema-menu-v1.json) dont recette n'est pas null ; un numéro de page ;
//           creerCoches({ stockage (stockage.js) }) pour les ingrédients.
// Sorties : enteteRecette(repas) -> { titre, details } ; nombrePages(recette) ; bornerPage(recette, index) ;
//           vuePage(recette, index) -> { index, numero (« Étape 3/7 » ou « Astuces »), texte, four, minuteur,
//           astuces, precedent, suivant } avec minuteur = { libelle, dureeMs, surplusMs, texte } ou null et four
//           = « Four 210 °C » / « Gril 220 °C » ou null ;
//           creerCoches(...) -> { lire(cycle, repasId) -> tableau d'indices cochés, basculer(cycle, repasId, i) }.
// Pièges  :
//   - « Étape 3/7 » compte les étapes seulement ; la page des astuces vient après la dernière étape, et
//     seulement s'il y en a.
//   - Minuteur « 35 à 40 min » (duree_s 2100, duree_max_s 2400) : lancé pour 35 min, et la sonnerie proposera
//     « Encore 5 min » (surplusMs).
//   - Coches gardées par recette (id du repas) dans localStorage, et remises à zéro au changement de cycle :
//     les ids d'une autre semaine ne se mélangent pas (un même jour revient chaque année, pas le même plat).
//   - Ce qui est relu du stockage est revalidé (indices entiers dans la liste) : une entrée abîmée est ignorée.

import { texteDuree } from '../heure.js';
import { texteDureeCourte } from '../minuteurs.js';

const CLE_COCHES = 'ingredients';

export function enteteRecette(repas) {
  const recette = repas.recette;
  const temps = [];
  if (recette.preparation_min > 0) temps.push(`préparation ${texteDuree(recette.preparation_min * 60000)}`);
  if (recette.cuisson_min > 0) temps.push(`cuisson ${texteDuree(recette.cuisson_min * 60000)}`);
  return { titre: repas.titre, details: [recette.portions].concat(temps).join(' · ') };
}

const astucesDe = (recette) => recette.astuces || [];

export function nombrePages(recette) {
  return recette.etapes.length + (astucesDe(recette).length > 0 ? 1 : 0);
}

export function bornerPage(recette, index) {
  return Math.max(0, Math.min(nombrePages(recette) - 1, index));
}

function texteFour(four) {
  if (!four) return null;
  return `${four.gril ? 'Gril' : 'Four'} ${four.temperature_c} °C`;
}

function minuteurEtape(minuteur) {
  if (!minuteur) return null;
  const dureeMs = minuteur.duree_s * 1000;
  return {
    libelle: minuteur.libelle,
    dureeMs,
    surplusMs: minuteur.duree_max_s ? (minuteur.duree_max_s - minuteur.duree_s) * 1000 : 0,
    texte: `Lancer ${minuteur.libelle} ${texteDureeCourte(dureeMs)}`,
  };
}

export function vuePage(recette, index) {
  const page = bornerPage(recette, index);
  const total = nombrePages(recette);
  const commun = { index: page, precedent: page > 0, suivant: page < total - 1 };
  if (page >= recette.etapes.length) {
    return Object.assign(commun, { numero: 'Astuces', texte: '', four: null, minuteur: null, astuces: astucesDe(recette) });
  }
  const etape = recette.etapes[page];
  return Object.assign(commun, {
    numero: `Étape ${page + 1}/${recette.etapes.length}`,
    texte: etape.texte,
    four: texteFour(etape.four),
    minuteur: minuteurEtape(etape.minuteur),
    astuces: null,
  });
}

export function creerCoches({ stockage }) {
  function lireTout(cycle) {
    const lu = stockage.lire(CLE_COCHES);
    const valide = lu && lu.cycle === cycle && lu.recettes && typeof lu.recettes === 'object';
    return valide ? lu : { cycle, recettes: {} };
  }

  function lire(cycle, repasId) {
    const coches = lireTout(cycle).recettes[repasId];
    return Array.isArray(coches) ? coches.filter((i) => Number.isInteger(i) && i >= 0) : [];
  }

  return {
    lire,
    basculer(cycle, repasId, index) {
      const tout = lireTout(cycle);
      const coches = lire(cycle, repasId);
      const position = coches.indexOf(index);
      if (position === -1) coches.push(index);
      else coches.splice(position, 1);
      tout.recettes[repasId] = coches;
      stockage.ecrire(CLE_COCHES, tout);
      return coches;
    },
  };
}
