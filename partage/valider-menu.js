// partage/valider-menu.js
//
// Rôle    : LE validateur du menu de la semaine, partagé par le serveur (serveur/sources/menus.js) et par
//           outils/cadre.mjs : le schéma partage/schema-menu-v1.json (ajv, draft 2020-12, formats date et
//           date-time), puis les règles que le schéma ne sait pas exprimer.
// Entrées : validerMenu(donnees) : le JSON déjà analysé (n'importe quelle valeur).
// Sorties : validerMenu -> { valide, erreurs: [textes en français] }, sans jamais lever pour un menu faux ;
//           creneauxAttendus(debut) -> les 9 ids du cycle dans l'ordre (repris par les tests).
// Règles hors schéma :
//   - cycle : debut est un samedi, fin le vendredi qui suit ;
//   - exactement les 9 créneaux, dans l'ordre : samedi midi et soir, dimanche midi et soir, soirs du lundi au
//     vendredi, sur les dates du cycle ; id = <date>-<creneau>, ids uniques ;
//   - gamelles seulement là où /menu les prévoit (un repas du dimanche, soirs du lundi au jeudi), pour = le
//     lendemain, un seul repas par jour de gamelles (l'écran en déduit le midi de semaine) ;
//   - minuteur : duree_max_s >= duree_s ;
//   - rappels : date dans le cycle, repas_id existant.
// Pièges  :
//   - Dates calculées en UTC à partir de « AAAA-MM-JJ » : aucun fuseau, aucun changement d'heure en jeu.
//   - Les règles du cycle et des créneaux tournent même quand le schéma échoue (8 repas au lieu de 9), pour
//     dire LEQUEL manque ; les autres ne tournent que sur un menu conforme au schéma.
//   - Messages d'ajv traduits ici (ajv-i18n n'est pas installé) ; un mot-clé non prévu garde le message d'ajv.

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import ajouterFormats from 'ajv-formats';

