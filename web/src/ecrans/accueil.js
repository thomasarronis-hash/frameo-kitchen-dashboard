// web/src/ecrans/accueil.js
//
// Rôle    : l'écran Accueil, disposition A tranchée par Thomas (Q34, décisions du 11/10), le même matin et soir depuis
//           le 14/10 : à gauche l'heure avec la température et le ciel à sa droite, la date et une ligne « ciel · pluie
//           dans l'heure » avec à leur droite l'encart « Aujourd'hui » (qui ouvre la page Aujourd'hui), le bloc
//           « Ce soir » (ou « Ce midi » le week-end avant 14h) et les cartes (Courses, Air et pollens) ; à droite
//           « La semaine » sur 7 jours avec les repas, l'agenda et la pastille EDF Tempo d'aujourd'hui et de demain ;
//           en bas les gros boutons Minuteur, Alarme, Wi-Fi invités (ou la case Tempo la veille d'un jour rouge ou
//           blanc, ou le matin la case des enfants) et Apple TV ; la fiche Tempo par-dessus l'écran.
// Entrées : le conteneur (#ecran) ; actions { ouvrirRecette(repasId), ouvrirCourses(), ouvrirMinuteurs(),
//           ouvrirMaison(section), ouvrirAujourdhui(), ouvrirEnfant(id) } ;
//           mettreAJour(vue, encart), la vue calculée par accueil-donnees.js et l'encart de aujourdhui-donnees.js
//           (encartAujourdhui).
// Sorties : creerAccueil(conteneur, actions) -> { racine, mettreAJour(vue, encart), entrer() } (entrer, appelé par le
//           routeur à chaque affichage, retour à l'Accueil après 60 s compris, referme la fiche Tempo).
// Pièges  :
//   - Vue préconstruite une fois (4 lignes de courses, 7 jours de 2 lignes de repas, 2 lignes d'agenda et une
//     pastille Tempo, 3 badges de l'encart, la fiche Tempo) :
//     chaque mise à jour ne change que des textes, des icônes, des classes et des attributs hidden, et
//     seulement ce qui change (dom.js) (règle de Wes, conception §1.2).
//   - Décision de Thomas du 14/10 : plus de brief du matin en phrases sous l'heure (« une montagne de texte ») ;
//     l'Accueil est le même toute la journée (option A validée le 11/10 : température actuelle en 120 px à droite de
//     l'heure). Le maxi et le mini du jour sont dans « La semaine » (une seule source, Open-Meteo : une fourchette
//     tirée de met.no les contredisait), le détail du jour sur la page Aujourd'hui.
//   - Ligne du ciel : le ciel, puis la pluie dans l'heure seulement s'il en tombe (goutte et quantité) ; rien de plus
//     quand il fait sec.
//   - Encart « Aujourd'hui » : une tuile de 96 px à droite de la date et de la ligne du ciel (les deux lignes font
//     112 px : la colonne ne grandit pas), 300 px de large, ce qui laisse 700 px à la date (la plus longue,
//     « Dimanche 1er septembre · Paris », en fait 687, mesuré). Une icône et un nombre par sujet non vide
//     (rendez-vous, rappels, alertes), « rien de prévu » sinon ; le détail est sur la page Aujourd'hui.
//   - Le plat est en 90 px sur UNE ligne, coupé par une ellipse : son titre complet est dans « La semaine » (sur
//     2 lignes les jours à un seul repas, et aujourd'hui après 14h) et dans l'écran Repas (option A). Le bouton
//     Recette n'existe que si la recette existe (repasId non null).
//   - La semaine, agenda : au plus 2 lignes de texte par jour, repas et agenda compris (accueil-donnees.js) ;
//     une ligne d'agenda porte 1 ou 2 rendez-vous, chacun précédé de la pastille de sa personne (couleur et
//     initiale), et « +N » toujours visible.
//   - Chaque bloc a un état vide écrit, jamais un trou : « Météo pas encore reçue » (ligne gardée à sa
//     hauteur), « Menu pas encore publié », « Prévisions pas encore reçues ».
//   - Ouvrir un écran, le tiroir ou la fiche Tempo (Recette, encart Aujourd'hui, carte Courses, Minuteur, Alarme,
//     Wi-Fi invités, Apple TV, pastille ou case Tempo) est une NAVIGATION : sur pointerdown (conception §1.2). Les
//     articles de la carte Courses ont une puce, pas une case : on coche dans l'écran Courses, que la carte ouvre.
//   - Plus de carte « À faire » (décision de Thomas du 14/10 : doublon avec les alertes de la page Aujourd'hui) : la
//     rangée garde Courses et Air et pollens à parts égales, sur toute la largeur (mesuré).
//   - Pastille Tempo de « La semaine » : 36 px, dans une colonne de 40 px entre le jour et le ciel, mais sa zone de
//     toucher fait 96 x 96 px (elle déborde sur les écarts) ; seulement aujourd'hui et demain.
//   - Case Tempo (veille d'un rouge ou d'un blanc, dès la pré-annonce) : elle prend la place du bouton Wi-Fi invités,
//     le moins utile au quotidien (un invité de temps en temps, et l'onglet Wi-Fi de Maison reste à un toucher) ; les
//     trois autres servent chaque jour (Minuteur en cuisine, Alarme pour voir ce qui est ouvert, Apple TV le soir).
//     Même place, 386 px de large : « Demain rouge » sur une ligne, « Heures creuses, / les machines ! » sur deux à
//     partir de 22 h (mesuré). Rouge plein pour un rouge ; pour un blanc, plus discrète (fond de carte, pastille
//     blanche cerclée).
//   - Case des enfants (choix de Thomas du 14/10, partie 4) : de 5 h à fin_routine (9 h), à la place de Wi-Fi invités et avant la
//     case Tempo (accueil-donnees.js) ; les deux visages dessinés (72 px), chacun sur sa moitié de case, qui ouvre
//     directement le tableau de cet enfant (une navigation : pointerdown) ; une étoile dorée sur le visage dont la routine
//     est finie, jamais de chiffre (pas de comparaison entre frères).
//   - Alarme, Wi-Fi invités et Apple TV ouvrent leur section de l'écran Maison (Alarme : la vue des ouvertures, en
//     lecture seule ; Apple TV : sa télécommande, l'onglet Télé est à côté). Le bouton porte le nom de ce qu'il
//     ouvre : appelé « Télé », il ouvrait l'onglet « Apple TV ». Le bouton Alarme porte trois
//     lignes : son nom, l'état de alarm_control_panel.alarme_maison, puis « tout fermé » ou le nombre d'ouvertures.
//   - L'heure, la température et l'horloge de nuit portent la classe chiffres-affiche (base.css) : le réglage
//     de Fraunces des chiffres lus à 2 m est en un seul endroit.

