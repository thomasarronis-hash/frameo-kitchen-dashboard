// web/src/ecrans/maison-wifi.js
//
// Rôle    : la section Wi-Fi invités de l'écran Maison : rien de secret à l'écran par défaut ; un toucher sur
//           « Afficher » demande GET /api/wifi-invites et montre le QR code, le nom du réseau et le mot de passe en
//           gros, masqués au bout de 2 min. Sans fichier sur le serveur (ou fichier refusé) : une phrase pour la famille,
//           « pas encore prêt, à préparer sur le serveur ».
// Entrées : creerSectionWifi(parent, { client, monotone }) : client.lire (api.js), horloge monotone (performance.now) ;
//           entretenir() à chaque seconde ; masquer() en quittant l'écran.
// Sorties : { racine, entretenir(), masquer(), affiche() } ; affiche() est vrai tant que quelque chose est montré
//           (main.js ne revient pas à l'Accueil au bout de 60 s pendant qu'un invité scanne).
// Pièges  :
//   - Le mot de passe n'est demandé qu'au toucher, jamais gardé : masqué (2 min, « Masquer », ou écran quitté), il
//     est retiré du DOM (textes vidés, chemin du QR effacé).
//   - QR dessiné par web/src/qr.js (mode octet, correction M) en SVG : un chemin, net à toute taille, couleurs
//     --qr-module sur --qr-fond (jetons.css : noir sur blanc dans tous les thèmes, comme l'exige un lecteur), avec la
//     marge de 4 modules. Chaîne trop longue pour la version 10 (plus de 213 octets) : nom et mot de passe seuls.
//   - Afficher est une ACTION (pointerup, appui.js) : une touche fantôme ne montre pas le mot de passe.
//   - L'écran parle à la famille : ni chemin du M900, ni nom de fichier, ni raison d'un fichier refusé (elle est au
//     journal du serveur). La marche à suivre pour Thomas est dans le README, « Wi-Fi invités ».
//   - Mot de passe en police à chasse fixe et chiffres d'une autre couleur (decouperMotDePasse, maison-donnees.js) :
//     en Nunito Sans, l minuscule et I majuscule sont identiques, 0 et O presque ; un invité le tape parfois à la main.

import { surAppui } from '../composants/appui.js';
import { ecrire, element, icone, masquer } from '../dom.js';
import { qrCode } from '../qr.js';
import { decouperMotDePasse } from './maison-donnees.js';

const DUREE_AFFICHAGE_MS = 120000;
const MARGE_QR = 4;
const NS_SVG = 'http://www.w3.org/2000/svg';

const deuxChiffres = (n) => (n < 10 ? '0' : '') + n;

function construireQr() {
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('class', 'wifi-qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code du Wi-Fi invités');
  const fond = document.createElementNS(NS_SVG, 'rect');
  fond.setAttribute('class', 'qr-fond');
  fond.setAttribute('width', '100%');
  fond.setAttribute('height', '100%');
  const modules = document.createElementNS(NS_SVG, 'path');
  modules.setAttribute('class', 'qr-modules');
  svg.appendChild(fond);
  svg.appendChild(modules);
  return { svg, modules };
}

function dessinerQr(qr, matrice) {
  const cote = matrice.taille + 2 * MARGE_QR;
  qr.svg.setAttribute('viewBox', `0 0 ${cote} ${cote}`);
  let chemin = '';
  matrice.modules.forEach((ligne, l) => ligne.forEach((noir, c) => {
    if (noir) chemin += `M${c + MARGE_QR} ${l + MARGE_QR}h1v1h-1z`;
  }));
  qr.modules.setAttribute('d', chemin);
}

