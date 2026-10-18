// web/src/pilotage.js
//
// Rôle    : les règles de la page qui ne touchent pas au DOM, sorties de main.js pour être testées : les minuteurs
//           évalués en heure corrigée (et seulement une fois l'horloge fiable) avec la sonnerie qui suit ; ce qu'il
//           faut faire après une inactivité (retour à l'Accueil, recette oubliée refermée) ; l'entrée dans le mode
//           Photos après 3 min sans toucher et la sortie ; l'éveil au passage en nuit ; ce qui reporte le rechargement
//           de 4h ; les événements qui comptent comme une activité.
// Entrées : creerPiloteMinuteurs({ minuteurs (minuteurs.js), horloge (heure.js), sonnerie (sonnerie.js), monotone
//           (horloge monotone en ms depuis le chargement de la page) }) ; pour les règles, l'état de la page au
//           moment de décider.
// Sorties : creerPiloteMinuteurs(...) -> { evaluer() -> { ms, etat } ou null, lancer(minuteur) -> vrai si lancé,
//           ajouter(id), annuler(id), retablir(id) -> vrai si rétabli, arreterSonnants(), prolonger(id, dureeMs),
//           actifs() } ;
//           apresInactivite({ signal, inactifMs, recetteOuverte, alerteVisible, minuteursActifs, ecranRetenu,
//           retenuFini }) -> 'rien', 'accueil' ou 'fermer-recette' ;
//           decisionPhotos({ enPhotos, inactifMs, recetteOuverte, alerteVisible, sonnetteVisible, nuit, photosPretes,
//           vuePrete, enLigne, ecranRetenu, minuteurEcran }) -> 'preparer', 'entrer', 'sortir' ou 'rien' ;
//           eveilPassageNuit({ inactifMs, recetteOuverte }) -> booléen ;
//           enfantsRetenu({ ecranActif, inactifMs }) -> booléen (écran des enfants gardé 90 s sans toucher) ;
//           rechargementBloque({ recetteOuverte, etatMinuteurs }) -> booléen (rechargement de 4h) ;
//           rechargementVersionBloque({ recetteOuverte, etatMinuteurs, sonnetteVisible, ecranActif }) -> booléen
//           (rechargement après un déploiement) ;
//           toucherQuiMasque({ enPhotos, bandeauVisible, surDirect }) -> { sortirPhotos, masquerBandeau, consomme } ;
//           EVENEMENTS_ACTIVITE ; DELAI_INACTIVITE_MS (60 s) ; DELAI_PHOTOS_MS (3 min) ; AVANCE_PREPARATION_MS (1 min) ;
//           RECETTE_OUBLIEE_MS (2 h) ; DELAI_ENFANTS_MS (90 s).
// Pièges  :
//   - evaluer() rend null tant que l'horloge n'est pas fiable : réglée par le premier heure_serveur du flux, ou
//     10 s après le chargement sans serveur (pour qu'un minuteur sonne quand même). Sur l'horloge fausse d'un
//     cadre sans Internet, un minuteur relu après un rechargement sonnerait sinon trop tôt, ou serait oublié.
//   - Tout passe par l'heure CORRIGÉE (horloge.maintenant()), jamais par Date.now() : lancer, +1 min, rétablir,
//     prolonger et l'évaluation. evaluer() rend aussi le ms utilisé, pour que tout l'affichage parle du même
//     instant.
//   - La sonnerie suit l'évaluation : elle démarre dès qu'un minuteur sonne, s'arrête quand il n'y en a plus.
//   - Le son est déverrouillé (sonnerie.js) au lancement d'un minuteur, geste de l'utilisateur.
//   - Inactivité : retour à l'Accueil après 60 s sans toucher, SAUF alerte de fin à l'écran (jamais coupée) et
//     recette ouverte. Une recette oubliée (2 h sans toucher, aucun minuteur en cours ni qui sonne) est refermée :
//     sinon elle restait affichée jusqu'au lendemain et bloquait chaque nuit le rechargement de 4h. Sa page reste
//     retenue pour la session, ses ingrédients cochés dans localStorage.
//   - Écran retenu (Maison pendant un direct de la sonnette ou un Wi-Fi invités affiché) : pas de retour à
//     l'Accueil, un invité qui scanne le QR ne touche pas l'écran. Le signal d'inactivité est alors perdu ; quand
//     l'écran cesse d'être retenu (fin du direct au bout de 3 min, Wi-Fi masqué au bout de 2 min : retenuFini), le
//     retour se fait si personne n'a touché depuis 60 s.
//   - Mode Photos (conception §1.5, M4) : après 3 min sans toucher, seulement si des photos sont prêtes (clé Immich
//     configurée et lot reçu), le flux vivant, et hors recette ouverte, alerte de minuteur, bandeau sonnette, nuit et
//     écran retenu (direct de la sonnette, Wi-Fi invités affiché). Un minuteur qui tourne n'empêche rien : il
//     s'affiche dans le mode Photos. Une fois dedans, on n'en sort que par un toucher (main.js), la nuit (20 h 30 : la
//     nuit reste l'horloge seule) ou une coupure du flux (le bandeau hors ligne de l'Accueil doit se voir) ; le
//     bandeau sonnette et l'alerte des minuteurs passent par-dessus sans le quitter. Pendant le mode Photos, l'écran
//     compte comme retenu pour apresInactivite (par sûreté : depuis le 14/10, il n'est plus au menu et on n'y entre
//     qu'après 3 min sans toucher, le signal des 60 s est donc déjà passé).
//   - Préparation du mode Photos (constat du 14/10 : écran vide quand le Wi-Fi du cadre décrochait pendant le transfert
//     de la première photo) : 'preparer' dès 2 min sans toucher, aux mêmes conditions que l'entrée (photosPretes = un
//     lot est là) ; 'entrer' à 3 min seulement si la première vue est chargée (vuePrete), sinon la préparation
//     continue et l'Accueil reste. 'rien' (un toucher, un empêchement) arrête la préparation et décharge l'image.
//   - Écran des enfants (partie 4) : retour à l'Accueil après 90 s sans toucher au lieu de 60 (un enfant qui s'habille
//     revient cocher) ; il compte comme retenu jusqu'à 90 s (enfantsRetenu), puis le retour se fait comme à la fin d'un
//     écran retenu (retenuFini). Le minuteur d'écran de Timo qui tourne empêche le mode Photos (minuteurEcran) : sa
//     pastille, dans le menu, doit rester visible ; il n'empêche pas le retour à l'Accueil, où elle se voit.
//   - Passage en nuit (20 h 30) : l'écran reste éveillé (Ardoise, luminosité du soir) si quelqu'un a touché depuis
//     moins de 60 s ou si une recette est ouverte : on ne fait pas disparaître la recette de quelqu'un qui cuisine.
//   - Taper au clavier (champ des courses) est une activité, comme toucher : keydown et input en plus de
//     pointerdown. Sans eux, la page revenait à l'Accueil en pleine saisie et fermait le clavier.
//   - Rechargement après un déploiement (rechargement.js) : bloqué comme celui de 4h (minuteur qui tourne ou sonne,
//     recette ouverte), plus le bandeau sonnette à l'écran et l'écran Enfants ouvert (un enfant en pleine routine du
//     matin, mode parent compris ; nom de route « enfants »). Le mode
//     Photos ne bloque pas : la page rechargée revient à l'Accueil, puis aux photos 3 min plus tard.
//   - Un toucher qui fait sortir du mode Photos ou masque le bandeau sonnette ne fait QUE cela (consomme : main.js
//     arrête sa propagation en phase de capture) : « Toucher ailleurs pour masquer » ne doit pas lancer YouTube,
//     cocher un article ni avancer la recette sous le bandeau. Seul « Voir le direct » (surDirect) passe.

