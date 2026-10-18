// web/src/api.js
//
// Rôle    : la liaison avec le serveur : EventSource vers /api/flux, chien de garde de 45 s qui recrée la
//           connexion, réglage de l'horloge sur heure_serveur, repérage du « Cadre non appairé » (clé refusée),
//           et envoi des actions (POST) avec des erreurs lisibles.
// Entrées : creerFlux({ url, etat (etat.js), horloge (heure.js), monotone (horloge monotone en ms,
//           performance.now), ouvrirSource (url -> EventSource ; un faux dans les tests), verifierCle (() ->
//           promesse du code HTTP d'une requête protégée, HEAD /api/menu dans la page) }) ;
//           creerClient({ requete (fetch ou un faux), surNonAppaire (appelé sur un 401), delaiMs (10 s par défaut) }).
// Sorties : creerFlux(options) -> { demarrer(), verifier(), silenceMs(), nonAppaire(), signalerNonAppaire() } ;
//           verifier() est appelé à chaque seconde par main.js ; silenceMs() dit depuis combien de temps rien
//           n'est arrivé (instantane, maj, menu ou ping) ; nonAppaire() est vrai après un 401, jusqu'au
//           prochain message reçu.
//           creerClient(options) -> { poster(chemin, corps, entetes), lire(chemin, entetes) } : promesse de { ok: true,
//           donnees } ou { ok: false, statut, message, code } (jamais rejetée ; statut : code HTTP, 0 sans réponse, pour
//           qu'un écran écrive son propre message court ; code : le champ erreur de la réponse, « trop_tot »,
//           « points_insuffisants »..., ou null) ; lire fait un GET JSON (Wi-Fi invités, lot de photos, historique des
//           enfants) ; entetes (facultatif) s'ajoute à la requête : X-Cadre-Parent du mode parent des enfants ;
//           SILENCE_MAX_MS (45 s).
// Pièges  :
//   - Le serveur envoie un ping toutes les 20 s : 45 s sans rien veut dire connexion morte (TCP à moitié
//     ouvert, serveur arrêté, Wi-Fi coupé), même si EventSource se croit encore ouvert.
//   - EventSource se reconnecte seul après une coupure franche (retry: 3000), mais abandonne (readyState
//     CLOSED) après une réponse refusée (401, 5xx) : le chien de garde le recrée alors toutes les 45 s, sans
//     jamais recharger la page (pas de boucle de rechargement sur un cadre non appairé).
//   - EventSource ne donne pas le code HTTP d'un refus : à l'abandon, verifierCle refait une requête protégée
//     et seul un 401 fait dire « non appairé » (un 5xx ou une erreur réseau, non : bandeau hors ligne).
//   - L'événement menu a les données d'une maj ({ menu }) : il est rangé de la même façon.
//   - Silence mesuré sur l'horloge monotone : l'heure murale du cadre peut sauter.
//   - Un événement au JSON illisible est ignoré (signalé dans la console), il ne casse pas la page.
//   - Le cookie cadre_cle part tout seul (même origine) : la clé n'est jamais dans l'URL ni dans le corps.
//   - poster et lire : cache no-store ; les messages d'erreur sont en français et ne citent jamais la clé.
//   - poster abandonne au bout de 10 s (AbortController et setTimeout : AbortSignal.timeout n'existe pas sur une
//     vieille WebView) : sans cela, une requête pendante (Wi-Fi du cadre qui décroche pendant l'envoi) laissait
//     l'article grisé, sans message, jusqu'à ce que le navigateur abandonne, souvent plusieurs minutes. Sans
//     AbortController (très vieille WebView), le délai rend la main de la même façon, la requête continue seule.
//   - lire : le délai couvre aussi la lecture du corps (requête sans effet, on peut la refaire) : un transfert qui
//     cale après les en-têtes (Wi-Fi du cadre qui décroche, constat du 14/10 sur les photos) rend « pas de réponse »
//     au lieu de rester pendant pour toujours, ce qui bloquait la relecture du lot de photos. poster s'arrête aux
//     en-têtes : une action déjà faite par le serveur ne doit pas être annoncée « rien n'a été changé ».

export const SILENCE_MAX_MS = 45000;
const FERMEE = 2;
const NON_APPAIRE = 401;
const ECHEC_MAISON = 502;
const DELAI_POST_MS = 10000;
const SANS_REPONSE = 'Pas de réponse du serveur, rien n\'a été changé';

const MESSAGES = {
  401: 'Cadre non appairé : le serveur ne reconnaît pas sa clé',
  404: 'Action inconnue du serveur',
  429: 'Trop d\'actions d\'affilée : réessayer dans une minute',
};

