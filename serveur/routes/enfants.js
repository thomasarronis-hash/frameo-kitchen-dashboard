// serveur/routes/enfants.js
//
// Rôle    : les routes du tableau des enfants (choix de Thomas du 14/10) : mode parent, étapes du matin, points (dont le
//           +1 libre et le −1 d'un parent, décisions du 14/10 en fin d'après-midi), boutique, minuteur d'écran de Timo,
//           historique de 7 jours. Tout est écrit dans DOSSIER_ETAT/enfants par SourceEnfants (sources/enfants.js),
//           jamais dans Home Assistant ; chaque changement part dans le flux (maj { enfants }).
// Entrées : { enfants } (SourceEnfants : le barème et les règles sont derrière elle, qui refuse un enfant, une étape, un
//           motif ou un cadeau inconnus), { modeParent } (enfants/mode-parent.js, créé ici s'il n'est pas fourni). En-tête
//           X-Cadre-Parent : le jeton du mode parent. Ici, seule la FORME des corps est contrôlée (schémas fermés).
// Sorties : POST /api/enfants/parent -> 200 { jeton, expire_le } ;
//           POST /api/enfants/:enfant/etapes/:etape (corps vide ou {}) -> 200 { enfant, etape, statut, par,
//             annulable_jusqu_a } ; en mode parent (en-tête valide) l'étape est validée tout de suite ;
//           POST /api/enfants/:enfant/etapes/:etape/annuler -> 200 { enfant, etape, statut: « a_faire » } ; dans les 5 s pour
//             une coche de l'enfant, sans délai en mode parent (correction d'une étape cochée par erreur) ; une étape cochée
//             par un parent ne se défait qu'en mode parent (403) ;
//           cocher sans jeton après fin_routine (9 h) : 409 routine_finie ;
//           POST /api/enfants/:enfant/etapes/:etape/decision { decision: « valider » | « refuser » } (parent) -> 200 { enfant,
//             etape, statut } ;
//           POST /api/enfants/:enfant/points { motif?: id | null } (parent) -> 200 { enfant, solde, aujourdhui } ;
//           POST /api/enfants/:enfant/points/retirer (corps vide ou {}, parent : −1, le dernier gain) -> 200 { enfant,
//             solde, aujourdhui, libres_restants } ;
//           POST /api/enfants/:enfant/points/libre (corps vide ou {}, SANS jeton : bouton +1 de l'écran de Timo) -> 200
//             { enfant, solde, aujourdhui, libres_restants, annulable_jusqu_a } ;
//           POST /api/enfants/:enfant/points/libre/annuler (corps vide ou {}, sans jeton : le dernier point libre de cet
//             enfant, dans les 10 s, jamais deux fois) -> 200 { enfant, solde, aujourdhui, libres_restants } ;
//           POST /api/enfants/:enfant/echanges { cadeau } -> 200 { enfant, demande: { id, enfant, cadeau, prix, le },
//             remplace } ;
//           POST /api/enfants/:enfant/echanges/:demande/decision { decision } (parent) -> 200 { enfant, demande, decision,
//             solde } ;
//           POST /api/enfants/:enfant/minuteur { action: « demarrer » | « pause » | « finir » } -> 200 { enfant, minuteur,
//             disponibles_s } ;
//           GET /api/enfants/historique (parent) -> 200 { jours, enfants } (enfants/projection.js).
//           Refus : 400 { erreur: « corps_invalide », message } ou { erreur: « motif_inconnu » | « cadeau_inconnu » } ;
//           403 { erreur: « mode_parent_requis » } ; 404 { erreur: « enfant_inconnu » | « etape_inconnue » | « pas_cochee » |
//           « sans_points » | « sans_minutes » | « demande_inconnue » } ; 409 { erreur: « deja_cochee » | « trop_tot » |
//           « trop_tard » | « routine_finie » | « pas_en_attente » | « plafond_jour » | « plafond_libre » |
//           « rien_a_annuler » | « aucun_point » | « points_depenses » | « points_insuffisants » | « deja_en_cours » |
//           « pas_en_cours » | « aucun_minuteur » | « aucune_minute » | « minutes_perdues » } ; 413 au-delà de 256 octets
//           de corps ; 429 au-delà des limites.
// Pièges  :
//   - Contexte privé de app.js : clé du cadre ou du Clevo exigée avant tout (401 sinon). Le mode parent s'ajoute par
//     dessus, il ne la remplace jamais ; c'est une barrière contre les doigts d'enfants, pas une sécurité forte
//     (enfants/mode-parent.js).
//   - Cocher ou annuler avec un en-tête X-Cadre-Parent invalide ou expiré : 403, jamais une action « enfant » silencieuse
//     (le parent croirait avoir validé ou corrigé).
//   - Points libres (décision de Thomas du 14/10 en fin d'après-midi) : ni jeton ni en-tête lu, tout le monde peut donner
//     ce point ; les bornes sont dans les règles (plafond_libre du barème par journée, annulation du seul dernier point
//     libre dans les 10 s, une fois) et dans la limite commune de 60 touchers par minute. Le −1 reste au mode parent.
//   - Limites dédiées par IP : 60 touchers par minute pour l'ensemble des routes des enfants (un compteur partagé), 10
//     jetons parent par minute ; la limite passe AVANT le contrôle du jeton (pas d'essais en rafale).
//   - Aucune date ni heure ni nombre de points ne vient de la page : le serveur prend son heure (Paris), le barème donne
//     les valeurs, la page ne choisit que des identifiants et des mots d'une liste fermée.
//   - Journal court : enfant, étape ou cadeau, action, appareil ; jamais le jeton (en-tête masqué par securite.js), ni
//     prénom, ni motif.

