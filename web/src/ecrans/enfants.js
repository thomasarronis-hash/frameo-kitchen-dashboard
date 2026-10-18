// web/src/ecrans/enfants.js
//
// Rôle    : l'écran Enfants (choix de Thomas du 14/10, partie 4, et décisions du 14/10 en fin d'après-midi) : l'entrée
//           (deux grandes cartes, visage et prénom), puis le mode enfant, menu masqué : bouton maison de 96 px, les deux
//           visages en haut pour passer de l'un à l'autre, le « +1 » libre de Timo (enfants-plus-un.js), la quête du matin de
//           Timo (chemin, bourse et minuteur d'écran) ou ses points et sa boutique, « D'abord, ensuite » de Pablo ; un appui
//           long de 3 s sur le visage d'un enfant (en haut, ou sur sa carte d'entrée) ouvre 60 s de mode parent pour lui
//           (composants/geste-parent.js ; bandeau avec le temps restant).
// Entrées : creerEnfants(conteneur, { client (api.js), maintenant (heure corrigée), sons (sons-enfants.js), surPleinEcran(actif),
//           allerAccueil() }) ; mettreAJour(valeur enfants du flux, ms) à chaque rendu ; entretenir(ms) chaque seconde.
// Sorties : { racine, mettreAJour(enfants, ms), entretenir(ms), entrer(), quitter(), ouvrirEnfant(id) }.
// Pièges  :
//   - Pas de comparaison entre frères : un seul tableau à la fois ; dans les visages du haut, seul celui de l'enfant affiché
//     peut porter l'étoile « fini » (l'ourson étoilé de Pablo à côté du renard de Timo était une comparaison chaque matin).
//   - Mode enfant = menu masqué (surPleinEcran, classe scene-enfant de la scène, posée par main.js) ; quitter l'écran (retour
//     à l'Accueil après 90 s sans toucher, pilotage.js, ou bouton maison) referme le mode parent et rend le menu.
//   - Navigation (maison, onglets, cartes d'entrée) sur pointerdown (règle de Wes), SAUF les visages : un visage attend le
//     lever (toucher court : changer d'enfant, ouvrir la carte) ou les 3 s (mode parent), geste-parent.js. Sur la carte
//     d'entrée, la carte ignore le pointerdown venu de son visage (cible dans le visage) : elle ne s'ouvre pas au poser.
//     Actions au lever du doigt ou à l'appui long (appui.js), conception §1.2.
//   - Écran présent (entrer() ou ouvrirEnfant() exporté, jusqu'à quitter()) : un geste de visage qui aboutit écran quitté
//     (doigt resté sur un visage masqué pendant qu'un autre touche la maison ou « Voir le direct », capture gardée) ne fait
//     rien ; un jeton parent reçu après la sortie est refermé aussitôt. Sinon le menu disparaîtrait sur l'Accueil.
//   - Mode parent ouvert pour l'enfant du visage tenu (affiché s'il ne l'était pas) ; refait pendant le mode parent, il
//     relance 60 s ; un toucher court sur un visage du haut passe à l'autre enfant sans fermer la session.
//   - Animations et sons liés au GESTE (réponse du serveur à la coche), sauf la fête du coffre et de « Ensuite » et le
//     rebond du total des points, liés à ce que l'enfant VOIT changer (vu : dernier état montré de sa quête et de ses
//     points ; pas au premier affichage, pas en changeant d'enfant). Pendant le mode parent, la comparaison attend : à
//     la fermeture (bouton ou 60 s), la quête revient et la fête se joue si le parent a validé la dernière étape ; un
//     point donné rebondit quand l'enfant revoit l'onglet Points.
//   - « +1 » libre : sur l'onglet Points, le total rebondit (avec son petit son) dès que la valeur du flux le montre
//     monté, comme tout point ; sur l'onglet Quête, où le total n'est pas affiché, la réponse du serveur fait rebondir le
//     bouton et voler une étoile vers l'onglet Points (le total rebondira quand Timo l'ouvrira). Le retour de 5 s
//     (dernierLibre) vient de cette réponse, pour l'enfant de l'écran seulement.
//   - Un refus du serveur s'écrit en une ligne courte et douce en bas de l'écran pendant 4 s (jamais rouge), aussi sur
//     l'écran d'entrée (la ligne est posée sur la racine) ; « déjà cochée » (double toucher) ne dit rien.
//   - Mode parent : session de 60 s (parent-donnees.js), fermée à l'expiration, au bouton Fermer ou en quittant l'écran ;
//     l'historique est relu à l'ouverture et après chaque action parent.

