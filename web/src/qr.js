// web/src/qr.js
//
// Rôle    : fabriquer la matrice d'un QR code (norme ISO/IEC 18004) sans bibliothèque : mode octet, correction M,
//           versions 1 à 10. Sert au QR du Wi-Fi invités de l'écran Maison (maison-wifi.js le dessine en un chemin SVG).
// Entrées : qrCode(texte, { masque }) : texte JavaScript, encodé en UTF-8 ; masque (0 à 7) imposé, pour les
//           tests seulement (sinon, le masque à la plus faible pénalité, comme le veut la norme).
// Sorties : qrCode(...) -> { version, masque, taille, modules } (modules[ligne][colonne] : true = module noir, sans la
//           marge de 4 modules, à ajouter au dessin) ou null si le texte dépasse 213 octets (capacité de la version
//           10 en correction M) ; et, pour les tests, les briques : octetsUtf8, codewordsDonnees, reedSolomon,
//           entrelacer, bitsFormat, bitsVersion, penalite (pénalité d'une matrice selon les règles N1 à N4).
// Pièges  :
//   - Corps de Galois GF(256) de polynôme 0x11D, générateur du code de Reed-Solomon = produit des (x - alpha^i),
//     i de 0 au nombre de codewords de correction moins 1.
//   - Tables de la norme pour la correction M (codewords de correction par bloc, nombre de blocs et codewords de
//     données de chaque groupe) et positions des motifs d'alignement, versions 1 à 10 : recopiées une à une,
//     vérifiées par les matrices de référence d'OpenCV (tests/fixtures/qr-reference.json, tests/qr.test.js).
//   - Compteur de caractères sur 8 bits jusqu'à la version 9, 16 bits pour la version 10.
//   - Bits de reste (7 pour les versions 2 à 6, 0 sinon) : laissés clairs, car jamais remplis par les données.
//   - Informations de version (versions 7 et plus) : code BCH (18, 6) de polynôme 0x1F25 ; informations de format :
//     BCH (15, 5) de polynôme 0x537, puis XOR 0x5412 ; bits de niveau M = 00.
//   - Un téléphone lit le mode octet en UTF-8 (sans en-tête ECI) : les accents d'un nom de réseau passent.
//   - Module sans DOM, en ES2019 (règles de tests/web-compat.test.js) : importé tel quel par les tests sous Node.

const VERSION_MAX = 10;
const NIVEAU_M = 0;
// Correction M, par version : [codewords de correction par bloc, blocs du groupe 1, codewords de données de ces
// blocs, blocs du groupe 2 (qui ont un codeword de données de plus)].
const BLOCS_M = [null,
  [10, 1, 16, 0], [16, 1, 28, 0], [26, 1, 44, 0], [18, 2, 32, 0], [24, 2, 43, 0],
  [16, 4, 27, 0], [18, 4, 31, 0], [22, 2, 38, 2], [22, 3, 36, 2], [26, 4, 43, 1]];
const ALIGNEMENTS = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MASQUES = [
  (l, c) => (l + c) % 2 === 0,
  (l) => l % 2 === 0,
  (l, c) => c % 3 === 0,
  (l, c) => (l + c) % 3 === 0,
  (l, c) => (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0,
  (l, c) => ((l * c) % 2) + ((l * c) % 3) === 0,
  (l, c) => (((l * c) % 2) + ((l * c) % 3)) % 2 === 0,
  (l, c) => (((l + c) % 2) + ((l * c) % 3)) % 2 === 0,
];
const PENALITES = { N1: 3, N2: 3, N3: 40, N4: 10 };

// Tables de GF(256) : EXP[i] = alpha^i, LOG[alpha^i] = i.
const EXP = new Array(512);
const LOG = new Array(256);
(function remplirGalois() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}());
const multiplier = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

export function octetsUtf8(texte) {
  return Array.prototype.slice.call(new TextEncoder().encode(texte));
}

const totalDonnees = (version) => {
  const [, n1, k1, n2] = BLOCS_M[version];
  return n1 * k1 + n2 * (k1 + 1);
};
const bitsCompteur = (version) => (version <= 9 ? 8 : 16);
const capacite = (version) => Math.floor((totalDonnees(version) * 8 - 4 - bitsCompteur(version)) / 8);

