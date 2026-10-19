# Jour J : identifier son cadre avant de le garder

La checklist suivie à la réception du cadre d'origine (le 13/10/2026), gardée parce qu'elle vaut pour la plupart des
cadres Frameo sous Android : elle dit, avant de fixer quoi que ce soit au mur, si ton cadre accepte l'ADB, l'appli
kiosque comme écran d'accueil, le son et la page du tableau de bord. Ne pas fixer le cadre et garder l'emballage
complet tant que la décision n'est pas prise (droit de retour).

- Les étapes qui modifient le cadre portent **(modifie le cadre)** : lis-les avant de les lancer, une par une.
- Les lectures (`adb devices`, `identifier-cadre.sh`, `dumpsys`, `logcat`) ne modifient rien.
- Toutes les commandes se lancent depuis le dossier du projet, sur ton PC relié au cadre par un câble USB.
- « M0 » à « M7 » sont les étapes du plan de conception (`docs/conception.md`, §5) : M0 = identifier le cadre,
  M2 = tableau de bord installé, M3 = menus et courses. « Conception §… » renvoie au même document.
- Les relevés bruts vont dans `docs/releves/` ; la synthèse et la décision dans `docs/cadre-ave948.md`.

## 0. La veille

- [ ] APK construit (SDK présent dans `~/Android/Sdk`) :
  ```
  kiosque/build.sh http://127.0.0.1:8020
  ```
  Contrôles conseillés :
  ```
  ~/Android/Sdk/build-tools/34.0.0/apksigner verify kiosque/build/cuisine-debug.apk
  ~/Android/Sdk/build-tools/34.0.0/aapt2 dump badging kiosque/build/cuisine-debug.apk | head -1
  ~/Android/Sdk/build-tools/34.0.0/aapt2 dump xmltree --file AndroidManifest.xml kiosque/build/cuisine-debug.apk | grep -A1 category
  ```
  Attendu : signature valide, `package: name='fr.arronis.cuisine'`, catégories HOME, LAUNCHER, DEFAULT.
- [ ] Sauvegarde de la clé de débogage créée par `build.sh` : copier `~/.android/debug.keystore`
  sur un support de sauvegarde.
- [ ] compat.html essayé dans Chrome sur ton PC :
  ```
  python3 outils/serveur-compat.py
  ```
  Ouvrir `http://127.0.0.1:8020/` : aucune erreur JS, « Pont Kiosk : absent », et « Envoyer le
  rapport » crée un fichier dans `docs/releves/`.
- [ ] Lecture seule prouvée, par liste blanche : les deux commandes suivantes ne doivent **rien**
  afficher. La première vérifie que chaque appel `lire` du script est exactement une lecture
  connue (un argument de plus, comme `wm density 240`, le fait sortir) ; la seconde, qu'il n'y a
  pas d'autre appel `adb` que `adb devices` et celui de la fonction `lire`.
  ```
  grep -oE "\blire ('[^']*'|[^|)'])*" outils/identifier-cadre.sh | sed 's/ *$//' | grep -vxF \
    -e 'lire getprop "$propriete"' \
    -e 'lire id' \
    -e 'lire getenforce' \
    -e 'lire dumpsys webviewupdate' \
    -e 'lire pm list packages' \
    -e 'lire pm list packages -f' \
    -e 'lire dumpsys package "$paquet"' \
    -e 'lire dumpsys package net.frameo.frame' \
    -e 'lire cat /proc/meminfo' \
    -e 'lire wm size' \
    -e 'lire wm density' \
    -e "lire 'df -h 2>/dev/null || df'" \
    -e 'lire dumpsys sensorservice' \
    -e 'lire getevent -lp' \
    -e 'lire dumpsys audio' \
    -e 'lire ime list -s' \
    -e 'lire settings get secure default_input_method' \
    -e 'lire cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME' \
    -e 'lire dumpsys power' \
    -e 'lire settings get system screen_off_timeout'
  grep -nE '(^|[ "(])adb ' outils/identifier-cadre.sh | grep -vE '^[0-9]+: *#' | grep -vF \
    -e 'command -v adb >/dev/null' \
    -e 'echo "adb introuvable' \
    -e '"$(adb devices 2>/dev/null | awk' \
    -e 'timeout 20 adb -s "$serie" shell "$@"'
  ```
  Toute nouvelle lecture ajoutée au script doit être ajoutée ici, après relecture.

  Pourquoi une liste de ce qui est permis plutôt qu'une liste de mots interdits : un `grep` de mots
  comme « put » ou « rm » trouve aussi des lectures innocentes (`default_input_method`, `platform`), et
  laisse passer des écritures comme `wm density 240` ou `am force-stop`.
