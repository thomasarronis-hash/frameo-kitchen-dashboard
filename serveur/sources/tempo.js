// serveur/sources/tempo.js
//
// Rôle    : la couleur EDF Tempo d'aujourd'hui et de demain, et les jours restants de la saison, pour le cadre (pastilles
//           de « La semaine », bandeau de la veille d'un rouge ou d'un blanc, liseré d'un jour rouge, alerte de la page
//           Aujourd'hui), sur le modèle d'open-meteo.js : lecture sans compte ni clé, validée, plafonnée, poussée dans
//           le flux sous « tempo ».
// Entrées : new SourceTempo({ dossier, journal, version, requete, maintenant }) : dossier de l'état local (DOSSIER_ETAT,
//           filet sur disque), version du serveur (User-Agent), requete = fetch (un faux dans les tests), maintenant()
//           -> millisecondes (l'horloge, remplacée dans les tests). Réponses JSON de RTE et de api-couleur-tempo.fr.
// Sorties : SourceTempo (socle Source) : valeur = { jours: [{ date, couleur: bleu | blanc | rouge, statut: provisoire |
//           confirme }] (le jour Tempo en cours et demain, seulement ceux dont la couleur est connue), restants: { rouge,
//           blanc, bleu } ou null, saison: « 2026-2027 » ou null, source: rte | api-couleur-tempo | disque | null, lu_le:
//           ISO 8601 de la lecture d'où viennent les couleurs, ou null } ; demarrer(), arreter() ; URL_RTE_JOURS,
//           urlRteSaison(saison), URL_REPLI, pour les tests.
// Pièges  :
//   - Source principale : le JSON public de RTE (tempoLight pour aujourd'hui et demain, tempo?season= pour la saison,
//     relue une fois par jour), URL non documentée par RTE : format validé strictement, un format inconnu fait passer
//     au repli. Repli : api-couleur-tempo.fr (jourTempo/today, tomorrow, stats), interrogé seulement si RTE échoue ;
//     il lit le même JSON de RTE, il couvre une panne d'accès, pas un changement de format.
//   - Réponse de RTE au bon format mais incomplète : un tempoLight sans la couleur de la date du jour (toujours publiée
//     depuis la veille) compte comme un échec, donc le repli est lu ; à partir de 10 h 45 (couleur de demain publiée
//     vers 10 h 30), si demain manque chez RTE, le repli est lu pour demain seulement (journalisé). Une saison qui compte
//     plus de 2 dates de moins que les jours déjà publiés (joursPublies) est refusée : les jours restants d'avant sont
//     gardés, jamais recalculés sur une saison vide (22 rouges en plein hiver). Filet local : la dernière
//     lecture valide est gardée dans tempo.json (DOSSIER_ETAT) et relue au démarrage (« disque »), et les règles fixes
//     de tempo-calendrier.js rejettent une couleur absurde (journalisée, jamais affichée).
//   - lire() ne lève jamais : un échec des deux sources garde les couleurs connues, et la lecture suivante a lieu au
//     plus tard 15 min après (au lieu des relances rapprochées du socle Source, qui martèleraient RTE toute la
//     journée). Le rythme normal est celui de prochaineLecture (une vingtaine de lectures par jour au plus).
//   - Pré-annonce ou confirmation : déduite de l'heure de lecture (statutCouleur, 10 h 40 la veille), la donnée ne le
//     dit pas. La clé « <date>-fallback » de RTE (mode dégradé, sens non documenté) est seulement journalisée.
//   - Jours restants : comptés sur la saison de RTE (demain compris dès qu'il est connu) ; avec le repli, /api/stats
//     ne compte pas demain : il est retiré ici s'il est connu et postérieur à son dernierJourInclus.
//   - User-Agent honnête (ASCII seulement : un en-tête HTTP n'accepte pas les accents), délai de 15 s, réponses lues
//     sous plafond (corps.js), aucune redirection suivie.
//   - Seules les couleurs du jour Tempo en cours et des suivants sont gardées (les autres sont retirées à chaque
//     lecture) : tempo.json reste minuscule.

