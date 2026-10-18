// serveur/enfants/registre.js
//
// Rôle    : les règles des points de la journée et de la boutique (choix de Thomas du 14/10, puis décisions du 14/10 en
//           fin d'après-midi), sans fichier ni horloge propre : un parent donne +1 point par action faite de lui-même (motif
//           facultatif pris dans une petite liste) ou en retire un donné par erreur (−1) ; tout le monde peut donner un
//           point « libre » (bouton +1 de l'écran de Timo, sans mode parent), plafonné par jour et annulable 10 s ; l'enfant
//           demande un échange, un parent le valide ou le refuse ; purge douce après 90 jours.
// Entrées : le registre tel que stocké (stockage.js), le barème (bareme.js), l'instant (maintenant, millisecondes) et la
//           journée en cours (journee.js).
// Sorties : registreVide(bareme), completerRegistre(registre, bareme) ; solde(registre, enfant), pointsDuJour(registre,
//           enfant, journee), libresRestants(registre, bareme, enfant, journee) -> points libres encore permis aujourd'hui,
//           demandeDe(registre, enfant) -> la demande en attente ou null ; gainsRecents(registre, enfant, nombre) -> les
//           derniers gains, du plus récent au plus ancien : [{ motif (id ou null), le }] ; donnerPoint, donnerPointLibre,
//           annulerPointLibre, retirerPoint, demanderEchange, deciderEchange -> { registre (copie modifiée), resultat } ou
//           lèvent une ErreurEnfants ; purgerRegistre(registre, limite) -> le registre (copie si quelque chose a été replié,
//           sinon le même) ; PLAFOND_POINTS_JOUR, FENETRE_ANNULATION_LIBRE_MS (10 s).
//           Résultat de donnerPointLibre, annulerPointLibre et retirerPoint : { enfant, solde, aujourdhui, libres_restants }
//           (plus annulable_jusqu_a, 5 s après le point, pour donnerPointLibre : la page montre « Annuler » jusque-là).
//           Registre stocké : { version: 1, reports: { <enfant>: points repliés par la purge }, mouvements: [{ enfant, type:
//           « gain », points, motif (id ou null), libre? (vrai : point libre), le, journee } | { enfant, type: « echange »,
//           points, cadeau, le, journee }], demandes: [{ id, enfant, cadeau, prix, le }], annulations?: { <enfant>: « le »
//           du dernier point libre annulé } }.
// Pièges  :
//   - Timo ne perd jamais de points par punition : seuls un échange validé par un parent, l'annulation d'un point libre
//     (erreur de doigt) et le −1 d'un parent (point donné par erreur) en retirent. Le solde ne descend jamais sous zéro :
//     points_insuffisants (vérifié à la demande ET à la validation d'un échange : deux demandes ne peuvent pas dépenser
//     deux fois les mêmes points) ; points_depenses quand le point à retirer a déjà servi à un échange. Un échange n'est
//     jamais touché par une correction.
//   - Le −1 retire le dernier gain de l'enfant (libre ou d'un parent, de n'importe quelle journée encore gardée) ; aucun
//     gain dans les mouvements (tout replié par la purge) : aucun_point.
//   - Annulation d'un point libre bornée : seulement le dernier point libre de cet enfant, seulement dans les 10 s qui
//     suivent (la page montre « Annuler » 5 s ; le reste couvre le trajet et la seconde du rendu), jamais deux fois : après
//     une annulation, un point libre pas plus récent que celui annulé ne s'annule plus (annulations garde son « le »).
//     Sinon, deux points donnés vite puis deux « Annuler » en retireraient un que personne n'a voulu retirer.
//   - Purge douce : les mouvements de plus de 90 jours sont repliés dans reports, le solde ne change donc jamais ; une
//     demande restée sans réponse 90 jours disparaît (ce n'est pas une dépense).
//   - Une seule demande en attente par enfant : une nouvelle demande remplace l'ancienne (il a changé d'avis) ; la
//     validation porte sur l'identifiant de la demande vue par le parent, jamais sur « la dernière ».
//   - Prix recopié dans la demande : un barème changé entre la demande et la validation ne change pas ce qui est dépensé.
//   - PLAFOND_POINTS_JOUR (20 gains par enfant et par journée, points libres compris) borne la taille du fichier (90 jours
//     tiennent sous le plafond de stockage.js), pas la générosité au quotidien ; plafond_libre du barème (10) borne les
//     points libres (plafond_libre). libresRestants tient compte des deux : après 12 points d'un parent et 8 libres, il
//     vaut 0 (le « +1 » de la page est grisé), puisque le point libre suivant serait refusé (plafond_jour).

import { trouverEnfant } from './bareme.js';
import { ErreurEnfants } from './erreur.js';
import { DELAI_ANNULATION_MS, debutJournee } from './journee.js';

export const PLAFOND_POINTS_JOUR = 20;
export const FENETRE_ANNULATION_LIBRE_MS = 10_000;