- [ ] Câble USB (ton PC) vers USB-C (cadre) à portée de main.

## 1. Déballage

- [ ] Date limite de retour relevée sur la commande : **__/__/2026** (14 jours légaux, parfois 30 selon le
  vendeur : à vérifier sur ta commande). La reporter dans `docs/cadre-ave948.md`.

## 2. Premier allumage, sans Internet

- [ ] Allumer sur secteur.
- [ ] **Relever la version de Frameo** (Paramètres, À propos) avant toute connexion à Internet :
  **__________**. Si elle vaut 1.29 ou plus, lire la section 8 avant l'étape 6.
- [ ] Si l'assistant de démarrage exige un Wi-Fi : point d'accès 2,4 GHz de ton PC sans sortie
  Internet. Lance-le, Ethernet débranché (sinon le partage donne Internet au cadre) :
  ```
  nmcli device status
  nmcli device wifi hotspot ifname <carte Wi-Fi> band bg ssid cadre-test password '<mot de passe>'
  ```
  En fin de journée : `nmcli connection down Hotspot`.
  Raison : une connexion à Internet peut mettre Frameo à jour, et l'inscription à la bêta en
  apporte de toute façon.

## 3. Activer l'ADB

- [ ] Brancher le câble, choisir « Transfert de fichiers » (depuis l'ordinateur) sur le cadre.
- [ ] **(modifie le cadre)** Frameo : Paramètres, À propos, Bêta (rejoindre), puis ADB (activer).
  Le cadre passe sur le canal bêta.
- [ ] Sur ton PC : `adb devices` (lecture).
- [ ] **(modifie le cadre)** Accepter la clé RSA de ton PC affichée sur le cadre.
  - Reste « unauthorized » : **(modifie le cadre)** couper puis remettre la bêta, rebrancher.
  - Aucun appareil malgré tout (autre câble, autre port) : grille, ligne 1, RETOUR.

## 4. Relevé en lecture seule

- [ ] Lancer :
  ```
  outils/identifier-cadre.sh
  ```
  Sortie : `docs/releves/identifier-cadre-AAAAMMJJ-HHMMSS.txt`.
- [ ] Reporter dans `docs/cadre-ave948.md` : Android et SDK, SoC (`ro.board.platform`), RAM réelle
  (`MemTotal`), WebView et sa version, root (`id` affiche-t-il `uid=0` ?), `ro.adb.secure`,
  capteurs, audio, clavier, version de Frameo (avant et après Internet), paquets de mise à jour,
  activité d'accueil de Frameo.
- [ ] Activité d'accueil de Frameo (section « Activité d'accueil ») : **______________________**
  (la reporter aussi dans `docs/recuperation.md`).
- Lecture immédiate :
  - Android 6 : `cmd package set-home-activity` n'existe pas, voir la variante de l'étape 6.
  - Frameo 1.29 ou plus : section 8.
  - `ro.build.version.sdk` à 35 ou plus (Android 15 et plus refuse un targetSdk inférieur à 24,
    erreur `INSTALL_FAILED_DEPRECATED_SDK_VERSION`) : avant l'étape 5, passer
    `android:targetSdkVersion` à `"24"` dans `kiosque/AndroidManifest.xml`, puis reconstruire
    (sur ton PC, ne touche pas au cadre) : `kiosque/build.sh http://127.0.0.1:8020`.

## 5. Test d'installation et compat.html

Terminal 1 (sur ton PC, ne touche pas au cadre) :
```
python3 outils/serveur-compat.py
```