// Codewords de données : mode octet (0100), compteur, octets, terminateur, alignement sur l'octet, puis 0xEC 0x11.
export function codewordsDonnees(octets, version) {
  const bits = [];
  const pousser = (valeur, longueur) => {
    for (let i = longueur - 1; i >= 0; i -= 1) bits.push((valeur >>> i) & 1);
  };
  const capaciteBits = totalDonnees(version) * 8;
  pousser(4, 4);
  pousser(octets.length, bitsCompteur(version));
  octets.forEach((octet) => pousser(octet, 8));
  pousser(0, Math.min(4, capaciteBits - bits.length));
  pousser(0, (8 - (bits.length % 8)) % 8);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let bourrage = 0xec; codewords.length < totalDonnees(version); bourrage ^= 0xec ^ 0x11) codewords.push(bourrage);
  return codewords;
}

// Codewords de correction de Reed-Solomon d'un bloc.
export function reedSolomon(donnees, nombre) {
  let generateur = [1];
  for (let i = 0; i < nombre; i += 1) {
    const suivant = new Array(generateur.length + 1).fill(0);
    generateur.forEach((coef, j) => {
      suivant[j] ^= coef;
      suivant[j + 1] ^= multiplier(coef, EXP[i]);
    });
    generateur = suivant;
  }
  const reste = new Array(nombre).fill(0);
  donnees.forEach((octet) => {
    const facteur = octet ^ reste.shift();
    reste.push(0);
    for (let j = 0; j < nombre; j += 1) reste[j] ^= multiplier(generateur[j + 1], facteur);
  });
  return reste;
}

// Découpe en blocs, correction de chaque bloc, puis entrelacement : données colonne par colonne, puis corrections.
export function entrelacer(donnees, version) {
  const [ec, n1, k1, n2] = BLOCS_M[version];
  const blocs = [];
  let debut = 0;
  for (let b = 0; b < n1 + n2; b += 1) {
    const longueur = b < n1 ? k1 : k1 + 1;
    const bloc = donnees.slice(debut, debut + longueur);
    blocs.push({ donnees: bloc, correction: reedSolomon(bloc, ec) });
    debut += longueur;
  }
  const sortie = [];
  for (let i = 0; i <= k1; i += 1) blocs.forEach((bloc) => { if (i < bloc.donnees.length) sortie.push(bloc.donnees[i]); });
  for (let i = 0; i < ec; i += 1) blocs.forEach((bloc) => sortie.push(bloc.correction[i]));
  return sortie;
}

export function bitsFormat(masque) {
  const donnees = (NIVEAU_M << 3) | masque;
  let reste = donnees;
  for (let i = 0; i < 10; i += 1) reste = (reste << 1) ^ ((reste >>> 9) * 0x537);
  return ((donnees << 10) | reste) ^ 0x5412;
}

export function bitsVersion(version) {
  let reste = version;
  for (let i = 0; i < 12; i += 1) reste = (reste << 1) ^ ((reste >>> 11) * 0x1f25);
  return (version << 12) | reste;
}

const bit = (valeur, rang) => ((valeur >>> rang) & 1) === 1;

// Matrice vide avec les motifs fixes (repérage, séparateurs, synchronisation, alignement, module noir) et les zones
// réservées (format, version) marquées dans fonction[][].
function matriceDeBase(version) {
  const taille = 17 + 4 * version;
  const modules = [];
  const fonction = [];
  for (let l = 0; l < taille; l += 1) {
    modules.push(new Array(taille).fill(false));
    fonction.push(new Array(taille).fill(false));
  }
  const poser = (l, c, noir) => {
    modules[l][c] = noir;
    fonction[l][c] = true;
  };
  for (let i = 8; i < taille - 8; i += 1) {
    poser(6, i, i % 2 === 0);
    poser(i, 6, i % 2 === 0);
  }
  [[0, 0], [0, taille - 7], [taille - 7, 0]].forEach(([l0, c0]) => {
    for (let dl = -1; dl <= 7; dl += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const l = l0 + dl;
        const c = c0 + dc;
        if (l < 0 || c < 0 || l >= taille || c >= taille) continue;
        const bord = Math.max(Math.abs(dl - 3), Math.abs(dc - 3));
        poser(l, c, bord !== 2 && bord !== 4);
      }
    }
  });
  const centres = ALIGNEMENTS[version];
  centres.forEach((l0, i) => centres.forEach((c0, j) => {
    const dernier = centres.length - 1;
    if ((i === 0 && j === 0) || (i === 0 && j === dernier) || (i === dernier && j === 0)) return;
    for (let dl = -2; dl <= 2; dl += 1) {
      for (let dc = -2; dc <= 2; dc += 1) poser(l0 + dl, c0 + dc, Math.max(Math.abs(dl), Math.abs(dc)) !== 1);
    }
  }));
  poser(4 * version + 9, 8, true);
  for (let i = 0; i < 9; i += 1) {
    if (!fonction[8][i]) poser(8, i, false);
    if (!fonction[i][8]) poser(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    poser(8, taille - 1 - i, false);
    if (!fonction[taille - 1 - i][8]) poser(taille - 1 - i, 8, false);
  }
  if (version >= 7) {
    const bits = bitsVersion(version);
    for (let i = 0; i < 18; i += 1) {
      const a = taille - 11 + (i % 3);
      const b = Math.floor(i / 3);
      poser(b, a, bit(bits, i));
      poser(a, b, bit(bits, i));
    }
  }
  return { taille, modules, fonction };
}

