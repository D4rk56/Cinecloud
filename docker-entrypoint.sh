#!/bin/sh
set -e

# S'assurer que le répertoire de données persistant existe
mkdir -p /app/data

# Si le conteneur démarre sous root, ajuster les permissions de /app/data
# et exécuter l'application sous l'utilisateur non-privilégié node
if [ "$(id -u)" = '0' ]; then
    chown -R node:node /app/data
    exec su-exec node "$@"
fi

exec "$@"