Terminal 2 :
1. **(modifie le cadre)** `adb install kiosque/build/cuisine-debug.apk` (attendu : `Success`).
   - `INSTALL_FAILED_DEPRECATED_SDK_VERSION` : targetSdk 24 oublié, voir la lecture immédiate de
     l'étape 4, reconstruire, puis recommencer ce point.
   - Refus du type `INSTALL_FAILED_INVALID_APK` sans root : grille, RETOUR.
2. **(modifie le cadre)** `adb reverse tcp:8020 tcp:8020` (temporaire : le cadre voit le serveur
   de ton PC sur son propre 127.0.0.1:8020 ; disparaît au débranchement ou au redémarrage).
3. **(modifie le cadre)** Lancer le kiosque avec la console visible depuis ton PC :
   `adb shell am start -n fr.arronis.cuisine/.ReglageAdb --ez debug true`
   Console : `chrome://inspect` dans Chrome sur ton PC. Si Android demande quelle appli
   d'accueil utiliser, répondre « Une seule fois ».
   `.ReglageAdb` est l'alias réservé au shell ADB (permission DUMP) : c'est aussi le test de ce
   verrou. Si `am start` répond `Permission Denial`, ou si `chrome://inspect` ne voit pas la
   WebView : le noter, lancer `adb shell am start -n fr.arronis.cuisine/.MainActivity` et
   continuer sans console (elle n'est qu'un confort ce jour-là).
4. Sur le cadre, dans compat.html, dans cet ordre :
   1. Pont (section 6 de la page) : « Volume 80 % » seulement (le bip automatique doit sonner à
      ce volume).
   2. Son (section 5) : « Recharger et tester », puis ne plus toucher. Deux bips 3 s après le
      rechargement. Répondre aux deux questions « automatique ». (Ce rechargement efface les
      résultats déjà affichés, d'où sa place en tête ; le volume, lui, reste réglé.)
   3. Son (section 5) : `Bip WebAudio` et `Bip <audio>`, puis répondre aux deux questions « au toucher ».
   4. Fondu (section 4) : « Mesurer le fondu », ne pas toucher pendant 10 s.
   5. Clavier (section 7) : taper « crème fraîche ». Noter à l'œil ce que le clavier cache (en
      plein écran, la page ne peut pas le mesurer).
   6. Pont (section 6) : « Volume 80 % » de nouveau, pour que `setVolume` et `getVolume`
      figurent au rapport, puis « Luminosité 0 → 0,05 → 1 » (l'écran reste-t-il lisible à 0,05 ?).
   7. Diaporama (section 8) : « Lancer le diaporama » (10 min). Pendant ce temps, sur ton PC,
      deux terminaux de plus (lectures) :
      ```
      for i in $(seq 1 10); do date +%T; adb shell dumpsys meminfo fr.arronis.cuisine | grep -E 'TOTAL'; adb shell dumpsys meminfo | grep -iE 'sandboxed|webview'; sleep 60; done
      ```
      ```
      adb logcat -s Cuisine
      ```
      Le second `dumpsys meminfo` de la boucle (sans argument) suit le processus de rendu de la
      WebView, séparé de l'appli à partir d'Android 8 (avant, il est compté dans le `TOTAL` de
      l'appli). Un « Processus de rendu perdu » dans logcat signale un plantage, même si la page
      revient seule (compat.html est alors rechargée sans message, diaporama arrêté).
      RAM réelle inférieure à 1,5 Go (grille) : relancer le diaporama 6 fois de suite (1 h), avec
      `seq 1 60` dans la boucle.
   8. « Envoyer le rapport au PC » : le fichier arrive dans `docs/releves/rapport-compat-*.txt`.
      En cas d'échec (« Copier le rapport » sur le cadre ne remplit que le presse-papiers du
      cadre, inutile ici) :
      - rebrancher le câble si besoin, **(modifie le cadre)** `adb reverse tcp:8020 tcp:8020`,
        puis renvoyer ;
      - sinon, kiosque lancé en débogage (point 3) : « Copier le rapport » sur le cadre (remplit
        la zone de texte), puis dans la console `chrome://inspect` de ton PC :
        `copy(document.getElementById('zone-rapport').value)`, et coller dans un fichier de
        `docs/releves/` ;
      - à défaut, photographier la zone de texte affichée.
5. Décider le réglage `verre` : ligne « Réglage verre proposé » du rapport, et la grille (WebView 64 à 75 : `teinte`).
6. Lire l'essai « fvs » (`font-variation-settings`) du rapport. Négatif = pas de polices variables (WebView
   avant 62, déjà « RETOUR conseillé ») : un GO malgré tout impose de remplacer les deux polices variables de
   `web/public/polices/` par des instances statiques (Nunito Sans 400 et 700, Fraunces 400 en
   tailles optiques 40 et 144, voir `web/styles/base.css`), sinon toute l'interface s'affiche en ExtraLight et les chiffres en Black (`web/styles/base.css`).

