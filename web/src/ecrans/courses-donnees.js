// web/src/ecrans/courses-donnees.js
//
// Rôle    : la liste de courses vue par l'écran Courses, sans DOM : tri (à faire d'abord, cochés ensuite), et
//           mise à jour OPTIMISTE (le geste se voit tout de suite) puis réconciliation avec la liste du serveur.
// Entrées : creerCoursesLocales({ monotone }) ; recevoir(courses) à chaque liste reçue du flux ({ articles:
//           [{ uid, summary, status }] } ou null) ; les opérations demandées par l'écran.
// Sorties : creerCoursesLocales(...) -> { recevoir(courses), operation(type, donnees) -> op, reussir(op),
//           echouer(op), purger() -> vrai si la vue a changé, defiger(), vue() } ; vue() -> { lue, articles: [{ uid,
//           summary, status, enAttente }], aFaire, coches } ; trierArticles(articles, statutDeTri) ;
//           texteArticle(saisie) -> texte nettoyé ou null ; texteViderCoches(articles) -> la question de « Vider
//           les cochés », articles nommés ; TEXTE_MAX (60). Types d'opération : ajouter { texte }, cocher { uid,
//           fait }, supprimer { uid }, vider {}.
// Pièges  :
//   - Affiché = liste du serveur + opérations en attente rejouées dans l'ordre. Une opération réussie n'est
//     retirée qu'une fois une liste du serveur reçue APRÈS son envoi (le serveur publie la nouvelle liste avant
//     de répondre, mais le flux et la réponse HTTP arrivent par deux connexions, dans un ordre quelconque) :
//     sinon l'écran reviendrait un instant en arrière. Filet : retirée au plus tard 10 s après la réponse.
//   - Une opération refusée est retirée tout de suite : l'écran revient à l'état du serveur et dit l'erreur.
//   - Un article ajouté n'a pas encore d'uid : il porte un uid local (« local-3 ») et reste en attente, sans
//     action possible, jusqu'à ce que la liste du serveur le ramène avec son vrai uid. Dès qu'une liste du
//     serveur a un article de ce texte de plus qu'au moment de l'envoi, la copie locale n'est plus montrée :
//     pas de doublon entre l'arrivée du flux et celle de la réponse.
//   - Une opération qui ne trouve plus son article (supprimé depuis l'iPhone) est ignorée au rejeu.
//   - Un article qu'on vient de cocher (ou décocher) GARDE SA PLACE : il est trié selon son statut d'avant tant
//     qu'on touche la liste, et ne part en bas (ou ne remonte) que 4 s après la dernière coche, ou quand on quitte
//     l'écran (defiger). Sinon l'article suivant prenait sa place sous le doigt, et le toucher suivant le cochait.
//   - Le texte suit la règle du serveur (serveur/ha/actions.js, partage/caracteres-invisibles.js) : 1 à 60
//     caractères, pas seulement des espaces, ni contrôles, ni sauts de ligne, ni inversions bidi, ni demi-paire
//     de substitution isolée, espaces de bord retirés. Expression en mode u : un émoji valide passe.
//   - « Vider les cochés » nomme les articles retirés (2 noms et « et N autres » au-delà de 3) : la confirmation
//     dit ce qui part, pas seulement combien.

export const TEXTE_MAX = 60;
const DELAI_FILET_MS = 10000;
const DELAI_TRI_MS = 4000;
const NOMS_VIDER_MAX = 3;
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\uD800-\uDFFF]/u;

const statutPropre = (article) => article.status;

export function trierArticles(articles, statutDeTri = statutPropre) {
  const aFaire = articles.filter((article) => statutDeTri(article) !== 'completed');
  const coches = articles.filter((article) => statutDeTri(article) === 'completed');
  return aFaire.concat(coches);
}

export function texteViderCoches(articles) {
  const noms = articles.filter((article) => article.status === 'completed').map((article) => `« ${article.summary} »`);
  if (noms.length === 0) return null;
  if (noms.length > NOMS_VIDER_MAX) return `Retirer ${noms.slice(0, NOMS_VIDER_MAX - 1).join(', ')} et ${noms.length - NOMS_VIDER_MAX + 1} autres ?`;
  if (noms.length === 1) return `Retirer ${noms[0]} ?`;
  return `Retirer ${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]} ?`;
}

export function texteArticle(saisie) {
  const texte = String(saisie || '').trim();
  if (texte.length === 0 || texte.length > TEXTE_MAX || INVISIBLE.test(texte)) return null;
  return texte;
}

const compter = (articles, texte) => articles.filter((article) => article.summary === texte).length;

function appliquer(articles, op) {
  const d = op.donnees;
  switch (op.type) {
    case 'ajouter':
      if (compter(articles, d.texte) > op.presentsAvant) return articles;
      return articles.concat({ uid: `local-${op.id}`, summary: d.texte, status: 'needs_action', enAttente: true });
    case 'cocher':
      return articles.map((article) => (article.uid === d.uid
        ? { uid: article.uid, summary: article.summary, status: d.fait ? 'completed' : 'needs_action', enAttente: true }
        : article));
    case 'supprimer':
      return articles.filter((article) => article.uid !== d.uid);
    default:
      return articles.filter((article) => article.status !== 'completed');
  }
}

export function creerCoursesLocales({ monotone }) {
  let serveur = null;
  let version = 0;
  let attente = [];
  let compteur = 0;
  let figes = {};
  let derniereCoche = -Infinity;

  const retirer = (op) => {
    attente = attente.filter((candidat) => candidat !== op);
  };

  return {
    recevoir(courses) {
      serveur = courses;
      version += 1;
      attente = attente.filter((op) => op.confirmeeLe === null);
    },
    operation(type, donnees) {
      compteur += 1;
      const presentsAvant = type === 'ajouter' && serveur ? compter(serveur.articles, donnees.texte) : 0;
      const op = { id: compteur, type, donnees, versionEnvoi: version, confirmeeLe: null, presentsAvant };
      attente.push(op);
      if (type === 'cocher') {
        if (!Object.prototype.hasOwnProperty.call(figes, donnees.uid)) figes[donnees.uid] = donnees.fait ? 'needs_action' : 'completed';
        derniereCoche = monotone();
      }
      return op;
    },
    reussir(op) {
      if (version > op.versionEnvoi) retirer(op);
      else op.confirmeeLe = monotone();
    },
    echouer: retirer,
    purger() {
      const maintenant = monotone();
      const avant = attente.length;
      attente = attente.filter((op) => op.confirmeeLe === null || maintenant - op.confirmeeLe < DELAI_FILET_MS);
      const tri = Object.keys(figes).length > 0 && maintenant - derniereCoche >= DELAI_TRI_MS;
      if (tri) figes = {};
      return tri || attente.length !== avant;
    },
    defiger() {
      figes = {};
    },
    vue() {
      const base = serveur ? serveur.articles.map((a) => ({ uid: a.uid, summary: a.summary, status: a.status, enAttente: false })) : [];
      const statutDeTri = (article) => (Object.prototype.hasOwnProperty.call(figes, article.uid) ? figes[article.uid] : article.status);
      const articles = trierArticles(attente.reduce(appliquer, base), statutDeTri);
      const coches = articles.filter((article) => article.status === 'completed').length;
      return { lue: serveur !== null, articles, aFaire: articles.length - coches, coches };
    },
  };
}
