// web/src/ecrans/maison.js
//
// Rôle    : l'écran Maison (conception §1.5, décisions de Thomas du 11 et du 13/10) : six onglets, Alarme (lecture
//           seule : état et ouvertures), Apple TV, Télé, Sonnette, Wi-Fi invités, Entretien (draps depuis le 14/10,
//           encres, piles) ; le bandeau « Mode essai : rien n'est envoyé à la maison » tant que le serveur simule les
//           actions maison (les draps ne sont pas des actions maison : ils s'écrivent toujours, sur le serveur du cadre).
// Entrées : creerMaison(conteneur, { client, monotone, maintenant }) : client (api.js : poster, lire), horloge monotone,
//           heure corrigée ; mettreAJour(donnees, ms) avec l'état du flux (entites, simulation_maison, direct_video,
//           sonnette, draps) ; entretenir(ms) à chaque seconde.
// Sorties : { racine, mettreAJour(donnees, ms), ouvrirSection(cle), lancerDirect(ms), entretenir(ms), entrer(),
//           quitter(), retenu(ms) } ; cle : alarme, appletv, tele, sonnette, wifi ou entretien ; entrer() et quitter()
//           sont appelés par main.js quand l'écran devient visible ou cesse de l'être ; retenu(ms) est vrai pendant un
//           direct ou un Wi-Fi affiché (main.js ne revient pas à l'Accueil au bout de 60 s).
// Pièges  :
//   - Changer d'onglet est une NAVIGATION (pointerdown, conception §1.2) ; les touches, applis, « Voir le direct »,
//     « Afficher » sont des actions (pointerup, appui.js), dans leurs sections.
//   - Pas de « Je pars / Bonne nuit », pas de « qui est à la maison », pas d'alerte « portes et fenêtres » (décisions
//     de Thomas) : la section Alarme montre l'état des ouvertures, sans rien déclencher.
//   - quitter() (autre écran) arrête le direct, masque le Wi-Fi et envoie tout de suite un changement de draps encore
//     annulable : rien de secret, de flux vidéo ni de geste en suspens ne reste derrière un autre écran. La photo de la sonnette ne se charge que si l'onglet Sonnette est à l'écran : pas
//     de requête vers HA chaque minute pour une image que personne ne voit.
//   - « Mode essai » : seulement si l'instantané dit simulation_maison: true (serveur sans ACTIONS_MAISON=1). Il ne
//     concerne que les actions maison ; celui des courses est sur l'écran Courses (ACTIONS_REELLES, autre garde-fou).
//     Pas sur l'onglet Entretien : les draps, eux, sont toujours notés (serveur du cadre), le bandeau y ferait croire le
//     contraire.

import { element, icone, masquer } from '../dom.js';
import { creerSectionAlarme } from './maison-alarme.js';
import {
  etatAlarme, vueEntretien, vueOuvertures, vueSonnette, vueTelecommandes,
} from './maison-donnees.js';
import { creerSectionEntretien } from './maison-entretien.js';
import { creerSectionSonnette } from './maison-sonnette.js';
import { creerTelecommande } from './maison-telecommandes.js';
import { creerSectionWifi } from './maison-wifi.js';

const ONGLETS = [
  { cle: 'alarme', nom: 'Alarme', icone: 'i-shield' },
  { cle: 'appletv', nom: 'Apple TV', icone: 'i-play' },
  { cle: 'tele', nom: 'Télé', icone: 'i-tv' },
  { cle: 'sonnette', nom: 'Sonnette', icone: 'i-bell' },
  { cle: 'wifi', nom: 'Wi-Fi invités', icone: 'i-wifi' },
  { cle: 'entretien', nom: 'Entretien', icone: 'i-battery' },
];