## 6. Test du lanceur (obligatoire, réversible)

Android 7 ou plus :
1. **(modifie le cadre)** `adb shell cmd package set-home-activity fr.arronis.cuisine/.MainActivity`
2. **(modifie le cadre)** `adb reboot`. Attendu : le kiosque démarre seul. Il affiche la page de
   secours (heure, « Serveur injoignable ») parce que `adb reverse` est perdu au redémarrage :
   c'est normal, et cela teste la page de secours.
3. **(modifie le cadre)** `adb reverse tcp:8020 tcp:8020` (serveur toujours lancé). Attendu :
   compat.html revient seul en 15 s au plus (test du nouvel essai).
4. Coupure réelle : débrancher le secteur 10 s, rebrancher. Attendu : retour seul au kiosque.
5. Sortie : deux doigts immobiles 1,5 s, les Réglages s'ouvrent ; bouton Accueil, retour au kiosque.
6. Retour à Frameo :
   - **(modifie le cadre)** `adb shell cmd package set-home-activity <activité Frameo de l'étape 4>`
   - **(modifie le cadre)** `adb reboot`. Attendu : Frameo démarre.

Variante Android 6 (pas de `cmd`) [à vérifier sur le cadre] :
1. **(modifie le cadre)** Bouton Accueil (ou `adb shell input keyevent KEYCODE_HOME`) : Android
   propose de choisir l'appli d'accueil, choisir « Cuisine », « Toujours ».
2. **(modifie le cadre)** `adb reboot`, puis les points 3 à 5 ci-dessus.
3. Retour, **(modifie le cadre)** : Réglages, Applis, Cuisine, « Effacer les valeurs par défaut »,
   puis Accueil et choisir Frameo « Toujours ».
4. Si aucun choix ne s'affiche : lanceur non remplaçable, grille.

Version de Frameo après Internet (demandée par la conception, « Terminé quand ») : en dernier,
lanceur rendu à Frameo, et **seulement si tu le décides**. Une mise à jour de Frameo vers
1.29 ou plus pourrait rendre le lanceur non remplaçable pour M2 (section 8). Sans ce test,
noter « non testé » dans `docs/cadre-ave948.md`.
1. **(modifie le cadre)** Donner Internet au cadre : rebrancher l'Ethernet de ton PC (le point
   d'accès de la section 2 partage alors sa connexion), ou connecter le cadre au Wi-Fi de la maison.
2. Attendre une dizaine de minutes, relire la version dans Frameo (À propos), puis relancer
   `outils/identifier-cadre.sh` (lecture). Noter la version.
3. **(modifie le cadre)** Couper de nouveau Internet (Ethernet débranché, ou Wi-Fi de la maison
   oublié sur le cadre).

## 7. Si la décision est RETOUR

1. **(modifie le cadre)** Si le lanceur a été changé :
   `adb shell cmd package set-home-activity <activité Frameo>`
