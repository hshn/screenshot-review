#!/usr/bin/env bash
# Collect the set of images that need review out of what Playwright left in test-results,
# and classify each one.
#
# The starting point is the actual image. A screenshot with no baseline has nothing to
# compare against, so no diff image is written for it — starting from diff images would
# miss every new screenshot. Only the actual image is always written, for both changed and
# added.
set -euo pipefail

TEST_RESULTS_DIR="${1:?usage: $0 <test-results-dir> <snapshot-dir> <out-dir>}"
SNAPSHOT_DIR="${2:?usage: $0 <test-results-dir> <snapshot-dir> <out-dir>}"
OUT_DIR="${3:?usage: $0 <test-results-dir> <snapshot-dir> <out-dir>}"

mkdir -p "$OUT_DIR"

while IFS= read -r actual_path; do
  name="$(basename "$actual_path" -actual.png)"
  test_dir="$(dirname "$actual_path")"

  cp "$actual_path" "${OUT_DIR}/${name}-actual.png"

  baseline="${SNAPSHOT_DIR}/${name}.png"
  if [ ! -f "$baseline" ]; then
    printf 'added\t%s\tactual\n' "$name"
    continue
  fi

  cp "$baseline" "${OUT_DIR}/${name}-expected.png"
  images="expected,actual"
  # Playwright cannot compare images of different sizes, so it writes no diff image.
  if [ -f "${test_dir}/${name}-diff.png" ]; then
    cp "${test_dir}/${name}-diff.png" "${OUT_DIR}/${name}-diff.png"
    images="${images},diff"
  fi
  printf 'changed\t%s\t%s\n' "$name" "$images"
done < <(find "$TEST_RESULTS_DIR" -name '*-actual.png' 2>/dev/null || true) |
  sort -u |
  sort -t"$(printf '\t')" -k1,1r -k2,2
