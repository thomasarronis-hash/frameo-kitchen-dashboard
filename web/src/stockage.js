// web/src/stockage.js
//
// Rôle    : petite façade de localStorage pour ce que la page garde d'un chargement à l'autre (minuteurs,
//           ingrédients cochés, dernier « Prêt pour le drive ») : valeurs JSON, sans jamais lever.
// Entrées : un objet du type localStorage (window.localStorage dans la page, une Map habillée dans les tests),
//           ou une fonction qui le rend (l'accès à window.localStorage peut lui-même lever).
// Sorties : creerStockage(source) -> { lire(cle) (valeur JSON, ou null si absente ou illisible),
//           ecrire(cle, valeur), retirer(cle) }.
// Pièges  :
//   - localStorage peut manquer ou lever (stockage plein, désactivé, quota d'une vieille WebView) : la page doit
//     continuer, simplement sans mémoire. Chaque appel est donc protégé, et une erreur d'écriture est signalée
//     dans la console, pas remontée.
//   - Toutes les clés de la page commencent par « cadre. » : rien d'autre n'est lu ni effacé.
//   - Les valeurs relues viennent du disque : chaque module les revalide (forme, bornes) avant de s'en servir.

const PREFIXE = 'cadre.';

export function creerStockage(source) {
  function acceder() {
    try {
      return typeof source === 'function' ? source() : source;
    } catch (err) {
      return null;
    }
  }

  return {
    lire(cle) {
      try {
        const brut = acceder().getItem(PREFIXE + cle);
        return brut === null ? null : JSON.parse(brut);
      } catch (err) {
        return null;
      }
    },
    ecrire(cle, valeur) {
      try {
        acceder().setItem(PREFIXE + cle, JSON.stringify(valeur));
      } catch (err) {
        console.warn(`stockage : ${cle} non enregistré`, err);
      }
    },
    retirer(cle) {
      try {
        acceder().removeItem(PREFIXE + cle);
      } catch (err) {
        console.warn(`stockage : ${cle} non effacé`, err);
      }
    },
  };
}
