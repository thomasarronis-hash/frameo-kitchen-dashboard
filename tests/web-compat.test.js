// tests/web-compat.test.js
//
// Rôle    : garder la page compatible avec une vieille WebView en attendant le choix du bundler (mesure du
//           cadre) : JS de web/src sans syntaxe ni fonction au-delà d'ES2019, CSS de web/styles sans les
//           propriétés interdites par la conception §3.1, opsz de Fraunces toujours fixé ; et cohérence des
//           fichiers de la page (sprite, polices, licence, liens de index.html).
// Entrées : web/src/**/*.js, web/styles/**/*.css, web/index.html, web/public/, et config/enfants.json (pictogrammes que la
//           page dessinera d'après le flux).
// Sorties : node --test.
// Pièges  :
//   - Contrôle par motifs, pas par un vrai analyseur (aucun paquet ajouté) : commentaires et chaînes sont
//     retirés avant la recherche, mais un motif exotique peut passer. C'est un garde-fou, pas une preuve ;
//     la preuve viendra de la WebView du cadre et du transpileur.
//   - Le gap n'est autorisé que sous ses alias de grille (grid-gap, grid-row-gap, grid-column-gap),
//     compris de Chrome 57 à aujourd'hui : un gap nu pourrait s'appliquer à un flex.
//   - Une règle qui pose Fraunces doit fixer opsz ; les éléments .chiffres l'héritent de cette classe
//     (base.css), que .chiffres-affiche surcharge pour les chiffres lus à 2 m.
//   - backdrop-filter est interdit (règle ajoutée le 13/10, après la mesure sur le cadre) : le verre du bandeau
//     sonnette et du mode Photos est en mode « teinte » seulement.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../web', import.meta.url));
const BAREME_ENFANTS = fileURLToPath(new URL('../config/enfants.json', import.meta.url));
const fichiers = (dossier, extension) => readdirSync(join(WEB, dossier), { recursive: true })
  .filter((f) => f.endsWith(extension)).map((f) => join(dossier, f));
const lire = (chemin) => readFileSync(join(WEB, chemin), 'utf8');

// Retire commentaires et chaînes (', ", `), en gardant les sauts de ligne pour les numéros de ligne.
function codeSeul(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (bloc) => bloc.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (chaine) => chaine.replace(/[^\n]/g, ' '));
}

