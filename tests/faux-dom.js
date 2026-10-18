// tests/faux-dom.js
//
// Rôle    : un faux DOM minimal pour tester sous Node les écrans qui construisent leurs nœuds (photos, maison, wifi,
//           bandeau sonnette, télécommandes, Accueil, Aujourd'hui, Agenda et Météo) : assez pour web/src/dom.js et les
//           composants, rien de plus (aucune mise en page calculée : le rectangle d'un nœud est celui que le test lui
//           donne, pour l'Agenda qui vise un rendez-vous d'après la position du doigt).
// Entrées : installerFauxDom() avant d'appeler un constructeur d'écran (pose globalThis.document) ; les nœuds rendus.
// Sorties : installerFauxDom() -> { document, conteneur } ; parClasse(racine, classe) -> les nœuds qui portent la classe,
//           dans l'ordre du document ; imagesChargees(racine) -> les <img> qui ont un src ; texte(noeud) ; appuyer(noeud,
//           x, y) (pointerdown puis pointerup au même endroit, en 10, 10 par défaut) ; poser(noeud, x, y),
//           bouger(noeud, x, y), lever(noeud, x, y) et annulerDoigt(noeud) (pointercancel) séparément (appui long) ;
//           cacherPage() (document.hidden puis visibilitychange : l'appli passe en arrière-plan) ; noeud.rectangle =
//           { left, top, width, height }, rendu par getBoundingClientRect().
// Pièges  :
//   - Pas de propagation des événements : les écouteurs sont posés sur les nœuds eux-mêmes par les composants. Un test
//     déclenche donc sur le nœud qui porte l'écouteur, et stopPropagation() ne fait rien.
//   - Le document a ses propres écouteurs (visibilitychange) ; une page neuve est visible à chaque installerFauxDom().
//   - src d'une image et attribut src sont le même champ (comme dans un navigateur) ; aucun chargement réel : un test
//     déclenche lui-même load ou error (declencher).
//   - textContent écrit remplace les enfants, comme dans un navigateur.

class FauxNoeud {
  constructor(balise) {
    this.tagName = balise.toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.attributs = {};
    this.ecouteurs = {};
    this.hidden = false;
    this.style = {};
    this.texteDirect = '';
    const classes = new Set();
    const noeud = this;
    this.classList = {
      add: (...noms) => noms.forEach((nom) => classes.add(nom)),
      remove: (...noms) => noms.forEach((nom) => classes.delete(nom)),
      toggle: (nom, force) => {
        const mettre = force === undefined ? !classes.has(nom) : Boolean(force);
        if (mettre) classes.add(nom);
        else classes.delete(nom);
        return mettre;
      },
      contains: (nom) => classes.has(nom),
    };
    Object.defineProperty(this, 'className', {
      get: () => [...classes].join(' '),
      set: (valeur) => {
        classes.clear();
        String(valeur).split(/\s+/).filter(Boolean).forEach((nom) => classes.add(nom));
      },
    });
    Object.defineProperty(this, 'src', {
      get: () => noeud.attributs.src || '',
      set: (valeur) => { noeud.attributs.src = String(valeur); },
    });
  }

  get firstChild() { return this.childNodes[0] || null; }

  get textContent() { return this.texteDirect + this.childNodes.map((enfant) => enfant.textContent).join(''); }

  set textContent(valeur) {
    this.childNodes.forEach((enfant) => { enfant.parentNode = null; });
    this.childNodes = [];
    this.texteDirect = String(valeur);
  }

  appendChild(enfant) {
    if (enfant.parentNode) enfant.parentNode.removeChild(enfant);
    enfant.parentNode = this;
    this.childNodes.push(enfant);
    return enfant;
  }

  removeChild(enfant) {
    this.childNodes = this.childNodes.filter((n) => n !== enfant);
    enfant.parentNode = null;
    return enfant;
  }

  contains(autre) {
    for (let n = autre; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  setAttribute(nom, valeur) {
    if (nom === 'class') this.className = valeur;
    else this.attributs[nom] = String(valeur);
  }

  getAttribute(nom) {
    if (nom === 'class') return this.className;
    return Object.prototype.hasOwnProperty.call(this.attributs, nom) ? this.attributs[nom] : null;
  }

  hasAttribute(nom) { return this.getAttribute(nom) !== null; }

  removeAttribute(nom) { delete this.attributs[nom]; }

  addEventListener(type, rappel) { (this.ecouteurs[type] = this.ecouteurs[type] || []).push(rappel); }

  removeEventListener(type, rappel) { this.ecouteurs[type] = (this.ecouteurs[type] || []).filter((r) => r !== rappel); }

  declencher(type, champs = {}) {
    const evenement = {
      type, target: this, clientX: 0, clientY: 0, stopPropagation() {}, ...champs,
    };
    (this.ecouteurs[type] || []).slice().forEach((rappel) => rappel(evenement));
  }

  decode() { return Promise.resolve(); }

  getBoundingClientRect() {
    return this.rectangle || {
      left: 0, top: 0, width: 0, height: 0,
    };
  }
}

export function installerFauxDom() {
  const page = new FauxNoeud('#document');
  const document = {
    hidden: false,
    createElement: (balise) => new FauxNoeud(balise),
    createElementNS: (_ns, balise) => new FauxNoeud(balise),
    addEventListener: (type, rappel) => page.addEventListener(type, rappel),
    removeEventListener: (type, rappel) => page.removeEventListener(type, rappel),
    declencher: (type) => page.declencher(type),
  };
  globalThis.document = document;
  return { document, conteneur: new FauxNoeud('div') };
}

function parcourir(racine, rappel) {
  rappel(racine);
  racine.childNodes.forEach((enfant) => parcourir(enfant, rappel));
}

export function parClasse(racine, classe) {
  const trouves = [];
  parcourir(racine, (n) => { if (n.classList.contains(classe)) trouves.push(n); });
  return trouves;
}

export function imagesChargees(racine) {
  const images = [];
  parcourir(racine, (n) => { if (n.tagName === 'IMG' && n.hasAttribute('src')) images.push(n); });
  return images;
}

export const texte = (noeud) => noeud.textContent;

export function poser(noeud, x = 10, y = 10) {
  noeud.declencher('pointerdown', { clientX: x, clientY: y });
}

export function bouger(noeud, x, y) {
  noeud.declencher('pointermove', { clientX: x, clientY: y });
}

export function lever(noeud, x = 10, y = 10) {
  noeud.declencher('pointerup', { clientX: x, clientY: y });
}

export function annulerDoigt(noeud) {
  noeud.declencher('pointercancel');
}

export function cacherPage() {
  globalThis.document.hidden = true;
  globalThis.document.declencher('visibilitychange');
}

export function appuyer(noeud, x = 10, y = 10) {
  poser(noeud, x, y);
  lever(noeud, x, y);
}
