// web/src/ecrans/maison-alarme.js
//
// Rôle    : la section Alarme de l'écran Maison, en LECTURE SEULE (demande de Thomas : « une petite vue quand on appuie
//           sur Alarme pour voir ce qui est ouvert et fermé ») : à gauche l'état de l'alarme en grand et le résumé des
//           ouvertures ; à droite les 9 ouvertures, ouvertes en tête, Ouverte / Fermée lisible à 2 m, depuis quand,
//           pile faible.
// Entrées : creerSectionAlarme(parent) ; mettreAJour(alarme, ouvertures) avec etatAlarme et vueOuvertures de
//           maison-donnees.js.
// Sorties : { racine, mettreAJour(alarme, ouvertures) }.
// Pièges  :
//   - Décision de Thomas du 13/10 : le cadre n'arme ni ne désarme. Aucun bouton ici, et la section le dit.
//   - Jamais la couleur seule : une ouverte a son libellé « Ouverte », l'icône d'alerte, un fond teinté et une bordure ;
//     une fermée a « Fermée » et une coche ; un capteur indisponible le dit en toutes lettres.
//   - Vue préconstruite (9 lignes) : une mise à jour ne change que textes, classes, icônes et hidden (dom.js). Les
//     lignes sont réordonnées par la vue (ouvertes en tête) : chaque ligne du DOM reçoit simplement la ligne de même
//     rang.

import { changerIcone, ecrire, element, icone, masquer } from '../dom.js';
import { OUVERTURES } from './maison-donnees.js';

const ICONES = { ouverte: 'i-alert', fermee: 'i-check', inconnue: 'i-close' };

function construireLigne(liste) {
  const ligne = element('li', 'ouverture');
  const picto = icone(null, 'ouverture-icone');
  const textes = element('div', 'ouverture-textes');
  const nom = element('span', 'ouverture-nom');
  const depuis = element('span', 'ouverture-depuis');
  const pile = element('span', 'ouverture-pile');
  pile.appendChild(icone('i-battery', 'ouverture-pile-icone'));
  pile.appendChild(element('span', '', 'pile faible'));
  [nom, depuis, pile].forEach((noeud) => textes.appendChild(noeud));
  const etat = element('span', 'ouverture-etat');
  [picto, textes, etat].forEach((noeud) => ligne.appendChild(noeud));
  liste.appendChild(ligne);
  return {
    ligne, picto, nom, depuis, pile, etat,
  };
}

export function creerSectionAlarme(parent) {
  const racine = element('div', 'maison-section maison-alarme');
  const carteEtat = element('section', 'carte alarme-etat');
  carteEtat.appendChild(element('h2', 'intitule', 'Alarme'));
  const libelle = element('p', 'alarme-libelle');
  const depuis = element('p', 'alarme-depuis');
  const resume = element('p', 'alarme-resume');
  const resumeIcone = icone(null, 'alarme-resume-icone');
  const resumeTexte = element('span', '');
  resume.appendChild(resumeIcone);
  resume.appendChild(resumeTexte);
  const detail = element('p', 'alarme-detail');
  const note = element('p', 'alarme-note', 'Lecture seule : le cadre n\'arme ni ne désarme l\'alarme.');
  [libelle, depuis, resume, detail, note].forEach((noeud) => carteEtat.appendChild(noeud));

  const carteListe = element('section', 'carte alarme-ouvertures');
  carteListe.appendChild(element('h2', 'intitule', 'Ouvertures'));
  const liste = element('ul', 'ouvertures');
  const lignes = OUVERTURES.map(() => construireLigne(liste));
  carteListe.appendChild(liste);
  racine.appendChild(carteEtat);
  racine.appendChild(carteListe);
  parent.appendChild(racine);

  return {
    racine,
    mettreAJour(alarme, ouvertures) {
      ecrire(libelle, alarme ? alarme.libelle : 'Pas encore lue');
      libelle.className = `alarme-libelle alarme-${alarme ? alarme.ton : 'neutre'}`;
      masquer(depuis, !alarme || alarme.depuis === null);
      ecrire(depuis, alarme && alarme.depuis ? alarme.depuis : '');
      ecrire(resumeTexte, ouvertures.resume);
      resume.className = `alarme-resume${ouvertures.ouvertes > 0 ? ' alarme-resume-ouvert' : ''}`;
      changerIcone(resumeIcone, ouvertures.ouvertes > 0 ? 'i-alert' : 'i-check');
      masquer(detail, ouvertures.detail === null);
      ecrire(detail, ouvertures.detail || '');
      lignes.forEach((n, i) => {
        const vue = ouvertures.lignes[i];
        const classe = `ouverture ouverture-${vue.etat}`;
        if (n.ligne.className !== classe) n.ligne.className = classe;
        changerIcone(n.picto, ICONES[vue.etat]);
        ecrire(n.nom, vue.nom);
        masquer(n.depuis, vue.depuis === null);
        ecrire(n.depuis, vue.depuis || '');
        masquer(n.pile, !vue.pileFaible);
        ecrire(n.etat, vue.libelle);
      });
    },
  };
}
