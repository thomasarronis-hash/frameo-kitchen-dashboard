// web/src/ecrans/courses.js
//
// Rôle    : l'écran Courses (conception §1.5) : la liste todo.shopping_list (à faire d'abord, cochés grisés), une
//           case de 96 px par article pour cocher ou décocher, l'appui long d'une seconde pour supprimer (avec
//           confirmation dans la page), l'ajout d'un article, « Vider les cochés » (confirmé aussi) et « Prêt pour
//           le drive » avec la date du dernier signal ; « mode essai » quand le serveur simule les actions.
// Entrées : le conteneur (#ecran) ; { client (api.js : poster), stockage (stockage.js), monotone } ;
//           mettreAJour({ courses, simulation }) à chaque état du flux ; connexion(enLigne) à chaque seconde.
// Sorties : creerCourses(conteneur, options) -> { racine, mettreAJour(donnees), connexion(enLigne), entretenir(),
//           quitter() } ; entretenir() (chaque seconde) retire les opérations confirmées restées sans écho, trie
//           les articles cochés une fois la liste laissée tranquille et efface un message d'erreur de plus de
//           30 s ; quitter() referme une confirmation ouverte et le clavier, et trie la liste, quand on change
//           d'écran.
// Pièges  :
//   - Mise à jour optimiste puis réconciliation avec le flux (courses-donnees.js) : le geste se voit tout de
//     suite ; un refus du serveur remet la liste d'avant et affiche l'erreur en clair.
//   - Toucher court = cocher / décocher, appui long (1 s) = demander la suppression : jamais confirm() (bloquant,
//     hors charte), une barre de confirmation dans la page. Un article encore en attente (ajout pas encore revenu
//     du serveur) ne réagit pas.
//   - La liste peut défiler (touch-action: pan-y) : un défilement annule le geste (pointercancel).
//   - Un article coché garde sa place un moment (courses-donnees.js) et toutes les lignes partagent la même
//     anti-répétition (appui.js) : une touche fantôme ne coche pas l'article voisin.
//   - Une erreur dit sur quel article elle porte (« « beurre » : pas de réponse du serveur… ») et s'efface au
//     bout de 30 s ; une requête sans réponse est abandonnée au bout de 10 s (api.js), l'article ne reste donc
//     pas grisé indéfiniment.
//   - Liste rendue par clé (uid) : les lignes sont réutilisées et seulement déplacées ou retirées, jamais
//     reconstruites à chaque message du flux.
//   - Saisie dans un <form> : la touche Entrée du clavier Android ajoute aussi l'article ; le champ garde le
//     focus pour enchaîner. Texte nettoyé et refusé hors de 1 à 60 caractères (même règle que le serveur).
//   - La date du dernier « Prêt pour le drive » vient de la réponse du serveur et est gardée dans localStorage :
//     c'est le dernier signal envoyé DEPUIS CE CADRE (GET /api/etat est réservé au Clevo).
//   - Bandeau « mode essai » seulement si l'instantané dit simulation: true (serveur sans ACTIONS_REELLES=1).

import { ecrire, element, icone, masquer } from '../dom.js';
import { texteDate, texteHeure } from '../heure.js';
import { creerGarde, surAppui, surAppuiLong } from '../composants/appui.js';
import {
  creerCoursesLocales, TEXTE_MAX, texteArticle, texteViderCoches,
} from './courses-donnees.js';

const CLE_DRIVE = 'drive_pret_le';
const DUREE_ERREUR_MS = 30000;

const surArticle = (nom, message) => (nom ? `« ${nom} » : ${message.charAt(0).toLowerCase()}${message.slice(1)}` : message);

function texteDrive(pretLe) {
  const ms = Date.parse(pretLe || '');
  if (!isFinite(ms)) return 'Pas encore signalé depuis ce cadre';
  return `Signalé ${texteDate(ms).toLowerCase()} à ${texteHeure(ms)}`;
}

function texteCompte(vue) {
  if (!vue.lue) return '';
  const aFaire = `${vue.aFaire} à faire`;
  return vue.coches > 0 ? `${aFaire} · ${vue.coches} coché${vue.coches > 1 ? 's' : ''}` : aFaire;
}

