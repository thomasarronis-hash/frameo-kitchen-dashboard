// serveur/sources/menus.js
//
// Rôle    : le menu de la semaine du cadre : lit le dossier des menus publiés (data/menus, rempli par
//           outils/cadre.mjs publier), revalide chaque fichier, retient celui dont le cycle couvre aujourd'hui
//           (heure de Paris) et le pousse dans le flux (clé menu de l'instantané, événement menu).
// Entrées : new SourceMenus({ dossier, journal, maintenant }) ; maintenant() -> Date, l'horloge (remplacée
//           dans les tests).
// Sorties : SourceMenus (socle Source) : valeur = le menu retenu tel que publié (partage/schema-menu-v1.json),
//           ou null (« Menu pas encore publié ») ; événement 'maj' quand il change ; demarrer(), arreter() ;
//           choisirMenu(menus, aujourdhui), pour les tests.
// Pièges  :
//   - Plusieurs fichiers valides couvrent aujourd'hui : le plus récent par maj_le, comparé en instants (les
//     décalages horaires des deux textes peuvent différer), puis par nom de fichier.
//   - Fichier invalide (JSON illisible, plus de 1 Mo, schéma ou règles de partage/valider-menu.js) : ignoré et
//     journalisé une fois par version du fichier. S'il remplace une version valide déjà lue (republication
//     ratée sous le même nom), cette dernière version valide reste retenue jusqu'au redémarrage du serveur.
//   - Seuls les *.json dont le nom ne commence pas par un point sont lus : rsync (et cadre.mjs en local)
//     écrit dans un fichier caché puis le renomme, un fichier à moitié écrit n'est donc jamais lu.
//   - Un fichier n'est relu que si sa date de modification ou sa taille change : le sondage coûte peu.
//   - Surveillance : fs.watch du dossier pour réagir en moins d'une seconde, PLUS un sondage toutes les 60 s
//     quoi qu'il arrive (fs.watch peut manquer des événements ou échouer sur un dossier absent) ; le sondage
//     relance la surveillance tombée et voit aussi le changement de jour (minuit à Paris).
//   - Dossier absent : aucun menu, journalisé une fois ; ce n'est pas une erreur (il peut arriver plus tard).

import { watch } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validerMenu } from '../../partage/valider-menu.js';
import { dateParis } from '../heure-paris.js';
import { Source } from '../source.js';

const INTERVALLE_SONDAGE_MS = 60_000;
const DELAI_REGROUPEMENT_MS = 200;
const TAILLE_MAX_OCTETS = 1024 * 1024;

// menus : [{ nom, menu }] valides ; aujourdhui : « AAAA-MM-JJ » à Paris.
export function choisirMenu(menus, aujourdhui) {
  const couvrants = menus.filter(({ menu }) => menu.cycle.debut <= aujourdhui && aujourdhui <= menu.cycle.fin);
  couvrants.sort((a, b) => Date.parse(b.menu.maj_le) - Date.parse(a.menu.maj_le) || b.nom.localeCompare(a.nom));
  return couvrants.length > 0 ? couvrants[0].menu : null;
}

async function analyser(chemin, taille) {
  if (taille > TAILLE_MAX_OCTETS) return { menu: null, erreurs: [`${taille} octets, 1 Mo au plus`] };
  let donnees;
  try {
    donnees = JSON.parse(await readFile(chemin, 'utf8'));
  } catch (err) {
    return { menu: null, erreurs: [`fichier illisible ou JSON invalide (${err.message})`] };
  }
  const { valide, erreurs } = validerMenu(donnees);
  return valide ? { menu: donnees, erreurs } : { menu: null, erreurs };
}

export class SourceMenus extends Source {
  #dossier;
  #maintenant;
  #fichiers = new Map();
  #surveillance = null;
  #regroupement = null;
  #dossierAbsent = false;
  #arrete = false;

  constructor({ dossier, journal, maintenant = () => new Date() }) {
    super('menus', journal);
    this.#dossier = dossier;
    this.#maintenant = maintenant;
  }

  demarrer() {
    this.actualiser();
    this.repeter(INTERVALLE_SONDAGE_MS);
  }

  arreter() {
    this.#arrete = true;
    super.arreter();
    clearTimeout(this.#regroupement);
    if (this.#surveillance) this.#surveillance.close();
  }

  async lire() {
    this.#surveiller();
    const noms = await this.#lister();
    for (const nom of this.#fichiers.keys()) {
      if (!noms.includes(nom)) this.#fichiers.delete(nom);
    }
    for (const nom of noms) await this.#relire(nom);
    const valides = [...this.#fichiers].filter(([, fichier]) => fichier.menu).map(([nom, { menu }]) => ({ nom, menu }));
    return choisirMenu(valides, dateParis(this.#maintenant()));
  }

  async #lister() {
    try {
      const noms = (await readdir(this.#dossier)).filter((nom) => nom.endsWith('.json') && !nom.startsWith('.')).sort();
      this.#dossierAbsent = false;
      return noms;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (!this.#dossierAbsent) this.journal.info(`menus : dossier ${this.#dossier} absent, aucun menu tant qu'il n'existe pas`);
      this.#dossierAbsent = true;
      return [];
    }
  }

  async #relire(nom) {
    const chemin = join(this.#dossier, nom);
    let infos;
    try {
      infos = await stat(chemin);
    } catch {
      return;
    }
    const empreinte = `${infos.mtimeMs}:${infos.size}`;
    const connu = this.#fichiers.get(nom);
    if (connu && connu.empreinte === empreinte) return;
    const { menu, erreurs } = await analyser(chemin, infos.size);
    if (menu) {
      this.#fichiers.set(nom, { empreinte, menu });
      this.journal.info(`menus : ${nom} lu (du ${menu.cycle.debut} au ${menu.cycle.fin}, statut ${menu.statut})`);
      return;
    }
    const garde = connu ? connu.menu : null;
    this.#fichiers.set(nom, { empreinte, menu: garde });
    this.journal.warn(`menus : ${nom} ignoré, invalide${garde ? ' (sa dernière version valide reste retenue)' : ''} : ${erreurs.join(' ; ')}`);
  }

  #surveiller() {
    if (this.#surveillance || this.#arrete) return;
    try {
      this.#surveillance = watch(this.#dossier, { persistent: false }, () => {
        clearTimeout(this.#regroupement);
        this.#regroupement = setTimeout(() => this.actualiser(), DELAI_REGROUPEMENT_MS);
        this.#regroupement.unref();
      });
      this.#surveillance.on('error', () => {
        this.#surveillance.close();
        this.#surveillance = null;
      });
    } catch {
      this.#surveillance = null;
    }
  }
}
