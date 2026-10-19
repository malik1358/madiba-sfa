#!/usr/bin/env bash
# Promote the current main branch (KPI personalized pace release) to production on Vercel.
# Usage: VERCEL_TOKEN=<token> ./scripts/promote-to-production.sh [project-slug]
set -euo pipefail

TOKEN="${VERCEL_TOKEN:?ERROR: set VERCEL_TOKEN env var (Vercel Dashboard -> Account Settings -> Tokens)}"
PROJECT_SLUG="${1:-madiba-sfa}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse --short HEAD)"

if [ "$BRANCH" != "main" ]; then
  echo "ERROR: must be on main to promote to production (currently on $BRANCH)"; exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: uncommitted changes present — commit or stash first"; exit 1
fi

echo "==> Building & deploying $SHA from $BRANCH to PRODUCTION ($PROJECT_SLUG)"
npx vercel deploy --prod --token "$TOKEN" \
  --message "release $SHA: personalized KPI pace v2026.10.19-kpi-pace"

echo "==> Done. Assigning tag v2026.10.19-kpi-pace to $SHA (local only until remote is configured)"
if git remote get-url origin >/dev/null 2>&1; then
  git push origin "$BRANCH" --follow-tags
  echo "==> Pushed $BRANCH + tags to origin"
else
  echo "NOTE: no 'origin' remote configured. Add it with:"
  echo "      git remote add origin <your-repo-url> && git push origin main --follow-tags"
fi
