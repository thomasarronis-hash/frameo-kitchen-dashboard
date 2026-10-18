// web/src/ecrans/maison-telecommandes.js
//
// Rôle    : les sections Apple TV et Télé (TCL) de l'écran Maison : pavé directionnel, OK, retour, menu, lecture/pause,
//           volume (plus allumer et veille pour l'Apple TV, muet pour la télé) ; pour l'Apple TV, les applis de vidéo de
//           la box ; pour la télé, deux conseils d'usage.
// Entrées : creerTelecommande(parent, { modele: 'appletv' | 'tele', envoyer, monotone }) : envoyer(chemin, corps) ->
//           promesse de { ok, donnees, statut, message } (client.poster de api.js) ; monotone (performance.now) pour
//           effacer un message ; mettreAJour(vue) avec vueTelecommandes(...).appletv ou .tele (maison-donnees.js) ;
//           entretenir() à chaque seconde.
// Sorties : { racine, mettreAJour(vue), entretenir() } ; APPLIS_AFFICHEES et applisAffichees(sourceList) (testées).
// Pièges  :
//   - Les touches envoyées sont celles de la liste blanche du serveur (serveur/ha/actions-maison.js) : up, down...
//     pour l'Apple TV (remote.sejour_sejour), DPAD_UP... pour la télé (remote.smart_tv_pro_2). Toute autre valeur
//     serait refusée (400) : ce fichier et la liste du serveur vont ensemble.
//   - Pavé et volume : ACTION au lever du doigt (pointerup, moins de 20 px, 300 ms d'anti-répétition, appui.js) ; le
//     serveur plafonne à 10 par seconde. Veille et applis coupent ou changent le programme du séjour : APPUI LONG
//     d'une seconde (barre qui se remplit), un simple toucher dit seulement « Garder le doigt 1 seconde » (un enfant
//     qui joue ou un toucher involontaire ne coupe pas le film).
//   - « Menu TV » et non « Accueil » pour la touche home : « Accueil » est aussi l'entrée du menu du cadre.
//   - Applis : seulement celles de APPLIS_AFFICHEES (vidéo et télé), dans cet ordre, et présentes dans la source_list
//     ACTUELLE de la box ; App Store, Arcade, Réglages, Ordinateurs... n'ont rien à faire sur le mur de la cuisine.
//     Liste à ajuster par Thomas (une ligne). Boutons reconstruits seulement quand la liste change (rare).
//   - Une seule ligne de message sous le pavé (texte d'une ligne : 38 caractères environ en 26 px), partagée : le
//     message d'un geste (court, pour la famille : « L'Apple TV ne répond pas », jamais le nom d'un service HA, dont le
//     détail est au journal du serveur) passe avant l'alerte d'un appareil injoignable (« … ne répond pas »). En mode
//     essai, chaque geste dit « Essai : touche non envoyée » à côté du pavé.
//   - Disposition par grid-template-areas (feuille telecommande.css) : chaque touche porte sa zone (touche-haut...).

import { creerGarde, surAppui, surAppuiLong } from '../composants/appui.js';
import { ecrire, element, etiqueter, icone, masquer } from '../dom.js';

const DUREE_MESSAGE_MS = 8000;
const CONSIGNE_APPUI_LONG = 'Garder le doigt 1 seconde';
export const APPLIS_AFFICHEES = [
  'Netflix', 'YouTube', 'Disney+', 'Prime Video', 'CANAL+', 'france•tv', 'TF1+', 'M6+', 'ARTE', 'Free TV', 'HBO Max', 'Twitch',
];
// [zone, touche envoyée, texte, icône, nom lu par un lecteur d'écran, vrai pour un appui long]
const MODELES = {
  appletv: {
    action: 'appletv_touche',
    nom: 'L\'Apple TV',
    touches: [
      ['retour', 'menu', 'Retour', 'i-back'], ['haut', 'up', '', 'i-prev', 'Haut'], ['accueil', 'home', 'Menu TV', 'i-home'],
      ['gauche', 'left', '', 'i-prev', 'Gauche'], ['ok', 'select', 'OK', null], ['droite', 'right', '', 'i-next', 'Droite'],
      ['lecture', 'play_pause', 'Lecture', 'i-play', 'Lecture ou pause'], ['bas', 'down', '', 'i-next', 'Bas'],
      ['volmoins', 'volume_down', 'Volume', 'i-minus', 'Baisser le volume'], ['volplus', 'volume_up', 'Volume', 'i-plus', 'Monter le volume'],
      ['allumer', 'wakeup', 'Allumer', 'i-power'], ['veille', 'suspend', 'Veille', 'i-moon', 'Mettre en veille', true],
    ],
  },
  tele: {
    action: 'tv_touche',
    nom: 'La télé',
    touches: [
      ['retour', 'BACK', 'Retour', 'i-back'], ['haut', 'DPAD_UP', '', 'i-prev', 'Haut'], ['accueil', 'HOME', 'Menu TV', 'i-home'],
      ['gauche', 'DPAD_LEFT', '', 'i-prev', 'Gauche'], ['ok', 'DPAD_CENTER', 'OK', null], ['droite', 'DPAD_RIGHT', '', 'i-next', 'Droite'],
      ['lecture', 'MEDIA_PLAY_PAUSE', 'Lecture', 'i-play', 'Lecture ou pause'], ['bas', 'DPAD_DOWN', '', 'i-next', 'Bas'],
      ['volmoins', 'VOLUME_DOWN', 'Volume', 'i-minus', 'Baisser le volume'], ['muet', 'MUTE', 'Muet', 'i-mute'],
      ['volplus', 'VOLUME_UP', 'Volume', 'i-plus', 'Monter le volume'],
    ],
  },
};
const CONSEILS_TELE = [
  'Pour allumer la télé : bouton Allumer de l\'onglet Apple TV (par la prise HDMI, sans garantie).',
  'Dans les applis de la télé (Netflix…), ses touches peuvent ne pas répondre : passer par l\'Apple TV.',
];

