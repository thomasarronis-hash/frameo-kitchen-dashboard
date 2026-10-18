// web/src/main.js
//
// Rôle    : point d'entrée de la page : assemble le magasin d'état, le flux, l'horloge, le thème, le menu, les
//           écrans (Accueil, Aujourd'hui, Météo, Repas, Courses, Maison, Photos, Agenda, Enfants, Voitures, Clims, et la Recette
//           en sous-écran), les minuteurs (tiroir, pastille, alerte, sonnerie), le minuteur d'écran de Timo (pastille, message
//           de fin) et les sons des enfants, le bandeau sonnette ; le routeur d'écrans
//           (routeur.js) ; le mode Photos après 3 min sans toucher ; l'unique tick par seconde ; le rechargement de 4h et
//           celui qui suit un déploiement ; le liseré rouge d'un jour Tempo rouge.
// Entrées : le DOM de index.html (#scene, #menu, #ecran, #nuit, #liseret, #bandeau, #sonnette, #pastille, #pastille-ecran,
//           #tiroir, #fin-video, #alerte, #non-appaire) ; window.Kiosk dans le kiosque ; localStorage ; ?theme=jour|soir|nuit
//           en développement.
// Sorties : la page vivante ; window.cadreDemarre = true une fois tout monté (lu par index.html, qui recharge la
//           page si le module n'a pas démarré en 10 s).
// Pièges  :
//   - UN seul minuteur pour toute la page, calé sur la seconde de l'heure corrigée : horloge, minuteurs et
//     sonnerie, thème, chien de garde du flux, bandeau, pied du menu, inactivité, rechargement.
//   - Les écrans sont redessinés à chaque message du flux et à chaque changement de minute (« aujourd'hui »,
//     « Ce midi » / « Ce soir », périodes, rappels et gamelle de la page Aujourd'hui, pluie dans l'heure,
//     événements finis de l'agenda, ligne de l'heure de la grille de l'Agenda dépendent de l'heure) ; le
//     tick des minuteurs ne change que les textes
//     qui bougent (dom.js). La vue Aujourd'hui est calculée une fois par rendu : la page et l'encart de l'Accueil
//     la partagent. L'Agenda calcule la sienne (il garde la semaine montrée) à partir de la valeur du flux.
//   - Les RÈGLES (minuteurs en heure corrigée et sonnerie, retour à l'Accueil, recette oubliée refermée après
//     2 h, éveil au passage en nuit, report du rechargement, événements d'activité) sont dans pilotage.js, sans
//     DOM et testées : ce fichier ne fait que les brancher sur les écrans.
//   - Après 60 s sans toucher ni taper : retour à l'Accueil (et rendormissement la nuit), le tiroir se referme ;
//     pas pendant l'alerte de fin, ni recette ouverte (sauf recette oubliée, voir pilotage.js).
//   - Rechargement à 4h (heure de Paris) reporté tant qu'un minuteur tourne ou sonne, qu'une recette est ouverte
//     ou qu'on a touché l'écran depuis moins de 60 s ; journée de référence relevée une fois l'horloge réglée
//     (rechargement.js explique pourquoi).
//   - Rechargement après un déploiement : chaque instantané apporte l'empreinte du contenu servi ; la première est
//     retenue, une autre (reconnexion après un déploiement) recharge la page, mais pas tant qu'un minuteur tourne ou
//     sonne, qu'une recette est ouverte, que l'écran Enfants est ouvert ou que le bandeau sonnette est affiché, ni
//     avant 60 s sans toucher (rechargementVersionBloque de pilotage.js, doitRechargerVersion de rechargement.js).
//   - Liseré rouge (#liseret) en haut de la scène, par-dessus tous les écrans, un jour Tempo rouge de 6 h à 22 h,
//     du 1er novembre au 31 mars (tempo.js) ; recalculé à chaque minute et à chaque message du flux.
//   - Un minuteur qui sonne remet la luminosité au jour, même la nuit : l'alerte doit se voir.
//   - Bandeau sonnette (conception §1.6) : un coup de sonnette repéré dans le flux (web/src/sonnette.js) l'ouvre
//     par-dessus tout écran (recette et mode Photos compris), avec la photo de CE coup seulement (suivi du serveur,
//     clé sonnette du flux) ; il réveille l'écran (luminosité du jour, sortie du mode nuit le temps du bandeau) et se
//     masque au bout de 2 min ou au premier toucher qui ne vise pas « Voir le direct ». « Voir le direct » (seulement
//     avec un flux vidéo) referme la recette ou le tiroir, ouvre la section Sonnette de l'écran Maison et lance le
//     direct.
//   - Un toucher qui masque le bandeau ou fait sortir du mode Photos ne fait QUE cela : stopPropagation en phase de
//     capture, le bouton dessous ne voit ni le poser ni le lever (sinon toucher « ailleurs » lançait YouTube, cochait
//     un article ou avançait la recette). L'inactivité, écoutée sur document comme ce gestionnaire, le compte quand
//     même.
//   - Écran Maison retenu (direct de la sonnette, Wi-Fi invités affiché) : pas de retour à l'Accueil au bout de
//     60 s ; quitter l'écran arrête le direct et masque le Wi-Fi (maison.js).
//   - Mode Photos (conception §1.5, M4) : entrée après 3 min sans toucher seulement (règle decisionPhotos de
//     pilotage.js : plus d'entrée Photos au menu depuis le 14/10, menu.js) ; plein écran, menu masqué (classe
//     scene-photos), tiroir refermé, pastille des minuteurs remplacée par la ligne du minuteur dans la pastille « Ce soir ».
//     Un toucher n'importe où (pointerdown en phase de capture, comme la nuit) ramène l'Accueil, sauf sur « Voir le
//     direct » du bandeau sonnette, qui ouvre la sonnette. Sortie aussi à la nuit (20 h 30) et quand le flux se tait. Sans clé Immich,
//     lot vide ou en échec, la nuit ou hors ligne, le mode ambiant ne se déclenche pas. La première vue se prépare
//     pendant la minute qui précède ('preparer') et le mode ne s'ouvre qu'une fois elle chargée : un Wi-Fi qui décroche
//     laisse l'Accueil au lieu d'un écran vide (constat du 14/10).
//   - Enfants (choix de Thomas du 14/10, partie 4) : l'écran (ecrans/enfants.js) masque le menu en mode enfant (classe
//     scene-enfant, surPleinEcran) et revient à l'Accueil après 90 s sans toucher (enfantsRetenu de pilotage.js) ; le matin,
//     la case des deux visages de l'Accueil ouvre directement le tableau d'un enfant. Le minuteur d'écran de Timo, tenu par
//     le serveur, a sa pastille dans le menu (#pastille-ecran) et, à la fin, un message par-dessus tout (#fin-video, son
//     doux) ; tant qu'il tourne, pas de mode Photos. Un seul AudioContext pour la page : la sonnerie des minuteurs et les
//     sons des enfants le partagent (contexteAudio), déverrouillé à chaque toucher sur l'écran des enfants.
//   - Clims (choix de Thomas du 16/10) : écran clims.js, panneau de commande entier de chaque clim (un simple appui, choix
//     de Thomas ; « Mode essai » d'après simulation_clim) ; sa consigne part depuis entretenir(), au tick, même hors de
//     l'écran.
//   - Voitures (choix de Thomas du 14/10) : écran voitures.js, avec les commandes de la Mégane sous sa carte (un simple
//     appui, choix de Thomas ; « Mode essai » d'après simulation_voiture) ; ses réglages partent depuis entretenir(), au
//     tick, même hors de l'écran. L'alerte du soir (25 % ou moins à partir de 18 h, pas branchée) est dans la page
//     Aujourd'hui et le compteur de son encart, pas sur l'Accueil.
//   - Sprite d'icônes chargé à jour et posé dans la page dès le démarrage (sprite.js) : après un déploiement, la WebView
//     du cadre gardait l'ancien /icones.svg externe en mémoire (16/10, icônes neuves vides).
//   - La nuit, un toucher n'importe où (pointerdown en phase de capture) montre l'écran en Ardoise ; au passage
//     en nuit, l'écran reste éveillé si on vient de toucher ou si une recette est ouverte. Le son est déverrouillé
//     (politique de lecture automatique, sonnerie.js) au lancement d'un minuteur et à chaque toucher tant qu'il
//     en reste un (après un rechargement) : pas d'AudioContext ouvert pour rien.
//   - Un menu null (serveur qui redémarre, nouveau cycle pas encore publié) ne referme pas la recette ouverte :
//     seul un menu publié qui n'a plus ce repas la referme.
//   - ?theme= n'est appliqué que si /dev/reglages répond, c'est-à-dire serveur en NODE_ENV=development :
//     en production cette route n'existe pas et le paramètre est ignoré (décision dans theme.js, testée).
//   - « Cadre non appairé » : décidé par api.js sur un 401 ; jamais de rechargement en boucle.

