// tests/clims-page.test.js
//
// Rôle    : prouver les clims côté page : les règles sans DOM (web/src/ecrans/clims-donnees.js : carte tirée du flux,
//           seulement ce que la clim accepte, « Mode essai », état vide, valeurs en attente jusqu'au rapport de HA, message
//           d'une ligne) et l'écran sur le faux DOM (web/src/ecrans/clims.js et clims-panneau.js : un appui = une commande
//           avec le bon corps, Marche qui bascule, mode qui allume, attente visible puis levée, option non modifiable
//           désactivée, consigne pas à pas envoyée 1,5 s après le dernier appui, clim injoignable, deux panneaux).
// Entrées : valeurs clims écrites ici au format du flux (serveur/ha/clims.js) ; faux DOM (tests/faux-dom.js) ; un faux
//           client (poster noté, réponse choisie par le test) et une fausse horloge monotone.
// Sorties : node --test.
// Pièges  : l'anti-répétition des boutons (300 ms, appui.js) suit la vraie horloge : un test n'appuie qu'une fois par
//           bouton.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  creerAttentes, GARDE_ATTENTE_MS, messageClim, MODES, OPTIONS, vueClims,
} from '../web/src/ecrans/clims-donnees.js';
import {
  appuyer, installerFauxDom, parClasse, texte,
} from './faux-dom.js';

installerFauxDom();
const { creerClims } = await import('../web/src/ecrans/clims.js');

const clim = (autres = {}) => ({
  nom: 'Salon',
  disponible: true,
  mode: 'off',
  modes: ['cool', 'heat', 'auto', 'dry', 'fan_only'],
  temperature: 22.5,
  consigne: { valeur: 25, min: 16, max: 30, pas: 1 },
  ventilation: 'quiet',
  ventilations: ['auto', 'quiet', 'low', 'medium', 'high', 'turbo'],
  oscillation: { verticale: false, horizontale: true },
  options: [{ cle: 'eco', actif: false, modifiable: false }, { cle: 'boost', actif: false, modifiable: true }],
  ...autres,
});

function fauxClient(reponse = { ok: true, donnees: { ok: true, simulation: true } }) {
  const envois = [];
  const client = {
    reponse,
    poster(chemin, corps) {
      envois.push({ chemin, corps });
      return Promise.resolve(client.reponse);
    },
  };
  return { client, envois };
}
const laisserRepondre = () => new Promise((resoudre) => setImmediate(resoudre));

test('carte : ce que dit le flux, dans l\'ordre de l\'écran, avec libellés et pictogrammes', () => {
  const vue = vueClims([clim()], true);
  assert.deepEqual([vue.etat, vue.essai], ['ok', true]);
  const [carte] = vue.cartes;
  assert.deepEqual([carte.nom, carte.allumee, carte.mode, carte.temperature], ['Salon', false, 'off', '22,5']);
  assert.deepEqual(carte.modes.map((m) => [m.libelle, m.icone]), [['Froid', 'i-flocon'], ['Chaud', 'i-sun'], ['Auto', 'i-auto'], ['Sec', 'i-drop'], ['Vent', 'i-wind']]);
  assert.deepEqual(carte.ventilations.map((v) => v.libelle), ['Auto', 'Silence', '1', '2', '3', 'Turbo']);
  assert.deepEqual(carte.oscillations.map((o) => [o.libelle, o.actif]), [['Haut-bas', false], ['Côtés', true]]);
  assert.deepEqual(carte.options.map((o) => [o.libelle, o.actif, o.modifiable]), [['Éco', false, false], ['Boost', false, true]]);
  assert.equal(vueClims([clim({ mode: 'heat' })], false).cartes[0].allumee, true);
  assert.equal(vueClims([clim({ mode: null })], false).cartes[0].allumee, false, 'mode inconnu : pas allumée');
  assert.deepEqual(MODES.length + OPTIONS.length, 11);
});

test('carte : seulement ce que la clim accepte ; consigne incohérente : null ; serveur ancien sans listes : rien', () => {
  const partielle = vueClims([clim({
    modes: ['cool', 'heat_cool'], ventilations: ['auto'], oscillation: { verticale: null, horizontale: false },
    options: [{ cle: 'inconnue', actif: true }], consigne: { valeur: 25, min: 30, max: 16, pas: 1 },
  })], false).cartes[0];
  assert.deepEqual(partielle.modes.map((m) => m.cle), ['cool']);
  assert.deepEqual(partielle.ventilations.map((v) => v.cle), ['auto']);
  assert.deepEqual(partielle.oscillations.map((o) => o.cle), ['horizontale']);
  assert.deepEqual(partielle.options, []);
  assert.equal(partielle.consigne, null);
  const ancienne = vueClims([{ nom: 'Salon' }], false).cartes[0];
  assert.deepEqual([ancienne.modes, ancienne.ventilations, ancienne.oscillations, ancienne.options], [[], [], [], []]);
});

