# Récupération du cadre

Le guide de dépannage du cadre : sortir du kiosque, Wi-Fi perdu, retour à Frameo, mise à jour, plantage. Il a été
écrit pour le cadre de la maison d'origine (Rockchip RK3326, Android 9, détail : `docs/cadre-ave948.md`) ; les
commandes valent pour la plupart des cadres Android, les valeurs du tableau sont à relever sur le tien.

Les commandes se lancent depuis le dossier du projet, sur ton PC relié au cadre par un câble USB, avec `adb`. Celles
qui **modifient** le cadre sont marquées **(modifie le cadre)** : lis-les avant de les lancer, une par une. Dans les
exemples, `<serveur>` est l'adresse de ton serveur maison (par exemple `192.168.1.50`).

## Valeurs à garder sous la main

| Valeur | Relevé |
|---|---|
| Activité d'accueil de Frameo | `net.frameo.frame/.ui.activities.AWaitForDeferredInitCompleted` |
| Version d'Android du cadre | 9 (SDK 28), RK3326, pas root, SELinux permissif |
| Paquets désactivés à l'installation (`pm disable-user`) | `net.frameo.frame`, `android.rockchip.update.service` |
| Origine compilée dans l'APK installé | `http://<serveur>:8020` |
| Réseau | Wi-Fi de la box en DHCP. **La MAC Wi-Fi change à chaque démarrage** (pas d'adresse gravée), donc aucune règle de la box par appareil (bail fixe, contrôle parental) n'est possible ; l'IP change aussi, sans conséquence : c'est le cadre qui appelle le serveur |
| Accès à Internet | non coupé : MAC aléatoire et IPv6 publique de la box empêchent une coupure fiable sans root. Rien sur le cadre ne s'en sert (Frameo et la mise à jour Rockchip désactivés, pas de Play Store, kiosque verrouillé sur le serveur). L'IP fixe sans passerelle a été essayée : cette version d'Android perd alors la route du réseau local |

## Ce qu'il faut toujours avoir

- Le port USB-C du cadre accessible, même une fois fixé au mur.
- Un câble USB (ton PC) vers USB-C (cadre), et `adb` sur ton PC.
- L'ADB par câble : débogage USB activé dans les options pour les développeurs d'Android, et le kiosque qui
  remet le port USB-C en mode appareil 20 s après son lancement (`PortUsb.java`). Après un redémarrage, l'ADB
  apparaît, disparaît vers +30 s, puis revient vers +55 s. Sans ADB, il reste le geste à deux doigts.
- Le secteur branché : sur le seul USB, le cadre est sous-alimenté (l'écran scintille).
- Une sauvegarde de `~/.android/debug.keystore`. Sans elle, une nouvelle version du kiosque ne
  s'installe plus par-dessus l'ancienne : il faut désinstaller, ce qui efface la clé d'appareil.

## 1. Sortir du kiosque

- **Sur l'écran** : poser deux doigts et les garder immobiles 1,5 s. Les Réglages Android s'ouvrent.
- Le bouton retour ne fait rien dans le kiosque (voulu).
- **Revenir au kiosque** : bouton Accueil si le kiosque est l'appli d'accueil, sinon
  `adb shell am start -n fr.arronis.cuisine/.MainActivity` (ne modifie rien).

## 2. Wi-Fi perdu (box changée, mot de passe changé)

Symptôme : la page de secours reste affichée (grosse heure, « Serveur injoignable, nouvel essai
automatique »), avec les minuteurs en cours.

1. Ouvrir l'écran Wi-Fi, au choix :
   - sur l'écran : geste à deux doigts, puis Réglages, Wi-Fi ;
   - par USB : `adb shell am start -a android.settings.WIFI_SETTINGS` (ouvre l'écran, ne change rien).
2. **(modifie le cadre)** Choisir le réseau et saisir le mot de passe sur le cadre.
3. Le kiosque sonde le serveur toutes les 15 s et recharge la vraie page dès qu'il répond.

Si le Wi-Fi est bon mais que la page de secours reste : le serveur est en cause. Depuis ton PC,
`curl -s http://<serveur>:8020/api/sante`.

Le chien de garde Wi-Fi du kiosque n'aide pas ici : il ne change jamais de réseau et ne rallume pas un Wi-Fi
désactivé à la main. Il coupe puis rallume seulement un Wi-Fi connecté dont la sonde de 4 Kio ne passe plus
(décrochages de la puce RK915) ; un Wi-Fi qui se coupe et revient tout seul, c'est lui (`docs/cadre-ave948.md`).
Une remise qu'il n'a pas pu finir (kiosque fermé entre la coupure et le rallumage) est rallumée au démarrage
suivant du kiosque.

## 3. Retour arrière complet vers Frameo

L'ordre compte : Frameo est remis en état **avant** de retirer le kiosque, sinon le cadre peut se
retrouver sans appli d'accueil.

1. **(modifie le cadre)** Réactiver Frameo, seulement s'il a été désactivé à l'installation :
   `adb shell pm enable net.frameo.frame`, puis la même commande pour chaque paquet de mise à
   jour du tableau ci-dessus.
2. **(modifie le cadre)** Rendre l'accueil à Frameo.
   - Android 7 ou plus : `adb shell cmd package set-home-activity <activité Frameo relevée>`
   - Android 6 (pas de `cmd`) : Réglages, Applis, Cuisine, « Effacer les valeurs par défaut »,
     puis bouton Accueil et choisir Frameo « Toujours » [à vérifier sur le cadre].
3. **(modifie le cadre)** `adb uninstall fr.arronis.cuisine`
4. **(modifie le cadre)** `adb reboot`, puis vérifier que Frameo démarre seul.
5. **(modifie le cadre)** Rendre Internet au cadre (s'il a été coupé côté box) si Frameo doit
   de nouveau recevoir les photos des proches.
6. Facultatif, **(modifie le cadre)** : quitter la bêta Frameo, ce qui coupe l'ADB.

## 4. Désinstaller seulement le kiosque

- Si le kiosque est l'appli d'accueil : faire d'abord les points 1 et 2 de la section 3.
- **(modifie le cadre)** `adb uninstall fr.arronis.cuisine`
- La clé d'appareil rangée dans le kiosque est perdue. Après une réinstallation, la renvoyer : **(modifie le cadre)**
  `adb shell am start -n fr.arronis.cuisine/.ReglageAdb --es cle "$(ssh moi@<serveur> cat cadre/secrets/cle_cadre)"`
  (`.ReglageAdb` : alias réservé au shell ADB ; passés par `.MainActivity`, la clé et le
  débogage sont ignorés et logcat affiche « Extras cle et debug ignorés »).

## 5. Mettre à jour le kiosque sans perdre la clé

- Construire pour ton serveur : `bash kiosque/build.sh http://<serveur>:8020` (l'étape 1 vérifie la règle et la
  remise du chien Wi-Fi ; un contrôle qui échoue arrête la construction).
- Avant d'installer : le serveur doit déjà servir la sonde,
  `curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://<serveur>:8020/sonde.bin` donne
  `200 4096` (sinon déployer le serveur d'abord). Et relever, en lecture seule,
  `adb shell getprop ro.permission_review_required` : 1 veut dire qu'Android demandera un consentement à l'écran
  à la première remise à zéro (la refuser, voir `docs/cadre-ave948.md`).
- **(modifie le cadre)** `adb install -r kiosque/build/cuisine-debug.apk`
- **Juste après**, **(modifie le cadre)** : `adb shell cmd package set-home-activity fr.arronis.cuisine/.MainActivity`
  puis `adb shell input keyevent KEYCODE_HOME`. La mise à jour ferme le kiosque, et Android retombe sinon
  sur un autre écran d'accueil. Si Android demande quelle appli d'accueil utiliser : « Cuisine »,
  « Toujours ».
- La clé d'appareil est conservée par `install -r`. Les permissions ajoutées (état du réseau et du Wi-Fi,
  changement d'état du Wi-Fi) sont « normales » : accordées par `install -r`, sans dialogue.
- Une installation qui tombe pendant une remise à zéro du Wi-Fi (kiosque fermé alors que le Wi-Fi est coupé) ne
  laisse pas le cadre hors ligne : le kiosque relancé par l'étape ci-dessus rallume le Wi-Fi tout seul (« remise
  précédente inachevée » dans logcat). Par câble, `adb install` ne dépend pas du Wi-Fi.
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` : l'APK n'est pas signé avec la même clé de débogage.
  Restaurer la sauvegarde de `~/.android/debug.keystore`, reconstruire, réessayer. À défaut :
  section 4 (désinstaller, réinstaller, renvoyer la clé).

## 6. Kiosque planté, page blanche

- Si le processus de rendu de la WebView meurt, le kiosque la recrée seul (Android 8 et plus).
  Avant Android 8, c'est l'appli entière qui s'arrête ; étant l'appli d'accueil, elle revient.
- Journaux du kiosque : `adb logcat -s Cuisine` (lecture seule) ; ceux du chien Wi-Fi seuls :
  `adb logcat -s Cuisine | grep "chien Wi-Fi"`.
- Console de la page : **(modifie le cadre)**
  `adb shell am start -n fr.arronis.cuisine/.ReglageAdb --ez debug true`, puis
  `chrome://inspect` dans Chrome sur ton PC. Le débogage se coupe au prochain lancement normal.

## 7. Plus d'ADB et kiosque bloqué

Dernier recours, **(modifie le cadre)** : geste à deux doigts, Réglages, Sauvegarde et
réinitialisation, « Restaurer les valeurs d'usine ». Tout est effacé, le kiosque compris, et Frameo
revient dans sa version d'usine [à vérifier : seulement si Frameo est une appli système, chemin
`/system/...` dans le relevé].
