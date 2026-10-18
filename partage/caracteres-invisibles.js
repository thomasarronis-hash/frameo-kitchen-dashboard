// partage/caracteres-invisibles.js
//
// Rôle    : LA liste des caractères refusés dans un article de courses écrit depuis le cadre, partagée par le serveur
//           (serveur/ha/actions.js, schéma de courses_ajouter) et par outils/cadre.mjs (affichage d'un article
//           dans la confirmation de cocher).
// Entrées : rendreVisible(texte) : un texte venu de Home Assistant (un article noté sur un iPhone peut contenir
//           n'importe quoi).
// Sorties : INVISIBLES, le corps d'une classe de caractères (à placer entre [ et ], expression en mode u) ;
//           rendreVisible(texte) -> le texte où chacun de ces caractères est écrit « ‮ ».
// Pièges  :
//   - Ce qui est refusé, et pourquoi :
//       contrôles C0 et DEL (U+0000 à U+001F, U+007F) et C1 (U+0080 à U+009F) : retours à la ligne, effacements ;
//       U+2028 et U+2029 : sauts de ligne et de paragraphe ;
//       U+202A à U+202E et U+2066 à U+2069 : inversions de sens d'écriture (bidi), qui maquillent un texte
//       (« lait » affiché, autre chose écrit) dans l'appli HA et dans la confirmation de cadre.mjs ;
//       U+D800 à U+DFFF seuls : demi-paire de substitution isolée. JSON.stringify l'écrit « \ud800 », que le
//       décodeur JSON de Home Assistant (orjson) refuse : HA fermerait alors toute la connexion du serveur.
//   - La classe n'a ce sens qu'en mode u (unicode) : un émoji valide (une paire complète) y est alors UN
//     caractère hors de la plage U+D800 à U+DFFF, et passe. ajv compile les motifs en mode u.
//   - web/src/ecrans/courses-donnees.js garde sa propre copie (la page ne charge rien hors de web/) : même liste.

export const INVISIBLES = '\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\uD800-\\uDFFF';

const CARACTERE_INVISIBLE = new RegExp(`[${INVISIBLES}]`, 'gu');

export function rendreVisible(texte) {
  return String(texte).replace(CARACTERE_INVISIBLE, (caractere) => `\\u${caractere.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
