// tests/enfants-valeur.js
//
// Rôle    : fabriquer, pour les tests des écrans des enfants, une valeur « enfants » au format du flux
//           (serveur/enfants/projection.js) : barème de Thomas (6 étapes de Timo, toutes en confiance depuis le 14/10 en fin
//           d'après-midi, 3 de Pablo, boutique 30/60/90, 3 motifs, 10 points libres par jour) et l'état voulu par le test.
// Entrées : valeurEnfants({ timo, pablo, minuteur, minutes, points, gains, demande, routineFinie, parent }) : timo et pablo
//           donnent le statut des étapes ({ id: 'valide' | 'attente' | [statut, instant de la coche en ms, par (« enfant »
//           par défaut, ou « parent »)] }, les autres « à faire ») ; minutes complète le bloc des minutes de Timo ;
//           routineFinie : la routine du matin est close (après fin_routine) ; parent : étapes de Timo validées par un
//           parent dans une variante du barème (la validation « parent » reste permise, plus utilisée par Thomas).
// Sorties : valeurEnfants(...) ; paris(« 07:20 ») -> instant du 14/10/2026 à Paris ; iso(ms) ; ETAPES_TIMO, ETAPES_PABLO.
// Pièges  : gagnees et disponibles_s sont recalculés ici à partir des étapes validées (plafond 32), comme le serveur.

export const paris = (heure) => Date.parse(`2026-10-14T${heure}:00+02:00`);
export const iso = (ms) => new Date(ms).toISOString();

export const ETAPES_TIMO = [
  ['leve', 'Levé', 'i-reveil', 10, 'enfant', '06:30'], ['dejeuner', 'Déjeuner au calme', 'i-bol', 5, 'enfant'],
  ['dents', 'Dents', 'i-brosse', 3, 'enfant'], ['habille', 'Habillé', 'i-habits', 5, 'enfant'],
  ['cartable', 'Cartable', 'i-cartable', 5, 'enfant'], ['calme', 'N\'excite pas Pablo', 'i-coeur', 4, 'enfant'],
];
export const ETAPES_PABLO = [['petit-dejeuner', 'Petit déjeuner', 'i-bol'], ['dents', 'Dents', 'i-brosse'], ['chaussures', 'Chaussures', 'i-chaussure']];

// statuts : { id: 'valide' | 'attente' | [statut, coche_le (ms)] } ; les autres « à faire ». parParent : ids validés par un
// parent (variante du barème).
function etapes(liste, statuts, parParent = []) {
  return liste.map(([id, libelle, picto, valeur = 1, base = 'enfant', apres]) => {
    const validation = parParent.includes(id) ? 'parent' : base;
    const brut = statuts[id];
    const [statut, coche, par = 'enfant'] = Array.isArray(brut) ? brut : [brut || 'a_faire', paris('06:00')];
    return {
      id, libelle, picto, valeur, validation, apres: apres || null, statut, par: brut ? par : null,
      coche_le: brut ? iso(coche) : null, annulable_jusqu_a: brut ? iso(coche + 5000) : null,
    };
  });
}

export function valeurEnfants({
  timo = {}, pablo = {}, minuteur = null, minutes = {}, points = { solde: 37, aujourdhui: 0, libres_restants: 10 }, gains = [],
  demande = null, routineFinie = false, parent = [],
} = {}) {
  const etapesTimo = etapes(ETAPES_TIMO, timo, parent);
  const gagnees = Math.min(32, etapesTimo.filter((e) => e.statut === 'valide').reduce((t, e) => t + e.valeur, 0));
  const etapesPablo = etapes(ETAPES_PABLO, pablo);
  const etoiles = etapesPablo.filter((e) => e.statut === 'valide').length;
  return {
    journee: '2026-10-14',
    depart: '08:10',
    fin_routine: '10:30',
    routine_finie: routineFinie,
    minutes_perdues: '20:00',
    enfants: [{
      id: 'timo', prenom: 'Timo', couleur: 'enfant-timo', avatar: 'i-renard', type: 'minutes', etapes: etapesTimo, gagnees,
      minutes: {
        plafond: 32, utilisees_s: 0, disponibles_s: gagnees * 60, perdues: false, ...minutes,
      },
      minuteur, points, gains, demande, ensuite: null,
    }, {
      id: 'pablo', prenom: 'Pablo', couleur: 'enfant-pablo', avatar: 'i-ourson', type: 'etoiles', etapes: etapesPablo, gagnees: etoiles,
      minutes: null, minuteur: null, points: null, gains: null, demande: null,
      ensuite: { libelle: 'Une histoire', picto: 'i-livre', debloque: etoiles === 3 },
    }],
    boutique: [
      { id: 'petit', libelle: 'Petit cadeau', picto: 'i-cadeau', prix: 30 }, { id: 'moyen', libelle: 'Moyen cadeau', picto: 'i-cadeau', prix: 60 },
      { id: 'gros', libelle: 'Gros cadeau', picto: 'i-cadeau', prix: 90 },
    ],
    motifs: [{ id: 'range', libelle: 'A rangé', picto: 'i-caisse' }, { id: 'table', libelle: 'A mis la table', picto: 'i-fork' }, { id: 'aide', libelle: 'A aidé', picto: 'i-main' }],
  };
}

