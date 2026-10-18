# Le cadre de la cuisine : relevé du jour J et décision

Relevé du mardi 13/10/2026, cadre branché en USB-C sur le Clevo, sans Wi-Fi. Sources : `outils/identifier-cadre.sh`
et `web/compat/compat.html` (relevés bruts dans `docs/releves/`, non versionnés, sans numéro de série ici).

## Décision : GO, le cadre est gardé

Tous les tests décisifs passent : installation de l'APK, kiosque comme écran d'accueil après redémarrage et après
une coupure de courant, son sans geste, fluidité, mémoire, clavier, sortie à deux doigts, ADB par câble permanent.
Date limite de retour : 30 jours d'après la fiche Amazon (environ le 12/11), sans objet désormais.

## Matériel et système

| | Relevé |
|---|---|
| Modèle | « AVE-V5 Max » (Apveelveer 15,6" Frameo), fabricant Rockchip |
| Puce | Rockchip RK3326 (`ro.board.platform`), espace utilisateur `armeabi-v7a` |
| Android | 9 (SDK 28), build `user`, `release-keys`, compilé le 10/08/2026 |
| RAM réelle | 2 028 336 kB (2 Go, conforme à la fiche) |
| Écran | 1920 x 1080 physique, densité 240 ; la WebView voit 1920 x 1080 CSS (`devicePixelRatio` 1,5) |
| Tactile | `gsl3673` : **deux doigts au plus en pratique** (relevé brut de `/dev/input/event2` du 14/10 : 4 essais à trois doigts, deux vus au plus), malgré 10 emplacements annoncés |
| Capteurs | accéléromètre seul : **ni capteur de lumière, ni détecteur de présence** |
| Son | haut-parleur intégré (grilles au dos), volume média piloté par le pont |
| Root | non : shell ADB en uid 2000, `ro.debuggable=0`, `ro.secure=1`, `ro.adb.secure=1` |
| SELinux | **permissif** (voir « Port USB ») |
| Alimentation | **secteur obligatoire** : sur le seul port USB du Clevo, le rétroéclairage scintille (sous-alimentation) |
| Horloge | fausse après un redémarrage sans réseau : le tableau de bord prend l'heure du serveur (`heure_serveur`) |

## Logiciel

| | Relevé |
|---|---|
| WebView | `com.google.android.webview` **125.0.6422.3** (Chrome 125) |
| Frameo | `net.frameo.frame` v1.31.18, appli système privilégiée, **version d'usine** (aucune mise à jour installée : pas de retour possible vers 1.24) |
| Mise à jour système | `android.rockchip.update.service` (RKUpdateService) présent |
| Gestionnaire d'appareil | aucun (pas de device owner) |
| Clavier | LatinIME (AOSP), accents corrects |
| Lanceur d'origine | `net.frameo.frame/.ui.activities.AWaitForDeferredInitCompleted` |

## compat.html (rapport du 13/10 17:19)

- CSS et JS modernes : tout est supporté (backdrop-filter, `:has`, gap en flex, `?.`, `??`, Intl `Europe/Paris`,
  EventSource, localStorage, `font-variation-settings`).
- Fondu de 2 s entre deux images 1920 x 1080 : 37 FPS sans pastille, 35 FPS sous 3 pastilles teintées, **16 FPS sous
  3 pastilles floutées** : réglage `verre` = **teinte**.
- Son : bip WebAudio et `<audio>` joués 3 s après un rechargement, sans toucher ; entendus aussi au toucher.
- Pont Kiosk présent : `setVolume(80)`, `getVolume()` = 80 %, `setBrightness` accepté.
- Clavier : « Crème fraîche » saisi avec ses accents.
- Diaporama de 10 min (92 images) sans plantage. Mémoire de l'appli : 339 puis 369 Mo pendant, 205 Mo après ;
  1,3 Go libre sur l'appareil tout du long.
- Aucune erreur JavaScript.

## Lanceur

`cmd package set-home-activity fr.arronis.cuisine/.MainActivity` répond `Success`. Au premier redémarrage, Android
demande quelle appli d'accueil utiliser : « Cuisine », puis « Toujours ». Ce choix tient ensuite aux redémarrages et
aux coupures de courant. Frameo 1.31.18 ne bloque pas le remplacement (contrairement à ce que craignait la doc
d'ImmichFrame pour les versions 1.29 et plus).

## Port USB et ADB

- Le script du fabricant `/system/bin/hostotg.sh`, lancé à `sys.boot_completed`, efface `persist.sys.otgmod`, puis
  toutes les 3 s : si `sys.usb.config` vaut `adb`, il passe le port USB-C en **mode hôte** (lecture de clé USB) ; s'il
  vaut `ptp,adb`, en **mode appareil**. D'où l'ADB visible 12 s au démarrage puis perdu. Frameo repassait en `ptp,adb`
  avec « Activer le transfert depuis l'ordinateur » ; l'accès ADB de Frameo ne survit pas à un redémarrage.
- Cette version d'Android n'a pas l'option « Configuration USB par défaut » dans les options pour les développeurs.
- Solution : avec `persist.sys.otgmod` à 0, le script laisse le port en mode appareil. Testé depuis le shell
  (`sys.usb.config` repassé à `adb`, port resté en `otg`), puis intégré au kiosque (`PortUsb.java`) : 20 s après son
  lancement, il repose la propriété et la revérifie chaque minute. Après redémarrage : ADB perdu à +27 s, revenu à
  +54 s, puis stable.
- Ce `setprop` depuis une appli ordinaire ne marche que parce que SELinux est permissif.
- En mode `ptp`, KDE montre le cadre comme un disque (appareil photo) : sans importance.

## Installation M2 (13/10)

- APK recompilé avec `ORIGINE=http://192.168.1.187:8020`, installé par `adb install -r`, écran d'accueil remis
  ensuite (la mise à jour l'avait fait retomber sur Frameo). Clé `cle_cadre` transmise par l'alias `ReglageAdb`.
- Wi-Fi de la maison (2,4 GHz) en DHCP. Tableau de bord affiché avec les vraies données, heure
  juste (heure du serveur).
- Redémarrage complet : page de secours le temps du Wi-Fi, puis tableau de bord seul, en moins de 2 min.
- **MAC Wi-Fi aléatoire à chaque démarrage** (`5e:80:…` puis `1a:f6:…`) : pas de contrôle parental ni de bail fixe
  possibles sur la Freebox.
- **Coupure d'Internet abandonnée** : l'IP fixe sans passerelle fait perdre la route du réseau local (cette version
  d'Android envoie alors tout vers la passerelle), et l'IPv6 publique donnée par la Freebox passe de toute façon. À
  la place, avec l'accord de Thomas : `pm disable-user` de `net.frameo.frame` et `android.rockchip.update.service`
  (réversible par `pm enable`). Plus rien sur le cadre ne se sert d'Internet.
- Reste : fixation au mur (non annoncée, à voir au dos), prise secteur à proximité, port USB-C accessible.

## Wi-Fi qui décroche par moments (14/10)

- Puce Wi-Fi **Rockchip RK915** (SDIO, module `rk915`, 2,4 GHz seulement), sur le canal 1 de la Freebox. Signal bon
  (RSSI -49 dBm, 65 Mb/s), mais des pertes par épisodes : le 14/10 de 14 h 26 à 14 h 34 environ, 25 à 50 % de pertes
  sur les petits pings depuis le M900 et 100 % au-delà de 1 000 octets ; quelques minutes plus tard, 0 à 7 % à toutes
  les cadences. Une transmission TCP du M900 restait alors sans accusé de réception (100 Ko en attente, 7 renvois) :
  la photo n'arrivait jamais, et le cadre ne voyait pas non plus la coupure faite par le serveur.
- Pas de réglage possible sans root : `cmd wifi` est refusé au shell ADB, les paramètres du module sont réservés à
  root, l'économie d'énergie Wi-Fi n'est pas pilotable.
- Déclencheur probable : deux décrochages sur deux observés ont commencé dans la seconde qui suivait une photo reçue
  d'un bloc (environ 40 Mbit/s depuis le M900 filaire ; 14 h 26 min 43 s, une photo ; 14 h 54 min 28 s, une paire),
  après une heure de pings parfaits. Le noyau ne journalise rien (`dmesg` lisible par le shell, rien du module
  `rk915`). Parade côté serveur : photos relayées à 256 Ko/s en morceaux de 4 Ko (`serveur/cadence.js`).
- Parade dans la page (pas dans le réseau) : une photo qui ne vient pas en 20 s est remplacée, le mode Photos ne
  s'ouvre qu'avec une première photo chargée (l'Accueil reste sinon), et les lectures de la page sont abandonnées au
  bout de 10 s même quand le corps cale après les en-têtes. Le blocage de la page sur « / » après le déploiement du
  14/10 (réponse 304 jamais finie) venait sans doute du même décrochage, pas d'un cache abîmé.
- Pour mesurer : `ping -D -O -i 1 -s 1000 <IP du cadre>` depuis le M900 (filaire), les lignes « no answer » datent
  les trous.

### Remise à zéro automatique du Wi-Fi (kiosque, 14/10)

- Remède constaté le 14/10 pendant un décrochage : `adb shell svc wifi disable` puis `svc wifi enable`, lien parfait
  6 s après, même MAC, même IP. Le kiosque le fait seul : `ChienWifi.java` (Android, HTTP) et `RadioWifi.java`
  (appels au Wi-Fi) ; règle de décision dans `RegleWifi.java` et déroulé d'une remise dans `RemiseWifi.java`, toutes
  deux pures et vérifiées par `kiosque/build.sh` avant chaque construction.
- Un seul chien par processus du kiosque : une recréation de l'écran (police ou langue changée dans les Réglages)
  n'oublie ni les échecs ni l'espacement. Pas de chien avec une origine en boucle locale (`127.0.0.1`, `localhost` :
  jour J, la sonde passerait par le câble USB) ; logcat dit alors « non démarré ».
- Dès le démarrage, puis 30 s après la fin de chaque passage, si le Wi-Fi est activé et connecté : GET de
  `<ORIGINE>/sonde.bin` (4 Kio, `web/public/sonde.bin`), 10 s pour la connexion, 10 s pour les en-têtes, 10 s pour
  tout le corps, taille vérifiée.
  - **2 échecs de suite** (environ 1 min) : Wi-Fi coupé (`WifiManager.setWifiEnabled(false)`, attente de la coupure,
    5 s au plus), 1 s de pause, puis rallumé et constaté allumé (10 s au plus). Le rallumage part toujours, même si
    la coupure n'a pas été constatée.
  - **Au plus une remise toutes les 5 min** ; après **3 remises sans un seul succès** entre elles (serveur arrêté
    plutôt que Wi-Fi), une toutes les **30 min** jusqu'au prochain succès. Serveur arrêté 2 h : remises à +30 s,
    +5 min 30 s, +10 min 30 s, puis toutes les 30 min.
  - Wi-Fi désactivé ou pas connecté : rien, Android s'en charge (les échecs d'avant sont oubliés). Serveur qui
    répond autre chose que la sonde (404, autre taille) : ni échec ni remise.
  - **Remise interrompue** : la coupure par une appli est persistante (elle survit à la mort de l'appli et au
    redémarrage). Le chien note donc « remise en cours » sur disque avant de couper et l'efface une fois le Wi-Fi
    constaté allumé. Si le kiosque meurt entre les deux (`adb install -r` pendant une remise, manque de mémoire) ou
    si la puce ne remonte pas, il rallume au démarrage suivant ou au passage suivant, toutes les 30 s jusqu'au
    succès. Un Wi-Fi coupé à la main, sans remise en cours, n'est jamais rallumé.
- Réglages : constantes en tête de `RegleWifi.java` (2 échecs, 5 min, 3 remises, 30 min), de `ChienWifi.java` (30 s,
  10 s, taille de la sonde) et de `RadioWifi.java` (5 s, 1 s, 10 s). Les changer demande de reconstruire et de
  réinstaller le kiosque.
- **Sonde de 4 Kio** : servie d'un bloc à pleine vitesse (pas par `serveur/cadence.js`), sur une connexion neuve à
  chaque fois. 4 Kio, c'est un morceau de photo cadencée : la sonde n'envoie jamais au cadre une rafale plus grosse
  que les photos (une sonde de 64 Kio serait partie en rafales de 14 puis 29 Ko toutes les 30 s, le déclencheur
  supposé des décrochages). Trois paquets pleins suffisent : pendant un décrochage, tout paquet de plus de
  1 000 octets se perd.
- Une fois un kiosque installé, ne plus renommer, déplacer ni changer de taille `web/public/sonde.bin` (contenu
  pseudo-aléatoire figé, régénérable à l'identique, commande dans l'en-tête de `ChienWifi.java`). Le serveur relève
  ses fichiers statiques au démarrage : la sonde n'est servie qu'après un redéploiement. Déployer le serveur
  **avant** d'installer le kiosque, puis vérifier depuis le Clevo :
  `curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://192.168.1.187:8020/sonde.bin` doit donner
  `200 4096`. Un kiosque installé avant ne casse rien (404 : ni échec ni remise), il attend.
- Dans logcat (lecture seule) : `adb logcat -s Cuisine | grep "chien Wi-Fi"`. Une sonde réussie ne journalise rien ;
  on voit « démarré » au lancement, puis seulement les échecs, « remise différée », « remise à zéro du Wi-Fi »,
  « après coupure : coupé », « rallumage demandé », « après rallumage : allumé », « sonde revenue » et, après une
  remise interrompue, « remise précédente inachevée ». L'appel lui-même : `adb logcat | grep setWifiEnabled` (le
  service Wi-Fi d'Android y note le paquet `fr.arronis.cuisine`).
- **À vérifier au premier essai** : sur certains Android 9, le système demande un consentement à l'écran au lieu de
  couper le Wi-Fi d'une appli (`adb shell getprop ro.permission_review_required` vaut alors 1, lecture seule). Le
  chien le voit (« coupure sans effet ») et s'arrête jusqu'au prochain démarrage du kiosque. Si une fenêtre du genre
  « Cuisine souhaite désactiver le Wi-Fi » reste à l'écran, la **refuser** : l'accepter couperait le Wi-Fi pour de
  bon (le chien a déjà constaté le Wi-Fi allumé et s'est arrêté, il ne le rallumera pas).
- Neutraliser le chien sans toucher au cadre : retirer la sonde du serveur et redéployer (accord de Thomas) ; les
  sondes reçoivent un 404 et ne déclenchent plus de remise.
