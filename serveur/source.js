// serveur/source.js
//
// Rôle    : socle commun des sources du flux (prévisions, courses, air, pluie, semaine) : valeur courante,
//           événement « maj » seulement quand la valeur change, relecture périodique sans chevauchement,
//           relectures rapprochées après un échec, et validation par schéma de toute donnée externe.
// Entrées : une sous-classe qui définit nom et lire() (renvoie la nouvelle valeur projetée, ou lève).
// Sorties : classe Source (valeur, événement 'maj', actualiser(), repeter(), arreter(), publier()) ;
//           publier(valeur) sert aux sous-classes qui calculent une valeur hors de lire() (simulation des
//           courses : aucun appel à HA) ; même règle, maj seulement si la valeur change ;
//           compilerValidateur(schema) -> fonction qui renvoie la donnée si elle est conforme, sinon lève ;
//           REPRISES_MS, les attentes avant chaque nouvel essai (reprises par les tests).
// Pièges  :
//   - Un échec de lecture garde la dernière valeur (le cadre continue d'afficher l'ancienne) et se journalise.
//   - Après un échec, nouvel essai dans 30 s, puis 1, 2 et 5 min (jamais plus loin que l'intervalle
//     normal), jusqu'au premier succès. Sans cela, une source tombée au démarrage (Internet ou HA pas
//     encore revenus après une coupure de courant) resterait vide jusqu'à 1 h. Le nouvel essai respecte
//     la même condition que la relecture périodique (HA connecté) : sinon, c'est la reconnexion qui relit.
//   - Deux demandes rapprochées (minuterie + changement d'état) ne lancent pas deux lectures en parallèle :
//     la seconde est rejouée une seule fois après la première.
//   - La comparaison se fait sur le JSON : l'ordre des clés doit être stable, ce que garantissent
//     les projections écrites champ par champ.
//   - ajv en draft 2020-12 (ajv/dist/2020), indépendant du validateur interne de Fastify.

import { EventEmitter } from 'node:events';
import Ajv2020 from 'ajv/dist/2020.js';
import ajouterFormats from 'ajv-formats';

const ajv = new Ajv2020({ allowUnionTypes: true });
ajouterFormats(ajv, ['date-time']);

export const REPRISES_MS = [30_000, 60_000, 120_000, 300_000];

export function compilerValidateur(schema) {
  const valider = ajv.compile(schema);
  return (donnees) => {
    if (!valider(donnees)) throw new Error(`réponse inattendue : ${ajv.errorsText(valider.errors)}`);
    return donnees;
  };
}

export class Source extends EventEmitter {
  #valeur = null;
  #empreinte = 'null';
  #enCours = null;
  #aRejouer = false;
  #intervalleMs = Infinity;
  #condition = () => true;
  #minuteur = null;
  #reprise = null;
  #echecs = 0;
  #arretee = false;

  constructor(nom, journal) {
    super();
    this.nom = nom;
    this.journal = journal;
  }

  get valeur() {
    return this.#valeur;
  }

  // Appelle this.lire(), défini par la sous-classe, et publie le résultat s'il a changé.
  actualiser() {
    if (this.#enCours) {
      this.#aRejouer = true;
      return this.#enCours;
    }
    this.#enCours = (async () => {
      let erreur;
      do {
        this.#aRejouer = false;
        try {
          this.publier(await this.lire());
          erreur = null;
        } catch (err) {
          erreur = err;
        }
      } while (this.#aRejouer);
      this.#suivreIssue(erreur);
    })().finally(() => {
      this.#enCours = null;
    });
    return this.#enCours;
  }

  // Relit toutes les intervalleMs, seulement si condition() est vraie (HA connecté, par exemple).
  repeter(intervalleMs, condition = () => true) {
    this.#intervalleMs = intervalleMs;
    this.#condition = condition;
    this.#minuteur = setInterval(() => {
      if (condition()) this.actualiser();
    }, intervalleMs);
    this.#minuteur.unref();
  }

  arreter() {
    this.#arretee = true;
    clearInterval(this.#minuteur);
    clearTimeout(this.#reprise);
  }

  // Succès : on revient au seul rythme normal. Échec : nouvel essai rapproché, de plus en plus espacé.
  #suivreIssue(erreur) {
    clearTimeout(this.#reprise);
    this.#reprise = null;
    if (!erreur) {
      this.#echecs = 0;
      return;
    }
    const attenteMs = Math.min(REPRISES_MS[Math.min(this.#echecs, REPRISES_MS.length - 1)], this.#intervalleMs);
    this.#echecs += 1;
    this.journal.warn(`${this.nom} : lecture échouée, dernière valeur gardée, nouvel essai dans ${attenteMs / 1000} s (${erreur?.message ?? erreur})`);
    if (this.#arretee) return;
    this.#reprise = setTimeout(() => {
      if (this.#condition()) this.actualiser();
    }, attenteMs);
    this.#reprise.unref();
  }

  publier(valeur) {
    const empreinte = JSON.stringify(valeur);
    if (empreinte === this.#empreinte) return;
    this.#empreinte = empreinte;
    this.#valeur = valeur;
    this.emit('maj', valeur);
  }
}
