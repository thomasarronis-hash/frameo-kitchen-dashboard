// web/src/dom.js
//
// Rôle    : petites aides de construction et de mise à jour du DOM, partagées par les composants.
// Entrées : nom de balise, classe, texte ; nom d'un symbole de web/public/icones.svg.
// Sorties : element(balise, classe, texte) ; icone(nom, classe) ; changerIcone(svg, nom) ; ecrire(noeud, texte) ;
//           masquer(noeud, masque) ; etiqueter(noeud, texte) (aria-label).
// Pièges  :
//   - Une icône SVG se crée avec createElementNS, sinon elle ne s'affiche pas ; la classe d'un élément SVG
//     se pose par setAttribute (className y est un objet, pas une chaîne).
//   - Une icône pointe vers un symbole posé DANS la page (#id) par sprite.js, jamais vers le fichier externe
//     (/icones.svg#id) : la WebView du cadre gardait l'ancien fichier en mémoire après un déploiement (16/10).
//   - changerIcone, ecrire, masquer et etiqueter ne touchent au DOM que si la valeur change : la page se
//     redessine à chaque minute et à chaque message du flux, le bandeau et le menu à chaque seconde, sans
//     recalcul de style inutile. Écrire hidden = true sur un élément déjà masqué repose l'attribut (mutation
//     et recalcul de style dans Chromium) : d'où masquer().
//   - icone(null) donne une icône vide et masquée : un ciel inconnu n'affiche rien plutôt qu'un faux picto.

const NS_SVG = 'http://www.w3.org/2000/svg';

export function element(balise, classe, texte) {
  const noeud = document.createElement(balise);
  if (classe) noeud.className = classe;
  if (texte !== undefined) noeud.textContent = texte;
  return noeud;
}

export function changerIcone(svg, nom) {
  if (svg.getAttribute('data-icone') === String(nom)) return;
  svg.setAttribute('data-icone', String(nom));
  if (nom) svg.firstChild.setAttribute('href', `#${nom}`);
  else svg.firstChild.removeAttribute('href');
  svg.style.visibility = nom ? '' : 'hidden';
}

export function icone(nom, classe) {
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('class', classe ? `ico ${classe}` : 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.appendChild(document.createElementNS(NS_SVG, 'use'));
  changerIcone(svg, nom);
  return svg;
}

export function ecrire(noeud, texte) {
  if (noeud.textContent !== texte) noeud.textContent = texte;
}

export function masquer(noeud, masque) {
  if (noeud.hidden !== masque) noeud.hidden = masque;
}

export function etiqueter(noeud, texte) {
  if (noeud.getAttribute('aria-label') !== texte) noeud.setAttribute('aria-label', texte);
}