function poserFormat(matrice, masque) {
  const { taille, modules } = matrice;
  const bits = bitsFormat(masque);
  for (let i = 0; i <= 5; i += 1) modules[i][8] = bit(bits, i);
  modules[7][8] = bit(bits, 6);
  modules[8][8] = bit(bits, 7);
  modules[8][7] = bit(bits, 8);
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = bit(bits, i);
  for (let i = 0; i < 8; i += 1) modules[8][taille - 1 - i] = bit(bits, i);
  for (let i = 8; i < 15; i += 1) modules[taille - 15 + i][8] = bit(bits, i);
}

// Place les bits en zigzag (de deux colonnes en deux colonnes, depuis le coin bas droit, en sautant la colonne 6).
function placerDonnees(matrice, codewords) {
  const { taille, modules, fonction } = matrice;
  let i = 0;
  for (let droite = taille - 1; droite >= 1; droite -= 2) {
    if (droite === 6) droite = 5;
    const montant = ((droite + 1) & 2) === 0;
    for (let pas = 0; pas < taille; pas += 1) {
      const l = montant ? taille - 1 - pas : pas;
      for (let j = 0; j < 2; j += 1) {
        const c = droite - j;
        if (fonction[l][c] || i >= codewords.length * 8) continue;
        modules[l][c] = bit(codewords[i >>> 3], 7 - (i & 7));
        i += 1;
      }
    }
  }
}

function appliquerMasque(matrice, masque) {
  const { taille, modules, fonction } = matrice;
  const inverser = MASQUES[masque];
  for (let l = 0; l < taille; l += 1) {
    for (let c = 0; c < taille; c += 1) if (!fonction[l][c] && inverser(l, c)) modules[l][c] = !modules[l][c];
  }
}

// Pénalité de la norme (règles N1 à N4) : la plus faible désigne le masque.
export function penalite(modules) {
  const taille = modules.length;
  let total = 0;
  const lignes = [];
  for (let a = 0; a < taille; a += 1) {
    lignes.push(modules[a].map((v) => (v ? 1 : 0)).join(''));
    lignes.push(modules.map((ligne) => (ligne[a] ? 1 : 0)).join(''));
  }
  lignes.forEach((suite) => {
    (suite.match(/0{5,}|1{5,}/g) || []).forEach((serie) => { total += PENALITES.N1 + serie.length - 5; });
    for (let i = 0; i + 11 <= suite.length; i += 1) {
      const morceau = suite.slice(i, i + 11);
      if (morceau === '10111010000' || morceau === '00001011101') total += PENALITES.N3;
    }
  });
  let noirs = 0;
  for (let l = 0; l < taille; l += 1) {
    for (let c = 0; c < taille; c += 1) {
      if (modules[l][c]) noirs += 1;
      if (l + 1 < taille && c + 1 < taille && modules[l][c] === modules[l][c + 1] && modules[l][c] === modules[l + 1][c] && modules[l][c] === modules[l + 1][c + 1]) {
        total += PENALITES.N2;
      }
    }
  }
  total += Math.floor(Math.abs((noirs * 100) / (taille * taille) - 50) / 5) * PENALITES.N4;
  return total;
}

function construire(codewords, version, masque) {
  const matrice = matriceDeBase(version);
  placerDonnees(matrice, codewords);
  appliquerMasque(matrice, masque);
  poserFormat(matrice, masque);
  return matrice;
}

export function qrCode(texte, options) {
  const octets = octetsUtf8(texte);
  let version = 1;
  while (version <= VERSION_MAX && capacite(version) < octets.length) version += 1;
  if (version > VERSION_MAX) return null;
  const codewords = entrelacer(codewordsDonnees(octets, version), version);
  const impose = options && typeof options.masque === 'number' ? options.masque : null;
  let meilleur = null;
  for (let masque = 0; masque < MASQUES.length; masque += 1) {
    if (impose !== null && masque !== impose) continue;
    const { taille, modules } = construire(codewords, version, masque);
    const score = impose !== null ? 0 : penalite(modules);
    if (meilleur === null || score < meilleur.score) meilleur = { version, masque, taille, modules, score };
  }
  return { version: meilleur.version, masque: meilleur.masque, taille: meilleur.taille, modules: meilleur.modules };
}
