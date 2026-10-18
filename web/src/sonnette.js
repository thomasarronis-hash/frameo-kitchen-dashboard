// web/src/sonnette.js
//
// Rôle    : les règles de la sonnette, sans DOM (testées) : repérer un coup de sonnette dans le flux et tenir le
//           bandeau « On a sonné » (2 min, ou jusqu'au toucher) avec la photo DE CE COUP seulement ; dire de quand date
//           la photo de l'onglet Sonnette ; tenir le direct vidéo de l'écran Maison (3 min, seulement si le serveur a un
//           flux go2rtc).
// Entrées : creerVeilleSonnette() puis observer(entite, ms) à chaque état reçu (entite : binary_sensor.doorbell_ringing
//           projeté, { state, last_changed }), vue(ms, suivi, directVideo) à chaque seconde, fermer() au toucher ;
//           suivi : la clé sonnette du flux (serveur/ha/sonnette.js : { dernier_coup, photo, photo_le }) ; directVideo :
//           direct_video du flux ;
//           creerDirect() puis lancer(ms), accepte(ms), imageRecue(), echecVideo(ms), verifier(ms), arreter(), vue(ms) ;
//           photoDuSuivi(suivi) ; ms : l'heure corrigée par le serveur (heure.js).
// Sorties : observer -> vrai quand un NOUVEAU coup de sonnette vient d'arriver (le bandeau s'ouvre) ;
//           veille.vue(...) -> null (bandeau masqué) ou { texte: « On a sonné · 19:41 », photo: URL de /api/sonnette.jpg
//           ou null, legende: « Photo de 19:41 » / « Photo en cours… » / « Pas de photo de ce coup de sonnette »,
//           direct: vrai si « Voir le direct » est proposé } ;
//           photoDuSuivi(suivi) -> { charger, cle, legende } pour l'onglet Sonnette (charger faux pendant l'attente de
//           la photo d'un coup ; cle change quand la photo change) ;
//           direct.vue(ms) -> null (pas de direct) ou { etape: 'lancement' | 'video', restant: « 2:41 », source: URL de
//           /api/sonnette.mjpeg ou null (pas encore demandée), image: vrai dès la première image } ;
//           echecVideo et verifier -> null, 'nouvel_essai' (la vidéo est redemandée), 'muette' (pas d'image après
//           ESSAIS_VIDEO essais : le direct s'arrête) ou 'coupee' (le flux s'est arrêté après des images) ;
//           DUREE_BANDEAU_MS, DUREE_DIRECT_MS, DELAI_VIDEO_MS, ATTENTE_VIDEO_MS, ESSAIS_VIDEO.
// Pièges  :
//   - Un coup de sonnette = binary_sensor.doorbell_ringing à on (10 s, relevé du 11/10) avec un last_changed
//     jamais vu : les messages suivants du même coup ne rouvrent pas le bandeau, un second coup le relance (2 min de
//     plus, nouvelle heure). Un on déjà vieux de plus de 2 min (page rechargée bien après) n'ouvre rien.
//   - Les 2 min comptent depuis l'apparition du bandeau (heure corrigée de la page) ; l'heure affichée est celle du
//     coup de sonnette (last_changed de HA).
//   - Photo du bandeau : HA ne la réécrit que 7 à 20 s après la sonnerie, et parfois jamais. Elle n'est montrée que si
//     le suivi du serveur dit qu'elle date de CE coup (dernier_coup égal au last_changed du coup, photo « du_coup ») :
//     sinon « Photo en cours… », puis « Pas de photo de ce coup de sonnette » ; jamais le visage d'un visiteur
//     précédent sous « On a sonné ». Une seule demande, quand elle arrive (le paramètre n= est son heure).
//   - « Voir le direct » n'existe qu'avec un flux vidéo (direct_video) : camera.sonnette_derniere_photo est une image
//     fixe réécrite seulement à la sonnerie, la rafraîchir ne montrerait rien de vivant.
//   - Direct : la vidéo n'est demandée qu'APRÈS l'accord de la maison (script.sonnette_direct lancé), plus 3 s pour
//     que le flux P2P s'ouvre [S : relevé ~4 s dans l'appli Maison, fiche du M900] ; 10 s sans image ou une erreur
//     de l'image : un nouvel essai 1 s plus tard, puis le direct s'arrête (message dans l'écran). Le paramètre n=
//     change à chaque essai : le serveur répond no-store, rien ne vient d'un cache.

import { texteHeure } from './heure.js';

export const DUREE_BANDEAU_MS = 120000;
export const DUREE_DIRECT_MS = 180000;
export const DELAI_VIDEO_MS = 3000;
export const ATTENTE_VIDEO_MS = 10000;
export const ESSAIS_VIDEO = 2;
const DELAI_NOUVEL_ESSAI_MS = 1000;
const PHOTO = '/api/sonnette.jpg';
const VIDEO = '/api/sonnette.mjpeg';

