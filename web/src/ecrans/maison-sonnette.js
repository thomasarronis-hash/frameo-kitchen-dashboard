// web/src/ecrans/maison-sonnette.js
//
// Rôle    : la section Sonnette de l'écran Maison : la dernière photo AVEC de quand elle date (du dernier coup, d'avant
//           le dernier coup, heure inconnue), l'heure du dernier coup de sonnette ; et, seulement si le serveur a un flux
//           vidéo (direct_video), « Voir le direct » : 3 min de vidéo relayée depuis go2rtc, temps restant, « Arrêter ».
// Entrées : creerSectionSonnette(parent, { client, monotone, maintenant }) : client.poster (api.js) pour l'action
//           sonnette_direct, horloge monotone (messages) et heure corrigée par le serveur (maintenant, heure.js) ;
//           mettreAJour(vue, suivi, directVideo, affichee, ms) avec vueSonnette de maison-donnees.js, la clé sonnette du
//           flux (serveur/ha/sonnette.js), direct_video du flux et affichee (l'onglet est à l'écran) ; lancerDirect(ms)
//           (bouton de la section, ou « Voir le direct » du bandeau) ; entretenir(affichee, ms) à chaque seconde ;
//           arreter() en quittant l'écran.
// Sorties : { racine, mettreAJour(vue, suivi, directVideo, affichee, ms), lancerDirect(ms), entretenir(affichee, ms),
//           arreter(), actif(ms) } ; actif() est vrai pendant un direct (main.js ne revient pas à l'Accueil au bout de
//           60 s).
// Pièges  :
//   - Photo : camera.sonnette_derniere_photo est une image fixe que HA ne réécrit qu'à la sonnerie. Sa légende vient du
//     suivi du serveur (photoDuSuivi de web/src/sonnette.js) ; pendant l'attente de la photo d'un coup, « Photo en
//     cours… » à la place de l'image. Elle est rechargée à chaque ouverture de l'onglet, à chaque nouvelle minute et
//     quand elle change, tant que l'onglet est à l'écran ; onglet caché, rien n'est demandé à HA.
//   - Direct : l'action sonnette_direct part D'ABORD (script.sonnette_direct ouvre le flux P2P) ; la vidéo (<img> sur
//     /api/sonnette.mjpeg, MJPEG compris de Chrome 125) n'est demandée qu'après l'accord de la maison, 3 s plus tard,
//     puis une seconde fois si elle reste muette (web/src/sonnette.js). En mode essai (ACTIONS_MAISON absent), rien
//     n'est lancé et l'écran le dit. Refus, vidéo muette ou coupée : le direct s'arrête avec un message court ;
//     jamais une photo fixe présentée comme un direct.
//   - Arrêter, la fin des 3 min et quitter l'écran retirent le src : le navigateur ferme la connexion, et le serveur
//     coupe la lecture de go2rtc.
//   - Toucher « Voir le direct » est une action (pointerup, appui.js) ; dans le bandeau, c'est une navigation
//     (pointerdown), qui appelle lancerDirect de la même façon.

import { surAppui } from '../composants/appui.js';
import { creerPhotoSonnette } from '../composants/photo-sonnette.js';
import { ecrire, element, icone, masquer } from '../dom.js';
import { creerDirect, photoDuSuivi } from '../sonnette.js';

const DUREE_MESSAGE_MS = 10000;
const PHOTO = '/api/sonnette.jpg';
const MESSAGES_FIN = {
  muette: 'La vidéo de la sonnette n\'a pas répondu.',
  coupee: 'Le direct s\'est arrêté.',
};

// Message court pour la famille quand la maison refuse le direct (le détail technique est au journal du serveur).
function texteRefus(reponse) {
  if (reponse.statut === 502) return 'Le direct n\'a pas pu être lancé : la maison ne répond pas.';
  if (reponse.statut === 0) return 'Le direct n\'a pas pu être lancé : pas de réponse du serveur.';
  return 'Le direct n\'a pas pu être lancé.';
}