export function creerSectionWifi(parent, { client, monotone }) {
  let etat = 'masque';
  let ouvertLe = null;
  let demande = 0;

  const racine = element('div', 'maison-section maison-wifi');
  const accueil = element('section', 'carte wifi-accueil');
  accueil.appendChild(icone('i-wifi', 'wifi-grande-icone'));
  accueil.appendChild(element('p', 'wifi-titre', 'Wi-Fi invités'));
  accueil.appendChild(element('p', 'wifi-texte', 'Le nom du réseau, le mot de passe et le QR code s\'affichent pendant 2 minutes.'));
  const afficher = element('button', 'bouton-fort wifi-afficher');
  afficher.type = 'button';
  afficher.appendChild(icone('i-wifi', 'bouton-fort-icone'));
  afficher.appendChild(element('span', '', 'Afficher'));
  accueil.appendChild(afficher);
  const etatLecture = element('p', 'wifi-texte', 'Lecture…');
  accueil.appendChild(etatLecture);
  const erreur = element('p', 'wifi-erreur');
  erreur.setAttribute('role', 'alert');
  accueil.appendChild(erreur);

  const fiche = element('section', 'carte wifi-fiche');
  const qr = construireQr();
  const tropLong = element('p', 'wifi-trop-long', 'Trop long pour un QR code : nom et mot de passe seulement.');
  const infos = element('div', 'wifi-infos');
  infos.appendChild(element('h2', 'intitule', 'Réseau'));
  const ssid = element('p', 'wifi-ssid');
  infos.appendChild(ssid);
  const titreMdp = element('h2', 'intitule', 'Mot de passe');
  const mdp = element('p', 'wifi-mdp');
  infos.appendChild(titreMdp);
  infos.appendChild(mdp);
  const compte = element('p', 'wifi-compte');
  const masquerBouton = element('button', 'bouton-doux wifi-masquer');
  masquerBouton.type = 'button';
  masquerBouton.appendChild(icone('i-close', 'bouton-fort-icone'));
  masquerBouton.appendChild(element('span', '', 'Masquer'));
  infos.appendChild(compte);
  infos.appendChild(masquerBouton);
  [qr.svg, tropLong, infos].forEach((noeud) => fiche.appendChild(noeud));

  const configurer = element('section', 'carte wifi-configurer');
  configurer.appendChild(icone('i-wifi', 'wifi-grande-icone'));
  configurer.appendChild(element('p', 'wifi-titre', 'Le Wi-Fi invités n\'est pas encore prêt'));
  configurer.appendChild(element('p', 'wifi-texte', 'À préparer sur le serveur (WIFI_INVITES_FICHIER).'));
  const fermerConfig = element('button', 'bouton-doux wifi-masquer');
  fermerConfig.type = 'button';
  fermerConfig.appendChild(element('span', '', 'Fermer'));
  configurer.appendChild(fermerConfig);

  [accueil, fiche, configurer].forEach((noeud) => racine.appendChild(noeud));
  parent.appendChild(racine);

  function rendre() {
    masquer(accueil, etat !== 'masque' && etat !== 'lecture' && etat !== 'erreur');
    masquer(afficher, etat === 'lecture');
    masquer(etatLecture, etat !== 'lecture');
    masquer(erreur, etat !== 'erreur');
    masquer(fiche, etat !== 'affiche');
    masquer(configurer, etat !== 'configurer');
  }

  function ecrireMotDePasse(texte) {
    while (mdp.firstChild) mdp.removeChild(mdp.firstChild);
    decouperMotDePasse(texte).forEach((morceau) => mdp.appendChild(element('span', morceau.chiffres ? 'wifi-mdp-chiffres' : '', morceau.texte)));
  }

  function masquerTout() {
    etat = 'masque';
    ouvertLe = null;
    demande += 1;
    ecrire(ssid, '');
    ecrireMotDePasse('');
    qr.modules.setAttribute('d', '');
    rendre();
  }

  function montrer(donnees) {
    ouvertLe = monotone();
    if (!donnees.configure) {
      etat = 'configurer';
      rendre();
      return;
    }
    etat = 'affiche';
    ecrire(ssid, donnees.ssid);
    masquer(titreMdp, donnees.mot_de_passe === null);
    mdp.classList.toggle('wifi-mdp-ouvert', donnees.mot_de_passe === null);
    if (donnees.mot_de_passe === null) ecrire(mdp, 'Réseau ouvert, sans mot de passe');
    else ecrireMotDePasse(donnees.mot_de_passe);
    const matrice = qrCode(donnees.chaine_qr);
    masquer(qr.svg, matrice === null);
    masquer(tropLong, matrice !== null);
    if (matrice) dessinerQr(qr, matrice);
    rendre();
  }

  surAppui(afficher, () => {
    etat = 'lecture';
    demande += 1;
    const numero = demande;
    rendre();
    client.lire('/api/wifi-invites').then((reponse) => {
      if (numero !== demande) return;
      if (reponse.ok) {
        montrer(reponse.donnees);
        return;
      }
      etat = 'erreur';
      ecrire(erreur, reponse.message);
      rendre();
    });
  });
  surAppui(masquerBouton, masquerTout);
  surAppui(fermerConfig, masquerTout);
  rendre();

  return {
    racine,
    entretenir() {
      if (ouvertLe === null) return;
      const restantMs = DUREE_AFFICHAGE_MS - (monotone() - ouvertLe);
      if (restantMs <= 0) {
        masquerTout();
        return;
      }
      const restantS = Math.ceil(restantMs / 1000);
      ecrire(compte, `Masqué dans ${Math.floor(restantS / 60)}:${deuxChiffres(restantS % 60)}`);
    },
    masquer: masquerTout,
    affiche: () => etat === 'affiche' || etat === 'configurer',
  };
}
