#!/bin/sh
# Active les git hooks versionnés du repo (scripts/hooks/).
# À lancer une fois après le clone :  sh scripts/setup-hooks.sh
#
# Sous Windows, lancer depuis Git Bash.

set -e
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath scripts/hooks
chmod +x scripts/hooks/* 2>/dev/null || true
echo "git hooks activés (core.hooksPath = scripts/hooks)."
