# Dockerfile
#
# Rôle    : image du serveur intermédiaire (BFF) du cadre cuisine, construite sur le M900 par
#           deploiement/deployer.sh (conception §2.6, décision de Thomas : construction sur le M900).
# Entrées : package.json + package-lock.json (dépendances figées), serveur/, partage/, config/ (barème des enfants,
#           config/enfants.json, versionné et validé au démarrage) et la page web/.
# Sorties : image qui écoute sur 8020 et lance node serveur/index.js en production (NODE_ENV=production :
#           pas de routes /dev).
# Pièges  :
#   - Pas encore de bundler : la page est servie depuis ses sources (DOSSIER_WEB=web dans le compose). La
#     décision de build se prendra après la mesure de la WebView du cadre ; il faudra alors copier web/dist.
#   - web/compat/ (diagnostic du jour J) n'est pas copié : il ne sert que depuis le Clevo.
#   - Secrets, menus et état ne sont PAS dans l'image : ils sont montés par le compose. Le barème des enfants, lui, y
#     est (règle de la maison, pas une donnée) : le changer demande un nouveau déploiement, avec l'accord de Thomas.

FROM node:22.23.3-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY serveur/ serveur/
COPY partage/ partage/
COPY config/ config/
COPY web/index.html web/index.html
COPY web/src/ web/src/
COPY web/styles/ web/styles/
COPY web/public/ web/public/

USER node
EXPOSE 8020
CMD ["node", "serveur/index.js"]
