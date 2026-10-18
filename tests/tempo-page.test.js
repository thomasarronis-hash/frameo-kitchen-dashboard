// tests/tempo-page.test.js
//
// Rôle    : prouver les règles EDF Tempo de la page (web/src/tempo.js), sans DOM : jour Tempo de 6 h à 6 h, veille d'un
//           rouge ou d'un blanc dès la pré-annonce, heures creuses de 22 h à 6 h, liseré d'un jour rouge de 6 h à 22 h,
//           pastille d'une date, case de la barre du bas, alerte de la page Aujourd'hui et fiche (jours restants, crédit
//           selon la source) ; puis la pastille et la fiche dessinées sur le faux DOM (composants/tempo.js), et l'Accueil :
//           plus de carte « À faire », pastilles d'aujourd'hui et de demain qui ouvrent la fiche, case Tempo à la place du
//           bouton Wi-Fi invités la veille d'un rouge ; période de l'Accueil (1er novembre au 31 mars, bornes comprises,
//           rien de Tempo sur l'Accueil hors période) ; entrée Tempo de la page Aujourd'hui, toute l'année.
// Entrées : valeurs tempo écrites ici au format du flux (serveur/sources/tempo.js) ; heures avec leur décalage de Paris.
// Sorties : node --test.
// Pièges  : le 16/11/2026 est un lundi (veille d'un mardi 17 rouge possible) ; le 25/10 change d'heure à 3 h.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alerteTempo, caseTempo, ficheTempo, jourTempo, pastilleDuJour, tempoSurAccueil, vueTempo,
} from '../web/src/tempo.js';
import { creerFicheTempo, creerPastilleTempo, majPastilleTempo } from '../web/src/composants/tempo.js';
import { creerAccueil } from '../web/src/ecrans/accueil.js';
import { vueAccueil } from '../web/src/ecrans/accueil-donnees.js';
import { creerAujourdhui } from '../web/src/ecrans/aujourdhui.js';
import { encartAujourdhui, vueAujourdhui } from '../web/src/ecrans/aujourdhui-donnees.js';
import {
  installerFauxDom, parClasse, poser, texte,
} from './faux-dom.js';

const a = (texteHeure) => Date.parse(texteHeure);
const tempo = (jours, autres = {}) => ({
  jours, restants: { rouge: 21, blanc: 40, bleu: 250 }, saison: '2026-2027', source: 'rte', lu_le: '2026-11-16T06:40:00.000Z', ...autres,
});
const LUNDI_MARDI_ROUGE = tempo([{ date: '2026-11-16', couleur: 'blanc', statut: 'confirme' }, { date: '2026-11-17', couleur: 'rouge', statut: 'provisoire' }]);
const MARDI_ROUGE = tempo([{ date: '2026-11-17', couleur: 'rouge', statut: 'confirme' }, { date: '2026-11-18', couleur: 'bleu', statut: 'confirme' }]);

test('jour Tempo de 6 h à 6 h, à l\'heure de Paris', () => {
  assert.equal(jourTempo(a('2026-11-17T05:59:00+01:00')), '2026-11-16');
  assert.equal(jourTempo(a('2026-11-17T06:00:00+01:00')), '2026-11-17');
  assert.equal(jourTempo(a('2026-10-25T05:59:00+01:00')), '2026-10-24');
});

test('veille d\'un rouge dès la pré-annonce ; heures creuses à partir de 22 h, et encore avant 6 h', () => {
  const matin = vueTempo(LUNDI_MARDI_ROUGE, a('2026-11-16T07:40:00+01:00'));
  assert.deepEqual([matin.aujourdhui.couleur, matin.demain.couleur, matin.demain.statut, matin.veille, matin.creuses], ['blanc', 'rouge', 'provisoire', 'rouge', false]);
  assert.equal(vueTempo(LUNDI_MARDI_ROUGE, a('2026-11-16T21:59:00+01:00')).creuses, false);
  assert.equal(vueTempo(LUNDI_MARDI_ROUGE, a('2026-11-16T22:00:00+01:00')).creuses, true);
  const nuit = vueTempo(LUNDI_MARDI_ROUGE, a('2026-11-17T05:30:00+01:00'));
  assert.deepEqual([nuit.aujourdhui.date, nuit.veille, nuit.creuses, nuit.liseret], ['2026-11-16', 'rouge', true, false], 'à 5 h 30, c\'est encore la nuit d\'avant le rouge');
});

