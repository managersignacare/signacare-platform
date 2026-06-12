#!/bin/sh
set -eu

if [ -z "${API_UPSTREAM:-}" ]; then
  echo "FATAL: API_UPSTREAM must be explicitly set for the web container proxy." >&2
  echo "Hint: set API_UPSTREAM to the API app URL, e.g. https://signacare-api.azurewebsites.net/api" >&2
  exit 1
fi

UPSTREAM_RAW="${API_UPSTREAM}"
case "$UPSTREAM_RAW" in
  http://*|https://*)
    UPSTREAM="$UPSTREAM_RAW"
    ;;
  *)
    UPSTREAM="https://$UPSTREAM_RAW"
    ;;
esac

UPSTREAM="${UPSTREAM%/}"

UPSTREAM_HOST="$UPSTREAM"
UPSTREAM_HOST="${UPSTREAM_HOST#http://}"
UPSTREAM_HOST="${UPSTREAM_HOST#https://}"
UPSTREAM_HOST="${UPSTREAM_HOST%%/*}"
UPSTREAM_HOST="${UPSTREAM_HOST%%:*}"
if [ -z "$UPSTREAM_HOST" ]; then
  echo "FATAL: Unable to parse API_UPSTREAM host from: $UPSTREAM" >&2
  exit 1
fi

if ! getent hosts "$UPSTREAM_HOST" >/dev/null 2>&1; then
  echo "FATAL: API_UPSTREAM host is not resolvable in this container: $UPSTREAM_HOST" >&2
  exit 1
fi

sed "s|\${API_UPSTREAM}|${UPSTREAM}|" /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
