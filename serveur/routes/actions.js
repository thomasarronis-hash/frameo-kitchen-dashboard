// serveur/routes/actions.js
//
// Rôle    : POST /api/action/:nom, l'action de la liste blanche demandée par le cadre ou par outils/cadre.mjs cocher :
//           courses (serveur/ha/actions.js), maison (serveur/ha/actions-maison.js), voiture
//           (serveur/ha/actions-voiture.js) ou clims (serveur/ha/actions-clim.js), chacune sous son garde-fou.
// Entrées : { actions, actionsMaison, actionsVoiture, actionsClim } (creerActions, creerActionsMaison, creerActionsVoiture,
//           creerActionsClim) ; corps JSON propre à chaque action (absent = {}).
// Sorties : 200 { ok: true, simulation } ; 400 { erreur: "corps_invalide", message } ; 404 { erreur:
//           "action_inconnue" }, et pour la voiture { erreur: "voiture_inconnue" } ou { erreur: "commande_absente" }, pour
//           les clims { erreur: "clim_inconnue" } ou { erreur: "commande_absente" } ;
//           503 { erreur: "applis_inconnues" } (applis de l'Apple TV pas encore lues), { erreur: "commande_indisponible" }
//           ou { erreur: "bornes_inconnues" } (voiture, clims) ; 429 { erreur: "trop_tot", message } (écart par rôle ou
//           budget horaire de la voiture : quota de l'API Renault ; écart par commande ou budget horaire des clims) ; 502 { erreur: "action_echouee", message } ; 429 au-delà de
//           la limite.
// Pièges  :
//   - Clé du cadre OU du Clevo (contexte privé de app.js).
//   - Les actions maison, voiture puis clims sont cherchées d'abord : un nom qui n'est ni maison, ni voiture, ni clim, ni
//     courses tombe sur actions.js, qui répond 404. Aucune action d'alarme n'existe (décision de Thomas du 13/10).
//   - Limites : 60 actions par minute et par IP (limite dédiée), en plus des 300 requêtes par minute de tout /api ;
//     SAUF les touches de télécommande, comptées par leur propre compteur de contexte (10 par seconde, hors limite
//     globale : app.js et securite.js), qui sautent donc aussi la limite dédiée : un doigt qui tient le volume ne
//     doit pas bloquer les courses pendant une minute.
//   - Corps limité à 1 Ko : le plus gros corps prévu (60 caractères, ou un nom d'appli) en fait moins de 200.
//   - Un JSON mal formé est refusé par Fastify lui-même (400, avant la route).

import { ErreurAction } from '../ha/actions.js';
import { limiteDediee } from '../securite.js';

const ACTIONS_PAR_MINUTE = 60;
const TAILLE_MAX_CORPS = 1024;

export default async function routesActions(app, {
  actions, actionsMaison, actionsVoiture, actionsClim,
}) {
  const limite = limiteDediee(app, ACTIONS_PAR_MINUTE);
  const limiterSaufTelecommande = async (requete, reponse) => {
    if (!actionsMaison.telecommande(requete.params.nom)) await limite(requete, reponse);
  };

  app.post('/action/:nom', { onRequest: limiterSaufTelecommande, bodyLimit: TAILLE_MAX_CORPS }, async (requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    const { nom } = requete.params;
    const executant = [actionsMaison, actionsVoiture, actionsClim].find((table) => table.connait(nom)) || actions;
    try {
      return await executant.executer(nom, requete.body === undefined ? {} : requete.body);
    } catch (err) {
      if (!(err instanceof ErreurAction)) throw err;
      return reponse.code(err.statusCode).send({ erreur: err.code, message: err.message });
    }
  });
}
