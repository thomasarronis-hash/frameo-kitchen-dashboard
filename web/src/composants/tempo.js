// web/src/composants/tempo.js
//
// Rôle    : les morceaux d'EDF Tempo dessinés sur l'Accueil et la page Aujourd'hui : la pastille éclair (bleu, blanc
//           cerclé, rouge ; « ? » gris tant que la couleur n'est pas connue ; cerclée de pointillés si elle n'est que
//           pré-annoncée) et la fiche qu'un toucher ouvre par-dessus l'écran (aujourd'hui, demain, jours restants, heures
//           creuses).
// Entrées : creerPastilleTempo(classe) ; majPastilleTempo(pastille, vue) avec { couleur, provisoire, etiquette }
//           (pastilleDuJour de web/src/tempo.js, ou une ligne de la fiche) ; creerFicheTempo(racine) puis ouvrir(fiche)
//           avec ficheTempo de web/src/tempo.js.
// Sorties : la pastille (span) ; { ouvrir(fiche), fermer(), ouverte() } pour la fiche, posée dans racine (ouvrir sur une
//           fiche déjà ouverte la met à jour).
// Pièges  :
//   - La couleur n'est jamais seule : l'éclair dans la pastille, le mot dans la fiche et l'étiquette lue par un lecteur
//     d'écran (aria-label). Le blanc est cerclé (filet --tempo-bord) pour se voir sur une carte blanche.
//   - Couleurs dans jetons.css (--tempo-*), contrastes de l'éclair et du « ? » contrôlés par tests/contraste.test.js,
//     et chaque pastille se détache à 3:1 au moins des cartes (test dédié).
//   - La fiche se referme au poser du doigt n'importe où, et ce toucher ne fait rien d'autre (sa couche couvre tout
//     l'écran, comme la fiche d'un rendez-vous de l'Agenda) ; l'écran qui la porte la referme en y revenant (entrer).
//   - Vue préconstruite : ouvrir() ne change que textes, classes et hidden (dom.js).

import {
  ecrire, element, etiqueter, icone, masquer,
} from '../dom.js';

const CLASSES = { bleu: 'tempo-bleu', blanc: 'tempo-blanc', rouge: 'tempo-rouge' };

export function creerPastilleTempo(classe) {
  const pastille = element('span', `tempo-pastille ${classe}`);
  pastille.setAttribute('data-classes', `tempo-pastille ${classe}`);
  pastille.setAttribute('role', 'img');
  pastille.appendChild(icone('i-eclair', 'tempo-eclair'));
  pastille.appendChild(element('span', 'tempo-inconnu-texte', '?'));
  return pastille;
}

export function majPastilleTempo(pastille, vue) {
  const classe = `${pastille.getAttribute('data-classes')} ${CLASSES[vue.couleur] || 'tempo-inconnu'}${vue.provisoire ? ' tempo-provisoire' : ''}`;
  if (pastille.className !== classe) pastille.className = classe;
  masquer(pastille.childNodes[0], !vue.couleur);
  masquer(pastille.childNodes[1], Boolean(vue.couleur));
  etiqueter(pastille, vue.etiquette);
}

export function creerFicheTempo(racine) {
  const couche = element('div', 'tempo-fiche-couche');
  couche.hidden = true;
  couche.appendChild(element('div', 'tempo-voile'));
  const fiche = element('div', 'carte tempo-fiche');
  fiche.setAttribute('role', 'dialog');
  fiche.appendChild(icone('i-close', 'tempo-fiche-fermer'));
  const tete = element('h2', 'intitule carte-titre');
  tete.appendChild(icone('i-eclair', 'carte-icone'));
  tete.appendChild(element('span', '', 'EDF Tempo'));
  fiche.appendChild(tete);
  const jours = [0, 1].map(() => {
    const ligne = element('div', 'tempo-fiche-jour');
    const pastille = creerPastilleTempo('tempo-pastille-grande');
    const nom = element('span', 'tempo-fiche-nom');
    const couleur = element('span', 'tempo-fiche-valeur');
    const texte = element('span', 'tempo-fiche-couleur');
    const note = element('span', 'tempo-fiche-note');
    couleur.appendChild(texte);
    couleur.appendChild(note);
    [pastille, nom, couleur].forEach((noeud) => ligne.appendChild(noeud));
    fiche.appendChild(ligne);
    return {
      pastille, nom, texte, note,
    };
  });
  const finRouge = element('p', 'tempo-fiche-fin');
  fiche.appendChild(finRouge);
  const restants = element('div', 'tempo-fiche-restants');
  restants.appendChild(element('span', 'tempo-fiche-legende', 'Jours restants'));
  const compteurs = ['rouge', 'blanc', 'bleu'].map((couleur) => {
    const compteur = element('span', 'tempo-compteur');
    const pastille = creerPastilleTempo('tempo-pastille-petite');
    majPastilleTempo(pastille, { couleur, provisoire: false, etiquette: couleur });
    const nombre = element('span', 'tempo-compteur-nombre chiffres');
    compteur.appendChild(pastille);
    compteur.appendChild(nombre);
    restants.appendChild(compteur);
    return { compteur, nombre };
  });
  fiche.appendChild(restants);
  const creuses = element('p', 'tempo-fiche-creuses');
  creuses.appendChild(icone('i-moon', 'tempo-fiche-lune'));
  creuses.appendChild(element('span', '', 'Heures creuses de 22 h à 6 h'));
  fiche.appendChild(creuses);
  const credit = element('p', 'tempo-fiche-credit');
  fiche.appendChild(credit);
  couche.appendChild(fiche);
  racine.appendChild(couche);
  couche.addEventListener('pointerdown', () => masquer(couche, true));

  return {
    ouvrir(contenu) {
      jours.forEach((n, i) => {
        const jour = contenu.jours[i];
        majPastilleTempo(n.pastille, { couleur: jour.couleur, provisoire: jour.provisoire, etiquette: jour.note ? `${jour.texte}, ${jour.note}` : jour.texte });
        ecrire(n.nom, jour.nom);
        ecrire(n.texte, jour.texte);
        masquer(n.note, jour.note === null);
        ecrire(n.note, jour.note || '');
      });
      masquer(finRouge, contenu.finRouge === null);
      ecrire(finRouge, contenu.finRouge || '');
      masquer(restants, contenu.restants === null);
      compteurs.forEach((n, i) => {
        const restant = contenu.restants ? contenu.restants[i] : null;
        if (!restant) return;
        ecrire(n.nombre, String(restant.nombre));
        etiqueter(n.compteur, `${restant.nombre} jours ${restant.couleur}s restants`);
      });
      ecrire(credit, contenu.credit);
      masquer(couche, false);
    },
    fermer: () => masquer(couche, true),
    ouverte: () => !couche.hidden,
  };
}
