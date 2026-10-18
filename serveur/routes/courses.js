// serveur/routes/courses.js
//
// Rôle    : GET /api/courses, la liste partagée todo.shopping_list pour outils/cadre.mjs (etat, cocher).
// Entrées : la source des courses ({ valeur }, serveur/ha/courses.js).
// Sorties : 200 { articles: [{ uid, summary, status }] } ; 503 { erreur: "courses_indisponibles" } tant que la
//           liste n'a jamais été lue ; 403 avec la clé du cadre.
// Pièges  :
//   - Réservée à la clé du Clevo (conception §2.3) : la page reçoit déjà la liste par le flux.
//   - En simulation (ACTIONS_REELLES absent), la liste rendue est la copie locale, actions simulées comprises.

import { reserverAuClevo } from '../securite.js';

export default async function routesCourses(app, { courses }) {
  app.get('/courses', { onRequest: reserverAuClevo }, async (_requete, reponse) => {
    reponse.header('cache-control', 'no-store');
    if (courses.valeur === null) {
      return reponse.code(503).send({ erreur: 'courses_indisponibles', message: 'Liste de courses pas encore lue (Home Assistant injoignable ?)' });
    }
    return courses.valeur;
  });
}
