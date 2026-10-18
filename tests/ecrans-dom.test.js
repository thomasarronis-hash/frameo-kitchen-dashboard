// tests/ecrans-dom.test.js
//
// Rôle    : prouver, sur un faux DOM (tests/faux-dom.js), les chemins des écrans qui libèrent la mémoire du cadre (2 Go)
//           et le ffmpeg de go2rtc sur le M900, et les garanties écrites dans leurs en-têtes que les règles sans DOM ne
//           couvrent pas : mode Photos qui prépare sa première vue scène masquée et ne s'ouvre qu'une fois elle chargée
//           (jamais d'écran vide), remplace une image qui cale au bout de 20 s, décharge toutes ses images en sortant
//           (et à la fin d'une préparation) et refuse de s'ouvrir la nuit ou hors ligne ; routeur qui prévient l'écran quitté ; direct de la sonnette (vidéo demandée après l'accord de la
//           maison, arrêté en quittant l'écran Maison, jamais lancé en mode essai ni sans flux vidéo) ; écran Maison
//           retenu pendant un direct ; Wi-Fi invités masqué au bout de 2 min ; bandeau sonnette sans photo d'un autre
//           coup et sans « Voir le direct » sans vidéo ; télécommandes (appui long pour Veille et applis, messages
//           courts, mode essai dit à chaque geste, liste d'applis écrite).
// Entrées : faux DOM, faux client (poster, lire), horloges réglées par chaque test.
// Sorties : node --test.
// Pièges  : les promesses du faux client se résolvent en microtâches : laisserFinir() les vide avant de regarder.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appuyer, imagesChargees, installerFauxDom, lever, parClasse, poser, texte,
} from './faux-dom.js';

installerFauxDom();
const { creerBandeauSonnette } = await import('../web/src/composants/bandeau-sonnette.js');
const { creerPhotoSonnette } = await import('../web/src/composants/photo-sonnette.js');
const { creerMaison } = await import('../web/src/ecrans/maison.js');
const { creerPhotos } = await import('../web/src/ecrans/photos.js');
const { applisAffichees, creerTelecommande } = await import('../web/src/ecrans/maison-telecommandes.js');
const { creerSectionWifi } = await import('../web/src/ecrans/maison-wifi.js');
const { creerRouteur } = await import('../web/src/routeur.js');
const { DELAI_VIDEO_MS } = await import('../web/src/sonnette.js');

const ID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2026-10-14T17:41:00Z');

async function laisserFinir() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function fauxClient({ poster = { ok: true, donnees: { ok: true, simulation: false } }, lire = { ok: true, donnees: [] } } = {}) {
  const appels = [];
  return {
    appels,
    poster: (chemin, corps) => { appels.push(['POST', chemin, corps]); return Promise.resolve(poster); },
    lire: (chemin) => { appels.push(['GET', chemin]); return Promise.resolve(typeof lire === 'function' ? lire(chemin) : lire); },
  };
}

