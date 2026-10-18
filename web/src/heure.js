// web/src/heure.js
//
// Rôle    : l'heure de Paris, quels que soient l'horloge et le fuseau du cadre : décalage tiré de
//           heure_serveur, et mise en forme en français.
// Entrées : instants en millisecondes depuis 1970 ; heure_serveur reçue par le flux (api.js).
// Sorties : creerHorloge(horlogeLocale) -> { regler(heureServeur), maintenant(), estReglee() } (estReglee : vrai
//           dès le premier heure_serveur reçu) ;
//           partiesParis(ms) -> { annee, mois, jour, heure, minute, jourSemaine (0 = dimanche) } ;
//           texteHeure(ms) « 07:05 » ; texteDate(ms) « Dimanche 11 octobre » ; dateParis(ms) « 2026-10-11 » ;
//           heureLocaleParis(ms) « 2026-10-11T07:05 » (le format des heures d'Open-Meteo) ;
//           texteHeureLongue(ms) « 14 h 32 » (espaces insécables, pour une heure dans une phrase) ;
//           jourAbrege(« 2026-10-12 ») « Lun » ; texteJourIso(« 2026-10-10 ») « samedi 10 octobre » ;
//           nomJour(« 2026-10-12 ») « lundi » ; texteJourMois(« 2026-10-01 ») « 1er octobre » ;
//           ajouterJours(« 2026-10-31 », 1) « 2026-11-01 » ; lundiDe(« 2026-10-14 ») « 2026-10-12 » (le lundi de sa
//           semaine) ; ecartJours(« 2026-10-12 », « 2026-10-14 ») 2 (négatif si la seconde date est avant) ;
//           texteDuree(ms) « 3 min », « 2 h », « 1 h 05 ».
// Pièges  :
//   - Le fuseau d'Android peut être faux (cadre sans Internet) : tout passe par Intl avec
//     timeZone Europe/Paris, jamais par getHours() ni par un décalage fixe (changements d'heure).
//   - hourCycle h23 ET modulo 24 : certaines versions de Chrome écrivent « 24 » à minuit avec hour12: false.
//   - Parties numériques seulement, noms des jours et des mois écrits ici : on ne dépend que du fuseau,
//     pas des données de langue d'une vieille WebView.
//   - Le jour de la semaine d'une date seule (« 2026-10-12 ») se calcule en UTC sur cette date : aucun
//     fuseau n'intervient.
//   - Le décalage ignore le temps de transit du flux (réseau local, quelques millisecondes).
//   - Avant le premier heure_serveur, maintenant() est l'horloge du cadre, peut-être fausse : ce qui ne doit pas
//     se tromper d'heure (sonnerie des minuteurs, rechargement de 4h) attend estReglee().

const FORMAT_PARIS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOURS_ABREGES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const deuxChiffres = (n) => (n < 10 ? '0' : '') + n;

function jourSemaineDe(annee, mois, jour) {
  return new Date(Date.UTC(annee, mois - 1, jour)).getUTCDay();
}

export function creerHorloge(horlogeLocale = Date.now) {
  let decalage = 0;
  let reglee = false;
  return {
    regler(heureServeur) {
      if (typeof heureServeur !== 'number' || !isFinite(heureServeur)) return;
      decalage = heureServeur - horlogeLocale();
      reglee = true;
    },
    maintenant() {
      return horlogeLocale() + decalage;
    },
    estReglee: () => reglee,
  };
}

export function partiesParis(ms) {
  const parties = {};
  FORMAT_PARIS.formatToParts(new Date(ms)).forEach((partie) => {
    parties[partie.type] = partie.value;
  });
  const annee = Number(parties.year);
  const mois = Number(parties.month);
  const jour = Number(parties.day);
  return {
    annee,
    mois,
    jour,
    heure: Number(parties.hour) % 24,
    minute: Number(parties.minute),
    jourSemaine: jourSemaineDe(annee, mois, jour),
  };
}

export function texteHeure(ms) {
  const p = partiesParis(ms);
  return `${deuxChiffres(p.heure)}:${deuxChiffres(p.minute)}`;
}

export function texteHeureLongue(ms) {
  const p = partiesParis(ms);
  return `${p.heure}\u00a0h\u00a0${deuxChiffres(p.minute)}`;
}

export function texteDate(ms) {
  const p = partiesParis(ms);
  const nom = JOURS[p.jourSemaine];
  return `${nom.charAt(0).toUpperCase()}${nom.slice(1)} ${p.jour === 1 ? '1er' : p.jour} ${MOIS[p.mois - 1]}`;
}

export function dateParis(ms) {
  const p = partiesParis(ms);
  return `${p.annee}-${deuxChiffres(p.mois)}-${deuxChiffres(p.jour)}`;
}

export function heureLocaleParis(ms) {
  const p = partiesParis(ms);
  return `${p.annee}-${deuxChiffres(p.mois)}-${deuxChiffres(p.jour)}T${deuxChiffres(p.heure)}:${deuxChiffres(p.minute)}`;
}

export function jourAbrege(dateIso) {
  const [annee, mois, jour] = dateIso.split('-').map(Number);
  return JOURS_ABREGES[jourSemaineDe(annee, mois, jour)];
}

export function nomJour(dateIso) {
  const [annee, mois, jour] = dateIso.split('-').map(Number);
  return JOURS[jourSemaineDe(annee, mois, jour)];
}

export function texteJourMois(dateIso) {
  const [, mois, jour] = dateIso.split('-').map(Number);
  return `${jour === 1 ? '1er' : jour} ${MOIS[mois - 1]}`;
}

export function texteJourIso(dateIso) {
  return `${nomJour(dateIso)} ${texteJourMois(dateIso)}`;
}

export function ajouterJours(dateIso, jours) {
  const [annee, mois, jour] = dateIso.split('-').map(Number);
  const date = new Date(Date.UTC(annee, mois - 1, jour + jours));
  return `${date.getUTCFullYear()}-${deuxChiffres(date.getUTCMonth() + 1)}-${deuxChiffres(date.getUTCDate())}`;
}

export function lundiDe(dateIso) {
  const [annee, mois, jour] = dateIso.split('-').map(Number);
  return ajouterJours(dateIso, -((jourSemaineDe(annee, mois, jour) + 6) % 7));
}

export function ecartJours(de, a) {
  const enJours = (dateIso) => {
    const [annee, mois, jour] = dateIso.split('-').map(Number);
    return Date.UTC(annee, mois - 1, jour) / 86400000;
  };
  return enJours(a) - enJours(de);
}

export function texteDuree(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? `${heures} h` : `${heures} h ${deuxChiffres(reste)}`;
}