test('écran : attente avant le flux, vide sans configuration, deux cartes au plus', () => {
  assert.deepEqual(vueClims(null, true), { etat: 'attente', essai: false, cartes: [] });
  assert.deepEqual(vueClims([], true), { etat: 'vide', essai: false, cartes: [] });
  assert.equal(vueClims([clim(), clim({ nom: 'Étage' }), clim({ nom: 'Garage' })], false).cartes.length, 2);
});

test('attentes : valeur posée montrée, levée quand le flux la rapporte ou au bout de 60 s ; refus ou essai : levée tout de suite', () => {
  const attentes = creerAttentes();
  attentes.poser('mode', 'heat', 0);
  assert.equal(attentes.valeur('mode', 'off', 10), 'heat', 'avant la réponse');
  attentes.recu('mode', { ok: true, donnees: { ok: true, simulation: false } });
  assert.equal(attentes.valeur('mode', 'off', 1000), 'heat', 'envoyée, pas encore rapportée');
  assert.equal(attentes.enAttente('mode'), true);
  assert.equal(attentes.valeur('mode', 'heat', 2000), 'heat');
  assert.equal(attentes.enAttente('mode'), false, 'rapportée : plus en attente');
  attentes.poser('ventilation', 'turbo', 0);
  attentes.recu('ventilation', { ok: true, donnees: { ok: true, simulation: false } });
  assert.equal(attentes.valeur('ventilation', 'quiet', GARDE_ATTENTE_MS), 'quiet', 'jamais rapportée : 60 s au plus');
  attentes.poser('marche', true, 0);
  attentes.recu('marche', { ok: true, donnees: { ok: true, simulation: true } });
  assert.equal(attentes.valeur('marche', false, 1), false, 'mode essai : rien n\'a changé dans la clim');
  attentes.poser('marche', true, 0);
  attentes.recu('marche', { ok: false, statut: 429 });
  assert.equal(attentes.valeur('marche', false, 1), false, 'refus');
});

test('message d\'une ligne', () => {
  assert.equal(messageClim({ ok: true, donnees: { simulation: true } }), 'Mode essai : rien n\'est envoyé');
  assert.equal(messageClim({ ok: true, donnees: { simulation: false } }), 'Envoyé');
  assert.equal(messageClim({ ok: false, statut: 429 }), 'Trop tôt, réessayer dans un moment');
  assert.equal(messageClim({ ok: false, statut: 503 }), 'Pas possible pour l\'instant');
  assert.equal(messageClim({ ok: false, statut: 502 }), 'La clim ne répond pas');
  assert.equal(messageClim({ ok: false, statut: 0 }), 'Pas de réponse du serveur du cadre');
  assert.equal(messageClim({ ok: false, statut: 400 }), 'Commande refusée par le serveur');
});

test('écran sur le faux DOM : vide, « Mode essai », panneau complet, un appui = une commande avec le bon corps', async () => {
  const { conteneur } = installerFauxDom();
  const horloge = { ms: 0 };
  const { client, envois } = fauxClient();
  const ecran = creerClims(conteneur, { client, monotone: () => horloge.ms });
  ecran.mettreAJour(vueClims([], false));
  assert.equal(parClasse(conteneur, 'clims-vide')[0].hidden, false);
  ecran.mettreAJour(vueClims([clim()], true));
  assert.equal(parClasse(conteneur, 'clims-vide')[0].hidden, true);
  assert.deepEqual(texte(parClasse(conteneur, 'clims-essai')[0]), 'Mode essai : rien n\'est envoyé');
  const [panneau, second] = parClasse(conteneur, 'clim');
  assert.equal(second.hidden, true, 'une seule clim : le second panneau est masqué');
  assert.equal(texte(parClasse(panneau, 'clim-nom-texte')[0]), 'Salon');
  assert.equal(texte(parClasse(panneau, 'clim-temperature')[0]), '22,5°');
  assert.equal(texte(parClasse(panneau, 'clim-consigne-valeur')[0]), '25°');
  const marche = parClasse(panneau, 'clim-marche')[0];
  assert.equal(texte(marche), 'Éteinte');
  const modes = parClasse(panneau, 'clim-mode');
  assert.deepEqual(modes.map(texte), ['Froid', 'Chaud', 'Auto', 'Sec', 'Vent']);
  const bascules = parClasse(panneau, 'clim-bascule');
  assert.deepEqual(bascules.filter((b) => !b.hidden).map(texte), ['Haut-bas', 'Côtés', 'Éco', 'Boost']);
  assert.deepEqual(bascules.filter((b) => !b.hidden).map((b) => b.disabled), [false, false, true, false], 'Éco pas modifiable maintenant');
  appuyer(modes[1]);
  assert.deepEqual(envois.at(-1), { chemin: '/api/action/clim_mode', corps: { clim: 'Salon', mode: 'heat' } });
  assert.equal(texte(marche), 'Allumée', 'choisir un mode allume la clim tout de suite à l\'écran');
  assert.ok(modes[1].classList.contains('clim-choix-actif') && modes[1].classList.contains('clim-attente'));
  await laisserRepondre();
  assert.equal(texte(parClasse(panneau, 'clim-message')[0]), 'Mode essai : rien n\'est envoyé');
  assert.equal(texte(marche), 'Éteinte', 'mode essai : retour au flux');
  appuyer(marche);
  assert.deepEqual(envois.at(-1).corps, { clim: 'Salon', marche: true });
  appuyer(parClasse(panneau, 'clim-vitesse')[5]);
  assert.deepEqual(envois.at(-1).corps, { clim: 'Salon', ventilation: 'turbo' });
  appuyer(bascules[1]);
  assert.deepEqual(envois.at(-1).corps, { clim: 'Salon', sens: 'horizontale', actif: false });
  appuyer(bascules[3]);
  assert.deepEqual(envois.at(-1).corps, { clim: 'Salon', option: 'boost', actif: true });
  assert.equal(envois.length, 5);
});

