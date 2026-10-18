// serveur/ha/sonnette.js
//
// Rôle    : suivre les coups de sonnette vus par le serveur et dire de quand date la photo de la sonnette. HA ne
//           réécrit camera.sonnette_derniere_photo que 7 à 20 s après la sonnerie (automatisation de la sonnette), et
//           parfois pas du tout : sans ce suivi, le bandeau « On a sonné » montrait la photo d'un visiteur précédent.
// Entrées : new SourceSonnette({ photo, entites, journal, maintenant, pasMs, attenteMs }) : photo, le lecteur de
//           serveur/ha/photo-sonnette.js (lire()) ; SourceEntites (événement 'maj' : binary_sensor.doorbell_ringing) ;
//           horloge (Date.now) ; pas de relecture de la photo après un coup (3 s) et attente maximale de la nouvelle
//           photo (45 s).
// Sorties : valeur { dernier_coup, photo, photo_le } et l'événement 'maj' quand elle change (flux SSE, clé sonnette) :
//           - dernier_coup : le last_changed de HA du dernier passage à on VU par le serveur depuis son démarrage, ou
//             null (la page dit alors seulement « dernier changement ») ;
//           - photo : « inconnue » (aucun coup récent vu : on ne sait pas de quand date la photo), « en_cours » (coup
//             vu, nouvelle photo attendue), « du_coup » (la photo a changé après le dernier coup), « avant_coup » (pas
//             de nouvelle photo dans les 45 s : celle de HA date d'avant ce coup) ;
//           - photo_le : quand le serveur a vu la nouvelle photo (ISO 8601, à 3 s près), ou null ;
//           lire() : la photo comme photo.lire() le rend, en notant au passage si elle a changé (GET /api/sonnette.jpg
//           passe par ici) ; demarrer(), arreter().
// Pièges  :
//   - Seul un passage à on avec un last_changed jamais vu est un coup de sonnette : le last_changed d'un état off
//     peut venir d'un redémarrage de HA ou du pont Eufy (unavailable vers off, conception §0.1). Un on plus vieux
//     que 2 min (premier état reçu au démarrage) est noté sans attente de photo (« inconnue »).
//   - L'empreinte (SHA-256) de la photo est lue tout de suite au coup, puis relue toutes les 3 s jusqu'à ce qu'elle
//     change, 45 s au plus. D'après la fiche du M900 : 2 s, ouverture du P2P jusqu'à 12 s, 4 s, puis capture gardée
//     seulement au-delà de 60 Ko ; notre première lecture précède donc la nouvelle photo [S : jamais mesuré sur une
//     vraie sonnerie]. Une première lecture ratée (HA lent) : la première réussie sert de référence.
//   - Une photo qui arrive après les 45 s est vue à la lecture suivante (onglet Sonnette, une par minute) : elle passe
//     alors en « du_coup ».
//   - Un nouveau coup pendant l'attente la relance (numéro de cycle : une seule boucle de relecture à la fois).
//   - Lectures en REST seulement (camera_proxy, déjà permise, serveur/ha/photo-sonnette.js) : rien n'est écrit. Une
//     lecture qui échoue est réessayée au pas suivant, sans bruit dans le journal au-delà d'un avertissement.

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const SONNERIE = 'binary_sensor.doorbell_ringing';
const PAS_MS = 3000;
const ATTENTE_MS = 45000;
const COUP_RECENT_MS = 120000;

const empreinte = (octets) => createHash('sha256').update(octets).digest('hex');

export class SourceSonnette extends EventEmitter {
  #photo;
  #entites;
  #journal;
  #maintenant;
  #pasMs;
  #attenteMs;
  #valeur = { dernier_coup: null, photo: 'inconnue', photo_le: null };
  #vu = null;
  #reference = null;
  #attenteJusqua = null;
  #cycle = 0;
  #minuteur = null;

  constructor({
    photo, entites, journal, maintenant = Date.now, pasMs = PAS_MS, attenteMs = ATTENTE_MS,
  }) {
    super();
    this.#photo = photo;
    this.#entites = entites;
    this.#journal = journal;
    this.#maintenant = maintenant;
    this.#pasMs = pasMs;
    this.#attenteMs = attenteMs;
  }

  get valeur() {
    return this.#valeur;
  }

  demarrer() {
    this.#entites.on('maj', (fragment) => {
      if (fragment[SONNERIE]) this.#observer(fragment[SONNERIE]);
    });
  }

  arreter() {
    this.#cycle += 1;
    this.#attenteJusqua = null;
    clearTimeout(this.#minuteur);
  }

  async lire() {
    const resultat = await this.#photo.lire();
    this.#noter(empreinte(resultat.octets));
    return resultat;
  }

  #publier(changement) {
    const valeur = { ...this.#valeur, ...changement };
    if (JSON.stringify(valeur) === JSON.stringify(this.#valeur)) return;
    this.#valeur = valeur;
    this.emit('maj', valeur);
  }

  #observer(entite) {
    if (entite.state !== 'on' || entite.last_changed === this.#vu) return;
    this.#vu = entite.last_changed;
    const quand = Date.parse(entite.last_changed);
    this.#cycle += 1;
    clearTimeout(this.#minuteur);
    if (!Number.isFinite(quand) || this.#maintenant() - quand > COUP_RECENT_MS) {
      this.#attenteJusqua = null;
      this.#publier({ dernier_coup: entite.last_changed, photo: 'inconnue', photo_le: null });
      return;
    }
    this.#reference = null;
    this.#attenteJusqua = this.#maintenant() + this.#attenteMs;
    this.#publier({ dernier_coup: entite.last_changed, photo: 'en_cours', photo_le: null });
    this.#relire(this.#cycle);
  }

  async #relire(cycle) {
    try {
      await this.lire();
    } catch (err) {
      this.#journal.warn(`sonnette : photo illisible pendant l'attente (${err.message})`);
    }
    if (cycle !== this.#cycle || this.#attenteJusqua === null) return;
    if (this.#maintenant() >= this.#attenteJusqua) {
      this.#attenteJusqua = null;
      this.#publier({ photo: 'avant_coup' });
      return;
    }
    this.#minuteur = setTimeout(() => this.#relire(cycle), this.#pasMs);
    this.#minuteur.unref();
  }

  // Empreinte de chaque photo lue : pendant l'attente, la première sert de référence et la suivante qui diffère est la
  // photo du coup ; après une attente sans nouvelle photo, une photo différente est une photo tardive du même coup.
  #noter(lue) {
    const attente = this.#attenteJusqua !== null;
    if (attente && this.#reference === null) {
      this.#reference = lue;
      return;
    }
    const tardive = this.#valeur.photo === 'avant_coup' && this.#reference !== null;
    if ((attente || tardive) && lue !== this.#reference) {
      this.#attenteJusqua = null;
      this.#cycle += 1;
      clearTimeout(this.#minuteur);
      this.#publier({ photo: 'du_coup', photo_le: new Date(this.#maintenant()).toISOString() });
    }
  }
}
