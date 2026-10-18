// tests/aujourdhui-dom.test.js
//
// Rôle    : prouver, sur un faux DOM (tests/faux-dom.js), ce que les vues sans DOM ne couvrent pas dans la refonte du
//           14/10 : l'encart « Aujourd'hui » de l'Accueil (badges et nombres, badge d'alerte marqué, étiquette lue,
//           « rien de prévu », ouverture de la page dès le pointerdown), la ligne du ciel de l'Accueil (la pluie
//           seulement s'il en tombe), et l'écran Aujourd'hui : chaque texte de la vue écrit à sa place (titre,
//           températures, pluie d'une période seulement si elle tombe, gamelle, plat, temps, rendez-vous, ligne
//           « Journée », rappels), « + N autres » seulement quand N n'est pas nul, « Rien de prévu » seulement sans
//           rendez-vous ni journée, bande des alertes seulement s'il y en a, horaire en chiffres ou en mot, bouton Recette
//           absent sans recette et qui ouvre la bonne recette au pointerdown.
// Entrées : faux DOM ; vues écrites ici (la forme exacte de vueAujourdhui, prouvée par tests/aujourdhui.test.js), et
//           vueAccueil sur un état vide.
// Sorties : node --test.
// Pièges  : le faux DOM ne propage pas les événements : on déclenche sur le nœud qui porte l'écouteur.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  installerFauxDom, parClasse, poser, texte,
} from './faux-dom.js';

installerFauxDom();
const { creerAccueil } = await import('../web/src/ecrans/accueil.js');
const { vueAccueil } = await import('../web/src/ecrans/accueil-donnees.js');
const { creerAujourdhui } = await import('../web/src/ecrans/aujourdhui.js');
const { encartAujourdhui } = await import('../web/src/ecrans/aujourdhui-donnees.js');

const A_7H15 = Date.parse('2026-10-14T05:15:00Z');
const AVANT_TOUT = {
  ha: null, entites: {}, courses: null, air: null, pluie: null, semaine: null, meteo: null, menu: null, agenda: null,
};
const visibles = (racine, classe) => parClasse(racine, classe).filter((n) => {
  for (let m = n; m; m = m.parentNode) if (m.hidden) return false;
  return true;
});

const THOMAS = { couleur: 1, initiale: 'T', personne: 'Thomas' };
const AGATHE = { couleur: 2, initiale: 'A', personne: 'Agathe' };

function vueJour(autres = {}) {
  return {
    titre: 'Mercredi 14 octobre',
    meteo: { periodes: [{ cle: 'soir', nom: 'Soir', temperature: '15°', picto: 'i-moon', libelle: 'Nuit claire', pluie: null }] },
    rappels: { lignes: [], plus: 0 },
    repas: { message: null, midi: null, soir: { titre: 'Riz cantonais maison', temps: '45 min', repasId: '2026-10-14-soir' } },
    rendezVous: {
      etat: 'ok', lignes: [], plus: 0, journee: null,
    },
    alertes: { lignes: [], plus: 0 },
    ...autres,
  };
}

// Une matinée complète : deux périodes dont une pluvieuse, gamelle et soir, un rendez-vous et une journée, deux rappels.
function vueMatin(autres = {}) {
  return vueJour({
    meteo: {
      periodes: [
        { cle: 'matin', nom: 'Matin', temperature: '14°', picto: 'i-fog', libelle: 'Brouillard', pluie: null },
        { cle: 'apres_midi', nom: 'Après-midi', temperature: '20°', picto: 'i-rain', libelle: 'Pluie', pluie: '0,6 mm' },
      ],
    },
    rappels: { lignes: [{ moment: 'Matin', texte: 'Cuire le riz' }, { moment: 'Soir', texte: 'Sortir le poisson' }], plus: 0 },
    repas: { message: null, midi: { intitule: 'Gamelle', titre: 'Gratin de pâtes' }, soir: { titre: 'Riz cantonais maison', temps: '45 min', repasId: '2026-10-14-soir' } },
    rendezVous: {
      etat: 'ok',
      lignes: [{
        horaire: '09:30', aLHeure: true, titre: 'Dentiste', ...THOMAS,
      }],
      plus: 0,
      journee: { evenements: [{ texte: 'Sortie scolaire', ...AGATHE }], plus: 0 },
    },
    ...autres,
  });
}

