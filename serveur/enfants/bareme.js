// serveur/enfants/bareme.js
//
// Rôle    : le barème du tableau des enfants (choix de Thomas du 14/10, README « Tableau des enfants »), lu dans
//           config/enfants.json (versionné dans le dépôt, copié dans l'image Docker) et validé au démarrage : schéma ajv,
//           puis les règles que le schéma ne sait pas dire. Un barème faux empêche le serveur de démarrer.
// Entrées : chargerBareme(chemin) (par défaut config/enfants.json) ; validerBareme(donnees) : le JSON déjà analysé.
// Sorties : chargerBareme -> le barème validé et gelé ; validerBareme -> le même, ou lève une Error dont le message
//           (en français) donne chaque écart ; CHEMIN_BAREME ; trouverEnfant(bareme, id) et trouverEtape(enfant, id) ->
//           l'objet ou undefined ; minutesDe(« 06:30 ») -> 390 ; HEURE_DEBUT_JOURNEE (4 : la journée va de 4 h à 4 h).
//           Forme du barème : { version: 1, depart: « 08:10 », fin_routine: « 09:00 », minutes_perdues: « 20:00 »,
//           enfants: [{ id, prenom, couleur
//           (nom d'un jeton de web/styles/jetons.css, sans les deux tirets), avatar (symbole de web/public/icones.svg : le
//           petit personnage dessiné de son tableau, partie 4), type: « minutes » | « etoiles », plafond (minutes
//           seulement), points (vrai : il gagne des points et a la boutique), etapes: [{ id, libelle, picto (symbole de
//           web/public/icones.svg), valeur (minutes ou étoiles), validation: « enfant » | « parent », apres? « HH:MM » }],
//           ensuite? { libelle, picto } }], points: { par_action, plafond_libre (points libres par jour, bouton « +1 »
//           sans mode parent), motifs: [{ id, libelle, picto }] }, boutique: [{ id, libelle, picto, prix }] }.
// Pièges  :
//   - Les valeurs de Thomas (minutes, validations, plafond de 32, prix 30/60/90, 1 point par action, 10 points libres par
//     jour) sont vérifiées par tests/enfants-bareme.test.js : changer le barème demande de changer le test, exprès.
//   - Validation « parent » : toujours possible au barème (étape en attente jusqu'à la validation), mais plus utilisée par
//     le barème de Thomas depuis le 14/10 en fin d'après-midi (tout en confiance, un parent corrige en mode parent).
//   - plafond_libre au plus 20 : le plafond de gains par enfant et par journée de registre.js (PLAFOND_POINTS_JOUR, borne
//     de la taille du registre), qui compte aussi les points libres. Écrit ici en dur (registre.js importe ce module) ;
//     tests/enfants-bareme.test.js vérifie que les deux bornes restent égales.
//   - Heures « HH:MM » à partir de 04:00 (début de la journée des enfants) : une heure de la nuit serait le lendemain
//     au calendrier, et le serveur ne compte qu'à l'intérieur d'une journée. Comparées en minutes, jamais en texte.
//   - Plafond au plus égal à la somme des étapes : sinon le maximum affiché ne serait jamais atteignable.
//   - fin_routine : l'heure où la routine du matin se referme (un enfant ne coche plus, les cases restantes passent en
//     gris, un parent corrige encore) ; entre le départ et l'heure des minutes perdues, après toute heure « apres ».
//     9 h, choix de Thomas du 14/10 (la case du matin de l'Accueil s'efface aussi à cette heure).
//   - Ajv à part de celui de source.js : les messages sont ceux d'une configuration (chemin du champ, en français),
//     pas ceux d'une réponse externe.

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

export const CHEMIN_BAREME = new URL('../../config/enfants.json', import.meta.url);
export const HEURE_DEBUT_JOURNEE = 4;

