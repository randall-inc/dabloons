#!/bin/sh
# Fails if the repo contains test files or test-runner imports/deps.
# We don't write unit tests here; see CLAUDE.md.
files=$(git ls-files | grep -E '(^|/)(tests?|__tests__|e2e)/|\.(test|spec)\.[cm]?[jt]sx?$|(^|/)test-[^/]*\.[cm]?[jt]sx?$')
refs=$(git grep -lE "['\"](node:test|bun:test|vitest|jest|@jest/globals|mocha|@playwright/test)['\"]" -- ':!scripts/no-tests.sh' ':!*package-lock.json')
if [ -n "$files$refs" ]; then
  echo "Tests are not allowed in this repo (see CLAUDE.md). Remove:"
  printf '%s\n' $files $refs
  exit 1
fi