test('liseré d\'un jour rouge de 6 h à 22 h seulement', () => {
  assert.equal(vueTempo(MARDI_ROUGE, a('2026-11-17T05:59:00+01:00')).liseret, false);
  assert.equal(vueTempo(MARDI_ROUGE, a('2026-11-17T06:00:00+01:00')).liseret, true);
  assert.equal(vueTempo(MARDI_ROUGE, a('2026-11-17T21:59:00+01:00')).liseret, true);
  assert.equal(vueTempo(MARDI_ROUGE, a('2026-11-17T22:00:00+01:00')).liseret, false);
  assert.equal(vueTempo(MARDI_ROUGE, a('2026-11-18T12:00:00+01:00')).liseret, false, 'le lendemain bleu');
});

test('pastille d\'une date : couleur et pointillés si pré-annoncée, « ? » si inconnue ou pas encore lue', () => {
  assert.deepEqual(pastilleDuJour(LUNDI_MARDI_ROUGE, '2026-11-16'), { couleur: 'blanc', provisoire: false, etiquette: 'Tempo : blanc' });
  assert.deepEqual(pastilleDuJour(LUNDI_MARDI_ROUGE, '2026-11-17'), { couleur: 'rouge', provisoire: true, etiquette: 'Tempo : rouge, pré-annonce' });
  assert.deepEqual(pastilleDuJour(LUNDI_MARDI_ROUGE, '2026-11-18'), { couleur: null, provisoire: false, etiquette: 'Tempo : pas encore connu' });
  assert.equal(pastilleDuJour(null, '2026-11-16').couleur, null);
});

test('case de la barre du bas et alerte : rouge ou blanc seulement, « Heures creuses, les machines ! » à 22 h ; rien la veille d\'un bleu', () => {
  const lundi = (heure) => vueTempo(LUNDI_MARDI_ROUGE, a(`2026-11-16T${heure}:00+01:00`));
  assert.deepEqual(caseTempo(lundi('10:00')), { couleur: 'rouge', creuses: false, nom: 'Demain rouge', detail: null });
  assert.deepEqual(caseTempo(lundi('22:30')), { couleur: 'rouge', creuses: true, nom: 'Heures creuses,', detail: 'les machines !' });
  assert.deepEqual(alerteTempo(lundi('10:00')), { icone: 'i-eclair', titre: 'Demain rouge', valeur: 'machines après 22 h' });
  assert.deepEqual(alerteTempo(lundi('22:30')).valeur, 'lancer les machines');
  const veilleBleu = vueTempo(MARDI_ROUGE, a('2026-11-17T10:00:00+01:00'));
  assert.equal(caseTempo(veilleBleu), null);
  assert.equal(alerteTempo(veilleBleu), null);
  assert.equal(caseTempo(vueTempo(null, a('2026-11-16T10:00:00+01:00'))), null);
});