import { ErreurTropGros, lireCorpsPlafonne } from '../corps.js';
import { ecrireAtomique, lireEtatLocal } from '../etat-local.js';
import { ajouterJours, dateParis, instantParis } from '../heure-paris.js';
import { compilerValidateur, Source } from '../source.js';
import {
  compterRestants, couleurPlausible, jourTempo, joursPublies, prochaineLecture, saisonDe, statutCouleur,
} from './tempo-calendrier.js';

const RTE = 'https://www.services-rte.com/cms/open_data/v1';
const REPLI = 'https://www.api-couleur-tempo.fr/api';
export const URL_RTE_JOURS = `${RTE}/tempoLight`;
export const urlRteSaison = (saison) => `${RTE}/tempo?season=${saison}`;
export const URL_REPLI = { aujourdhui: `${REPLI}/jourTempo/today`, demain: `${REPLI}/jourTempo/tomorrow`, stats: `${REPLI}/stats` };

const FICHIER = 'tempo.json';
const COULEURS_RTE = { BLUE: 'bleu', WHITE: 'blanc', RED: 'rouge' };
const COULEURS_REPLI = { 1: 'bleu', 2: 'blanc', 3: 'rouge' };
const DELAI_MS = 15_000;
const TAILLE_MAX_JOURS = 8 * 1024;
const TAILLE_MAX_SAISON = 128 * 1024;
const TAILLE_MAX_REPLI = 8 * 1024;
const RELANCE_APRES_ECHEC_MS = 15 * 60_000;
const RELECTURE_SAISON = [11, 15];
const PUBLICATION_DEMAIN = [10, 45];
const MANQUES_ADMIS = 2;

const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const COULEUR = { enum: ['bleu', 'blanc', 'rouge'] };
const RESTANT = { type: 'integer', minimum: 0, maximum: 366 };
const RESTANTS = {
  type: 'object', required: ['rouge', 'blanc', 'bleu'], additionalProperties: false, properties: { rouge: RESTANT, blanc: RESTANT, bleu: RESTANT },
};

const validerRte = compilerValidateur({
  type: 'object',
  required: ['values'],
  properties: {
    values: {
      type: 'object',
      maxProperties: 800,
      propertyNames: { pattern: '^\\d{4}-\\d{2}-\\d{2}(-fallback)?$' },
      patternProperties: { [DATE]: { enum: Object.keys(COULEURS_RTE) }, '-fallback$': { enum: ['true', 'false'] } },
    },
  },
});
const validerJourRepli = compilerValidateur({
  type: 'object',
  required: ['dateJour', 'codeJour'],
  properties: { dateJour: { type: 'string', pattern: DATE }, codeJour: { type: 'integer', minimum: 0, maximum: 3 } },
});
const validerStats = compilerValidateur({
  type: 'object',
  required: ['periode', 'dernierJourInclus', 'joursBleusRestants', 'joursBlancsRestants', 'joursRougesRestants'],
  properties: {
    periode: { type: 'string', pattern: '^\\d{4}-\\d{4}$' },
    dernierJourInclus: { type: 'string', pattern: DATE },
    joursBleusRestants: RESTANT,
    joursBlancsRestants: RESTANT,
    joursRougesRestants: RESTANT,
  },
});
const validerDisque = compilerValidateur({
  type: 'object',
  required: ['lu_le', 'source', 'couleurs', 'restants', 'saison'],
  additionalProperties: false,
  properties: {
    lu_le: { type: 'string', format: 'date-time' },
    source: { enum: ['rte', 'api-couleur-tempo'] },
    couleurs: {
      type: 'object',
      maxProperties: 10,
      propertyNames: { pattern: DATE },
      additionalProperties: {
        type: 'object', required: ['couleur', 'lu_le'], additionalProperties: false, properties: { couleur: COULEUR, lu_le: { type: 'string', format: 'date-time' } },
      },
    },
    restants: { anyOf: [{ type: 'null' }, RESTANTS] },
    saison: {
      anyOf: [{ type: 'null' }, {
        type: 'object',
        required: ['nom', 'lue_le'],
        additionalProperties: false,
        properties: { nom: { type: 'string', pattern: '^\\d{4}-\\d{4}$' }, lue_le: { type: 'string', format: 'date-time' } },
      }],
    },
  },
});

