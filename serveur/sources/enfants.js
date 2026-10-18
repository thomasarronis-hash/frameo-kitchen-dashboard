// serveur/sources/enfants.js
//
// Rôle    : le tableau des enfants côté serveur (choix de Thomas du 14/10) : tient la journée en cours et le registre des
//           points, applique les règles (enfants/journee.js, enfants/registre.js), écrit les fichiers (enfants/stockage.js)
//           et pousse la valeur « enfants » dans le flux (enfants/projection.js). Rien dans Home Assistant.
// Entrées : new SourceEnfants({ dossier, bareme, journal, maintenant }) : dossier DOSSIER_ETAT/enfants, barème validé
//           (enfants/bareme.js), horloge en millisecondes (remplacée dans les tests). Méthodes appelées par
//           routes/enfants.js : cocher(enfant, etape, { parent }), annuler(enfant, etape, { parent }), decider(enfant, etape,
//           decision), donnerPoint(enfant, motif), donnerPointLibre(enfant), annulerPointLibre(enfant),
//           retirerPoint(enfant), demanderEchange(enfant, cadeau), deciderEchange(enfant, demande, decision),
//           piloterMinuteur(enfant, action), historique().
// Sorties : SourceEnfants (socle Source : valeur, événement 'maj', actualiser(), plus demarrer() et arreter()) ; chaque
//           méthode -> promesse du résultat de la règle (voir journee.js et registre.js), ou rejet ErreurEnfants (refus
//           voulu) ; historique() -> promesse de l'historique de 7 jours (projection.js).
// Pièges  :
//   - Toutes les lectures et écritures passent dans UNE file : deux touchers rapprochés (deux étapes, une étape et le
//     minuteur) partent chacun de l'état écrit par le précédent, et la bascule de journée ne se croise pas avec eux.
//   - L'état en mémoire ne change qu'APRÈS l'écriture réussie du fichier : un disque plein refuse l'action (erreur
//     interne) sans laisser la page croire qu'elle a compté.
//   - Pas de tâche planifiée à heure fixe : chaque action recale la journée sur l'heure de Paris (4 h à 4 h) ; en plus,
//     un seul minuteur (demarrer) se règle sur le prochain changement sans action (fin du minuteur d'écran, fin de la
//     routine du matin, minutes perdues, journée suivante) pour pousser la valeur à jour dans le flux. Attente bornée à setTimeout (24,8 jours).
//   - Bascule de journée : nouveau fichier vide, puis purge douce (journées et mouvements de plus de 90 jours ; un échec
//     de purge est journalisé et n'empêche rien, elle repasse le lendemain).
//   - Registre ou journée abîmés : mis de côté par stockage.js (jamais écrasés), puis registre vide ou journée vide ; une
//     erreur d'accès (droits, disque) fait échouer l'action sans rien remettre à zéro, la suivante relit.
//   - Un minuteur resté « en cours » dans un ancien fichier (serveur arrêté pendant qu'il tournait) est compté fini dans
//     l'historique, sans réécrire le fichier.

import { randomBytes } from 'node:crypto';
import * as regles from '../enfants/journee.js';
import * as points from '../enfants/registre.js';
import { historique, projeter } from '../enfants/projection.js';
import {
  ecrireJournee, ecrireRegistre, JOURS_GARDES, lireJournee, lireRegistre, purgerJournees,
} from '../enfants/stockage.js';
import { ajouterJours } from '../heure-paris.js';
import { Source } from '../source.js';

const ATTENTE_MAX_MS = 2 ** 31 - 1;
const JOURS_HISTORIQUE = 7;

export class SourceEnfants extends Source {
  #dossier;
  #bareme;
  #maintenant;
  #jour = null;
  #registre = null;
  #file = Promise.resolve();
  #prochain = null;
  #demarree = false;

  constructor({
    dossier, bareme, journal, maintenant = Date.now,
  }) {
    super('enfants', journal);
    this.#dossier = dossier;
    this.#bareme = bareme;
    this.#maintenant = maintenant;
  }