const INTERDITS_JS = [
  [/\?\./, 'chaînage optionnel ?. (ES2020)'],
  [/\?\?/, 'coalescence ?? (ES2020)'],
  [/(^|[^\w$])#[A-Za-z_$]/, 'champ ou méthode privés de classe (ES2022)'],
  [/\bimport\s*\(/, 'import dynamique (ES2020)'],
  [/^await\b/m, 'await de premier niveau (ES2022)'],
  [/\d_\d/, 'séparateur numérique (ES2021)'],
  [/(\|\||&&)=/, 'affectation logique (ES2021)'],
  [/\.(at|replaceAll|findLast|findLastIndex|toSorted|toReversed)\(/, 'méthode ES2021+'],
  [/\b(globalThis|structuredClone|Object\.hasOwn|Promise\.(allSettled|any)|AggregateError|WeakRef|BigInt)\b/, 'fonction ES2020+'],
  [/\bstatic\s*\{/, 'bloc statique de classe (ES2022)'],
];

const INTERDITS_CSS = [
  [/(^|[^-\w])(row-|column-)?gap\s*:/, 'gap nu (utiliser grid-gap, grid-row-gap, grid-column-gap)'],
  [/aspect-ratio/, 'aspect-ratio'],
  [/(^|[^-\w])inset\s*:/, 'inset'],
  [/:(is|has|where)\(/, ':is, :has, :where'],
  [/color-mix\(/, 'color-mix'],
  [/\d+(\.\d+)?(dvh|svh|lvh|dvw|svw|lvw)\b/, 'unités dvh, svh, lvh'],
  [/(^|[^\w-])(clamp|min|max)\(/, 'clamp(), min(), max()'],
  [/&/, 'imbrication CSS'],
  [/rgba?\(\s*\d+\s+\d+/, 'rgb() à espaces'],
  [/@(container|layer)\b/, '@container, @layer'],
  [/:focus-visible/, ':focus-visible'],
  [/display\s*:\s*contents/, 'display: contents'],
  [/content-visibility/, 'content-visibility'],
  [/backdrop-filter/, 'backdrop-filter (verre « teinte » seulement : le flou fait tomber les fondus à 16 FPS, docs/cadre-ave948.md)'],
];

test('JS de la page : rien au-delà d\'ES2019', () => {
  const sources = fichiers('src', '.js');
  assert.ok(sources.length >= 12, 'modules de web/src introuvables');
  const ecarts = [];
  for (const chemin of sources) {
    codeSeul(lire(chemin)).split('\n').forEach((ligne, i) => {
      for (const [motif, nom] of INTERDITS_JS) if (motif.test(ligne)) ecarts.push(`${chemin}:${i + 1} ${nom}`);
    });
  }
  assert.deepEqual(ecarts, []);
});

test('le contrôle JS repère bien chaque syntaxe interdite (témoin)', () => {
  const temoins = ['a?.b', 'a ?? b', 'class A { #x = 1 }', 'import("./x.js")', 'await f()', '1_000', 'a ||= b', 'l.at(-1)', 'globalThis.x', 'static { }'];
  temoins.forEach((temoin, i) => assert.ok(INTERDITS_JS[i][0].test(codeSeul(temoin)), temoin));
  assert.equal(INTERDITS_JS.some(([motif]) => motif.test(codeSeul("const s = 'a?.b ?? #x'; // a?.b"))), false, 'chaînes et commentaires ignorés');
});

test('CSS de la page : règles de compatibilité de la conception §3.1', () => {
  const feuilles = fichiers('styles', '.css');
  assert.ok(feuilles.length >= 5, 'feuilles de web/styles introuvables');
  const ecarts = [];
  for (const chemin of feuilles) {
    lire(chemin).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').forEach((ligne, i) => {
      for (const [motif, nom] of INTERDITS_CSS) if (motif.test(ligne)) ecarts.push(`${chemin}:${i + 1} ${nom}`);
    });
  }
  assert.deepEqual(ecarts, []);
});

test('le contrôle CSS repère bien chaque propriété interdite (témoin)', () => {
  const temoins = ['.a { display: flex; gap: 8px; }', 'aspect-ratio: 1', 'inset: 0', '.a:has(.b)', 'color-mix(in srgb, red, blue)',
    'height: 100dvh', 'width: clamp(1px, 2px, 3px)', '.a { & .b {} }', 'rgb(0 0 0 / 50%)', '@container (min-width: 1px)',
    ':focus-visible', 'display: contents', 'content-visibility: auto', '.verre { -webkit-backdrop-filter: blur(14px); }'];
  temoins.forEach((temoin, i) => assert.ok(INTERDITS_CSS[i][0].test(temoin), temoin));
  for (const permis of ['grid-gap: 8px', 'grid-column-gap: 32px', 'grid-template-columns: minmax(0, 1fr) 560px']) {
    assert.equal(INTERDITS_CSS.some(([motif]) => motif.test(permis)), false, permis);
  }
});

test('Fraunces : toute règle qui l\'emploie fixe son axe opsz (pas d\'ajustement optique automatique avant Chrome 79)', () => {
  const sansOpsz = [];
  let regles = 0;
  for (const chemin of fichiers('styles', '.css')) {
    for (const [, selecteur, corps] of lire(chemin).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (selecteur.trim() === '@font-face' || !/font-family\s*:\s*"Fraunces"/.test(corps)) continue;
      regles += 1;
      if (!/font-variation-settings\s*:\s*"opsz"\s+\d+/.test(corps)) sansOpsz.push(`${chemin} ${selecteur.trim()}`);
    }
  }
  assert.ok(regles >= 2, 'règles Fraunces introuvables (.chiffres, .menu-marque)');
  assert.deepEqual(sansOpsz, []);
});

test('sprite : chaque icône citée par la page (ou par le barème des enfants, qu\'elle dessine d\'après le flux) existe, et chaque symbole du sprite sert', () => {
  const sprite = lire('public/icones.svg').replace(/<!--[\s\S]*?-->/g, '');
  const symboles = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  const citees = new Set();
  const textes = [...fichiers('src', '.js').map(lire), readFileSync(BAREME_ENFANTS, 'utf8')];
  for (const texte of textes) {
    for (const [nom] of texte.matchAll(/\bi-[a-z]+\b/g)) citees.add(nom);
  }
  assert.deepEqual([...citees].filter((nom) => !symboles.has(nom)), [], 'icônes citées absentes du sprite');
  assert.deepEqual([...symboles].filter((nom) => !citees.has(nom)), [], 'symboles inutilisés dans le sprite');
});

test('index.html : feuilles, module, polices et icône existent ; polices sous licence OFL', () => {
  const html = lire('index.html');
  const liens = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(liens.length >= 8, 'liens de index.html introuvables');
  for (const lien of liens) {
    const local = join(WEB, lien);
    const public_ = join(WEB, 'public', lien);
    assert.ok(existsSync(local) || existsSync(public_), `${lien} introuvable (ni dans web/ ni dans web/public/)`);
  }
  assert.match(html, /<meta name="viewport" content="width=1920, user-scalable=no">/);
  assert.match(html, /<script type="module" src="\/src\/main\.js"><\/script>/);
  const licence = lire('public/polices/OFL.txt');
  for (const attendu of ['Fraunces Project Authors', 'Nunito Sans Project Authors', 'SIL OPEN FONT LICENSE Version 1.1']) {
    assert.ok(licence.includes(attendu), `OFL.txt sans « ${attendu} »`);
  }
});
