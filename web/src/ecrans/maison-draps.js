// web/src/ecrans/maison-draps.js
//
// Rôle    : les trois cartes Draps de l'onglet Entretien de Maison (demande d'Agathe du 14/10) : « Lit de Timo », « Lit de
//           Pablo », « Notre chambre » ; depuis quand ils sont changés, la jauge du cycle de 15 jours, le prochain
//           changement, et le gros bouton « Changés aujourd'hui » (annulation pendant 5 s ; appui long d'une seconde pour
//           « hier » ou « avant-hier »).
// Entrées : creerDraps(parent, { client, monotone }) : client (api.js : poster), horloge monotone (performance.now, une
//           fausse dans les tests) ; mettreAJour(draps, ms) avec la valeur draps du flux et l'heure corrigée ;
//           entretenir() à chaque seconde ; quitter() quand l'écran Maison est quitté.
// Sorties : { racine, mettreAJour(draps, ms), entretenir(), quitter() } ; POST /api/draps/<lit> avec { quand }.
// Pièges  :
//   - L'annulation se fait AVANT l'envoi : un toucher montre tout de suite « changés aujourd'hui » et un bouton
//     « Annuler » à la place du gros bouton, et la demande ne part qu'au bout de 5 s (ou dès qu'on quitte l'écran Maison :
//     rien ne reste en suspens derrière un autre écran). Le serveur n'a donc aucune date à rétablir, et c'est lui qui
//     calcule la date (le corps ne porte qu'un mot : aujourdhui, hier, avant-hier).
//   - Appui long d'une seconde (appui.js, barre qui se remplit) : deux boutons « Hier » et « Avant-hier » à la place
//     du gros bouton, pendant 10 s ; un toucher court ne fait que « aujourd'hui ».
//   - Toutes les cibles font 96 px de haut au moins ; les boutons d'une carte partagent la même anti-répétition (le
//     bouton « Annuler » prend la place de celui qu'on vient de toucher : une touche fantôme ne doit pas l'actionner).
//   - En cas d'échec, la carte revient à la date du serveur et dit « Pas noté » 30 s, sans détail technique.
//   - Pas de mode parent (choix de Thomas) : tout le monde peut cocher.

import { creerGarde, surAppui, surAppuiLong } from '../composants/appui.js';
import { carteTitree } from '../composants/carte.js';
import {
  ecrire, element, icone, masquer,
} from '../dom.js';
import { dateDuChangement, LITS, vueDraps } from './draps-donnees.js';

const ANNULATION_MS = 5000;
const CHOIX_MS = 10000;
const MESSAGE_MS = 30000;
const TONS = ['inconnu', 'ok', 'bientot', 'alerte'];

function bouton(classe, nomIcone, texte) {
  const noeud = element('button', classe);
  noeud.type = 'button';
  if (nomIcone) noeud.appendChild(icone(nomIcone, 'bouton-fort-icone'));
  noeud.appendChild(element('span', '', texte));
  return noeud;
}

function construireCarte(parent, lit, actions) {
  const { racine } = carteTitree('section', 'draps-carte', lit.nom, 'i-lit');
  const depuis = element('p', 'draps-depuis');
  const piste = element('span', 'draps-piste');
  const remplissage = element('span', 'draps-remplissage');
  piste.appendChild(remplissage);
  const prochain = element('p', 'draps-prochain');
  const garde = creerGarde();
  const changer = bouton('bouton-fort draps-changer', 'i-check', 'Changés aujourd\'hui');
  surAppuiLong(changer, { court: () => actions.noter(lit.id, 'aujourdhui'), long: () => actions.choisir(lit.id) }, garde);
  const choix = element('div', 'draps-choix');
  const hier = bouton('bouton-doux draps-jour', null, 'Hier');
  const avantHier = bouton('bouton-doux draps-jour', null, 'Avant-hier');
  surAppui(hier, () => actions.noter(lit.id, 'hier'), garde);
  surAppui(avantHier, () => actions.noter(lit.id, 'avant-hier'), garde);
  choix.appendChild(hier);
  choix.appendChild(avantHier);
  const annuler = bouton('bouton-doux draps-annuler', 'i-close', 'Annuler');
  surAppui(annuler, () => actions.annuler(lit.id), garde);
  const message = element('p', 'draps-message');
  [depuis, piste, prochain, changer, choix, annuler, message].forEach((noeud) => racine.appendChild(noeud));
  parent.appendChild(racine);
  return {
    racine, depuis, remplissage, prochain, changer, choix, annuler, message,
  };
}

