// serveur/sources/immich.js
//
// Rôle    : le client Immich du BFF, en LECTURE SEULE (conception M4, §2.3) : un lot aléatoire de photos à montrer
//           (POST /api/search/random) et une photo à relayer au cadre, revérifiée juste avant (GET /api/assets/{id}
//           puis GET /api/assets/{id}/thumbnail?size=preview).
// Entrées : creerImmich({ url, cle, source, requete, delaiMs, dureeMaxMs, tailleMax, maintenant }) : IMMICH_URL et la
//           clé lue dans IMMICH_CLE_FICHIER (config.js), source { type: 'tout' | 'favoris' | 'album', albumId }
//           (IMMICH_SOURCE, toute la photothèque par défaut, choix de Thomas du 14/10), requete = fetch (un faux
//           dans les tests), délai d'attente d'une réponse (10 s), durée maximale d'un transfert de photo (30 s), taille
//           maximale d'une photo (15 Mo), horloge (Date.now) ; lireVersion(url, requete) n'a besoin que de l'URL (route
//           publique).
// Sorties : null sans clé (photos à configurer : AUCUN appel à Immich) ; sinon { source: 'tout' | 'favoris' | 'album', lot(),
//           photo(id, signalClient) } :
//           lot() -> promesse de [{ id, portrait, legende }] (legende « Annecy · juillet 2024 », « Mars 2023 » sans lieu,
//           « Annecy » sans date de prise de vue, ou null) ;
//           photo(id, signalClient) -> promesse de { type, taille (octets, ou null), corps (flux Node) } ;
//           les deux rejettent une ErreurImmich { statusCode, message } : 410 photo retirée (corbeille, archivée, plus
//           favorite, plus visible pour la clé) ou absente des lots rendus depuis 2 h, 502 Immich injoignable, clé
//           refusée ou réponse inattendue.
//           lireVersion(url, requete) -> promesse de « 3.2.0 » ; corpsRecherche(source) -> le corps du lot (tests) ;
//           MOTIF_ID, la forme d'un identifiant de photo (uuid en minuscules) ; PHOTOS_PAR_LOT (100).
// Pièges  :
//   - Format vérifié dans les sources d'Immich 3.2.0, la version installée (GET /api/server/version le 13/10) :
//     RandomSearchDto prend un objet « filter » (nouveau en 3.2 ; les anciens champs à plat sont dépréciés et ne
//     se combinent pas avec lui), size de 1 à 1000, withExif ; filtres type { eq: "IMAGE" }, visibility { eq:
//     "timeline" } (ni archivées, ni dossier verrouillé), trashedAt { eq: null } (pas à la corbeille), plus albumIds
//     { any: [uuid] } (album) ou isFavorite { eq: true } (favoris) ; rien de plus pour toute la photothèque
//     (search.dto.ts, enum.ts).
//     Réponse : un tableau d'AssetResponseDto (search.controller.ts), permission asset.read. La clé part dans l'en-tête
//     x-api-key, JAMAIS dans l'URL (?apiKey= finirait dans les journaux, conception §2.5).
//   - Seules les photos d'un lot rendu depuis moins de 2 h (RETENUE_IDS_MS) sont relayées : un autre identifiant
//     répond 410 SANS aucun appel à Immich. Sinon n'importe quelle photo visible pour la clé serait servie à qui connaît
//     son uuid : en mode album, toute la photothèque du compte (AssetResponseDto ne dit pas les albums d'une photo, la
//     revérification ne peut pas le voir) ; en mode « tout », une vidéo ou une photo archivée entre deux lots ne
//     passerait que par la revérification. 2 h couvrent le lot courant et le précédent de chaque
//     appareil (relu toutes les 30 min) ; après un redémarrage du serveur, la page redemande un lot au bout de 3
//     échecs (web/src/photos.js).
//   - Revérification avant chaque envoi : GET /api/assets/{id} (asset.read) ; isTrashed vrai (deletedAt posé), une
//     visibilité autre que timeline (archive, hidden, locked : dossier verrouillé), un type autre que IMAGE ou, en mode
//     favoris seulement, une photo qui n'est plus favorite donnent 410. Immich répond 400 (« not found or no access ») ou 404
//     pour une photo supprimée pour de bon ou devenue invisible pour la clé : 410 aussi. Le retrait d'un ALBUM se voit
//     au lot suivant (la page le relit toutes les 30 min) : la photo n'y est plus, elle finit par sortir des 2 h.
//   - Miniature : size=preview (1440 px de grand côté par défaut, JPEG, ou WebP selon le réglage d'Immich) servie
//     telle quelle, sans redimensionnement (pas de sharp) ; edited=true donne la version retouchée dans Immich si elle
//     existe (asset-media.dto.ts). viewThumbnail ne contrôle pas la corbeille (asset-media.service.ts) : d'où la
//     revérification. Pour preview, Immich répond toujours par le fichier, jamais par une redirection (seul fullsize
//     redirige) : redirect: 'error' refuse toute redirection, qui emporterait la clé ailleurs.
//   - Portrait : width et height de l'asset sont les dimensions AFFICHÉES (Immich les échange pour les orientations
//     EXIF 5 à 8, metadata.service.ts) ; s'ils manquent, repli sur exifImageWidth et exifImageHeight, échangés pour
//     ces orientations. Dimensions inconnues : paysage (plein écran, image entière sur fond Ardoise).
//   - Légende : la ville (sinon le pays) et le mois de la prise de vue. Le mois vient de localDateTime (heure locale
//     de la prise de vue, écrite comme de l'UTC : on lit ses 7 premiers caractères, sans fuseau), seulement si
//     exifInfo.dateTimeOriginal existe (sinon localDateTime est la date du fichier, pas celle de la photo). Jamais de
//     coordonnées GPS dans la réponse au cadre.
//   - Défense en profondeur : le lot reçu est validé (ajv) puis refiltré ici (type, corbeille, visibilité, favoris),
//     et seuls les identifiants en forme d'uuid sortent : la page construit ses URL avec.
//   - Taille : la réponse du lot (et de la vérification) est plafonnée à 5 Mo, lue en flux et abandonnée dès le
//     dépassement (serveur/corps.js) ; une photo à 15 Mo (Content-Length d'abord, puis compteur d'octets pendant le
//     relais) ; un transfert est coupé au bout de 30 s ou quand le cadre s'en va (signalClient) : la mémoire du
//     conteneur (256 Mo) ne dépend pas de ce qu'Immich renvoie.
//   - Les messages d'erreur ne citent jamais la clé ni les en-têtes.

