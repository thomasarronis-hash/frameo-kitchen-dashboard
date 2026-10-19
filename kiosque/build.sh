#!/usr/bin/env bash
# build.sh : construit l'APK du kiosque sans Gradle (aapt2, javac, d8, zipalign, apksigner).
#
# Rôle    : vérifier les classes pures du chien de garde Wi-Fi (RegleWifi, RemiseWifi, avec le JDK
#           seul), puis produire kiosque/build/cuisine-debug.apk, signé avec la clé de débogage Android.
# Entrées : ORIGINE en argument obligatoire, sans chemin ni barre finale (pour
#           identifier le cadre : http://127.0.0.1:8020 ; en service : http://<ip du serveur>:8020), injectée dans la classe
#           générée Config.java. Avec une origine en boucle locale (127.x.x.x, localhost), le chien
#           Wi-Fi ne démarre pas : sa sonde passerait par adb reverse sur le câble, pas par le Wi-Fi.
#           ANDROID_HOME (défaut $HOME/Android/Sdk) avec build-tools 34.0.0
#           et platform android-34 ; javac, java, keytool et zip dans le PATH.
# Sorties : kiosque/build/ (ignoré par git, vidé à chaque construction), dont cuisine-debug.apk.
# Pièges  :
#   - Ne télécharge rien : s'il manque un outil, le script dit quoi installer et s'arrête.
#   - Crée ~/.android/debug.keystore s'il n'existe pas. LE SAUVEGARDER : sans lui, une nouvelle
#     version ne s'installe plus par-dessus l'ancienne, il faut désinstaller, ce qui efface la
#     clé d'appareil rangée par le kiosque.
#   - minSdk est relu dans AndroidManifest.xml (une seule source) puis passé à d8.
#   - Les sources Java contiennent des accents : javac reçoit -encoding UTF-8.
#   - javac en -source/-target 8 avec android.jar en bootclasspath : les classes java.* sont
#     celles d'Android, pas celles du JDK 17.
#   - Étape 1 : kiosque/tests/.../TestRegleWifi.java et TestRemiseWifi.java sont compilés avec
#     RegleWifi.java et RemiseWifi.java seuls (sans android.jar) et lancés par java ; un contrôle qui
#     échoue arrête la construction. Les tests sont hors de src/ : ils n'entrent pas dans l'APK.
set -euo pipefail

ici="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
OUTILS="$ANDROID_HOME/build-tools/34.0.0"
PLATEFORME="$ANDROID_HOME/platforms/android-34/android.jar"
CLE_DEBUG="$HOME/.android/debug.keystore"
SORTIE="$ici/build"
APK="$SORTIE/cuisine-debug.apk"

origine="${1:-}"
if [[ -z "$origine" ]]; then
  echo "Usage : $0 <ORIGINE>   (exemple : $0 http://127.0.0.1:8020)" >&2
  exit 2
