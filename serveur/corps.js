// serveur/corps.js
//
// Rôle    : lire en mémoire le corps d'une réponse fetch SANS jamais dépasser un plafond d'octets (lot et vérification
//           Immich, photo de la sonnette) : la mémoire du conteneur (256 Mo) ne dépend pas de ce que l'amont renvoie.
// Entrées : lireCorpsPlafonne(reponse, max) : une Response de fetch, le plafond en octets.
// Sorties : promesse d'un Buffer ; rejette une ErreurTropGros au-delà de max (les autres erreurs de lecture, réseau ou
//           délai, passent telles quelles) ; ErreurTropGros, pour que l'appelant écrive son propre message.
// Pièges  :
//   - Content-Length au-delà du plafond : refus avant toute lecture, corps abandonné.
//   - Réponse en morceaux (chunked, sans Content-Length) ou Content-Length mensonger : seul le compteur d'octets fait
//     foi ; dès qu'il dépasse, reader.cancel() abandonne la lecture et ferme la connexion. On a donc lu au plus max
//     octets plus un morceau, jamais tout ce que l'amont voulait envoyer (reponse.text() et arrayBuffer() lisaient tout
//     avant de comparer).
//   - On compte des octets (Uint8Array), pas des caractères : un texte UTF-16 ne dit pas la taille reçue.

export class ErreurTropGros extends Error {}

export async function lireCorpsPlafonne(reponse, max) {
  if (Number(reponse.headers.get('content-length')) > max) {
    if (reponse.body) await reponse.body.cancel().catch(() => {});
    throw new ErreurTropGros(`plus de ${max} octets annoncés`);
  }
  if (!reponse.body) return Buffer.alloc(0);
  const lecteur = reponse.body.getReader();
  const morceaux = [];
  let recus = 0;
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    recus += value.byteLength;
    if (recus > max) {
      await lecteur.cancel().catch(() => {});
      throw new ErreurTropGros(`plus de ${max} octets reçus`);
    }
    morceaux.push(value);
  }
  return Buffer.concat(morceaux, recus);
}
