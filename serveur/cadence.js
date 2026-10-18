// serveur/cadence.js
//
// Rôle    : débiter les photos vers le cadre à un rythme borné, en petits morceaux, au lieu d'un bloc à pleine vitesse.
// Entrées : creerCadence({ octetsParSeconde, morceau }) : débit total (partagé par tous les flux de cette cadence) et
//           taille d'un morceau en octets.
// Sorties : { flux() } : flux() rend un Transform à placer entre la source et la réponse ; il découpe chaque bloc en
//           morceaux et ne laisse partir un morceau qu'à son tour. DEBIT_PHOTOS (256 Ko/s), MORCEAU_PHOTOS (4 Ko).
// Pièges  :
//   - Constat du 14/10 : le Wi-Fi du cadre (puce RK915) décroche pendant plusieurs minutes juste après une photo reçue
//     d'un bloc (environ 40 Mbit/s depuis le M900 en filaire, deux photos en même temps pour une paire de portraits) ;
//     les gros paquets vers le cadre se perdent alors tous (docs/cadre-ave948.md). 256 Ko/s en morceaux de 4 Ko
//     (2 Mbit/s, un morceau toutes les 16 ms, trois paquets TCP) : la Freebox n'envoie plus de rafale au cadre. Une
//     photo de 1440 px (300 à 600 Ko) arrive en 1 à 3 s, bien avant le délai de 20 s de la page (web/src/photos.js).
//   - Débit PARTAGÉ : chaque morceau réserve le prochain créneau libre de la cadence, quel que soit son flux ; les deux
//     photos d'une paire avancent chacune à la moitié du débit, jamais au double.
//   - Aucun crédit ne s'accumule pendant un silence : après une pause, le premier morceau part tout de suite, les
//     suivants à leur rythme (pas de rafale « de rattrapage »).
//   - Un flux détruit (cadre parti, coupure en amont) arrête de réserver des créneaux.

import { Transform } from 'node:stream';

export const DEBIT_PHOTOS = 256 * 1024;
export const MORCEAU_PHOTOS = 4096;

const attendre = (ms) => new Promise((resoudre) => { setTimeout(resoudre, ms); });

export function creerCadence({ octetsParSeconde = DEBIT_PHOTOS, morceau = MORCEAU_PHOTOS } = {}) {
  let libreA = 0; // instant (ms) où le prochain morceau, de n'importe quel flux, peut partir

  async function reserver(taille) {
    const maintenant = Date.now();
    const depart = Math.max(maintenant, libreA);
    libreA = depart + (taille * 1000) / octetsParSeconde;
    if (depart > maintenant) await attendre(depart - maintenant);
  }

  return {
    flux() {
      return new Transform({
        transform(bloc, _codage, suite) {
          const envoyer = async () => {
            for (let debut = 0; debut < bloc.length; debut += morceau) {
              if (this.destroyed) return;
              const part = bloc.subarray(debut, debut + morceau);
              await reserver(part.length);
              if (this.destroyed) return;
              this.push(part);
            }
          };
          envoyer().then(() => suite(), suite);
        },
      });
    },
  };
}