import { ErreurEnfants } from '../enfants/erreur.js';
import { creerModeParent } from '../enfants/mode-parent.js';
import { limiteDediee } from '../securite.js';
import { compilerValidateur } from '../source.js';

const EN_TETE_PARENT = 'x-cadre-parent';
const TOUCHERS_PAR_MINUTE = 60;
const JETONS_PAR_MINUTE = 10;
const TAILLE_MAX_CORPS = 256;
const ID = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,23}$' };

const corps = (proprietes, requis = []) => compilerValidateur({
  type: 'object', additionalProperties: false, required: requis, properties: proprietes,
});
const CORPS = {
  vide: { valider: corps({}), message: 'aucun champ attendu' },
  decision: { valider: corps({ decision: { enum: ['valider', 'refuser'] } }, ['decision']), message: 'decision : valider ou refuser' },
  point: { valider: corps({ motif: { anyOf: [ID, { type: 'null' }] } }), message: 'motif : identifiant de la liste, ou null' },
  echange: { valider: corps({ cadeau: ID }, ['cadeau']), message: 'cadeau : identifiant de la boutique' },
  minuteur: { valider: corps({ action: { enum: ['demarrer', 'pause', 'finir'] } }, ['action']), message: 'action : demarrer, pause ou finir' },
};

class ErreurCorps extends Error {}

function lireCorps(requete, { valider, message }) {
  try {
    return valider(requete.body === undefined ? {} : requete.body);
  } catch {
    throw new ErreurCorps(message);
  }
}

// Réponse commune : jamais en cache ; refus voulus (corps, règles) en 4xx, le reste remonte à app.js (500).
const traiter = (fonction) => async (requete, reponse) => {
  reponse.header('cache-control', 'no-store');
  try {
    return await fonction(requete);
  } catch (err) {
    if (err instanceof ErreurCorps) return reponse.code(400).send({ erreur: 'corps_invalide', message: err.message });
    if (err instanceof ErreurEnfants) return reponse.code(err.statut).send({ erreur: err.code });
    throw err;
  }
};