test('écran sur le faux DOM : envoyée pour de vrai, la valeur reste en attente jusqu\'à ce que le flux la rapporte', async () => {
  const { conteneur } = installerFauxDom();
  const horloge = { ms: 0 };
  const { client } = fauxClient({ ok: true, donnees: { ok: true, simulation: false } });
  const ecran = creerClims(conteneur, { client, monotone: () => horloge.ms });
  ecran.mettreAJour(vueClims([clim()], false));
  const [panneau] = parClasse(conteneur, 'clim');
  const marche = parClasse(panneau, 'clim-marche')[0];
  appuyer(marche);
  await laisserRepondre();
  assert.equal(texte(parClasse(panneau, 'clim-message')[0]), 'Envoyé');
  assert.deepEqual([texte(marche), marche.classList.contains('clim-attente')], ['Allumée', true]);
  horloge.ms = 5000;
  ecran.mettreAJour(vueClims([clim({ mode: 'cool' })], false));
  assert.deepEqual([texte(marche), marche.classList.contains('clim-attente')], ['Allumée', false], 'rapportée par HA');
});

test('écran sur le faux DOM : consigne « − 25° + », envoyée 1,5 s après le dernier appui, bornes désactivées', async () => {
  const { conteneur } = installerFauxDom();
  const horloge = { ms: 0 };
  const { client, envois } = fauxClient();
  const ecran = creerClims(conteneur, { client, monotone: () => horloge.ms });
  ecran.mettreAJour(vueClims([clim({ consigne: { valeur: 29, min: 16, max: 30, pas: 1 } })], false));
  const [panneau] = parClasse(conteneur, 'clim');
  const [moins, plus] = parClasse(panneau, 'clim-pas-bouton');
  appuyer(plus);
  const valeur = parClasse(panneau, 'clim-consigne-valeur')[0];
  assert.equal(texte(valeur), '30°');
  assert.ok(parClasse(panneau, 'clim-consigne')[0].classList.contains('clim-consigne-en-cours'));
  assert.deepEqual([moins.disabled, plus.disabled], [false, true], 'à la borne haute');
  horloge.ms = 1000;
  ecran.entretenir();
  assert.equal(envois.length, 0, 'pas encore au repos');
  horloge.ms = 1500;
  ecran.entretenir();
  assert.deepEqual(envois, [{ chemin: '/api/action/clim_consigne', corps: { clim: 'Salon', valeur: 30 } }]);
  await laisserRepondre();
  assert.equal(texte(valeur), '29°', 'mode essai : retour à la valeur du flux');
});

test('écran sur le faux DOM : clim injoignable grisée, commandes désactivées ; deux clims côte à côte', () => {
  const { conteneur } = installerFauxDom();
  const { client } = fauxClient();
  const ecran = creerClims(conteneur, { client, monotone: () => 0 });
  ecran.mettreAJour(vueClims([clim({ disponible: false, mode: null, temperature: null }), clim({ nom: 'Étage', mode: 'cool' })], false));
  assert.ok(parClasse(conteneur, 'clims-liste')[0].classList.contains('clims-deux'));
  const [salon, etage] = parClasse(conteneur, 'clim');
  assert.ok(salon.classList.contains('clim-indisponible'));
  assert.equal(texte(parClasse(salon, 'clim-temperature')[0]), 'Injoignable');
  assert.ok(parClasse(salon, 'clim-mode').every((b) => b.disabled));
  assert.equal(parClasse(salon, 'clim-marche')[0].disabled, true);
  assert.equal(texte(parClasse(etage, 'clim-marche')[0]), 'Allumée');
  assert.ok(parClasse(etage, 'clim-mode')[0].classList.contains('clim-choix-actif'), 'Froid actif');
  assert.equal(parClasse(conteneur, 'clims-essai')[0].hidden, true, 'pas de mode essai : actions réelles');
});