test('fiche : aujourd\'hui, demain (pré-annonce dite), jours restants rouge, blanc, bleu, fin du rouge à 22 h, crédit selon la source', () => {
  const fiche = ficheTempo(vueTempo(LUNDI_MARDI_ROUGE, a('2026-11-16T07:40:00+01:00')));
  assert.deepEqual(fiche, {
    jours: [
      { nom: 'Aujourd\'hui', couleur: 'blanc', texte: 'Blanc', note: null, provisoire: false },
      { nom: 'Demain', couleur: 'rouge', texte: 'Rouge', note: 'pré-annonce', provisoire: true },
    ],
    restants: [{ couleur: 'rouge', nombre: 21 }, { couleur: 'blanc', nombre: 40 }, { couleur: 'bleu', nombre: 250 }],
    finRouge: null,
    credit: 'Source : RTE',
  });
  assert.equal(ficheTempo(vueTempo(MARDI_ROUGE, a('2026-11-17T09:00:00+01:00'))).finRouge, 'Jour rouge jusqu\'à 22 h');
  assert.equal(ficheTempo(vueTempo({ ...MARDI_ROUGE, source: 'api-couleur-tempo' }, a('2026-11-17T09:00:00+01:00'))).credit, 'Source : api-couleur-tempo.fr (données RTE)');
  assert.equal(ficheTempo(vueTempo({ ...MARDI_ROUGE, source: 'disque' }, a('2026-11-17T09:00:00+01:00'))).credit, 'Dernière lecture : 16 novembre à 07:40');
  const vide = ficheTempo(vueTempo(null, a('2026-11-17T09:00:00+01:00')));
  assert.deepEqual([vide.jours[0].texte, vide.restants, vide.credit], ['Pas encore connu', null, 'Pas encore lu']);
});

test('pastille et fiche sur le faux DOM : classes de couleur, pointillés, « ? », étiquette ; la fiche se referme au premier toucher', () => {
  const { conteneur } = installerFauxDom();
  const pastille = creerPastilleTempo('tempo-pastille-semaine');
  majPastilleTempo(pastille, { couleur: 'rouge', provisoire: true, etiquette: 'Tempo : rouge, pré-annonce' });
  assert.equal(pastille.className, 'tempo-pastille tempo-pastille-semaine tempo-rouge tempo-provisoire');
  assert.deepEqual([pastille.childNodes[0].hidden, pastille.childNodes[1].hidden, pastille.getAttribute('aria-label')], [false, true, 'Tempo : rouge, pré-annonce']);
  majPastilleTempo(pastille, { couleur: null, provisoire: false, etiquette: 'Tempo : pas encore connu' });
  assert.equal(pastille.className, 'tempo-pastille tempo-pastille-semaine tempo-inconnu');
  assert.deepEqual([pastille.childNodes[0].hidden, texte(pastille.childNodes[1]), pastille.childNodes[1].hidden], [true, '?', false]);
  const fiche = creerFicheTempo(conteneur);
  const couche = parClasse(conteneur, 'tempo-fiche-couche')[0];
  assert.equal(couche.hidden, true);
  fiche.ouvrir(ficheTempo(vueTempo(LUNDI_MARDI_ROUGE, a('2026-11-16T07:40:00+01:00'))));
  assert.equal(couche.hidden, false);
  assert.deepEqual(parClasse(couche, 'tempo-fiche-couleur').map(texte), ['Blanc', 'Rouge']);
  assert.deepEqual(parClasse(couche, 'tempo-fiche-note').map((n) => [n.hidden, texte(n)]), [[true, ''], [false, 'pré-annonce']]);
  assert.deepEqual(parClasse(couche, 'tempo-compteur-nombre').map(texte), ['21', '40', '250']);
  assert.match(texte(couche), /Heures creuses de 22 h à 6 h/);
  poser(couche);
  assert.equal(couche.hidden, true);
});

