#!/usr/bin/env bash
# Publish one generation of baseline images. The branch is rebuilt from scratch as a
# single commit every time: the images have no history worth keeping, and stacking them up
# makes every consumer's clone heavier forever.
set -euo pipefail

BRANCH="screenshot-baselines"
DIR=".screenshot-baselines"
KEEP=100
SHA=""

while [ $# -gt 0 ]; do
  case "$1" in
    --sha) SHA="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$SHA" ]; then
  echo "Usage: $0 --sha <sha> [--branch <name>] [--dir <path>] [--keep <n>]" >&2
  echo "Requires GH_TOKEN, GIT_IDENTITY_NAME and GIT_IDENTITY_EMAIL in the environment." >&2
  exit 1
fi

work="$(mktemp -d)"

# Tell "the branch is not there" apart from "the fetch failed". Conflating them would, on
# a transient fetch failure, rebuild the branch from a single generation and silently drop
# every generation that was being kept.
set +e
git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null
found=$?
set -e
case "$found" in
  0)
    git fetch --no-tags origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
    git archive "refs/remotes/origin/${BRANCH}" | tar -x -C "$work"
    ;;
  2) ;; # not there yet — start from nothing
  *)
    echo "Could not tell whether the ${BRANCH} branch exists." >&2
    exit "$found"
    ;;
esac

rm -rf "${work:?}/${SHA}"
mkdir -p "${work}/${SHA}"
cp "${DIR}"/*.png "${work}/${SHA}/"

{
  echo "$SHA"
  [ -f "${work}/manifest" ] && grep -vx "$SHA" "${work}/manifest" || true
} | head -n "$KEEP" > "${work}/manifest.next"
mv "${work}/manifest.next" "${work}/manifest"
echo "$SHA" > "${work}/latest"

for dir in "${work}"/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  grep -qx "$name" "${work}/manifest" || rm -rf "$dir"
done

generations="$(wc -l < "${work}/manifest")"

bash "$(dirname "$0")/replace-branch-with-dir.sh" \
  "$BRANCH" "$work" "test: baselines for ${SHA}"

echo "published ${SHA} (keeping ${generations} generations)"
