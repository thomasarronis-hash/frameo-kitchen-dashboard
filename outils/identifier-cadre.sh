#!/usr/bin/env bash
# identifier-cadre.sh : relevé du cadre par ADB, STRICTEMENT en lecture seule (jour J, étape 4).
#
# Rôle    : interroger le cadre branché en USB (getprop, dumpsys, wm, pm list, settings get...)
#           et tout consigner, pour remplir docs/cadre-ave948.md et décider GO ou RETOUR.
# Entrées : un seul appareil ADB branché et autorisé (clé RSA du PC acceptée sur le cadre).
# Sorties : docs/releves/identifier-cadre-AAAAMMJJ-HHMMSS.txt, et la même chose à l'écran.
#           Le numéro de série n'est pas écrit dans le relevé.
# Pièges  :
#   - Lecture seule : n'ajouter ici AUCUNE commande qui modifie le cadre. Celles-là sont dans
#     docs/jour-j.md, chacune lancée à la main, une par une. Tout nouvel appel à lire() doit aussi
#     entrer dans la liste blanche de docs/jour-j.md (étape 0, « Lecture seule prouvée »).
#   - Vieil Android (6) : certaines commandes n'existent pas (cmd, dumpsys webviewupdate).
#     Chaque appel est protégé (|| true) : un message d'erreur dans le relevé est normal.
#   - Les filtres (grep, head) tournent sur le PC : la boîte à outils d'un vieil Android
#     n'a pas toujours grep ni head.
#   - Avant Android 7, adb shell renvoie des fins de ligne CRLF : les \r sont retirés.
#   - Chaque appel est borné à 20 s (timeout) pour ne jamais rester bloqué.
set -u

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb introuvable : il vient du paquet Debian « adb » (à ajouter avec apt)." >&2
  exit 1
fi

# Un seul appareil, et autorisé. Format de « adb devices » : numéro<TAB>état.
appareils="$(adb devices 2>/dev/null | awk 'NR > 1 && NF >= 2 { print $1, $2 }')"
nombre="$(printf '%s\n' "$appareils" | grep -c . || true)"

if [ "$nombre" -eq 0 ]; then
  echo "Aucun appareil ADB. Vérifier : câble USB-C, mode « Transfert depuis l'ordinateur »," >&2
  echo "ADB activé dans Frameo (À propos, Bêta, ADB)." >&2
  exit 1
fi
if [ "$nombre" -gt 1 ]; then
  echo "Plusieurs appareils ADB branchés, n'en laisser qu'un (le cadre) :" >&2
  printf '%s\n' "$appareils" >&2
  exit 1
fi

serie="${appareils%% *}"
etat="${appareils#* }"
case "$etat" in
  device) ;;
  unauthorized)
    echo "Cadre non autorisé : accepter la clé de ton PC sur l'écran du cadre" >&2
    echo "(sinon couper puis remettre la bêta Frameo), puis relancer ce script." >&2
    exit 1
    ;;
  *)
    echo "Cadre dans l'état « $etat » : débrancher, rebrancher, puis relancer ce script." >&2
    exit 1
    ;;
esac

mkdir -p "$racine/docs/releves"
sortie="$racine/docs/releves/identifier-cadre-$(date +%Y%m%d-%H%M%S).txt"

# Lance une commande en lecture seule sur le cadre (sortie et erreurs, sans \r).
lire() {
  timeout 20 adb -s "$serie" shell "$@" 2>&1 | tr -d '\r'
}

section() {
  printf '\n## %s\n' "$1"
}

{
  echo "# Relevé du cadre, $(date '+%d/%m/%Y %H:%M:%S')"
  echo "# outils/identifier-cadre.sh, lecture seule"

  section "Propriétés système"
  for propriete in ro.product.model ro.build.version.release ro.build.version.sdk ro.board.platform \
      ro.hardware ro.product.cpu.abi ro.build.type ro.build.tags ro.debuggable ro.secure \
      ro.adb.secure ro.boot.slot_suffix; do
    printf '%s = %s\n' "$propriete" "$(lire getprop "$propriete" || true)"
  done

  section "Shell ADB : utilisateur (uid=0 signifie root) et SELinux"
  lire id || true
  lire getenforce || true

  section "WebView active (Android 7 et plus : dumpsys webviewupdate)"
  lire dumpsys webviewupdate || true
  echo "Paquets WebView présents et versions :"
  lire pm list packages | grep -iE 'webview|chrome' || true
  for paquet in com.google.android.webview com.android.webview com.android.chrome; do
    echo "$paquet :"
    lire dumpsys package "$paquet" | grep -E 'versionName' || true
  done

  section "Mémoire (MemTotal = RAM réelle)"
  lire cat /proc/meminfo | head -3 || true

  section "Écran"
  lire wm size || true
  lire wm density || true

  section "Stockage"
  lire 'df -h 2>/dev/null || df' || true

  section "Capteurs"
  lire dumpsys sensorservice | head -40 || true

  section "Périphériques d'entrée (tactile, boutons)"
  lire getevent -lp || true

  section "Audio"
  lire dumpsys audio | head -60 || true

  section "Clavier"
  lire ime list -s || true
  lire settings get secure default_input_method || true

  section "Paquets Frameo et de mise à jour (chemin /system/... = appli système)"
  lire pm list packages -f | grep -iE 'frameo|fota|adups|update|ota' || true

  frameo="$(lire dumpsys package net.frameo.frame || true)"

  section "Version de Frameo (deux versionName = mise à jour + version d'usine)"
  printf '%s\n' "$frameo" | grep -E 'versionName|firstInstallTime|lastUpdateTime' || true

  section "Activité d'accueil (lanceur)"
  lire cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME || true
  echo "Filtres HOME déclarés par Frameo (repli pour Android 6, sans « cmd ») :"
  printf '%s\n' "$frameo" | grep -B 8 'android.intent.category.HOME' || true

  section "Veille et luminosité"
  lire dumpsys power | grep -E 'mWakefulness|mScreenBrightnessSetting' || true
  lire settings get system screen_off_timeout || true
} 2>&1 | tee "$sortie"

echo
echo "Relevé enregistré : ${sortie#"$racine"/}"
