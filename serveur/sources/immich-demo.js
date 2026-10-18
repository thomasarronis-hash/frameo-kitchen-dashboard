// serveur/sources/immich-demo.js
//
// Rôle    : un FAUX Immich de démonstration, pour voir le mode Photos sans clé ni photo réelle : un serveur HTTP local
//           (127.0.0.1, port choisi par le système) qui répond aux quatre routes qu'emploie serveur/sources/immich.js,
//           avec sept images fabriquées ici (paysages et portraits dessinés, en PNG).
// Entrées : demarrerImmichDemo() ; appelé par index.js SEULEMENT si IMMICH_DEMO=1, que config.js refuse hors de
//           NODE_ENV=development.
// Sorties : promesse de { url, cle, arreter() } : url et cle à donner à creerImmich (la clé est tirée au hasard et
//           exigée en x-api-key, comme le ferait Immich) ;
//           routes servies : GET /api/server/version, POST /api/search/random, GET /api/assets/<id>,
//           GET /api/assets/<id>/thumbnail?size=preview.
// Pièges  :
//   - N'existe pas en production : index.js ne l'importe (import dynamique) qu'en démonstration, et .dockerignore
//     l'exclut de l'image Docker (tests/photos-demo.test.js le vérifie).
//   - Lot TOUJOURS dans le même ordre (pas de hasard) : paysage, portrait mis à la corbeille entre-temps (410 à la
//     revérification : la page doit passer à la suivante), deux portraits (une paire), paysage 16:9, portrait seul
//     (aucun autre portrait derrière lui), paysage sans date ni lieu (pas de légende). Les captures de la
//     démonstration montrent donc chaque disposition dans un ordre connu.
//   - Le corps de la recherche est contrôlé (filtre IMAGE, timeline, hors corbeille, puis rien de plus pour toute la
//     photothèque, ou l'album, ou les favoris, jamais les deux) : une régression du client se voit aussi en
//     démonstration. Les trois sources donnent le même lot.
//   - Images en PNG (zlib de Node, aucune dépendance) : Immich sert ses previews en JPEG ou WebP, le client accepte
//     aussi le PNG. Fabriquées à la première demande, gardées en mémoire (moins de 3 Mo pour les sept).
//   - Aucune donnée réelle : villes et dates inventées.

import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import { crc32, deflateSync } from 'node:zlib';

// Scènes : ciel en dégradé (haut, bas), soleil (x, y en fraction, rayon en fraction de la largeur), deux lignes de
// collines (hauteur moyenne en fraction, amplitude, fréquence, couleur), sol optionnel (eau ou champ).
const SCENES = {
  lac: { ciel: [[94, 156, 214], [214, 232, 240]], soleil: [0.72, 0.22, 0.06, [255, 244, 214]], collines: [[0.52, 0.08, 3, [96, 120, 150]], [0.6, 0.05, 5, [52, 84, 96]]], sol: [0.66, [40, 96, 140], [90, 150, 190]] },
  couchant: { ciel: [[64, 40, 104], [250, 150, 90]], soleil: [0.5, 0.62, 0.08, [255, 214, 140]], collines: [[0.66, 0.05, 2, [70, 46, 80]], [0.76, 0.06, 4, [34, 24, 44]]], sol: null },
  foret: { ciel: [[150, 200, 220], [230, 240, 220]], soleil: [0.25, 0.15, 0.1, [255, 250, 230]], collines: [[0.45, 0.1, 4, [70, 120, 80]], [0.62, 0.08, 7, [30, 80, 50]]], sol: [0.78, [60, 110, 50], [110, 150, 70]] },
  mer: { ciel: [[40, 110, 170], [190, 220, 235]], soleil: [0.7, 0.3, 0.09, [255, 250, 220]], collines: [[0.58, 0.03, 2, [150, 160, 170]]], sol: [0.6, [20, 70, 120], [70, 140, 180]] },
  neige: { ciel: [[30, 60, 120], [170, 200, 230]], soleil: [0.3, 0.2, 0.07, [255, 255, 240]], collines: [[0.35, 0.18, 2, [235, 240, 248]], [0.6, 0.1, 3, [120, 140, 160]]], sol: [0.8, [220, 228, 236], [250, 252, 255]] },
  aube: { ciel: [[236, 170, 160], [255, 232, 200]], soleil: [0.5, 0.42, 0.12, [255, 252, 235]], collines: [[0.5, 0.06, 3, [180, 120, 130]], [0.7, 0.07, 5, [110, 70, 90]]], sol: null },
  champ: { ciel: [[80, 150, 220], [200, 225, 245]], soleil: [0.82, 0.18, 0.05, [255, 245, 200]], collines: [[0.55, 0.04, 3, [120, 150, 90]]], sol: [0.6, [210, 170, 60], [240, 210, 110]] },
};