export function creerFlux({ url, etat, horloge, monotone, ouvrirSource, verifierCle }) {
  let source = null;
  let derniereReception = monotone();
  let ouverteLe = derniereReception;
  let nonAppaire = false;

  function recevoir(traiter) {
    return (evenement) => {
      let donnees;
      try {
        donnees = JSON.parse(evenement.data);
      } catch (err) {
        console.warn('flux : événement illisible ignoré', err);
        return;
      }
      derniereReception = monotone();
      nonAppaire = false;
      if (typeof donnees.heure_serveur === 'number') horloge.regler(donnees.heure_serveur);
      traiter(donnees);
    };
  }

  function surErreur(ouverte) {
    return () => {
      if (ouverte !== source || ouverte.readyState !== FERMEE) return;
      verifierCle().then((statut) => {
        if (statut === NON_APPAIRE) nonAppaire = true;
      }, () => {});
    };
  }

  function ouvrir() {
    if (source) source.close();
    source = ouvrirSource(url);
    ouverteLe = monotone();
    source.addEventListener('instantane', recevoir((donnees) => etat.recevoirInstantane(donnees)));
    source.addEventListener('maj', recevoir((donnees) => etat.recevoirMaj(donnees)));
    source.addEventListener('menu', recevoir((donnees) => etat.recevoirMaj(donnees)));
    source.addEventListener('ping', recevoir(() => {}));
    source.addEventListener('error', surErreur(source));
  }

  return {
    demarrer: ouvrir,
    verifier() {
      const maintenant = monotone();
      if (maintenant - derniereReception > SILENCE_MAX_MS && maintenant - ouverteLe > SILENCE_MAX_MS) ouvrir();
    },
    silenceMs: () => monotone() - derniereReception,
    nonAppaire: () => nonAppaire,
    signalerNonAppaire() {
      nonAppaire = true;
    },
  };
}

async function lireJson(reponse) {
  try {
    return await reponse.json();
  } catch (err) {
    return null;
  }
}

export function creerClient({ requete, surNonAppaire, delaiMs = DELAI_POST_MS }) {
  // Résout en { reponse, donnees } (donnees lues dans le délai si corpsCompris, sinon undefined), ou rejette au bout
  // de delaiMs (et coupe la requête si le navigateur le permet).
  function avecDelai(chemin, options, corpsCompris) {
    const abandon = typeof AbortController === 'function' ? new AbortController() : null;
    let minuterie;
    const expiration = new Promise((_resoudre, rejeter) => {
      minuterie = setTimeout(() => {
        if (abandon) abandon.abort();
        rejeter(new Error('délai dépassé'));
      }, delaiMs);
    });
    const envoi = requete(chemin, abandon ? Object.assign({ signal: abandon.signal }, options) : options)
      .then((reponse) => (corpsCompris ? lireJson(reponse).then((donnees) => ({ reponse, donnees })) : { reponse }));
    return Promise.race([envoi, expiration]).then((resultat) => {
      clearTimeout(minuterie);
      return resultat;
    }, (err) => {
      clearTimeout(minuterie);
      throw err;
    });
  }

  async function envoyer(chemin, options, corpsCompris) {
    let resultat;
    try {
      resultat = await avecDelai(chemin, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, options), corpsCompris);
    } catch (err) {
      return {
        ok: false, statut: 0, message: SANS_REPONSE, code: null,
      };
    }
    const { reponse } = resultat;
    const donnees = corpsCompris ? resultat.donnees : await lireJson(reponse);
    if (reponse.ok) return { ok: true, donnees };
    if (reponse.status === NON_APPAIRE) surNonAppaire();
    const code = donnees && typeof donnees.erreur === 'string' ? donnees.erreur : null;
    if (MESSAGES[reponse.status]) return { ok: false, statut: reponse.status, message: MESSAGES[reponse.status], code };
    const detail = donnees && typeof donnees.message === 'string' ? ` (${donnees.message})` : '';
    const debut = reponse.status === ECHEC_MAISON ? 'La maison n\'a pas pu le faire' : 'Le serveur a refusé';
    return {
      ok: false, statut: reponse.status, message: `${debut}${detail}`, code,
    };
  }

  return {
    poster: (chemin, corps, entetes) => envoyer(chemin, {
      method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, entetes), body: JSON.stringify(corps || {}),
    }),
    lire: (chemin, entetes) => envoyer(chemin, entetes ? { method: 'GET', headers: Object.assign({}, entetes) } : { method: 'GET' }, true),
  };
}