const HEURE = '^([01]\\d|2[0-3]):[0-5]\\d$';
const ID = '^[a-z][a-z0-9-]{0,23}$';
const PICTO = '^i-[a-z]+$';
const LIBELLE = { type: 'string', minLength: 1, maxLength: 24 };
const ETAPES_MAX = 7;
const PLAFOND_LIBRE_MAX = 20;

const image = {
  type: 'object',
  additionalProperties: false,
  required: ['libelle', 'picto'],
  properties: { libelle: LIBELLE, picto: { type: 'string', pattern: PICTO } },
};
const element = (proprietes, requis) => ({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'libelle', 'picto', ...requis],
  properties: { id: { type: 'string', pattern: ID }, ...image.properties, ...proprietes },
});

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'depart', 'fin_routine', 'minutes_perdues', 'enfants', 'points', 'boutique'],
  properties: {
    version: { const: 1 },
    depart: { type: 'string', pattern: HEURE },
    fin_routine: { type: 'string', pattern: HEURE },
    minutes_perdues: { type: 'string', pattern: HEURE },
    enfants: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'prenom', 'couleur', 'avatar', 'type', 'points', 'etapes'],
        properties: {
          id: { type: 'string', pattern: ID },
          prenom: { type: 'string', pattern: "^\\p{L}[\\p{L}' -]{0,19}$" },
          couleur: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' },
          avatar: { type: 'string', pattern: PICTO },
          type: { enum: ['minutes', 'etoiles'] },
          plafond: { type: 'integer', minimum: 1, maximum: 120 },
          points: { type: 'boolean' },
          etapes: {
            type: 'array',
            minItems: 1,
            maxItems: ETAPES_MAX,
            items: element({
              valeur: { type: 'integer', minimum: 1, maximum: 60 },
              validation: { enum: ['enfant', 'parent'] },
              apres: { type: 'string', pattern: HEURE },
            }, ['valeur', 'validation']),
          },
          ensuite: image,
        },
        if: { properties: { type: { const: 'minutes' } } },
        then: { required: ['plafond'] },
        else: { not: { required: ['plafond'] } },
      },
    },
    points: {
      type: 'object',
      additionalProperties: false,
      required: ['par_action', 'plafond_libre', 'motifs'],
      properties: {
        par_action: { type: 'integer', minimum: 1, maximum: 5 },
        plafond_libre: { type: 'integer', minimum: 1, maximum: PLAFOND_LIBRE_MAX },
        motifs: { type: 'array', maxItems: 6, items: element({}, []) },
      },
    },
    boutique: { type: 'array', maxItems: 10, items: element({ prix: { type: 'integer', minimum: 1, maximum: 999 } }, ['prix']) },
  },
};

const ajv = new Ajv2020({ allErrors: true, unicodeRegExp: true });
const validerSchema = ajv.compile(schema);

const TEXTES_AJV = {
  required: ({ missingProperty }) => `champ obligatoire manquant : ${missingProperty}`,
  additionalProperties: ({ additionalProperty }) => `champ inconnu : ${additionalProperty}`,
  pattern: () => 'forme inattendue',
  enum: ({ allowedValues }) => `valeur attendue parmi ${allowedValues.join(', ')}`,
  const: ({ allowedValue }) => `valeur attendue : ${allowedValue}`,
  type: ({ type }) => `type attendu : ${type}`,
  minimum: ({ limit }) => `au moins ${limit}`,
  maximum: ({ limit }) => `au plus ${limit}`,
  minItems: ({ limit }) => `au moins ${limit} élément(s)`,
  maxItems: ({ limit }) => `au plus ${limit} éléments`,
  minLength: ({ limit }) => `au moins ${limit} caractère(s)`,
  maxLength: ({ limit }) => `au plus ${limit} caractères`,
  not: () => 'plafond réservé au type minutes',
};

function traduire(erreur) {
  const texte = TEXTES_AJV[erreur.keyword];
  return `${erreur.instancePath || '/'} : ${texte ? texte(erreur.params) : erreur.message}`;
}

