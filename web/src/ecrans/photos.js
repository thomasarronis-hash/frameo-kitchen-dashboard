// web/src/ecrans/photos.js
//
// Rôle    : l'écran Photos (conception §1.5, piste 5, M4) : en mode ambiant, une photo Immich plein écran (ou une paire
//           de portraits, ou un portrait seul sur fond Ardoise), fondu de 1,5 s toutes les 30 s, avec des pastilles en
//           verre « teinte » : horloge et date en bas à gauche, météo en haut à droite, « Ce soir » et minuteur en cours
//           en bas à droite, légende de chaque photo (ville, mois). Plus de face « page » depuis le 14/10 : l'écran n'est
//           plus au menu (menu.js), on n'y entre qu'après 3 min sans toucher, une vue déjà chargée (pilotage.js).
// Entrées : creerPhotos(conteneur, { client, monotone }) : client.lire (api.js) pour GET /api/photos/lot, horloge
//           monotone (performance.now) ; mettreAJour(donnees, ms) avec l'état du flux (photos_configurees, entites,
//           pluie, menu) et l'heure corrigée ; mettreAJourMinuteur(vue) avec vuePastille de minuteurs.js ;
//           entretenir({ preparer }) à chaque seconde (preparer : decisionPhotos rend 'preparer', la minute qui précède
//           l'entrée) ; entrer({ nuit, enLigne }) et quitter() quand le routeur l'affiche ou le quitte.
// Sorties : { racine, mettreAJour(donnees, ms), mettreAJourMinuteur(vue), entretenir({ preparer }), entrer(contexte) ->
//           vrai si le mode ambiant s'ouvre, quitter(), ambiance(), pretes(), vuePrete() } ; pretes() dit si un lot de
//           photos est là (la préparation peut commencer), vuePrete() si la première vue est chargée (main.js n'entre
//           pas dans le mode Photos sans elle).
// Pièges  :
//   - Les RÈGLES (lot, paires, préchargement, échecs, 30 s) sont dans web/src/photos.js, sans DOM et testées ; ici,
//     deux calques superposés : celui de devant montre la vue affichée, celui de derrière charge la suivante. Une
//     vue ne passe devant (fondu d'opacité, seule animation, conception §1.2) qu'une fois ses images chargées et
//     décodées : jamais d'écran vide ni d'image qui se dessine pendant le fondu. Le calque quitté est vidé (src
//     retirés) une fois le fondu fini, puis reçoit la vue suivante.
//   - Le lot est demandé dès que le serveur dit photos_configurees (même hors du mode ambiant : main.js doit savoir si
//     des photos sont prêtes), puis relu toutes les 30 min ; sans clé, AUCUNE demande. Les images, elles, ne sont
//     chargées que pendant le mode ambiant et sa préparation ; quitter() et la fin d'une préparation (un toucher, un
//     empêchement) les déchargent toutes.
//   - Préparation (constat du 14/10 sur le cadre : le mode s'ouvrait sur un fond Ardoise vide et y restait quand le
//     Wi-Fi du cadre décrochait pendant le transfert de la première photo) : pendant la minute qui précède l'entrée,
//     la première vue se charge dans le calque de derrière, scène masquée ; entrer() refuse tant qu'elle n'est pas
//     prête, l'Accueil reste. Une vue qui ne vient pas en 20 s est remplacée (web/src/photos.js).
//   - Verre « teinte » seulement (fond semi-opaque, AUCUN backdrop-filter : le flou fait tomber les fondus à 16 FPS sur
//     le cadre, docs/cadre-ave948.md).
//   - Un toucher ramène l'Accueil : c'est main.js qui l'écoute (phase de capture), pas cet écran.
//   - entrer() la nuit, hors ligne ou sans vue prête n'ouvre rien et rend faux (mêmes empêchements que
//     decisionPhotos) : le routeur garde alors l'Accueil (routeur.js), aucune image de plus n'est demandée.
//   - L'horloge est récrite à chaque mise à jour (main.js redessine à chaque minute) ; le minuteur à chaque seconde.

import { changerIcone, ecrire, element, icone, masquer } from '../dom.js';
import { creerDiaporama, DUREE_FONDU_MS, URL_PHOTO } from '../photos.js';
import { ligneMinuteur, vuePhotos } from './photos-donnees.js';