import { creerAvatar } from '../composants/avatar.js';
import { surAppui } from '../composants/appui.js';
import { surGesteParent } from '../composants/geste-parent.js';
import {
  ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';
import { vueBoutique, vuePlusUn } from './boutique-donnees.js';
import { creerBourse } from './enfants-bourse.js';
import { creerBoutique } from './enfants-boutique.js';
import {
  routineFinie, trouverEnfant, visage, vueEntree,
} from './enfants-donnees.js';
import {
  fete, pluie, rebond, voler,
} from './enfants-effets.js';
import { creerPablo } from './enfants-pablo.js';
import { creerPageParent } from './enfants-parent.js';
import { creerPlusUn } from './enfants-plus-un.js';
import { creerChemin } from './enfants-quete.js';
import { vuePablo } from './pablo-donnees.js';
import { creerEnvois, creerSessionParent, vueParent } from './parent-donnees.js';
import { vueBourse, vueQuete } from './quete-donnees.js';

const VISAGES_MAX = 4;
const DUREE_MESSAGE_MS = 4000;
const PIECES = 3;
const MESSAGES = {
  trop_tot: 'Pas encore : après 6\u00a0h\u00a030',
  points_insuffisants: 'Pas encore assez de points',
  mode_parent_requis: 'Le mode parent est fermé',
  aucune_minute: 'Plus de minutes pour aujourd\'hui',
  minutes_perdues: 'À demain',
  plafond_jour: 'Assez de points pour aujourd\'hui',
  plafond_libre: 'Assez de points pour aujourd\'hui',
  routine_finie: 'Fini pour ce matin',
  trop_tard: 'Trop tard pour annuler',
  aucun_point: 'Aucun point à retirer',
  points_depenses: 'Point déjà échangé',
};
const SILENCIEUX = ['deja_cochee', 'deja_en_cours', 'pas_en_cours', 'aucun_minuteur', 'pas_cochee', 'rien_a_annuler'];

function navigation(noeud, action) {
  noeud.addEventListener('pointerdown', action);
}

function construireEntree(racine, { ouvrir, parent }) {
  const entree = element('div', 'ecran-page enfants-entree');
  const entete = element('header', 'page-entete');
  entete.appendChild(element('h2', 'intitule', 'Enfants'));
  const cartes = element('div', 'enfants-cartes');
  const items = [];
  for (let i = 0; i < VISAGES_MAX; i += 1) {
    const carte = element('button', 'carte enfants-carte');
    carte.type = 'button';
    const avatar = creerAvatar('enfants-carte-avatar');
    const prenom = element('span', 'enfants-carte-prenom');
    carte.appendChild(avatar.racine);
    carte.appendChild(prenom);
    const id = { valeur: null };
    const siEnfant = (action) => () => {
      if (id.valeur) action(id.valeur);
    };
    navigation(carte, (e) => {
      if (!avatar.racine.contains(e.target)) siEnfant(ouvrir)();
    });
    surGesteParent(avatar.racine, { court: siEnfant(ouvrir), parent: siEnfant(parent) });
    cartes.appendChild(carte);
    items.push({
      carte, avatar, prenom, id,
    });
  }
  const attente = element('p', 'page-vide-titre enfants-attente', 'Tableau pas encore reçu');
  [entete, cartes, attente].forEach((noeud) => entree.appendChild(noeud));
  racine.appendChild(entree);
  return {
    entree,
    mettreAJour(vue) {
      masquer(attente, vue.etat !== 'attente');
      masquer(cartes, vue.etat !== 'ok');
      items.forEach((n, i) => {
        const v = vue.visages[i];
        masquer(n.carte, !v);
        if (!v) return;
        n.id.valeur = v.id;
        n.avatar.mettreAJour(v);
        ecrire(n.prenom, v.prenom);
      });
    },
  };
}

function construireTete(mode, gestes) {
  const tete = element('header', 'enfants-tete');
  const maison = element('button', 'enfants-maison');
  maison.type = 'button';
  maison.appendChild(icone('i-home', 'enfants-maison-icone'));
  etiqueter(maison, 'Accueil');
  navigation(maison, gestes.accueil);
  const titre = element('h1', 'enfants-titre');
  const bandeau = element('div', 'enfants-bandeau-parent');
  bandeau.appendChild(icone('i-deverrouille', 'enfants-bandeau-icone'));
  bandeau.appendChild(element('span', 'enfants-bandeau-nom', 'Mode parent'));
  const restant = element('span', 'enfants-bandeau-restant chiffres');
  bandeau.appendChild(restant);
  const fermer = element('button', 'bouton-doux enfants-bandeau-fermer');
  fermer.type = 'button';
  fermer.appendChild(icone('i-close', 'bouton-fort-icone'));
  fermer.appendChild(element('span', '', 'Fermer'));
  surAppui(fermer, gestes.fermerParent);
  bandeau.appendChild(fermer);
  [maison, titre, bandeau].forEach((noeud) => tete.appendChild(noeud));
  const plusUn = creerPlusUn(tete, { donner: gestes.plusUn, annuler: gestes.annulerPlusUn });
  const onglets = element('div', 'enfants-onglets');
  const parOnglet = {};
  [['quete', 'i-carte', 'Quête'], ['points', 'i-etoile', 'Points']].forEach(([cle, picto, nom]) => {
    const onglet = element('button', 'enfants-onglet');
    onglet.type = 'button';
    onglet.appendChild(icone(picto, 'enfants-onglet-icone'));
    onglet.appendChild(element('span', '', nom));
    navigation(onglet, () => gestes.onglet(cle));
    parOnglet[cle] = onglet;
    onglets.appendChild(onglet);
  });
  const visages = element('div', 'enfants-visages');
  const boutons = [];
  for (let i = 0; i < VISAGES_MAX; i += 1) {
    const bouton = element('button', 'enfants-visage');
    bouton.type = 'button';
    const avatar = creerAvatar('enfants-visage-avatar');
    bouton.appendChild(avatar.racine);
    const id = { valeur: null };
    const siEnfant = (action) => () => {
      if (id.valeur) action(id.valeur);
    };
    surGesteParent(bouton, { court: siEnfant(gestes.choisir), parent: siEnfant(gestes.parent) });
    visages.appendChild(bouton);
    boutons.push({ bouton, avatar, id });
  }
  [onglets, visages].forEach((noeud) => tete.appendChild(noeud));
  mode.appendChild(tete);
  return {
    titre, bandeau, restant, plusUn, onglets, parOnglet, boutons,
  };
}

export function creerEnfants(conteneur, {
  client, maintenant, sons, surPleinEcran, allerAccueil,
}) {
  const racine = element('section', 'enfants');
  let donnees = null;
  let vue = 'entree';
  let actif = null;
  let onglet = 'quete';
  let historique = null;
  let parentOuvert = false;
  let dernierMs = 0;
  let vu = null;
  let dernierLibre = null;
  let minuterieMessage = null;
  let present = false;
  const siPresent = (action) => (id) => {
    if (present) action(id);
  };
  const session = creerSessionParent({ client, maintenant });
  const envois = creerEnvois({ client, session });

  const entree = construireEntree(racine, { ouvrir: siPresent(ouvrirEnfant), parent: siPresent(ouvrirParent) });
  const mode = element('div', 'enfants-mode');
  const tete = construireTete(mode, {
    accueil: () => allerAccueil(),
    fermerParent: () => fermerParent(),
    onglet: (cle) => {
      onglet = cle;
      rendre(maintenant());
      observerActif();
    },
    choisir: siPresent(ouvrirEnfant),
    parent: siPresent(ouvrirParent),
    plusUn: (noeud) => donnerLibre(noeud),
    annulerPlusUn: () => annulerLibre(),
  });
  const corps = element('div', 'enfants-corps');
  const quete = element('div', 'quete');
  const chemin = creerChemin(quete, {
    cocher: (etape, noeud) => cocher(etape, noeud),
    annuler: (etape) => envoyer(envois.annuler(actif, etape)),
  });
  const bourse = creerBourse(quete, { minuteur: (action) => envoyer(envois.minuteur(actif, action)) });
  corps.appendChild(quete);
  const boutique = creerBoutique(corps, {
    demander: (cadeau) => envoyer(envois.demanderEchange(actif, cadeau), () => sons.jouer('point')),
  });
  const pablo = creerPablo(corps, {
    cocher: (etape, noeud) => cocher(etape, noeud),
    annuler: (etape) => envoyer(envois.annuler(actif, etape)),
  });
  const pageParent = creerPageParent(corps, {
    decider: (etape, decision) => actionParent(envois.decider(actif, etape, decision)),
    cocher: (etape) => actionParent(envois.cocher(actif, etape)),
    decocher: (etape) => actionParent(envois.annuler(actif, etape)),
    point: (motif) => actionParent(envois.donnerPoint(actif, motif)),
    retirer: () => actionParent(envois.retirerPoint(actif)),
    echange: (demande, decision) => actionParent(envois.deciderEchange(actif, demande, decision)),
  });
  mode.appendChild(corps);
  racine.appendChild(mode);
  const message = element('p', 'enfants-message');
  message.setAttribute('role', 'status');
  message.hidden = true;
  racine.appendChild(message);
  conteneur.appendChild(racine);

  function dire(texte) {
    ecrire(message, texte);
    masquer(message, false);
    clearTimeout(minuterieMessage);
    minuterieMessage = setTimeout(() => masquer(message, true), DUREE_MESSAGE_MS);
  }

  function envoyer(promesse, siOk) {
    return promesse.then((reponse) => {
      if (reponse.ok) {
        if (siOk) siOk(reponse.donnees);
      } else if (SILENCIEUX.indexOf(reponse.code) === -1) {
        dire(MESSAGES[reponse.code] || (reponse.statut === 0 ? 'Pas de réponse, rien n\'a changé' : reponse.message));
      }
      return reponse;
    });
  }

  function cocher(etape, noeud) {
    const enfant = trouverEnfant(donnees, actif);
    if (!enfant) return;
    const valeur = enfant.etapes.filter((e) => e.id === etape)[0];
    envoyer(envois.cocher(actif, etape), (resultat) => {
      if (resultat.statut !== 'valide') {
        sons.jouer('point');
        return;
      }
      rebond(noeud);
      if (enfant.type === 'minutes') {
        sons.jouer('etape');
        voler(racine, noeud, bourse.nombre, { classe: 'effet-plus', texte: `+${valeur ? valeur.valeur : ''}` });
        pluie(racine, bourse.nombre, PIECES);
        setTimeout(() => sons.jouer('piece'), 800);
      } else {
        sons.jouer('etoile');
        voler(racine, noeud, pablo.bocal, { classe: 'effet-etoile', icone: 'i-etoile' });
      }
    });
  }

  // Point libre (« +1 » de l'en-tête) : le total rebondit par observer() sur l'onglet Points ; sur la quête, l'étoile
  // vole vers l'onglet Points. Le retour de 5 s suit la réponse du serveur.
  function donnerLibre(noeud) {
    const id = actif;
    envoyer(envois.pointLibre(id), (resultat) => {
      dernierLibre = { enfant: id, jusqua: Date.parse(resultat.annulable_jusqu_a) };
      if (vue === 'enfant' && actif === id && onglet === 'quete' && !parentOuvert) {
        sons.jouer('point');
        rebond(noeud);
        voler(racine, noeud, tete.parOnglet.points, { classe: 'effet-etoile', icone: 'i-etoile' });
      }
      rendre(maintenant());
    });
  }

  function annulerLibre() {
    const id = actif;
    dernierLibre = null;
    rendre(maintenant());
    envoyer(envois.annulerPointLibre(id));
  }

  function actionParent(promesse) {
    envoyer(promesse, () => lireHistorique());
  }

  function lireHistorique() {
    envois.historique().then((reponse) => {
      if (reponse.ok) {
        historique = reponse.donnees;
        rendre(maintenant());
      }
    });
  }

  // Pour l'enfant du visage tenu (affiché s'il ne l'était pas : entrée, autre visage du haut) ; refait pendant le mode
  // parent, il relance simplement 60 s (nouveau jeton) sans effacer l'historique affiché. Écran quitté pendant la
  // demande du jeton : session refermée, rien d'affiché.
  function ouvrirParent(id) {
    session.ouvrir().then((resultat) => {
      if (!resultat.ok) {
        dire(resultat.message);
        return;
      }
      if (!present || !trouverEnfant(donnees, id)) {
        session.fermer();
        return;
      }
      if (vue !== 'enfant' || actif !== id) ouvrirEnfant(id);
      if (!parentOuvert) historique = null;
      parentOuvert = true;
      rendre(maintenant());
      lireHistorique();
    });
  }

  function fermerParent() {
    session.fermer();
    parentOuvert = false;
    historique = null;
    rendre(maintenant());
    observerActif();
  }

  const etatVu = (enfant) => ({ id: enfant.id, fini: routineFinie(enfant), solde: enfant.points ? enfant.points.solde : null });

  // Fête du coffre (Timo) et de « Ensuite » (Pablo), rebond du total des points : sur un changement que l'enfant voit,
  // appelé APRÈS le rendu (la vue montrée est celle qui s'anime). Chaque morceau ne se compare que quand il est montré.
  function observer(enfant) {
    if (parentOuvert) return;
    if (!vu || vu.id !== enfant.id) {
      vu = etatVu(enfant);
      return;
    }
    const etat = etatVu(enfant);
    if (enfant.type !== 'minutes' || onglet === 'quete') {
      if (!vu.fini && etat.fini) {
        sons.jouer('coffre');
        fete(racine, enfant.type === 'minutes' ? chemin.coffre : pablo.ensuite);
      }
      vu.fini = etat.fini;
    } else if (etat.solde !== null) {
      if (vu.solde !== null && etat.solde > vu.solde) {
        sons.jouer('point');
        rebond(boutique.solde);
      }
      vu.solde = etat.solde;
    }
  }

  function observerActif() {
    const enfant = vue === 'enfant' ? trouverEnfant(donnees, actif) : null;
    if (enfant) observer(enfant);
  }

  function rendreTete(enfant, ms) {
    const titres = { quete: 'La quête du matin', points: 'Mes points' };
    const titre = enfant.type === 'minutes' ? titres[onglet] : '';
    masquer(tete.titre, parentOuvert || titre === '');
    ecrire(tete.titre, titre);
    masquer(tete.bandeau, !parentOuvert);
    ecrire(tete.restant, `${session.restantS()}\u00a0s`);
    const plusUn = parentOuvert ? null : vuePlusUn(enfant, dernierLibre, ms);
    masquer(tete.plusUn.racine, plusUn === null);
    if (plusUn) tete.plusUn.mettreAJour(plusUn, ms);
    const avecOnglets = enfant.type === 'minutes' && Boolean(enfant.points) && !parentOuvert;
    masquer(tete.onglets, !avecOnglets);
    Object.keys(tete.parOnglet).forEach((cle) => tete.parOnglet[cle].classList.toggle('enfants-onglet-actif', cle === onglet));
    const liste = donnees.enfants;
    tete.boutons.forEach((n, i) => {
      const autre = liste[i];
      masquer(n.bouton, !autre);
      if (!autre) return;
      n.id.valeur = autre.id;
      const sien = visage(autre);
      n.avatar.mettreAJour({ ...sien, fini: sien.fini && autre.id === actif });
      n.bouton.classList.toggle('enfants-visage-actif', autre.id === actif);
    });
  }

  function rendreCorps(enfant, ms) {
    const surQuete = !parentOuvert && enfant.type === 'minutes' && onglet === 'quete';
    const surPoints = !parentOuvert && enfant.type === 'minutes' && onglet === 'points' && Boolean(enfant.points);
    const surPablo = !parentOuvert && enfant.type !== 'minutes';
    masquer(quete, !surQuete);
    masquer(boutique.racine, !surPoints);
    masquer(pablo.racine, !surPablo);
    masquer(pageParent.racine, !parentOuvert);
    if (surQuete) {
      chemin.mettreAJour(vueQuete(enfant, donnees, ms), visage(enfant), ms);
      bourse.mettreAJour(vueBourse(enfant, ms));
    } else if (surPoints) {
      boutique.mettreAJour(vueBoutique(enfant, donnees.boutique || [], donnees.motifs || []));
    } else if (surPablo) {
      pablo.mettreAJour(vuePablo(enfant, donnees, ms));
    } else {
      pageParent.mettreAJour(vueParent(enfant, donnees, historique));
    }
  }

  function rendre(ms) {
    dernierMs = ms;
    masquer(entree.entree, vue !== 'entree');
    masquer(mode, vue !== 'enfant');
    if (vue === 'entree') {
      entree.mettreAJour(vueEntree(donnees));
      return;
    }
    const enfant = trouverEnfant(donnees, actif);
    if (!enfant) {
      masquer(mode, true);
      masquer(entree.entree, false);
      entree.mettreAJour(vueEntree(donnees));
      return;
    }
    rendreTete(enfant, ms);
    rendreCorps(enfant, ms);
  }

  // Changer d'enfant (aussi en mode parent) repart de ce qu'il montre maintenant : pas de fête pour un coffre déjà ouvert.
  function ouvrirEnfant(id) {
    vue = 'enfant';
    if (id !== actif) onglet = 'quete';
    actif = id;
    surPleinEcran(true);
    const enfant = trouverEnfant(donnees, actif);
    vu = enfant ? etatVu(enfant) : null;
    rendre(maintenant());
  }

  return {
    racine,
    mettreAJour(enfants, ms) {
      donnees = enfants;
      rendre(ms);
      observerActif();
    },
    entretenir(ms) {
      if (vue !== 'enfant' || !donnees) return;
      if (parentOuvert && !session.actif()) {
        fermerParent();
        return;
      }
      if (Math.floor(ms / 1000) !== Math.floor(dernierMs / 1000)) rendre(ms);
    },
    entrer() {
      present = true;
      vue = 'entree';
      if (parentOuvert) fermerParent();
      surPleinEcran(false);
      rendre(maintenant());
    },
    quitter() {
      present = false;
      session.fermer();
      parentOuvert = false;
      historique = null;
      surPleinEcran(false);
    },
    ouvrirEnfant(id) {
      present = true;
      ouvrirEnfant(id);
    },
  };
}
