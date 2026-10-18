// tests/tempo.test.js
//
// Rôle    : prouver EDF Tempo côté serveur : les règles fixes (serveur/sources/tempo-calendrier.js : jour Tempo de 6 h à
//           6 h, saison d'après demain, couleurs impossibles, pré-annonce ou confirmation par l'heure de lecture, jours
//           restants, rythme de lecture) et la source (serveur/sources/tempo.js : RTE d'abord, repli
//           api-couleur-tempo.fr, filet tempo.json, couleur absurde rejetée, plafond de taille, User-Agent honnête,
//           relance 15 min après un échec complet).
// Entrées : réponses réelles enregistrées le 14/10/2026 à 9 h 20 (heure de Paris) : tests/fixtures/tempo-rte-light.json,
//           tempo-rte-saison-2026-2027.json, tempo-repli-aujourdhui.json, tempo-repli-demain.json, tempo-repli-stats.json ;
//           et tempo-rte-saison-2025-2026.json (saison complète lue chez RTE le 14/10 à 7 h 38 : 300 bleus, 43 blancs,
//           22 rouges). Un faux fetch (Response de Node) et une horloge injectée ; un dossier d'état temporaire.
// Sorties : node --test.
// Pièges  :
//   - Aucune requête réseau : le faux fetch répond selon l'URL, ou échoue sur commande.
//   - Les heures sont écrites avec leur décalage (+02:00 l'été, +01:00 l'hiver) : la règle de 10 h 40 et le jour de 6 h
//     se jugent à l'heure de Paris, pas en UTC.

import assert from 'node:assert/strict';
import {
  mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  compterRestants, couleurPlausible, joursDeSaison, jourTempo, prochaineLecture, saisonDe, statutCouleur,
} from '../serveur/sources/tempo-calendrier.js';
import {
  SourceTempo, URL_REPLI, URL_RTE_JOURS, urlRteSaison,
} from '../serveur/sources/tempo.js';

const lire = (nom) => JSON.parse(readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), 'utf8'));
const LIGHT = lire('tempo-rte-light.json');
const SAISON = lire('tempo-rte-saison-2026-2027.json');
const SAISON_PASSEE = lire('tempo-rte-saison-2025-2026.json');
const REPLI = { [URL_REPLI.aujourdhui]: lire('tempo-repli-aujourdhui.json'), [URL_REPLI.demain]: lire('tempo-repli-demain.json'), [URL_REPLI.stats]: lire('tempo-repli-stats.json') };
const ms = (texte) => Date.parse(texte);
const iso = (texte) => new Date(ms(texte)).toISOString();

// --- Règles fixes ---

test('jour Tempo de 6 h à 6 h, à l\'heure de Paris (nuit du changement d\'heure comprise)', () => {
  assert.equal(jourTempo(ms('2026-10-15T05:59:00+02:00')), '2026-10-14');
  assert.equal(jourTempo(ms('2026-10-15T06:00:00+02:00')), '2026-10-15');
  assert.equal(jourTempo(ms('2026-10-25T05:30:00+01:00')), '2026-10-24', '25/10, heure d\'hiver depuis 3 h');
  assert.equal(jourTempo(ms('2026-10-25T06:00:00+01:00')), '2026-10-25');
});

test('saison du 1er septembre au 31 août ; 301 bleus quand elle a un 29 février', () => {
  assert.equal(saisonDe('2026-08-31'), '2025-2026');
  assert.equal(saisonDe('2026-09-01'), '2026-2027');
  assert.equal(saisonDe('2027-03-31'), '2026-2027');
  assert.deepEqual(joursDeSaison('2026-2027'), { rouge: 22, blanc: 43, bleu: 300 });
  assert.deepEqual(joursDeSaison('2027-2028'), { rouge: 22, blanc: 43, bleu: 301 });
});