test('mode Photos : première vue préparée scène masquée, entrée seulement une fois chargée ; TOUTES les images déchargées par quitter()', async () => {
  const { conteneur } = installerFauxDom();
  let horloge = 0;
  const lot = [{ id: ID(1), portrait: false, legende: 'Annecy' }, { id: ID(2), portrait: true, legende: null }, { id: ID(3), portrait: true, legende: null }];
  const client = fauxClient({ lire: { ok: true, donnees: lot } });
  const photos = creerPhotos(conteneur, { client, monotone: () => horloge });
  photos.mettreAJour({ photos_configurees: true, entites: {}, pluie: null, menu: null }, T0);
  photos.entretenir();
  await laisserFinir();
  assert.equal(photos.pretes(), true, 'lot reçu');
  assert.deepEqual(imagesChargees(conteneur), [], 'sans préparation, aucune image demandée');
  assert.equal(photos.entrer({ nuit: false, enLigne: true }), false, 'aucune vue chargée : refus, l\'Accueil reste (constat du 14/10)');
  photos.entretenir({ preparer: true });
  const chargees = imagesChargees(conteneur);
  assert.equal(chargees.length, 1, 'une seule vue préparée');
  assert.equal(parClasse(conteneur, 'photos-ambiance')[0].hidden, true, 'préparée scène masquée');
  assert.equal(photos.vuePrete(), false);
  chargees.forEach((image) => image.declencher('load'));
  await laisserFinir();
  assert.equal(photos.vuePrete(), true);
  assert.deepEqual(parClasse(conteneur, 'photos-calque-visible'), [], 'aucune bascule hors du mode ambiant');
  assert.equal(photos.entrer({ nuit: false, enLigne: true }), true, 'mode ambiant ouvert');
  assert.equal(parClasse(conteneur, 'photos-ambiance')[0].hidden, false);
  assert.equal(parClasse(conteneur, 'photos-calque-visible').length, 1, 'la vue préparée est à l\'écran dès l\'entrée');
  horloge += 2000;
  photos.entretenir();
  assert.ok(imagesChargees(conteneur).length >= 1, 'une vue à l\'écran, la suivante en préparation');
  photos.quitter();
  assert.deepEqual(imagesChargees(conteneur), [], 'plus aucune image n\'a de src après quitter()');
  assert.equal(photos.ambiance(), false);
});

test('mode Photos : la nuit, hors ligne ou sans vue prête, entrer() refuse (faux) sans rien demander de plus ni afficher', async () => {
  const { conteneur } = installerFauxDom();
  const client = fauxClient({ lire: { ok: true, donnees: [{ id: ID(1), portrait: false, legende: null }] } });
  const photos = creerPhotos(conteneur, { client, monotone: () => 0 });
  assert.equal(photos.entrer({ nuit: false, enLigne: true }), false, 'lot pas encore reçu');
  photos.mettreAJour({ photos_configurees: true, entites: {}, pluie: null, menu: null }, T0);
  photos.entretenir();
  await laisserFinir();
  assert.equal(photos.entrer({ nuit: false, enLigne: true }), false, 'lot reçu mais vue pas préparée');
  assert.deepEqual(imagesChargees(conteneur), [], 'aucune image demandée');
  photos.entretenir({ preparer: true });
  imagesChargees(conteneur).forEach((image) => image.declencher('load'));
  await laisserFinir();
  assert.equal(photos.entrer({ nuit: true, enLigne: true }), false);
  assert.equal(photos.entrer({ nuit: false, enLigne: false }), false);
  assert.equal(imagesChargees(conteneur).length, 1, 'rien de plus que la vue préparée');
  assert.equal(photos.ambiance(), false);
  assert.equal(parClasse(conteneur, 'photos-ambiance')[0].hidden, true, 'rien à l\'écran');
  assert.equal(photos.entrer({ nuit: false, enLigne: true }), true, 'de jour, en ligne, vue chargée : le mode ambiant s\'ouvre');
});

test('mode Photos : fin de préparation sans entrée (un toucher, un empêchement) -> l\'image préparée est déchargée', async () => {
  const { conteneur } = installerFauxDom();
  const client = fauxClient({ lire: { ok: true, donnees: [{ id: ID(1), portrait: false, legende: null }, { id: ID(2), portrait: false, legende: null }] } });
  const photos = creerPhotos(conteneur, { client, monotone: () => 0 });
  photos.mettreAJour({ photos_configurees: true, entites: {}, pluie: null, menu: null }, T0);
  photos.entretenir();
  await laisserFinir();
  photos.entretenir({ preparer: true });
  assert.equal(imagesChargees(conteneur).length, 1);
  photos.entretenir({ preparer: false });
  assert.deepEqual(imagesChargees(conteneur), [], 'plus aucune image n\'a de src');
  assert.equal(photos.vuePrete(), false);
  photos.entretenir({ preparer: true });
  assert.equal(imagesChargees(conteneur)[0].src, `/api/photos/${ID(1)}.jpg`, 'préparation suivante : la même photo revient en tête');
});