export function applisAffichees(sourceList) {
  return APPLIS_AFFICHEES.filter((appli) => sourceList.indexOf(appli) !== -1);
}

// Message d'un geste : null (touche partie), l'essai, ou un échec dit simplement.
function messageGeste(reponse, nom) {
  if (reponse.ok) return reponse.donnees && reponse.donnees.simulation === true ? 'Essai : touche non envoyée' : null;
  if (reponse.statut === 0) return 'Pas de réponse du serveur du cadre';
  if (reponse.statut === 429) return 'Trop de touches d\'affilée';
  if (reponse.statut === 503) return 'Liste des applis pas encore reçue';
  if (reponse.statut === 502) return `${nom} ne répond pas`;
  return 'Touche refusée par le serveur';
}

function boutonTouche([zone, , texte, nomIcone, nomLu]) {
  const bouton = element('button', `bouton-doux touche touche-${zone}`);
  bouton.type = 'button';
  if (nomIcone) bouton.appendChild(icone(nomIcone, 'touche-icone'));
  if (texte) bouton.appendChild(element('span', 'touche-texte', texte));
  if (nomLu) etiqueter(bouton, nomLu);
  return bouton;
}

export function creerTelecommande(parent, { modele, envoyer, monotone }) {
  const { action, nom, touches } = MODELES[modele];
  const racine = element('div', `maison-section telecommande telecommande-${modele}`);
  const gauche = element('section', 'telecommande-gauche');
  const etat = element('p', 'telecommande-etat');
  const ligne = element('div', 'telecommande-ligne');
  const alerte = element('p', 'telecommande-alerte', `${nom} ne répond pas`);
  const message = element('p', 'telecommande-message');
  message.setAttribute('role', 'alert');
  ligne.appendChild(alerte);
  ligne.appendChild(message);
  const pave = element('div', 'pave');
  let messageLe = null;
  let joignable = true;

  function afficherMessage(texte) {
    messageLe = texte === null ? null : monotone();
    masquer(message, texte === null);
    masquer(alerte, texte !== null || joignable);
    if (texte !== null) ecrire(message, texte);
  }

  function presser(chemin, corps) {
    envoyer(chemin, corps).then((reponse) => afficherMessage(messageGeste(reponse, nom)));
  }

  touches.forEach((definition) => {
    const bouton = boutonTouche(definition);
    const envoyerTouche = () => presser(`/api/action/${action}`, { touche: definition[1] });
    if (definition[5]) surAppuiLong(bouton, { court: () => afficherMessage(CONSIGNE_APPUI_LONG), long: envoyerTouche });
    else surAppui(bouton, envoyerTouche);
    pave.appendChild(bouton);
  });
  message.hidden = true;
  [etat, pave, ligne].forEach((noeud) => gauche.appendChild(noeud));
  racine.appendChild(gauche);

  const droite = element('section', 'carte telecommande-droite');
  let listeApplis = null;
  const applis = element('div', 'applis');
  const sansApplis = element('p', 'applis-vide', 'Liste des applis pas encore reçue');
  if (modele === 'appletv') {
    droite.appendChild(element('h2', 'intitule', 'Applis'));
    droite.appendChild(element('p', 'applis-consigne', 'Garder le doigt 1 seconde sur une appli pour l\'ouvrir.'));
    droite.appendChild(applis);
    droite.appendChild(sansApplis);
  } else {
    droite.appendChild(element('h2', 'intitule', 'À savoir'));
    const conseils = element('ul', 'conseils');
    CONSEILS_TELE.forEach((texte) => conseils.appendChild(element('li', 'conseil', texte)));
    droite.appendChild(conseils);
  }
  racine.appendChild(droite);
  parent.appendChild(racine);

  function rendreApplis(sourceList) {
    const liste = applisAffichees(sourceList);
    const cle = liste.join('\n');
    if (cle === listeApplis) return;
    listeApplis = cle;
    while (applis.firstChild) applis.removeChild(applis.firstChild);
    const garde = creerGarde();
    liste.forEach((source) => {
      const bouton = element('button', 'bouton-doux appli', source);
      bouton.type = 'button';
      surAppuiLong(bouton, {
        court: () => afficherMessage(CONSIGNE_APPUI_LONG),
        long: () => presser('/api/action/appletv_appli', { source }),
      }, garde);
      applis.appendChild(bouton);
    });
    masquer(sansApplis, liste.length > 0);
  }

  return {
    racine,
    mettreAJour(vue) {
      ecrire(etat, vue.etat);
      joignable = vue.joignable;
      masquer(alerte, joignable || !message.hidden);
      if (modele === 'appletv') rendreApplis(vue.applis);
    },
    entretenir() {
      if (messageLe !== null && monotone() - messageLe >= DUREE_MESSAGE_MS) afficherMessage(null);
    },
  };
}
