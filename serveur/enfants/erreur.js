// serveur/enfants/erreur.js
//
// Rôle    : le refus voulu d'une action du tableau des enfants (étape déjà cochée, trop tôt, trop tard, points
//           insuffisants...), levé par les règles (journee.js, registre.js) et traduit en réponse HTTP par
//           routes/enfants.js.
// Entrées : new ErreurEnfants(code, statut) : code court en snake_case (renvoyé tel quel à la page), statut HTTP.
// Sorties : ErreurEnfants (code, statut).
// Pièges  : seules ces erreurs deviennent un 4xx ; toute autre erreur (fichier, disque plein) reste une erreur interne,
//           journalisée en entier par app.js et jamais détaillée à la page.

export class ErreurEnfants extends Error {
  constructor(code, statut) {
    super(code);
    this.code = code;
    this.statut = statut;
  }
}