const iso = (ms) => new Date(ms).toISOString();

export class SourceTempo extends Source {
  #dossier;
  #requete;
  #maintenant;
  #entetes;
  #couleurs = new Map(); // date -> { couleur, luLe (ms) }
  #restants = null;
  #saison = null; // { nom, lueLe (ms) }
  #source = null;
  #luLe = null;
  #echec = false;
  #minuteur = null;
  #arretee = false;
  #signales = new Set();

  constructor({
    dossier, journal, version, requete = fetch, maintenant = Date.now,
  }) {
    super('tempo', journal);
    this.#dossier = dossier;
    this.#requete = requete;
    this.#maintenant = maintenant;
    this.#entetes = { accept: 'application/json', 'user-agent': `cadre-cuisine/${version} (ecran de cuisine familial ; une vingtaine de lectures par jour)` };
  }

  demarrer() {
    this.#charger().then(() => this.#lireEtPlanifier());
  }

  arreter() {
    super.arreter();
    this.#arretee = true;
    clearTimeout(this.#minuteur);
  }

  async lire() {
    const t = this.#maintenant();
    const enCours = jourTempo(t);
    const demain = ajouterJours(enCours, 1);
    const saison = saisonDe(demain);
    const saisonAJour = this.#saisonAJour(t, saison);
    let source = null;
    try {
      const jours = await this.#json(URL_RTE_JOURS, TAILLE_MAX_JOURS, validerRte);
      if (!(dateParis(t) in jours.values)) throw new Error(`aucune couleur pour le ${dateParis(t)}`);
      this.#integrerRte(jours, t);
      source = 'rte';
      if (!saisonAJour) await this.#lireSaisonRte(saison, t);
      if (!this.#couleurs.has(demain) && t >= instantParis(enCours, ...PUBLICATION_DEMAIN)) await this.#completerDemain(demain, t);
    } catch (errRte) {
      this.journal.warn(`Tempo : RTE illisible (${errRte.message}), repli sur api-couleur-tempo.fr`);
      try {
        await this.#lireRepli(t, saisonAJour ? null : { saison, demain });
        source = 'api-couleur-tempo';
      } catch (errRepli) {
        this.journal.warn(`Tempo : api-couleur-tempo.fr illisible aussi (${errRepli.message}) : couleurs connues gardées`);
      }
    }
    this.#echec = source === null;
    if (source !== null) {
      this.#source = source;
      this.#luLe = t;
      [...this.#couleurs.keys()].filter((date) => date < enCours).forEach((date) => this.#couleurs.delete(date));
      await this.#sauver();
    }
    return this.#vue(t);
  }

  async #json(url, tailleMax, valider) {
    const reponse = await this.#requete(url, { headers: this.#entetes, redirect: 'error', signal: AbortSignal.timeout(DELAI_MS) });
    if (!reponse.ok) {
      if (reponse.body) await reponse.body.cancel().catch(() => {});
      throw new Error(`HTTP ${reponse.status}`);
    }
    let octets;
    try {
      octets = await lireCorpsPlafonne(reponse, tailleMax);
    } catch (err) {
      throw err instanceof ErreurTropGros ? new Error('réponse trop grosse') : err;
    }
    return valider(JSON.parse(octets.toString('utf8')));
  }

  // Une couleur reçue : gardée si les règles fixes l'admettent, sinon journalisée une fois et ignorée.
  #accepter(date, couleur, quoi) {
    if (couleurPlausible(date, couleur)) return true;
    this.#signalerUneFois(`absurde ${date} ${couleur}`, `Tempo : ${couleur} le ${date} annoncé par ${quoi} est impossible (règles fixes) : ignoré`);
    return false;
  }

  #signalerUneFois(cle, message) {
    if (this.#signales.has(cle)) return;
    this.#signales.add(cle);
    this.journal.warn(message);
  }

  #retenir(date, couleur, t) {
    if (date >= jourTempo(t)) this.#couleurs.set(date, { couleur, luLe: t });
  }

