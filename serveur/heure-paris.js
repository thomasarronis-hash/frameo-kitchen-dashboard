// serveur/heure-paris.js
//
// Rôle    : l'heure et la date de Paris côté serveur, quel que soit le fuseau du conteneur : partagées par les sources
//           (Open-Meteo, menus, Tempo) et l'état local (draps, journée de 4 h à 4 h du tableau des enfants).
// Entrées : un instant (Date ou millisecondes depuis 1970) ; une date « AAAA-MM-JJ ».
// Sorties : partiesParis(instant) -> { date: « 2026-10-11 », heure (0 à 23), minute } ;
//           dateParis(instant) « 2026-10-11 » ; debutHeureParis(instant) « 2026-10-11T14:00 » (le format des heures
//           d'Open-Meteo) ; ajouterJours(« 2026-10-31 », 1) « 2026-11-01 » ; jourSemaine(« 2026-10-18 ») 0 (dimanche) à
//           6 (samedi) ; instantParis(« 2026-10-25 », 6, 5) -> millisecondes de 06:05 ce jour-là à Paris.
// Pièges  :
//   - Intl avec timeZone Europe/Paris, jamais getHours() ni un décalage fixe : le conteneur tourne en TZ=Europe/Paris,
//     les tests et le Clevo pas forcément, et les changements d'heure se font tout seuls.
//   - hourCycle h23 ET modulo 24 : certaines versions écrivent « 24 » à minuit.
//   - Une date seule se calcule en UTC sur elle-même (ajouterJours, jourSemaine) : aucun fuseau n'intervient, et un
//     jour fait toujours 24 h, même le 25/10.
//   - instantParis : l'heure murale de Paris convertie en instant avec le décalage du jour, recalculé à l'instant
//     trouvé (une nuit de changement d'heure, le décalage de minuit n'est plus celui de 06:05). Les heures qui
//     n'existent pas ou existent deux fois (entre 2 h et 3 h ces nuits-là) ne servent pas ici.

const FORMAT_PARIS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const deuxChiffres = (n) => String(n).padStart(2, '0');

export function partiesParis(instant = new Date()) {
  const parties = Object.fromEntries(FORMAT_PARIS.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return {
    date: `${parties.year}-${parties.month}-${parties.day}`,
    heure: Number(parties.hour) % 24,
    minute: Number(parties.minute),
  };
}

export const dateParis = (instant = new Date()) => partiesParis(instant).date;

export function debutHeureParis(instant = new Date()) {
  const { date, heure } = partiesParis(instant);
  return `${date}T${deuxChiffres(heure)}:00`;
}

function enUtc(dateIso) {
  const [annee, mois, jour] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour));
}

export function ajouterJours(dateIso, jours) {
  const date = enUtc(dateIso);
  date.setUTCDate(date.getUTCDate() + jours);
  return `${date.getUTCFullYear()}-${deuxChiffres(date.getUTCMonth() + 1)}-${deuxChiffres(date.getUTCDate())}`;
}

export const jourSemaine = (dateIso) => enUtc(dateIso).getUTCDay();

// Écart entre l'heure murale de Paris et l'heure UTC, à cet instant (une ou deux heures).
function decalageParis(instant) {
  const { date, heure, minute } = partiesParis(instant);
  return enUtc(date).getTime() + (heure * 60 + minute) * 60_000 - (instant - (instant % 60_000));
}

export function instantParis(dateIso, heure, minute) {
  const mural = enUtc(dateIso).getTime() + (heure * 60 + minute) * 60_000;
  const approche = mural - decalageParis(mural);
  return mural - decalageParis(approche);
}