import { creerAvatar } from '../composants/avatar.js';
import { carteTitree } from '../composants/carte.js';
import { creerLigneRendezVous } from '../composants/rendez-vous.js';
import { creerFicheTempo, creerPastilleTempo, majPastilleTempo } from '../composants/tempo.js';
import { changerIcone, ecrire, element, etiqueter, icone, masquer } from '../dom.js';

const LIGNES_COURSES = 4;
const LIGNES_REPAS = 2;
const LIGNES_AGENDA = 2;
const RENDEZ_VOUS_SEMAINE = 2;
const BADGES = 3;
const JOURS = 7;
const BOUTONS_MAISON = [
  { nom: 'Alarme', icone: 'i-shield', section: 'alarme', etat: true },
  { nom: 'Wi-Fi invités', icone: 'i-wifi', section: 'wifi' },
  { nom: 'Apple TV', icone: 'i-play', section: 'appletv' },
];

function lignes(parent, classeListe, classeLigne, nombre) {
  const liste = element('ul', classeListe);
  const noeuds = [];
  for (let i = 0; i < nombre; i += 1) {
    const ligne = element('li', classeLigne);
    noeuds.push(ligne);
    liste.appendChild(ligne);
  }
  parent.appendChild(liste);
  return noeuds;
}

function remplirLignes(noeuds, textes) {
  noeuds.forEach((noeud, i) => {
    masquer(noeud, i >= textes.length);
    if (i < textes.length) ecrire(noeud, textes[i]);
  });
}

