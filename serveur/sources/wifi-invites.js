// serveur/sources/wifi-invites.js
//
// Rôle    : lire le fichier secret du Wi-Fi invités (wifi_invites.json) et fabriquer la chaîne du QR code
//           « WIFI:T:...;S:...;P:...;; » qu'un téléphone comprend, échappée ici, côté serveur.
// Entrées : lireWifiInvites(fichier, journal) : chemin de WIFI_INVITES_FICHIER (config.js, null par défaut) ; le
//           fichier contient { "ssid", "mot_de_passe", "securite": "WPA" | "WPA2" | "WPA3" | "nopass" }.
// Sorties : echapperWifi(texte), chaineQr({ ssid, mot_de_passe, securite }) ; lireWifiInvites(...) -> promesse de
//           { configure: true, ssid, mot_de_passe (null pour un réseau ouvert), chaine_qr } ou { configure: false }
//           (pas de fichier) ou { configure: false, probleme } (fichier présent mais invalide : la raison, jamais son
//           contenu).
// Pièges  :
//   - Échappement de la spécification du format WIFI: (celle de ZXing, reprise par les téléphones) : \ ; , : et "
//     sont précédés d'une barre oblique inverse, dans le nom comme dans le mot de passe ; la barre elle-même
//     d'abord, sinon elle serait doublée deux fois.
//   - T:WPA pour WPA, WPA2 et WPA3 : c'est la seule valeur de la spécification pour une clé partagée, le téléphone
//     négocie ensuite avec la box [S : un réseau WPA3 seul, sans mode mixte, reste à essayer avec un Android].
//     nopass : ni T:WPA ni P.
//   - Freebox : les clés invités sont des clés WPA en plus sur le réseau principal (même nom), en « Internet
//     seulement » (net_only) et SANS expiration (une clé qui expire rendrait le QR faux sans prévenir).
//   - Relu à chaque demande : déposer ou corriger le fichier ne demande pas de redémarrer. Un fichier invalide est
//     dit en clair (journal et écran) sans jamais citer son contenu : le message de JSON.parse en recopie une
//     partie, mot de passe compris, d'où un message à nous.
//   - Mot de passe WPA : 8 à 63 caractères ASCII imprimables (phrase de passe), ou 64 chiffres hexadécimaux (clé
//     brute) ; nom du réseau : 32 octets au plus en UTF-8 (limite du Wi-Fi).

import { readFile } from 'node:fs/promises';

const SECURITES = new Set(['WPA', 'WPA2', 'WPA3', 'nopass']);
const PHRASE_WPA = /^[\x20-\x7e]{8,63}$/;
const CLE_BRUTE = /^[0-9a-fA-F]{64}$/;
const CHAMPS = ['ssid', 'mot_de_passe', 'securite'];

export const echapperWifi = (texte) => texte.replace(/[\\;,:"]/g, (caractere) => `\\${caractere}`);

export function chaineQr({ ssid, mot_de_passe: motDePasse, securite }) {
  if (securite === 'nopass') return `WIFI:T:nopass;S:${echapperWifi(ssid)};;`;
  return `WIFI:T:WPA;S:${echapperWifi(ssid)};P:${echapperWifi(motDePasse)};;`;
}

// Raison du refus (texte sans le contenu du fichier), ou null si la description est valable.
function probleme(description) {
  if (description === null || typeof description !== 'object' || Array.isArray(description)) return 'un objet JSON est attendu';
  const inconnu = Object.keys(description).find((cle) => !CHAMPS.includes(cle));
  if (inconnu) return `champ inconnu « ${inconnu} » (attendus : ${CHAMPS.join(', ')})`;
  const { ssid, mot_de_passe: motDePasse, securite } = description;
  if (typeof ssid !== 'string' || ssid.length === 0 || Buffer.byteLength(ssid, 'utf8') > 32) return 'ssid : 1 à 32 octets';
  if (!SECURITES.has(securite)) return 'securite : WPA, WPA2, WPA3 ou nopass';
  if (securite === 'nopass') return motDePasse === undefined || motDePasse === '' ? null : 'mot_de_passe : vide pour un réseau sans mot de passe';
  if (typeof motDePasse !== 'string' || !(PHRASE_WPA.test(motDePasse) || CLE_BRUTE.test(motDePasse))) {
    return 'mot_de_passe : 8 à 63 caractères ASCII imprimables, ou 64 chiffres hexadécimaux';
  }
  return null;
}

export async function lireWifiInvites(fichier, journal) {
  if (!fichier) return { configure: false };
  let brut;
  try {
    brut = await readFile(fichier, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { configure: false };
    journal.warn(`Wi-Fi invités : fichier illisible (${err.code || 'erreur'})`);
    return { configure: false, probleme: `fichier illisible (${err.code || 'erreur'})` };
  }
  let description;
  try {
    description = JSON.parse(brut);
  } catch {
    journal.warn('Wi-Fi invités : le fichier n\'est pas du JSON valable');
    return { configure: false, probleme: 'le fichier n\'est pas du JSON valable' };
  }
  const raison = probleme(description);
  if (raison !== null) {
    journal.warn(`Wi-Fi invités : fichier refusé (${raison})`);
    return { configure: false, probleme: raison };
  }
  return {
    configure: true,
    ssid: description.ssid,
    mot_de_passe: description.securite === 'nopass' ? null : description.mot_de_passe,
    chaine_qr: chaineQr(description),
  };
}