  // Socle Source : actualiser() publie ce que lire() renvoie (journée recalée, minuteur fini, minutes perdues).
  lire() {
    return this.#enFile(async () => {
      const maintenant = this.#maintenant();
      await this.#synchroniser(maintenant);
      this.#planifier(maintenant);
      return projeter({
        bareme: this.#bareme, jour: this.#jour, registre: this.#registre, maintenant,
      });
    });
  }

  demarrer() {
    this.#demarree = true;
    this.#planifier(this.#maintenant());
  }

  arreter() {
    super.arreter();
    this.#demarree = false;
    clearTimeout(this.#prochain);
  }

  cocher(enfant, etape, { parent }) {
    return this.#muter(({ jour, maintenant }) => regles.cocher(jour, this.#bareme, {
      enfant, etape, parent, maintenant,
    }));
  }

  annuler(enfant, etape, { parent = false } = {}) {
    return this.#muter(({ jour, maintenant }) => regles.annuler(jour, this.#bareme, {
      enfant, etape, parent, maintenant,
    }));
  }

  decider(enfant, etape, decision) {
    return this.#muter(({ jour, maintenant }) => regles.decider(jour, this.#bareme, {
      enfant, etape, decision, maintenant,
    }));
  }

  piloterMinuteur(enfant, action) {
    return this.#muter(({ jour, maintenant }) => regles.piloterMinuteur(jour, this.#bareme, { enfant, action, maintenant }));
  }

  donnerPoint(enfant, motif) {
    return this.#muter(({ registre, maintenant, journee }) => points.donnerPoint(registre, this.#bareme, {
      enfant, motif, maintenant, journee,
    }));
  }

  donnerPointLibre(enfant) {
    return this.#muter(({ registre, maintenant, journee }) => points.donnerPointLibre(registre, this.#bareme, {
      enfant, maintenant, journee,
    }));
  }

  annulerPointLibre(enfant) {
    return this.#muter(({ registre, maintenant, journee }) => points.annulerPointLibre(registre, this.#bareme, {
      enfant, maintenant, journee,
    }));
  }

  retirerPoint(enfant) {
    return this.#muter(({ registre, journee }) => points.retirerPoint(registre, this.#bareme, { enfant, journee }));
  }

  demanderEchange(enfant, cadeau) {
    return this.#muter(({ registre, maintenant }) => points.demanderEchange(registre, this.#bareme, {
      enfant, cadeau, maintenant, id: randomBytes(4).toString('hex'),
    }));
  }

  deciderEchange(enfant, demande, decision) {
    return this.#muter(({ registre, maintenant, journee }) => points.deciderEchange(registre, this.#bareme, {
      enfant, demande, decision, maintenant, journee,
    }));
  }

  historique() {
    return this.#enFile(async () => {
      const maintenant = this.#maintenant();
      await this.#synchroniser(maintenant);
      const dates = Array.from({ length: JOURS_HISTORIQUE }, (_, i) => ajouterJours(this.#jour.journee, i - (JOURS_HISTORIQUE - 1)));
      const jours = new Map();
      for (const date of dates) {
        const jour = date === this.#jour.journee ? this.#jour : await lireJournee(this.#dossier, date, this.journal);
        jours.set(date, jour && regles.finaliserMinuteurs(jour, maintenant));
      }
      return historique({
        bareme: this.#bareme, dates, jours, registre: this.#registre,
      });
    });
  }

  #enFile(tache) {
    const resultat = this.#file.then(tache);
    this.#file = resultat.catch(() => {});
    return resultat;
  }

  // Une action : état recalé, règle appliquée sur une copie, fichier écrit, puis seulement mémoire, flux et minuteur.
  #muter(operation) {
    return this.#enFile(async () => {
      const maintenant = this.#maintenant();
      await this.#synchroniser(maintenant);
      const { jour, registre, resultat } = operation({
        jour: this.#jour, registre: this.#registre, maintenant, journee: this.#jour.journee,
      });
      if (jour) {
        await ecrireJournee(this.#dossier, jour);
        this.#jour = jour;
      }
      if (registre) {
        await ecrireRegistre(this.#dossier, registre);
        this.#registre = registre;
      }
      this.publier(projeter({
        bareme: this.#bareme, jour: this.#jour, registre: this.#registre, maintenant,
      }));
      this.#planifier(maintenant);
      return resultat;
    });
  }

  async #synchroniser(maintenant) {
    if (!this.#registre) {
      const lu = await lireRegistre(this.#dossier, this.journal);
      this.#registre = points.completerRegistre(lu || points.registreVide(this.#bareme), this.#bareme);
    }
    const journee = regles.journeeDe(maintenant);
    if (!this.#jour || this.#jour.journee !== journee) {
      const lu = await lireJournee(this.#dossier, journee, this.journal);
      this.#jour = regles.completerJournee(lu || regles.journeeVide(journee, this.#bareme), this.#bareme);
      await this.#purger(journee);
    }
    const apresFin = regles.finaliserMinuteurs(this.#jour, maintenant);
    if (apresFin !== this.#jour) {
      await ecrireJournee(this.#dossier, apresFin);
      this.#jour = apresFin;
    }
  }

  async #purger(journee) {
    const limite = ajouterJours(journee, -(JOURS_GARDES - 1));
    await purgerJournees(this.#dossier, limite, this.journal);
    const purge = points.purgerRegistre(this.#registre, limite);
    if (purge === this.#registre) return;
    try {
      await ecrireRegistre(this.#dossier, purge);
      this.#registre = purge;
    } catch (err) {
      this.journal.warn(`enfants : purge du registre remise à demain (${err.message})`);
    }
  }

  #planifier(maintenant) {
    if (!this.#demarree || !this.#jour) return;
    clearTimeout(this.#prochain);
    const attente = Math.min(Math.max(0, regles.prochainEvenement(this.#jour, this.#bareme, maintenant) - maintenant), ATTENTE_MAX_MS);
    this.#prochain = setTimeout(() => this.actualiser(), attente);
    this.#prochain.unref();
  }
}
