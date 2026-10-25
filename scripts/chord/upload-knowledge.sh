#!/usr/bin/env bash
# Upload the knowledge bundle to Chord and attach it to the teammate.
# Uploads the 2024 National Standing Orders sections plus the `demo` chapters of
# Where There Is No Doctor. Never uploads the excluded Green Pages.
#
# Needs: curl, jq, and a Chord API key with rag:ingest and rag:retrieve.
#
#   export CHORD_API_KEY=... CHORD_TEAMMATE_ID=...
#   export KNOWLEDGE_BUNDLE_ID=kb-...   # optional: reuse a bundle from an earlier run
#   export KNOWLEDGE_BUNDLE_NAME=...    # optional: name for a new bundle (Chord returns 500 on a duplicate name)
#   ./scripts/chord/upload-knowledge.sh
#
# Safe to re-run: documents already in the bundle (same title) are skipped.
set -euo pipefail

: "${CHORD_BASE_URL:=https://api.chordhq.xyz}"
: "${CHORD_API_KEY:?set CHORD_API_KEY}"
: "${CHORD_TEAMMATE_ID:?set CHORD_TEAMMATE_ID}"
command -v jq >/dev/null || { echo "jq is required"; exit 1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NG="$ROOT/knowledge/national-guidelines"
WTND="$ROOT/knowledge/where-there-is-no-doctor"
API="$CHORD_BASE_URL/v1/knowledge/bundles"
AUTH=(-H "Authorization: Bearer $CHORD_API_KEY")

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

if [[ -z "${KNOWLEDGE_BUNDLE_ID:-}" ]]; then
  say "1. Create the bundle, owned by the teammate"
  BUNDLE=$(call -X POST "$API" "${AUTH[@]}" -H "Content-Type: application/json" --data "$(jq -n \
    --arg tm "$CHORD_TEAMMATE_ID" --arg n "${KNOWLEDGE_BUNDLE_NAME:-Barefoot clinical knowledge}" \
    '{name:$n, owner_teammate_id:$tm}')")
  KNOWLEDGE_BUNDLE_ID=$(echo "$BUNDLE" | jq -r .id)
  echo "created $KNOWLEDGE_BUNDLE_ID (export KNOWLEDGE_BUNDLE_ID=$KNOWLEDGE_BUNDLE_ID to re-run)"
else
  say "1. Reusing bundle $KNOWLEDGE_BUNDLE_ID"
fi

say "2. Titles already in the bundle"
EXISTING=$(call "$API/$KNOWLEDGE_BUNDLE_ID/documents" "${AUTH[@]}" | jq -r '[.. | objects | .title? // empty] | .[]')
echo "${EXISTING:-(none)}"

# upload <file> <title> <category>
upload() {
  if grep -qxF "$2" <<<"$EXISTING"; then echo "skip: $2"; return; fi
  echo "upload: $2"
  local q; q=$(jq -rn --arg t "$2" --arg c "$3" '"title=\($t|@uri)&category=\($c|@uri)"')
  call -X POST "$API/$KNOWLEDGE_BUNDLE_ID/documents?$q" "${AUTH[@]}" \
    -F "files=@$1;type=text/markdown" | jq -c '{stored_chunks}' || { echo "FAILED: $2"; FAILED=$((FAILED + 1)); }
}

FAILED=0
say "3. National Standing Orders 2024 (highest precedence)"
while IFS=$'\t' read -r file cadre section title group first last; do
  upload "$NG/$file" "$cadre Standing Orders $section: $title ($group, pp. $first-$last)" "standing-orders-$(tr '[:upper:]' '[:lower:]' <<<"$cadre")"
done < <(jq -r '.[] | [.file, .cadre, .section, .title, .age_group, .pages[0], .pages[1]] | @tsv' "$NG/manifest.json")

say "4. Where There Is No Doctor, demo chapters (recognition and first aid only)"
while IFS=$'\t' read -r file title first last; do
  upload "$WTND/$file" "Where There Is No Doctor: $title (pp. $first-$last)" "where-there-is-no-doctor"
done < <(jq -r '.[] | select(.set=="demo") | [.file, .title, .book_pages[0], .book_pages[1]] | @tsv' "$WTND/manifest.json")

say "5. Share the bundle with the teammate (owner_teammate_id alone does not grant access)"
call -X POST "$API/$KNOWLEDGE_BUNDLE_ID/shares" "${AUTH[@]}" -H "Content-Type: application/json" \
  --data "$(jq -n --arg tm "$CHORD_TEAMMATE_ID" '{teammate_id:$tm}')" | jq -c '.access'

say "6. Check the teammate can see the bundle"
call "$API/accessible?teammate_id=$CHORD_TEAMMATE_ID" "${AUTH[@]}" \
  | jq --arg id "$KNOWLEDGE_BUNDLE_ID" '[.. | objects | select(.id? == $id) | {id, name}]'

echo
echo "Done. Bundle id: $KNOWLEDGE_BUNDLE_ID"
[[ "$FAILED" -eq 0 ]] || { echo "$FAILED document(s) FAILED; fix them and re-run with KNOWLEDGE_BUNDLE_ID set"; exit 1; }
