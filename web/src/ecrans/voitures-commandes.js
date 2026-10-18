// web/src/ecrans/voitures-commandes.js
//
// Rôle    : les commandes sous la carte d'une voiture (décision de Thomas du 14/10) : 4 grands boutons à pictogramme
//           (Charger, Clim, Phares, Klaxon, un mot chacun), 2 réglages pas à pas « − 45 % + » (Charge mini, Charge cible)
//           et une ligne de retour.
// Entrées : creerCommandesVoiture(parent, { envoyer, monotone }) : envoyer(chemin, corps) -> promesse de { ok, donnees,
//           statut } (client.poster de api.js) ; monotone (performance.now) ; mettreAJour(carte) avec une carte de
//           vueVoitures (voitures-donnees.js : nom, commandes, niveaux, pilotable) ; entretenir() à chaque seconde.
// Sorties : { racine, mettreAJour(carte), entretenir() }.
// Pièges  :
//   - Un appui = une commande (surAppui d'appui.js : au lever du doigt, 300 ms d'anti-répétition), sans confirmation ni
//     geste parent : choix de Thomas, à ne pas contourner. Le serveur refuse la même commande pendant 30 s, et toute
//     commande au-delà de 10 par heure (quota de l'API Renault) : la ligne dit alors « Trop tôt, réessayer dans un
//     moment ».
//   - Réglages : chaque appui sur − ou + change la valeur affichée (en couleur d'accent tant qu'elle n'est pas partie) ;
//     elle part une fois le doigt au repos depuis 1,5 s, vu à chaque seconde par entretenir() (donc 1,5 à 2,5 s après le
//     dernier appui, sans minuterie de plus), et pas moins de 10 s après la réponse au précédent envoi du même réglage ;
//     pendant l'envoi, elle reste affichée (couleur normale) jusqu'à la réponse : règles dans creerReglage
//     (voitures-donnees.js). Le tick de main.js appelle entretenir() même hors de l'écran : une valeur choisie juste
//     avant de partir est quand même envoyée.
//   - La réponse revient au creerReglage qui a envoyé (gardé avant l'envoi) : si une autre voiture a pris la place
//     entre-temps, ses réglages neufs ne reçoivent pas la valeur de la précédente.
//   - Pictogrammes : Charger (i-eclair) et Clim (i-wind) viennent du sprite ; Phares (feu de route : lampe et faisceau)
//     et Klaxon (haut-parleur et ondes, la forme de i-mute) sont dessinés ici dans le même style (24 x 24, classe ico :
//     trait de 1,8 en currentColor), faute de symbole dans web/public/icones.svg, tenu par un autre chantier le 14/10 :
//     à y déplacer ensuite en deux symboles (phares, klaxon), cités ici à la place de DESSINS (le test du sprite exige
//     que tout symbole cité existe et que tout symbole serve).
//   - Boutons et réglages absents si la commande n'est pas configurée ou pas disponible (flux) ; panneau entier masqué
//     sans rien à piloter. Une autre voiture à la même place (configuration changée) repart de réglages neufs.
//   - Une seule ligne de retour (role=status), effacée au bout de 8 s ; un échec en couleur d'alerte.

