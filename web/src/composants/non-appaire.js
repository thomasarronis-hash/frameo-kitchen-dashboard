// web/src/composants/non-appaire.js
//
// Rôle    : l'écran « Cadre non appairé » : le serveur refuse la clé de ce cadre (401), donc aucune donnée ne
//           viendra. Il le dit clairement, avec l'heure (seule information encore juste) et la marche à suivre.
// Entrées : le conteneur (#non-appaire) ; mettreAJour(nonAppaire, heure) à chaque seconde (api.js le décide).
// Sorties : creerNonAppaire(conteneur) -> { mettreAJour(nonAppaire, heure) }.
// Pièges  :
//   - Jamais de rechargement de la page ici : api.js recrée seulement le flux toutes les 45 s, et l'écran
//     disparaît de lui-même au premier message reçu (clé de nouveau acceptée).
//   - La clé n'est jamais affichée ni demandée : elle se transmet depuis le Clevo par adb (docs/recuperation.md).
//   - Masqué la nuit (base.css) : seule l'horloge reste.

import { ecrire, element, masquer } from '../dom.js';

export function creerNonAppaire(conteneur) {
  const heure = element('p', 'non-appaire-heure chiffres chiffres-affiche');
  const titre = element('p', 'non-appaire-titre', 'Cadre non appairé');
  const texte = element('p', 'non-appaire-texte', 'Le serveur de la maison ne reconnaît pas la clé de ce cadre : rien ne peut s\'afficher.');
  const conseil = element('p', 'non-appaire-conseil', 'À refaire depuis l\'ordinateur : envoyer la clé du cadre par adb (docs/recuperation.md). Nouvel essai automatique toutes les 45 secondes.');
  [heure, titre, texte, conseil].forEach((noeud) => conteneur.appendChild(noeud));
  conteneur.hidden = true;

  return {
    mettreAJour(nonAppaire, texteHeure) {
      masquer(conteneur, !nonAppaire);
      if (nonAppaire) ecrire(heure, texteHeure);
    },
  };
}