import { creerClient, creerFlux, SILENCE_MAX_MS } from './api.js';
import { creerBandeauHorsLigne } from './composants/bandeau-hors-ligne.js';
import { creerBandeauSonnette } from './composants/bandeau-sonnette.js';
import { creerMenu } from './composants/menu.js';
import { creerAlerte, creerTiroir } from './composants/minuteurs.js';
import { creerFinVideo } from './composants/fin-video.js';
import { creerNonAppaire } from './composants/non-appaire.js';
import { creerPastille } from './composants/pastille.js';
import { creerPastilleEcran } from './composants/pastille-ecran.js';
import { ecrire, masquer } from './dom.js';
import { creerAccueil } from './ecrans/accueil.js';
import { vueAccueil } from './ecrans/accueil-donnees.js';
import { creerAgenda } from './ecrans/agenda.js';
import { creerEnfants } from './ecrans/enfants.js';
import { creerVeilleFin, minuteurEcranEnCours, vuePastilleEcran } from './ecrans/enfants-donnees.js';
import { creerAujourdhui } from './ecrans/aujourdhui.js';
import { encartAujourdhui, vueAujourdhui } from './ecrans/aujourdhui-donnees.js';
import { creerCourses } from './ecrans/courses.js';
import { creerMaison } from './ecrans/maison.js';
import { creerMeteo } from './ecrans/meteo.js';
import { creerPhotos } from './ecrans/photos.js';
import { vueMeteoEcran } from './ecrans/meteo-donnees.js';
import { creerRecette } from './ecrans/recette.js';
import { creerCoches } from './ecrans/recette-donnees.js';
import { creerRepas } from './ecrans/repas.js';
import { vueRepas } from './ecrans/repas-donnees.js';
import { creerClims } from './ecrans/clims.js';
import { vueClims } from './ecrans/clims-donnees.js';
import { creerVoitures } from './ecrans/voitures.js';
import { vueVoitures } from './ecrans/voitures-donnees.js';
import { creerEtat } from './etat.js';
import { creerHorloge, texteHeure } from './heure.js';
import { creerInactivite } from './inactivite.js';
import { creerKiosque } from './kiosque.js';
import { creerMinuteurs, vuePastille } from './minuteurs.js';
import {
  apresInactivite, creerPiloteMinuteurs, decisionPhotos, DELAI_INACTIVITE_MS, enfantsRetenu, EVENEMENTS_ACTIVITE,
  eveilPassageNuit, rechargementBloque, rechargementVersionBloque, toucherQuiMasque,
} from './pilotage.js';
import {
  creerSuiviVersion, doitRecharger, doitRechargerVersion, journeeDeRechargement,
} from './rechargement.js';
import { creerRouteur } from './routeur.js';
import { ajusterScene } from './scene.js';
import { creerSonsEnfants } from './sons-enfants.js';
import { creerVeilleSonnette } from './sonnette.js';
import { creerSonnerie } from './sonnerie.js';
import { chargerSprite } from './sprite.js';
import { creerStockage } from './stockage.js';
import { vueTempo } from './tempo.js';
import { apparence, demanderThemeForce, themePour } from './theme.js';

