// web/src/ecrans/voitures.js
//
// Rôle    : l'écran Voitures (entrée « Voitures » du menu, choix de Thomas du 14/10) : une grande carte par voiture, son
//           nom, l'icône et le mot de son état (débranchée, branchée, en charge avec l'heure de fin, charge programmée,
//           erreur), le pourcentage en très gros, l'autonomie, et une jauge en forme de batterie ; carte grisée avec « vu il
//           y a 9 h » quand la donnée est vieille ; sous la carte, ses commandes (voitures-commandes.js : Charger, Clim,
//           Phares, Klaxon, Charge mini, Charge cible) ; en tête, « Mode essai : rien n'est envoyé » tant que le serveur
//           simule les commandes. Sans voiture configurée : « Voiture pas encore reliée ».
// Entrées : creerVoitures(conteneur, { client, monotone }) : client (api.js : poster), horloge monotone (performance.now) ;
//           mettreAJour(vue) avec la vue de voitures-donnees.js (vueVoitures) ; entretenir() à chaque seconde (main.js).
// Sorties : { racine, mettreAJour(vue), entretenir() }.
// Pièges  :
//   - Commandes (décision de Thomas du 14/10) : toutes, un simple appui, AUCUNE protection contre les enfants (ni geste
//     parent ni confirmation) : c'est son choix. Seulement celles que le flux donne ; sans aucune, la carte reste seule,
//     comme avant. L'écran revient à l'Accueil après 60 s sans toucher, comme les autres.
//   - Vue préconstruite (2 blocs, CARTES_MAX : carte et commandes) : une mise à jour ne change que textes, icônes, classes,
//     hidden et la jauge (transform: scaleX, posée ici seulement si elle change). Une voiture : la carte sur toute la
//     largeur, ses commandes en une rangée dessous ; deux : classe voitures-deux, l'une sous l'autre, tailles réduites, et
//     les commandes à droite de chaque carte (voitures.css). Classe voiture-bloc-pilotable sur un bloc qui a des commandes
//     (une voiture : rangée dessous) ; classe voitures-pilotables sur la liste dès qu'une voiture en a (deux voitures : la
//     colonne des commandes réservée sur les DEUX blocs, vide pour une voiture en lecture seule, pour que les deux cartes
//     et leurs jauges gardent la même largeur).
//   - « Mode essai » : seulement si l'instantané dit simulation_voiture: true (serveur sans ACTIONS_VOITURE=1) et qu'il y a
//     quelque chose à piloter ; l'en-tête garde sa hauteur dans les deux cas (rien ne bouge au passage en réel).
//   - Le signe % est un span à part (voiture-unite) : dessiné en Fraunces d'affichage à 240 px, son trait est un filet
//     presque invisible à 2 m (vu sur capture) ; plus petit et en optique de texte, il se lit.
//   - Classes de la carte : voiture-etat-<état> (couleur de l'icône), voiture-bas (25 % ou moins : jauge en couleur
//     d'alerte), voiture-perimee (tout en gris secondaire).
//   - « Voiture pas encore reliée » : une phrase pour la famille ; ce que Thomas doit faire est dans le README
//     (« Voitures »), jamais à l'écran.

import {
  changerIcone, ecrire, element, icone, masquer,
} from '../dom.js';
import { creerCommandesVoiture } from './voitures-commandes.js';
import { CARTES_MAX, CLES_ETAT } from './voitures-donnees.js';