test('mode Photos : image qui cale (ni load ni error, Wi-Fi du cadre du 14/10) -> son src est remplacé au bout de 20 s', async () => {
  const { conteneur } = installerFauxDom();
  let horloge = 0;
  const lot = [1, 2, 3].map((n) => ({ id: ID(n), portrait: false, legende: null }));
  const photos = creerPhotos(conteneur, { client: fauxClient({ lire: { ok: true, donnees: lot } }), monotone: () => horloge });
  photos.mettreAJour({ photos_configurees: true, entites: {}, pluie: null, menu: null }, T0);
  photos.entretenir();
  await laisserFinir();
  photos.entretenir({ preparer: true });
  const [calee] = imagesChargees(conteneur);
  assert.equal(calee.src, `/api/photos/${ID(1)}.jpg`);
  horloge = 19999;
  photos.entretenir({ preparer: true });
  assert.equal(calee.src, `/api/photos/${ID(1)}.jpg`, 'pas avant 20 s');
  horloge = 20000;
  photos.entretenir({ preparer: true });
  assert.deepEqual(imagesChargees(conteneur).map((image) => image.src), [`/api/photos/${ID(2)}.jpg`], 'la suivante remplace la photo calée (même <img> : changer src abandonne le transfert)');
  assert.equal(photos.vuePrete(), false);
  imagesChargees(conteneur).forEach((image) => image.declencher('load'));
  await laisserFinir();
  assert.equal(photos.vuePrete(), true);
  assert.equal(photos.entrer({ nuit: false, enLigne: true }), true);
});

test('routeur : Photos qui refuse de s\'ouvrir laisse l\'Accueil (plus de face « page » ni d\'entrée au menu)', () => {
  const quittes = [];
  const ecrans = {
    accueil: { racine: { hidden: false } },
    photos: { racine: { hidden: false }, entrer: () => false, quitter: () => quittes.push('photos') },
    maison: { racine: { hidden: false }, quitter: () => quittes.push('maison') },
  };
  const classes = new Set();
  const marques = [];
  const routeur = creerRouteur({
    ecrans,
    scene: { classList: { toggle: (nom, oui) => (oui ? classes.add(nom) : classes.delete(nom)) } },
    tiroir: { fermer() {} },
    menu: { marquerActif: (nom) => marques.push(nom) },
    recetteOuverte: () => false,
  });
  routeur.afficher('maison');
  routeur.afficher('photos', { nuit: true, enLigne: true });
  assert.equal(routeur.actif(), 'accueil');
  assert.deepEqual([ecrans.accueil.racine.hidden, ecrans.photos.racine.hidden, ecrans.maison.racine.hidden], [false, true, true]);
  assert.ok(!classes.has('scene-photos'), 'le menu reste');
  assert.deepEqual(quittes, ['maison']);
  assert.equal(marques[marques.length - 1], 'accueil');
});