export const DELAI_INACTIVITE_MS = 60000;
export const DELAI_PHOTOS_MS = 180000;
export const AVANCE_PREPARATION_MS = 60000;
export const RECETTE_OUBLIEE_MS = 2 * 3600000;
export const DELAI_ENFANTS_MS = 90000;
export const EVENEMENTS_ACTIVITE = ['pointerdown', 'keydown', 'input'];
const ATTENTE_HORLOGE_MS = 10000;

export function creerPiloteMinuteurs({ minuteurs, horloge, sonnerie, monotone }) {
  const fiable = () => horloge.estReglee() || monotone() > ATTENTE_HORLOGE_MS;

  return {
    evaluer() {
      if (!fiable()) return null;
      const ms = horloge.maintenant();
      const etat = minuteurs.etat(ms);
      if (etat.sonnants.length === 0) sonnerie.arreter();
      else if (!sonnerie.active()) sonnerie.demarrer();
      return { ms, etat };
    },
    lancer(minuteur) {
      sonnerie.deverrouiller();
      return minuteurs.lancer(minuteur, horloge.maintenant()) !== null;
    },
    ajouter: (id) => minuteurs.ajouter(id, horloge.maintenant()),
    annuler: (id) => minuteurs.annuler(id, horloge.maintenant()),
    retablir: (id) => minuteurs.retablir(id, horloge.maintenant()),
    arreterSonnants() {
      minuteurs.etat(horloge.maintenant()).sonnants.forEach((minuteur) => minuteurs.arreter(minuteur.id));
    },
    prolonger: (id, dureeMs) => minuteurs.prolonger(id, dureeMs, horloge.maintenant()),
    actifs: () => minuteurs.nombre() > 0,
  };
}