export function creerCourses(conteneur, { client, stockage, monotone }) {
  const locales = creerCoursesLocales({ monotone });
  const gardeListe = creerGarde();
  let dernieresCourses;
  let confirmation = null;
  let erreurLe = null;

  const racine = element('section', 'ecran-page courses');
  const principal = element('div', 'courses-principal');
  const entete = element('header', 'page-entete');
  entete.appendChild(element('h2', 'intitule', 'Courses'));
  const compte = element('p', 'page-titre');
  entete.appendChild(compte);
  const carteListe = element('div', 'carte courses-liste-carte');
  const liste = element('ul', 'courses-liste');
  const vide = element('p', 'courses-vide');
  const barre = element('div', 'courses-confirmation');
  const barreTexte = element('p', 'courses-confirmation-texte');
  const barreOui = element('button', 'bouton-fort courses-confirmation-oui');
  barreOui.type = 'button';
  const barreNon = element('button', 'bouton-doux', 'Annuler');
  barreNon.type = 'button';
  [barreTexte, barreOui, barreNon].forEach((noeud) => barre.appendChild(noeud));
  barre.hidden = true;
  [liste, vide, barre].forEach((noeud) => carteListe.appendChild(noeud));
  principal.appendChild(entete);
  principal.appendChild(carteListe);

  const cote = element('aside', 'courses-cote');
  const carteAjout = element('section', 'carte courses-ajout');
  carteAjout.appendChild(element('h2', 'intitule', 'Ajouter un article'));
  const formulaire = element('form', 'courses-formulaire');
  formulaire.setAttribute('autocomplete', 'off');
  const champ = element('input', 'courses-champ');
  champ.type = 'text';
  champ.maxLength = TEXTE_MAX;
  champ.setAttribute('aria-label', 'Article à ajouter');
  champ.setAttribute('enterkeyhint', 'done');
  const ajouter = element('button', 'bouton-fort courses-ajouter');
  ajouter.type = 'submit';
  ajouter.appendChild(icone('i-plus', 'bouton-fort-icone'));
  ajouter.appendChild(element('span', '', 'Ajouter'));
  formulaire.appendChild(champ);
  formulaire.appendChild(ajouter);
  carteAjout.appendChild(formulaire);

  const carteDrive = element('section', 'carte courses-drive');
  const drive = element('button', 'bouton-fort courses-drive-bouton');
  drive.type = 'button';
  drive.appendChild(icone('i-cart', 'bouton-fort-icone'));
  drive.appendChild(element('span', '', 'Prêt pour le drive'));
  const driveDate = element('p', 'courses-drive-date', texteDrive(stockage.lire(CLE_DRIVE)));
  carteDrive.appendChild(drive);
  carteDrive.appendChild(driveDate);

  const vider = element('button', 'bouton-doux courses-vider');
  vider.type = 'button';
  const viderTexte = element('span', '', 'Vider les cochés');
  vider.appendChild(viderTexte);
  const erreur = element('p', 'courses-erreur');
  erreur.setAttribute('role', 'alert');
  erreur.hidden = true;
  const horsLigne = element('p', 'courses-hors-ligne', 'Hors ligne : la liste date d\'avant la coupure, les changements ne partent pas');
  horsLigne.hidden = true;
  const essai = element('p', 'courses-essai');
  essai.appendChild(icone('i-alert', 'courses-essai-icone'));
  essai.appendChild(element('span', '', 'Mode essai : rien n\'est envoyé à la maison'));
  essai.hidden = true;
  [carteAjout, carteDrive, vider, erreur, horsLigne, essai].forEach((noeud) => cote.appendChild(noeud));

  racine.appendChild(principal);
  racine.appendChild(cote);
  conteneur.appendChild(racine);

  const lignes = new Map();

  function afficherErreur(message) {
    erreurLe = message === null ? null : monotone();
    masquer(erreur, message === null);
    if (message !== null) ecrire(erreur, message);
  }

  function fermerConfirmation() {
    confirmation = null;
    masquer(barre, true);
  }

  function demanderConfirmation(texte, libelleOui, valider) {
    confirmation = valider;
    ecrire(barreTexte, texte);
    ecrire(barreOui, libelleOui);
    masquer(barre, false);
  }

  function rendre() {
    const vue = locales.vue();
    ecrire(compte, texteCompte(vue));
    const message = !vue.lue ? 'Liste pas encore lue' : 'Liste vide';
    masquer(vide, vue.articles.length > 0);
    ecrire(vide, message);
    rendreListe(vue.articles);
    ecrire(viderTexte, vue.coches > 0 ? `Vider les cochés (${vue.coches})` : 'Vider les cochés');
    vider.disabled = vue.coches === 0;
  }

  // nom : l'article visé, repris dans le message d'erreur (null pour « Vider les cochés »).
  function envoyer(type, chemin, donnees, nom) {
    const op = locales.operation(type, donnees);
    afficherErreur(null);
    rendre();
    client.poster(chemin, donnees).then((reponse) => {
      if (reponse.ok) locales.reussir(op);
      else {
        locales.echouer(op);
        afficherErreur(surArticle(nom, reponse.message));
      }
      rendre();
    });
  }

  function cocher(article) {
    if (article.enAttente) return;
    envoyer('cocher', '/api/action/courses_cocher', { uid: article.uid, fait: article.status !== 'completed' }, article.summary);
  }

  function demanderSuppression(article) {
    if (article.enAttente) return;
    demanderConfirmation(`Supprimer « ${article.summary} » ?`, 'Supprimer', () => {
      envoyer('supprimer', '/api/action/courses_supprimer', { uid: article.uid }, article.summary);
    });
  }

  function creerLigne() {
    const ligne = { li: element('li', 'courses-article'), article: null };
    const caseCoche = element('span', 'courses-case');
    caseCoche.appendChild(icone('i-check', 'courses-coche'));
    ligne.texte = element('span', 'courses-texte');
    ligne.li.appendChild(caseCoche);
    ligne.li.appendChild(ligne.texte);
    surAppuiLong(ligne.li, { court: () => cocher(ligne.article), long: () => demanderSuppression(ligne.article) }, gardeListe);
    return ligne;
  }

  function rendreListe(articles) {
    const vus = {};
    articles.forEach((article, i) => {
      let ligne = lignes.get(article.uid);
      if (!ligne) {
        ligne = creerLigne();
        lignes.set(article.uid, ligne);
      }
      ligne.article = article;
      vus[article.uid] = true;
      ecrire(ligne.texte, article.summary);
      ligne.li.classList.toggle('courses-article-coche', article.status === 'completed');
      ligne.li.classList.toggle('courses-article-attente', article.enAttente);
      if (liste.children[i] !== ligne.li) liste.insertBefore(ligne.li, liste.children[i] || null);
    });
    lignes.forEach((ligne, uid) => {
      if (vus[uid]) return;
      liste.removeChild(ligne.li);
      lignes.delete(uid);
    });
  }

  formulaire.addEventListener('submit', (e) => {
    e.preventDefault();
    const brut = champ.value;
    if (brut.trim() === '') return;
    const texte = texteArticle(brut);
    if (texte === null) {
      afficherErreur(`Un article fait de 1 à ${TEXTE_MAX} caractères, sans caractère spécial invisible`);
      return;
    }
    champ.value = '';
    envoyer('ajouter', '/api/action/courses_ajouter', { texte }, texte);
  });

  surAppui(vider, () => {
    const question = texteViderCoches(locales.vue().articles);
    if (question === null) return;
    demanderConfirmation(question, 'Retirer', () => {
      envoyer('vider', '/api/action/courses_vider_coches', {}, null);
    });
  });
  surAppui(barreOui, () => {
    const valider = confirmation;
    fermerConfirmation();
    if (valider) valider();
  });
  surAppui(barreNon, fermerConfirmation);
  surAppui(drive, () => {
    afficherErreur(null);
    client.poster('/api/drive-pret', {}).then((reponse) => {
      if (!reponse.ok) {
        afficherErreur(reponse.message);
        return;
      }
      stockage.ecrire(CLE_DRIVE, reponse.donnees.pret_le);
      ecrire(driveDate, texteDrive(reponse.donnees.pret_le));
    });
  });

  rendre();

  return {
    racine,
    mettreAJour({ courses, simulation }) {
      masquer(essai, simulation !== true);
      if (courses === dernieresCourses) return;
      dernieresCourses = courses;
      locales.recevoir(courses);
      rendre();
    },
    connexion(enLigne) {
      masquer(horsLigne, enLigne);
    },
    entretenir() {
      if (locales.purger()) rendre();
      if (erreurLe !== null && monotone() - erreurLe >= DUREE_ERREUR_MS) afficherErreur(null);
    },
    quitter() {
      fermerConfirmation();
      champ.blur();
      locales.defiger();
      rendre();
    },
  };
}
