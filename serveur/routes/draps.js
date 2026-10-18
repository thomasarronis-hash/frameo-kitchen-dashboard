// serveur/routes/draps.js
//
// Rôle    : POST /api/draps/:lit, le bouton « Changés aujourd'hui » des cartes Draps (Maison > Entretien) : note la date du
//           changement des draps d'un lit dans draps.json (serveur/sources/draps.js), sans rien écrire dans Home Assistant.
// Entrées : { draps } (SourceDraps) ; :lit dans la liste fermée LITS (timo, pablo, parents) ; corps { quand: "aujourdhui" |
//           "hier" | "avant-hier" }.
// Sorties : 200 { lit, change_le } (la date retenue, calculée par le serveur à l'heure de Paris) ; 404 { erreur:
//           "lit_inconnu" } ; 400 { erreur: "corps_invalide", message } ; 429 au-delà de la limite. La nouvelle valeur part
//           aussi dans le flux (maj { draps }).
// Pièges  :
//   - Clé du cadre ou du Clevo (contexte privé de app.js) : tout le monde à la maison peut cocher (pas de mode parent,
//     choix de Thomas), mais pas un appareil inconnu du réseau.
//   - Jamais de date dans le corps : seulement un mot de la liste, que le serveur traduit en date (sources/draps.js).
//   - Limite dédiée de 10 appuis par minute et par IP (trois lits et une correction tiennent large), corps de 256 octets
//     au plus ; un JSON mal formé est refusé par Fastify avant la route (400).
//   - L'annulation de 5 s se fait dans la page AVANT l'envoi (web/src/ecrans/maison-draps.js) : aucune route
//     d'annulation, donc aucune date ancienne à rétablir ici.

import { limiteDediee } from '../securite.js';
import { compilerValidateur } from '../source.js';
import { LITS, QUAND } from '../sources/draps.js';

const APPUIS_PAR_MINUTE = 10;
const TAILLE_MAX_CORPS = 256;

const validerCorps = compilerValidateur({
  type: 'object', required: ['quand'], additionalProperties: false, properties: { quand: { enum: Object.keys(QUAND) } },
});

export default async function routesDraps(app, { draps }) {
  app.post('/draps/:lit', { onRequest: limiteDediee(app, APPUIS_PAR_MINUTE), bodyLimit: TAILLE_MAX_CORPS }, async (requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    const { lit } = requete.params;
    if (!LITS.includes(lit)) return reponse.code(404).send({ erreur: 'lit_inconnu' });
    let corps;
    try {
      corps = validerCorps(requete.body === undefined ? {} : requete.body);
    } catch {
      return reponse.code(400).send({ erreur: 'corps_invalide', message: 'quand : aujourdhui, hier ou avant-hier' });
    }
    const resultat = await draps.marquer(lit, corps.quand);
    requete.log.info(`draps : ${lit} changés le ${resultat.change_le}, noté par ${requete.appareil}`);
    return resultat;
  });
}