import { surAppui } from '../composants/appui.js';
import {
  ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';
import {
  COMMANDES, creerReglage, messageVoiture, REGLAGES,
} from './voitures-donnees.js';

const NS_SVG = 'http://www.w3.org/2000/svg';
const DUREE_MESSAGE_MS = 8000;
const SPRITE = { charger: 'i-eclair', clim: 'i-wind' };
const DESSINS = {
  phares: ['M11 5.5C6.6 5.5 3.5 8.4 3.5 12s3.1 6.5 7.5 6.5z', 'M14.5 7h6M14.5 10.3h6M14.5 13.7h6M14.5 17h6'],
  klaxon: ['M3 9h4l5-4v14l-5-4H3z', 'M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10'],
};

function picto(cle) {
  if (SPRITE[cle]) return icone(SPRITE[cle], 'voiture-commande-icone');
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('class', 'ico voiture-commande-icone');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  DESSINS[cle].forEach((trace) => {
    const chemin = document.createElementNS(NS_SVG, 'path');
    chemin.setAttribute('d', trace);
    svg.appendChild(chemin);
  });
  return svg;
}

// Comme masquer() de dom.js : ne touche au DOM que si l'état change (entretenir() repasse à chaque seconde).
function desactiver(bouton, desactive) {
  if (bouton.disabled !== desactive) bouton.disabled = desactive;
}

function boutonPas(nomIcone, nomLu) {
  const bouton = element('button', 'bouton-doux voiture-pas-bouton');
  bouton.type = 'button';
  bouton.appendChild(icone(nomIcone, 'voiture-pas-icone'));
  etiqueter(bouton, nomLu);
  return bouton;
}

export function creerCommandesVoiture(parent, { envoyer, monotone }) {
  const racine = element('div', 'carte voiture-commandes');
  const rangee = element('div', 'voiture-boutons');
  const message = element('p', 'voiture-message');
  message.setAttribute('role', 'status');
  let carte = null;
  let messageLe = null;

  function afficherMessage(texte, alerte) {
    messageLe = texte === null ? null : monotone();
    ecrire(message, texte || '');
    message.classList.toggle('voiture-message-alerte', alerte === true);
  }

  function repondre(reponse, nom) {
    afficherMessage(messageVoiture(reponse, nom), !reponse.ok);
  }

  const boutons = {};
  COMMANDES.forEach(({ cle, libelle }) => {
    const bouton = element('button', `bouton-doux voiture-commande voiture-commande-${cle}`);
    bouton.type = 'button';
    bouton.appendChild(picto(cle));
    bouton.appendChild(element('span', 'voiture-commande-texte', libelle));
    surAppui(bouton, () => {
      if (!carte) return;
      const nom = carte.nom;
      envoyer('/api/action/voiture_commande', { voiture: nom, commande: cle }).then((reponse) => repondre(reponse, nom));
    });
    boutons[cle] = bouton;
    rangee.appendChild(bouton);
  });
  racine.appendChild(rangee);

  const reglages = {};
  REGLAGES.forEach(({ cle, libelle }) => {
    const bloc = element('div', `voiture-reglage voiture-reglage-${cle}`);
    const pas = element('div', 'voiture-pas');
    const moins = boutonPas('i-minus', `Baisser la ${libelle.toLowerCase()}`);
    const valeur = element('p', 'voiture-reglage-valeur chiffres');
    const nombre = element('span', '');
    valeur.appendChild(nombre);
    valeur.appendChild(element('span', 'voiture-reglage-unite', '%'));
    const plus = boutonPas('i-plus', `Monter la ${libelle.toLowerCase()}`);
    [moins, valeur, plus].forEach((noeud) => pas.appendChild(noeud));
    bloc.appendChild(element('span', 'voiture-reglage-nom', libelle));
    bloc.appendChild(pas);
    racine.appendChild(bloc);
    reglages[cle] = {
      bloc, moins, plus, nombre, etat: creerReglage(),
    };
  });
  racine.appendChild(message);
  parent.appendChild(racine);

  function rendreReglage(cle) {
    const r = reglages[cle];
    const niveau = carte ? carte.niveaux[cle] : null;
    masquer(r.bloc, niveau === null);
    if (niveau === null) return;
    const affichee = r.etat.affichee(niveau, monotone());
    ecrire(r.nombre, String(affichee));
    r.bloc.classList.toggle('voiture-reglage-en-cours', r.etat.enCours());
    desactiver(r.moins, affichee <= niveau.min);
    desactiver(r.plus, affichee >= niveau.max);
  }

  Object.keys(reglages).forEach((cle) => {
    const r = reglages[cle];
    const appuyer = (sens) => () => {
      const niveau = carte ? carte.niveaux[cle] : null;
      if (!niveau) return;
      r.etat.appuyer(sens, niveau, monotone());
      rendreReglage(cle);
    };
    surAppui(r.moins, appuyer(-1));
    surAppui(r.plus, appuyer(1));
  });

  function envoyerReglages() {
    Object.keys(reglages).forEach((cle) => {
      const r = reglages[cle];
      const etat = r.etat;
      const valeur = etat.echue(carte ? carte.niveaux[cle] : null, monotone());
      if (valeur === null) return;
      const nom = carte.nom;
      envoyer('/api/action/voiture_niveau', { voiture: nom, reglage: cle, valeur }).then((reponse) => {
        etat.recu(valeur, reponse, monotone());
        if (r.etat !== etat) return;
        repondre(reponse, nom);
        rendreReglage(cle);
      });
    });
  }

  return {
    racine,
    mettreAJour(nouvelle) {
      if (!carte || carte.nom !== nouvelle.nom) {
        Object.keys(reglages).forEach((cle) => { reglages[cle].etat = creerReglage(); });
        afficherMessage(null);
      }
      carte = nouvelle;
      masquer(racine, !carte.pilotable);
      COMMANDES.forEach(({ cle }) => masquer(boutons[cle], carte.commandes.indexOf(cle) === -1));
      masquer(rangee, carte.commandes.length === 0);
      Object.keys(reglages).forEach(rendreReglage);
    },
    entretenir() {
      envoyerReglages();
      Object.keys(reglages).forEach(rendreReglage);
      if (messageLe !== null && monotone() - messageLe >= DUREE_MESSAGE_MS) afficherMessage(null);
    },
  };
}
