// serveur/sources/open-meteo.js
//
// Rôle    : par Open-Meteo, sans clé : qualité de l'air et pollens (relus toutes les heures), pluie au pas de
//           15 min (toutes les 15 min) et les 7 jours de la colonne « La semaine » (toutes les heures).
// Entrées : réponses JSON d'Open-Meteo, aux URL exactes de la conception (§2.2, vérifiées par le test).
// Sorties : creerSourcesOpenMeteo(journal, lieu) -> { air, pluie, semaine }, trois sources du flux, aux coordonnées du
//           lieu (serveur/config.js, lireLieu) ; la semaine porte en plus le nom du lieu (lieu), écrit sur l'Accueil ;
//           analyserAir(json, aujourdhui), analyserPluie(json), analyserSemaine(json, maintenant),
//           cielDeLaJournee(codes), pour les tests (l'heure de Paris vient de serveur/heure-paris.js).
//           air     : { actuel: { time, european_aqi, pm2_5, pm10, ozone, nitrogen_dioxide }, unites,
//                       jours: [{ date, european_aqi, alder_pollen, ... }] } : J, J+1 et J+2, maximum du jour ;
//           pluie   : { unite, pas: [{ time, precipitation }] } : 8 pas, le premier est le quart d'heure en cours ;
//           semaine : { unites, jours: [{ date, code_ciel, temperature_2m_max, temperature_2m_min,
//                       precipitation_sum, wind_speed_10m_max }] } : 7 jours,
//                       aujourd'hui compris ; code_ciel est un code WMO (traduit par la page), ou null.
// Pièges  :
//   - Heures locales de Paris SANS décalage (timezone=Europe/Paris dans l'URL), par exemple
//     « 2026-10-11T14:15 » : elles se comparent en texte à l'heure de Paris, jamais à l'heure UTC.
//   - null possible partout (modèle CAMS des pollens à 11 km, trous de données) : un maximum ignore les
//     null, et vaut null si la journée n'a aucune valeur. La semaine garde ses null tels quels.
//   - « Aujourd'hui » et « maintenant » sont pris sur l'horloge du serveur, à l'heure de Paris, à chaque
//     lecture horaire : jusqu'à 1 h après minuit, J reste la veille. La page écarte un jour passé (et de
//     23h à 5h, seule l'horloge est affichée de toute façon).
//   - Ciel de la journée : le weather_code QUOTIDIEN d'Open-Meteo est le code le plus sévère des 24 heures
//     (doc Open-Meteo) : une heure de brouillard à 6h suffit à afficher « Brouillard » toute la journée
//     (constaté le 11/10 : 6 jours sur 7). Il n'est donc pas demandé. On lit weather_code HEURE PAR HEURE
//     (même requête) et on retient le code le plus sévère qui couvre au moins 3 heures de jour (8h-20h) ;
//     si aucun ne les couvre, le plus fréquent, le plus sévère à égalité. Sévérité = ordre numérique des
//     codes WMO, la convention d'Open-Meteo pour son code quotidien. Pour aujourd'hui, seules les heures
//     restantes comptent (l'heure en cours comprise) ; après 20h, les heures qui restent jusqu'à minuit.
//     Règle choisie le 11/10 [S] : à revoir si elle se trompe à l'usage.
//   - La semaine vient TOUTE d'Open-Meteo (une seule source pour la colonne) : met.no via HA ne donne que
//     6 jours de quotidien. L'actuel et l'horaire 48 h restent ceux de HA (serveur/ha/meteo.js).
//   - Une erreur d'Open-Meteo arrive en HTTP 400 avec { error: true, reason } : rejetée avec sa raison.
//   - 24 + 96 + 24 appels par jour, très loin de la limite gratuite (10 000).

import { dateParis, debutHeureParis } from '../heure-paris.js';
import { compilerValidateur, Source } from '../source.js';

const coordonnees = ({ latitude, longitude }) => `latitude=${latitude}&longitude=${longitude}`;
const urlAir = (lieu) => `https://air-quality-api.open-meteo.com/v1/air-quality?${coordonnees(lieu)}&current=european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&hourly=european_aqi,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&timezone=Europe/Paris&forecast_days=4`;
const urlPluie = (lieu) => `https://api.open-meteo.com/v1/forecast?${coordonnees(lieu)}&minutely_15=precipitation&models=meteofrance_seamless&forecast_minutely_15=8&timezone=Europe/Paris`;
const urlSemaine = (lieu) => `https://api.open-meteo.com/v1/forecast?${coordonnees(lieu)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&hourly=weather_code&timezone=Europe/Paris&forecast_days=7`;

