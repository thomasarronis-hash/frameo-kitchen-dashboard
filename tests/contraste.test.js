// tests/contraste.test.js
//
// Rôle    : prouver que tout texte de la page atteint 4,5:1 sur le fond où il s'affiche réellement (WCAG 2,
//           niveau AA), dans chaque thème de web/styles/jetons.css ; que les valeurs de la conception §1.3
//           sont reprises à l'identique ; et que les feuilles n'ont ni couleur en dur ni opacité partielle.
// Entrées : web/styles/jetons.css et toutes les feuilles de web/styles.
// Sorties : node --test.
// Pièges  :
//   - Calcul WCAG 2.x : luminance relative sRGB, (L1 + 0,05) / (L2 + 0,05).
//   - Les paires viennent des FEUILLES, pas d'une liste écrite à la main :
//     . une règle qui déclare color: var(--x) ET background: var(--y) est contrôlée sur son propre fond ;
//     . une règle qui déclare color sans fond doit figurer dans PORTEURS, qui dit quel élément porte le
//       fond sous ce texte ; le fond est relu dans la règle CSS de ce porteur (changer le fond d'une carte
//       recontrôle tous les textes posés dessus). Un sélecteur avec color absent de PORTEURS fait échouer ;
//     . une règle qui déclare un fond sans color laisse voir le texte hérité de body : la paire
//       (couleur de body, ce fond) est contrôlée, sauf pour les fonds sans texte de DECORATIFS.
//   - opacity strictement entre 0 et 1 est interdite : elle ferait tomber le contraste sans que ce test le
//     voie (0 et 1 restent permis : la bulle apparaît et disparaît en fondu).
//   - Thèmes reconstruits comme le fait la cascade : :root (jour) puis .theme-soir ou .theme-nuit, dans
//     l'ordre du fichier. Une paire n'est évaluée que dans les thèmes où son jeton de texte existe.
//   - Feuilles lues par motifs (règles simples, sans @media ni imbrication, ce que web-compat.test.js
//     garantit déjà pour l'imbrication) : une @-règle inattendue fait échouer.
//   - Les pastilles des personnes de l'agenda (rendez-vous.css) portent l'initiale : la paire initiale sur
//     pastille passe par la règle commune ; la pastille elle-même, objet graphique, doit se détacher à 3:1 de
//     ce qui l'entoure (test dédié). Les blocs et les barres de l'Agenda en grille prennent les mêmes classes
//     .personne-N (même paire texte sur fond), l'initiale y est dans un rond aux couleurs inversées (paire contrôlée
//     par sa propre règle) ; la ligne de l'heure actuelle, objet graphique, a son test dédié.
//   - Verre « teinte » (bandeau sonnette, pastilles et légendes du mode Photos, jetons en rgba) : un texte posé dessus
//     est contrôlé au PIRE cas, le verre composé sur du noir et sur du blanc ; il tient donc quoi qu'il y ait dessous
//     (écran, photo claire ou sombre, recette).

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DOSSIER_STYLES = fileURLToPath(new URL('../web/styles', import.meta.url));
const lireCss = (chemin) => readFileSync(chemin, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const JETONS = lireCss(join(DOSSIER_STYLES, 'jetons.css'));
const FEUILLES = readdirSync(DOSSIER_STYLES, { recursive: true }).filter((f) => f.endsWith('.css') && f !== 'jetons.css');

// Sélecteur d'un texte sans fond propre -> sélecteurs des éléments qui portent son fond (d'après le DOM).
const PORTEURS = {
  body: ['body'],
  '.intitule': ['body', '.carte'],
  '.nuit-heure': ['.nuit'],
  '.menu-marque': ['.menu'],
  '.menu-entree': ['.menu'],
  '.menu-pied': ['.menu'],
  '.accueil-heure': ['body'],
  '.accueil-date': ['body'],
  '.accueil-temperature': ['body'],
  '.accueil-ciel-picto': ['body'],
  '.accueil-aujourdhui-icone': ['.accueil-aujourdhui'],
  '.accueil-badge-icone': ['.accueil-aujourdhui'],
  '.accueil-badge-alerte .accueil-badge-icone': ['.accueil-aujourdhui'],
  '.accueil-badge-alerte .accueil-badge-nombre': ['.accueil-aujourdhui'],
  '.accueil-aujourdhui-rien': ['.accueil-aujourdhui'],
  '.accueil-ciel': ['body'],
  '.accueil-pluie': ['body'],
  '.accueil-plat': ['body'],
  '.accueil-soir-details': ['body'],
  '.accueil-soir-vide': ['body'],
  '.carte-icone': ['.carte'],
  '.carte-message': ['.carte'],
  '.air-indice': ['.carte'],
  '.semaine-message': ['.carte'],
  '.semaine-picto': ['.carte', '.semaine-jour-auj'],
  '.semaine-maxi': ['.carte', '.semaine-jour-auj'],
  '.semaine-mini': ['.carte', '.semaine-jour-auj'],
  '.semaine-repas-ligne': ['.carte', '.semaine-jour-auj'],
  '.bouton-icone': ['.bouton-maison'],
  '.bouton-etat': ['.bouton-maison'],
  '.bouton-etat-alerte': ['.bouton-maison'],
  '.pastille-temps': ['.pastille'],
  '.pastille-libelle': ['.pastille'],
  '.theme-nuit .pastille': ['.pastille'],
  '.theme-nuit .pastille-temps': ['.pastille'],
  '.theme-nuit .pastille-libelle': ['.pastille'],
  '.pastille-sonne .pastille-temps': ['.pastille-sonne'],
  '.pastille-sonne .pastille-libelle': ['.pastille-sonne'],
  '.tiroir-duree': ['.tiroir'],
  '.tiroir-message': ['.tiroir'],
  '.tiroir-minuteur-nom': ['.tiroir'],
  '.tiroir-minuteur-temps': ['.tiroir'],
  '.tiroir-minuteur-annule .tiroir-minuteur-temps': ['.tiroir'],
  '.tiroir-vide': ['.tiroir'],
  '.non-appaire-heure': ['.non-appaire'],
  '.non-appaire-titre': ['.non-appaire'],
  '.non-appaire-conseil': ['.non-appaire'],
  '.page-titre': ['body'],
  '.page-vide-titre': ['body'],
  '.page-vide-texte': ['body'],
  '.aujourdhui-vide': ['.carte'],
  '.aujourdhui-plus': ['.carte'],
  '.aujourdhui-periode-nom': ['.carte'],
  '.aujourdhui-periode-picto': ['.carte'],
  '.aujourdhui-periode-temp': ['.carte'],
  '.aujourdhui-pluie': ['.carte'],
  '.aujourdhui-repas-intitule': ['.carte'],
  '.aujourdhui-temps': ['.carte'],
  '.aujourdhui-rdv-horaire': ['.carte'],
  '.aujourdhui-rappel-moment': ['.carte'],
  '.aujourdhui-alerte-icone': ['.carte'],
  '.aujourdhui-alerte-valeur': ['.carte'],
  '.repas-nom': ['body', '.repas-jour-auj'],
  '.repas-plat': ['.repas-avec-recette', 'body', '.repas-jour-auj'],
  '.repas-meta': ['.repas-avec-recette', 'body', '.repas-jour-auj'],
  '.repas-gamelle .repas-plat': ['body', '.repas-jour-auj'],
  '.repas-fleche': ['.repas-avec-recette'],
  '.recette-titre': ['body'],
  '.recette-details': ['body'],
  '.recette-ingredient-texte': ['.carte'],
  '.recette-ingredient-coche .recette-ingredient-texte': ['.carte'],
  '.recette-texte': ['.carte'],
  '.recette-astuce': ['.carte'],
  '.courses-texte': ['.carte'],
  '.courses-article-coche .courses-texte': ['.carte'],
  '.courses-article-attente .courses-texte': ['.carte'],
  '.courses-vide': ['.carte'],
  '.courses-drive-date': ['.carte'],
  '.courses-hors-ligne': ['body'],
  '.courses-essai': ['body'],
  '.rdv-plus': ['body', '.carte', '.semaine-jour-auj'],
  '.meteo-maintenant-picto': ['body'],
  '.meteo-maintenant-temp': ['body'],
  '.meteo-maintenant-ciel': ['body'],
  '.meteo-vent': ['body'],
  '.meteo-vide': ['.carte'],
  '.meteo-sous-titre': ['.carte'],
  '.meteo-resume': ['.carte'],
  '.meteo-barre-heure': ['.carte'],
  '.meteo-total': ['.carte'],
  '.meteo-heure-jour': ['.carte'],
  '.meteo-heure-h': ['.carte'],
  '.meteo-heure-picto': ['.carte'],
  '.meteo-heure-temp': ['.carte'],
  '.meteo-heure-pluie': ['.carte'],
  '.meteo-jour-nom': ['.carte', '.meteo-jour-auj'],
  '.meteo-jour-picto': ['.carte', '.meteo-jour-auj'],
  '.meteo-jour-maxi': ['.carte', '.meteo-jour-auj'],
  '.meteo-jour-mini': ['.carte', '.meteo-jour-auj'],
  '.meteo-jour-pluie': ['.carte', '.meteo-jour-auj'],
  '.meteo-jour-vent': ['.carte', '.meteo-jour-auj'],
  '.meteo-air-indice': ['.carte'],
  '.meteo-air-libelle': ['.carte'],
  '.meteo-air-demain': ['.carte'],
  '.meteo-air-demain-libelle': ['.carte'],
  '.meteo-pollens-titre': ['.carte'],
  '.meteo-pollen-nom': ['.carte'],
  '.meteo-pollen-1': ['.carte'],
  '.meteo-pollen-2': ['.carte'],
  '.meteo-pollen-3': ['.carte'],
  '.meteo-pollens-message': ['.carte'],
  '.meteo-credit': ['body'],
  '.agenda-alerte': ['body'],
  '.agenda-legende-nom': ['body'],
  '.agenda-jour-nom': ['.carte'],
  '.agenda-jour-numero': ['.carte'],
  '.agenda-jour-auj .agenda-jour-nom': ['.carte'],
  '.agenda-graduation-heure': ['.carte'],
  '.agenda-fiche-fermer': ['.carte'],
  '.agenda-fiche-nom': ['.carte'],
  '.agenda-fiche-titre': ['.carte'],
  '.agenda-fiche-horaire': ['.carte'],
  '.agenda-fiche-lieu': ['.carte'],
  '.agenda-fiche-plus': ['.carte'],
  '.bouton-ouvertures': ['.bouton-maison'],
  '.bouton-ouvertures-alerte': ['.bouton-maison'],
  '.sonnette-icone': ['.bandeau-sonnette'],
  '.sonnette-consigne': ['.bandeau-sonnette'],
  '.photo-sonnette-message': ['.photo-sonnette'],
  '.telecommande-etat': ['.telecommande-gauche'],
  '.telecommande-alerte': ['.telecommande-gauche'],
  '.telecommande-message': ['.telecommande-gauche'],
  '.applis-vide': ['.carte'],
  '.applis-consigne': ['.carte'],
  '.conseil': ['.carte'],
  '.maison-onglet-icone': ['.maison-onglet'],
  '.maison-onglet-actif .maison-onglet-icone': ['.maison-onglet-actif'],
  '.alarme-libelle': ['.carte'],
  '.alarme-arme': ['.carte'],
  '.alarme-alerte': ['.carte'],
  '.alarme-desarme': ['.carte'],
  '.alarme-neutre': ['.carte'],
  '.alarme-depuis': ['.carte'],
  '.alarme-resume': ['.carte'],
  '.alarme-resume-ouvert': ['.carte'],
  '.alarme-detail': ['.carte'],
  '.alarme-note': ['.carte'],
  '.ouverture-icone': ['.carte'],
  '.ouverture-ouverte .ouverture-icone': ['.ouverture-ouverte'],
  '.ouverture-ouverte .ouverture-etat': ['.ouverture-ouverte'],
  '.ouverture-inconnue .ouverture-icone': ['.carte'],
  '.ouverture-inconnue .ouverture-etat': ['.carte'],
  '.ouverture-nom': ['.carte', '.ouverture-ouverte'],
  '.ouverture-depuis': ['.carte', '.ouverture-ouverte'],
  '.ouverture-pile': ['.carte', '.ouverture-ouverte'],
  '.ouverture-etat': ['.carte'],
  '.sonnette-dernier': ['.carte'],
  '.sonnette-legende-photo': ['.carte'],
  '.sonnette-restant': ['.carte'],
  '.sonnette-mode': ['.carte'],
  '.sonnette-message': ['.carte'],
  '.wifi-grande-icone': ['.carte'],
  '.wifi-titre': ['.carte'],
  '.wifi-texte': ['.carte'],
  '.wifi-erreur': ['.carte'],
  '.wifi-trop-long': ['.carte'],
  '.wifi-ssid': ['.carte'],
  '.wifi-mdp': ['.carte'],
  '.wifi-compte': ['.carte'],
  '.wifi-mdp-chiffres': ['.carte'],
  '.encre-nom': ['.carte'],
  '.encre-niveau': ['.carte'],
  '.encre-alerte .encre-niveau': ['.carte'],
  '.piles-aucune': ['.carte'],
  '.piles-alerte': ['.carte'],
  '.pile': ['.carte'],
  '.pile-icone': ['.carte'],
  '.photos-date': ['.photos-pastille'],
  '.photos-temperature': ['.photos-pastille'],
  '.photos-ciel': ['.photos-pastille'],
  '.photos-intitule': ['.photos-pastille'],
  '.photos-minuteur-icone': ['.photos-pastille'],
  '.photos-minuteur-temps': ['.photos-pastille'],
  '.photos-minuteur-nom': ['.photos-pastille'],
  '.case-tempo-rouge .bouton-icone': ['.case-tempo-rouge'],
  '.case-tempo-rouge.case-tempo-creuses .bouton-icone': ['.case-tempo-rouge.case-tempo-creuses'],
  '.tempo-fiche-fermer': ['.carte'],
  '.tempo-fiche-nom': ['.carte'],
  '.tempo-fiche-couleur': ['.carte'],
  '.tempo-fiche-note': ['.carte'],
  '.tempo-fiche-fin': ['.carte'],
  '.tempo-fiche-legende': ['.carte'],
  '.tempo-compteur-nombre': ['.carte'],
  '.tempo-fiche-creuses': ['.carte'],
  '.tempo-fiche-lune': ['.carte'],
  '.tempo-fiche-credit': ['.carte'],
  '.draps-depuis': ['.carte'],
  '.draps-inconnu .draps-depuis': ['.carte'],
  '.draps-prochain': ['.carte'],
  '.draps-bientot .draps-prochain': ['.carte'],
  '.draps-alerte .draps-prochain': ['.carte'],
  '.draps-message': ['.carte'],
  '.piles-autres': ['.carte'],
  '.voiture': ['.carte'],
  '.voiture-nom-icone': ['.carte'],
  '.voiture-etat-detail': ['.carte'],
  '.voiture-autonomie': ['.carte'],
  '.voiture-etat-en-charge .voiture-etat-icone': ['.carte'],
  '.voiture-etat-erreur .voiture-etat': ['.carte'],
  '.voiture-bas.voiture-etat-debranchee .voiture-etat': ['.carte'],
  '.voiture.voiture-perimee': ['.carte'],
  '.voiture.voiture-perimee .voiture-nom-icone': ['.carte'],
  '.voiture.voiture-perimee .voiture-etat': ['.carte'],
  '.voiture.voiture-perimee .voiture-etat-icone': ['.carte'],
  '.voitures-vide-icone': ['body'],
  '.voiture-reglage-nom': ['.carte'],
  '.voiture-reglage-en-cours .voiture-reglage-valeur': ['.carte'],
  '.voiture-message': ['.carte'],
  '.voiture-message-alerte': ['.carte'],
  '.clim': ['.carte'],
  '.clim-nom-icone': ['.carte'],
  '.clim-message': ['.carte'],
  '.clim-message-alerte': ['.carte'],
  '.clim-etiquette': ['.carte'],
  '.clim-consigne-en-cours .clim-consigne-valeur': ['.carte'],
  '.clim.clim-indisponible': ['.carte'],
  '.clim.clim-indisponible .clim-nom-icone': ['.carte'],
  '.clims-vide-icone': ['body'],
  '.pastille-ecran-temps': ['.pastille-ecran'],
  '.pastille-ecran-unite': ['.pastille-ecran'],
  '.fin-video-tele': ['.carte'],
  '.fin-video-titre': ['.carte'],
  '.fin-video-texte': ['.carte'],
  '.enfants-carte': ['.carte'],
  '.enfants-titre': ['body'],
  '.quete-case-tot .quete-disque': ['.quete-disque'],
  '.quete-case-passee .quete-disque': ['.quete-disque'],
  '.quete-case-passee .quete-piece': ['.quete-piece'],
  '.quete-libelle': ['.quete-carte'],
  '.quete-tot': ['.quete-carte'],
  '.quete-coffre': ['.quete-carte'],
  '.quete-temps-heure': ['.quete-carte'],
  '.bourse-dessin': ['.carte'],
  '.bourse-nombre': ['.carte'],
  '.bourse-unite': ['.carte', '.bourse-disque-centre'],
  '.bourse-gagnees': ['.carte'],
  '.bourse-restant': ['.bourse-disque-centre'],
  '.bourse-fin-dessin': ['.carte'],
  '.bourse-fin-titre': ['.carte'],
  '.bourse-fin-texte': ['.carte'],
  '.boutique-etoile': ['.carte'],
  '.boutique-solde': ['.carte'],
  '.boutique-gain-picto': ['.carte'],
  '.boutique-vide': ['.carte'],
  '.boutique-cadeau-picto': ['.carte'],
  '.boutique-etoile-petite': ['.carte'],
  '.boutique-manque': ['.carte'],
  '.boutique-attente': ['.carte'],
  '.pablo-case': ['.carte'],
  '.pablo-case-passee': ['.carte'],
  '.pablo-fleche': ['body'],
  '.pablo-ensuite': ['.carte'],
  '.pablo-bocal': ['body'],
  '.pablo-etoile': ['body'],
  '.pablo-etoile-gagnee': ['body'],
  '.parent-etape-picto': ['.carte'],
  '.parent-etape-etat': ['.carte'],
  '.parent-etape-attente .parent-etape-etat': ['.carte'],
  '.parent-solde-etoile': ['.carte'],
  '.parent-cadeau-picto': ['.carte'],
  '.parent-jour-valeur': ['.carte'],
  '.parent-historique-attente': ['.carte'],
  '.effet-etoile': ['body', '.carte', '.quete-carte'],
};
// Fonds qui ne portent jamais de texte (pastilles, puces, voiles translucides du tiroir et des fiches de l'Agenda et de
// Tempo, barre de l'appui long, barres de pluie de l'écran Météo, jauges d'encre et des draps de l'écran Maison, ligne de
// l'heure actuelle de l'Agenda et son point, liseré d'un jour Tempo rouge, remplissage de la jauge des voitures ; pour les
// enfants : barre du temps de la quête, barres des appuis longs et de l'annulation (quête et « +1 » libre), jauges de la
// boutique, pièces et brins des animations, voile du message de fin, pastilles pleines de l'historique du mode parent).
const DECORATIFS = new Set([
  '.menu-pastille', '.menu-pastille-ko', '.carte-article::before',
  '.air-aqi-1', '.air-aqi-2', '.air-aqi-3', '.air-aqi-4', '.air-aqi-5', '.air-aqi-6',
  '.tiroir-voile', '.agenda-voile', '.agenda-maintenant', '.agenda-maintenant::before', '.courses-article::after', '.recette-astuce::before',
  '.meteo-barre-piste', '.meteo-barre', '.meteo-barre-nulle',
  '.encre-piste', '.encre-remplissage', '.encre-alerte .encre-remplissage', '.touche-veille::after', '.appli::after',
  '.liseret', '.tempo-voile', '.draps-piste', '.draps-remplissage', '.draps-alerte .draps-remplissage', '.draps-changer::after',
  '.voiture-niveau', '.voiture-bas .voiture-niveau', '.voiture.voiture-perimee .voiture-niveau',
  '.quete-temps-piste', '.quete-temps-reste', '.quete-annuler-barre', '.bourse-regarder::after', '.boutique-jauge',
  '.boutique-jauge-niveau', '.boutique-vouloir::after', '.effet-piece', '.fete-1', '.fete-2', '.fete-3', '.fete-4',
  '.fin-video-voile', '.parent-pastille-pleine', '.plus-un-retour-barre',
]);
const JETONS_DE_TEXTE = /^(texte|accent$|chaud$|alerte$)/;

// Règles d'une feuille : { selecteurs: [...], declarations: { propriété: valeur } }.
function regles(css) {
  const resultat = [];
  for (const [, selecteurs, corps] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = {};
    for (const declaration of corps.split(';')) {
      const deuxPoints = declaration.indexOf(':');
      if (deuxPoints > 0) declarations[declaration.slice(0, deuxPoints).trim()] = declaration.slice(deuxPoints + 1).trim();
    }
    resultat.push({ selecteurs: selecteurs.split(',').map((s) => s.trim()), declarations });
  }
  return resultat;
}

const jeton = (valeur) => {
  const trouve = /^var\(--([a-z0-9-]+)\)$/.exec(valeur || '');
  return trouve ? trouve[1] : null;
};
const fondDe = (declarations) => jeton(declarations.background || declarations['background-color']);

function theme(nom) {
  const jetons = {};
  for (const { selecteurs, declarations } of regles(JETONS)) {
    if (!selecteurs.includes(':root') && !selecteurs.includes(`.theme-${nom}`)) continue;
    for (const [propriete, valeur] of Object.entries(declarations)) {
      if (propriete.startsWith('--')) jetons[propriete.slice(2)] = valeur;
    }
  }
  return jetons;
}
const THEMES = { jour: theme('jour'), soir: theme('soir'), nuit: theme('nuit') };

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `couleur ${hex} : #rrggbb attendu`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Un fond en rgba (verre) donne deux fonds réels au pire : composé sur du noir et sur du blanc.
const RGBA = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/;
function fondsReels(couleur) {
  const verre = RGBA.exec(couleur);
  if (!verre) return [couleur];
  const alpha = Number(verre[4]);
  return [0, 255].map((dessous) => `#${[1, 2, 3].map((i) => Math.round(Number(verre[i]) * alpha + dessous * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`);
}

function contraste(a, b) {
  const [claire, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (claire + 0.05) / (sombre + 0.05);
}

// Toutes les règles de toutes les feuilles (hors jetons.css), avec le nom de leur feuille.
function toutesLesRegles(feuilles = FEUILLES) {
  return feuilles.flatMap((feuille) => regles(lireCss(join(DOSSIER_STYLES, feuille))).map((regle) => ({ ...regle, feuille })));
}

// Paires [texte, fond, où] relevées dans les feuilles ; les manques (sélecteur sans fond connu) à part.
function pairesDesFeuilles(toutes) {
  const fondsDuPorteur = (porteur) => toutes
    .filter(({ selecteurs, declarations }) => selecteurs.includes(porteur) && fondDe(declarations))
    .map(({ declarations }) => fondDe(declarations));
  const texteDeBody = toutes.map(({ selecteurs, declarations }) => (selecteurs.includes('body') ? jeton(declarations.color) : null)).find(Boolean);
  const paires = [];
  const manques = [];
  for (const { selecteurs, declarations, feuille } of toutes) {
    const texte = jeton(declarations.color);
    const fondPropre = fondDe(declarations);
    for (const selecteur of selecteurs) {
      if (texte && fondPropre) {
        paires.push([texte, fondPropre, `${feuille} ${selecteur}`]);
      } else if (texte) {
        const fonds = (PORTEURS[selecteur] || []).flatMap(fondsDuPorteur);
        if (fonds.length === 0) manques.push(`${feuille} : ${selecteur} déclare color sans fond connu (PORTEURS)`);
        for (const fond of fonds) paires.push([texte, fond, `${feuille} ${selecteur}`]);
      } else if (fondPropre && !DECORATIFS.has(selecteur)) {
        paires.push([texteDeBody, fondPropre, `${feuille} ${selecteur} (texte hérité de body)`]);
      }
    }
  }
  return { paires, manques };
}

function ecartsDeContraste(paires) {
  const ecarts = [];
  for (const [nomTheme, jetons] of Object.entries(THEMES)) {
    for (const [texte, fond, ou] of paires) {
      if (jetons[texte] === undefined) continue;
      assert.ok(jetons[fond], `${nomTheme} : --${fond} manquant pour --${texte} (${ou})`);
      for (const reel of fondsReels(jetons[fond])) {
        const ratio = contraste(jetons[texte], reel);
        if (ratio < 4.5) ecarts.push(`${nomTheme} : --${texte} ${jetons[texte]} sur --${fond} ${jetons[fond]} (${reel}) = ${ratio.toFixed(2)}:1 (${ou})`);
      }
    }
  }
  return ecarts;
}

test('calcul WCAG : valeurs connues (noir sur blanc 21:1, et les chiffres de la conception §1.3)', () => {
  assert.equal(contraste('#000000', '#ffffff'), 21);
  assert.equal(contraste('#777777', '#777777'), 1);
  assert.equal(contraste('#5d6b65', '#e2d3bd').toFixed(2), '3.80');
  assert.equal(contraste('#4d4433', '#e2d3bd').toFixed(2), '6.52');
  assert.equal(contraste('#5d6b65', '#ffffff').toFixed(2), '5.59');
  assert.equal(contraste('#8d9a95', '#1c2225').toFixed(2), '5.51');
});

test('les valeurs du tableau de la conception §1.3 sont reprises à l\'identique', () => {
  const attendu = {
    jour: { fond: '#eef1ec', menu: '#e2d3bd', 'menu-bordure': '#cdb999', carte: '#ffffff', texte: '#22302b', 'texte-2': '#5d6b65', 'texte-menu-2': '#4d4433', accent: '#2f5d50', chaud: '#2f5d50' },
    soir: { fond: '#1c2225', menu: '#151a1c', carte: '#232b2d', texte: '#e8ebe4', 'texte-2': '#8d9a95', 'texte-menu-2': '#8d9a95', accent: '#a9d3ae', chaud: '#f2c57c' },
  };
  for (const [nom, valeurs] of Object.entries(attendu)) {
    for (const [nomJeton, valeur] of Object.entries(valeurs)) assert.equal(THEMES[nom][nomJeton], valeur, `${nom} : --${nomJeton}`);
  }
  assert.deepEqual({ ...THEMES.nuit, 'texte-nuit': undefined }, { ...THEMES.soir, 'texte-nuit': undefined }, 'la nuit reprend l\'Ardoise');
});

test('chaque texte des feuilles atteint 4,5:1 sur le fond où il s\'affiche, dans chaque thème', () => {
  const { paires, manques } = pairesDesFeuilles(toutesLesRegles());
  assert.deepEqual(manques, []);
  assert.ok(paires.length >= 30, `trop peu de paires relevées (${paires.length}) : lecture des feuilles cassée ?`);
  assert.deepEqual(ecartsDeContraste(paires), []);
});

test('témoins : un texte posé sur un autre fond, un fond changé ou un sélecteur oublié sont repérés', () => {
  const avec = (css) => [...toutesLesRegles(), ...regles(css).map((regle) => ({ ...regle, feuille: 'témoin' }))];
  const echoue = (css) => {
    const { paires, manques } = pairesDesFeuilles(avec(css));
    return manques.length > 0 || ecartsDeContraste(paires).length > 0;
  };
  assert.ok(echoue('.menu-pied { color: var(--texte-2); }'), '#5d6b65 sur le menu (3,80:1)');
  assert.ok(echoue('.bouton-maison { background: var(--menu-actif); }'), 'texte hérité sur un bouton vert foncé');
  assert.ok(echoue('.bandeau { background: var(--carte); color: var(--texte-bandeau); }'), 'texte du bandeau sur blanc');
  assert.ok(echoue('.nouveau { color: var(--texte); }'), 'sélecteur absent de PORTEURS');
  assert.equal(echoue('.carte-message { color: var(--texte-2); }'), false, 'une règle conforme passe');
  assert.deepEqual(fondsReels('rgba(255, 255, 255, 0.5)'), ['#808080', '#ffffff'], 'verre blanc à 50 % : gris sur du noir, blanc sur du blanc');
  assert.ok(echoue('.temoin-verre { background: var(--voile); color: var(--texte); }'), 'texte sur un voile à 55 % : illisible sur du clair');
});

test('pastilles des personnes de l\'agenda : 4 couleurs distinctes, chacune à 3:1 au moins du fond, des cartes et de la surbrillance (objet graphique, WCAG 1.4.11)', () => {
  for (const [nomTheme, jetons] of Object.entries(THEMES)) {
    const couleurs = [1, 2, 3, 4].map((n) => jetons[`personne-${n}`]);
    assert.equal(new Set(couleurs).size, 4, `${nomTheme} : 4 couleurs de personne distinctes`);
    for (const couleur of couleurs) {
      for (const fond of ['fond', 'carte', 'surbrillance']) {
        const ratio = contraste(couleur, jetons[fond]);
        assert.ok(ratio >= 3, `${nomTheme} : pastille ${couleur} sur --${fond} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test('couleurs des enfants (config/enfants.json) : distinctes, à 3:1 au moins du fond, des cartes et de la surbrillance (objet graphique), l\'initiale en --texte-pastille à 4,5:1 au moins', () => {
  for (const [nomTheme, jetons] of Object.entries(THEMES)) {
    const couleurs = ['enfant-timo', 'enfant-pablo'].map((nom) => jetons[nom]);
    assert.equal(new Set(couleurs).size, 2, `${nomTheme} : 2 couleurs d'enfant distinctes`);
    for (const couleur of couleurs) {
      for (const fond of ['fond', 'carte', 'surbrillance']) {
        const ratio = contraste(couleur, jetons[fond]);
        assert.ok(ratio >= 3, `${nomTheme} : ${couleur} sur --${fond} = ${ratio.toFixed(2)}:1`);
      }
      const initiale = contraste(jetons['texte-pastille'], couleur);
      assert.ok(initiale >= 4.5, `${nomTheme} : initiale sur ${couleur} = ${initiale.toFixed(2)}:1`);
    }
  }
});

test('pastilles Tempo : bleu, rouge et inconnu (le blanc par son filet --tempo-bord) se détachent à 3:1 au moins des cartes, de la surbrillance d\'aujourd\'hui et du fond ; le liseré rouge aussi (objets graphiques)', () => {
  for (const [nomTheme, jetons] of Object.entries(THEMES)) {
    for (const [pastille, jetonVisible] of [['bleu', 'tempo-bleu'], ['rouge', 'tempo-rouge'], ['inconnu', 'tempo-inconnu'], ['blanc', 'tempo-bord']]) {
      for (const fond of ['carte', 'surbrillance', 'fond']) {
        const ratio = contraste(jetons[jetonVisible], jetons[fond]);
        assert.ok(ratio >= 3, `${nomTheme} : pastille ${pastille} (${jetons[jetonVisible]}) sur --${fond} = ${ratio.toFixed(2)}:1`);
      }
    }
    assert.equal(new Set(['tempo-bleu', 'tempo-blanc', 'tempo-rouge', 'tempo-inconnu'].map((nom) => jetons[nom])).size, 4, `${nomTheme} : 4 couleurs Tempo distinctes`);
  }
});

test('Agenda en grille : la ligne de l\'heure actuelle (--alerte) se détache à 3:1 au moins de la carte et du fond d\'aujourd\'hui (objet graphique)', () => {
  for (const [nomTheme, jetons] of Object.entries(THEMES)) {
    for (const fond of ['carte', 'surbrillance']) {
      const ratio = contraste(jetons.alerte, jetons[fond]);
      assert.ok(ratio >= 3, `${nomTheme} : ligne ${jetons.alerte} sur --${fond} = ${ratio.toFixed(2)}:1`);
    }
  }
});

test('jauge des voitures : remplissage (--accent, --alerte sous 25 %, --texte-2 grisée) et contour (couleur du texte, --texte ou --texte-2) à 3:1 au moins de la carte (objets graphiques)', () => {
  for (const [nomTheme, jetons] of Object.entries(THEMES)) {
    for (const nom of ['accent', 'alerte', 'texte-2', 'texte']) {
      const ratio = contraste(jetons[nom], jetons.carte);
      assert.ok(ratio >= 3, `${nomTheme} : --${nom} ${jetons[nom]} sur --carte = ${ratio.toFixed(2)}:1`);
    }
  }
});

test('écrans des enfants : contours d\'or des étoiles, pièces et anneaux, case faite, coffre, barre du temps, jauge de la boutique et pastilles de l\'historique à 3:1 au moins de ce qui les entoure (objets graphiques)', () => {
  const paires = [
    ['piece-trait', 'carte'], ['piece-trait', 'fond'], ['piece-trait', 'surbrillance'], ['piece-trait', 'sauge-piste'],
    ['accent', 'surbrillance'], ['accent', 'carte'], ['coffre', 'surbrillance'], ['sauge', 'sauge-piste'], ['sauge', 'surbrillance'],
    ['texte-2', 'fond'], ['texte-2', 'carte'],
  ];
  for (const [nomTheme, jetons] of Object.entries(THEMES)) {
    for (const [objet, fond] of paires) {
      const ratio = contraste(jetons[objet], jetons[fond]);
      assert.ok(ratio >= 3, `${nomTheme} : --${objet} ${jetons[objet]} sur --${fond} = ${ratio.toFixed(2)}:1`);
    }
  }
});

test('chaque jeton de texte de jetons.css sert au moins une fois comme color dans les feuilles', () => {
  const utilises = new Set(toutesLesRegles().map(({ declarations }) => jeton(declarations.color)).filter(Boolean));
  for (const [nomTheme, jetons] of Object.entries(THEMES)) {
    for (const nom of Object.keys(jetons).filter((n) => JETONS_DE_TEXTE.test(n))) {
      assert.ok(utilises.has(nom), `${nomTheme} : --${nom} n'est employé par aucune règle color`);
    }
  }
});

test('aucune couleur en dur hors de jetons.css, toute couleur de texte est un jeton, aucune opacité partielle ni @-règle inattendue', () => {
  assert.ok(FEUILLES.length >= 4, 'feuilles de style introuvables');
  for (const feuille of FEUILLES) {
    const css = lireCss(join(DOSSIER_STYLES, feuille));
    assert.ok(!/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i.test(css), `${feuille} : couleur en dur (à mettre dans jetons.css)`);
    for (const [, regle] of css.matchAll(/(@[a-z-]+)/g)) assert.equal(regle, '@font-face', `${feuille} : ${regle} non prévu par ce test`);
    for (const { selecteurs, declarations } of regles(css)) {
      const couleur = declarations.color;
      if (couleur !== undefined && couleur !== 'inherit') assert.ok(jeton(couleur), `${feuille} ${selecteurs} : color: ${couleur} n'est pas un jeton`);
      const opacite = declarations.opacity;
      if (opacite !== undefined) assert.ok(opacite === '0' || opacite === '1', `${feuille} ${selecteurs} : opacity ${opacite} (contraste non contrôlé)`);
    }
  }
});
