// web/src/composants/menu.js
//
// Rôle    : le menu large (240 px) : « La cuisine » en tête, les 9 entrées avec icône et nom (Accueil, Météo, Repas,
//           Courses, Maison, Agenda, Enfants, Voitures, Clims), et l'état de la connexion en pied.
// Entrées : le conteneur <nav> ; surNavigation(nom) au toucher d'une entrée ; connexion({ enLigne, silenceMs, ha }) à
//           chaque seconde.
// Sorties : ENTREES (nom, icône, écran, dans l'ordre du menu) ; creerMenu(conteneur, { surNavigation }) ->
//           { marquerActif(nom), connexion(etat) } ; texteConnexion(etat) -> { texte, enLigne }, sans DOM (testable).
// Pièges  :
//   - Navigation sur pointerdown, pas sur click (règle de Wes, conception §1.2) : réaction immédiate.
//   - Masqué en mode Photos et la nuit (feuilles photos.css et base.css) : un toucher ramène l'Accueil avec le menu.
//   - Plus d'entrée Photos depuis le 14/10 : avec Enfants et Voitures, 9 entrées de 96 px ne tiennent plus dans les
//     1080 px avec la marque et le pied (mesuré, conception §1.4). Le mode Photos reste automatique après 3 min sans
//     toucher (pilotage.js). Clims (16/10, choix de Thomas : une 9e entrée plutôt qu'un onglet de Maison) : entrées
//     ramenées à 86 px (menu.css) pour tenir.
//   - « à jour » exige le flux vivant ET Home Assistant connecté : un BFF joignable dont HA est tombé ne
//     doit pas faire croire que les données de la maison sont fraîches. Avant le premier instantané (ha
//     encore inconnu), « connexion en cours ».

import { element, ecrire, icone } from '../dom.js';
import { texteDuree } from '../heure.js';

export const ENTREES = [
  { nom: 'Accueil', icone: 'i-home', ecran: 'accueil' },
  { nom: 'Météo', icone: 'i-sun', ecran: 'meteo' },
  { nom: 'Repas', icone: 'i-fork', ecran: 'repas' },
  { nom: 'Courses', icone: 'i-cart', ecran: 'courses' },
  { nom: 'Maison', icone: 'i-shield', ecran: 'maison' },
  { nom: 'Agenda', icone: 'i-cal', ecran: 'agenda' },
  { nom: 'Enfants', icone: 'i-etoile', ecran: 'enfants' },
  { nom: 'Voitures', icone: 'i-voiture', ecran: 'voitures' },
  { nom: 'Clims', icone: 'i-clim', ecran: 'clims' },
];

export function texteConnexion({ enLigne, silenceMs, ha }) {
  if (!enLigne) return { texte: `hors ligne depuis ${texteDuree(silenceMs)}`, enLigne: false };
  if (ha === 'ok') return { texte: 'à jour', enLigne: true };
  if (ha === 'ko') return { texte: 'maison injoignable', enLigne: false };
  return { texte: 'connexion en cours', enLigne: false };
}

function entree(description, surNavigation) {
  const bouton = element('button', 'menu-entree');
  bouton.type = 'button';
  bouton.appendChild(icone(description.icone));
  bouton.appendChild(element('span', 'menu-nom', description.nom));
  bouton.addEventListener('pointerdown', () => surNavigation(description.ecran));
  return bouton;
}

export function creerMenu(conteneur, { surNavigation }) {
  conteneur.appendChild(element('div', 'menu-marque', 'La cuisine'));
  const liste = element('ul', 'menu-entrees');
  const parEcran = {};
  ENTREES.forEach((description) => {
    const item = element('li');
    parEcran[description.ecran] = entree(description, surNavigation);
    item.appendChild(parEcran[description.ecran]);
    liste.appendChild(item);
  });
  conteneur.appendChild(liste);

  const pied = element('div', 'menu-pied');
  const pastille = element('span', 'menu-pastille');
  const texte = element('span', 'menu-connexion');
  pied.appendChild(pastille);
  pied.appendChild(texte);
  conteneur.appendChild(pied);

  return {
    marquerActif(nom) {
      Object.keys(parEcran).forEach((ecran) => {
        parEcran[ecran].classList.toggle('menu-entree-active', ecran === nom);
        if (ecran === nom) parEcran[ecran].setAttribute('aria-current', 'page');
        else parEcran[ecran].removeAttribute('aria-current');
      });
    },
    connexion(etat) {
      const etatTexte = texteConnexion(etat);
      ecrire(texte, etatTexte.texte);
      pastille.classList.toggle('menu-pastille-ko', !etatTexte.enLigne);
    },
  };
}
