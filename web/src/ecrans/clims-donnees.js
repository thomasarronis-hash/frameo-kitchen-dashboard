// web/src/ecrans/clims-donnees.js
//
// Rôle    : les clims (choix de Thomas du 16/10 : deux clims Bosch, panneau de commande entier, aucune protection contre
//           les enfants), sans DOM (testé) : une carte par clim pour l'écran Clims (marche, température de la pièce,
//           consigne, modes, ventilation, oscillations, options, chacun avec son libellé et son pictogramme), les valeurs
//           envoyées mais pas encore rapportées par HA (creerAttentes) et le message d'une ligne après une commande.
// Entrées : clims du flux (serveur/ha/clims.js : null avant le premier instantané, [] sans clim configurée, sinon
//           [{ nom, disponible, mode, modes, temperature, consigne, ventilation, ventilations, oscillation, options }]) ;
//           simulation_clim du flux ; pour les attentes, une horloge monotone en ms (performance.now).
// Sorties : vueClims(clims, simulation) -> { etat (attente, vide ou ok), essai (vrai : bandeau « Mode essai »), cartes: [{
//           nom, disponible, allumee, mode, temperature (« 22,5 » ou null), consigne ({ valeur, min, max, pas } ou null),
//           modes: [{ cle, libelle, icone }], ventilation, ventilations: [{ cle, libelle }], oscillations: [{ cle,
//           libelle, icone, actif }], options: [{ cle, libelle, icone, actif, modifiable }] }] } ;
//           creerAttentes() -> { poser(cle, valeur, ms), valeur(cle, actuelle, ms), enAttente(cle), recu(cle, reponse) } ;
//           messageClim(reponse) ; texteDegres(valeur) (« 21 », « 21,5 ») ; MODES, VENTILATIONS, OSCILLATIONS, OPTIONS ;
//           CARTES_MAX (2, comme CLIMS_MAX du serveur) ; ECART_CONSIGNE_MS (2 s, comme ECART_MS du serveur) ;
//           GARDE_ATTENTE_MS (60 s).
// Pièges  :
//   - Seulement ce que le flux dit que la clim accepte : un mode, une ventilation ou un sens d'oscillation absent n'a
//     pas de bouton ; une option non configurée (CLIMS) ou indisponible non plus. Une option que la clim refuse de changer
//     maintenant (writable_now à false : Eco, Boost... clim éteinte, constat du 16/10) a son bouton, désactivé.
//   - allumee : mode connu et différent de « off ». Un mode inconnu (null) : ni allumée ni éteinte affirmée, le
//     bouton Marche propose d'allumer.
//   - Attentes : HA ne rapporte la nouvelle valeur qu'après le relevé suivant du cloud Bosch (plusieurs secondes). Une
//     commande partie pour de vrai garde sa valeur à l'écran (en attente) jusqu'à ce que le flux la rapporte, au plus
//     60 s ; en mode essai ou après un refus, l'affichage revient tout de suite au flux (rien n'a changé dans la clim).
//   - messageClim : une ligne courte pour la famille, jamais le nom d'un service HA ; 503 (option pas modifiable
//     maintenant, valeur refusée) : « Pas possible pour l'instant ».

import { nombreFr } from '../format.js';

export const CARTES_MAX = 2;
export const ECART_CONSIGNE_MS = 2000;
export const GARDE_ATTENTE_MS = 60000;
export const MODES = [
  { cle: 'cool', libelle: 'Froid', icone: 'i-flocon' },
  { cle: 'heat', libelle: 'Chaud', icone: 'i-sun' },
  { cle: 'auto', libelle: 'Auto', icone: 'i-auto' },
  { cle: 'dry', libelle: 'Sec', icone: 'i-drop' },
  { cle: 'fan_only', libelle: 'Vent', icone: 'i-wind' },
];
export const VENTILATIONS = [
  { cle: 'auto', libelle: 'Auto' },
  { cle: 'quiet', libelle: 'Silence' },
  { cle: 'low', libelle: '1' },
  { cle: 'medium', libelle: '2' },
  { cle: 'high', libelle: '3' },
  { cle: 'turbo', libelle: 'Turbo' },
];
export const OSCILLATIONS = [
  { cle: 'verticale', libelle: 'Haut-bas', icone: 'i-hautbas' },
  { cle: 'horizontale', libelle: 'Côtés', icone: 'i-cotes' },
];
export const OPTIONS = [
  { cle: 'eco', libelle: 'Éco', icone: 'i-leaf' },
  { cle: 'boost', libelle: 'Boost', icone: 'i-eclair' },
  { cle: 'sommeil', libelle: 'Nuit', icone: 'i-moon' },
  { cle: 'ioniseur', libelle: 'Ions', icone: 'i-ions' },
  { cle: 'pas_sur_moi', libelle: 'Pas sur moi', icone: 'i-main' },
  { cle: 'hors_gel', libelle: 'Hors-gel', icone: 'i-thermo' },
];
const MESSAGE_ESSAI = 'Mode essai : rien n\'est envoyé';