const MARGE_FONDU_MS = 100;

// Un calque : deux cellules (une seule sert pour un paysage ou un portrait seul), chacune avec son image et sa légende.
function creerCalque(parent, { surChargee, surEchec }) {
  const racine = element('div', 'photos-calque');
  const cellules = [0, 1].map(() => {
    const cellule = element('div', 'photos-cellule');
    const image = element('img', 'photos-image');
    image.alt = '';
    const legende = element('p', 'photos-legende');
    legende.hidden = true;
    cellule.appendChild(image);
    cellule.appendChild(legende);
    racine.appendChild(cellule);
    const etat = { cellule, image, legende, attendue: null };
    image.addEventListener('load', () => {
      const attendue = etat.attendue;
      if (!attendue) return;
      const pret = () => {
        if (etat.attendue === attendue) surChargee(attendue.cle, attendue.id);
      };
      if (typeof image.decode === 'function') image.decode().then(pret, pret);
      else pret();
    });
    image.addEventListener('error', () => {
      if (etat.attendue) surEchec(etat.attendue.cle, etat.attendue.id);
    });
    return etat;
  });
  parent.appendChild(racine);

  return {
    remplir(vue) {
      racine.className = `photos-calque photos-${vue.disposition}`;
      cellules.forEach((etat, i) => {
        const photo = vue.photos[i];
        masquer(etat.cellule, !photo);
        if (!photo) {
          etat.attendue = null;
          etat.image.removeAttribute('src');
          return;
        }
        etat.attendue = { cle: vue.cle, id: photo.id };
        masquer(etat.legende, photo.legende === null);
        ecrire(etat.legende, photo.legende || '');
        etat.image.src = URL_PHOTO(photo.id);
      });
    },
    montrer(devant) {
      racine.classList.add('photos-calque-visible');
      racine.classList.toggle('photos-calque-devant', devant);
    },
    reculer() {
      racine.classList.remove('photos-calque-devant');
    },
    vider() {
      racine.classList.remove('photos-calque-visible', 'photos-calque-devant');
      cellules.forEach((etat) => {
        etat.attendue = null;
        etat.image.removeAttribute('src');
      });
    },
  };
}

function pastille(parent, classe) {
  const racine = element('div', `photos-pastille ${classe}`);
  parent.appendChild(racine);
  return racine;
}