test('Accueil : plus de carte « À faire » ; pastilles d\'aujourd\'hui et de demain, qui ouvrent la fiche ; case « Demain rouge » à la place du Wi-Fi invités', () => {
  const { conteneur } = installerFauxDom();
  const accueil = creerAccueil(conteneur, {
    ouvrirRecette() {}, ouvrirCourses() {}, ouvrirMinuteurs() {}, ouvrirMaison() {}, ouvrirAujourdhui() {},
  });
  const ms = a('2026-11-16T07:40:00+01:00');
  const jours = ['2026-11-16', '2026-11-17', '2026-11-18'].map((date, i) => ({
    date, code_ciel: 3, temperature_2m_max: 9 - i, temperature_2m_min: 2, precipitation_sum: 0, wind_speed_10m_max: 5,
  }));
  const donnees = {
    ha: 'ok', entites: {}, courses: null, air: null, pluie: null, meteo: null, menu: null, agenda: null,
    semaine: { unites: { temperature_2m_max: '°C' }, jours }, tempo: LUNDI_MARDI_ROUGE,
  };
  accueil.mettreAJour(vueAccueil(donnees, ms), encartAujourdhui(vueAujourdhui(donnees, ms)));
  const visibles = (classe) => parClasse(conteneur, classe).filter((n) => {
    for (let m = n; m; m = m.parentNode) if (m.hidden) return false;
    return true;
  });
  assert.equal(parClasse(conteneur, 'carte-a-faire').length, 0);
  assert.equal(parClasse(conteneur, 'accueil-cartes')[0].childNodes.length, 2, 'Courses et Air et pollens');
  const zones = visibles('tempo-zone');
  assert.equal(zones.length, 2, 'aujourd\'hui et demain seulement');
  assert.deepEqual(zones.map((z) => z.getAttribute('aria-label')), ['Tempo : blanc', 'Tempo : rouge, pré-annonce']);
  assert.deepEqual(visibles('bouton-nom').map(texte), ['Minuteur', 'Alarme', 'Demain rouge', 'Apple TV'], 'Wi-Fi invités cède sa place');
  assert.ok(visibles('case-tempo')[0].classList.contains('case-tempo-rouge'));
  const couche = parClasse(conteneur, 'tempo-fiche-couche')[0];
  poser(zones[1]);
  assert.equal(couche.hidden, false, 'la pastille ouvre la fiche dès le pointerdown');
  poser(couche);
  assert.equal(couche.hidden, true);
  poser(visibles('case-tempo')[0]);
  assert.equal(couche.hidden, false, 'la case aussi');
  accueil.entrer();
  assert.equal(couche.hidden, true, 'revenir à l\'Accueil (après 60 s sans toucher, ou par le menu) referme la fiche');
  const sansVeille = { ...donnees, tempo: tempo([{ date: '2026-11-17', couleur: 'bleu', statut: 'confirme' }]) };
  accueil.mettreAJour(vueAccueil(sansVeille, ms), encartAujourdhui(vueAujourdhui(sansVeille, ms)));
  assert.deepEqual(visibles('bouton-nom').map(texte), ['Minuteur', 'Alarme', 'Wi-Fi invités', 'Apple TV']);
});

test('période de l\'Accueil : du 1er novembre au 31 mars (jour Tempo, bornes comprises) ; hors période, ni case ni liseré, l\'alerte reste', () => {
  assert.deepEqual([
    tempoSurAccueil(a('2026-10-31T12:00:00+01:00')), tempoSurAccueil(a('2026-11-01T06:00:00+01:00')),
    tempoSurAccueil(a('2027-03-31T21:00:00+02:00')), tempoSurAccueil(a('2027-04-01T12:00:00+02:00')),
  ], [false, true, true, false]);
  assert.equal(tempoSurAccueil(a('2026-11-01T05:59:00+01:00')), false, 'avant 6 h, le jour Tempo est encore le 31 octobre');
  assert.equal(tempoSurAccueil(a('2027-04-01T05:30:00+02:00')), true, 'avant 6 h, encore le 31 mars');
  const veilleBlanc = tempo([{ date: '2026-10-14', couleur: 'bleu', statut: 'confirme' }, { date: '2026-10-15', couleur: 'blanc', statut: 'provisoire' }]);
  const octobre = vueTempo(veilleBlanc, a('2026-10-14T18:00:00+02:00'));
  assert.deepEqual([octobre.accueil, octobre.veille, caseTempo(octobre)], [false, 'blanc', null], 'pas de case « Demain blanc » sur l\'Accueil en octobre');
  assert.deepEqual(alerteTempo(octobre), { icone: 'i-eclair', titre: 'Demain blanc', valeur: 'machines après 22 h' }, 'l\'alerte de la page Aujourd\'hui reste');
  const rougeAvril = vueTempo(tempo([{ date: '2027-04-01', couleur: 'rouge', statut: 'confirme' }]), a('2027-04-01T09:00:00+02:00'));
  assert.equal(rougeAvril.liseret, false, 'liseré seulement dans la période');
});

