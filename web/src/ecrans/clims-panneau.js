// web/src/ecrans/clims-panneau.js
//
// Rôle    : le panneau de commande d'UNE clim (décision de Thomas du 16/10 : tout piloter depuis le cadre, d'un simple
//           appui, sans protection contre les enfants) : nom et bouton Marche/Arrêt, température de la pièce, consigne
//           pas à pas « − 25° + », les modes (Froid, Chaud, Auto, Sec, Vent), la ventilation (Auto, Silence, 1, 2, 3,
//           Turbo), les oscillations (Haut-bas, Côtés) et les options (Éco, Boost, Nuit, Ions, Pas sur moi, Hors-gel), et
//           une ligne de retour en bas de la carte (dans la tête, entre le nom et Marche, elle était tronquée à deux clims).
// Entrées : creerPanneauClim(parent, { envoyer, monotone }) : envoyer(chemin, corps) -> promesse de { ok, donnees, statut }
//           (client.poster de api.js) ; monotone (performance.now) ; mettreAJour(carte) avec une carte de vueClims
//           (clims-donnees.js) ; entretenir() à chaque seconde.
// Sorties : { racine, mettreAJour(carte), entretenir() }.
// Pièges  :
//   - Un appui = une commande (surAppui d'appui.js : au lever du doigt, 300 ms d'anti-répétition), sans confirmation :
//     choix de Thomas. Le serveur refuse la même commande dans les 2 s (429 : « Trop tôt »).
//   - Choisir un mode sur une clim éteinte l'allume (comportement de HA : set_hvac_mode) : la carte montre tout de suite
//     la clim allumée dans ce mode (attente), comme Marche.
//   - Valeur en attente (creerAttentes) : montrée avec la classe clim-attente (contour en pointillés d'accent) jusqu'à ce
//     que le flux la rapporte (le cloud Bosch met plusieurs secondes), 60 s au plus ; revient tout de suite au flux en
//     mode essai ou après un refus.
//   - Consigne : même réglage pas à pas que les niveaux de charge de la voiture (creerReglage de voitures-donnees.js),
//     avec l'écart du serveur des clims (2 s) ; elle part 1,5 s après le dernier appui, vu à chaque seconde par
//     entretenir() (appelé même hors de l'écran : une consigne choisie juste avant de partir est envoyée).
//   - Clim indisponible (intégration ou cloud Bosch en panne) : la carte reste, grisée (clim-indisponible), « Injoignable »
//     à la place de la température, toutes ses commandes désactivées sauf les options encore lisibles.
//   - Une autre clim à la même place (configuration changée) repart de réglages et d'attentes neufs.