export default async function routesEnfants(app, { enfants, modeParent = creerModeParent() }) {
  const limite = limiteDediee(app, TOUCHERS_PAR_MINUTE);
  const limiteJeton = limiteDediee(app, JETONS_PAR_MINUTE);
  const parentValide = (requete) => {
    if (modeParent.valide(requete.headers[EN_TETE_PARENT])) return true;
    requete.log.warn('enfants : mode parent absent ou expiré');
    return false;
  };
  const exigerParent = async (requete, reponse) => {
    if (!parentValide(requete)) return reponse.code(403).header('cache-control', 'no-store').send({ erreur: 'mode_parent_requis' });
  };
  const options = { onRequest: limite, bodyLimit: TAILLE_MAX_CORPS };
  const optionsParent = { onRequest: [limite, exigerParent], bodyLimit: TAILLE_MAX_CORPS };

  app.post('/enfants/parent', { onRequest: limiteJeton, bodyLimit: TAILLE_MAX_CORPS }, traiter(async (requete) => {
    lireCorps(requete, CORPS.vide);
    requete.log.info(`enfants : mode parent ouvert (${requete.appareil})`);
    return modeParent.emettre();
  }));

  app.post('/enfants/:enfant/etapes/:etape', options, traiter(async (requete) => {
    const parent = requete.headers[EN_TETE_PARENT] !== undefined;
    if (parent && !parentValide(requete)) throw new ErreurEnfants('mode_parent_requis', 403);
    lireCorps(requete, CORPS.vide);
    const { enfant, etape } = requete.params;
    const resultat = await enfants.cocher(enfant, etape, { parent });
    requete.log.info(`enfants : ${enfant}, étape ${etape} ${resultat.statut} (${resultat.par}, ${requete.appareil})`);
    return resultat;
  }));

  app.post('/enfants/:enfant/etapes/:etape/annuler', options, traiter(async (requete) => {
    const parent = requete.headers[EN_TETE_PARENT] !== undefined;
    if (parent && !parentValide(requete)) throw new ErreurEnfants('mode_parent_requis', 403);
    lireCorps(requete, CORPS.vide);
    const { enfant, etape } = requete.params;
    const resultat = await enfants.annuler(enfant, etape, { parent });
    requete.log.info(`enfants : ${enfant}, étape ${etape} ${parent ? 'corrigée (mode parent)' : 'annulée'} (${requete.appareil})`);
    return resultat;
  }));

  app.post('/enfants/:enfant/etapes/:etape/decision', optionsParent, traiter(async (requete) => {
    const { decision } = lireCorps(requete, CORPS.decision);
    const { enfant, etape } = requete.params;
    const resultat = await enfants.decider(enfant, etape, decision);
    requete.log.info(`enfants : ${enfant}, étape ${etape} ${decision === 'valider' ? 'validée' : 'refusée'} (mode parent)`);
    return resultat;
  }));

  app.post('/enfants/:enfant/points', optionsParent, traiter(async (requete) => {
    const { motif = null } = lireCorps(requete, CORPS.point);
    const resultat = await enfants.donnerPoint(requete.params.enfant, motif);
    requete.log.info(`enfants : point donné à ${resultat.enfant} (mode parent)`);
    return resultat;
  }));

  app.post('/enfants/:enfant/points/retirer', optionsParent, traiter(async (requete) => {
    lireCorps(requete, CORPS.vide);
    const resultat = await enfants.retirerPoint(requete.params.enfant);
    requete.log.info(`enfants : point retiré à ${resultat.enfant} (mode parent)`);
    return resultat;
  }));

  app.post('/enfants/:enfant/points/libre', options, traiter(async (requete) => {
    lireCorps(requete, CORPS.vide);
    const resultat = await enfants.donnerPointLibre(requete.params.enfant);
    requete.log.info(`enfants : point libre pour ${resultat.enfant} (${requete.appareil})`);
    return resultat;
  }));

  app.post('/enfants/:enfant/points/libre/annuler', options, traiter(async (requete) => {
    lireCorps(requete, CORPS.vide);
    const resultat = await enfants.annulerPointLibre(requete.params.enfant);
    requete.log.info(`enfants : point libre de ${resultat.enfant} annulé (${requete.appareil})`);
    return resultat;
  }));

  app.post('/enfants/:enfant/echanges', options, traiter(async (requete) => {
    const { cadeau } = lireCorps(requete, CORPS.echange);
    const resultat = await enfants.demanderEchange(requete.params.enfant, cadeau);
    requete.log.info(`enfants : ${resultat.enfant} demande l'échange ${cadeau}${resultat.remplace ? ' (remplace sa demande)' : ''}`);
    return resultat;
  }));

  app.post('/enfants/:enfant/echanges/:demande/decision', optionsParent, traiter(async (requete) => {
    const { decision } = lireCorps(requete, CORPS.decision);
    const { enfant, demande } = requete.params;
    const resultat = await enfants.deciderEchange(enfant, demande, decision);
    requete.log.info(`enfants : échange de ${enfant} ${decision === 'valider' ? 'validé' : 'refusé'} (mode parent)`);
    return resultat;
  }));

  app.post('/enfants/:enfant/minuteur', options, traiter(async (requete) => {
    const { action } = lireCorps(requete, CORPS.minuteur);
    const resultat = await enfants.piloterMinuteur(requete.params.enfant, action);
    requete.log.info(`enfants : minuteur de ${resultat.enfant}, ${action} (${requete.appareil})`);
    return resultat;
  }));

  app.get('/enfants/historique', { onRequest: [limite, exigerParent] }, traiter(async () => enfants.historique()));
}