function construireTete() {
  const tete = element('div', 'accueil-tete');
  const heure = element('div', 'accueil-heure chiffres chiffres-affiche');
  const meteo = element('div', 'accueil-meteo');
  const temperature = element('div', 'accueil-temperature chiffres chiffres-affiche');
  const picto = icone(null, 'accueil-ciel-picto');
  meteo.appendChild(temperature);
  meteo.appendChild(picto);
  tete.appendChild(heure);
  tete.appendChild(meteo);
  return {
    racine: tete, heure, meteo, temperature, picto,
  };
}

function construireCiel() {
  const ciel = element('p', 'accueil-ciel');
  const libelle = element('span', 'accueil-ciel-libelle');
  const pluie = element('span', 'accueil-pluie');
  pluie.appendChild(icone('i-drop', 'accueil-pluie-icone'));
  const pluieTexte = element('span', '');
  pluie.appendChild(pluieTexte);
  ciel.appendChild(libelle);
  ciel.appendChild(pluie);
  return {
    racine: ciel, libelle, pluie, pluieTexte,
  };
}

function construireEncart(actions) {
  const bouton = element('button', 'accueil-aujourdhui');
  bouton.type = 'button';
  const tete = element('span', 'accueil-aujourdhui-tete');
  tete.appendChild(icone('i-today', 'accueil-aujourdhui-icone'));
  tete.appendChild(element('span', 'accueil-aujourdhui-nom', 'Aujourd\'hui'));
  const badges = element('span', 'accueil-aujourdhui-badges');
  const items = [];
  for (let i = 0; i < BADGES; i += 1) {
    const badge = element('span', 'accueil-badge');
    const picto = icone(null, 'accueil-badge-icone');
    const nombre = element('span', 'accueil-badge-nombre');
    badge.appendChild(picto);
    badge.appendChild(nombre);
    badges.appendChild(badge);
    items.push({ badge, picto, nombre });
  }
  const rien = element('span', 'accueil-aujourdhui-rien', 'rien de prévu');
  [tete, badges, rien].forEach((noeud) => bouton.appendChild(noeud));
  bouton.addEventListener('pointerdown', () => actions.ouvrirAujourdhui());
  return {
    racine: bouton,
    mettreAJour(encart) {
      etiqueter(bouton, encart.etiquette);
      masquer(badges, encart.badges.length === 0);
      masquer(rien, encart.badges.length > 0);
      items.forEach((n, i) => {
        const badge = encart.badges[i];
        masquer(n.badge, !badge);
        if (!badge) return;
        changerIcone(n.picto, badge.icone);
        ecrire(n.nombre, String(badge.nombre));
        n.badge.classList.toggle('accueil-badge-alerte', badge.alerte);
      });
    },
  };
}

function construireSoir(actions) {
  const soir = element('section', 'accueil-soir');
  const intitule = element('h2', 'intitule', 'Ce soir');
  const plat = element('p', 'accueil-plat');
  const vide = element('p', 'accueil-soir-vide');
  const ligne = element('div', 'accueil-soir-ligne');
  const details = element('span', 'accueil-soir-details');
  const bouton = element('button', 'bouton-fort bouton-recette');
  bouton.type = 'button';
  bouton.appendChild(icone('i-fork', 'bouton-fort-icone'));
  bouton.appendChild(element('span', '', 'Recette'));
  let repasId = null;
  bouton.addEventListener('pointerdown', () => {
    if (repasId) actions.ouvrirRecette(repasId);
  });
  ligne.appendChild(details);
  ligne.appendChild(bouton);
  [intitule, plat, vide, ligne].forEach((noeud) => soir.appendChild(noeud));
  return {
    racine: soir,
    mettreAJour(repas) {
      ecrire(intitule, repas.intitule);
      masquer(plat, repas.titre === null);
      masquer(ligne, repas.titre === null);
      masquer(vide, repas.message === null);
      if (repas.message !== null) ecrire(vide, repas.message);
      if (repas.titre === null) return;
      ecrire(plat, repas.titre);
      ecrire(details, repas.details);
      repasId = repas.repasId;
      masquer(bouton, repasId === null);
    },
  };
}

