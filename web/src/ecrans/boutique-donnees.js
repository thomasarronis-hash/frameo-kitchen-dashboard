// web/src/ecrans/boutique-donnees.js
//
// Rôle    : les points de la journée et la boutique de Timo (choix de Thomas du 14/10), sans DOM : son total (étoile et
//           nombre), ses derniers gains (motif ou « Bravo ! »), les trois récompenses avec ce qu'il manque, la demande en
//           attente d'un parent, et le bouton « +1 » libre de l'en-tête (décision du 14/10 en fin d'après-midi).
// Entrées : un enfant à points de la valeur enfants du flux (points, gains, demande : serveur/enfants/projection.js), la
//           boutique et les motifs de la même valeur ; pour le « +1 », le dernier point libre donné depuis cette page
//           ({ enfant, jusqua (ms, fin du retour de 5 s) } ou null) et ms, l'heure corrigée.
// Sorties : vueBoutique(enfant, boutique, motifs) -> { solde, gains: [{ picto, texte, valeur (« +1 ») }], cadeaux: [{ id, libelle,
//           picto, taille (1, 2, 3 : le dessin grandit avec le prix), prix, manque (« encore 12 » ou null), fraction (solde sur
//           prix, bornée à 1), possible, demande (vrai si c'est le cadeau demandé) }], demande (null ou { id, libelle, picto,
//           prix }) } ; vuePlusUn(enfant, dernier, ms) -> null (enfant sans points : Pablo) ou { possible (encore des
//           points libres aujourd'hui), texte (« +1 », ou « À demain » au plafond), annulation (null ou { jusqua }) } ;
//           BRAVO, MOT_PLAFOND.
// Pièges  :
//   - Timo ne perd jamais de points par punition : rien ici ne montre un retrait ; un échange validé, l'annulation d'un
//     point libre ou le −1 d'un parent font simplement baisser le solde.
//   - « +1 » : le retour de 5 s ne vaut que pour l'enfant de l'écran et le point donné depuis cette page (la réponse du
//     serveur donne jusqua) ; au plafond (libres_restants à 0), le retour reste possible tant qu'il est montré.
//   - « Je veux ça » seulement si le solde suffit (le serveur refuserait : points_insuffisants) ; une nouvelle demande
//     remplace l'ancienne (serveur), la page n'en montre qu'une, sur son cadeau, « en attente d'un parent ».
//   - Un gain sans motif s'écrit « Bravo ! » avec l'étoile ; un motif inconnu de la liste (barème changé depuis) aussi.
//   - Taille du dessin : rang du cadeau trié par prix (le moins cher le plus petit), pour qu'un enfant qui ne lit pas voie
//     petit, moyen, gros.

export const BRAVO = { texte: 'Bravo\u00a0!', picto: 'i-etoile' };
export const MOT_PLAFOND = 'À\u00a0demain';

function gainVu(gain, motifs) {
  const motif = gain.motif === null ? null : motifs.filter((connu) => connu.id === gain.motif)[0];
  return { picto: motif ? motif.picto : BRAVO.picto, texte: motif ? motif.libelle : BRAVO.texte, valeur: '+1' };
}

export function vueBoutique(enfant, boutique, motifs) {
  const solde = enfant.points ? enfant.points.solde : 0;
  const demande = enfant.demande;
  const prixTries = boutique.map((cadeau) => cadeau.prix).sort((a, b) => a - b);
  const cadeauDemande = demande ? boutique.filter((cadeau) => cadeau.id === demande.cadeau)[0] : null;
  return {
    solde,
    gains: (enfant.gains || []).map((gain) => gainVu(gain, motifs)),
    cadeaux: boutique.map((cadeau) => ({
      id: cadeau.id,
      libelle: cadeau.libelle,
      picto: cadeau.picto,
      taille: Math.min(3, prixTries.indexOf(cadeau.prix) + 1),
      prix: cadeau.prix,
      manque: solde >= cadeau.prix ? null : `encore\u00a0${cadeau.prix - solde}`,
      fraction: Math.min(1, solde / cadeau.prix),
      possible: solde >= cadeau.prix,
      demande: Boolean(demande) && demande.cadeau === cadeau.id,
    })),
    demande: demande ? {
      id: demande.id,
      libelle: cadeauDemande ? cadeauDemande.libelle : 'Cadeau',
      picto: cadeauDemande ? cadeauDemande.picto : 'i-cadeau',
      prix: demande.prix,
    } : null,
  };
}

export function vuePlusUn(enfant, dernier, ms) {
  if (!enfant.points) return null;
  const possible = enfant.points.libres_restants > 0;
  return {
    possible,
    texte: possible ? '+1' : MOT_PLAFOND,
    annulation: dernier && dernier.enfant === enfant.id && dernier.jusqua > ms ? { jusqua: dernier.jusqua } : null,
  };
}