import { pipeline, Readable, Transform } from 'node:stream';
import { ErreurTropGros, lireCorpsPlafonne } from '../corps.js';
import { compilerValidateur } from '../source.js';

export const MOTIF_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PHOTOS_PAR_LOT = 100;
const DELAI_MS = 10_000;
const DUREE_MAX_MS = 30_000;
const TAILLE_MAX_LOT = 5 * 1024 * 1024;
const TAILLE_MAX_PHOTO = 15 * 1024 * 1024;
const RETENUE_IDS_MS = 2 * 3600_000;
const TYPES_IMAGE = new Set(['image/jpeg', 'image/webp', 'image/png']);
const ORIENTATIONS_DE_COTE = new Set(['5', '6', '7', '8']);
const STATUTS_ABSENTE = new Set([400, 403, 404]);
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export class ErreurImmich extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const texteOuNul = { type: ['string', 'null'] };
const entierOuNul = { type: ['integer', 'null'] };
const SCHEMA_ASSET = {
  type: 'object',
  required: ['id', 'type', 'isTrashed', 'visibility', 'isFavorite', 'localDateTime'],
  properties: {
    id: { type: 'string' },
    type: { type: 'string' },
    isTrashed: { type: 'boolean' },
    isFavorite: { type: 'boolean' },
    visibility: { type: 'string' },
    localDateTime: { type: 'string' },
    width: entierOuNul,
    height: entierOuNul,
    exifInfo: {
      type: 'object',
      properties: {
        city: texteOuNul, country: texteOuNul, dateTimeOriginal: texteOuNul, orientation: texteOuNul, exifImageWidth: entierOuNul, exifImageHeight: entierOuNul,
      },
    },
  },
};
const validerLot = compilerValidateur({ type: 'array', maxItems: 1000, items: SCHEMA_ASSET });
const validerAsset = compilerValidateur(SCHEMA_ASSET);

