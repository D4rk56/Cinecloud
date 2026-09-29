# ==============================================================================
# Dockerfile pour Nuvio-Alldebrid Addon
# Image de base légère et sécurisée basée sur Alpine Linux
# ==============================================================================

FROM node:20-alpine

# Définition des variables d'environnement de production
ENV NODE_ENV=production \
    PORT=3000

# Répertoire de travail de l'application
WORKDIR /app

# Création du dossier data pour la persistance du cache local et attribution des permissions à l'utilisateur node
RUN mkdir -p /app/data && chown -R node:node /app

# Copie des fichiers de dépendances
COPY --chown=node:node package*.json ./

# Exécution sous un utilisateur non-root pour des raisons de sécurité
USER node

# Installation des dépendances de production uniquement et nettoyage du cache npm
RUN npm install --omit=dev && npm cache clean --force

# Copie de l'intégralité du code source
COPY --chown=node:node . .

# Exposition du port d'écoute HTTP
EXPOSE 3000

# Vérification de l'état de santé du service (Healthcheck)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:3000/ || exit 1

# Lancement de l'application
CMD ["node", "index.js"]
