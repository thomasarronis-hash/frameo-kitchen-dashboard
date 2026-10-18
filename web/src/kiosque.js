// web/src/kiosque.js
//
// Rôle    : façade du pont « Kiosk » de l'appli kiosque (kiosque/src/.../PontKiosque.java) pour la luminosité et
//           le volume, avec repli silencieux hors du kiosque (navigateur du Clevo).
// Entrées : le pont (window.Kiosk dans la WebView du kiosque, undefined ailleurs).
// Sorties : creerKiosque(pont) -> { luminosite(niveau), volumeAuMoins(pourcentage) } : luminosité entre 0 et 1,
//           transmise seulement si elle change ; volume média remonté à pourcentage (0 à 100, entier) s'il est plus
//           bas, laissé tel quel s'il est plus haut.
// Pièges  :
//   - Le pont n'existe que dans la WebView du kiosque : absent, ou méthode manquante dans une vieille APK,
//     l'appel est simplement ignoré. Un appel qui lève est ignoré aussi (et retenté au changement suivant).
//   - setBrightness(0) ne coupe pas le rétroéclairage, il le met au minimum (conception §1.3).
//   - luminosite est appelée à chaque seconde par main.js : sans la mémoire du dernier niveau, le pont serait
//     sollicité en continu. volumeAuMoins, lui, n'est appelé qu'au début d'une sonnerie, et relit le volume à
//     chaque fois (getVolume) : quelqu'un a pu le baisser, ou le monter, depuis la dernière fois.
//   - getVolume absent (vieille APK) ou qui lève : volume inconnu, on règle le pourcentage demandé.

export function creerKiosque(pont) {
  let dernier = null;
  const disponible = (methode) => Boolean(pont) && typeof pont[methode] === 'function';
  return {
    luminosite(niveau) {
      if (niveau === dernier || !disponible('setBrightness')) return;
      try {
        pont.setBrightness(niveau);
        dernier = niveau;
      } catch (err) {
        dernier = null;
      }
    },
    volumeAuMoins(pourcentage) {
      if (!disponible('setVolume')) return;
      try {
        const actuel = disponible('getVolume') ? Number(pont.getVolume()) : NaN;
        if (isFinite(actuel) && actuel >= pourcentage) return;
        pont.setVolume(Math.round(pourcentage));
      } catch (err) {
        console.warn('kiosque : volume non réglé', err);
      }
    },
  };
}