const deuxChiffres = (n) => (n < 10 ? '0' : '') + n;
const urlPhoto = (suivi) => `${PHOTO}?n=${Date.parse(suivi.photo_le)}`;

export function creerVeilleSonnette() {
  let dernierVu = null;
  let coup = null;
  let ouvertLe = null;
  let heure = '';

  // Photo et légende du bandeau pour le coup affiché, d'après le suivi du serveur.
  function photoDuCoup(suivi) {
    const duCoup = suivi && suivi.dernier_coup === coup;
    if (duCoup && suivi.photo === 'du_coup') return { photo: urlPhoto(suivi), legende: `Photo de ${texteHeure(Date.parse(suivi.photo_le))}` };
    if (duCoup && suivi.photo === 'avant_coup') return { photo: null, legende: 'Pas de photo de ce coup de sonnette' };
    return { photo: null, legende: 'Photo en cours…' };
  }

  return {
    observer(entite, ms) {
      if (!entite || entite.state !== 'on') return false;
      const quand = Date.parse(entite.last_changed);
      if (!isFinite(quand) || quand === dernierVu) return false;
      dernierVu = quand;
      if (ms - quand > DUREE_BANDEAU_MS) return false;
      coup = entite.last_changed;
      ouvertLe = ms;
      heure = texteHeure(quand);
      return true;
    },
    vue(ms, suivi, directVideo) {
      if (ouvertLe === null) return null;
      const ecoule = ms - ouvertLe;
      if (ecoule >= DUREE_BANDEAU_MS || ecoule < 0) {
        ouvertLe = null;
        return null;
      }
      const photo = photoDuCoup(suivi);
      return {
        texte: `On a sonné · ${heure}`, photo: photo.photo, legende: photo.legende, direct: directVideo === true,
      };
    },
    fermer() {
      ouvertLe = null;
    },
  };
}

// Onglet Sonnette : la photo est demandée (et redemandée quand elle change) sauf pendant l'attente de celle d'un coup.
export function photoDuSuivi(suivi) {
  const etat = suivi ? suivi.photo : 'inconnue';
  if (etat === 'en_cours') return { charger: false, cle: 'en_cours', legende: 'Photo du coup de sonnette en cours…' };
  if (etat === 'du_coup') {
    return { charger: true, cle: suivi.photo_le, legende: `Photo du dernier coup de sonnette, prise à ${texteHeure(Date.parse(suivi.photo_le))}` };
  }
  if (etat === 'avant_coup') return { charger: true, cle: 'avant', legende: 'Photo prise avant le dernier coup de sonnette' };
  return { charger: true, cle: 'inconnue', legende: 'Dernière photo enregistrée (heure inconnue)' };
}

export function creerDirect() {
  let debut = null;
  let etape = null;
  let videoDes = null;
  let essai = 0;
  let imageVue = false;

  function finir() {
    debut = null;
    etape = null;
  }

  function echouer(ms) {
    if (essai < ESSAIS_VIDEO) {
      essai += 1;
      videoDes = ms + DELAI_NOUVEL_ESSAI_MS;
      return 'nouvel_essai';
    }
    finir();
    return 'muette';
  }

  return {
    lancer(ms) {
      debut = ms;
      etape = 'lancement';
      videoDes = null;
      essai = 0;
      imageVue = false;
    },
    accepte(ms) {
      if (etape !== 'lancement') return;
      etape = 'video';
      essai = 1;
      videoDes = ms + DELAI_VIDEO_MS;
    },
    imageRecue() {
      if (etape === 'video') imageVue = true;
    },
    echecVideo(ms) {
      if (etape !== 'video') return null;
      if (imageVue) {
        finir();
        return 'coupee';
      }
      return echouer(ms);
    },
    verifier(ms) {
      if (etape !== 'video' || imageVue || ms < videoDes + ATTENTE_VIDEO_MS) return null;
      return echouer(ms);
    },
    arreter: finir,
    vue(ms) {
      if (debut === null) return null;
      const ecoule = ms - debut;
      if (ecoule >= DUREE_DIRECT_MS || ecoule < 0) {
        finir();
        return null;
      }
      const restantS = Math.ceil((DUREE_DIRECT_MS - ecoule) / 1000);
      return {
        etape,
        restant: `${Math.floor(restantS / 60)}:${deuxChiffres(restantS % 60)}`,
        source: etape === 'video' && ms >= videoDes ? `${VIDEO}?n=${debut}-${essai}` : null,
        image: imageVue,
      };
    },
  };
}