export function minutesDe(heure) {
  const [h, m] = heure.split(':').map(Number);
  return h * 60 + m;
}

function doublons(ids) {
  return ids.filter((id, i) => ids.indexOf(id) !== i);
}

// Règles que le schéma ne dit pas : identifiants uniques, plafond atteignable, heures dans la journée de 4 h à 4 h et
// dans l'ordre (apres < fin_routine, depart <= fin_routine < minutes_perdues).
function reglesHorsSchema(bareme) {
  const ecarts = [];
  const debut = HEURE_DEBUT_JOURNEE * 60;
  const perte = minutesDe(bareme.minutes_perdues);
  const verifierUniques = (ids, ou) => doublons(ids).forEach((id) => ecarts.push(`${ou} : identifiant « ${id} » répété`));
  verifierUniques(bareme.enfants.map((enfant) => enfant.id), '/enfants');
  verifierUniques(bareme.points.motifs.map((motif) => motif.id), '/points/motifs');
  verifierUniques(bareme.boutique.map((cadeau) => cadeau.id), '/boutique');
  if (perte <= debut) ecarts.push('/minutes_perdues : après 04:00 (la journée des enfants commence à 4 h)');
  if (minutesDe(bareme.depart) < debut) ecarts.push('/depart : à partir de 04:00');
  const finRoutine = minutesDe(bareme.fin_routine);
  if (finRoutine < minutesDe(bareme.depart) || finRoutine >= perte) {
    ecarts.push(`/fin_routine : entre le départ (${bareme.depart}) et l'heure des minutes perdues (${bareme.minutes_perdues})`);
  }
  bareme.enfants.forEach((enfant, i) => {
    verifierUniques(enfant.etapes.map((etape) => etape.id), `/enfants/${i}/etapes`);
    const somme = enfant.etapes.reduce((total, etape) => total + etape.valeur, 0);
    if (enfant.type === 'minutes' && enfant.plafond > somme) {
      ecarts.push(`/enfants/${i}/plafond : ${enfant.plafond} dépasse la somme des étapes (${somme}), jamais atteignable`);
    }
    enfant.etapes.forEach((etape, j) => {
      if (etape.apres && (minutesDe(etape.apres) < debut || minutesDe(etape.apres) >= finRoutine)) {
        ecarts.push(`/enfants/${i}/etapes/${j}/apres : entre 04:00 et la fin de la routine (${bareme.fin_routine})`);
      }
    });
  });
  if (bareme.boutique.length > 0 && !bareme.enfants.some((enfant) => enfant.points)) {
    ecarts.push('/boutique : aucun enfant n\'a de points pour y échanger');
  }
  return ecarts;
}

function geler(objet) {
  Object.values(objet).forEach((valeur) => {
    if (valeur && typeof valeur === 'object') geler(valeur);
  });
  return Object.freeze(objet);
}

export function validerBareme(donnees) {
  if (!validerSchema(donnees)) {
    throw new Error(`barème des enfants non conforme : ${validerSchema.errors.map(traduire).join(' ; ')}`);
  }
  const ecarts = reglesHorsSchema(donnees);
  if (ecarts.length > 0) throw new Error(`barème des enfants non conforme : ${ecarts.join(' ; ')}`);
  return geler(structuredClone(donnees));
}

export function chargerBareme(chemin = CHEMIN_BAREME) {
  let donnees;
  try {
    donnees = JSON.parse(readFileSync(chemin, 'utf8'));
  } catch (err) {
    throw new Error(`barème des enfants illisible (${chemin}) : ${err.code ?? err.message}`);
  }
  return validerBareme(donnees);
}

export const trouverEnfant = (bareme, id) => bareme.enfants.find((enfant) => enfant.id === id);
export const trouverEtape = (enfant, id) => enfant.etapes.find((etape) => etape.id === id);
