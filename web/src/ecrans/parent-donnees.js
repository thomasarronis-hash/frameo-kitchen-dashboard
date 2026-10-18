// web/src/ecrans/parent-donnees.js
//
// Rôle    : le mode parent côté page (choix de Thomas du 14/10, partie 4), sans DOM : la session de 60 s ouverte par le geste
//           parent (jeton du serveur), les envois du tableau des enfants (avec l'en-tête du jeton quand la session est
//           ouverte), et la vue du mode parent : étapes à valider, à cocher ou à corriger, +1 point, −1 (point donné par
//           erreur), demande d'échange, historique de 7 jours en pastilles.
// Entrées : creerSessionParent({ client (api.js : poster, lire), maintenant (heure corrigée en ms) }) ;
//           creerEnvois({ client, session }) ; vueParent(enfant, valeur enfants, historique (réponse de GET
//           /api/enfants/historique ou null)).
// Sorties : creerSessionParent -> { ouvrir() -> promesse { ok, message }, actif(), restantS(), entetes() -> { x-cadre-parent }
//           ou undefined, fermer() } ;
//           creerEnvois -> { cocher(enfant, etape), annuler(enfant, etape), decider(enfant, etape, decision), donnerPoint(enfant,
//           motif), retirerPoint(enfant), pointLibre(enfant), annulerPointLibre(enfant), demanderEchange(enfant, cadeau),
//           deciderEchange(enfant, demande, decision), minuteur(enfant, action), historique() } : promesses du client
//           ({ ok, donnees } ou { ok: false, statut, message, code }) ;
//           vueParent -> { etapes: [{ id, libelle, picto, statut, actions: [« valider », « refuser »] | [« cocher »] |
//           [« decocher »] }], points (null ou { solde, retirable (solde au-dessus de 0 : −1 permis), motifs: [{ id (null :
//           Bravo), libelle, picto }] }), demande (null ou
//           { id, libelle, picto, prix, possible }), historique (null ou [{ jour (« Lun »), etat (« pleine » | « moitie » |
//           « vide »), valeur (« 18 min », « 2 ★ » ou « » ) }]) }.
// Pièges  :
//   - Barrière contre les doigts d'enfants, pas une sécurité forte (serveur/enfants/mode-parent.js) : le jeton n'est gardé
//     qu'en mémoire, 60 s, d'après l'heure d'expiration du serveur comparée à l'heure corrigée de la page ; fermer() l'oublie.
//   - Un envoi fait pendant la session porte l'en-tête : cocher valide tout de suite, annuler corrige sans délai (étape
//     cochée par erreur, « un parent corrige si besoin »). Hors session, aucun en-tête : le serveur applique les règles
//     de l'enfant (5 s pour annuler).
//   - Corps toujours {} ou un objet de la liste fermée du serveur, jamais d'heure ni de nombre de points.
//   - Le point libre (bouton « +1 » de l'en-tête) et son annulation ne demandent pas de jeton : jamais d'en-tête, même
//     pendant une session ; le −1 (retirerPoint) est réservé au mode parent, et le solde n'y descend jamais sous 0.
//   - Historique : la réponse porte les deux enfants (réservée au mode parent) ; la vue n'en prend qu'un, celui de l'écran
//     (jamais de comparaison entre frères). Pastille pleine : toutes les étapes faites ce jour-là ; à moitié : une partie ;
//     vide : aucune.

import { jourAbrege } from '../heure.js';
import { BRAVO } from './boutique-donnees.js';

const ESP = '\u00a0';

export function creerSessionParent({ client, maintenant }) {
  let jeton = null;
  let expire = 0;
  const actif = () => jeton !== null && maintenant() < expire;
  return {
    ouvrir() {
      return client.poster('/api/enfants/parent', {}).then((reponse) => {
        if (!reponse.ok) return { ok: false, message: reponse.message };
        jeton = reponse.donnees.jeton;
        expire = Date.parse(reponse.donnees.expire_le);
        return { ok: true, message: null };
      });
    },
    actif,
    restantS: () => (actif() ? Math.ceil((expire - maintenant()) / 1000) : 0),
    entetes: () => (actif() ? { 'x-cadre-parent': jeton } : undefined),
    fermer() {
      jeton = null;
      expire = 0;
    },
  };
}

