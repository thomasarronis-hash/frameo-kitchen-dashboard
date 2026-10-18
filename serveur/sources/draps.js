// serveur/sources/draps.js
//
// Rôle    : les dates de changement des draps (demande du 14/10, README « Draps ») : trois lits,
//           une date chacun, gardées par le serveur du cadre dans draps.json (DOSSIER_ETAT, sauvegardé avec ~/cadre) et
//           poussées dans le flux sous « draps ». Rien dans Home Assistant.
// Entrées : new SourceDraps({ dossier, journal, maintenant }) : dossier de l'état local, horloge (millisecondes,
//           remplacée dans les tests) ; marquer(lit, quand) appelé par POST /api/draps/:lit (routes/draps.js).
// Sorties : SourceDraps (socle Source) : valeur = { timo, pablo, parents } (« AAAA-MM-JJ » du dernier changement, ou
//           null : pas encore noté), lue par actualiser() (une fois, au démarrage) ; marquer(lit, quand) -> promesse de
//           { lit, change_le } ; LITS (liste fermée) ; QUAND (aujourdhui, hier, avant-hier -> jours à retrancher).
// Pièges  :
//   - La date est TOUJOURS calculée ici, à l'heure de Paris (aujourd'hui, la veille ou l'avant-veille) : le cadre ne
//     donne jamais une date, seulement un mot de la liste QUAND. Son horloge peut être fausse, et une date libre
//     ouvrirait la porte à n'importe quoi dans le fichier.
//   - Liste fermée des lits : un autre nom est refusé (routes/draps.js répond 404) avant tout accès au fichier.
//   - Écritures mises en file, et chacune relit le fichier avant d'écrire : deux appuis rapprochés (deux lits l'un après
//     l'autre) ne se perdent pas, et un appui ne remet jamais à null les deux autres lits parce que la lecture du
//     démarrage avait échoué. Écriture atomique, validée par schéma à la relecture (etat-local.js).
//   - Fichier absent : aucun lit noté (premier démarrage) ; fichier abîmé ou non conforme : mis de côté
//     (draps.json.abime-..., etat-local.js), journalisé en erreur, repart de zéro ; erreur d'accès : la lecture échoue
//     (le socle Source réessaie, l'appui est refusé), rien n'est écrasé.
//   - Pas de cycle ni de rappel ici : la page calcule « il y a N jours » et l'échéance de 15 jours avec l'heure
//     corrigée (web/src/ecrans/draps-donnees.js).

import { ecrireAtomique, lireEtatLocal } from '../etat-local.js';
import { ajouterJours, dateParis } from '../heure-paris.js';
import { compilerValidateur, Source } from '../source.js';

export const LITS = Object.freeze(['timo', 'pablo', 'parents']);
export const QUAND = Object.freeze({ aujourdhui: 0, hier: 1, 'avant-hier': 2 });
const FICHIER = 'draps.json';

const valider = compilerValidateur({
  type: 'object',
  required: ['lits'],
  additionalProperties: false,
  properties: {
    lits: {
      type: 'object',
      required: LITS,
      additionalProperties: false,
      properties: Object.fromEntries(LITS.map((lit) => [lit, { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }])),
    },
  },
});

const aucunLit = () => Object.fromEntries(LITS.map((lit) => [lit, null]));

export class SourceDraps extends Source {
  #dossier;
  #maintenant;
  #ecritures = Promise.resolve();

  constructor({ dossier, journal, maintenant = Date.now }) {
    super('draps', journal);
    this.#dossier = dossier;
    this.#maintenant = maintenant;
  }

  async lire() {
    const lu = await lireEtatLocal(this.#dossier, FICHIER, { valider, journal: this.journal });
    return lu ? lu.lits : aucunLit();
  }

  async marquer(lit, quand) {
    const changeLe = ajouterJours(dateParis(this.#maintenant()), -QUAND[quand]);
    const tache = this.#ecritures.then(async () => {
      const lits = { ...(await this.lire()), [lit]: changeLe };
      await ecrireAtomique(this.#dossier, FICHIER, { lits });
      this.publier(lits);
    });
    this.#ecritures = tache.catch(() => {});
    await tache;
    return { lit, change_le: changeLe };
  }
}