function construireCartes(actions) {
  const cartes = element('div', 'accueil-cartes');
  const courses = carteTitree('article', 'carte-courses carte-touchable', 'Courses', 'i-cart');
  courses.racine.setAttribute('role', 'button');
  courses.racine.addEventListener('pointerdown', () => actions.ouvrirCourses());
  const articles = lignes(courses.racine, 'carte-liste', 'carte-article', LIGNES_COURSES);
  const coursesMessage = element('p', 'carte-message');
  courses.racine.appendChild(coursesMessage);

  const air = carteTitree('article', 'carte-air', 'Air et pollens', 'i-leaf');
  const airNiveau = element('p', 'air-niveau');
  const airPastille = element('span', 'air-pastille');
  const airLibelle = element('span', 'air-libelle');
  const airIndice = element('span', 'air-indice');
  airNiveau.appendChild(airPastille);
  airNiveau.appendChild(airLibelle);
  airNiveau.appendChild(airIndice);
  const airPollen = element('p', 'carte-message');
  air.racine.appendChild(airNiveau);
  air.racine.appendChild(airPollen);

  cartes.appendChild(courses.racine);
  cartes.appendChild(air.racine);
  return {
    racine: cartes,
    courses: { titre: courses.titre, articles, message: coursesMessage },
    air: { racine: air.racine, pastille: airPastille, libelle: airLibelle, indice: airIndice, pollen: airPollen },
  };
}

function construireSemaine(ouvrirFiche) {
  const semaine = element('section', 'carte semaine');
  semaine.appendChild(element('h2', 'intitule', 'La semaine'));
  const message = element('p', 'semaine-message', 'Prévisions pas encore reçues');
  semaine.appendChild(message);
  const jours = [];
  for (let i = 0; i < JOURS; i += 1) {
    const ligne = element('div', 'semaine-jour');
    const nom = element('span', 'semaine-nom');
    const zoneTempo = element('button', 'tempo-zone');
    zoneTempo.type = 'button';
    const pastilleTempo = creerPastilleTempo('tempo-pastille-semaine');
    zoneTempo.appendChild(pastilleTempo);
    zoneTempo.addEventListener('pointerdown', ouvrirFiche);
    const picto = icone(null, 'semaine-picto');
    picto.removeAttribute('aria-hidden');
    picto.setAttribute('role', 'img');
    const temps = element('span', 'semaine-temps chiffres');
    const maxi = element('span', 'semaine-maxi');
    const mini = element('span', 'semaine-mini');
    temps.appendChild(maxi);
    temps.appendChild(mini);
    const repas = element('div', 'semaine-repas');
    const lignesRepas = [];
    for (let r = 0; r < LIGNES_REPAS; r += 1) {
      const ligneRepas = element('span', 'semaine-repas-ligne');
      lignesRepas.push(ligneRepas);
      repas.appendChild(ligneRepas);
    }
    const lignesAgenda = [];
    for (let a = 0; a < LIGNES_AGENDA; a += 1) {
      lignesAgenda.push(creerLigneRendezVous(repas, { nombre: RENDEZ_VOUS_SEMAINE, classe: 'semaine-agenda' }));
    }
    [nom, zoneTempo, picto, temps, repas].forEach((noeud) => ligne.appendChild(noeud));
    semaine.appendChild(ligne);
    jours.push({
      ligne, nom, zoneTempo, pastilleTempo, picto, maxi, mini, repas, lignesRepas, lignesAgenda,
    });
  }
  return { racine: semaine, message, jours };
}

function boutonMaison(def) {
  const bouton = element('button', 'bouton-maison');
  bouton.type = 'button';
  bouton.appendChild(icone(def.icone, 'bouton-icone'));
  const textes = element('span', 'bouton-textes');
  textes.appendChild(element('span', 'bouton-nom', def.nom));
  bouton.appendChild(textes);
  return { bouton, textes };
}

// La case Tempo, à la place du bouton Wi-Fi invités la veille d'un jour rouge ou blanc : lave-linge, puis une ou deux lignes.
function construireCaseTempo(ouvrirFiche) {
  const { bouton, textes } = boutonMaison({ nom: '', icone: 'i-machine' });
  bouton.classList.add('case-tempo');
  bouton.hidden = true;
  const detail = element('span', 'bouton-nom case-tempo-detail');
  textes.appendChild(detail);
  bouton.addEventListener('pointerdown', ouvrirFiche);
  return {
    bouton,
    mettreAJour(vue) {
      const classe = `bouton-maison case-tempo case-tempo-${vue.couleur}${vue.creuses ? ' case-tempo-creuses' : ''}`;
      if (bouton.className !== classe) bouton.className = classe;
      ecrire(textes.firstChild, vue.nom);
      masquer(detail, vue.detail === null);
      ecrire(detail, vue.detail || '');
      etiqueter(bouton, vue.detail ? `${vue.nom} ${vue.detail}` : vue.nom);
    },
  };
}