const PHOTOS = [
  { n: 1, largeur: 1440, hauteur: 1080, scene: 'lac', ville: 'Annecy', pays: 'France', prise: '2024-07-14T16:20:00.000Z' },
  { n: 2, largeur: 1080, hauteur: 1440, scene: 'mer', ville: 'Biarritz', pays: 'France', prise: '2023-08-02T11:00:00.000Z', corbeille: true },
  { n: 3, largeur: 1080, hauteur: 1440, scene: 'foret', ville: 'Chambéry', pays: 'France', prise: '2025-05-03T10:00:00.000Z' },
  { n: 4, largeur: 1080, hauteur: 1440, scene: 'neige', ville: null, pays: 'Suisse', prise: '2024-12-20T09:30:00.000Z' },
  { n: 5, largeur: 1920, hauteur: 1080, scene: 'couchant', ville: 'Annecy', pays: 'France', prise: '2025-10-05T18:45:00.000Z' },
  { n: 6, largeur: 1080, hauteur: 1440, scene: 'aube', ville: null, pays: null, prise: '2023-03-12T15:00:00.000Z' },
  { n: 7, largeur: 1440, hauteur: 1080, scene: 'champ', ville: null, pays: null, prise: null },
].map((photo) => ({ ...photo, id: `d0000000-0000-4000-8000-${String(photo.n).padStart(12, '0')}` }));

const melange = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));

function dessiner({ largeur, hauteur, scene }) {
  const { ciel, soleil, collines, sol } = SCENES[scene];
  const ligne = largeur * 3 + 1;
  const pixels = Buffer.alloc(ligne * hauteur);
  const horizons = collines.map(([moyenne, amplitude, frequence]) => Float64Array.from({ length: largeur },
    (_v, x) => hauteur * (moyenne + amplitude * Math.sin((x / largeur) * frequence * Math.PI * 2 + frequence))));
  const [sx, sy, sr, couleurSoleil] = soleil;
  for (let y = 0; y < hauteur; y += 1) {
    const fondCiel = melange(ciel[0], ciel[1], y / hauteur);
    for (let x = 0; x < largeur; x += 1) {
      let couleur = fondCiel;
      if (Math.hypot(x - sx * largeur, y - sy * hauteur) < sr * largeur) couleur = couleurSoleil;
      collines.forEach(([, , , teinte], i) => {
        if (y > horizons[i][x]) couleur = teinte;
      });
      if (sol && y > sol[0] * hauteur) couleur = melange(sol[1], sol[2], (y - sol[0] * hauteur) / (hauteur * (1 - sol[0])));
      const o = y * ligne + 1 + x * 3;
      pixels[o] = couleur[0];
      pixels[o + 1] = couleur[1];
      pixels[o + 2] = couleur[2];
    }
  }
  return png(largeur, hauteur, pixels);
}