const VARIABLES_ACTUELLES = ['european_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide'];
const VARIABLES_HORAIRES = ['european_aqi', 'alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'];
const VARIABLES_QUOTIDIENNES = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max'];
const NB_JOURS = 3;
const NB_JOURS_SEMAINE = 7;
const HEURE_DEBUT_JOUR = 8;
const HEURE_FIN_JOUR = 20;
const HEURES_MIN_CIEL = 3;
const DELAI_REQUETE_MS = 15_000;

const NOMBRE_OU_NULL = { type: ['number', 'null'] };
const HEURES = { type: 'array', items: { type: 'string' } };
const UNITES = { type: 'object', additionalProperties: { type: 'string' } };
const champs = (variables, schema) => Object.fromEntries(variables.map((nom) => [nom, schema]));

const validerAir = compilerValidateur({
  type: 'object',
  required: ['current', 'current_units', 'hourly', 'hourly_units'],
  properties: {
    current: {
      type: 'object',
      required: ['time', ...VARIABLES_ACTUELLES],
      properties: { time: { type: 'string' }, ...champs(VARIABLES_ACTUELLES, NOMBRE_OU_NULL) },
    },
    current_units: UNITES,
    hourly: {
      type: 'object',
      required: ['time', ...VARIABLES_HORAIRES],
      properties: { time: HEURES, ...champs(VARIABLES_HORAIRES, { type: 'array', items: NOMBRE_OU_NULL }) },
    },
    hourly_units: UNITES,
  },
});

