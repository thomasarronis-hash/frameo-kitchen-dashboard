// serveur/routes/photos.js
//
// Rôle    : GET /api/photos/lot, un lot aléatoire de photos Immich pour le mode Photos du cadre ; GET /api/photos/<id>.jpg,
//           une photo revérifiée puis relayée telle qu'Immich la donne (conception §2.3, M4).
// Entrées : { immich, cadence } (serveur/sources/immich.js : lot(), photo(id, signal) ; null sans clé Immich ; cadence :
//           serveur/cadence.js, 256 Ko/s partagés par défaut).
// Sorties : /photos/lot -> 200 [{ id, portrait, legende }] ; 404 { erreur: "photos_non_configurees", message } sans clé ;
//           502 { erreur: "photos_indisponibles", message } si Immich ne répond pas comme prévu.
//           /photos/<id>.jpg -> 200 image (jpeg, webp ou png selon Immich) relayée en flux, au rythme de la cadence ;
//           400 { erreur: "photo_invalide" } si <id> n'est pas un uuid en minuscules ; 404 sans clé ; 410 { erreur:
//           "photo_retiree" } (corbeille, archive, plus favorite, supprimée) ; 502 { erreur: "photo_indisponible",
//           message }.
//           Toujours Cache-Control: no-store.
// Pièges  :
//   - Clé du cadre OU du Clevo (contexte privé de app.js) : ce sont des photos de famille.
//   - no-store : le cadre ne garde aucune copie, une photo mise à la corbeille ne revient pas d'un cache.
//   - L'extension .jpg n'est qu'un nom : le type réel est celui d'Immich (preview en JPEG par défaut, WebP selon son
//     réglage), annoncé dans Content-Type. Le paramètre est lu en entier (« <uuid>.jpg ») et contrôlé ici : rien
//     d'autre qu'un uuid n'arrive dans l'URL vers Immich.
//   - Relais en flux : la fermeture de la réponse (cadre parti) déclenche le signal donné à photo(), qui abandonne le
//     transfert depuis Immich ; une coupure en amont (30 s, photo trop grosse) détruit la réponse : le navigateur voit
//     une erreur d'image et la page passe à la suivante, au lieu d'afficher une image tronquée.
//   - Relais à 256 Ko/s en morceaux de 4 Ko, débit partagé par toutes les photos en cours (serveur/cadence.js) : une
//     photo envoyée d'un bloc faisait décrocher le Wi-Fi du cadre pendant plusieurs minutes (constat du 14/10).
//     Content-Length reste celui d'Immich (le corps n'est pas modifié, seulement espacé). Une photo de plus de 7,5 Mo
//     dépasserait la coupure de 30 s : les previews d'Immich font quelques centaines de Ko.
//   - Dans la limite globale de /api (300 par minute) : le diaporama demande une photo toutes les 30 s et un lot
//     toutes les 30 min.

import { creerCadence } from '../cadence.js';
import { ErreurImmich, MOTIF_ID } from '../sources/immich.js';

const ERREURS_PHOTO = { 400: 'photo_invalide', 410: 'photo_retiree', 502: 'photo_indisponible' };
const NON_CONFIGUREES = { erreur: 'photos_non_configurees', message: 'Photos Immich à configurer (IMMICH_CLE_FICHIER)' };

export default async function routesPhotos(app, { immich, cadence = creerCadence() }) {
  app.get('/photos/lot', async (requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    if (!immich) return reponse.code(404).send(NON_CONFIGUREES);
    try {
      return await immich.lot();
    } catch (err) {
      if (!(err instanceof ErreurImmich)) throw err;
      requete.log.warn(`photos : ${err.message}`);
      return reponse.code(502).send({ erreur: 'photos_indisponibles', message: err.message });
    }
  });

  app.get('/photos/:fichier', async (requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    const nom = String(requete.params.fichier);
    const id = nom.endsWith('.jpg') ? nom.slice(0, -4) : '';
    if (!MOTIF_ID.test(id)) return reponse.code(400).send({ erreur: 'photo_invalide', message: 'Identifiant de photo invalide' });
    if (!immich) return reponse.code(404).send(NON_CONFIGUREES);
    const client = new AbortController();
    reponse.raw.on('close', () => client.abort());
    let photo;
    try {
      photo = await immich.photo(id, client.signal);
    } catch (err) {
      if (!(err instanceof ErreurImmich)) throw err;
      requete.log.warn(`photo ${id} : ${err.message}`);
      return reponse.code(err.statusCode).send({ erreur: ERREURS_PHOTO[err.statusCode], message: err.message });
    }
    const sortie = cadence.flux();
    photo.corps.on('error', (err) => {
      if (!client.signal.aborted) requete.log.warn(`photo ${id} : transfert interrompu (${err.message})`);
      sortie.destroy(err);
    });
    if (photo.taille !== null) reponse.header('content-length', photo.taille);
    return reponse.type(photo.type).send(photo.corps.pipe(sortie));
  });
}