test('encart de l\'Accueil : un badge par sujet avec son nombre, alerte marquée, étiquette lue, ouverture au pointerdown', () => {
  const { conteneur } = installerFauxDom();
  const ouverts = [];
  const accueil = creerAccueil(conteneur, {
    ouvrirRecette() {}, ouvrirCourses() {}, ouvrirMinuteurs() {}, ouvrirMaison() {}, ouvrirAujourdhui: () => ouverts.push('aujourdhui'),
  });
  const vue = vueAccueil(AVANT_TOUT, A_7H15);
  accueil.mettreAJour(vue, encartAujourdhui(vueJour({
    rendezVous: {
      etat: 'ok', lignes: [{}, {}], plus: 1, journee: { evenements: [{}], plus: 0 },
    },
    alertes: { lignes: [{}], plus: 0 },
  })));
  const encart = parClasse(conteneur, 'accueil-aujourdhui')[0];
  assert.deepEqual(visibles(conteneur, 'accueil-badge-nombre').map(texte), ['4', '1'], '4 rendez-vous (2 montrés, « + 1 » et une journée sur la page), 1 alerte');
  assert.deepEqual(visibles(conteneur, 'accueil-badge').map((b) => b.classList.contains('accueil-badge-alerte')), [false, true]);
  assert.equal(encart.getAttribute('aria-label'), 'Aujourd\'hui : 4 rendez-vous, 1 alerte');
  assert.equal(visibles(conteneur, 'accueil-aujourdhui-rien').length, 0);
  poser(encart);
  assert.deepEqual(ouverts, ['aujourdhui'], 'navigation dès le pointerdown');
  accueil.mettreAJour(vue, encartAujourdhui(vueJour()));
  assert.equal(visibles(conteneur, 'accueil-badge').length, 0);
  assert.deepEqual(visibles(conteneur, 'accueil-aujourdhui-rien').map(texte), ['rien de prévu']);
});

test('ligne du ciel de l\'Accueil : la pluie dans l\'heure, après sa goutte, seulement s\'il en tombe', () => {
  const { conteneur } = installerFauxDom();
  const accueil = creerAccueil(conteneur, {
    ouvrirRecette() {}, ouvrirCourses() {}, ouvrirMinuteurs() {}, ouvrirMaison() {}, ouvrirAujourdhui() {},
  });
  const encart = encartAujourdhui(vueJour());
  const meteo = (pluie) => ({
    temperature: '13°', picto: 'i-fog', libelle: 'Brouillard', pluie,
  });
  accueil.mettreAJour({ ...vueAccueil(AVANT_TOUT, A_7H15), meteo: meteo(null) }, encart);
  assert.equal(texte(parClasse(conteneur, 'accueil-temperature')[0]), '13°');
  assert.equal(texte(parClasse(conteneur, 'accueil-ciel-libelle')[0]), 'Brouillard');
  assert.equal(visibles(conteneur, 'accueil-pluie').length, 0, 'sec : rien après le ciel');
  accueil.mettreAJour({ ...vueAccueil(AVANT_TOUT, A_7H15), meteo: meteo('0,6 mm dans l\'heure') }, encart);
  const pluie = visibles(conteneur, 'accueil-pluie');
  assert.deepEqual(pluie.map(texte), ['0,6 mm dans l\'heure']);
  assert.equal(parClasse(pluie[0], 'accueil-pluie-icone')[0].firstChild.getAttribute('href'), '#i-drop');
});