export function corpsRecherche(source) {
  const filtre = { type: { eq: 'IMAGE' }, visibility: { eq: 'timeline' }, trashedAt: { eq: null } };
  if (source.type === 'album') filtre.albumIds = { any: [source.albumId] };
  if (source.type === 'favoris') filtre.isFavorite = { eq: true };
  return { size: PHOTOS_PAR_LOT, withExif: true, filter: filtre };
}

function estPortrait(asset) {
  if (Number.isInteger(asset.width) && Number.isInteger(asset.height)) return asset.height > asset.width;
  const exif = asset.exifInfo || {};
  if (!Number.isInteger(exif.exifImageWidth) || !Number.isInteger(exif.exifImageHeight)) return false;
  const deCote = ORIENTATIONS_DE_COTE.has(String(exif.orientation));
  return deCote ? exif.exifImageWidth > exif.exifImageHeight : exif.exifImageHeight > exif.exifImageWidth;
}

function legende(asset) {
  const exif = asset.exifInfo || {};
  const lieu = exif.city || exif.country || null;
  const date = /^(\d{4})-(\d{2})/.exec(asset.localDateTime);
  const mois = exif.dateTimeOriginal && date && Number(date[2]) >= 1 && Number(date[2]) <= 12 ? `${MOIS[Number(date[2]) - 1]} ${date[1]}` : null;
  const texte = lieu && mois ? `${lieu} · ${mois}` : lieu || mois;
  return texte ? texte.charAt(0).toUpperCase() + texte.slice(1) : null;
}

// Une photo est montrable si elle répond encore au filtre du lot (vérifié à la réception ET avant chaque envoi).
function montrable(asset, source) {
  return asset.type === 'IMAGE' && !asset.isTrashed && asset.visibility === 'timeline' && (source.type !== 'favoris' || asset.isFavorite);
}

// Coupe le flux au-delà de max octets (réponse sans Content-Length ou mensongère).
function plafond(max) {
  let recus = 0;
  return new Transform({
    transform(morceau, _codage, suite) {
      recus += morceau.length;
      if (recus > max) suite(new Error('photo trop grosse'));
      else suite(null, morceau);
    },
  });
}

export async function lireVersion(url, requete = fetch) {
  const reponse = await requete(`${url}/api/server/version`, { redirect: 'error', signal: AbortSignal.timeout(DELAI_MS) });
  if (!reponse.ok) throw new Error(`Immich répond ${reponse.status}`);
  const { major, minor, patch } = await reponse.json();
  return `${major}.${minor}.${patch}`;
}