function morceau(type, donnees) {
  const tete = Buffer.alloc(8);
  tete.writeUInt32BE(donnees.length, 0);
  tete.write(type, 4, 'ascii');
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(Buffer.concat([tete.subarray(4), donnees])), 0);
  return Buffer.concat([tete, donnees, somme]);
}

// PNG en couleurs vraies 8 bits, lignes sans filtre (octet 0 en tête de chaque ligne, déjà réservé par dessiner).
function png(largeur, hauteur, pixels) {
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', entete),
    morceau('IDAT', deflateSync(pixels)),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

function asset(photo, { apresCorbeille }) {
  return {
    id: photo.id,
    type: 'IMAGE',
    isTrashed: apresCorbeille && photo.corbeille === true,
    isFavorite: true,
    visibility: 'timeline',
    width: photo.largeur,
    height: photo.hauteur,
    localDateTime: photo.prise || '2026-10-13T08:00:00.000Z',
    fileCreatedAt: '2026-10-13T08:00:00.000Z',
    exifInfo: {
      city: photo.ville, country: photo.pays, dateTimeOriginal: photo.prise, exifImageWidth: photo.largeur, exifImageHeight: photo.hauteur, orientation: '1',
    },
  };
}

function corpsAttendu(corps) {
  const filtre = corps && corps.filter;
  if (!filtre || corps.withExif !== true || filtre.type?.eq !== 'IMAGE' || filtre.visibility?.eq !== 'timeline' || filtre.trashedAt?.eq !== null) return false;
  const album = filtre.albumIds !== undefined;
  const favoris = filtre.isFavorite !== undefined;
  return !(album && favoris) && (!album || Array.isArray(filtre.albumIds.any)) && (!favoris || filtre.isFavorite.eq === true);
}

const envoyerJson = (res, statut, donnees) => {
  res.writeHead(statut, { 'content-type': 'application/json' });
  res.end(JSON.stringify(donnees));
};

export async function demarrerImmichDemo() {
  const cle = randomBytes(16).toString('hex');
  const images = new Map();
  const serveur = http.createServer((req, res) => {
    const adresse = new URL(req.url, 'http://demo');
    if (adresse.pathname === '/api/server/version') return envoyerJson(res, 200, { major: 3, minor: 2, patch: 0, prerelease: null });
    if (req.headers['x-api-key'] !== cle) return envoyerJson(res, 401, { message: 'Invalid API key' });
    if (req.method === 'POST' && adresse.pathname === '/api/search/random') {
      let texte = '';
      req.on('data', (bout) => { texte += bout; });
      req.on('end', () => {
        let corps = null;
        try {
          corps = JSON.parse(texte);
        } catch (err) {
          corps = null;
        }
        if (!corpsAttendu(corps)) return envoyerJson(res, 400, { message: 'filtre inattendu' });
        return envoyerJson(res, 200, PHOTOS.map((photo) => asset(photo, { apresCorbeille: false })));
      });
      return undefined;
    }
    const trouve = /^\/api\/assets\/([0-9a-f-]{36})(\/thumbnail)?$/.exec(adresse.pathname);
    const photo = trouve && PHOTOS.find((candidate) => candidate.id === trouve[1]);
    if (!photo) return envoyerJson(res, 400, { message: 'Not found or no asset.read access' });
    if (!trouve[2]) return envoyerJson(res, 200, asset(photo, { apresCorbeille: true }));
    if (adresse.searchParams.get('size') !== 'preview') return envoyerJson(res, 400, { message: 'size=preview attendu' });
    if (!images.has(photo.id)) images.set(photo.id, dessiner(photo));
    const octets = images.get(photo.id);
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': octets.length, 'cache-control': 'private, max-age=86400' });
    return res.end(octets);
  });
  serveur.listen(0, '127.0.0.1');
  await once(serveur, 'listening');
  return {
    url: `http://127.0.0.1:${serveur.address().port}`,
    cle,
    arreter() {
      serveur.closeAllConnections();
      serveur.close();
    },
  };
}
