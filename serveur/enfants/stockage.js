// serveur/enfants/stockage.js
//
// Rôle    : les fichiers du tableau des enfants dans DOSSIER_ETAT/enfants (data/etat/enfants en développement,
//           ~/cadre/data/etat/enfants sur le M900, sauvegardé avec ~/cadre) : une journée par fichier et le registre des
//           points. Schémas ajv, écriture atomique, plafonds, purge des journées de plus de 90 jours. Rien dans HA.
// Entrées : le dossier enfants/ ; une journée « AAAA-MM-JJ » ; un journal (warn, info) ; les objets décrits dans
//           journee.js (journée) et registre.js (registre).
// Sorties : lireJournee(dossier, journee, journal) et lireRegistre(dossier, journal) -> promesse de l'objet validé ou null
//           (absent ; ou trop gros, abîmé, non conforme, d'une autre journée : mis de côté sous « <nom>.abime-<horodatage> »
//           et journalisé en erreur, etat-local.js), rejet sur une erreur d'accès (rien n'est remis à zéro) ; ecrireJournee(dossier, jour) et
//           ecrireRegistre(dossier, registre) -> promesse (lèvent si l'objet n'est pas conforme ou dépasse son plafond) ;
//           purgerJournees(dossier, limite, journal) -> promesse du nombre de fichiers retirés (journées avant limite) ;
//           JOURS_GARDES (90), TAILLE_MAX_REGISTRE.
// Pièges  :
//   - Validé à la lecture ET à l'écriture : le serveur n'écrit jamais ce qu'il ne saurait pas relire.
//   - Plafonds : 16 Ko par journée (deux enfants, sept étapes chacun, tiennent en 2 Ko), 256 Ko pour le registre (90 jours
//     à 20 gains par jour, le maximum de registre.js points libres compris, font environ 220 Ko quand ce sont tous des
//     points libres, marqués « libre »), vérifiés avant de lire (etat-local.js).
//   - Champs facultatifs du registre (ajoutés le 14/10 en fin d'après-midi) : « libre » sur un gain (point du bouton +1,
//     toujours vrai quand il est là) et « annulations » (par enfant, le « le » du dernier point libre annulé).
//     Un registre écrit avant les relit sans rien changer ; un « libre » qui ne vaut pas vrai le rend non conforme.
//   - Une journée dont le champ journee ne correspond pas au nom du fichier est mise de côté (copie à la main, horloge
//     fausse) : on ne mélange pas deux jours, et la prochaine écriture ne l'écrase pas.
//   - Un registre abîmé n'est JAMAIS écrasé : il est renommé avant que le serveur reparte d'un registre vide (sinon la
//     première action effaçait tous les points). Le récupérer : README, « Fichier d'état abîmé ».
//   - Purge douce : seuls les fichiers au nom exact « AAAA-MM-JJ.json » d'avant la limite sont retirés, un par un ; un
//     échec est journalisé et la purge continue (elle repasse à la journée suivante). Les points ne sont jamais
//     effacés : registre.js replie les vieux mouvements dans reports avant l'écriture.
//   - Les fichiers ne contiennent que ce qui sert : identifiants du barème, heures, valeurs. Aucun prénom, aucun motif
//     libre.

import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ecrireAtomique, lireEtatLocal, mettreDeCote } from '../etat-local.js';
import { compilerValidateur } from '../source.js';

export const JOURS_GARDES = 90;
export const TAILLE_MAX_REGISTRE = 256 * 1024;
const DOSSIER_JOURNEES = 'journees';
const FICHIER_REGISTRE = 'registre.json';
const NOM_JOURNEE = /^(\d{4}-\d{2}-\d{2})\.json$/;

const ID = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,23}$' };
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const INSTANT = { type: 'string', format: 'date-time' };
const SECONDES = { type: 'integer', minimum: 0, maximum: 86_400 };
const objet = (proprietes, requis = Object.keys(proprietes)) => ({
  type: 'object', additionalProperties: false, required: requis, properties: proprietes,
});