const schema = JSON.parse(readFileSync(new URL('./schema-menu-v1.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
ajouterFormats(ajv, ['date', 'date-time']);
const validerSchema = ajv.compile(schema);

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const SAMEDI = 6;
const JOUR_MS = 86_400_000;

const versDate = (texte) => new Date(`${texte}T00:00:00Z`);
const decaler = (texte, jours) => new Date(versDate(texte).getTime() + jours * JOUR_MS).toISOString().slice(0, 10);
const jourSemaine = (texte) => versDate(texte).getUTCDay();
// Le 30 février passe Date (2 mars) : seule une date qui se relit à l'identique est une vraie date.
const estDate = (texte) => typeof texte === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(texte)
  && !Number.isNaN(versDate(texte).getTime()) && versDate(texte).toISOString().slice(0, 10) === texte;

// « mardi 13/10 soir (2026-10-13-soir) »
function nommer(id) {
  const date = id.slice(0, 10);
  return `${JOURS[jourSemaine(date)]} ${date.slice(8, 10)}/${date.slice(5, 7)} ${id.slice(11)} (${id})`;
}

export function creneauxAttendus(debut) {
  const ids = [];
  for (let jour = 0; jour < 7; jour += 1) {
    const date = decaler(debut, jour);
    if (jour < 2) ids.push(`${date}-midi`);
    ids.push(`${date}-soir`);
  }
  return ids;
}

const TEXTES_AJV = {
  required: ({ missingProperty }) => `champ obligatoire manquant : ${missingProperty}`,
  additionalProperties: ({ additionalProperty }) => `champ non prévu : ${additionalProperty}`,
  type: ({ type }) => `type attendu : ${type}`,
  enum: ({ allowedValues }) => `valeur attendue parmi ${allowedValues.map((v) => JSON.stringify(v)).join(', ')}`,
  const: ({ allowedValue }) => `valeur attendue : ${JSON.stringify(allowedValue)}`,
  format: ({ format }) => `format attendu : ${format}`,
  pattern: ({ pattern }) => `forme attendue : ${pattern}`,
  minItems: ({ limit }) => `au moins ${limit} éléments`,
  maxItems: ({ limit }) => `au plus ${limit} éléments`,
  minLength: ({ limit }) => (limit === 1 ? 'texte vide' : `au moins ${limit} caractères`),
  maxLength: ({ limit }) => `au plus ${limit} caractères`,
  minimum: ({ limit }) => `au moins ${limit}`,
  maximum: ({ limit }) => `au plus ${limit}`,
  uniqueItems: ({ i, j }) => `éléments ${j} et ${i} en double`,
};

function decrireErreurSchema({ instancePath, keyword, params, message }) {
  const ou = instancePath === '' ? 'menu' : instancePath.slice(1).replace(/\//g, '.');
  return `${ou} : ${TEXTES_AJV[keyword] ? TEXTES_AJV[keyword](params) : message}`;
}

function reglesCycle({ debut, fin }) {
  const erreurs = [];
  if (jourSemaine(debut) !== SAMEDI) erreurs.push(`cycle.debut : ${debut} est un ${JOURS[jourSemaine(debut)]}, un samedi est attendu`);
  if (fin !== decaler(debut, 6)) erreurs.push(`cycle.fin : ${decaler(debut, 6)} attendu (le vendredi qui suit le début), ${fin} reçu`);
  return erreurs;
}

// Tolérante : ne suppose qu'un tableau ; un repas sans date ni créneau compte comme créneau inattendu.
function reglesCreneaux(debut, repas) {
  const attendus = creneauxAttendus(debut);
  const recus = repas.map((r) => `${r && r.date}-${r && r.creneau}`);
  const erreurs = [];
  for (const id of attendus) {
    if (!recus.includes(id)) erreurs.push(`repas : créneau manquant, ${nommer(id)}`);
  }
  recus.forEach((id, i) => {
    if (!attendus.includes(id)) {
      erreurs.push(`repas.${i} : créneau inattendu (${id}) : seuls samedi et dimanche midi et soir, et les soirs du lundi au vendredi du cycle`);
    } else if (recus.indexOf(id) !== i) {
      erreurs.push(`repas.${i} : créneau en double, ${nommer(id)}`);
    }
  });
  if (erreurs.length === 0 && recus.some((id, i) => id !== attendus[i])) {
    erreurs.push('repas : ordre attendu, du samedi midi au vendredi soir');
  }
  return erreurs;
}

function reglesIds(repas) {
  const erreurs = [];
  const vus = new Set();
  repas.forEach((r, i) => {
    if (r.id !== `${r.date}-${r.creneau}`) erreurs.push(`repas.${i}.id : ${r.date}-${r.creneau} attendu (date-créneau), ${r.id} reçu`);
    if (vus.has(r.id)) erreurs.push(`repas.${i}.id : id en double (${r.id})`);
    vus.add(r.id);
  });
  return erreurs;
}

function reglesGamelles(debut, repas) {
  const dimanche = decaler(debut, 1);
  const permis = new Set([`${dimanche}-midi`, `${dimanche}-soir`, ...[2, 3, 4, 5].map((jour) => `${decaler(debut, jour)}-soir`)]);
  const parJour = new Map();
  const erreurs = [];
  for (const r of repas) {
    if (r.gamelles === null) continue;
    if (!permis.has(r.id)) {
      erreurs.push(`repas ${nommer(r.id)} : gamelles interdites, seulement sur un repas du dimanche et les soirs du lundi au jeudi`);
      continue;
    }
    const lendemain = decaler(r.date, 1);
    if (r.gamelles.pour !== lendemain) {
      erreurs.push(`repas ${r.id} : gamelles.pour doit être le lendemain (${lendemain}), ${r.gamelles.pour} reçu`);
    } else if (parJour.has(lendemain)) {
      erreurs.push(`repas ${r.id} : les gamelles du ${lendemain} viennent déjà de ${parJour.get(lendemain)}`);
    } else {
      parJour.set(lendemain, r.id);
    }
  }
  return erreurs;
}

function reglesMinuteurs(repas) {
  const erreurs = [];
  for (const r of repas) {
    if (r.recette === null) continue;
    r.recette.etapes.forEach(({ minuteur }, i) => {
      if (minuteur && minuteur.duree_max_s !== undefined && minuteur.duree_max_s < minuteur.duree_s) {
        erreurs.push(`repas ${r.id}, étape ${i + 1} : minuteur « ${minuteur.libelle} », duree_max_s (${minuteur.duree_max_s}) inférieure à duree_s (${minuteur.duree_s})`);
      }
    });
  }
  return erreurs;
}

function reglesRappels({ debut, fin }, repas, rappels) {
  const ids = new Set(repas.map((r) => r.id));
  const erreurs = [];
  rappels.forEach((rappel, i) => {
    if (rappel.date < debut || rappel.date > fin) erreurs.push(`rappels.${i} : ${rappel.date} hors du cycle (${debut} au ${fin})`);
    if (rappel.repas_id !== undefined && !ids.has(rappel.repas_id)) erreurs.push(`rappels.${i} : repas_id inconnu (${rappel.repas_id})`);
  });
  return erreurs;
}

export function validerMenu(donnees) {
  const erreurs = validerSchema(donnees) ? [] : validerSchema.errors.map(decrireErreurSchema);
  const { cycle, repas } = donnees !== null && typeof donnees === 'object' ? donnees : {};
  if (cycle && estDate(cycle.debut)) {
    const erreursCycle = reglesCycle(cycle);
    erreurs.push(...erreursCycle);
    if (erreursCycle.length === 0 && Array.isArray(repas)) erreurs.push(...reglesCreneaux(cycle.debut, repas));
  }
  if (erreurs.length === 0) {
    erreurs.push(
      ...reglesIds(repas),
      ...reglesGamelles(cycle.debut, repas),
      ...reglesMinuteurs(repas),
      ...reglesRappels(cycle, repas, donnees.rappels || []),
    );
  }
  return { valide: erreurs.length === 0, erreurs };
}