test('règles fixes : dimanche toujours bleu, pas de rouge le week-end, un férié d\'hiver, ni d\'avril à octobre', () => {
  assert.equal(couleurPlausible('2026-10-18', 'blanc'), false, 'dimanche blanc');
  assert.equal(couleurPlausible('2026-12-20', 'rouge'), false, 'dimanche rouge');
  assert.equal(couleurPlausible('2026-10-18', 'bleu'), true);
  assert.equal(couleurPlausible('2026-11-14', 'rouge'), false, 'samedi rouge');
  assert.equal(couleurPlausible('2026-11-14', 'blanc'), true, 'samedi blanc');
  for (const date of ['2026-10-14', '2027-04-01', '2027-05-03', '2026-09-15']) assert.equal(couleurPlausible(date, 'rouge'), false, date);
  for (const date of ['2026-11-11', '2026-12-25', '2027-01-01']) assert.equal(couleurPlausible(date, 'rouge'), false, date);
  assert.equal(couleurPlausible('2027-03-29', 'rouge'), false, 'lundi de Pâques 2027 (Pâques le 28 mars)');
  assert.equal(couleurPlausible('2027-03-30', 'rouge'), true);
  assert.equal(couleurPlausible('2026-11-16', 'rouge'), true, 'lundi de novembre');
});

test('règles fixes : la vraie saison 2025-2026 de RTE passe entière (aucun faux rejet), et ses jours restants tombent à 0', () => {
  const couleurs = Object.entries(SAISON_PASSEE.values).filter(([cle]) => !cle.endsWith('-fallback'))
    .map(([date, valeur]) => [date, { BLUE: 'bleu', WHITE: 'blanc', RED: 'rouge' }[valeur]]);
  assert.equal(couleurs.length, 365);
  assert.deepEqual(couleurs.filter(([date, couleur]) => !couleurPlausible(date, couleur)), []);
  assert.deepEqual(compterRestants(couleurs, '2025-2026'), { rouge: 0, blanc: 0, bleu: 0 });
  assert.deepEqual(compterRestants(couleurs, '2026-2027'), { rouge: 22, blanc: 43, bleu: 300 }, 'dates hors saison ignorées');
});

test('pré-annonce ou confirmation : lue la veille avant 10 h 40, provisoire ; à partir de 10 h 40 ou le jour même, confirmée', () => {
  assert.equal(statutCouleur('2026-10-15', ms('2026-10-14T07:31:00+02:00')), 'provisoire', 'pré-annonce de 7 h 31 (constatée le 14/10)');
  assert.equal(statutCouleur('2026-10-15', ms('2026-10-14T10:39:00+02:00')), 'provisoire');
  assert.equal(statutCouleur('2026-10-15', ms('2026-10-14T10:40:00+02:00')), 'confirme');
  assert.equal(statutCouleur('2026-10-15', ms('2026-10-15T06:05:00+02:00')), 'confirme');
  assert.equal(statutCouleur('2026-10-15', ms('2026-10-13T23:00:00+02:00')), 'provisoire');
});

test('rythme : 6 h 05 puis toutes les 30 min tant que demain est inconnu ; 10 h 45, 11 h 15, 12 h 30 quoi qu\'il arrive', () => {
  const suivante = (quand, connu) => iso(new Date(prochaineLecture(ms(quand), connu)).toISOString());
  assert.equal(suivante('2026-10-14T07:31:00+02:00', false), iso('2026-10-14T07:35:00+02:00'));
  assert.equal(suivante('2026-10-14T07:31:00+02:00', true), iso('2026-10-14T10:45:00+02:00'));
  assert.equal(suivante('2026-10-14T10:45:00+02:00', true), iso('2026-10-14T11:15:00+02:00'));
  assert.equal(suivante('2026-10-14T11:20:00+02:00', true), iso('2026-10-14T12:30:00+02:00'));
  assert.equal(suivante('2026-10-14T12:30:00+02:00', true), iso('2026-10-15T06:05:00+02:00'));
  assert.equal(suivante('2026-10-14T23:50:00+02:00', false), iso('2026-10-15T06:05:00+02:00'));
  assert.equal(suivante('2026-10-14T04:00:00+02:00', false), iso('2026-10-14T06:05:00+02:00'));
  assert.equal(suivante('2026-10-25T00:30:00+02:00', true), iso('2026-10-25T06:05:00+01:00'), 'nuit du passage à l\'heure d\'hiver');
  let lectures = 0;
  for (let t = ms('2026-10-14T00:00:00+02:00'); t < ms('2026-10-15T00:00:00+02:00'); t = prochaineLecture(t, false)) lectures += 1;
  assert.ok(lectures <= 40, `${lectures} lectures sur une journée où demain n'arrive jamais`);
});

