// web/src/inactivite.js
//
// Rôle    : repérer 60 s sans toucher l'écran, pour revenir à l'Accueil (et rendormir l'écran la nuit), et dire
//           depuis quand personne n'a touché (mode Photos après 3 min, rechargement de 4h).
// Entrées : toucher() à chaque pointerdown ; verifier() à chaque tick ; une horloge MONOTONE en ms
//           (performance.now dans la page, une fausse horloge dans les tests).
// Sorties : creerInactivite({ delaiMs, monotone }) -> { toucher(), verifier(), inactifMs() } ; verifier() renvoie
//           vrai une seule fois par période d'inactivité, au passage du délai ; inactifMs() le temps écoulé depuis
//           le dernier toucher.
// Pièges  :
//   - Horloge monotone, pas l'heure murale : celle-ci peut sauter (réglage sur le serveur, Android).
//   - Un seul signal par période : sans cela, le retour à l'Accueil serait relancé à chaque seconde. Si main.js
//     ne peut pas revenir à l'Accueil à ce moment (recette ouverte, minuteur qui sonne), le signal est perdu :
//     fermer la recette ou arrêter la sonnerie est un toucher, qui ouvre une nouvelle période.
//   - Le mode Photos (3 min) n'a pas de signal propre : pilotage.js (decisionPhotos) le décide d'après inactifMs à
//     chaque tick.

export function creerInactivite({ delaiMs, monotone }) {
  let dernierToucher = monotone();
  let signale = false;
  return {
    toucher() {
      dernierToucher = monotone();
      signale = false;
    },
    verifier() {
      if (signale || monotone() - dernierToucher < delaiMs) return false;
      signale = true;
      return true;
    },
    inactifMs: () => monotone() - dernierToucher,
  };
}