// La case des enfants, le matin : un visage par moitié, chacun ouvre le tableau de son enfant.
function construireCaseEnfants(actions) {
  const caseEnfants = element('div', 'bouton-maison case-enfants');
  caseEnfants.hidden = true;
  const visages = [];
  for (let i = 0; i < 2; i += 1) {
    const bouton = element('button', 'case-enfants-visage');
    bouton.type = 'button';
    const avatar = creerAvatar('case-enfants-avatar');
    bouton.appendChild(avatar.racine);
    const id = { valeur: null };
    bouton.addEventListener('pointerdown', () => {
      if (id.valeur) actions.ouvrirEnfant(id.valeur);
    });
    caseEnfants.appendChild(bouton);
    visages.push({ bouton, avatar, id });
  }
  return {
    racine: caseEnfants,
    mettreAJour(vue) {
      visages.forEach((n, i) => {
        const visage = vue.visages[i];
        masquer(n.bouton, !visage);
        if (!visage) return;
        n.id.valeur = visage.id;
        n.avatar.mettreAJour(visage);
        etiqueter(n.bouton, `Tableau de ${visage.prenom}${visage.fini ? ', routine finie' : ''}`);
      });
    },
  };
}

function construireBarre(actions, ouvrirFiche) {
  const barre = element('div', 'accueil-barre');
  const minuteur = boutonMaison({ nom: 'Minuteur', icone: 'i-timer' });
  minuteur.bouton.addEventListener('pointerdown', () => actions.ouvrirMinuteurs());
  barre.appendChild(minuteur.bouton);
  let etatAlarme = null;
  let ouvertures = null;
  let wifi = null;
  const caseTempo = construireCaseTempo(ouvrirFiche);
  const caseEnfants = construireCaseEnfants(actions);
  BOUTONS_MAISON.forEach((def) => {
    if (def.section === 'appletv') {
      barre.appendChild(caseTempo.bouton);
      barre.appendChild(caseEnfants.racine);
    }
    const { bouton, textes } = boutonMaison(def);
    if (def.etat) {
      etatAlarme = element('span', 'bouton-etat');
      ouvertures = element('span', 'bouton-ouvertures');
      textes.appendChild(etatAlarme);
      textes.appendChild(ouvertures);
      bouton.classList.add('bouton-maison-alarme');
    }
    bouton.addEventListener('pointerdown', () => actions.ouvrirMaison(def.section));
    if (def.section === 'wifi') wifi = bouton;
    barre.appendChild(bouton);
  });
  return {
    racine: barre, etatAlarme, ouvertures, wifi, caseTempo, caseEnfants,
  };
}

function majMeteo(tete, ciel, meteo) {
  masquer(tete.meteo, meteo === null);
  masquer(ciel.pluie, meteo === null || meteo.pluie === null);
  if (!meteo) {
    ecrire(ciel.libelle, 'Météo pas encore reçue');
    return;
  }
  ecrire(tete.temperature, meteo.temperature || '');
  changerIcone(tete.picto, meteo.picto);
  ecrire(ciel.libelle, meteo.libelle);
  if (meteo.pluie !== null) ecrire(ciel.pluieTexte, meteo.pluie);
}

function majCartes(cartes, vue) {
  ecrire(cartes.courses.titre, vue.courses.titre);
  remplirLignes(cartes.courses.articles, vue.courses.articles);
  masquer(cartes.courses.message, vue.courses.message === null);
  if (vue.courses.message !== null) ecrire(cartes.courses.message, vue.courses.message);

  const air = vue.air;
  masquer(cartes.air.racine, air === null);
  if (air) {
    cartes.air.pastille.className = air.classe ? `air-pastille air-${air.classe}` : 'air-pastille air-inconnu';
    ecrire(cartes.air.libelle, air.libelle);
    ecrire(cartes.air.indice, air.indice);
    masquer(cartes.air.pollen, air.pollen === null);
    if (air.pollen !== null) ecrire(cartes.air.pollen, air.pollen);
  }

}

