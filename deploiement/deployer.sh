#!/usr/bin/env bash
# deploiement/deployer.sh
#
# Rôle    : envoyer le serveur sur le M900, le construire là-bas et (re)démarrer le conteneur cadre-bff.
#           Chaque lancement est une écriture en prod : seulement avec l'accord de Thomas.
# Entrées : le projet local (package*.json, Dockerfile, .dockerignore, serveur/, partage/, config/, web/), et
#           deploiement/docker-compose.yml ; variables HOTE_M900 (défaut thomas@192.168.1.187) et URL_SANTE
#           (défaut http://192.168.1.187:8020/api/sante).
# Sorties : ~/cadre/src/ (miroir des sources, --delete), ~/cadre/docker-compose.yml, image cadre-bff:local
#           (l'ancienne est gardée sous cadre-bff:precedent), conteneur démarré ; réussit seulement quand
#           /api/sante répond "ha":"ok".
# Pièges  :
#   - Ne touche JAMAIS à ~/cadre/secrets ni à ~/cadre/data : ils sont préparés une fois (README, Déploiement).
#   - Refuse de partir si les tests locaux échouent ou si l'arbre git a des modifications non committées.
#     Les fichiers ignorés par git (futur web/dist, .env) ne sont pas vus par ce contrôle : n'en pose pas
#     dans serveur/, partage/, config/ ou web/.
#   - config/ (barème des enfants) est indispensable : sans lui, le Dockerfile échoue (COPY config/) et le serveur
#     refuserait de démarrer.
#   - Le build se fait sur le M900 (npm ci y télécharge les dépendances figées par package-lock.json).
#   - Retour arrière : ssh M900 'cd ~/cadre && docker tag cadre-bff:precedent cadre-bff:local && docker compose up -d'

set -euo pipefail

HOTE_M900="${HOTE_M900:-thomas@192.168.1.187}"
URL_SANTE="${URL_SANTE:-http://192.168.1.187:8020/api/sante}"
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"

if [ -n "$(git status --porcelain)" ]; then
  echo "Arbre git modifié : committe d'abord ce que tu déploies." >&2
  exit 1
fi

echo "1/5 Tests locaux"
npm test --silent > /dev/null || {
  echo "Tests locaux en échec : rien n'a été envoyé (npm test pour le détail)." >&2
  exit 1
}

echo "2/5 Contrôle de ~/cadre sur $HOTE_M900"
ssh "$HOTE_M900" '[ "$(id -u)" = 1000 ] && cd ~/cadre && test -r secrets/ha_token && test -r secrets/cle_cadre \
  && test -r secrets/cle_clevo && test -r data/menus && test -w data/etat' || {
  echo "M900 injoignable, ou secrets / data absents ou illisibles par l'uid 1000 : voir README, Déploiement." >&2
  exit 1
}

echo "3/5 Envoi des sources vers $HOTE_M900:~/cadre/src"
rsync -a --delete --chmod=D755,F644 \
  package.json package-lock.json Dockerfile .dockerignore serveur partage config web \
  "$HOTE_M900:cadre/src/"
rsync -a --chmod=F644 deploiement/docker-compose.yml "$HOTE_M900:cadre/docker-compose.yml"

echo "4/5 Construction et démarrage sur le M900 ($(git rev-parse --short HEAD))"
ssh "$HOTE_M900" 'cd ~/cadre && { ! docker image inspect cadre-bff:local > /dev/null 2>&1 \
  || docker tag cadre-bff:local cadre-bff:precedent; } && docker compose build && docker compose up -d && docker compose ps'

echo "5/5 Santé (attend que Home Assistant réponde)"
reponse=""
for _ in $(seq 1 20); do
  reponse="$(curl -fsS --max-time 3 "$URL_SANTE" 2> /dev/null || true)"
  case "$reponse" in *'"ha":"ok"'*) echo "$reponse"; exit 0 ;; esac
  sleep 2
done
echo "Santé KO (dernière réponse : ${reponse:-aucune}) : ssh $HOTE_M900 'cd ~/cadre && docker compose logs --tail 50'" >&2
exit 1
