// tests/qr.test.js
//
// Rôle    : prouver le générateur QR de la page (web/src/qr.js), écrit sans bibliothèque : briques comparées à des
//           vecteurs publiés (Reed-Solomon de « HELLO WORLD » en 1-M, informations de format du niveau M pour les 8
//           masques, informations de version 7 à 10, codewords de données), matrices identiques à celles d'un
//           encodeur indépendant (OpenCV) pour les versions 1 à 10, choix de la plus petite version, refus au-delà
//           de 213 octets, masque à la plus faible pénalité.
// Entrées : tests/fixtures/qr-reference.json : matrices de cv2.QRCodeEncoder (OpenCV 5.0, mode octet, correction M),
//           chacune relue par cv2.QRCodeDetector avant d'être gardée (script du scratchpad de la session du 13/10).
// Sorties : node --test.
// Pièges  :
//   - OpenCV ne laisse pas toujours à zéro les 7 bits de reste des versions 2 à 6 (un module diffère parfois, dans
//     les 7 dernières places du zigzag, colonnes 0 et 1 juste au-dessus du séparateur du bas) ; la norme les veut à
//     zéro, puis masqués, et aucun lecteur ne les lit. Le test exige donc l'identité partout ailleurs, et des zéros
//     masqués à ces 7 places.
//   - Relecture de bout en bout (hors de node --test, faute de décodeur) : les 216 matrices de 1 à 213 octets, avec
//     le masque choisi par la page, relues avec le bon texte par les deux détecteurs d'OpenCV, aucune lecture fausse.
//   - Les vecteurs publiés sont ceux de la norme ISO/IEC 18004 (annexes C et D) et de l'exemple « HELLO WORLD »
//     du tutoriel de Thonky, repris de mémoire puis confirmés ici par l'accord avec OpenCV.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  bitsFormat, bitsVersion, codewordsDonnees, entrelacer, octetsUtf8, penalite, qrCode, reedSolomon,
} from '../web/src/qr.js';

const { references } = JSON.parse(readFileSync(new URL('./fixtures/qr-reference.json', import.meta.url), 'utf8'));
const enTexte = (modules) => modules.map((ligne) => ligne.map((v) => (v ? '1' : '0')).join(''));

