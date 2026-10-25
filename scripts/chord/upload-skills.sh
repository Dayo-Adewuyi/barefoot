#!/usr/bin/env bash
# Upload every folder in skills/ to the Chord teammate, publish it and include it.
# Creates the skill if no skill of that name exists, otherwise saves a new draft
# with the complete file set and publishes it (a new immutable revision).
#
# Needs: curl, jq, and a Chord API key with teammate:read and teammate:update.
#
#   export CHORD_API_KEY=... CHORD_TEAMMATE_ID=...
#   ./scripts/chord/upload-skills.sh
set -euo pipefail

: "${CHORD_BASE_URL:=https://api.chordhq.xyz}"
: "${CHORD_API_KEY:?set CHORD_API_KEY}"
: "${CHORD_TEAMMATE_ID:?set CHORD_TEAMMATE_ID}"
command -v jq >/dev/null || { echo "jq is required"; exit 1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API="$CHORD_BASE_URL/v1/teammates/$CHORD_TEAMMATE_ID/skills"
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

# {path, content} for every file in a skill folder, SKILL.md first. Chord stores
# paths prefixed with the skill name ("referral/SKILL.md").
files_json() {
  (cd "$1/.." && find "$2" -type f \( -name '*.md' -o -name '*.txt' -o -name '*.json' -o -name '*.yaml' -o -name '*.yml' -o -name '*.csv' \) \
    | sort | awk -v e="$2/SKILL.md" '$0==e{print; next} {rest=rest $0 "\n"} END{printf "%s", rest}' \
    | while read -r f; do jq -n --arg p "$f" --rawfile c "$f" '{path:$p, content:$c}'; done) | jq -s .
}

say "Existing skills on the teammate"
EXISTING=$(call "$API" "${AUTH[@]}")
echo "$EXISTING" | jq -c '[.skills[] | {id, name, version, published_version, included}]'

for dir in "$ROOT"/skills/*/; do
  name=$(basename "$dir")
  files=$(files_json "$dir" "$name")
  say "$name ($(echo "$files" | jq length) files, $(du -sk "$dir" | cut -f1) KiB)"
  key="barefoot-$name-$(date +%s)"
  sid=$(echo "$EXISTING" | jq -r --arg n "$name" '[.skills[] | select(.name == $n)][0].id // empty')
  live=$(echo "$EXISTING" | jq -c --arg n "$name" '[.skills[] | select(.name == $n)][0].published.files // [] | map({path, content}) | sort_by(.path)')
  if [[ -n "$sid" && "$live" == "$(echo "$files" | jq -c 'sort_by(.path)')" ]]; then
    echo "unchanged, skipped"; continue
  fi

  if [[ -z "$sid" ]]; then
    SKILL=$(call -X POST "$API" "${AUTH[@]}" "${JSON[@]}" --data "$(jq -n --arg n "$name" --arg k "$key-create" --argjson f "$files" \
      '{name:$n, entrypoint:($n + "/SKILL.md"), files:$f, idempotency_key:$k}')")
    sid=$(echo "$SKILL" | jq -r '.id')
    echo "created $sid"
  else
    ver=$(echo "$EXISTING" | jq -r --arg n "$name" '[.skills[] | select(.name == $n)][0].version')
    SKILL=$(call -X PUT "$API/$sid/draft" "${AUTH[@]}" "${JSON[@]}" --data "$(jq -n --arg n "$name" --argjson v "$ver" --argjson f "$files" \
      '{name:$n, entrypoint:($n + "/SKILL.md"), files:$f, expected_version:$v}')")
    echo "draft saved on $sid"
  fi

  ver=$(echo "$SKILL" | jq -r '.version')
  SKILL=$(call -X POST "$API/$sid/publish" "${AUTH[@]}" "${JSON[@]}" --data "$(jq -n --argjson v "$ver" --arg k "$key-publish" \
    '{expected_version:$v, summary:"Upload from repo", idempotency_key:$k}')")
  echo "$SKILL" | jq -c '{published_version, included}'

  if [[ "$(echo "$SKILL" | jq -r '.included')" != "true" ]]; then
    ver=$(echo "$SKILL" | jq -r '.version')
    call -X PATCH "$API/$sid" "${AUTH[@]}" "${JSON[@]}" --data "$(jq -n --argjson v "$ver" --arg k "$key-include" \
      '{expected_version:$v, included:true, idempotency_key:$k}')" | jq -c '{included}'
  fi
done
echo