export function creerImmich({
  url, cle, source, requete = fetch, delaiMs = DELAI_MS, dureeMaxMs = DUREE_MAX_MS, tailleMax = TAILLE_MAX_PHOTO, maintenant = Date.now,
}) {
  if (!cle) return null;
  const entetes = { 'x-api-key': cle, accept: 'application/json' };
  const rendues = new Map(); // id -> dernier lot (ms) qui l'a rendue

  // Requête vers Immich ; erreur réseau ou délai dépassé -> ErreurImmich 502 (sans la clé dans le message).
  async function appeler(chemin, options, signal) {
    try {
      return await requete(`${url}${chemin}`, { ...options, redirect: 'error', signal });
    } catch (err) {
      const cause = signal.aborted ? 'délai dépassé ou transfert abandonné' : (err.cause && err.cause.code) || err.message;
      throw new ErreurImmich(502, `Immich injoignable (${cause})`);
    }
  }

  // Réponse refusée : son corps est abandonné (la connexion se libère), l'erreur dit pourquoi sans rien citer d'autre.
  async function refus(reponse, quoi) {
    if (reponse.body) await reponse.body.cancel().catch(() => {});
    if (reponse.status === 401 || reponse.status === 403) return new ErreurImmich(502, `${quoi} : clé refusée par Immich (${reponse.status})`);
    return new ErreurImmich(502, `${quoi} : Immich répond ${reponse.status}`);
  }

  async function lireJson(reponse, tailleMaxJson, quoi) {
    let octets;
    try {
      octets = await lireCorpsPlafonne(reponse, tailleMaxJson);
    } catch (err) {
      throw err instanceof ErreurTropGros ? new ErreurImmich(502, `${quoi} : réponse trop grosse`) : err;
    }
    try {
      return JSON.parse(octets.toString('utf8'));
    } catch (err) {
      throw new ErreurImmich(502, `${quoi} : réponse illisible`);
    }
  }

  async function lot() {
    const signal = AbortSignal.timeout(delaiMs);
    const reponse = await appeler('/api/search/random', {
      method: 'POST', headers: { ...entetes, 'content-type': 'application/json' }, body: JSON.stringify(corpsRecherche(source)),
    }, signal);
    if (!reponse.ok) throw await refus(reponse, 'lot de photos');
    let assets;
    try {
      assets = validerLot(await lireJson(reponse, TAILLE_MAX_LOT, 'lot de photos'));
    } catch (err) {
      throw err instanceof ErreurImmich ? err : new ErreurImmich(502, `lot de photos : ${err.message}`);
    }
    const t = maintenant();
    rendues.forEach((quand, id) => {
      if (t - quand > RETENUE_IDS_MS) rendues.delete(id);
    });
    const photos = assets
      .filter((asset) => MOTIF_ID.test(asset.id) && montrable(asset, source))
      .map((asset) => ({ id: asset.id, portrait: estPortrait(asset), legende: legende(asset) }));
    photos.forEach((photo) => rendues.set(photo.id, t));
    return photos;
  }

  async function verifier(id, signal) {
    const reponse = await appeler(`/api/assets/${id}`, { headers: entetes }, signal);
    if (STATUTS_ABSENTE.has(reponse.status)) {
      await refus(reponse, 'vérification de la photo');
      throw new ErreurImmich(410, 'photo plus disponible dans Immich');
    }
    if (!reponse.ok) throw await refus(reponse, 'vérification de la photo');
    let asset;
    try {
      asset = validerAsset(await lireJson(reponse, TAILLE_MAX_LOT, 'vérification de la photo'));
    } catch (err) {
      throw err instanceof ErreurImmich ? err : new ErreurImmich(502, `vérification de la photo : ${err.message}`);
    }
    if (asset.id !== id || !montrable(asset, source)) throw new ErreurImmich(410, 'photo retirée (corbeille, archive ou filtre)');
  }

  async function photo(id, signalClient) {
    if (!MOTIF_ID.test(id)) throw new ErreurImmich(400, 'identifiant de photo invalide');
    const rendue = rendues.get(id);
    if (rendue === undefined || maintenant() - rendue > RETENUE_IDS_MS) throw new ErreurImmich(410, 'photo absente des derniers lots');
    const abandon = new AbortController();
    const finir = () => abandon.abort();
    const minuteur = setTimeout(finir, dureeMaxMs);
    signalClient.addEventListener('abort', finir, { once: true });
    const nettoyer = () => {
      clearTimeout(minuteur);
      signalClient.removeEventListener('abort', finir);
    };
    try {
      if (signalClient.aborted) throw new ErreurImmich(502, 'transfert abandonné (cadre parti)');
      await verifier(id, AbortSignal.any([abandon.signal, AbortSignal.timeout(delaiMs)]));
      const reponse = await appeler(`/api/assets/${id}/thumbnail?size=preview&edited=true`, { headers: { 'x-api-key': cle } }, abandon.signal);
      if (STATUTS_ABSENTE.has(reponse.status)) {
        await refus(reponse, 'miniature');
        throw new ErreurImmich(410, 'miniature introuvable dans Immich');
      }
      if (!reponse.ok) throw await refus(reponse, 'miniature');
      const type = String(reponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!TYPES_IMAGE.has(type)) throw new ErreurImmich(502, `miniature : type inattendu (${type || 'aucun'})`);
      const longueur = reponse.headers.get('content-length');
      const taille = longueur !== null && /^\d+$/.test(longueur) ? Number(longueur) : null;
      if (taille !== null && taille > tailleMax) throw new ErreurImmich(502, 'miniature trop grosse');
      // pipeline et non pipe : une coupure en amont (30 s, cadre parti) détruit aussi le flux rendu, la route le voit.
      const corps = plafond(tailleMax);
      corps.on('close', nettoyer);
      pipeline(Readable.fromWeb(reponse.body), corps, () => {});
      return { type, taille, corps };
    } catch (err) {
      nettoyer();
      abandon.abort();
      throw err;
    }
  }

  return { source: source.type, lot, photo };
}
