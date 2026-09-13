#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mdview_version=$(node -p "require('./package.json').version")
mdview_archive=${1:-"release/MDView-${mdview_version}-linux-x64.tar.gz"}
mdview_test_directory=$(mktemp -d /tmp/mdview-linux-test.XXXXXX)
cleanup() {
  if [[ "$mdview_test_directory" == /tmp/mdview-linux-test.* && -d "$mdview_test_directory" ]]; then
    rm -rf -- "$mdview_test_directory"
  fi
}
trap cleanup EXIT
tar -xzf "$mdview_archive" -C "$mdview_test_directory"
mdview_binary=$(find "$mdview_test_directory" -maxdepth 2 -type f -name mdview -print -quit)
test -n "$mdview_binary"
test -x "$mdview_binary"
export MDVIEW_EXECUTABLE="$mdview_binary"
xvfb-run -a node node_modules/@playwright/test/cli.js test --max-failures=1 --output=test-results/linux-package