import { surAppui } from '../composants/appui.js';
import {
  ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';
import {
  creerAttentes, ECART_CONSIGNE_MS, messageClim, MODES, OPTIONS, OSCILLATIONS, texteDegres, VENTILATIONS,
} from './clims-donnees.js';
import { creerReglage } from './voitures-donnees.js';

const DUREE_MESSAGE_MS = 8000;

// Comme masquer() de dom.js : ne touche au DOM que si l'état change (entretenir() repasse à chaque seconde).
function desactiver(bouton, desactive) {
  if (bouton.disabled !== desactive) bouton.disabled = desactive;
}

function bouton(classe, nomIcone, libelle) {
  const noeud = element('button', `bouton-doux ${classe}`);
  noeud.type = 'button';
  if (nomIcone) noeud.appendChild(icone(nomIcone, 'clim-bouton-icone'));
  if (libelle !== null) noeud.appendChild(element('span', 'clim-bouton-texte', libelle));
  return noeud;
}

function etiquette(nomIcone, texte) {
  const noeud = element('p', 'clim-etiquette');
  if (nomIcone) noeud.appendChild(icone(nomIcone, 'clim-etiquette-icone'));
  noeud.appendChild(element('span', '', texte));
  return noeud;
}

function construire(parent) {
  const racine = element('article', 'carte clim');
  const tete = element('div', 'clim-tete');
  const nom = element('h2', 'clim-nom');
  nom.appendChild(icone('i-clim', 'clim-nom-icone'));
  const texteNom = element('span', 'clim-nom-texte');
  nom.appendChild(texteNom);
  const message = element('p', 'clim-message');
  message.setAttribute('role', 'status');
  const marche = bouton('clim-marche', 'i-power', null);
  const texteMarche = element('span', 'clim-bouton-texte');
  marche.appendChild(texteMarche);
  tete.appendChild(nom);
  tete.appendChild(marche);

  const milieu = element('div', 'clim-milieu');
  const piece = element('div', 'clim-piece');
  const temperature = element('p', 'clim-temperature chiffres chiffres-affiche');
  piece.appendChild(etiquette('i-thermo', 'Pièce'));
  piece.appendChild(temperature);
  const consigne = element('div', 'clim-consigne');
  const pas = element('div', 'clim-pas');
  const moins = bouton('clim-pas-bouton', 'i-minus', null);
  etiqueter(moins, 'Baisser la consigne');
  const valeur = element('p', 'clim-consigne-valeur chiffres');
  const plus = bouton('clim-pas-bouton', 'i-plus', null);
  etiqueter(plus, 'Monter la consigne');
  [moins, valeur, plus].forEach((noeud) => pas.appendChild(noeud));
  consigne.appendChild(etiquette(null, 'Consigne'));
  consigne.appendChild(pas);
  milieu.appendChild(piece);
  milieu.appendChild(consigne);

  const modes = element('div', 'clim-modes');
  const boutonsModes = {};
  MODES.forEach(({ cle, libelle, icone: nomIcone }) => {
    boutonsModes[cle] = bouton('clim-choix clim-mode', nomIcone, libelle);
    modes.appendChild(boutonsModes[cle]);
  });
  const ventilation = element('div', 'clim-ventilation');
  ventilation.appendChild(etiquette('i-wind', 'Ventilation'));
  const vitesses = element('div', 'clim-vitesses');
  const boutonsVitesses = {};
  VENTILATIONS.forEach(({ cle, libelle }) => {
    boutonsVitesses[cle] = bouton('clim-choix clim-vitesse', null, libelle);
    vitesses.appendChild(boutonsVitesses[cle]);
  });
  ventilation.appendChild(vitesses);
  const reglages = element('div', 'clim-reglages');
  const bascules = {};
  OSCILLATIONS.concat(OPTIONS).forEach(({ cle, libelle, icone: nomIcone }) => {
    bascules[cle] = bouton('clim-choix clim-bascule', nomIcone, libelle);
    reglages.appendChild(bascules[cle]);
  });
  [tete, milieu, modes, ventilation, reglages, message].forEach((noeud) => racine.appendChild(noeud));
  parent.appendChild(racine);
  return {
    racine, texteNom, message, marche, texteMarche, temperature, consigne, moins, valeur, plus, ventilation, reglages,
    modes: boutonsModes, vitesses: boutonsVitesses, bascules,
  };
}

export function creerPanneauClim(parent, { envoyer, monotone }) {
  const n = construire(parent);
  let carte = null;
  let attentes = creerAttentes();
  let reglage = creerReglage({ ecartMs: ECART_CONSIGNE_MS });
  let messageLe = null;

  function afficherMessage(texte, alerte) {
    messageLe = texte === null ? null : monotone();
    ecrire(n.message, texte || '');
    n.message.classList.toggle('clim-message-alerte', alerte === true);
  }

  // Envoie une commande ; cles : les attentes posées avant l'envoi (valeur montrée tout de suite), levées ou gardées
  // selon la réponse.
  function commander(action, corps, poses) {
    if (!carte) return;
    const nom = carte.nom;
    const ms = monotone();
    const lot = attentes;
    poses.forEach(([cle, valeurPosee]) => lot.poser(cle, valeurPosee, ms));
    rendre();
    envoyer(`/api/action/${action}`, Object.assign({ clim: nom }, corps)).then((reponse) => {
      poses.forEach(([cle]) => lot.recu(cle, reponse));
      if (lot !== attentes) return;
      afficherMessage(messageClim(reponse), !reponse.ok);
      rendre();
    });
  }

  function etatAffiche() {
    const ms = monotone();
    const allumee = attentes.valeur('marche', carte.allumee, ms);
    const mode = attentes.valeur('mode', carte.mode, ms);
    const ventilation = attentes.valeur('ventilation', carte.ventilation, ms);
    return { allumee, mode, ventilation, ms };
  }

  surAppui(n.marche, () => {
    if (!carte) return;
    const allumee = etatAffiche().allumee;
    commander('clim_marche', { marche: !allumee }, [['marche', !allumee]]);
  });
  MODES.forEach(({ cle }) => surAppui(n.modes[cle], () => commander('clim_mode', { mode: cle }, [['mode', cle], ['marche', true]])));
  VENTILATIONS.forEach(({ cle }) => surAppui(n.vitesses[cle], () => commander('clim_ventilation', { ventilation: cle }, [['ventilation', cle]])));
  OSCILLATIONS.forEach(({ cle }) => surAppui(n.bascules[cle], () => {
    const actuel = carte && carte.oscillations.filter((o) => o.cle === cle)[0];
    if (!actuel) return;
    const actif = !attentes.valeur(`osc:${cle}`, actuel.actif, monotone());
    commander('clim_oscillation', { sens: cle, actif }, [[`osc:${cle}`, actif]]);
  }));
  OPTIONS.forEach(({ cle }) => surAppui(n.bascules[cle], () => {
    const actuel = carte && carte.options.filter((o) => o.cle === cle)[0];
    if (!actuel) return;
    const actif = !attentes.valeur(`opt:${cle}`, actuel.actif, monotone());
    commander('clim_option', { option: cle, actif }, [[`opt:${cle}`, actif]]);
  }));
  const appuyer = (sens) => () => {
    if (!carte || !carte.consigne || !carte.disponible) return;
    reglage.appuyer(sens, carte.consigne, monotone());
    rendre();
  };
  surAppui(n.moins, appuyer(-1));
  surAppui(n.plus, appuyer(1));

  function rendreConsigne(ms) {
    masquer(n.consigne, carte.consigne === null);
    if (carte.consigne === null) return;
    const affichee = reglage.affichee(carte.consigne, ms);
    ecrire(n.valeur, `${texteDegres(affichee)}°`);
    n.consigne.classList.toggle('clim-consigne-en-cours', reglage.enCours());
    desactiver(n.moins, !carte.disponible || affichee <= carte.consigne.min);
    desactiver(n.plus, !carte.disponible || affichee >= carte.consigne.max);
  }

  function rendreBascule(description, cleAttente, ms, modifiable) {
    const noeud = n.bascules[description.cle];
    const actif = attentes.valeur(cleAttente, description.actif, ms);
    noeud.classList.toggle('clim-choix-actif', actif);
    noeud.classList.toggle('clim-attente', attentes.enAttente(cleAttente));
    noeud.setAttribute('aria-pressed', String(actif));
    desactiver(noeud, !modifiable);
  }

  function rendre() {
    if (!carte) return;
    const { allumee, mode, ventilation, ms } = etatAffiche();
    ecrire(n.texteNom, carte.nom);
    n.racine.classList.toggle('clim-indisponible', !carte.disponible);
    n.racine.classList.toggle('clim-allumee', allumee);
    ecrire(n.texteMarche, allumee ? 'Allumée' : 'Éteinte');
    etiqueter(n.marche, allumee ? 'Éteindre la clim' : 'Allumer la clim');
    n.marche.classList.toggle('clim-choix-actif', allumee);
    n.marche.classList.toggle('clim-attente', attentes.enAttente('marche'));
    desactiver(n.marche, !carte.disponible);
    let texteTemperature = 'Injoignable';
    if (carte.disponible) texteTemperature = carte.temperature === null ? '?' : `${carte.temperature}°`;
    ecrire(n.temperature, texteTemperature);
    rendreConsigne(ms);
    MODES.forEach(({ cle }) => {
      const noeud = n.modes[cle];
      masquer(noeud, !carte.modes.some((m) => m.cle === cle));
      noeud.classList.toggle('clim-choix-actif', allumee && mode === cle);
      noeud.classList.toggle('clim-attente', attentes.enAttente('mode') && mode === cle);
      desactiver(noeud, !carte.disponible);
    });
    masquer(n.ventilation, carte.ventilations.length === 0);
    VENTILATIONS.forEach(({ cle }) => {
      const noeud = n.vitesses[cle];
      masquer(noeud, !carte.ventilations.some((v) => v.cle === cle));
      noeud.classList.toggle('clim-choix-actif', ventilation === cle);
      noeud.classList.toggle('clim-attente', attentes.enAttente('ventilation') && ventilation === cle);
      desactiver(noeud, !carte.disponible);
    });
    OSCILLATIONS.forEach((description) => {
      const etat = carte.oscillations.filter((o) => o.cle === description.cle)[0];
      masquer(n.bascules[description.cle], !etat);
      if (etat) rendreBascule(etat, `osc:${etat.cle}`, ms, carte.disponible);
    });
    OPTIONS.forEach((description) => {
      const etat = carte.options.filter((o) => o.cle === description.cle)[0];
      masquer(n.bascules[description.cle], !etat);
      if (etat) rendreBascule(etat, `opt:${etat.cle}`, ms, etat.modifiable);
    });
    masquer(n.reglages, carte.oscillations.length + carte.options.length === 0);
  }

  function envoyerConsigne() {
    if (!carte) return;
    const etat = reglage;
    const valeur = etat.echue(carte.disponible ? carte.consigne : null, monotone());
    if (valeur === null) return;
    envoyer('/api/action/clim_consigne', { clim: carte.nom, valeur }).then((reponse) => {
      etat.recu(valeur, reponse, monotone());
      if (reglage !== etat) return;
      afficherMessage(messageClim(reponse), !reponse.ok);
      rendre();
    });
  }

  return {
    racine: n.racine,
    mettreAJour(nouvelle) {
      if (!carte || carte.nom !== nouvelle.nom) {
        attentes = creerAttentes();
        reglage = creerReglage({ ecartMs: ECART_CONSIGNE_MS });
        afficherMessage(null);
      }
      carte = nouvelle;
      rendre();
    },
    entretenir() {
      envoyerConsigne();
      rendre();
      if (messageLe !== null && monotone() - messageLe >= DUREE_MESSAGE_MS) afficherMessage(null);
    },
  };
}
