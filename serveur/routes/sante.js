// serveur/routes/sante.js
//
// Rôle    : GET /api/sante, PUBLIC (healthcheck Docker, diagnostic depuis le Clevo) : { ha, version, empreinte }.
// Entrées : ConnexionHA (etat), version du paquet, empreinte du contenu servi (serveur/empreinte.js, null sans page).
// Sorties : 200 { ha: "ok" | "ko", version, empreinte } ; jamais de 5xx quand HA est injoignable (le BFF, lui, répond).
//           L'empreinte est celle que la page reçoit dans l'instantané du flux : la comparer avant et après un
//           déploiement dit si la page du cadre va se recharger d'elle-même.
// Pièges  :
//   - Public parce qu'enregistré hors du contexte qui exige la clé (app.js) : n'y ajouter aucune donnée
//     de la maison.
//   - Journal au niveau warn : un healthcheck toutes les 30 s noierait les journaux.

export default async function routesSante(app, { connexion, version, empreinte }) {
  app.get('/sante', { logLevel: 'warn' }, async (_requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    return { ha: connexion.etat, version, empreinte };
  });
}