const iso = (ms) => new Date(ms).toISOString();
const avecPoints = (bareme) => bareme.enfants.filter((enfant) => enfant.points);

export function registreVide(bareme) {
  return {
    version: 1, reports: Object.fromEntries(avecPoints(bareme).map((enfant) => [enfant.id, 0])), mouvements: [], demandes: [],
  };
}

export function completerRegistre(registre, bareme) {
  const manquants = avecPoints(bareme).filter((enfant) => registre.reports[enfant.id] === undefined);
  if (manquants.length === 0) return registre;
  return { ...registre, reports: { ...registre.reports, ...Object.fromEntries(manquants.map((enfant) => [enfant.id, 0])) } };
}

const signe = (mouvement) => (mouvement.type === 'gain' ? mouvement.points : -mouvement.points);

export function solde(registre, idEnfant) {
  return registre.mouvements
    .filter((mouvement) => mouvement.enfant === idEnfant)
    .reduce((total, mouvement) => total + signe(mouvement), registre.reports[idEnfant] || 0);
}

const gainsDuJour = (registre, idEnfant, journee) => registre.mouvements
  .filter((mouvement) => mouvement.enfant === idEnfant && mouvement.type === 'gain' && mouvement.journee === journee);

export const pointsDuJour = (registre, idEnfant, journee) => gainsDuJour(registre, idEnfant, journee)
  .reduce((total, mouvement) => total + mouvement.points, 0);

const estLibre = (mouvement) => mouvement.type === 'gain' && mouvement.libre === true;

const libresDuJour = (registre, idEnfant, journee) => gainsDuJour(registre, idEnfant, journee).filter(estLibre).length;

// Borné aussi par PLAFOND_POINTS_JOUR : sinon le flux annoncerait un « +1 » permis que ajouterGain refuserait.
export const libresRestants = (registre, bareme, idEnfant, journee) => Math.max(0, Math.min(
  bareme.points.plafond_libre - libresDuJour(registre, idEnfant, journee),
  PLAFOND_POINTS_JOUR - gainsDuJour(registre, idEnfant, journee).length,
));

export const demandeDe = (registre, idEnfant) => registre.demandes.find((demande) => demande.enfant === idEnfant) || null;

// Pour la liste « Bravo » de la page (partie 4) : les mouvements sont rangés dans l'ordre d'écriture, donc du plus ancien.
export const gainsRecents = (registre, idEnfant, nombre) => registre.mouvements
  .filter((mouvement) => mouvement.enfant === idEnfant && mouvement.type === 'gain')
  .slice(-nombre)
  .reverse()
  .map(({ motif, le }) => ({ motif, le }));

function enfantAvecPoints(bareme, idEnfant) {
  const enfant = trouverEnfant(bareme, idEnfant);
  if (!enfant) throw new ErreurEnfants('enfant_inconnu', 404);
  if (!enfant.points) throw new ErreurEnfants('sans_points', 404);
  return enfant;
}

const bilan = (registre, bareme, enfant, journee) => ({
  enfant: enfant.id,
  solde: solde(registre, enfant.id),
  aujourdhui: pointsDuJour(registre, enfant.id, journee),
  libres_restants: libresRestants(registre, bareme, enfant.id, journee),
});

// Un gain de par_action points (le plafond de la journée compte tous les gains, libres compris).
function ajouterGain(registre, bareme, enfant, { gain, maintenant, journee }) {
  if (gainsDuJour(registre, enfant.id, journee).length >= PLAFOND_POINTS_JOUR) throw new ErreurEnfants('plafond_jour', 409);
  const copie = structuredClone(registre);
  copie.mouvements.push({
    enfant: enfant.id, type: 'gain', points: bareme.points.par_action, ...gain, le: iso(maintenant), journee,
  });
  return copie;
}

// Retire le gain d'index donné ; jamais si le solde passait sous zéro (ce point a déjà servi à un échange).
function retirerGain(registre, index) {
  const copie = { ...registre, mouvements: registre.mouvements.filter((_, i) => i !== index) };
  if (solde(copie, registre.mouvements[index].enfant) < 0) throw new ErreurEnfants('points_depenses', 409);
  return copie;
}

export function donnerPoint(registre, bareme, {
  enfant: idEnfant, motif = null, maintenant, journee,
}) {
  const enfant = enfantAvecPoints(bareme, idEnfant);
  if (motif !== null && !bareme.points.motifs.some((connu) => connu.id === motif)) throw new ErreurEnfants('motif_inconnu', 400);
  const copie = ajouterGain(registre, bareme, enfant, { gain: { motif }, maintenant, journee });
  return {
    registre: copie,
    resultat: { enfant: enfant.id, solde: solde(copie, enfant.id), aujourdhui: pointsDuJour(copie, enfant.id, journee) },
  };
}