export function creerMaison(conteneur, { client, monotone, maintenant }) {
  const racine = element('section', 'ecran-page maison');
  const entete = element('header', 'page-entete maison-entete');
  entete.appendChild(element('h2', 'intitule', 'Maison'));
  const essai = element('p', 'maison-essai');
  essai.appendChild(icone('i-alert', 'maison-essai-icone'));
  essai.appendChild(element('span', '', 'Mode essai : rien n\'est envoyé à la maison'));
  essai.hidden = true;
  entete.appendChild(essai);

  const barre = element('nav', 'maison-onglets');
  barre.setAttribute('aria-label', 'Sections de la maison');
  const corps = element('div', 'maison-corps');
  const envoyer = (chemin, corpsAction) => client.poster(chemin, corpsAction);
  const sections = {
    alarme: creerSectionAlarme(corps),
    appletv: creerTelecommande(corps, { modele: 'appletv', envoyer, monotone }),
    tele: creerTelecommande(corps, { modele: 'tele', envoyer, monotone }),
    sonnette: creerSectionSonnette(corps, { client, monotone, maintenant }),
    wifi: creerSectionWifi(corps, { client, monotone }),
    entretien: creerSectionEntretien(corps, { client, monotone }),
  };
  const boutons = {};
  let visible = false;
  let ouverte = null;
  let simulation = false;
  const sonnetteAffichee = () => visible && ouverte === 'sonnette';
  const majEssai = () => masquer(essai, !simulation || ouverte === 'entretien');

  function ouvrirSection(cle) {
    ouverte = cle;
    ONGLETS.forEach((onglet) => {
      masquer(sections[onglet.cle].racine, onglet.cle !== cle);
      boutons[onglet.cle].classList.toggle('maison-onglet-actif', onglet.cle === cle);
      if (onglet.cle === cle) boutons[onglet.cle].setAttribute('aria-current', 'page');
      else boutons[onglet.cle].removeAttribute('aria-current');
    });
    majEssai();
    if (cle === 'sonnette') sections.sonnette.entretenir(sonnetteAffichee(), maintenant());
  }

  ONGLETS.forEach((onglet) => {
    const bouton = element('button', 'maison-onglet');
    bouton.type = 'button';
    bouton.appendChild(icone(onglet.icone, 'maison-onglet-icone'));
    bouton.appendChild(element('span', 'maison-onglet-nom', onglet.nom));
    bouton.addEventListener('pointerdown', () => ouvrirSection(onglet.cle));
    boutons[onglet.cle] = bouton;
    barre.appendChild(bouton);
  });

  racine.appendChild(entete);
  racine.appendChild(barre);
  racine.appendChild(corps);
  conteneur.appendChild(racine);
  ouvrirSection('alarme');

  return {
    racine,
    mettreAJour(donnees, ms) {
      const entites = donnees.entites;
      simulation = donnees.simulation_maison === true;
      majEssai();
      sections.alarme.mettreAJour(etatAlarme(entites['alarm_control_panel.alarme_maison'], ms), vueOuvertures(entites, ms));
      const telecommandes = vueTelecommandes(entites);
      sections.appletv.mettreAJour(telecommandes.appletv);
      sections.tele.mettreAJour(telecommandes.tele);
      sections.sonnette.mettreAJour(vueSonnette(entites, donnees.sonnette, ms), donnees.sonnette, donnees.direct_video, sonnetteAffichee(), ms);
      sections.entretien.mettreAJour(vueEntretien(entites), donnees.draps, ms);
    },
    ouvrirSection,
    lancerDirect(ms) {
      ouvrirSection('sonnette');
      sections.sonnette.lancerDirect(ms);
    },
    entretenir(ms) {
      sections.appletv.entretenir();
      sections.tele.entretenir();
      sections.sonnette.entretenir(sonnetteAffichee(), ms);
      sections.wifi.entretenir();
      sections.entretien.entretenir();
    },
    entrer() {
      visible = true;
      if (ouverte === 'sonnette') sections.sonnette.entretenir(true, maintenant());
    },
    quitter() {
      visible = false;
      sections.sonnette.arreter();
      sections.wifi.masquer();
      sections.entretien.quitter();
    },
    retenu: (ms) => sections.sonnette.actif(ms) || sections.wifi.affiche(),
  };
}
