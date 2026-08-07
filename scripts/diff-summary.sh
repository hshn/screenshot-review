#!/usr/bin/env bash
# Turn the classification from diff-collect.sh (on stdin) into Markdown for the job
# summary. Only the columns that actually have an image are emitted — an added screenshot
# has nothing to compare against, so it has no Expected and no Diff.
set -euo pipefail

BASE_URL="${1:?usage: $0 <base-url>}"

TAB="$(printf '\t')"
classification="$(cat)"

if [ -z "$classification" ]; then
  exit 0
fi

changed=0
added=0
while IFS="$TAB" read -r kind _rest; do
  case "$kind" in
    changed) changed=$((changed + 1)) ;;
    added) added=$((added + 1)) ;;
  esac
done <<EOF
$classification
EOF

total=$((changed + added))
if [ "$total" -eq 0 ]; then
  exit 0
fi

breakdown=""
if [ "$changed" -gt 0 ]; then
  breakdown="${changed} changed"
fi
if [ "$added" -gt 0 ]; then
  breakdown="${breakdown:+${breakdown}, }${added} added"
fi

echo "> [!CAUTION]"
echo "> ${total} screenshot(s) need review: ${breakdown}."
echo ""

while IFS="$TAB" read -r kind name images; do
  if [ -z "$name" ]; then
    continue
  fi
  echo "<details><summary><b>${name}</b> (${kind})</summary>"
  echo ""
  header=""
  divider=""
  row=""
  IFS=',' read -r -a columns <<EOF
$images
EOF
  for image in "${columns[@]}"; do
    label="$(printf '%s' "${image}" | cut -c1 | tr '[:lower:]' '[:upper:]')${image#?}"
    header="${header}| ${label} "
    divider="${divider}|---"
    row="${row}| ![${image}](${BASE_URL}/${name}-${image}.png) "
  done
  echo "${header}|"
  echo "${divider}|"
  echo "${row}|"
  echo ""
  echo "</details>"
  echo ""
done <<EOF
$classification
EOF
