// serveur/ha/meteo.js
//
// Rôle    : prévisions heure par heure de weather.forecast_maison (met.no) par weather.get_forecasts, sur
//           48 h, projetées aux champs affichés. L'actuel vient de l'état de la même entité (entites.js).
// Entrées : ConnexionHA (lire, événement 'prete', etat), SourceEntites (événement 'maj').
// Sorties : SourceMeteo : valeur { horaire: [...] } (null avant la première lecture), événement 'maj' quand
//           elle change.
// Pièges  :
//   - Relu toutes les 30 min, à chaque (re)connexion à HA, et quand weather.forecast_maison apparaît ou
//     change (nouvelle prévision de met.no). Au démarrage de HA, l'entité n'existe pas encore quand le BFF
//     se reconnecte : la lecture lancée sur 'prete' échoue, et c'est l'apparition de l'entité (ou le
//     nouvel essai rapproché du socle Source) qui la rattrape. Un échec garde la dernière valeur.
//   - Le quotidien n'est PAS lu ici : met.no ne fournit que 6 jours (relevé le 11/10), et la colonne
//     « La semaine » en affiche 7. Ses 7 jours viennent tous d'Open-Meteo (sources/open-meteo.js), une seule
//     source pour toute la colonne (décision de Thomas du 11/10).
//   - Unités : celles des attributs de l'entité (temperature_unit...), projetées par entites.js. Le système
//     d'unités global de ce HA est impérial (relevé le 11/10) : seule l'entité est réglée en °C, km/h et mm.
//   - La probabilité de pluie n'est plus projetée depuis le 14/10 : l'écran Météo allégé ne l'affiche plus.
//   - Réponse validée par schéma avant projection : une forme inattendue est rejetée, pas propagée.

import { compilerValidateur, Source } from '../source.js';

const ENTITE = 'weather.forecast_maison';
const INTERVALLE_MS = 30 * 60_000;
const HEURES_MAX = 48;
const CHAMPS_HORAIRE = ['datetime', 'condition', 'temperature', 'precipitation', 'wind_speed', 'wind_bearing'];

const NOMBRE_OU_NULL = { type: ['number', 'null'] };
const validerReponse = compilerValidateur({
  type: 'object',
  required: ['forecast'],
  properties: {
    forecast: {
      type: 'array',
      items: {
        type: 'object',
        required: ['datetime'],
        properties: {
          datetime: { type: 'string', format: 'date-time' },
          condition: { type: ['string', 'null'] },
          temperature: NOMBRE_OU_NULL,
          precipitation: NOMBRE_OU_NULL,
          wind_speed: NOMBRE_OU_NULL,
          wind_bearing: NOMBRE_OU_NULL,
        },
      },
    },
  },
});

function projeterPrevisions(reponse) {
  return validerReponse(reponse).forecast.map((prevision) => {
    const projetee = {};
    for (const champ of CHAMPS_HORAIRE) {
      if (prevision[champ] !== undefined) projetee[champ] = prevision[champ];
    }
    return projetee;
  });
}

export class SourceMeteo extends Source {
  #connexion;
  #entites;

  constructor(connexion, entites, journal) {
    super('météo', journal);
    this.#connexion = connexion;
    this.#entites = entites;
  }

  demarrer() {
    this.#connexion.on('prete', () => this.actualiser());
    this.#entites.on('maj', (fragment) => {
      if (fragment[ENTITE]) this.actualiser();
    });
    this.repeter(INTERVALLE_MS, () => this.#connexion.etat === 'ok');
  }

  async lire() {
    const horaire = await this.#connexion.lire('weather.get_forecasts', ENTITE, { type: 'hourly' });
    return { horaire: projeterPrevisions(horaire).slice(0, HEURES_MAX) };
  }
}