fi
if [[ ! "$origine" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  echo "ORIGINE invalide : « $origine ». Attendu : http://hote:port, sans chemin ni barre finale." >&2
  exit 2
fi

# ---- Outils : vérification seulement, aucun téléchargement ----
manque=()
for outil in aapt2 d8 zipalign apksigner; do
  [[ -x "$OUTILS/$outil" ]] || manque+=("$OUTILS/$outil")
done
[[ -f "$PLATEFORME" ]] || manque+=("$PLATEFORME")
for commande in javac java keytool zip; do
  command -v "$commande" >/dev/null 2>&1 || manque+=("$commande (commande)")
done
if (( ${#manque[@]} > 0 )); then
  echo "Construction impossible, il manque :" >&2
  printf '  - %s\n' "${manque[@]}" >&2
  cat >&2 <<EOF

Pour les installer (téléchargements à faire soi-même) :
  - build-tools 34.0.0 et platform android-34 : décompresser les « command-line tools »
    Android (https://developer.android.com/studio#command-line-tools-only) dans
    $ANDROID_HOME/cmdline-tools/latest, puis lancer :
      $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --sdk_root="$ANDROID_HOME" "build-tools;34.0.0" "platforms;android-34"
  - javac, java et keytool : sudo apt install openjdk-17-jdk-headless
  - zip : sudo apt install zip
SDK ailleurs : ANDROID_HOME=/chemin/vers/Sdk $0 $origine
EOF
  exit 1
fi

min_sdk="$(sed -n 's/.*android:minSdkVersion="\([0-9]*\)".*/\1/p' "$ici/AndroidManifest.xml")"
if [[ -z "$min_sdk" ]]; then
  echo "minSdkVersion introuvable dans AndroidManifest.xml" >&2
  exit 1
fi

rm -rf -- "$SORTIE"
mkdir -p "$SORTIE/gen/fr/arronis/cuisine" "$SORTIE/classes" "$SORTIE/dex" "$SORTIE/tests"

echo "1/7 Tests du chien Wi-Fi : règle et remise (JDK seul, sans Android)"
javac -encoding UTF-8 --release 8 -Xlint:-options -d "$SORTIE/tests" \
  "$ici/src/fr/arronis/cuisine/RegleWifi.java" "$ici/src/fr/arronis/cuisine/RemiseWifi.java" \
  "$ici/tests/fr/arronis/cuisine/TestRegleWifi.java" "$ici/tests/fr/arronis/cuisine/TestRemiseWifi.java"
java -cp "$SORTIE/tests" fr.arronis.cuisine.TestRegleWifi
java -cp "$SORTIE/tests" fr.arronis.cuisine.TestRemiseWifi

echo "2/7 Config.java (ORIGINE = $origine)"
cat > "$SORTIE/gen/fr/arronis/cuisine/Config.java" <<EOF
// Généré par kiosque/build.sh : ne pas modifier, relancer build.sh avec une autre ORIGINE.
package fr.arronis.cuisine;

final class Config {
    /** Seule origine autorisée (schéma, hôte, port), sans barre finale. */
    static final String ORIGINE = "$origine";

    private Config() {
    }
}
EOF

echo "3/7 Ressources et manifeste (aapt2, minSdk $min_sdk)"
"$OUTILS/aapt2" compile --dir "$ici/res" -o "$SORTIE/res.zip"
"$OUTILS/aapt2" link -o "$SORTIE/base.apk" -I "$PLATEFORME" \
  --manifest "$ici/AndroidManifest.xml" -A "$ici/assets" "$SORTIE/res.zip"

echo "4/7 Compilation Java"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -bootclasspath "$PLATEFORME" \
  -d "$SORTIE/classes" "$ici"/src/fr/arronis/cuisine/*.java "$SORTIE/gen/fr/arronis/cuisine/Config.java"

echo "5/7 Bytecode Android (d8)"
mapfile -t classes < <(find "$SORTIE/classes" -name '*.class')
"$OUTILS/d8" --min-api "$min_sdk" --lib "$PLATEFORME" --output "$SORTIE/dex" "${classes[@]}"
(cd "$SORTIE/dex" && zip -q -X "$SORTIE/base.apk" classes.dex)

echo "6/7 Alignement (zipalign)"
"$OUTILS/zipalign" -f 4 "$SORTIE/base.apk" "$SORTIE/aligne.apk"

echo "7/7 Signature (apksigner)"
if [[ ! -f "$CLE_DEBUG" ]]; then
  echo "Création de la clé de débogage $CLE_DEBUG (à sauvegarder)"
  mkdir -p "$(dirname "$CLE_DEBUG")"
  keytool -genkeypair -keystore "$CLE_DEBUG" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US"
fi
"$OUTILS/apksigner" sign --ks "$CLE_DEBUG" --ks-pass pass:android --key-pass pass:android \
  --out "$APK" "$SORTIE/aligne.apk"
"$OUTILS/apksigner" verify "$APK"

echo
echo "APK prêt : kiosque/build/cuisine-debug.apk (origine $origine)"
echo "Contrôles conseillés :"
echo "  $OUTILS/aapt2 dump badging $APK | head -1"
echo "  $OUTILS/aapt2 dump xmltree --file AndroidManifest.xml $APK | grep -A1 category"