const validerSemaine = compilerValidateur({
  type: 'object',
  required: ['daily', 'daily_units', 'hourly'],
  properties: {
    daily: {
      type: 'object',
      required: ['time', ...VARIABLES_QUOTIDIENNES],
      properties: {
        time: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        ...champs(VARIABLES_QUOTIDIENNES, { type: 'array', items: NOMBRE_OU_NULL }),
      },
    },
    daily_units: UNITES,
    hourly: {
      type: 'object',
      required: ['time', 'weather_code'],
      properties: {
        time: { type: 'array', items: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' } },
        weather_code: { type: 'array', items: { type: ['integer', 'null'] } },
      },
    },
  },
});

const validerPluie = compilerValidateur({
  type: 'object',
  required: ['minutely_15', 'minutely_15_units'],
  properties: {
    minutely_15: {
      type: 'object',
      required: ['time', 'precipitation'],
      properties: { time: HEURES, precipitation: { type: 'array', items: NOMBRE_OU_NULL } },
    },
    minutely_15_units: { type: 'object', required: ['precipitation'], properties: { precipitation: { type: 'string' } } },
  },
});

function verifierLongueurs(bloc, variables) {
  for (const nom of variables) {
    if (bloc[nom].length !== bloc.time.length) throw new Error(`réponse inattendue : ${nom} n'a pas autant de valeurs que time`);
  }
}

function maximum(valeurs) {
  const nombres = valeurs.filter((v) => typeof v === 'number');
  return nombres.length > 0 ? Math.max(...nombres) : null;
}

export function analyserAir(json, aujourdhui) {
  const { current, current_units: unitesActuelles, hourly, hourly_units: unitesHoraires } = validerAir(json);
  verifierLongueurs(hourly, VARIABLES_HORAIRES);

  const actuel = { time: current.time };
  const unites = {};
  for (const nom of VARIABLES_ACTUELLES) {
    actuel[nom] = current[nom];
    if (unitesActuelles[nom]) unites[nom] = unitesActuelles[nom];
  }
  for (const nom of VARIABLES_HORAIRES) {
    if (unitesHoraires[nom]) unites[nom] = unitesHoraires[nom];
  }

  const heuresParDate = new Map();
  hourly.time.forEach((heure, i) => {
    const date = heure.slice(0, 10);
    if (!heuresParDate.has(date)) heuresParDate.set(date, []);
    heuresParDate.get(date).push(i);
  });
  const jours = [...heuresParDate.keys()]
    .filter((date) => date >= aujourdhui)
    .slice(0, NB_JOURS)
    .map((date) => {
      const jour = { date };
      for (const nom of VARIABLES_HORAIRES) jour[nom] = maximum(heuresParDate.get(date).map((i) => hourly[nom][i]));
      return jour;
    });

  return { actuel, unites, jours };
}

export function analyserPluie(json) {
  const { minutely_15: pas, minutely_15_units: unites } = validerPluie(json);
  verifierLongueurs(pas, ['precipitation']);
  return {
    unite: unites.precipitation,
    pas: pas.time.map((time, i) => ({ time, precipitation: pas.precipitation[i] })),
  };
}

// Le code le plus sévère qui couvre au moins 3 heures (toutes les heures s'il y en a moins), sinon le plus
// fréquent, le plus sévère à égalité ; null sans aucun code.
export function cielDeLaJournee(codes) {
  if (codes.length === 0) return null;
  const comptes = new Map();
  for (const code of codes) comptes.set(code, (comptes.get(code) || 0) + 1);
  const seuil = Math.min(HEURES_MIN_CIEL, codes.length);
  let retenu = null;
  for (const [code, compte] of comptes) {
    if (compte >= seuil && (retenu === null || code > retenu)) retenu = code;
  }
  if (retenu !== null) return retenu;
  let compteRetenu = 0;
  for (const [code, compte] of comptes) {
    if (compte > compteRetenu || (compte === compteRetenu && code > retenu)) {
      retenu = code;
      compteRetenu = compte;
    }
  }
  return retenu;
}

// Codes des heures retenues pour une date : heures de jour (8h-20h) qui ne sont pas passées ; s'il n'en
// reste aucune (aujourd'hui après 20h), les heures qui restent jusqu'à minuit.
function codesDuJour(horaire, date, maintenant) {
  const restantes = [];
  horaire.time.forEach((heure, i) => {
    if (heure.startsWith(date) && heure >= maintenant) restantes.push(i);
  });
  const deJour = restantes.filter((i) => {
    const heure = Number(horaire.time[i].slice(11, 13));
    return heure >= HEURE_DEBUT_JOUR && heure < HEURE_FIN_JOUR;
  });
  return (deJour.length > 0 ? deJour : restantes)
    .map((i) => horaire.weather_code[i])
    .filter((code) => code !== null);
}

export function analyserSemaine(json, maintenant) {
  const { daily: quotidien, daily_units: unitesQuotidiennes, hourly: horaire } = validerSemaine(json);
  verifierLongueurs(quotidien, VARIABLES_QUOTIDIENNES);
  verifierLongueurs(horaire, ['weather_code']);
  const unites = {};
  for (const nom of VARIABLES_QUOTIDIENNES) {
    if (unitesQuotidiennes[nom]) unites[nom] = unitesQuotidiennes[nom];
  }
  const jours = quotidien.time.slice(0, NB_JOURS_SEMAINE).map((date, i) => {
    const jour = { date, code_ciel: cielDeLaJournee(codesDuJour(horaire, date, maintenant)) };
    for (const nom of VARIABLES_QUOTIDIENNES) jour[nom] = quotidien[nom][i];
    return jour;
  });
  return { unites, jours };
}

async function lireJson(url) {
  const reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_REQUETE_MS), headers: { accept: 'application/json' } });
  const corps = await reponse.json().catch(() => null);
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}${corps?.reason ? ` : ${corps.reason}` : ''}`);
  return corps;
}

class SourceOpenMeteo extends Source {
  #url;
  #intervalleMs;
  #analyser;

  constructor({ nom, url, intervalleMs, analyser }, journal) {
    super(nom, journal);
    this.#url = url;
    this.#intervalleMs = intervalleMs;
    this.#analyser = analyser;
  }

  demarrer() {
    this.actualiser();
    this.repeter(this.#intervalleMs);
  }

  async lire() {
    return this.#analyser(await lireJson(this.#url));
  }
}

export function creerSourcesOpenMeteo(journal, lieu) {
  return {
    air: new SourceOpenMeteo({
      nom: 'air et pollens', url: urlAir(lieu), intervalleMs: 60 * 60_000, analyser: (json) => analyserAir(json, dateParis()),
    }, journal),
    pluie: new SourceOpenMeteo({
      nom: 'pluie au pas de 15 min', url: urlPluie(lieu), intervalleMs: 15 * 60_000, analyser: analyserPluie,
    }, journal),
    semaine: new SourceOpenMeteo({
      nom: 'semaine (7 jours)', url: urlSemaine(lieu), intervalleMs: 60 * 60_000,
      analyser: (json) => ({ ...analyserSemaine(json, debutHeureParis()), lieu: lieu.nom }),
    }, journal),
  };
}
