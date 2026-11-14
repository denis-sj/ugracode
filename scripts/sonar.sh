#!/usr/bin/env bash
# Прогон SonarQube-анализа через официальный scanner.
# Токен берётся только из окружения или .env (файл в .gitignore); в репозиторий не попадает.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo "SONAR_TOKEN не задан: положите его в .env или окружение (см. docs/hackathon/delivery.md)." >&2
  exit 1
fi

HOST_URL="${SONAR_HOST_URL:-http://host.docker.internal:9000}"

docker run --rm \
  -e SONAR_HOST_URL="$HOST_URL" \
  -e SONAR_TOKEN="$SONAR_TOKEN" \
  -v "$PWD:/usr/src" \
  sonarsource/sonar-scanner-cli
