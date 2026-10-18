// serveur/ha/photo-sonnette.js
//
// Rôle    : lire la dernière photo de la sonnette, camera.sonnette_derniere_photo, par l'API REST de Home Assistant
//           (GET /api/camera_proxy/<entité>), en LECTURE SEULE, pour GET /api/sonnette.jpg (bandeau sonnette, écran
//           Maison, direct sans vidéo).
// Entrées : creerPhotoSonnette({ haUrl, jeton, requete, delaiMs, tailleMax }) : URL et jeton de config.js (utilisateur
//           « Mur »), requete = fetch (un faux dans les tests), délai d'abandon (5 s par défaut), taille maximale (3 Mo).
// Sorties : { lire() } -> promesse de { type, octets } (type image/jpeg ou image/png, octets Buffer) ; rejette une
//           Error au message en français (HA injoignable, refus, réponse qui n'est pas une image, trop grosse).
// Pièges  :
//   - Seul autre chemin vers HA que la WebSocket de connexion.js : une seule URL, entité figée ici, méthode GET,
//     jamais de paramètre venu de la page. Le jeton part en en-tête Authorization, jamais dans l'URL (ni
//     ?token= ni access_token d'entity_picture, que entites.js ne projette pas).
//   - width et height sont demandés (960x540, conception §2.3) ; une caméra local_file les ignore et renvoie sa
//     taille d'origine (1024x768 relevé le 13/10, 100 Ko environ) : la page met l'image à l'échelle.
//   - redirect: 'error' : une redirection inattendue n'emporte pas le jeton ailleurs.
//   - Plafond de 3 Mo, lu en flux et abandonné dès le dépassement, Content-Length ou pas (serveur/corps.js) : une
//     réponse aberrante ne remplit pas la mémoire du conteneur (256 Mo).

import { ErreurTropGros, lireCorpsPlafonne } from '../corps.js';

const ENTITE = 'camera.sonnette_derniere_photo';
const DELAI_MS = 5000;
const TAILLE_MAX = 3 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png']);

export function creerPhotoSonnette({
  haUrl, jeton, requete = fetch, delaiMs = DELAI_MS, tailleMax = TAILLE_MAX,
}) {
  const url = `${haUrl}/api/camera_proxy/${ENTITE}?width=960&height=540`;
  return {
    async lire() {
      const abandon = new AbortController();
      const minuteur = setTimeout(() => abandon.abort(), delaiMs);
      try {
        let reponse;
        try {
          reponse = await requete(url, { headers: { authorization: `Bearer ${jeton}` }, signal: abandon.signal, redirect: 'error' });
        } catch (err) {
          throw new Error(`photo de la sonnette : Home Assistant injoignable (${abandon.signal.aborted ? 'délai dépassé' : err.message})`);
        }
        if (!reponse.ok) throw new Error(`photo de la sonnette : Home Assistant répond ${reponse.status}`);
        const type = String(reponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!TYPES.has(type)) throw new Error(`photo de la sonnette : type inattendu (${type || 'aucun'})`);
        try {
          return { type, octets: await lireCorpsPlafonne(reponse, tailleMax) };
        } catch (err) {
          if (err instanceof ErreurTropGros) throw new Error('photo de la sonnette : trop grosse');
          throw new Error(`photo de la sonnette : lecture interrompue (${abandon.signal.aborted ? 'délai dépassé' : err.message})`);
        }
      } finally {
        clearTimeout(minuteur);
      }
    },
  };
}