// signal : vrai une seule fois par période d'inactivité, au passage des 60 s (inactivite.js) ; retenuFini : vrai au
// tick où l'écran cesse d'être retenu.
export function apresInactivite({
  signal, inactifMs, recetteOuverte, alerteVisible, minuteursActifs, ecranRetenu = false, retenuFini = false,
}) {
  if (alerteVisible) return 'rien';
  if (recetteOuverte) return !minuteursActifs && inactifMs >= RECETTE_OUBLIEE_MS ? 'fermer-recette' : 'rien';
  if (ecranRetenu) return 'rien';
  return signal || (retenuFini && inactifMs >= DELAI_INACTIVITE_MS) ? 'accueil' : 'rien';
}

export function decisionPhotos({
  enPhotos, inactifMs, recetteOuverte, alerteVisible, sonnetteVisible, nuit, photosPretes, vuePrete = false, enLigne, ecranRetenu,
  minuteurEcran = false,
}) {
  if (enPhotos) return nuit || !enLigne ? 'sortir' : 'rien';
  const empeche = recetteOuverte || alerteVisible || sonnetteVisible || nuit || !photosPretes || !enLigne || ecranRetenu || minuteurEcran;
  if (empeche || inactifMs < DELAI_PHOTOS_MS - AVANCE_PREPARATION_MS) return 'rien';
  return inactifMs >= DELAI_PHOTOS_MS && vuePrete ? 'entrer' : 'preparer';
}

export const enfantsRetenu = ({ ecranActif, inactifMs }) => ecranActif === 'enfants' && inactifMs < DELAI_ENFANTS_MS;

export function toucherQuiMasque({ enPhotos, bandeauVisible, surDirect }) {
  const sortirPhotos = enPhotos && !surDirect;
  const masquerBandeau = bandeauVisible && !surDirect;
  return { sortirPhotos, masquerBandeau, consomme: sortirPhotos || masquerBandeau };
}

export function eveilPassageNuit({ inactifMs, recetteOuverte }) {
  return recetteOuverte || inactifMs < DELAI_INACTIVITE_MS;
}

export function rechargementBloque({ recetteOuverte, etatMinuteurs }) {
  return recetteOuverte || etatMinuteurs.enCours.length + etatMinuteurs.sonnants.length > 0;
}

export function rechargementVersionBloque({
  recetteOuverte, etatMinuteurs, sonnetteVisible, ecranActif,
}) {
  return rechargementBloque({ recetteOuverte, etatMinuteurs }) || sonnetteVisible || ecranActif === 'enfants';
}