function majSemaine(noeuds, semaine) {
  const jours = semaine || [];
  masquer(noeuds.message, jours.length > 0);
  noeuds.jours.forEach((noeud, i) => {
    const jour = jours[i];
    masquer(noeud.ligne, !jour);
    if (!jour) return;
    noeud.ligne.classList.toggle('semaine-jour-auj', jour.aujourdhui);
    ecrire(noeud.nom, jour.jour);
    changerIcone(noeud.picto, jour.picto);
    etiqueter(noeud.picto, jour.libelle);
    ecrire(noeud.maxi, jour.maxi || '');
    ecrire(noeud.mini, jour.mini || '');
    masquer(noeud.repas, jour.repas.length === 0 && jour.agenda.length === 0);
    noeud.repas.classList.toggle('semaine-repas-seul', jour.repas.length === 1 && jour.agenda.length === 0);
    remplirLignes(noeud.lignesRepas, jour.repas);
    noeud.lignesAgenda.forEach((ligne, a) => ligne.mettreAJour(jour.agenda[a] || null));
    masquer(noeud.zoneTempo, jour.tempo === null);
    if (jour.tempo) {
      majPastilleTempo(noeud.pastilleTempo, jour.tempo);
      etiqueter(noeud.zoneTempo, jour.tempo.etiquette);
    }
  });
}

function majBarre(barre, vue) {
  ecrire(barre.etatAlarme, vue.alarme ? vue.alarme.libelle : '');
  barre.etatAlarme.classList.toggle('bouton-etat-alerte', Boolean(vue.alarme && vue.alarme.alerte));
  ecrire(barre.ouvertures, vue.alarme ? vue.alarme.ouvertures : '');
  barre.ouvertures.classList.toggle('bouton-ouvertures-alerte', Boolean(vue.alarme && vue.alarme.ouverturesAlerte));
  const enfants = vue.enfants || null;
  const tempo = enfants ? null : vue.tempo;
  masquer(barre.wifi, tempo !== null || enfants !== null);
  masquer(barre.caseTempo.bouton, tempo === null);
  if (tempo) barre.caseTempo.mettreAJour(tempo);
  masquer(barre.caseEnfants.racine, enfants === null);
  if (enfants) barre.caseEnfants.mettreAJour(enfants);
}

export function creerAccueil(conteneur, actions) {
  const racine = element('section', 'accueil');
  const gauche = element('div', 'accueil-gauche');
  const tete = construireTete();
  const repere = element('div', 'accueil-repere');
  const date = element('div', 'accueil-date');
  const ciel = construireCiel();
  const encart = construireEncart(actions);
  [date, ciel.racine, encart.racine].forEach((noeud) => repere.appendChild(noeud));
  const soir = construireSoir(actions);
  const cartes = construireCartes(actions);
  [tete.racine, repere, soir.racine, cartes.racine].forEach((noeud) => gauche.appendChild(noeud));
  const fiche = creerFicheTempo(racine);
  let contenuFiche = null;
  const ouvrirFiche = () => {
    if (contenuFiche) fiche.ouvrir(contenuFiche);
  };
  const semaine = construireSemaine(ouvrirFiche);
  const barre = construireBarre(actions, ouvrirFiche);
  racine.appendChild(gauche);
  racine.appendChild(semaine.racine);
  racine.appendChild(barre.racine);
  conteneur.appendChild(racine);

  return {
    racine,
    mettreAJour(vue, vueEncart) {
      ecrire(tete.heure, vue.heure);
      ecrire(date, vue.date);
      majMeteo(tete, ciel, vue.meteo);
      encart.mettreAJour(vueEncart);
      soir.mettreAJour(vue.repas);
      majCartes(cartes, vue);
      majSemaine(semaine, vue.semaine);
      majBarre(barre, vue);
      contenuFiche = vue.ficheTempo;
      if (fiche.ouverte()) fiche.ouvrir(contenuFiche);
    },
    entrer: () => fiche.fermer(),
  };
}