test('routeur : l\'écran quitté est prévenu (Photos décharge ses images), entrer reçoit le contexte, recette ouverte : tout masqué', () => {
  const journal = [];
  const ecran = (nom, ambiant) => ({
    racine: { hidden: false },
    entrer: (contexte) => { journal.push(`entrer ${nom} ${JSON.stringify(contexte)}`); return ambiant; },
    quitter: () => journal.push(`quitter ${nom}`),
  });
  const ecrans = { accueil: { racine: { hidden: false } }, photos: ecran('photos', true), maison: ecran('maison') };
  const classes = new Set();
  let recette = false;
  const routeur = creerRouteur({
    ecrans,
    scene: { classList: { toggle: (nom, oui) => (oui ? classes.add(nom) : classes.delete(nom)) } },
    tiroir: { fermer: () => journal.push('tiroir fermé') },
    menu: { marquerActif: (nom) => journal.push(`menu ${nom}`) },
    recetteOuverte: () => recette,
  });
  routeur.afficher('photos', { nuit: false, enLigne: true });
  assert.ok(classes.has('scene-photos'));
  assert.deepEqual([ecrans.accueil.racine.hidden, ecrans.photos.racine.hidden], [true, false]);
  routeur.afficher('accueil');
  assert.ok(!classes.has('scene-photos'));
  routeur.afficher('maison');
  routeur.afficher('maison');
  routeur.afficher('accueil');
  assert.deepEqual(journal, [
    'entrer photos {"nuit":false,"enLigne":true}', 'tiroir fermé', 'menu photos',
    'quitter photos', 'menu accueil',
    'entrer maison {}', 'menu maison', 'entrer maison {}', 'menu maison',
    'quitter maison', 'menu accueil',
  ]);
  recette = true;
  routeur.rafraichir();
  assert.ok(Object.values(ecrans).every((e) => e.racine.hidden), 'recette ouverte : tous les écrans masqués');
});

function donneesMaison(directVideo, sonnette = { dernier_coup: null, photo: 'inconnue', photo_le: null }) {
  return {
    entites: {}, simulation_maison: false, direct_video: directVideo, sonnette,
  };
}

test('direct : action d\'abord, vidéo seulement après l\'accord (+3 s) ; Maison retenue pendant le direct ; quitter() l\'arrête et retire la vidéo', async () => {
  const { conteneur } = installerFauxDom();
  let ms = T0;
  const client = fauxClient();
  const maison = creerMaison(conteneur, { client, monotone: () => ms, maintenant: () => ms });
  maison.entrer();
  maison.mettreAJour(donneesMaison(true), ms);
  maison.lancerDirect(ms);
  const video = parClasse(conteneur, 'sonnette-video')[0];
  assert.equal(video.hasAttribute('src'), false, 'pas de vidéo avant la réponse de la maison');
  assert.equal(maison.retenu(ms), true, 'retenu dès le lancement');
  await laisserFinir();
  assert.deepEqual(client.appels.filter((a) => a[0] === 'POST'), [['POST', '/api/action/sonnette_direct', {}]]);
  maison.entretenir(ms + DELAI_VIDEO_MS - 1);
  assert.equal(video.hasAttribute('src'), false, 'le flux P2P s\'ouvre');
  ms += DELAI_VIDEO_MS;
  maison.entretenir(ms);
  assert.equal(video.getAttribute('src'), `/api/sonnette.mjpeg?n=${T0}-1`);
  video.declencher('load');
  assert.equal(video.hidden, false, 'première image : la vidéo se montre');
  maison.quitter();
  assert.equal(video.hasAttribute('src'), false, 'quitter l\'écran ferme la connexion MJPEG');
  assert.equal(maison.retenu(ms), false, 'plus de direct');
});

test('direct : en mode essai rien n\'est demandé à go2rtc ; sans flux vidéo, pas de bouton ni d\'action', async () => {
  const { conteneur } = installerFauxDom();
  const ms = T0;
  const essai = fauxClient({ poster: { ok: true, donnees: { ok: true, simulation: true } } });
  const maison = creerMaison(conteneur, { client: essai, monotone: () => ms, maintenant: () => ms });
  maison.entrer();
  maison.mettreAJour(donneesMaison(true), ms);
  maison.lancerDirect(ms);
  await laisserFinir();
  maison.entretenir(ms + DELAI_VIDEO_MS + 1000);
  assert.equal(parClasse(conteneur, 'sonnette-video')[0].hasAttribute('src'), false);
  assert.equal(texte(parClasse(conteneur, 'sonnette-message')[0]), 'Mode essai : le direct n\'est pas lancé.');
  assert.equal(maison.retenu(ms + 5000), false);

  const autre = installerFauxDom();
  const sansVideo = fauxClient();
  const maison2 = creerMaison(autre.conteneur, { client: sansVideo, monotone: () => ms, maintenant: () => ms });
  maison2.mettreAJour(donneesMaison(false), ms);
  assert.equal(parClasse(autre.conteneur, 'sonnette-lancer')[0].hidden, true, '« Voir le direct » masqué');
  maison2.lancerDirect(ms);
  await laisserFinir();
  assert.deepEqual(sansVideo.appels, [], 'aucune action, aucune vidéo');
});

