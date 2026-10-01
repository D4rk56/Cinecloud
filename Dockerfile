# ==============================================================================
# Dockerfile pour Nuvio-Alldebrid Addon (CinéCloud FR)
# Multi-stage build léger et sécurisé basé sur Node.js 24 Alpine Linux
# ==============================================================================

# Étape 1 : Construction et compilation des dépendances natives (anitomy-js / node-gyp)
FROM node:24-alpine AS builder

WORKDIR /app

# Outils de compilation C++ requis par node-gyp sur Alpine
RUN apk add --no-cache python3 make g++ gcc

# Copie des fichiers de dépendances
COPY package*.json ./

# Compilation native des dépendances de production
RUN npm install --omit=dev && npm cache clean --force

# Étape 2 : Image d'exécution minimale pour la production
FROM node:24-alpine

# Définition des variables d'environnement de production
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--experimental-sqlite"

WORKDIR /app

# Installation de libstdc++ et su-exec (pour gestion des accès et permissions du volume /app/data)
RUN apk add --no-cache libstdc++ su-exec \
    && mkdir -p /app/data \
    && chown -R node:node /app

# Copie du code source de l'application
COPY --chown=node:node package*.json ./
COPY --chown=node:node . .

# Copie des dépendances de production compilées depuis l'étape builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Configuration du script d'entrée assurant les accès et permissions
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Exposition du port d'écoute HTTP
EXPOSE 3000

# Vérification de l'état de santé du service (Healthcheck)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:3000/ || exit 1

# Script d'entrée pour sécuriser les permissions et lancer l'application
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "index.js"]
