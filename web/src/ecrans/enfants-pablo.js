// web/src/ecrans/enfants-pablo.js
//
// Rôle    : « D'abord, ensuite » de Pablo, 3 ans (choix de Thomas du 14/10) : trois grands pictogrammes (petit déjeuner,
//           dents, chaussures), une flèche, puis la case « Ensuite » (une histoire) qui s'allume quand tout est fait ; en
//           dessous son bocal, où tombe une étoile à chaque étape. Aucun texte nécessaire.
// Entrées : creerPablo(parent, { cocher(id, noeud), annuler(id) }) ; mettreAJour(vue de pablo-donnees.js vuePablo, ms).
// Sorties : { racine, bocal (nœud cible des étoiles), ensuite (nœud de la case « Ensuite »), caseDe(id), mettreAJour(vue,
//           ms) }.
// Pièges  :
//   - Simple toucher (lever du doigt, appui.js) : il a 3 ans, pas d'appui long ; une case faite, ou passée (routine du
//     matin finie : grise), ne réagit plus. Un adulte peut annuler pendant 5 s avec le bouton retour (icône seule).
//   - Les mots (libellés) ne servent qu'aux étiquettes d'accessibilité : rien à lire à l'écran.
//   - Vue préconstruite pour 7 cases au plus (barème) et autant de places dans le bocal.

import { surAppui } from '../composants/appui.js';
import {
  changerIcone, element, etiqueter, icone, masquer,
} from '../dom.js';

const CASES_MAX = 7;

function construireCase(rangee, actions) {
  const bouton = element('button', 'carte pablo-case');
  bouton.type = 'button';
  const picto = icone(null, 'pablo-picto');
  const coche = element('span', 'pablo-coche');
  coche.appendChild(icone('i-check', 'pablo-coche-icone'));
  bouton.appendChild(picto);
  bouton.appendChild(coche);
  rangee.appendChild(bouton);
  const etat = { id: null, permis: false };
  surAppui(bouton, () => {
    if (etat.permis) actions.cocher(etat.id, bouton);
  });
  return {
    bouton, picto, coche, etat,
  };
}

export function creerPablo(parent, actions) {
  const racine = element('div', 'pablo');
  const rangee = element('div', 'pablo-rangee');
  const cases = [];
  for (let i = 0; i < CASES_MAX; i += 1) cases.push(construireCase(rangee, actions));
  const fleche = element('span', 'pablo-fleche');
  fleche.appendChild(icone('i-next', 'pablo-fleche-dessin'));
  rangee.appendChild(fleche);
  const ensuite = element('div', 'carte pablo-ensuite');
  ensuite.setAttribute('role', 'img');
  const pictoEnsuite = icone(null, 'pablo-picto');
  ensuite.appendChild(pictoEnsuite);
  rangee.appendChild(ensuite);
  const bas = element('div', 'pablo-bas');
  const annuler = element('button', 'bouton-doux pablo-annuler');
  annuler.type = 'button';
  annuler.appendChild(icone('i-back', 'pablo-annuler-icone'));
  etiqueter(annuler, 'Annuler');
  const bocal = element('div', 'pablo-bocal');
  bocal.setAttribute('role', 'img');
  bocal.appendChild(icone('i-bocal', 'pablo-bocal-dessin'));
  const etoiles = element('span', 'pablo-etoiles');
  const places = [];
  for (let i = 0; i < CASES_MAX; i += 1) {
    const etoile = icone('i-etoile', 'pablo-etoile');
    places.push(etoile);
    etoiles.appendChild(etoile);
  }
  bocal.appendChild(etoiles);
  bas.appendChild(annuler);
  bas.appendChild(bocal);
  racine.appendChild(rangee);
  racine.appendChild(bas);
  parent.appendChild(racine);
  let annulable = null;
  surAppui(annuler, () => {
    if (annulable) actions.annuler(annulable);
  });

  return {
    racine,
    bocal,
    ensuite,
    caseDe(id) {
      const trouvee = cases.filter((n) => n.etat.id === id)[0];
      return trouvee ? trouvee.bouton : null;
    },
    mettreAJour(vue) {
      cases.forEach((n, i) => {
        const etape = vue.cases[i];
        masquer(n.bouton, !etape);
        if (!etape) return;
        n.etat.id = etape.id;
        n.etat.permis = !etape.fait && !etape.passee;
        changerIcone(n.picto, etape.picto);
        n.bouton.classList.toggle('pablo-case-faite', etape.fait);
        n.bouton.classList.toggle('pablo-case-passee', etape.passee);
        masquer(n.coche, !etape.fait);
        etiqueter(n.bouton, `${etape.libelle}${etape.fait ? ', fait' : ''}`);
      });
      masquer(fleche, vue.ensuite === null);
      masquer(ensuite, vue.ensuite === null);
      if (vue.ensuite) {
        changerIcone(pictoEnsuite, vue.ensuite.picto);
        ensuite.classList.toggle('pablo-ensuite-ouverte', vue.ensuite.debloque);
        etiqueter(ensuite, `Ensuite : ${vue.ensuite.libelle}`);
      }
      places.forEach((etoile, i) => {
        const affichage = i < vue.places ? '' : 'none';
        if (etoile.style.display !== affichage) etoile.style.display = affichage;
        etoile.classList.toggle('pablo-etoile-gagnee', i < vue.etoiles);
      });
      etiqueter(bocal, `${vue.etoiles} étoile${vue.etoiles > 1 ? 's' : ''}`);
      annulable = vue.annulation ? vue.annulation.id : null;
      masquer(annuler, annulable === null);
    },
  };
}
