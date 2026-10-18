// web/src/ecrans/enfants-boutique.js
//
// Rôle    : les points de Timo et sa boutique (choix de Thomas du 14/10) : à gauche son total (étoile et nombre en très
//           grand) et ses derniers gains (« A rangé +1 », « Bravo ! +1 ») ; à droite les trois récompenses, dessinées de plus
//           en plus grandes, avec leur prix, une jauge et « encore 12 », ou « Je veux ça » (appui long) qui crée une demande,
//           puis « En attente d'un parent ».
// Entrées : creerBoutique(parent, { demander(cadeau) }) ; mettreAJour(vue de boutique-donnees.js vueBoutique).
// Sorties : { racine, solde (nœud du grand nombre, qui rebondit quand il monte), mettreAJour(vue) }.
// Pièges  :
//   - Vue préconstruite (5 gains, 3 cadeaux, la boutique du barème en a 10 au plus mais Thomas en a choisi 3 : les cadeaux
//     au-delà de 3 ne sont pas montrés, voir la conception).
//   - « Je veux ça » seulement quand le solde suffit ; une demande en attente se voit sur SON cadeau (sablier), les autres
//     restent demandables (la nouvelle demande remplace l'ancienne, serveur). Rien ne montre un retrait de points.
//   - Jauge en transform: scaleX, posée seulement si elle change.

import { surAppuiLong } from '../composants/appui.js';
import {
  changerIcone, ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';

const GAINS_MAX = 5;
const CADEAUX_MAX = 3;

function construireGain(liste) {
  const ligne = element('li', 'boutique-gain');
  const picto = icone(null, 'boutique-gain-picto');
  const texte = element('span', 'boutique-gain-texte');
  const valeur = element('span', 'boutique-gain-valeur chiffres');
  [picto, texte, valeur].forEach((noeud) => ligne.appendChild(noeud));
  liste.appendChild(ligne);
  return {
    ligne, picto, texte, valeur,
  };
}

function construireCadeau(parent, actions) {
  const carte = element('article', 'carte boutique-cadeau');
  const picto = icone(null, 'boutique-cadeau-picto');
  const libelle = element('p', 'boutique-cadeau-nom');
  const prix = element('p', 'boutique-cadeau-prix');
  prix.appendChild(icone('i-etoile', 'boutique-etoile-petite'));
  const prixTexte = element('span', 'chiffres');
  prix.appendChild(prixTexte);
  const jauge = element('span', 'boutique-jauge');
  const niveau = element('span', 'boutique-jauge-niveau');
  jauge.appendChild(niveau);
  const manque = element('p', 'boutique-manque');
  const vouloir = element('button', 'bouton-fort boutique-vouloir');
  vouloir.type = 'button';
  vouloir.appendChild(icone('i-cadeau', 'bouton-fort-icone'));
  vouloir.appendChild(element('span', '', 'Je veux ça'));
  const attente = element('p', 'boutique-attente');
  attente.appendChild(icone('i-sablier', 'boutique-attente-icone'));
  attente.appendChild(element('span', '', 'En attente d\'un parent'));
  [picto, libelle, prix, jauge, manque, vouloir, attente].forEach((noeud) => carte.appendChild(noeud));
  parent.appendChild(carte);
  const etat = { id: null };
  surAppuiLong(vouloir, { court: () => {}, long: () => actions.demander(etat.id, vouloir) });
  return {
    carte, picto, libelle, prixTexte, niveau, manque, vouloir, attente, etat,
  };
}

function rendreCadeau(n, cadeau) {
  n.etat.id = cadeau.id;
  changerIcone(n.picto, cadeau.picto);
  ['1', '2', '3'].forEach((taille) => n.picto.classList.toggle(`boutique-taille-${taille}`, String(cadeau.taille) === taille));
  ecrire(n.libelle, cadeau.libelle);
  ecrire(n.prixTexte, String(cadeau.prix));
  const echelle = `scaleX(${cadeau.fraction.toFixed(3)})`;
  if (n.niveau.style.transform !== echelle) n.niveau.style.transform = echelle;
  masquer(n.manque, cadeau.manque === null);
  ecrire(n.manque, cadeau.manque || '');
  masquer(n.vouloir, !cadeau.possible || cadeau.demande);
  masquer(n.attente, !cadeau.demande);
  n.carte.classList.toggle('boutique-cadeau-possible', cadeau.possible);
  n.carte.classList.toggle('boutique-cadeau-demande', cadeau.demande);
  etiqueter(n.carte, `${cadeau.libelle}, ${cadeau.prix} points`);
}

export function creerBoutique(parent, actions) {
  const racine = element('div', 'boutique');
  const gauche = element('section', 'carte boutique-points');
  const total = element('div', 'boutique-total');
  total.appendChild(icone('i-etoile', 'boutique-etoile'));
  const solde = element('p', 'boutique-solde chiffres chiffres-affiche');
  total.appendChild(solde);
  gauche.appendChild(total);
  gauche.appendChild(element('h2', 'intitule boutique-intitule', 'Bravo'));
  const vide = element('p', 'boutique-vide', 'Pas encore de points');
  gauche.appendChild(vide);
  const liste = element('ul', 'boutique-gains');
  const gains = [];
  for (let i = 0; i < GAINS_MAX; i += 1) gains.push(construireGain(liste));
  gauche.appendChild(liste);
  const droite = element('div', 'boutique-cadeaux');
  const cadeaux = [];
  for (let i = 0; i < CADEAUX_MAX; i += 1) cadeaux.push(construireCadeau(droite, actions));
  racine.appendChild(gauche);
  racine.appendChild(droite);
  parent.appendChild(racine);

  return {
    racine,
    solde,
    mettreAJour(vue) {
      ecrire(solde, String(vue.solde));
      etiqueter(total, `${vue.solde} points`);
      masquer(vide, vue.gains.length > 0);
      gains.forEach((n, i) => {
        const gain = vue.gains[i];
        masquer(n.ligne, !gain);
        if (!gain) return;
        changerIcone(n.picto, gain.picto);
        ecrire(n.texte, gain.texte);
        ecrire(n.valeur, gain.valeur);
      });
      cadeaux.forEach((n, i) => {
        const cadeau = vue.cadeaux[i];
        masquer(n.carte, !cadeau);
        if (cadeau) rendreCadeau(n, cadeau);
      });
    },
  };
}