const LUMINOSITE_ALERTE = 1;
const SONNERIE = 'binary_sensor.doorbell_ringing';
const monotone = () => performance.now();

chargerSprite({ requete: (url, options) => fetch(url, options), document });
const etat = creerEtat();
const horloge = creerHorloge();
const kiosque = creerKiosque(window.Kiosk);
const stockage = creerStockage(() => window.localStorage);
const inactivite = creerInactivite({ delaiMs: DELAI_INACTIVITE_MS, monotone });
const flux = creerFlux({
  url: '/api/flux',
  etat,
  horloge,
  monotone,
  ouvrirSource: (url) => new EventSource(url),
  verifierCle: () => fetch('/api/menu', { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' }).then((r) => r.status),
});
const client = creerClient({ requete: (url, options) => fetch(url, options), surNonAppaire: () => flux.signalerNonAppaire() });
const minuteurs = creerMinuteurs({ stockage });
let audio;
const contexteAudio = () => {
  if (audio === undefined) {
    const Contexte = window.AudioContext || window.webkitAudioContext;
    audio = Contexte ? new Contexte() : null;
  }
  return audio;
};
const sonnerie = creerSonnerie({
  creerContexte: contexteAudio,
  creerAudio: (octets) => new Audio(URL.createObjectURL(new Blob([octets], { type: 'audio/wav' }))),
  kiosque,
});
const pilote = creerPiloteMinuteurs({ minuteurs, horloge, sonnerie, monotone });
const veilleSonnette = creerVeilleSonnette();
const version = creerSuiviVersion();
const sonsEnfants = creerSonsEnfants({ obtenirContexte: contexteAudio });
const veilleFin = creerVeilleFin();

const scene = document.getElementById('scene');
const conteneurEcran = document.getElementById('ecran');
const heureNuit = document.querySelector('#nuit .nuit-heure');
const liseret = document.getElementById('liseret');

let themeHoraire = null;
let themeForce = null;
let eveilleNuit = false;
let classeAffichee = null;
let derniereMinute = null;
let dernierMenu = null;
let referenceRechargement = null;
let maisonRetenue = false;
let enfantsRetenus = false;

const ecrans = {
  accueil: creerAccueil(conteneurEcran, {
    ouvrirRecette,
    ouvrirCourses: () => afficher('courses'),
    ouvrirMinuteurs,
    ouvrirMaison,
    ouvrirAujourdhui: () => afficher('aujourdhui'),
    ouvrirEnfant,
  }),
  aujourdhui: creerAujourdhui(conteneurEcran, { ouvrirRecette }),
  meteo: creerMeteo(conteneurEcran),
  repas: creerRepas(conteneurEcran, { ouvrirRecette }),
  courses: creerCourses(conteneurEcran, { client, stockage, monotone }),
  maison: creerMaison(conteneurEcran, { client, monotone, maintenant: () => horloge.maintenant() }),
  photos: creerPhotos(conteneurEcran, { client, monotone }),
  agenda: creerAgenda(conteneurEcran),
  enfants: creerEnfants(conteneurEcran, {
    client,
    maintenant: () => horloge.maintenant(),
    sons: sonsEnfants,
    surPleinEcran: (actif) => scene.classList.toggle('scene-enfant', actif),
    allerAccueil: () => afficher('accueil'),
  }),
  voitures: creerVoitures(conteneurEcran, { client, monotone }),
  clims: creerClims(conteneurEcran, { client, monotone }),
};
const recette = creerRecette(conteneurEcran, {
  fermer: fermerRecette,
  lancerMinuteur: (minuteur) => {
    if (!lancerMinuteur(minuteur)) ouvrirMinuteurs();
  },
  ouvrirMinuteurs,
  coches: creerCoches({ stockage }),
  trouverMinuteur: (libelle) => minuteurs.trouver(libelle),
});
const menu = creerMenu(document.getElementById('menu'), { surNavigation: (nom) => afficher(nom) });
const bandeau = creerBandeauHorsLigne(document.getElementById('bandeau'));
const tiroir = creerTiroir(document.getElementById('tiroir'), {
  lancer: (dureeMs) => lancerMinuteur({ libelle: minuteurs.nomLibre(), dureeMs, surplusMs: 0 }),
  ajouter: (id) => {
    pilote.ajouter(id);
    rendreMinuteurs();
  },
  annuler: (id) => {
    pilote.annuler(id);
    rendreMinuteurs();
  },
  retablir: (id) => {
    const retabli = pilote.retablir(id);
    rendreMinuteurs();
    return retabli;
  },
});
const alerte = creerAlerte(document.getElementById('alerte'), {
  arreter: () => {
    pilote.arreterSonnants();
    rendreMinuteurs();
  },
  prolonger: (id, dureeMs) => {
    pilote.prolonger(id, dureeMs);
    rendreMinuteurs();
  },
});
const pastille = creerPastille(document.getElementById('pastille'), { ouvrir: ouvrirMinuteurs });
const pastilleEcran = creerPastilleEcran(document.getElementById('pastille-ecran'), { ouvrir: ouvrirEnfant });
const finVideo = creerFinVideo(document.getElementById('fin-video'), { fermer: (cle) => veilleFin.fermer(cle), sons: sonsEnfants });
const bandeauSonnette = creerBandeauSonnette(document.getElementById('sonnette'), { voirDirect });
const nonAppaire = creerNonAppaire(document.getElementById('non-appaire'));
const routeur = creerRouteur({
  ecrans, scene, tiroir, menu, recetteOuverte: () => recette.ouverte() !== null,
});
const enLigne = () => flux.silenceMs() <= SILENCE_MAX_MS;

// Photos reçoit ce qui l'empêche (nuit, hors ligne) : il refuse alors de s'ouvrir et l'Accueil reste (routeur.js).
function afficher(nom) {
  routeur.afficher(nom, { nuit: themeHoraire === 'nuit', enLigne: enLigne() });
}

function ouvrirRecette(repasId) {
  if (!recette.ouvrir(etat.lire().menu, repasId)) return;
  tiroir.fermer();
  scene.classList.add('scene-plein');
  routeur.rafraichir();
  recette.mettreAJourMinuteur(horloge.maintenant());
}

function fermerRecette() {
  recette.fermer();
  scene.classList.remove('scene-plein');
  routeur.rafraichir();
}

function ouvrirEnfant(id) {
  if (recette.ouverte() !== null) fermerRecette();
  tiroir.fermer();
  afficher('enfants');
  ecrans.enfants.ouvrirEnfant(id);
}

function majEnfants(ms) {
  const enfants = etat.lire().enfants;
  pastilleEcran.mettreAJour(vuePastilleEcran(enfants, ms));
  finVideo.mettreAJour(veilleFin.observer(enfants, ms));
}

function ouvrirMaison(section) {
  afficher('maison');
  ecrans.maison.ouvrirSection(section);
}

function voirDirect() {
  veilleSonnette.fermer();
  majSonnette();
  if (recette.ouverte() !== null) fermerRecette();
  tiroir.fermer();
  afficher('maison');
  ecrans.maison.lancerDirect(horloge.maintenant());
}

function vueBandeau(ms) {
  const donnees = etat.lire();
  return veilleSonnette.vue(ms, donnees.sonnette, donnees.direct_video);
}

// Bandeau sonnette, puis thème : un bandeau qui s'ouvre ou se ferme change l'éveil de l'écran.
function majSonnette() {
  bandeauSonnette.mettreAJour(vueBandeau(horloge.maintenant()));
  appliquerTheme();
}

function rendreMinuteurs() {
  const evaluation = pilote.evaluer();
  if (!evaluation) return null;
  const { ms, etat: etatMinuteurs } = evaluation;
  const vueMinuteur = vuePastille(etatMinuteurs, ms);
  pastille.mettreAJour(vueMinuteur);
  ecrans.photos.mettreAJourMinuteur(vueMinuteur);
  tiroir.mettreAJour(etatMinuteurs, ms);
  alerte.mettreAJour(etatMinuteurs.sonnants);
  recette.mettreAJourMinuteur(ms);
  return etatMinuteurs;
}

function lancerMinuteur(minuteur) {
  const lance = pilote.lancer(minuteur);
  rendreMinuteurs();
  return lance;
}

function ouvrirMinuteurs() {
  tiroir.ouvrir();
  rendreMinuteurs();
}

function rendre() {
  const ms = horloge.maintenant();
  const donnees = etat.lire();
  const jour = vueAujourdhui(donnees, ms);
  ecrans.accueil.mettreAJour(vueAccueil(donnees, ms), encartAujourdhui(jour));
  ecrans.aujourdhui.mettreAJour(jour);
  ecrans.meteo.mettreAJour(vueMeteoEcran(donnees, ms));
  ecrans.repas.mettreAJour(vueRepas(donnees.menu, ms));
  ecrans.agenda.mettreAJour(donnees.agenda, ms);
  ecrans.courses.mettreAJour({ courses: donnees.courses, simulation: donnees.simulation });
  ecrans.maison.mettreAJour(donnees, ms);
  ecrans.photos.mettreAJour(donnees, ms);
  ecrans.voitures.mettreAJour(vueVoitures(donnees.voitures, ms, donnees.simulation_voiture));
  ecrans.clims.mettreAJour(vueClims(donnees.clims, donnees.simulation_clim));
  ecrans.enfants.mettreAJour(donnees.enfants, ms);
  majEnfants(ms);
  if (veilleSonnette.observer(donnees.entites[SONNERIE], ms)) majSonnette();
  if (donnees.menu !== dernierMenu) {
    dernierMenu = donnees.menu;
    if (recette.ouverte() !== null && donnees.menu !== null && !recette.mettreAJourMenu(donnees.menu)) fermerRecette();
  }
  ecrire(heureNuit, texteHeure(ms));
  masquer(liseret, !vueTempo(donnees.tempo, ms).liseret);
  version.observer(donnees.empreinte);
}

function appliquerTheme() {
  const soleil = etat.lire().entites['sun.sun'];
  const elevation = soleil ? soleil.attributes.elevation : null;
  const precedent = themeHoraire;
  themeHoraire = themeForce || themePour(horloge.maintenant(), elevation, themeHoraire);
  if (themeHoraire !== 'nuit') eveilleNuit = false;
  else if (!themeForce && precedent !== null && precedent !== 'nuit') {
    eveilleNuit = eveilPassageNuit({ inactifMs: inactivite.inactifMs(), recetteOuverte: recette.ouverte() !== null });
  }
  const sonnetteVisible = bandeauSonnette.estVisible();
  const vue = apparence(themeHoraire, eveilleNuit || sonnetteVisible);
  if (vue.classe !== classeAffichee) {
    document.documentElement.className = `theme-${vue.classe}`;
    classeAffichee = vue.classe;
  }
  kiosque.luminosite(alerte.estVisible() || sonnetteVisible ? LUMINOSITE_ALERTE : vue.luminosite);
}

function majConnexion() {
  const silenceMs = flux.silenceMs();
  menu.connexion({ enLigne: enLigne(), silenceMs, ha: etat.lire().ha });
  bandeau.mettreAJour({ enLigne: enLigne(), silenceMs, surAccueil: routeur.actif() === 'accueil' && recette.ouverte() === null });
  ecrans.courses.connexion(enLigne());
  nonAppaire.mettreAJour(flux.nonAppaire(), texteHeure(horloge.maintenant()));
}

function verifierRechargement(etatMinuteurs) {
  const ms = horloge.maintenant();
  if (referenceRechargement === null) {
    if (horloge.estReglee()) referenceRechargement = journeeDeRechargement(ms);
    return;
  }
  const bloque = rechargementBloque({ recetteOuverte: recette.ouverte() !== null, etatMinuteurs });
  if (doitRecharger({ reference: referenceRechargement, ms, bloque, inactifMs: inactivite.inactifMs() })) window.location.reload();
}

function verifierVersion(etatMinuteurs) {
  const bloque = rechargementVersionBloque({
    recetteOuverte: recette.ouverte() !== null, etatMinuteurs, sonnetteVisible: bandeauSonnette.estVisible(), ecranActif: routeur.actif(),
  });
  if (doitRechargerVersion({ nouvelle: version.nouvelle(), bloque, inactifMs: inactivite.inactifMs() })) window.location.reload();
}

function tick() {
  const minute = Math.floor(horloge.maintenant() / 60000);
  if (minute !== derniereMinute) {
    derniereMinute = minute;
    rendre();
  }
  flux.verifier();
  const ms = horloge.maintenant();
  const retenue = routeur.actif() === 'maison' && ecrans.maison.retenu(ms);
  const enfantsGardes = enfantsRetenu({ ecranActif: routeur.actif(), inactifMs: inactivite.inactifMs() });
  const suite = apresInactivite({
    signal: inactivite.verifier(),
    inactifMs: inactivite.inactifMs(),
    recetteOuverte: recette.ouverte() !== null,
    alerteVisible: alerte.estVisible(),
    minuteursActifs: pilote.actifs(),
    ecranRetenu: retenue || enfantsGardes || ecrans.photos.ambiance(),
    retenuFini: (maisonRetenue && !retenue) || (enfantsRetenus && !enfantsGardes),
  });
  maisonRetenue = retenue;
  enfantsRetenus = enfantsGardes;
  if (suite === 'fermer-recette') fermerRecette();
  if (suite !== 'rien') {
    eveilleNuit = false;
    tiroir.fermer();
    afficher('accueil');
  }
  const photos = decisionPhotos({
    enPhotos: ecrans.photos.ambiance(),
    inactifMs: inactivite.inactifMs(),
    recetteOuverte: recette.ouverte() !== null,
    alerteVisible: alerte.estVisible(),
    sonnetteVisible: bandeauSonnette.estVisible(),
    nuit: themeHoraire === 'nuit',
    photosPretes: ecrans.photos.pretes(),
    vuePrete: ecrans.photos.vuePrete(),
    enLigne: enLigne(),
    ecranRetenu: retenue || enfantsGardes,
    minuteurEcran: minuteurEcranEnCours(etat.lire().enfants, ms),
  });
  if (photos === 'entrer') afficher('photos');
  else if (photos === 'sortir') afficher('accueil');
  ecrans.photos.entretenir({ preparer: photos === 'preparer' });
  sonnerie.entretenir();
  const etatMinuteurs = rendreMinuteurs();
  ecrans.courses.entretenir();
  ecrans.maison.entretenir(ms);
  ecrans.voitures.entretenir();
  ecrans.clims.entretenir();
  ecrans.enfants.entretenir(ms);
  majEnfants(ms);
  bandeauSonnette.mettreAJour(vueBandeau(ms));
  appliquerTheme();
  majConnexion();
  if (etatMinuteurs) {
    verifierRechargement(etatMinuteurs);
    verifierVersion(etatMinuteurs);
  }
}

function planifierTick() {
  setTimeout(() => {
    tick();
    planifierTick();
  }, 1000 - (horloge.maintenant() % 1000));
}

function demanderThemeDeDeveloppement() {
  demanderThemeForce(window.location.search, (url) => fetch(url, { cache: 'no-store' })).then((theme) => {
    if (!theme) return;
    themeForce = theme;
    appliquerTheme();
  });
}

ajusterScene(scene, window);
window.addEventListener('resize', () => ajusterScene(scene, window));
EVENEMENTS_ACTIVITE.forEach((type) => document.addEventListener(type, () => inactivite.toucher(), true));
document.addEventListener('pointerdown', (e) => {
  if (pilote.actifs()) sonnerie.deverrouiller();
  if (routeur.actif() === 'enfants') sonsEnfants.deverrouiller();
  const toucher = toucherQuiMasque({
    enPhotos: ecrans.photos.ambiance(), bandeauVisible: bandeauSonnette.estVisible(), surDirect: bandeauSonnette.contient(e.target),
  });
  if (toucher.sortirPhotos) afficher('accueil');
  if (toucher.masquerBandeau) {
    veilleSonnette.fermer();
    bandeauSonnette.mettreAJour(null);
  }
  if (toucher.consomme) e.stopPropagation();
  if (themeHoraire === 'nuit') {
    eveilleNuit = true;
    appliquerTheme();
  }
}, true);
etat.abonner(() => {
  rendre();
  majConnexion();
});

afficher('accueil');
rendre();
tick();
flux.demarrer();
demanderThemeDeDeveloppement();
planifierTick();
window.cadreDemarre = true;