export function creerDraps(parent, { client, monotone }) {
  const racine = element('div', 'draps');
  const etats = {};
  let donnees = { draps: null, ms: 0 };
  const cartes = LITS.map((lit) => {
    etats[lit.id] = { attente: null, choixJusque: null, message: null };
    return construireCarte(racine, lit, {
      noter, choisir, annuler,
    });
  });
  parent.appendChild(racine);

  function rendre() {
    const draps = Object.assign({}, donnees.draps || {});
    LITS.forEach((lit) => {
      const attente = etats[lit.id].attente;
      if (attente) draps[lit.id] = dateDuChangement(attente.quand, donnees.ms);
    });
    vueDraps(draps, donnees.ms).forEach((vue, i) => {
      const n = cartes[i];
      const etat = etats[vue.id];
      ecrire(n.depuis, vue.depuis);
      ecrire(n.prochain, vue.prochain);
      TONS.forEach((ton) => n.racine.classList.toggle(`draps-${ton}`, ton === vue.ton));
      const transformation = `scaleX(${vue.progression})`;
      if (n.remplissage.style.transform !== transformation) n.remplissage.style.transform = transformation;
      const annulable = etat.attente !== null && !etat.attente.envoyee;
      masquer(n.annuler, !annulable);
      masquer(n.choix, annulable || etat.choixJusque === null);
      masquer(n.changer, annulable || etat.choixJusque !== null);
      masquer(n.message, etat.message === null);
      ecrire(n.message, etat.message ? etat.message.texte : '');
    });
  }

  function noter(lit, quand) {
    etats[lit].attente = { quand, jusque: monotone() + ANNULATION_MS, envoyee: false };
    etats[lit].choixJusque = null;
    etats[lit].message = null;
    rendre();
  }

  function choisir(lit) {
    etats[lit].choixJusque = monotone() + CHOIX_MS;
    rendre();
  }

  function annuler(lit) {
    etats[lit].attente = null;
    rendre();
  }

  // La date montrée reste celle du geste jusqu'à la réponse (la mise à jour du flux arrive avec elle), puis le flux décide.
  function envoyer(lit) {
    const attente = etats[lit].attente;
    attente.envoyee = true;
    client.poster(`/api/draps/${lit}`, { quand: attente.quand }).then((reponse) => {
      if (etats[lit].attente === attente) etats[lit].attente = null;
      if (!reponse.ok) etats[lit].message = { texte: 'Pas noté, réessayer', jusque: monotone() + MESSAGE_MS };
      rendre();
    });
  }

  return {
    racine,
    mettreAJour(draps, ms) {
      donnees = { draps, ms };
      rendre();
    },
    entretenir() {
      const t = monotone();
      let change = false;
      LITS.forEach(({ id }) => {
        const etat = etats[id];
        if (etat.attente && !etat.attente.envoyee && t >= etat.attente.jusque) {
          envoyer(id);
          change = true;
        }
        if (etat.choixJusque !== null && t >= etat.choixJusque) {
          etat.choixJusque = null;
          change = true;
        }
        if (etat.message && t >= etat.message.jusque) {
          etat.message = null;
          change = true;
        }
      });
      if (change) rendre();
    },
    quitter() {
      LITS.forEach(({ id }) => {
        if (etats[id].attente && !etats[id].attente.envoyee) envoyer(id);
        etats[id].choixJusque = null;
      });
      rendre();
    },
  };
}
