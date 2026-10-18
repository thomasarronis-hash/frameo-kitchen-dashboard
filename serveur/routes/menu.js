// serveur/routes/menu.js
//
// Rôle    : GET /api/menu, le menu de la semaine retenu par serveur/sources/menus.js (cycle qui couvre
//           aujourd'hui à Paris, dernière version valide).
// Entrées : la source des menus ({ valeur }).
// Sorties : 200 { menu } : le menu tel que publié (partage/schema-menu-v1.json), ou null s'il n'y en a pas
//           (« Menu pas encore publié »).
// Pièges  :
//   - Clé du cadre OU du Clevo (contexte privé de app.js). La page n'en a pas besoin : le menu lui arrive par
//     le flux (clé menu de l'instantané, puis événement menu) ; cette route sert au diagnostic et aux outils.
//   - Toujours 200, même sans menu : l'absence de menu est un état normal (le samedi avant /menu).
//   - Fastify répond aussi en HEAD (200 sans corps, ou 401 sans clé) : la page s'en sert, quand son flux est
//     refusé, pour savoir si c'est la clé (« Cadre non appairé ») sans recharger le menu (web/src/api.js).

export default async function routesMenu(app, { menus }) {
  app.get('/menu', async (_requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    return { menu: menus.valeur };
  });
}