export function creerEnvois({ client, session }) {
  const chemin = (enfant, suite) => `/api/enfants/${encodeURIComponent(enfant)}/${suite}`;
  const poster = (url, corps) => client.poster(url, corps || {}, session.entetes());
  return {
    cocher: (enfant, etape) => poster(chemin(enfant, `etapes/${encodeURIComponent(etape)}`)),
    annuler: (enfant, etape) => poster(chemin(enfant, `etapes/${encodeURIComponent(etape)}/annuler`)),
    decider: (enfant, etape, decision) => poster(chemin(enfant, `etapes/${encodeURIComponent(etape)}/decision`), { decision }),
    donnerPoint: (enfant, motif) => poster(chemin(enfant, 'points'), { motif }),
    retirerPoint: (enfant) => poster(chemin(enfant, 'points/retirer')),
    pointLibre: (enfant) => client.poster(chemin(enfant, 'points/libre'), {}),
    annulerPointLibre: (enfant) => client.poster(chemin(enfant, 'points/libre/annuler'), {}),
    demanderEchange: (enfant, cadeau) => poster(chemin(enfant, 'echanges'), { cadeau }),
    deciderEchange: (enfant, demande, decision) => poster(chemin(enfant, `echanges/${encodeURIComponent(demande)}/decision`), { decision }),
    minuteur: (enfant, action) => poster(chemin(enfant, 'minuteur'), { action }),
    historique: () => client.lire('/api/enfants/historique', session.entetes()),
  };
}

function actionsEtape(etape) {
  if (etape.statut === 'attente') return ['valider', 'refuser'];
  if (etape.statut === 'a_faire') return ['cocher'];
  return ['decocher'];
}

function etatJour(jour, total) {
  if (total > 0 && jour.faites >= total) return 'pleine';
  return jour.faites > 0 ? 'moitie' : 'vide';
}

function valeurJour(jour, type) {
  if (jour.gagnees <= 0) return '';
  return type === 'minutes' ? `${jour.gagnees}${ESP}min` : `${jour.gagnees}${ESP}★`;
}

function historiqueDe(enfant, historique) {
  if (!historique || !Array.isArray(historique.enfants)) return null;
  const lui = historique.enfants.filter((autre) => autre.id === enfant.id)[0];
  if (!lui) return null;
  return lui.jours.map((jour) => ({ jour: jourAbrege(jour.journee), etat: etatJour(jour, lui.total), valeur: valeurJour(jour, lui.type) }));
}

export function vueParent(enfant, enfants, historique) {
  const boutique = enfants.boutique || [];
  const demande = enfant.demande;
  const cadeau = demande ? boutique.filter((connu) => connu.id === demande.cadeau)[0] : null;
  return {
    etapes: enfant.etapes.map((etape) => ({
      id: etape.id, libelle: etape.libelle, picto: etape.picto, statut: etape.statut, actions: actionsEtape(etape),
    })),
    points: enfant.points ? {
      solde: enfant.points.solde,
      retirable: enfant.points.solde > 0,
      motifs: [{ id: null, libelle: BRAVO.texte, picto: BRAVO.picto }].concat((enfants.motifs || []).map((motif) => ({
        id: motif.id, libelle: motif.libelle, picto: motif.picto,
      }))),
    } : null,
    demande: demande ? {
      id: demande.id,
      libelle: cadeau ? cadeau.libelle : 'Cadeau',
      picto: cadeau ? cadeau.picto : 'i-cadeau',
      prix: demande.prix,
      possible: Boolean(enfant.points) && enfant.points.solde >= demande.prix,
    } : null,
    historique: historiqueDe(enfant, historique),
  };
}
