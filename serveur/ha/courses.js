// serveur/ha/courses.js
//
// Rôle    : articles de la liste todo.shopping_list, lus par todo.get_items, et leur copie locale quand les
//           actions sont simulées (ACTIONS_REELLES absent ou différent de 1).
// Entrées : ConnexionHA (lire, événement 'prete', etat), SourceEntites (événement 'maj').
// Sorties : SourceCourses : valeur { articles: [{ uid, summary, status }] } dans l'ordre de HA (null avant la
//           première lecture ou simulation), événement 'maj' quand la liste change ;
//           simuler(service, donnees) applique un service todo.* à la copie locale SANS appeler HA
//           (serveur/ha/actions.js en simulation).
// Pièges  :
//   - status ["needs_action", "completed"] toujours passé : sans lui, HA ne renvoie que les articles à faire.
//   - Relu à chaque changement d'état de todo.shopping_list (nombre d'articles à faire) ET toutes les 60 s :
//     renommer un article ne change pas ce nombre, donc pas l'état.
//   - uid gardé : deux articles peuvent porter le même texte, l'uid est le seul identifiant stable.
//   - Simulation : les opérations simulées sont gardées jusqu'au redémarrage et rejouées sur chaque nouvelle
//     lecture de HA ; sans cela, la relecture de 60 s effacerait l'action et l'écran reviendrait en arrière.
//     Mais HA garde le dernier mot sur ce qui a changé APRÈS l'opération (un iPhone, lui, écrit pour de vrai) :
//       - « vider les cochés » est figé au moment du geste : ce sont les articles cochés À CET INSTANT qui sont
//         retirés au rejeu, pas ceux qu'un iPhone cochera plus tard ;
//       - une coche simulée retient le statut que HA donnait à l'article ; dès qu'une lecture de HA montre un
//         autre statut (coché ou décoché sur un iPhone), elle est abandonnée pour de bon ;
//       - une opération qui ne trouve plus son article (supprimé depuis l'iPhone) est ignorée.
//   - Comme HA, update_item et remove_item cherchent l'article par uid puis par texte ; introuvable, la
//     simulation lève une erreur, comme HA (ServiceValidationError).

import { randomUUID } from 'node:crypto';
import { compilerValidateur, Source } from '../source.js';

const ENTITE = 'todo.shopping_list';
const INTERVALLE_MS = 60_000;
const PREFIXE_UID_SIMULE = 'simulation-';

const validerReponse = compilerValidateur({
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['uid', 'summary', 'status'],
        properties: {
          uid: { type: 'string' },
          summary: { type: 'string' },
          status: { enum: ['needs_action', 'completed'] },
        },
      },
    },
  },
});

function indexArticle(articles, cle) {
  const parUid = articles.findIndex((article) => article.uid === cle);
  const index = parUid !== -1 ? parUid : articles.findIndex((article) => article.summary === cle);
  if (index === -1) throw new Error(`article introuvable dans la liste : ${cle}`);
  return index;
}

// Renvoie une nouvelle liste. Opération : { service, donnees, uid } (uid : celui d'un article ajouté), plus
// uidsRetires (vider les cochés, figé au geste) ou cible et statutHa (coche : uid visé et son statut dans HA au
// geste, null pour un article ajouté en simulation).
function appliquerService(articles, { service, donnees, uid, uidsRetires }) {
  switch (service) {
    case 'todo.add_item':
      return [...articles, { uid, summary: donnees.item, status: 'needs_action' }];
    case 'todo.update_item': {
      const index = indexArticle(articles, donnees.item);
      return articles.map((article, i) => (i === index ? { ...article, status: donnees.status } : article));
    }
    case 'todo.remove_item': {
      const index = indexArticle(articles, donnees.item);
      return articles.filter((_article, i) => i !== index);
    }
    case 'todo.remove_completed_items':
      return articles.filter((article) => !uidsRetires.includes(article.uid));
    default:
      throw new Error(`service non simulé : ${service}`);
  }
}

// Vrai si HA a changé l'article d'une coche simulée depuis le geste (la coche est alors abandonnée).
function depasseeParHa(operation, lus) {
  if (operation.service !== 'todo.update_item' || operation.statutHa === null) return false;
  const article = lus.find((candidat) => candidat.uid === operation.cible);
  return article !== undefined && article.status !== operation.statutHa;
}

export class SourceCourses extends Source {
  #connexion;
  #entites;
  #lus = [];
  #simulees = [];

  constructor(connexion, entites, journal) {
    super('courses', journal);
    this.#connexion = connexion;
    this.#entites = entites;
  }

  demarrer() {
    this.#connexion.on('prete', () => this.actualiser());
    this.#entites.on('maj', (fragment) => {
      if (ENTITE in fragment) this.actualiser();
    });
    this.repeter(INTERVALLE_MS, () => this.#connexion.etat === 'ok');
  }

  async lire() {
    const reponse = await this.#connexion.lire('todo.get_items', ENTITE, { status: ['needs_action', 'completed'] });
    this.#lus = validerReponse(reponse).items.map(({ uid, summary, status }) => ({ uid, summary, status }));
    this.#simulees = this.#simulees.filter((operation) => !depasseeParHa(operation, this.#lus));
    return { articles: this.#rejouer() };
  }

  simuler(service, donnees) {
    const avant = this.#rejouer();
    const operation = { service, donnees, uid: `${PREFIXE_UID_SIMULE}${randomUUID().slice(0, 8)}` };
    if (service === 'todo.remove_completed_items') {
      operation.uidsRetires = avant.filter((article) => article.status === 'completed').map((article) => article.uid);
    }
    if (service === 'todo.update_item') {
      operation.cible = avant[indexArticle(avant, donnees.item)].uid;
      const dansHa = this.#lus.find((article) => article.uid === operation.cible);
      operation.statutHa = dansHa ? dansHa.status : null;
    }
    const articles = appliquerService(avant, operation);
    this.#simulees.push(operation);
    this.publier({ articles });
  }

  #rejouer() {
    return this.#simulees.reduce((articles, operation) => {
      try {
        return appliquerService(articles, operation);
      } catch {
        return articles;
      }
    }, this.#lus);
  }
}
