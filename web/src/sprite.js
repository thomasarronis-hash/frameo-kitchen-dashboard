// web/src/sprite.js
//
// Rôle    : charger le sprite d'icônes (web/public/icones.svg) À JOUR et le poser dans la page, pour que les icônes
//           (web/src/dom.js : <use href="#i-...">) pointent vers ce document-ci et non vers un fichier externe.
// Entrées : chargerSprite({ requete, document, attendre }) : requete(url, options) -> promesse d'une réponse fetch
//           ({ ok, text() }) ; document de la page ; attendre(rappel, ms) (setTimeout ; un faux dans les tests).
// Sorties : chargerSprite(...) -> promesse résolue une fois le sprite posé (un <svg> masqué en tête de body, attribut
//           data-sprite) ; ESSAIS_MS, les attentes entre deux essais (5 s, 10 s, 30 s, puis 60 s à chaque fois).
// Pièges  :
//   - Pourquoi : le 16/10, après le déploiement de l'écran Clims, la page rechargée par l'empreinte a pris le nouveau
//     code mais PAS le nouveau sprite externe : la WebView du cadre a gardé l'ancien /icones.svg en mémoire, et les
//     nouvelles icônes (Clims au menu, Froid, Auto...) sont restées vides jusqu'au redémarrage du cadre. Une requête
//     fetch en cache « no-cache » revalide toujours auprès du serveur (304 si rien n'a changé), et un sprite posé dans la
//     page ne survit pas à un rechargement.
//   - Les icônes créées avant l'arrivée du sprite (menu, Accueil au démarrage) s'affichent dès qu'il est posé : une
//     référence #i-... interne se résout quand le symbole apparaît. Sprite injoignable (Wi-Fi du cadre qui décroche) :
//     nouvel essai après 5 s, 10 s, 30 s, puis toutes les 60 s, sans fin ; en attendant, les icônes restent vides.
//   - Réponse sans <svg> ni symbole (page d'erreur, fichier tronqué) : traitée comme un échec, jamais posée.
//   - Masqué par width et height à 0 et position absolue, PAS par display: none (des symboles sous display: none ne
//     sont pas dessinés par tous les moteurs).

const URL_SPRITE = '/icones.svg';
export const ESSAIS_MS = [5000, 10000, 30000, 60000];

function poser(document, texte) {
  const hote = document.createElement('div');
  hote.innerHTML = texte;
  const svg = hote.querySelector('svg');
  if (!svg || !svg.querySelector('symbol')) throw new Error('sprite sans symbole');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-sprite', '');
  svg.style.position = 'absolute';
  svg.style.overflow = 'hidden';
  document.body.insertBefore(svg, document.body.firstChild);
}

export function chargerSprite({ requete, document, attendre = (rappel, ms) => setTimeout(rappel, ms) }) {
  return new Promise((resoudre) => {
    let rang = 0;
    function essayer() {
      requete(URL_SPRITE, { cache: 'no-cache' })
        .then((reponse) => {
          if (!reponse.ok) throw new Error(`sprite : HTTP ${reponse.status}`);
          return reponse.text();
        })
        .then((texte) => {
          poser(document, texte);
          resoudre();
        })
        .catch(() => {
          attendre(essayer, ESSAIS_MS[Math.min(rang, ESSAIS_MS.length - 1)]);
          rang += 1;
        });
    }
    essayer();
  });
}