test('écran Aujourd\'hui : chaque texte de la vue à sa place, pluie d\'une période seulement si elle tombe, aucun « + N » à zéro', () => {
  const { conteneur } = installerFauxDom();
  const ecran = creerAujourdhui(conteneur, { ouvrirRecette() {} });
  ecran.mettreAJour(vueMatin());
  const carte = (classe) => parClasse(conteneur, classe)[0];
  assert.equal(texte(carte('page-titre')), 'Mercredi 14 octobre');
  assert.deepEqual(visibles(conteneur, 'aujourdhui-periode-nom').map(texte), ['Matin', 'Après-midi'], 'la 3e colonne est masquée');
  assert.deepEqual(visibles(conteneur, 'aujourdhui-periode-temp').map(texte), ['14°', '20°']);
  assert.deepEqual(visibles(conteneur, 'aujourdhui-pluie').map(texte), ['0,6 mm'], 'la pluie de l\'après-midi seulement');
  assert.deepEqual(visibles(conteneur, 'aujourdhui-repas-intitule').map(texte), ['Gamelle', 'Soir']);
  assert.deepEqual(visibles(conteneur, 'aujourdhui-repas-midi').map(texte), ['Gratin de pâtes']);
  assert.deepEqual(visibles(conteneur, 'aujourdhui-plat').map(texte), ['Riz cantonais maison']);
  assert.deepEqual(visibles(conteneur, 'aujourdhui-temps').map(texte), ['45 min']);
  assert.deepEqual(visibles(conteneur, 'aujourdhui-rdv-titre').map(texte), ['Dentiste']);
  assert.deepEqual(visibles(carte('aujourdhui-journee'), 'rdv-texte').map(texte), ['Sortie scolaire'], 'la ligne « Journée » après les rendez-vous à l\'heure');
  assert.equal(visibles(carte('aujourdhui-journee'), 'rdv-plus').length, 0);
  assert.deepEqual(visibles(conteneur, 'aujourdhui-rappel-moment').map(texte), ['Matin', 'Soir']);
  assert.deepEqual(visibles(conteneur, 'aujourdhui-rappel-texte').map(texte), ['Cuire le riz', 'Sortir le poisson']);
  assert.equal(visibles(conteneur, 'aujourdhui-plus').length, 0, 'aucun « + N autres » quand N vaut 0');
  assert.equal(visibles(conteneur, 'aujourdhui-vide').length, 0);
  ecran.mettreAJour(vueMatin({
    meteo: { periodes: [{ cle: 'soir', nom: 'Soir', temperature: '15°', picto: 'i-moon', libelle: 'Nuit claire', pluie: null }] },
    rendezVous: { ...vueMatin().rendezVous, plus: 2, journee: { evenements: [{ texte: 'Vacances', ...AGATHE }, { texte: 'Anniversaire', ...AGATHE }], plus: 1 } },
    rappels: { ...vueMatin().rappels, plus: 1 },
  }));
  assert.equal(visibles(conteneur, 'aujourdhui-pluie').length, 0, 'la goutte de l\'après-midi ne reste pas sur le soir');
  assert.deepEqual(visibles(carte('aujourdhui-rdv'), 'aujourdhui-plus').map(texte), ['+ 2 autres']);
  assert.deepEqual(visibles(carte('aujourdhui-rappels'), 'aujourdhui-plus').map(texte), ['+ 1 autre']);
  assert.deepEqual([visibles(carte('aujourdhui-journee'), 'rdv-texte').map(texte), visibles(carte('aujourdhui-journee'), 'rdv-plus').map(texte)], [['Vacances', 'Anniversaire'], ['+1']]);
});

test('écran Aujourd\'hui : « Rien de prévu » seulement sans rendez-vous ni journée', () => {
  const { conteneur } = installerFauxDom();
  const ecran = creerAujourdhui(conteneur, { ouvrirRecette() {} });
  ecran.mettreAJour(vueMatin({ rendezVous: { ...vueMatin().rendezVous, lignes: [] } }));
  const carteRdv = parClasse(conteneur, 'aujourdhui-rdv')[0];
  assert.equal(visibles(carteRdv, 'aujourdhui-vide').length, 0, 'une journée suffit');
  assert.equal(parClasse(conteneur, 'aujourdhui-journee')[0].hidden, false);
  ecran.mettreAJour(vueJour());
  assert.deepEqual(visibles(carteRdv, 'aujourdhui-vide').map(texte), ['Rien de prévu']);
  assert.equal(parClasse(conteneur, 'aujourdhui-journee')[0].hidden, true);
});