  #integrerRte({ values }, t) {
    for (const [cle, valeur] of Object.entries(values)) {
      if (cle.endsWith('-fallback')) {
        if (valeur === 'true') this.#signalerUneFois(`secours ${cle}`, `Tempo : couleur du ${cle.slice(0, 10)} en mode secours chez RTE (fallback)`);
      } else if (this.#accepter(cle, COULEURS_RTE[valeur], 'RTE')) {
        this.#retenir(cle, COULEURS_RTE[valeur], t);
      }
    }
  }

  async #lireSaisonRte(saison, t) {
    try {
      const { values } = await this.#json(urlRteSaison(saison), TAILLE_MAX_SAISON, validerRte);
      const couleurs = Object.entries(values)
        .filter(([cle]) => !cle.endsWith('-fallback'))
        .map(([date, valeur]) => [date, COULEURS_RTE[valeur]])
        .filter(([date, couleur]) => this.#accepter(date, couleur, 'RTE (saison)'));
      const publies = joursPublies(saison, jourTempo(t));
      if (couleurs.length < publies - MANQUES_ADMIS) throw new Error(`incomplète (${couleurs.length} dates pour ${publies} jours publiés)`);
      this.#restants = compterRestants(couleurs, saison);
      this.#saison = { nom: saison, lueLe: t };
    } catch (err) {
      this.journal.warn(`Tempo : saison ${saison} illisible chez RTE (${err.message}) : jours restants d'avant gardés`);
    }
  }

  // Repli : aujourd'hui et demain (code 0 : pas encore connu) ; la saison seulement si elle est à relire, et son échec
  // n'efface pas les couleurs du jour déjà reçues.
  async #lireRepli(t, aRelire) {
    const jours = await Promise.all([URL_REPLI.aujourdhui, URL_REPLI.demain].map((url) => this.#json(url, TAILLE_MAX_REPLI, validerJourRepli)));
    for (const { dateJour, codeJour } of jours) {
      const couleur = COULEURS_REPLI[codeJour];
      if (couleur && this.#accepter(dateJour, couleur, 'api-couleur-tempo.fr')) this.#retenir(dateJour, couleur, t);
    }
    if (!aRelire) return;
    try {
      this.#restants = this.#restantsRepli(await this.#json(URL_REPLI.stats, TAILLE_MAX_REPLI, validerStats), aRelire);
      this.#saison = { nom: aRelire.saison, lueLe: t };
    } catch (err) {
      this.journal.warn(`Tempo : jours restants illisibles chez api-couleur-tempo.fr (${err.message}) : ceux d'avant gardés`);
    }
  }

  // RTE complet sauf demain, après sa publication : demain seulement, chez le repli ; un échec ne change rien.
  async #completerDemain(demain, t) {
    try {
      const { dateJour, codeJour } = await this.#json(URL_REPLI.demain, TAILLE_MAX_REPLI, validerJourRepli);
      const couleur = COULEURS_REPLI[codeJour];
      if (dateJour !== demain || !couleur || !this.#accepter(dateJour, couleur, 'api-couleur-tempo.fr')) return;
      this.#retenir(dateJour, couleur, t);
      this.#signalerUneFois(`demain repli ${demain}`, `Tempo : couleur du ${demain} absente chez RTE, lue chez api-couleur-tempo.fr`);
    } catch (err) {
      this.journal.warn(`Tempo : demain absent chez RTE et illisible chez api-couleur-tempo.fr (${err.message})`);
    }
  }

  // /api/stats ne compte pas demain : retiré ici s'il est connu ; une autre saison (31 août) repart des totaux.
  #restantsRepli(stats, { saison, demain }) {
    const connu = this.#couleurs.get(demain);
    if (stats.periode !== saison) return compterRestants(connu ? [[demain, connu.couleur]] : [], saison);
    const restants = { rouge: stats.joursRougesRestants, blanc: stats.joursBlancsRestants, bleu: stats.joursBleusRestants };
    if (connu && demain > stats.dernierJourInclus) restants[connu.couleur] = Math.max(0, restants[connu.couleur] - 1);
    return restants;
  }

  // La saison est relue au démarrage, au changement de saison, puis une fois par jour à partir de 11 h 15.
  #saisonAJour(t, saison) {
    if (!this.#saison || this.#saison.nom !== saison || this.#restants === null) return false;
    const relecture = instantParis(dateParis(t), ...RELECTURE_SAISON);
    return t < relecture || this.#saison.lueLe >= relecture;
  }

  #vue(t) {
    const enCours = jourTempo(t);
    return {
      jours: [enCours, ajouterJours(enCours, 1)]
        .filter((date) => this.#couleurs.has(date))
        .map((date) => ({ date, couleur: this.#couleurs.get(date).couleur, statut: statutCouleur(date, this.#couleurs.get(date).luLe) })),
      restants: this.#restants,
      saison: this.#saison ? this.#saison.nom : null,
      source: this.#source,
      lu_le: this.#luLe === null ? null : iso(this.#luLe),
    };
  }

  async #sauver() {
    const couleurs = {};
    for (const date of [...this.#couleurs.keys()].sort()) couleurs[date] = { couleur: this.#couleurs.get(date).couleur, lu_le: iso(this.#couleurs.get(date).luLe) };
    const donnees = {
      lu_le: iso(this.#luLe),
      source: this.#source,
      couleurs,
      restants: this.#restants,
      saison: this.#saison ? { nom: this.#saison.nom, lue_le: iso(this.#saison.lueLe) } : null,
    };
    try {
      await ecrireAtomique(this.#dossier, FICHIER, donnees);
    } catch (err) {
      this.journal.warn(`Tempo : ${FICHIER} pas écrit (${err.message}) : le filet sur disque garde la lecture d'avant`);
    }
  }

  async #charger() {
    let lu;
    try {
      lu = await lireEtatLocal(this.#dossier, FICHIER, { valider: validerDisque, journal: this.journal });
    } catch (err) {
      this.journal.warn(`Tempo : ${FICHIER} pas relu (${err.code ?? err.message}) : départ sans filet`);
      return;
    }
    if (!lu) return;
    for (const [date, { couleur, lu_le: luLe }] of Object.entries(lu.couleurs)) this.#couleurs.set(date, { couleur, luLe: Date.parse(luLe) });
    this.#restants = lu.restants;
    this.#saison = lu.saison ? { nom: lu.saison.nom, lueLe: Date.parse(lu.saison.lue_le) } : null;
    this.#source = 'disque';
    this.#luLe = Date.parse(lu.lu_le);
    this.publier(this.#vue(this.#maintenant()));
  }

  #lireEtPlanifier() {
    this.actualiser().then(() => this.#planifier());
  }

  #planifier() {
    if (this.#arretee) return;
    const t = this.#maintenant();
    const demainConnu = this.#couleurs.has(ajouterJours(jourTempo(t), 1));
    const prevue = prochaineLecture(t, demainConnu);
    const quand = this.#echec ? Math.min(prevue, t + RELANCE_APRES_ECHEC_MS) : prevue;
    clearTimeout(this.#minuteur);
    this.#minuteur = setTimeout(() => this.#lireEtPlanifier(), quand - t);
    this.#minuteur.unref();
  }
}
