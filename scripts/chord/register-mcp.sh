#!/usr/bin/env bash
# Register the Barefoot MCP server with Chord and assign it to the teammate.
# Follows the order in Chord's MCP guide: register disabled -> scope teammate ->
# enable -> discover tools -> health check.
#
# Needs: curl, jq, and a Chord API key with mcp:create, mcp:read, mcp:manage,
# teammate:read, teammate:update.
#   export CHORD_API_KEY=... CHORD_WORKSPACE_ID=... CHORD_TEAMMATE_ID=...
#   export MCP_URL=https://<your-public-host>/mcp MCP_BEARER_TOKEN=...
#   ./scripts/chord/register-mcp.sh
set -euo pipefail

: "${CHORD_BASE_URL:=https://api.chordhq.xyz}"
: "${CHORD_API_KEY:?set CHORD_API_KEY}"
: "${CHORD_WORKSPACE_ID:?set CHORD_WORKSPACE_ID}"
: "${CHORD_TEAMMATE_ID:?set CHORD_TEAMMATE_ID}"
: "${MCP_URL:?set MCP_URL (public https URL ending in /mcp)}"
: "${MCP_BEARER_TOKEN:?set MCP_BEARER_TOKEN}"
command -v jq >/dev/null || { echo "jq is required"; exit 1; }

case "$MCP_URL" in https://*) ;; *) echo "MCP_URL must be public HTTPS; Chord blocks localhost and private IPs."; exit 1;; esac

API="$CHORD_BASE_URL/v1/workspaces/$CHORD_WORKSPACE_ID/mcp-servers"
AUTH=(-H "Authorization: Bearer $CHORD_API_KEY")
JSON=(-H "Content-Type: application/json")

say() { printf '\n== %s\n' "$*"; }

# Log every response with its request id, for the field notes.
call() {
  local out; out=$(mktemp)
  local code; code=$(curl -sS -o "$out" -w '%{http_code}' -D "$out.h" "$@")
  local rid; rid=$(grep -i '^x-request-id:' "$out.h" | tr -d '\r' | cut -d' ' -f2 || true)
  echo "HTTP $code  request-id=${rid:-none}" >&2
  cat "$out"; rm -f "$out" "$out.h"
  [[ "$code" =~ ^2 ]] || return 1
}

say "1. Register the server (disabled)"
SERVER=$(call -X POST "$API" "${AUTH[@]}" "${JSON[@]}" --data "$(jq -n \
  --arg url "$MCP_URL" --arg tok "$MCP_BEARER_TOKEN" \
  '{name:"Barefoot tools", url:$url, auth_type:"bearer", auth_token:$tok, transport:"streamable_http", enabled:false}')")
MCP_ID=$(echo "$SERVER" | jq -r .id)
echo "registered $MCP_ID"

say "2. Restrict the teammate to this server (empty list would mean ALL servers)"
call -X PUT "$CHORD_BASE_URL/v1/teammates/$CHORD_TEAMMATE_ID" "${AUTH[@]}" "${JSON[@]}" \
  --data "$(jq -n --arg id "$MCP_ID" '{set_mcp_server_ids:[$id]}')" | jq '{id, mcp_server_ids}'

say "3. Enable the server (probes need it enabled to send the stored token)"
call -X PUT "$API/$MCP_ID" "${AUTH[@]}" "${JSON[@]}" --data '{"enabled":true}' | jq '{id, enabled}'

say "4. Discover tools"
TOOLS=$(call -X POST "$API/$MCP_ID/tools" "${AUTH[@]}")
echo "$TOOLS" | jq -r '.[].name'

say "5. Health (HTTP 200 does NOT mean healthy; read .status)"
HEALTH=$(call -X POST "$API/$MCP_ID/health" "${AUTH[@]}")
echo "$HEALTH" | jq .
STATUS=$(echo "$HEALTH" | jq -r .status)
[[ "$STATUS" == "ok" ]] || { echo "Health probe status=$STATUS"; exit 1; }

say "6. Allowlist exactly the discovered tools"
call -X PUT "$API/$MCP_ID" "${AUTH[@]}" "${JSON[@]}" \
  --data "$(echo "$TOOLS" | jq '{enabled_tools: [.[].name]}')" | jq '{id, enabled_tools}'

echo
echo "Done. MCP server id: $MCP_ID"
echo "Next: send a message in the simulator that needs a tool, and check 'steps' for tool_name/success."