function construireCarte(parent) {
  const racine = element('article', 'carte voiture');
  const tete = element('div', 'voiture-tete');
  const nom = element('h2', 'voiture-nom');
  nom.appendChild(icone('i-voiture', 'voiture-nom-icone'));
  const texteNom = element('span', 'voiture-nom-texte');
  nom.appendChild(texteNom);
  const etat = element('div', 'voiture-etat');
  const picto = icone(null, 'voiture-etat-icone');
  const textes = element('div', 'voiture-etat-textes');
  const libelle = element('span', 'voiture-etat-libelle');
  const detail = element('span', 'voiture-etat-detail');
  textes.appendChild(libelle);
  textes.appendChild(detail);
  etat.appendChild(picto);
  etat.appendChild(textes);
  tete.appendChild(nom);
  tete.appendChild(etat);
  const chiffres = element('div', 'voiture-chiffres');
  const pourcentage = element('p', 'voiture-pourcentage chiffres chiffres-affiche');
  const nombre = element('span', '');
  const unite = element('span', 'voiture-unite', '%');
  pourcentage.appendChild(nombre);
  pourcentage.appendChild(unite);
  const autonomie = element('p', 'voiture-autonomie chiffres');
  chiffres.appendChild(pourcentage);
  chiffres.appendChild(autonomie);
  const jauge = element('div', 'voiture-jauge');
  const niveau = element('span', 'voiture-niveau');
  jauge.appendChild(niveau);
  [tete, chiffres, jauge].forEach((noeud) => racine.appendChild(noeud));
  parent.appendChild(racine);
  return {
    racine, texteNom, picto, libelle, detail, nombre, unite, autonomie, niveau,
  };
}

function rendreCarte(n, vue) {
  ecrire(n.texteNom, vue.nom);
  changerIcone(n.picto, vue.icone);
  ecrire(n.libelle, vue.libelle);
  masquer(n.detail, vue.detail === null);
  ecrire(n.detail, vue.detail || '');
  ecrire(n.nombre, vue.pourcentage);
  masquer(n.unite, vue.unite === null);
  masquer(n.autonomie, vue.autonomie === null);
  ecrire(n.autonomie, vue.autonomie || '');
  const transformation = `scaleX(${vue.niveau})`;
  if (n.niveau.style.transform !== transformation) n.niveau.style.transform = transformation;
  CLES_ETAT.forEach((cle) => n.racine.classList.toggle(`voiture-etat-${cle}`, cle === vue.etat));
  n.racine.classList.toggle('voiture-bas', vue.bas);
  n.racine.classList.toggle('voiture-perimee', vue.perimee);
}

export function creerVoitures(conteneur, { client, monotone }) {
  const racine = element('section', 'ecran-page voitures');
  const entete = element('header', 'page-entete voitures-entete');
  entete.appendChild(element('h2', 'intitule', 'Voitures'));
  const essai = element('p', 'voitures-essai');
  essai.appendChild(icone('i-alert', 'voitures-essai-icone'));
  essai.appendChild(element('span', '', 'Mode essai : rien n\'est envoyé'));
  essai.hidden = true;
  entete.appendChild(essai);
  const liste = element('div', 'voitures-liste');
  const envoyer = (chemin, corps) => client.poster(chemin, corps);
  const blocs = [];
  for (let i = 0; i < CARTES_MAX; i += 1) {
    const bloc = element('div', 'voiture-bloc');
    liste.appendChild(bloc);
    blocs.push({ bloc, carte: construireCarte(bloc), commandes: creerCommandesVoiture(bloc, { envoyer, monotone }) });
  }
  const vide = element('div', 'page-vide voitures-vide');
  vide.appendChild(icone('i-voiture', 'voitures-vide-icone'));
  vide.appendChild(element('p', 'page-vide-titre', 'Voiture pas encore reliée'));
  racine.appendChild(entete);
  racine.appendChild(liste);
  racine.appendChild(vide);
  conteneur.appendChild(racine);

  return {
    racine,
    mettreAJour(vue) {
      masquer(vide, vue.etat !== 'vide');
      masquer(liste, vue.etat !== 'ok');
      masquer(essai, !vue.essai);
      liste.classList.toggle('voitures-deux', vue.cartes.length > 1);
      liste.classList.toggle('voitures-pilotables', vue.cartes.some((carte) => carte.pilotable));
      blocs.forEach((b, i) => {
        const carte = vue.cartes[i];
        masquer(b.bloc, !carte);
        if (!carte) return;
        rendreCarte(b.carte, carte);
        b.bloc.classList.toggle('voiture-bloc-pilotable', carte.pilotable);
        b.commandes.mettreAJour(carte);
      });
    },
    entretenir() {
      blocs.forEach((b) => b.commandes.entretenir());
    },
  };
}