// --- Source ---

function journalCapture() {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(m), warn: (m) => lignes.push(m), error: (m) => lignes.push(m) };
}

function dossierEtat(t) {
  const racine = mkdtempSync(join(tmpdir(), 'cadre-tempo-'));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  return join(racine, 'etat');
}

// Faux fetch : réponses par URL (objet JSON, texte brut ou statut d'erreur), pannes par préfixe d'URL.
function fauxFetch(reponses, pannes = {}) {
  const appels = [];
  const requete = async (url, options) => {
    appels.push({ url, options });
    const panne = Object.keys(pannes).find((debut) => url.startsWith(debut));
    if (panne) {
      if (pannes[panne] === 'reseau') throw new TypeError('fetch failed');
      return new Response('{"erreur":true}', { status: pannes[panne] });
    }
    if (!(url in reponses)) return new Response('introuvable', { status: 404 });
    const corps = reponses[url];
    return new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { appels, requete, urls: () => appels.map((a) => a.url) };
}

// Laisse tourner la boucle (lectures de fichiers et faux fetch compris) jusqu'à la condition, sans minuterie (simulées).
async function attendre(condition) {
  for (let i = 0; i < 5000 && !condition(); i += 1) await new Promise((resoudre) => setImmediate(resoudre));
  assert.ok(condition(), 'condition jamais remplie');
  for (let i = 0; i < 5; i += 1) await new Promise((resoudre) => setImmediate(resoudre));
}

const REPONSES_DU_14 = { [URL_RTE_JOURS]: LIGHT, [urlRteSaison('2026-2027')]: SAISON, ...REPLI };

function source(t, { dossier = dossierEtat(t), reponses = REPONSES_DU_14, pannes = {}, quand }) {
  const horloge = { t: ms(quand) };
  const faux = fauxFetch(reponses, pannes);
  const journal = journalCapture();
  const tempo = new SourceTempo({
    dossier, journal, version: '9.9.9', requete: faux.requete, maintenant: () => horloge.t,
  });
  t.after(() => tempo.arreter());
  return {
    tempo, faux, journal, horloge, dossier,
  };
}

test('RTE du 14/10 à 9 h 20 : aujourd\'hui bleu confirmé, demain bleu pré-annoncé, 22 rouges, 43 blancs, 255 bleus restants', async (t) => {
  const { tempo, faux, dossier } = source(t, { quand: '2026-10-14T09:20:00+02:00' });
  await tempo.actualiser();
  assert.deepEqual(tempo.valeur, {
    jours: [{ date: '2026-10-14', couleur: 'bleu', statut: 'confirme' }, { date: '2026-10-15', couleur: 'bleu', statut: 'provisoire' }],
    restants: { rouge: 22, blanc: 43, bleu: 255 },
    saison: '2026-2027',
    source: 'rte',
    lu_le: iso('2026-10-14T09:20:00+02:00'),
  });
  assert.deepEqual(faux.urls(), [URL_RTE_JOURS, urlRteSaison('2026-2027')], 'le repli n\'est pas interrogé');
  const { headers } = faux.appels[0].options;
  assert.match(headers['user-agent'], /^cadre-cuisine\/9\.9\.9 \(ecran de cuisine familial/);
  assert.match(headers['user-agent'], /^[\x20-\x7e]+$/, 'User-Agent en ASCII');
  assert.equal(faux.appels[0].options.redirect, 'error');
  const disque = JSON.parse(readFileSync(join(dossier, 'tempo.json'), 'utf8'));
  assert.deepEqual(Object.keys(disque.couleurs), ['2026-10-14', '2026-10-15']);
  assert.equal(disque.source, 'rte');
});

test('confirmation après 10 h 40 sans relire la saison ; saison relue une fois après 11 h 15', async (t) => {
  const { tempo, faux, horloge } = source(t, { quand: '2026-10-14T09:20:00+02:00' });
  await tempo.actualiser();
  horloge.t = ms('2026-10-14T10:45:00+02:00');
  await tempo.actualiser();
  assert.equal(tempo.valeur.jours[1].statut, 'confirme');
  horloge.t = ms('2026-10-14T11:15:00+02:00');
  await tempo.actualiser();
  horloge.t = ms('2026-10-14T12:30:00+02:00');
  await tempo.actualiser();
  assert.deepEqual(faux.urls().filter((url) => url.includes('season')).length, 2, 'au démarrage, puis à 11 h 15 seulement');
  assert.equal(faux.urls().filter((url) => url === URL_RTE_JOURS).length, 4);
});

test('RTE en panne (HTTP 500, réseau, format inconnu, réponse trop grosse) : repli sur api-couleur-tempo.fr, demain retiré de ses restants', async (t) => {
  const pannes = [
    { pannes: { [URL_RTE_JOURS]: 500 } },
    { pannes: { [URL_RTE_JOURS]: 'reseau' } },
    { reponses: { ...REPONSES_DU_14, [URL_RTE_JOURS]: { values: { '2026-10-14': 'VIOLET' } } } },
    { reponses: { ...REPONSES_DU_14, [URL_RTE_JOURS]: `{"values":{},"x":"${'a'.repeat(9000)}"}` } },
  ];
  for (const cas of pannes) {
    const { tempo, faux, journal } = source(t, { quand: '2026-10-14T09:20:00+02:00', ...cas });
    await tempo.actualiser();
    assert.deepEqual(tempo.valeur.jours.map((j) => [j.date, j.couleur]), [['2026-10-14', 'bleu'], ['2026-10-15', 'bleu']], JSON.stringify(cas).slice(0, 60));
    assert.equal(tempo.valeur.source, 'api-couleur-tempo');
    assert.deepEqual(tempo.valeur.restants, { rouge: 22, blanc: 43, bleu: 255 }, 'stats : 256 bleus, moins demain déjà connu');
    assert.deepEqual(faux.urls().slice(1).sort(), [URL_REPLI.aujourdhui, URL_REPLI.demain, URL_REPLI.stats].sort());
    assert.match(journal.lignes.join('\n'), /RTE illisible/);
  }
});

test('les deux sources en panne : couleurs connues gardées, filet tempo.json relu au redémarrage (« disque »), relance dans 15 min', async (t) => {
  const dossier = dossierEtat(t);
  const premier = source(t, { dossier, quand: '2026-10-14T09:20:00+02:00' });
  await premier.tempo.actualiser();
  const toutEnPanne = { [URL_RTE_JOURS.slice(0, 30)]: 503, 'https://www.api-couleur-tempo.fr': 'reseau' };
  const apres = source(t, { dossier, pannes: toutEnPanne, quand: '2026-10-14T13:00:00+02:00' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  apres.tempo.demarrer();
  await attendre(() => /illisible aussi/.test(apres.journal.lignes.join('\n')));
  assert.equal(apres.tempo.valeur.source, 'disque');
  assert.equal(apres.tempo.valeur.lu_le, iso('2026-10-14T09:20:00+02:00'));
  assert.deepEqual(apres.tempo.valeur.jours.map((j) => j.couleur), ['bleu', 'bleu']);
  assert.deepEqual(apres.tempo.valeur.restants, { rouge: 22, blanc: 43, bleu: 255 });
  assert.match(apres.journal.lignes.join('\n'), /illisible aussi/);
  const avant = apres.faux.appels.length;
  t.mock.timers.tick(15 * 60_000 - 1);
  assert.equal(apres.faux.appels.length, avant, 'pas de relance avant 15 min');
  t.mock.timers.tick(1);
  await attendre(() => apres.faux.appels.length > avant);
});

test('couleur absurde rejetée (rouge un samedi, blanc un dimanche), journalisée une fois ; mode secours de RTE journalisé', async (t) => {
  const reponses = {
    ...REPONSES_DU_14,
    [URL_RTE_JOURS]: { values: { '2026-11-14': 'RED', '2026-11-14-fallback': 'false', '2026-11-15': 'WHITE', '2026-11-15-fallback': 'true' } },
    [urlRteSaison('2026-2027')]: SAISON,
  };
  const { tempo, journal } = source(t, { reponses, quand: '2026-11-14T08:00:00+01:00' });
  await tempo.actualiser();
  await tempo.actualiser();
  assert.deepEqual(tempo.valeur.jours, []);
  const texte = journal.lignes.join('\n');
  assert.equal(texte.match(/rouge le 2026-11-14 annoncé par RTE est impossible/g).length, 1);
  assert.match(texte, /blanc le 2026-11-15 annoncé par RTE est impossible/);
  assert.match(texte, /2026-11-15 en mode secours chez RTE/);
});

test('veille d\'un rouge dès la pré-annonce : demain rouge, statut provisoire avant 10 h 40', async (t) => {
  const reponses = {
    [URL_RTE_JOURS]: { values: { '2026-11-16': 'WHITE', '2026-11-16-fallback': 'false', '2026-11-17': 'RED', '2026-11-17-fallback': 'false' } },
    [urlRteSaison('2026-2027')]: SAISON,
  };
  const { tempo } = source(t, { reponses, quand: '2026-11-16T07:40:00+01:00' });
  await tempo.actualiser();
  assert.deepEqual(tempo.valeur.jours, [
    { date: '2026-11-16', couleur: 'blanc', statut: 'confirme' },
    { date: '2026-11-17', couleur: 'rouge', statut: 'provisoire' },
  ]);
});

test('31 août : la saison lue est celle de demain (1er septembre) ; entre minuit et 6 h, le jour Tempo est encore la veille', async (t) => {
  const aout = source(t, { reponses: { [URL_RTE_JOURS]: { values: { '2027-08-31': 'BLUE', '2027-09-01': 'BLUE' } }, [urlRteSaison('2027-2028')]: { values: {} } }, quand: '2027-08-31T12:00:00+02:00' });
  await aout.tempo.actualiser();
  assert.deepEqual(aout.faux.urls(), [URL_RTE_JOURS, urlRteSaison('2027-2028')]);
  assert.deepEqual(aout.tempo.valeur.restants, { rouge: 22, blanc: 43, bleu: 301 });
  const nuit = source(t, { quand: '2026-10-15T05:30:00+02:00' });
  await nuit.tempo.actualiser();
  assert.deepEqual(nuit.tempo.valeur.jours.map((j) => j.date), ['2026-10-14', '2026-10-15']);
});

test('tempo.json abîmé ou non conforme : mis de côté au démarrage, journalisé', async (t) => {
  const dossier = dossierEtat(t);
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, 'tempo.json'), JSON.stringify({ lu_le: 'hier', source: 'rte', couleurs: {}, restants: null, saison: null }));
  const { tempo, journal } = source(t, { dossier, pannes: { 'https://': 'reseau' }, quand: '2026-10-14T09:20:00+02:00' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  tempo.demarrer();
  await attendre(() => /illisible aussi/.test(journal.lignes.join('\n')));
  assert.deepEqual(tempo.valeur, {
    jours: [], restants: null, saison: null, source: null, lu_le: null,
  });
  assert.match(journal.lignes.join('\n'), /tempo\.json abîmé \(.+\) : mis de côté sous tempo\.json\.abime-/);
  assert.equal(readdirSync(dossier).filter((f) => f.startsWith('tempo.json.abime-')).length, 1);
});

test('RTE au bon format mais vide ({ values: {} }) : compte comme un échec, le repli est lu ; saison vide refusée, restants d\'avant gardés', async (t) => {
  const reponses = {
    [URL_RTE_JOURS]: { values: {} },
    [urlRteSaison('2026-2027')]: { values: {} },
    [URL_REPLI.aujourdhui]: { dateJour: '2026-12-01', codeJour: 1 },
    [URL_REPLI.demain]: { dateJour: '2026-12-02', codeJour: 3 },
    [URL_REPLI.stats]: {
      periode: '2026-2027', dernierJourInclus: '2026-12-01', joursBleusRestants: 200, joursBlancsRestants: 30, joursRougesRestants: 22,
    },
  };
  const { tempo, faux, journal } = source(t, { reponses, quand: '2026-12-01T09:00:00+01:00' });
  await tempo.actualiser();
  assert.deepEqual(tempo.valeur.jours.map((j) => [j.date, j.couleur]), [['2026-12-01', 'bleu'], ['2026-12-02', 'rouge']]);
  assert.equal(tempo.valeur.source, 'api-couleur-tempo');
  assert.deepEqual(tempo.valeur.restants, { rouge: 21, blanc: 30, bleu: 200 }, 'demain rouge retiré des stats');
  assert.match(journal.lignes.join('\n'), /RTE illisible \(aucune couleur pour le 2026-12-01\)/);
  assert.ok(faux.urls().includes(URL_REPLI.demain));
  const saisonVide = source(t, {
    reponses: { [URL_RTE_JOURS]: { values: { '2026-12-01': 'BLUE', '2026-12-02': 'WHITE' } }, [urlRteSaison('2026-2027')]: { values: { '2026-09-01': 'BLUE' } } },
    quand: '2026-12-01T12:00:00+01:00',
  });
  await saisonVide.tempo.actualiser();
  assert.equal(saisonVide.tempo.valeur.source, 'rte');
  assert.equal(saisonVide.tempo.valeur.restants, null, 'jamais 22 rouges recalculés sur une saison vide');
  assert.match(saisonVide.journal.lignes.join('\n'), /saison 2026-2027 illisible chez RTE \(incomplète \(1 dates pour 92 jours publiés\)\)/);
});

test('saison de RTE : 2 dates manquantes admises, 3 refusées (jours publiés du 1er septembre au jour en cours)', async (t) => {
  const saisonDe = (n) => ({ values: Object.fromEntries(Object.keys(SAISON.values).filter((cle) => !cle.endsWith('-fallback')).slice(0, n).map((date) => [date, 'BLUE'])) });
  const lire = async (n) => {
    const { tempo } = source(t, { reponses: { [URL_RTE_JOURS]: LIGHT, [urlRteSaison('2026-2027')]: saisonDe(n) }, quand: '2026-10-14T09:20:00+02:00' });
    await tempo.actualiser();
    return tempo.valeur.restants;
  };
  assert.notEqual(await lire(42), null, '44 jours publiés (1/09 au 14/10), 42 dates : admis');
  assert.equal(await lire(41), null, '41 dates : refusé');
});

test('RTE complet sauf demain, après 10 h 45 : demain lu chez le repli seulement ; avant 10 h 45, rien de plus', async (t) => {
  const reponses = { ...REPONSES_DU_14, [URL_RTE_JOURS]: { values: { '2026-10-14': 'BLUE' } } };
  const tot = source(t, { reponses, quand: '2026-10-14T10:44:00+02:00' });
  await tot.tempo.actualiser();
  assert.deepEqual(tot.faux.urls(), [URL_RTE_JOURS, urlRteSaison('2026-2027')]);
  const apres = source(t, { reponses, quand: '2026-10-14T10:45:00+02:00' });
  await apres.tempo.actualiser();
  assert.deepEqual(apres.faux.urls(), [URL_RTE_JOURS, urlRteSaison('2026-2027'), URL_REPLI.demain]);
  assert.deepEqual(apres.tempo.valeur.jours.map((j) => [j.date, j.couleur, j.statut]), [['2026-10-14', 'bleu', 'confirme'], ['2026-10-15', 'bleu', 'confirme']]);
  assert.equal(apres.tempo.valeur.source, 'rte');
  assert.match(apres.journal.lignes.join('\n'), /couleur du 2026-10-15 absente chez RTE, lue chez api-couleur-tempo\.fr/);
});

test('repli : demain retiré des stats seulement s\'il est après leur dernierJourInclus (égal : déjà compté)', async (t) => {
  const stats = (dernier) => ({ ...REPLI[URL_REPLI.stats], dernierJourInclus: dernier });
  const lire = async (dernier) => {
    const { tempo } = source(t, { reponses: { ...REPLI, [URL_REPLI.stats]: stats(dernier) }, pannes: { [URL_RTE_JOURS]: 500 }, quand: '2026-10-14T12:00:00+02:00' });
    await tempo.actualiser();
    return tempo.valeur.restants.bleu;
  };
  assert.equal(await lire('2026-10-14'), 255, 'demain (15/10) pas encore compté : retiré');
  assert.equal(await lire('2026-10-15'), 256, 'demain déjà compté par les stats : rien à retirer');
});