const validerJournee = compilerValidateur(objet({
  version: { const: 1 },
  journee: DATE,
  enfants: {
    type: 'object',
    maxProperties: 4,
    propertyNames: ID,
    additionalProperties: {
      ...objet({
        etapes: {
          type: 'object',
          maxProperties: 7,
          propertyNames: ID,
          additionalProperties: objet({
            statut: { enum: ['valide', 'attente'] },
            par: { enum: ['enfant', 'parent'] },
            coche_le: INSTANT,
            valide_le: { anyOf: [INSTANT, { type: 'null' }] },
            valeur: { type: 'integer', minimum: 1, maximum: 60 },
          }),
        },
        gagnees: { type: 'integer', minimum: 0, maximum: 420 },
        utilisees_s: SECONDES,
        minuteur: {
          anyOf: [
            { type: 'null' },
            objet({ etat: { const: 'en_cours' }, debut: INSTANT, duree_s: SECONDES }),
            objet({ etat: { const: 'pause' } }),
            objet({ etat: { const: 'termine' }, fin_le: INSTANT }),
          ],
        },
      }, ['etapes', 'gagnees']),
      dependentRequired: { utilisees_s: ['minuteur'], minuteur: ['utilisees_s'] },
    },
  },
}));

const validerRegistre = compilerValidateur(objet({
  version: { const: 1 },
  reports: {
    type: 'object', maxProperties: 4, propertyNames: ID, additionalProperties: { type: 'integer', minimum: 0 },
  },
  mouvements: {
    type: 'array',
    maxItems: 8_000,
    items: {
      anyOf: [
        objet({
          enfant: ID, type: { const: 'gain' }, points: { type: 'integer', minimum: 1, maximum: 5 }, motif: { anyOf: [ID, { type: 'null' }] }, libre: { const: true }, le: INSTANT, journee: DATE,
        }, ['enfant', 'type', 'points', 'motif', 'le', 'journee']),
        objet({
          enfant: ID, type: { const: 'echange' }, points: { type: 'integer', minimum: 1, maximum: 999 }, cadeau: ID, le: INSTANT, journee: DATE,
        }),
      ],
    },
  },
  demandes: {
    type: 'array',
    maxItems: 4,
    items: objet({
      id: { type: 'string', pattern: '^[0-9a-f]{8}$' }, enfant: ID, cadeau: ID, prix: { type: 'integer', minimum: 1, maximum: 999 }, le: INSTANT,
    }),
  },
  annulations: {
    type: 'object', maxProperties: 4, propertyNames: ID, additionalProperties: INSTANT,
  },
}, ['version', 'reports', 'mouvements', 'demandes']));

const dossierJournees = (dossier) => join(dossier, DOSSIER_JOURNEES);

export async function lireJournee(dossier, journee, journal) {
  const nom = `${journee}.json`;
  const jour = await lireEtatLocal(dossierJournees(dossier), nom, { valider: validerJournee, journal });
  if (jour && jour.journee !== journee) {
    await mettreDeCote(dossierJournees(dossier), nom, `contient la journée ${jour.journee}`, journal);
    return null;
  }
  return jour;
}

export async function ecrireJournee(dossier, jour) {
  await ecrireAtomique(dossierJournees(dossier), `${jour.journee}.json`, validerJournee(jour));
}

export async function lireRegistre(dossier, journal) {
  return lireEtatLocal(dossier, FICHIER_REGISTRE, { valider: validerRegistre, journal, tailleMax: TAILLE_MAX_REGISTRE });
}

export async function ecrireRegistre(dossier, registre) {
  await ecrireAtomique(dossier, FICHIER_REGISTRE, validerRegistre(registre), { tailleMax: TAILLE_MAX_REGISTRE });
}

export async function purgerJournees(dossier, limite, journal) {
  let noms;
  try {
    noms = await readdir(dossierJournees(dossier));
  } catch (err) {
    if (err.code !== 'ENOENT') journal.warn(`enfants : purge impossible (${err.code ?? err.message})`);
    return 0;
  }
  let retires = 0;
  for (const nom of noms) {
    const date = NOM_JOURNEE.exec(nom)?.[1];
    if (date && date < limite) {
      try {
        await rm(join(dossierJournees(dossier), nom));
        retires += 1;
      } catch (err) {
        journal.warn(`enfants : ${nom} pas retiré (${err.code ?? err.message})`);
      }
    }
  }
  if (retires > 0) journal.info(`enfants : ${retires} journée(s) de plus de ${JOURS_GARDES} jours retirée(s)`);
  return retires;
}
