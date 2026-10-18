// serveur/sources/direct-sonnette.js
//
// Rôle    : le direct vidéo de la sonnette en MJPEG, lu dans go2rtc (le go2rtc de Home Assistant sur le M900), pour
//           GET /api/sonnette.mjpeg : une seule URL, en lecture, avec le nom de flux de la configuration.
// Entrées : creerDirectSonnette({ url, flux, dureeMaxMs, simultanesMax }) : GO2RTC_URL et GO2RTC_FLUX_SONNETTE
//           (config.js), durée maximale d'un direct (3 min 30 s : le script de la sonnette ouvre le flux 3 min) et
//           nombre de directs simultanés (2).
// Sorties : null si aucun flux n'est configuré (pas de direct vidéo : la page ne propose pas de direct) ; sinon
//           { ouvrir(signalClient) } -> promesse de { type, corps (flux Node de la réponse de go2rtc) } ; le direct se
//           referme (requête vers go2rtc détruite, place libérée) quand signalClient est déclenché ou au bout de
//           dureeMaxMs ; rejette une ErreurDirect { statusCode, message } : 429 trop de directs ouverts, 502 go2rtc
//           injoignable ou réponse inattendue.
// Pièges  :
//   - Constat du 13/10 (lecture seule) : l'API de go2rtc répond sur http://192.168.1.187:1984 (version 1.9.14,
//     config /config/go2rtc.yaml) et liste le flux de la sonnette, nommé par son numéro de série (T8210...), plus
//     un flux generic_... qui le reprend par ffmpeg. Le flux ne produit d'images que pendant un direct (flux P2P
//     ouvert par script.sonnette_direct) : en dehors, go2rtc échoue ou ne donne rien. La page ne demande donc la
//     vidéo qu'après l'accord de la maison, et arrête le direct si elle reste muette (web/src/sonnette.js).
//     L'affichage réel est à vérifier avec un vrai direct.
//   - Risque (README, « Sonnette ») : go2rtc écoute le réseau local sans authentification ; tant que ce n'est pas
//     réglé sur le M900, GO2RTC_FLUX_SONNETTE reste vide et ce module rend null.
//   - go2rtc fabrique le MJPEG par ffmpeg tant qu'un client lit : la requête vers go2rtc est DÉTRUITE (socket fermée)
//     dès que le client part et au bout de dureeMaxMs, sinon ffmpeg tournerait pour personne sur le M900. D'où
//     node:http et requete.destroy() : avec la première version (fetch, abandon par AbortController), la connexion
//     vers go2rtc restait ouverte après le départ du navigateur (constaté sur le banc du 13/10, cause exacte non
//     établie) ; revérifié depuis : navigateur qui quitte l'écran, client muet 15 s puis parti.
//   - 8 s sans réponse ni octet de go2rtc : requête détruite (délai d'inactivité de la socket).
//   - Les erreurs du flux de réponse après une destruction voulue sont absorbées ici (écouteur vide) : la route,
//     elle, termine sa réponse proprement.
//   - Le nom du flux passe par encodeURIComponent, et config.js ne l'accepte qu'en lettres, chiffres, _ et - ;
//     rien ne vient de la page. Aucune redirection n'est suivie.
//   - Réponse amont exigée en 200 multipart/x-mixed-replace (ce que go2rtc envoie pour stream.mjpeg) : rien d'autre
//     n'est relayé tel quel au cadre.

import http from 'node:http';
import https from 'node:https';

const DUREE_MAX_MS = 210_000;
const SIMULTANES_MAX = 2;
const DELAI_INACTIVITE_MS = 8000;

export class ErreurDirect extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function creerDirectSonnette({
  url, flux, dureeMaxMs = DUREE_MAX_MS, simultanesMax = SIMULTANES_MAX,
}) {
  if (!flux) return null;
  const adresse = `${url}/api/stream.mjpeg?src=${encodeURIComponent(flux)}`;
  const client = adresse.startsWith('https:') ? https : http;
  let ouverts = 0;

  async function ouvrir(signalClient) {
    if (ouverts >= simultanesMax) throw new ErreurDirect(429, `déjà ${simultanesMax} directs ouverts`);
    ouverts += 1;
    let ferme = false;
    let requete = null;
    const fermer = () => {
      if (ferme) return;
      ferme = true;
      ouverts -= 1;
      clearTimeout(fin);
      if (requete) requete.destroy();
    };
    const fin = setTimeout(fermer, dureeMaxMs);
    signalClient.addEventListener('abort', fermer, { once: true });
    try {
      if (signalClient.aborted) throw new Error('client parti');
      const reponse = await new Promise((resoudre, rejeter) => {
        requete = client.get(adresse, { timeout: DELAI_INACTIVITE_MS }, (reponseAmont) => {
          reponseAmont.on('error', () => {});
          resoudre(reponseAmont);
        });
        requete.on('error', rejeter);
        requete.on('timeout', () => requete.destroy(new Error('délai dépassé')));
        requete.on('close', () => rejeter(new Error('connexion fermée')));
      });
      const type = String(reponse.headers['content-type'] || '');
      if (reponse.statusCode !== 200 || !type.toLowerCase().startsWith('multipart/x-mixed-replace')) {
        throw new ErreurDirect(502, `go2rtc répond ${reponse.statusCode} (${type || 'sans type'})`);
      }
      return { type, corps: reponse };
    } catch (err) {
      fermer();
      if (err instanceof ErreurDirect) throw err;
      throw new ErreurDirect(502, `go2rtc injoignable (${err.message})`);
    }
  }

  return { ouvrir };
}