test('Wi-Fi invités : affiché au toucher (écran retenu), masqué au bout de 2 min (texte, mot de passe et QR effacés)', async () => {
  const { conteneur } = installerFauxDom();
  let horloge = 1000;
  const client = fauxClient({ lire: { ok: true, donnees: { configure: true, ssid: 'Freebox-EXEMPLE', mot_de_passe: 'lI1O0o-2026', chaine_qr: 'WIFI:T:WPA;S:Freebox-EXEMPLE;P:lI1O0o-2026;;' } } });
  const wifi = creerSectionWifi(conteneur, { client, monotone: () => horloge });
  appuyer(parClasse(conteneur, 'wifi-afficher')[0]);
  await laisserFinir();
  assert.equal(wifi.affiche(), true);
  const mdp = parClasse(conteneur, 'wifi-mdp')[0];
  assert.equal(texte(mdp), 'lI1O0o-2026');
  assert.deepEqual(parClasse(mdp, 'wifi-mdp-chiffres').map(texte), ['1', '0', '2026'], 'chiffres d\'une autre couleur');
  assert.ok(parClasse(conteneur, 'qr-modules')[0].getAttribute('d').length > 100);
  horloge += 120000 - 1;
  wifi.entretenir();
  assert.equal(wifi.affiche(), true);
  horloge += 1;
  wifi.entretenir();
  assert.equal(wifi.affiche(), false, 'masqué au bout de 2 min');
  assert.equal(texte(mdp), '');
  assert.equal(texte(parClasse(conteneur, 'wifi-ssid')[0]), '');
  assert.equal(parClasse(conteneur, 'qr-modules')[0].getAttribute('d'), '');
});

test('Wi-Fi invités pas configuré : une phrase pour la famille, ni chemin ni fichier', async () => {
  const { conteneur } = installerFauxDom();
  const client = fauxClient({ lire: { ok: true, donnees: { configure: false, probleme: 'ssid : 1 à 32 octets' } } });
  creerSectionWifi(conteneur, { client, monotone: () => 0 });
  appuyer(parClasse(conteneur, 'wifi-afficher')[0]);
  await laisserFinir();
  const carte = parClasse(conteneur, 'wifi-configurer')[0];
  assert.equal(carte.hidden, false);
  assert.match(texte(carte), /pas encore prêt.*À préparer sur le serveur/);
  assert.doesNotMatch(texte(carte), /M900|secrets|json|ssid|600/);
});