test('Accueil hors période (14/10) : aucune pastille Tempo dans « La semaine », Wi-Fi invités même la veille d\'un blanc ; la page Aujourd\'hui garde l\'entrée de la fiche', () => {
  const { conteneur } = installerFauxDom();
  const accueil = creerAccueil(conteneur, {
    ouvrirRecette() {}, ouvrirCourses() {}, ouvrirMinuteurs() {}, ouvrirMaison() {}, ouvrirAujourdhui() {},
  });
  const ms = a('2026-10-14T18:00:00+02:00');
  const jours = ['2026-10-14', '2026-10-15'].map((date) => ({
    date, code_ciel: 3, temperature_2m_max: 18, temperature_2m_min: 9, precipitation_sum: 0, wind_speed_10m_max: 5,
  }));
  const donnees = {
    ha: 'ok', entites: {}, courses: null, air: null, pluie: null, meteo: null, menu: null, agenda: null,
    semaine: { unites: { temperature_2m_max: '°C' }, jours },
    tempo: tempo([{ date: '2026-10-14', couleur: 'bleu', statut: 'confirme' }, { date: '2026-10-15', couleur: 'blanc', statut: 'provisoire' }]),
  };
  const vue = vueAccueil(donnees, ms);
  assert.deepEqual([vue.semaine.map((j) => j.tempo), vue.tempo], [[null, null], null]);
  accueil.mettreAJour(vue, encartAujourdhui(vueAujourdhui(donnees, ms)));
  const visibles = (racine, classe) => parClasse(racine, classe).filter((n) => {
    for (let m = n; m; m = m.parentNode) if (m.hidden) return false;
    return true;
  });
  assert.equal(visibles(conteneur, 'tempo-zone').length, 0);
  assert.deepEqual(visibles(conteneur, 'bouton-nom').map(texte), ['Minuteur', 'Alarme', 'Wi-Fi invités', 'Apple TV']);
  const page = installerFauxDom().conteneur;
  const aujourdhui = creerAujourdhui(page, { ouvrirRecette() {} });
  const vueJour = vueAujourdhui(donnees, ms);
  assert.deepEqual(vueJour.tempo.pastille, { couleur: 'bleu', provisoire: false, etiquette: 'Tempo : bleu' });
  assert.deepEqual(vueJour.alertes.lignes.map((l) => l.titre), ['Demain blanc']);
  aujourdhui.mettreAJour(vueJour);
  const entree = visibles(page, 'aujourdhui-tempo')[0];
  assert.equal(entree.getAttribute('aria-label'), 'Fiche Tempo, Tempo : bleu');
  const couche = parClasse(page, 'tempo-fiche-couche')[0];
  poser(entree);
  assert.equal(couche.hidden, false, 'la fiche s\'ouvre toute l\'année depuis la page Aujourd\'hui');
  assert.deepEqual(parClasse(couche, 'tempo-fiche-couleur').map(texte), ['Bleu', 'Blanc']);
  aujourdhui.entrer();
  assert.equal(couche.hidden, true, 'revenir sur la page referme la fiche');
  aujourdhui.mettreAJour(vueAujourdhui({ ...donnees, tempo: null }, ms));
  assert.equal(visibles(page, 'aujourdhui-tempo').length, 0, 'pas encore lu : pas d\'entrée');
});