const fini = (valeur) => typeof valeur === 'number' && isFinite(valeur);
const liste = (valeur) => (Array.isArray(valeur) ? valeur : []);

export const texteDegres = (valeur) => nombreFr(valeur);

function consigneValide(consigne) {
  if (!consigne || ![consigne.valeur, consigne.min, consigne.max, consigne.pas].every(fini)) return null;
  if (consigne.min >= consigne.max || consigne.pas <= 0) return null;
  return {
    valeur: consigne.valeur, min: consigne.min, max: consigne.max, pas: consigne.pas,
  };
}

function carte(clim) {
  const modes = liste(clim.modes);
  const ventilations = liste(clim.ventilations);
  const oscillation = clim.oscillation || {};
  const options = liste(clim.options);
  return {
    nom: clim.nom,
    disponible: clim.disponible === true,
    allumee: clim.mode !== null && clim.mode !== undefined && clim.mode !== 'off',
    mode: clim.mode === undefined ? null : clim.mode,
    temperature: fini(clim.temperature) ? texteDegres(clim.temperature) : null,
    consigne: consigneValide(clim.consigne),
    modes: MODES.filter(({ cle }) => modes.indexOf(cle) !== -1),
    ventilation: clim.ventilation === undefined ? null : clim.ventilation,
    ventilations: VENTILATIONS.filter(({ cle }) => ventilations.indexOf(cle) !== -1),
    oscillations: OSCILLATIONS
      .filter(({ cle }) => oscillation[cle] === true || oscillation[cle] === false)
      .map((description) => ({ ...description, actif: oscillation[description.cle] })),
    options: OPTIONS
      .map((description) => {
        const etat = options.filter((option) => option.cle === description.cle)[0];
        return etat ? { ...description, actif: etat.actif === true, modifiable: etat.modifiable !== false } : null;
      })
      .filter(Boolean),
  };
}

export function vueClims(clims, simulation) {
  if (!clims) return { etat: 'attente', essai: false, cartes: [] };
  if (clims.length === 0) return { etat: 'vide', essai: false, cartes: [] };
  return { etat: 'ok', essai: simulation === true, cartes: clims.slice(0, CARTES_MAX).map(carte) };
}

// Valeurs envoyées pour de vrai, montrées jusqu'à ce que le flux les rapporte (60 s au plus).
export function creerAttentes() {
  const attentes = {};
  return {
    poser(cle, valeur, ms) {
      attentes[cle] = { valeur, depuis: ms, envoyee: false };
    },
    valeur(cle, actuelle, ms) {
      const attente = attentes[cle];
      if (!attente) return actuelle;
      const rapportee = attente.envoyee && attente.valeur === actuelle;
      if (rapportee || ms - attente.depuis >= GARDE_ATTENTE_MS) {
        delete attentes[cle];
        return actuelle;
      }
      return attente.valeur;
    },
    enAttente: (cle) => Boolean(attentes[cle]),
    recu(cle, reponse) {
      const reelle = reponse.ok && !(reponse.donnees && reponse.donnees.simulation === true);
      if (!attentes[cle]) return;
      if (reelle) attentes[cle].envoyee = true;
      else delete attentes[cle];
    },
  };
}

export function messageClim(reponse) {
  if (reponse.ok) return reponse.donnees && reponse.donnees.simulation === true ? MESSAGE_ESSAI : 'Envoyé';
  if (reponse.statut === 429) return 'Trop tôt, réessayer dans un moment';
  if (reponse.statut === 0) return 'Pas de réponse du serveur du cadre';
  if (reponse.statut === 503) return 'Pas possible pour l\'instant';
  if (reponse.statut === 502) return 'La clim ne répond pas';
  return 'Commande refusée par le serveur';
}