2. **(modifie le cadre)** `adb uninstall fr.arronis.cuisine`
3. **(modifie le cadre)** `adb reboot`, puis vérifier que Frameo démarre seul.
4. **(modifie le cadre)** Quitter la bêta Frameo (coupe l'ADB).
5. Remballer, et demander le retour avant la date limite de l'étape 1.

## 8. Cas Frameo 1.29 ou plus

D'après la doc ImmichFrame, le lanceur de Frameo n'est plus remplaçable à partir de la 1.29. On
le vérifie quand même à l'étape 6 : si le kiosque démarre seul, il n'y a rien à faire ici.

Si l'étape 6 échoue :
1. Dans le relevé de l'étape 4 :
   - section « Version de Frameo » : deux lignes `versionName` signalent une mise à jour
     installée par-dessus une version d'usine (la seconde est souvent la version d'usine) ;
   - section « Paquets Frameo » : un chemin `/system/...` signale une appli système, donc une
     version d'usine vers laquelle revenir. Un chemin `/data/app/...` seul : pas de retour possible.
2. Si la version d'usine est inférieure à 1.29 (par exemple 1.24) :
   - **(modifie le cadre)** ouvrir la fiche de l'appli :
     `adb shell am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:net.frameo.frame`
   - **(modifie le cadre)** sur le cadre : menu, « Désinstaller les mises à jour », OK ;
   - relancer `outils/identifier-cadre.sh` et noter la nouvelle version ;
   - ne plus donner Internet au cadre, sinon Frameo se remet à jour ;
   - refaire l'étape 6.

   La doc ImmichFrame fait cette rétrogradation avec `su` ; le passage par la fiche de l'appli
   ne demande pas le root [à vérifier sur le cadre]. Ne pas utiliser `pm uninstall
   net.frameo.frame` : si Frameo n'est pas une appli système, cela le supprimerait entièrement
   et compliquerait le retour du cadre.
3. Sinon : plan B de la grille (récepteur BOOT_COMPLETED, codé seulement à ce moment), et s'il
   échoue, RETOUR.

Pour un retour après rétrogradation : rendre Internet au cadre, Frameo devrait se remettre à jour
seul [à vérifier].

## 9. Grille de décision

| Constat | Décision | Constaté |
|---|---|---|
| ADB invisible malgré le câble, le réglage « transfert » et la bêta coupée puis remise | RETOUR | [ ] |
| `adb install` refusé (`INSTALL_FAILED_INVALID_APK`), sans root | RETOUR (le plan B ImmichFrame a aussi besoin d'un APK) | [ ] |
| Lanceur non remplaçable | Plan B avant la date limite de retour : récepteur BOOT_COMPLETED dans le kiosque (Android 10 et plus : `adb shell appops set fr.arronis.cuisine SYSTEM_ALERT_WINDOW allow`, à vérifier). S'il échoue : RETOUR | [ ] |
| Aucun son, même au toucher | RETOUR conseillé (minuteurs inaudibles), à toi de trancher | [ ] |
| Son au toucher seulement, pas sans geste après un rechargement | GO : le minuteur s'arme au toucher qui le lance, pas de rechargement pendant qu'il tourne | [ ] |
| WebView inférieure à 64, ou Android inférieur à 7 sans root | RETOUR conseillé | [ ] |
| WebView de 64 à 75 | GO, `verre: teinte` | [ ] |
| WebView 76 ou plus | GO, `verre` selon la mesure du fondu | [ ] |
| RAM réelle inférieure à 1,5 Go | Diaporama de test pendant 1 h : si la WebView plante, RETOUR | [ ] |
| `adb shell id` renvoie `uid=0` | GO, sans ADB réseau, Internet coupé au cadre | [ ] |
| Android 15 ou plus | GO avec targetSdk 24 | [ ] |
| Clavier Android absent ou inutilisable | GO, clavier HTML ajouté en M3 | [ ] |

## 10. Terminé quand

- `docs/cadre-ave948.md` est rempli : Android, SoC, RAM réelle, WebView, root, `ro.adb.secure`,
  capteurs, audio, clavier, version de Frameo (avant et après Internet), paquets de mise à jour,
  activité d'accueil de Frameo, rapport compat.html et réglage `verre`.
- La décision GO ou RETOUR est écrite avec sa raison, et la date limite de retour est notée.