export function donnerPointLibre(registre, bareme, { enfant: idEnfant, maintenant, journee }) {
  const enfant = enfantAvecPoints(bareme, idEnfant);
  if (libresDuJour(registre, enfant.id, journee) >= bareme.points.plafond_libre) throw new ErreurEnfants('plafond_libre', 409);
  const copie = ajouterGain(registre, bareme, enfant, { gain: { motif: null, libre: true }, maintenant, journee });
  return {
    registre: copie,
    resultat: { ...bilan(copie, bareme, enfant, journee), annulable_jusqu_a: iso(maintenant + DELAI_ANNULATION_MS) },
  };
}

export function annulerPointLibre(registre, bareme, { enfant: idEnfant, maintenant, journee }) {
  const enfant = enfantAvecPoints(bareme, idEnfant);
  const index = registre.mouvements.findLastIndex((mouvement) => mouvement.enfant === enfant.id && estLibre(mouvement));
  const point = index === -1 ? null : registre.mouvements[index];
  const dejaAnnule = registre.annulations && registre.annulations[enfant.id];
  const ancien = point && dejaAnnule && Date.parse(point.le) <= Date.parse(dejaAnnule);
  if (!point || ancien) throw new ErreurEnfants('rien_a_annuler', 409);
  if (maintenant - Date.parse(point.le) > FENETRE_ANNULATION_LIBRE_MS) throw new ErreurEnfants('trop_tard', 409);
  const copie = retirerGain(registre, index);
  copie.annulations = { ...registre.annulations, [enfant.id]: point.le };
  return { registre: copie, resultat: bilan(copie, bareme, enfant, journee) };
}

export function retirerPoint(registre, bareme, { enfant: idEnfant, journee }) {
  const enfant = enfantAvecPoints(bareme, idEnfant);
  const index = registre.mouvements.findLastIndex((mouvement) => mouvement.enfant === enfant.id
    && mouvement.type === 'gain');
  if (index === -1) throw new ErreurEnfants('aucun_point', 409);
  const copie = retirerGain(registre, index);
  return { registre: copie, resultat: bilan(copie, bareme, enfant, journee) };
}

export function demanderEchange(registre, bareme, {
  enfant: idEnfant, cadeau: idCadeau, maintenant, id,
}) {
  const enfant = enfantAvecPoints(bareme, idEnfant);
  const cadeau = bareme.boutique.find((connu) => connu.id === idCadeau);
  if (!cadeau) throw new ErreurEnfants('cadeau_inconnu', 400);
  if (solde(registre, enfant.id) < cadeau.prix) throw new ErreurEnfants('points_insuffisants', 409);
  const copie = structuredClone(registre);
  const remplace = demandeDe(copie, enfant.id) !== null;
  const demande = {
    id, enfant: enfant.id, cadeau: cadeau.id, prix: cadeau.prix, le: iso(maintenant),
  };
  copie.demandes = [...copie.demandes.filter((autre) => autre.enfant !== enfant.id), demande];
  return { registre: copie, resultat: { enfant: enfant.id, demande, remplace } };
}

export function deciderEchange(registre, bareme, {
  enfant: idEnfant, demande: idDemande, decision, maintenant, journee,
}) {
  const enfant = enfantAvecPoints(bareme, idEnfant);
  const demande = registre.demandes.find((connue) => connue.id === idDemande && connue.enfant === enfant.id);
  if (!demande) throw new ErreurEnfants('demande_inconnue', 404);
  if (decision === 'valider' && solde(registre, enfant.id) < demande.prix) throw new ErreurEnfants('points_insuffisants', 409);
  const copie = structuredClone(registre);
  copie.demandes = copie.demandes.filter((autre) => autre.id !== demande.id);
  if (decision === 'valider') {
    copie.mouvements.push({
      enfant: enfant.id, type: 'echange', points: demande.prix, cadeau: demande.cadeau, le: iso(maintenant), journee,
    });
  }
  return {
    registre: copie,
    resultat: {
      enfant: enfant.id, demande: demande.id, decision, solde: solde(copie, enfant.id),
    },
  };
}

// Garde les journées à partir de limite (« AAAA-MM-JJ ») : le reste est replié dans reports, sans changer aucun solde.
export function purgerRegistre(registre, limite) {
  const anciens = registre.mouvements.filter((mouvement) => mouvement.journee < limite);
  const seuil = debutJournee(limite);
  const demandesGardees = registre.demandes.filter((demande) => Date.parse(demande.le) >= seuil);
  if (anciens.length === 0 && demandesGardees.length === registre.demandes.length) return registre;
  const reports = { ...registre.reports };
  anciens.forEach((mouvement) => {
    reports[mouvement.enfant] = (reports[mouvement.enfant] || 0) + signe(mouvement);
  });
  return {
    ...registre,
    reports,
    mouvements: registre.mouvements.filter((mouvement) => mouvement.journee >= limite),
    demandes: demandesGardees,
  };
}
