#!/usr/bin/env bash
# Always push from the fresh repository built here. actions/checkout leaves the job's
# token behind under the URL-scoped key http.<origin>/.extraheader, and git prefers a
# URL-scoped setting over a generic one. Pushing with a different token from inside a
# checked-out repository authenticates as the checkout's token, not the one passed in.
set -euo pipefail

BRANCH="${1:?usage: $0 <branch> <dir> <message>}"
DIR="${2:?usage: $0 <branch> <dir> <message>}"
MESSAGE="${3:?usage: $0 <branch> <dir> <message>}"

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GIT_IDENTITY_NAME:?GIT_IDENTITY_NAME is required}"
: "${GIT_IDENTITY_EMAIL:?GIT_IDENTITY_EMAIL is required}"
REMOTE="${PUSH_REMOTE:-https://github.com/${GITHUB_REPOSITORY:?}.git}"

if [ -e "${DIR}/.git" ]; then
  echo "${DIR} is already a git repository. Only push from a freshly built one." >&2
  exit 1
fi

cd "$DIR"
git init -q -b "$BRANCH"
git config user.name "$GIT_IDENTITY_NAME"
git config user.email "$GIT_IDENTITY_EMAIL"
git add -A
git commit -q -m "$MESSAGE"
# Pass the token through git's credential helper rather than putting it on the argv.
# shellcheck disable=SC2016
GIT_TERMINAL_PROMPT=0 git -c credential.helper= \
  -c credential.helper='!f(){ echo username=x-access-token; echo password="$GH_TOKEN"; };f' \
  push --force --quiet "$REMOTE" "HEAD:refs/heads/${BRANCH}"