export function creerPhotos(conteneur, { client, monotone }) {
  const diaporama = creerDiaporama();
  let configure = false;
  let visible = false;
  let ambiant = false;
  let prepare = false;
  let devant = 0;
  let calqueLibreLe = 0;
  let aVider = false;
  let cleChargee = null;

  const racine = element('section', 'photos');

  // Plein écran, menu masqué.
  const scene = element('div', 'photos-ambiance');
  const calques = [0, 1].map(() => creerCalque(scene, { surChargee, surEchec }));
  const horloge = pastille(scene, 'photos-horloge');
  const heure = element('p', 'photos-heure chiffres chiffres-affiche');
  const date = element('p', 'photos-date');
  horloge.appendChild(heure);
  horloge.appendChild(date);
  const meteo = pastille(scene, 'photos-meteo');
  const picto = icone(null, 'photos-meteo-picto');
  const temperature = element('p', 'photos-temperature chiffres');
  const ciel = element('p', 'photos-ciel');
  [picto, temperature, ciel].forEach((noeud) => meteo.appendChild(noeud));
  const soir = pastille(scene, 'photos-soir');
  const blocRepas = element('div', 'photos-repas');
  const intitule = element('p', 'photos-intitule');
  const plat = element('p', 'photos-plat');
  blocRepas.appendChild(intitule);
  blocRepas.appendChild(plat);
  const blocMinuteur = element('div', 'photos-minuteur');
  blocMinuteur.appendChild(icone('i-timer', 'photos-minuteur-icone'));
  const tempsMinuteur = element('p', 'photos-minuteur-temps chiffres');
  const nomMinuteur = element('p', 'photos-minuteur-nom');
  [tempsMinuteur, nomMinuteur].forEach((noeud) => blocMinuteur.appendChild(noeud));
  soir.appendChild(blocRepas);
  soir.appendChild(blocMinuteur);
  const panne = element('p', 'photos-legende photos-panne', 'Photos indisponibles pour le moment');
  scene.appendChild(panne);

  racine.appendChild(scene);
  conteneur.appendChild(racine);

  function demanderLot() {
    diaporama.lotDemande();
    client.lire('/api/photos/lot').then((reponse) => {
      if (reponse.ok) diaporama.recevoirLot(reponse.donnees, monotone());
      else diaporama.echecLot(monotone());
    });
  }

  function basculerSiPret() {
    const t = monotone();
    if (!ambiant || !diaporama.aBasculer(t)) return;
    diaporama.basculer(t);
    calques[1 - devant].montrer(true);
    calques[devant].reculer();
    devant = 1 - devant;
    calqueLibreLe = t + DUREE_FONDU_MS + MARGE_FONDU_MS;
    aVider = true;
    cleChargee = null;
  }

  function surChargee(cle, id) {
    diaporama.imageChargee(cle, id);
    basculerSiPret();
  }

  function surEchec(cle, id) {
    diaporama.imageEchouee(cle, id, monotone());
    cleChargee = null;
  }

  function couper() {
    diaporama.arreter();
    calques.forEach((calque) => calque.vider());
    aVider = false;
    cleChargee = null;
    calqueLibreLe = 0;
  }

  // À chaque seconde : le lot (relu toutes les 30 min), puis, en mode ambiant ou pendant sa préparation, le calque de
  // derrière (vidé après le fondu, puis chargé avec la vue suivante) et, en mode ambiant seulement, la bascule. Fin de
  // préparation sans entrée : tout est déchargé.
  function entretenir({ preparer = false } = {}) {
    const t = monotone();
    if (configure && diaporama.besoinDeLot(t)) demanderLot();
    if (!ambiant) {
      if (!preparer || !configure) {
        if (prepare) couper();
        prepare = false;
        return;
      }
      prepare = true;
    }
    if (t >= calqueLibreLe) {
      const derriere = calques[1 - devant];
      if (aVider) {
        derriere.vider();
        aVider = false;
      }
      const vue = diaporama.aPrecharger(t);
      if (vue && vue.cle !== cleChargee) {
        cleChargee = vue.cle;
        derriere.remplir(vue);
      }
    }
    basculerSiPret();
    if (ambiant) masquer(panne, !diaporama.enPanne(t));
  }

  masquer(scene, true);

  return {
    racine,
    mettreAJour(donnees, ms) {
      configure = donnees.photos_configurees === true;
      const vue = vuePhotos(donnees, ms);
      ecrire(heure, vue.heure);
      ecrire(date, vue.date);
      masquer(meteo, vue.meteo === null);
      if (vue.meteo) {
        changerIcone(picto, vue.meteo.picto);
        ecrire(temperature, vue.meteo.temperature);
        ecrire(ciel, vue.meteo.libelle);
      }
      masquer(blocRepas, vue.soir === null);
      if (vue.soir) {
        ecrire(intitule, vue.soir.intitule);
        ecrire(plat, vue.soir.titre);
      }
      masquer(soir, vue.soir === null && blocMinuteur.hidden);
    },
    mettreAJourMinuteur(vuePastille) {
      const ligne = ligneMinuteur(vuePastille);
      masquer(blocMinuteur, ligne === null);
      if (ligne) {
        ecrire(tempsMinuteur, ligne.temps);
        ecrire(nomMinuteur, ligne.libelle);
      }
      masquer(soir, blocRepas.hidden && ligne === null);
    },
    entretenir,
    entrer({ nuit = false, enLigne = true } = {}) {
      ambiant = !nuit && enLigne && configure && diaporama.vuePrete();
      visible = ambiant;
      masquer(scene, !ambiant);
      if (ambiant) {
        prepare = false;
        entretenir();
      }
      return ambiant;
    },
    quitter() {
      visible = false;
      ambiant = false;
      prepare = false;
      couper();
      masquer(scene, true);
    },
    ambiance: () => visible && ambiant,
    pretes: () => configure && diaporama.pretes(),
    vuePrete: () => configure && diaporama.vuePrete(),
  };
}