test('écran Aujourd\'hui : bande des alertes seulement s\'il y en a, « + N autres », horaire en chiffres ou en mot', () => {
  const { conteneur } = installerFauxDom();
  const ecran = creerAujourdhui(conteneur, { ouvrirRecette() {} });
  ecran.mettreAJour(vueJour());
  const bande = parClasse(conteneur, 'aujourdhui-alertes')[0];
  const grille = parClasse(conteneur, 'aujourdhui-grille')[0];
  assert.equal(bande.hidden, true);
  assert.ok(!grille.classList.contains('aujourdhui-avec-alertes'));
  assert.deepEqual(visibles(conteneur, 'aujourdhui-vide').map(texte), ['Rien de prévu', 'Rien à prévoir']);
  ecran.mettreAJour(vueJour({
    rendezVous: {
      etat: 'ok',
      lignes: [
        {
          horaire: 'fin 00:30', aLHeure: false, titre: 'Retour', ...AGATHE,
        },
        {
          horaire: '09:30', aLHeure: true, titre: 'Dentiste', ...THOMAS,
        },
      ],
      plus: 0,
      journee: null,
    },
    alertes: { lignes: [{ icone: 'i-print', titre: 'Encre noire', valeur: '12 %' }, { icone: 'i-battery', titre: 'Détecteur du salon', valeur: 'pile faible' }, { icone: 'i-leaf', titre: 'Air', valeur: 'dégradé' }], plus: 2 },
  }));
  assert.equal(bande.hidden, false);
  assert.ok(grille.classList.contains('aujourdhui-avec-alertes'));
  assert.deepEqual(visibles(conteneur, 'aujourdhui-alerte-titre').map(texte), ['Encre noire', 'Détecteur du salon', 'Air']);
  assert.deepEqual(visibles(bande, 'aujourdhui-plus').map(texte), ['+ 2 autres']);
  const horaires = visibles(conteneur, 'aujourdhui-rdv-horaire');
  assert.deepEqual(horaires.map((h) => [texte(h), h.classList.contains('chiffres'), h.classList.contains('aujourdhui-rdv-mot')]), [['fin 00:30', false, true], ['09:30', true, false]]);
  assert.deepEqual(visibles(conteneur, 'pastille-personne').map(texte), ['A', 'T']);
});

test('écran Aujourd\'hui : le bouton Recette ouvre la recette du soir au pointerdown, et n\'existe pas sans recette', () => {
  const { conteneur } = installerFauxDom();
  const ouvertes = [];
  const ecran = creerAujourdhui(conteneur, { ouvrirRecette: (id) => ouvertes.push(id) });
  ecran.mettreAJour(vueJour());
  const bouton = parClasse(conteneur, 'bouton-recette')[0];
  assert.equal(bouton.hidden, false);
  poser(bouton);
  assert.deepEqual(ouvertes, ['2026-10-14-soir']);
  ecran.mettreAJour(vueJour({ repas: { message: null, midi: { intitule: 'Gamelle', titre: 'Gratin' }, soir: { titre: 'Riz', temps: '45 min', repasId: null } } }));
  assert.equal(bouton.hidden, true);
  poser(bouton);
  assert.deepEqual(ouvertes, ['2026-10-14-soir'], 'rien de plus');
  ecran.mettreAJour(vueJour({ repas: { message: 'Menu pas encore publié', midi: null, soir: null } }));
  assert.deepEqual(visibles(conteneur, 'aujourdhui-vide').map(texte)[0], 'Menu pas encore publié');
  assert.equal(visibles(conteneur, 'bouton-recette').length, 0);
});
