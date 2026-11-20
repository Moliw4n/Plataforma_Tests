#!/usr/bin/env bash
# Llama a latido() del proyecto de PRODUCCIÓN para que Supabase no lo pause por inactividad.
# Usa la URL y la clave PUBLISHABLE de js/config.js (son públicas por diseño; la clave secret nunca va aquí).
# Variables opcionales (para las pruebas): LATIDO_URL, LATIDO_KEY, LATIDO_CONFIG,
# LATIDO_SIMULACRO=1 (solo lee la configuración y sale, sin llamar a nadie).
set -euo pipefail
cd "$(dirname "$0")/../.."
CONFIG="${LATIDO_CONFIG:-js/config.js}"
URL="${LATIDO_URL:-$(grep -oE 'https://[a-z0-9]+\.supabase\.co' "$CONFIG" | head -1 || true)}"
KEY="${LATIDO_KEY:-$(grep -oE 'sb_publishable_[A-Za-z0-9_-]+' "$CONFIG" | head -1 || true)}"
if [ -z "$URL" ] || [ -z "$KEY" ]; then echo "No encuentro la URL o la clave en $CONFIG"; exit 1; fi
echo "Latido a $URL"
[ -z "${LATIDO_SIMULACRO:-}" ] || { echo "(simulacro: no se llama a nadie)"; exit 0; }
RESP=$(curl -fsS --max-time 30 --retry 2 -X POST "$URL/rest/v1/rpc/latido" \
  -H "apikey: $KEY" -H "Content-Type: application/json" -d '{}') || { echo "La llamada a latido() ha fallado"; exit 1; }
echo "Respuesta: $RESP"
echo "$RESP" | grep -Eq '"ok": *true' || { echo "latido() no ha devuelto ok"; exit 1; }
