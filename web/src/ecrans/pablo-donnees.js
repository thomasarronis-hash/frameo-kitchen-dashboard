// web/src/ecrans/pablo-donnees.js
//
// Rôle    : « D'abord, ensuite » de Pablo (3 ans, choix de Thomas du 14/10), sans DOM : ses trois grands pictogrammes (fait
//           ou à faire), les étoiles de son bocal, la case « Ensuite » (une histoire) qui s'ouvre quand tout est fait, et la
//           dernière coche qu'un adulte peut encore annuler.
// Entrées : un enfant à étoiles de la valeur enfants du flux (serveur/enfants/projection.js), la valeur entière
//           (routine_finie), ms (heure corrigée).
// Sorties : vuePablo(enfant, enfants, ms) -> { cases: [{ id, libelle, picto, fait, passee (pas faite et routine du matin
//           finie : en gris, plus de toucher) }], etoiles (nombre gagné aujourd'hui), places
//           (nombre d'étapes : les places du bocal), ensuite (null ou { libelle, picto, debloque }), annulation (null ou { id,
//           jusqua (ms) }) }.
// Pièges  :
//   - Aucun texte nécessaire pour lui : libelle ne sert qu'à l'étiquette d'accessibilité et au mode parent.
//   - Pas de minutes d'écran pour Pablo (Commission écrans) ; ses étoiles sont comptées par journée (serveur), le bocal
//     repart vide chaque matin.
//   - Une coche se fait d'un simple toucher (il a 3 ans) ; un adulte peut l'annuler pendant 5 s (bouton retour, sans texte),
//     seulement une coche faite hors mode parent (par « enfant ») : le serveur refuse le reste sans jeton.

export function vuePablo(enfant, enfants, ms) {
  const fermee = Boolean(enfants.routine_finie);
  let annulation = null;
  enfant.etapes.forEach((etape) => {
    const jusqua = etape.annulable_jusqu_a ? Date.parse(etape.annulable_jusqu_a) : 0;
    if (etape.statut !== 'a_faire' && etape.par === 'enfant' && jusqua > ms && (!annulation || jusqua > annulation.jusqua)) annulation = { id: etape.id, jusqua };
  });
  return {
    cases: enfant.etapes.map((etape) => ({
      id: etape.id, libelle: etape.libelle, picto: etape.picto, fait: etape.statut === 'valide', passee: fermee && etape.statut === 'a_faire',
    })),
    etoiles: enfant.gagnees,
    places: enfant.etapes.length,
    ensuite: enfant.ensuite ? { libelle: enfant.ensuite.libelle, picto: enfant.ensuite.picto, debloque: enfant.ensuite.debloque } : null,
    annulation,
  };
}
