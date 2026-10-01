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

# Installation de libstdc++ (requis par les extensions C++ compilées sur Alpine musl)
# et préparation du répertoire de données persistant
RUN apk add --no-cache libstdc++ \
    && mkdir -p /app/data \
    && chown -R node:node /app

# Copie du code source de l'application
COPY --chown=node:node package*.json ./
COPY --chown=node:node . .

# Copie des dépendances de production compilées depuis l'étape builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Exécution sous un utilisateur non-root pour des raisons de sécurité
USER node

# Exposition du port d'écoute HTTP
EXPOSE 3000

# Vérification de l'état de santé du service (Healthcheck)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:3000/ || exit 1

# Lancement de l'application
CMD ["node", "index.js"]