export function creerSectionSonnette(parent, { client, monotone, maintenant }) {
  const direct = creerDirect();
  let directVideo = false;
  let sourceVideo = null;
  let messageLe = null;
  let minutePhoto = null;
  let affichee = false;
  let suiviPhoto = photoDuSuivi(null);

  const racine = element('div', 'maison-section maison-sonnette');
  const cadre = element('div', 'carte sonnette-cadre');
  const photo = creerPhotoSonnette(cadre, 'sonnette-grande');
  const video = element('img', 'sonnette-video');
  video.alt = 'Direct de la sonnette';
  video.hidden = true;
  cadre.appendChild(video);
  const indisponible = element('p', 'sonnette-indisponible', 'Caméra de la sonnette indisponible');
  indisponible.hidden = true;
  cadre.appendChild(indisponible);

  const cote = element('section', 'carte sonnette-cote');
  cote.appendChild(element('h2', 'intitule', 'Sonnette'));
  const dernier = element('p', 'sonnette-dernier');
  const legende = element('p', 'sonnette-legende-photo');
  const lancer = element('button', 'bouton-fort sonnette-lancer');
  lancer.type = 'button';
  lancer.appendChild(icone('i-camera', 'bouton-fort-icone'));
  lancer.appendChild(element('span', '', 'Voir le direct'));
  const enCours = element('div', 'sonnette-en-cours');
  const restant = element('p', 'sonnette-restant');
  const mode = element('p', 'sonnette-mode');
  const arret = element('button', 'bouton-doux sonnette-arreter');
  arret.type = 'button';
  arret.appendChild(icone('i-close', 'bouton-fort-icone'));
  arret.appendChild(element('span', '', 'Arrêter'));
  [restant, mode, arret].forEach((noeud) => enCours.appendChild(noeud));
  enCours.hidden = true;
  const message = element('p', 'sonnette-message');
  message.setAttribute('role', 'alert');
  message.hidden = true;
  [dernier, legende, lancer, enCours, message].forEach((noeud) => cote.appendChild(noeud));
  racine.appendChild(cadre);
  racine.appendChild(cote);
  parent.appendChild(racine);

  function afficherMessage(texte) {
    messageLe = texte === null ? null : monotone();
    masquer(message, texte === null);
    if (texte !== null) ecrire(message, texte);
  }

  function couperVideo() {
    if (sourceVideo === null) return;
    sourceVideo = null;
    video.removeAttribute('src');
    masquer(video, true);
  }

  // Hors direct : la dernière photo (onglet à l'écran seulement), ou « Photo en cours… » pendant l'attente d'un coup.
  function rendrePhoto(ms) {
    ecrire(legende, suiviPhoto.legende);
    if (!affichee) {
      minutePhoto = null;
      photo.vider();
      return;
    }
    if (!suiviPhoto.charger) {
      minutePhoto = null;
      photo.annoncer('Photo en cours…');
      return;
    }
    const cle = `${Math.floor(ms / 60000)}-${encodeURIComponent(suiviPhoto.cle)}`;
    if (cle !== minutePhoto) {
      minutePhoto = cle;
      photo.afficher(`${PHOTO}?n=${cle}`);
    }
  }

  function rendreDirect(ms) {
    const vue = direct.vue(ms);
    masquer(lancer, vue !== null || !directVideo);
    masquer(enCours, vue === null);
    masquer(legende, vue !== null);
    if (vue === null) {
      couperVideo();
      rendrePhoto(ms);
      return;
    }
    minutePhoto = null;
    ecrire(restant, `Direct · encore ${vue.restant}`);
    ecrire(mode, vue.image ? 'Vidéo de la sonnette' : 'Connexion à la sonnette…');
    if (!vue.image) photo.annoncer('Connexion à la sonnette…');
    if (vue.source === null) {
      couperVideo();
    } else if (sourceVideo !== vue.source) {
      sourceVideo = vue.source;
      video.src = vue.source;
    }
  }

  function terminer(issue) {
    if (MESSAGES_FIN[issue]) afficherMessage(MESSAGES_FIN[issue]);
  }

  video.addEventListener('load', () => {
    if (sourceVideo === null) return;
    direct.imageRecue();
    masquer(video, false);
    rendreDirect(maintenant());
  });
  video.addEventListener('error', () => {
    if (sourceVideo === null) return;
    couperVideo();
    terminer(direct.echecVideo(maintenant()));
    rendreDirect(maintenant());
  });

  function lancerDirect(ms) {
    if (!directVideo) return;
    afficherMessage(null);
    direct.lancer(ms);
    rendreDirect(ms);
    client.poster('/api/action/sonnette_direct', {}).then((reponse) => {
      if (reponse.ok && reponse.donnees && reponse.donnees.simulation === false) {
        direct.accepte(maintenant());
      } else {
        direct.arreter();
        afficherMessage(reponse.ok ? 'Mode essai : le direct n\'est pas lancé.' : texteRefus(reponse));
      }
      rendreDirect(maintenant());
    });
  }

  surAppui(lancer, () => lancerDirect(maintenant()));
  surAppui(arret, () => {
    direct.arreter();
    rendreDirect(maintenant());
  });

  return {
    racine,
    mettreAJour(vue, suivi, avecVideo, estAffichee, ms) {
      directVideo = avecVideo === true;
      affichee = estAffichee;
      suiviPhoto = photoDuSuivi(suivi);
      ecrire(dernier, vue.dernier);
      masquer(indisponible, vue.cameraDisponible);
      rendreDirect(ms);
    },
    lancerDirect,
    entretenir(estAffichee, ms) {
      affichee = estAffichee;
      const issue = direct.verifier(ms);
      if (issue === 'muette') terminer(issue);
      rendreDirect(ms);
      if (messageLe !== null && monotone() - messageLe >= DUREE_MESSAGE_MS) afficherMessage(null);
    },
    arreter() {
      direct.arreter();
      couperVideo();
    },
    actif: (ms) => direct.vue(ms) !== null,
  };
}