test('photo de la sonnette : vider() et annoncer() retirent toute image ; le bandeau ne montre que la photo de son coup', () => {
  const { conteneur } = installerFauxDom();
  const photo = creerPhotoSonnette(conteneur, 'essai');
  photo.afficher('/api/sonnette.jpg?n=1');
  assert.equal(imagesChargees(conteneur).length, 1);
  photo.vider();
  assert.deepEqual(imagesChargees(conteneur), []);
  photo.afficher('/api/sonnette.jpg?n=2');
  photo.annoncer('Photo en cours…');
  assert.deepEqual(imagesChargees(conteneur), []);

  const bandeauDom = installerFauxDom();
  let direct = 0;
  const bandeau = creerBandeauSonnette(bandeauDom.conteneur, { voirDirect: () => { direct += 1; } });
  bandeau.mettreAJour({
    texte: 'On a sonné · 19:41', photo: null, legende: 'Photo en cours…', direct: false,
  });
  assert.deepEqual(imagesChargees(bandeauDom.conteneur), [], 'aucune image tant que la photo du coup n\'est pas là');
  const bouton = parClasse(bandeauDom.conteneur, 'sonnette-voir')[0];
  assert.equal(bouton.hidden, true, 'sans vidéo, pas de « Voir le direct »');
  assert.equal(bandeau.contient(bouton), false, 'un toucher à sa place masque le bandeau');
  bandeau.mettreAJour({
    texte: 'On a sonné · 19:41', photo: '/api/sonnette.jpg?n=9', legende: 'Photo de 19:41', direct: true,
  });
  assert.equal(imagesChargees(bandeauDom.conteneur).length, 1);
  assert.equal(bandeau.contient(bouton), true);
  bandeau.mettreAJour(null);
  assert.deepEqual(imagesChargees(bandeauDom.conteneur), [], 'bandeau masqué : photo vidée');
  assert.equal(direct, 0);
});

test('télécommande : Veille et applis à l\'appui long seulement, un toucher court ne fait que l\'expliquer ; mode essai dit à chaque geste', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { conteneur } = installerFauxDom();
  const client = fauxClient({ poster: { ok: true, donnees: { ok: true, simulation: true } } });
  const telecommande = creerTelecommande(conteneur, { modele: 'appletv', envoyer: client.poster, monotone: () => 0 });
  telecommande.mettreAJour({ etat: 'Apple TV : lecture en cours', joignable: true, applis: ['App Store', 'Réglages', 'YouTube', 'Netflix', 'Ordinateurs'] });
  const appli = parClasse(conteneur, 'appli');
  assert.deepEqual(appli.map(texte), ['Netflix', 'YouTube'], 'seules les applis de la liste écrite, dans son ordre');
  const veille = parClasse(conteneur, 'touche-veille')[0];
  appuyer(veille);
  await laisserFinir();
  assert.deepEqual(client.appels, [], 'toucher court sur Veille : rien n\'est envoyé');
  assert.equal(texte(parClasse(conteneur, 'telecommande-message')[0]), 'Garder le doigt 1 seconde');
  poser(appli[1]);
  t.mock.timers.tick(1000);
  lever(appli[1]);
  await laisserFinir();
  assert.deepEqual(client.appels, [['POST', '/api/action/appletv_appli', { source: 'YouTube' }]]);
  assert.equal(texte(parClasse(conteneur, 'telecommande-message')[0]), 'Essai : touche non envoyée');
  assert.equal(texte(parClasse(conteneur, 'touche-accueil')[0]), 'Menu TV', 'pas « Accueil », nom de l\'entrée du menu du cadre');
});

test('télécommande : un échec dit simplement « L\'Apple TV ne répond pas », jamais le service HA ; une seule ligne avec l\'alerte', async () => {
  const { conteneur } = installerFauxDom();
  const client = fauxClient({ poster: { ok: false, statut: 502, message: 'La maison n\'a pas pu le faire (remote.send_command : Home Assistant non connecté)' } });
  const telecommande = creerTelecommande(conteneur, { modele: 'appletv', envoyer: client.poster, monotone: () => 0 });
  telecommande.mettreAJour({ etat: 'Apple TV : injoignable', joignable: false, applis: [] });
  const alerte = parClasse(conteneur, 'telecommande-alerte')[0];
  const message = parClasse(conteneur, 'telecommande-message')[0];
  assert.equal(alerte.hidden, false);
  appuyer(parClasse(conteneur, 'touche-haut')[0]);
  await laisserFinir();
  assert.equal(texte(message), 'L\'Apple TV ne répond pas');
  assert.deepEqual([message.hidden, alerte.hidden], [false, true], 'le message prend la place de l\'alerte, sur la même ligne');
  assert.deepEqual(applisAffichees(['YouTube', 'Arcade']), ['YouTube']);
});
