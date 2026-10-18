// serveur/routes/sonnette.js
//
// Rôle    : GET /api/sonnette.jpg, la dernière photo de la sonnette (bandeau sonnette, écran Maison) ;
//           GET /api/sonnette.mjpeg, le direct vidéo relayé depuis go2rtc, s'il est configuré.
// Entrées : { photo } (lire() : le suivi des coups de sonnette, serveur/ha/sonnette.js, qui lit par
//           serveur/ha/photo-sonnette.js) ; { direct } (serveur/sources/direct-sonnette.js : ouvrir(signal), ou null
//           sans GO2RTC_FLUX_SONNETTE).
// Sorties : /sonnette.jpg -> 200 image/jpeg (ou png), Cache-Control no-store ; 502 { erreur: "photo_indisponible",
//           message } si HA ne la donne pas.
//           /sonnette.mjpeg -> 200 multipart/x-mixed-replace relayé tel quel, no-store ; 404 { erreur:
//           "direct_non_configure" } sans flux configuré ; 429 au-delà de 2 directs ouverts ; 502 { erreur:
//           "direct_indisponible", message } si go2rtc ne répond pas comme prévu.
// Pièges  :
//   - Clé du cadre OU du Clevo (contexte privé de app.js) : la photo montre le devant de la maison.
//   - no-store : la page recharge la photo avec un paramètre qui change (?n=...), et le cadre ne doit garder aucune
//     copie.
//   - Direct : la fermeture de la réponse (client parti, fin du flux amont, coupure au bout de 3 min 30 s par
//     direct-sonnette.js) déclenche le signal donné à ouvrir(), qui détruit la requête vers go2rtc ; reply.send d'un
//     flux Node : Fastify détruit le flux si le client part. Une lecture amont qui s'interrompt (coupure voulue, go2rtc
//     qui lâche) termine la réponse proprement (PassThrough) : sans cela, chaque fin de direct laissait un
//     avertissement « response terminated with an error » au journal.
//   - Dans la limite globale de /api (300 par minute) : la page demande une photo par minute au plus (onglet
//     Sonnette à l'écran) et une à l'arrivée de la photo d'un coup de sonnette (bandeau).

import { PassThrough } from 'node:stream';
import { ErreurDirect } from '../sources/direct-sonnette.js';

export default async function routesSonnette(app, { photo, direct }) {
  app.get('/sonnette.jpg', async (requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    try {
      const { type, octets } = await photo.lire();
      return reponse.type(type).send(octets);
    } catch (err) {
      requete.log.warn(err.message);
      return reponse.code(502).send({ erreur: 'photo_indisponible', message: err.message });
    }
  });

  app.get('/sonnette.mjpeg', async (requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    if (!direct) return reponse.code(404).send({ erreur: 'direct_non_configure', message: 'Aucun flux go2rtc configuré (GO2RTC_FLUX_SONNETTE)' });
    const client = new AbortController();
    reponse.raw.on('close', () => client.abort());
    let ouvert;
    try {
      ouvert = await direct.ouvrir(client.signal);
    } catch (err) {
      if (!(err instanceof ErreurDirect)) throw err;
      requete.log.warn(`direct de la sonnette : ${err.message}`);
      return reponse.code(err.statusCode).send({ erreur: 'direct_indisponible', message: err.message });
    }
    requete.log.info('direct de la sonnette ouvert');
    client.signal.addEventListener('abort', () => requete.log.info('direct de la sonnette fermé'), { once: true });
    const sortie = new PassThrough();
    ouvert.corps.on('error', () => sortie.end());
    ouvert.corps.on('close', () => sortie.end());
    return reponse.type(ouvert.type).send(ouvert.corps.pipe(sortie));
  });
}