// Masques de la norme, réécrits ici indépendamment de qr.js (l = ligne, c = colonne).
const MASQUES = [
  (l, c) => (l + c) % 2 === 0, (l) => l % 2 === 0, (l, c) => c % 3 === 0, (l, c) => (l + c) % 3 === 0,
  (l, c) => (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0, (l, c) => ((l * c) % 2) + ((l * c) % 3) === 0,
  (l, c) => (((l * c) % 2) + ((l * c) % 3)) % 2 === 0, (l, c) => (((l + c) % 2) + ((l * c) % 3)) % 2 === 0,
];
// Les 7 dernières places du zigzag (bits de reste) des versions 2 à 6 : colonnes 1 puis 0, en descendant, finissant
// juste au-dessus du séparateur du motif de repérage du bas (ligne taille - 8).
const placesDuReste = (taille) => [[taille - 12, 0], [taille - 11, 1], [taille - 11, 0], [taille - 10, 1], [taille - 10, 0], [taille - 9, 1], [taille - 9, 0]];

test('Reed-Solomon : « HELLO WORLD » en 1-M donne les 10 codewords de correction publiés', () => {
  assert.deepEqual(reedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('informations de format du niveau M, masques 0 à 7 (table de la norme)', () => {
  const attendus = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((masque) => bitsFormat(masque).toString(2).padStart(15, '0')), attendus);
});

test('informations de version 7 à 10 (table de la norme)', () => {
  assert.deepEqual([7, 8, 9, 10].map(bitsVersion), [0x07c94, 0x085bc, 0x09a99, 0x0a4d3]);
});

test('codewords de données : mode octet, compteur, terminateur, bourrage 0xEC 0x11 ; UTF-8 pour les accents', () => {
  assert.deepEqual(codewordsDonnees(octetsUtf8('A'), 1), [0x40, 0x14, 0x10, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec]);
  assert.deepEqual(octetsUtf8('é€'), [0xc3, 0xa9, 0xe2, 0x82, 0xac]);
  const v10 = codewordsDonnees(octetsUtf8('x'.repeat(213)), 10);
  assert.equal(v10.length, 216);
  assert.deepEqual(v10.slice(0, 3), [0x40, 0x0d, 0x57], 'version 10 : compteur sur 16 bits (213 = 0x00D5)');
  assert.equal(entrelacer(v10, 10).length, 346, '216 de données + 5 blocs x 26 de correction');
});

test('matrices identiques à celles d\'OpenCV (même masque), versions 1 à 10, à part les bits de reste qui sont des zéros masqués', () => {
  assert.deepEqual([...new Set(references.map((r) => r.version))].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const reference of references) {
    const q = qrCode(reference.texte, { masque: reference.masque });
    assert.equal(q.version, reference.version, `${reference.octets} octets`);
    assert.equal(q.taille, 17 + 4 * reference.version);
    const reste = reference.version >= 2 && reference.version <= 6 ? placesDuReste(q.taille) : [];
    const estReste = (l, c) => reste.some(([lr, cr]) => lr === l && cr === c);
    const lignes = enTexte(q.modules);
    const ecarts = [];
    lignes.forEach((ligne, l) => [...ligne].forEach((v, c) => {
      if (v !== reference.lignes[l][c] && !estReste(l, c)) ecarts.push([l, c]);
    }));
    assert.deepEqual(ecarts, [], `version ${reference.version}, masque ${reference.masque} : modules différents d'OpenCV`);
    for (const [l, c] of reste) assert.equal(q.modules[l][c], MASQUES[reference.masque](l, c), `reste (${l}, ${c}) : zéro masqué`);
  }
});

test('version : la plus petite qui contient le texte ; au-delà de 213 octets, null', () => {
  const capacites = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  capacites.forEach((capacite, i) => {
    assert.equal(qrCode('x'.repeat(capacite)).version, i + 1, `${capacite} octets`);
    if (i < 9) assert.equal(qrCode('x'.repeat(capacite + 1)).version, i + 2, `${capacite + 1} octets`);
  });
  assert.equal(qrCode('é'.repeat(7)).version, 1, '14 octets en UTF-8');
  assert.equal(qrCode('é'.repeat(8)).version, 2, '16 octets en UTF-8');
  assert.equal(qrCode('x'.repeat(214)), null);
});

test('masque : celui de plus faible pénalité parmi les 8 (premier en cas d\'égalité)', () => {
  for (const texte of ['WIFI:T:WPA;S:Freebox-EXEMPLE;P:Invit\\;es\\:2026;;', 'WIFI:T:nopass;S:Invités;;', 'x'.repeat(122)]) {
    const choisi = qrCode(texte);
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((masque) => penalite(qrCode(texte, { masque }).modules));
    assert.equal(choisi.masque, scores.indexOf(Math.min(...scores)), texte);
    assert.deepEqual(enTexte(choisi.modules), enTexte(qrCode(texte, { masque: choisi.masque }).modules));
  }
});

test('pénalité : règles N1 à N4 sur des matrices simples', () => {
  const pleine = (taille, valeur) => Array.from({ length: taille }, () => new Array(taille).fill(valeur));
  // 5 x 5 tout blanc : N1 = 10 suites de 5 (3 chacune), N2 = 16 carrés (3 chacun), N4 = 0 % de noir (10 x 10).
  assert.equal(penalite(pleine(5, false)), 10 * 3 + 16 * 3 + 100);
  // Damier 4 x 4 : aucune suite, aucun carré, 50 % de noir.
  assert.equal(penalite(Array.from({ length: 4 }, (_l, l) => Array.from({ length: 4 }, (_c, c) => (l + c) % 2 === 0))), 0);
  // Motif 1:1:3:1:1 suivi de 4 blancs, dans une ligne de 11 (N3 = 40, plus les suites de la ligne et des colonnes).
  const ligne = [...'10111010000'].map((v) => v === '1');
  assert.ok(penalite([ligne, ...Array.from({ length: 10 }, () => new Array(11).fill(false))]) >= 40);
});
