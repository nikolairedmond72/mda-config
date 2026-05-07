#!/usr/bin/env bash
# scripts/release.sh
#
# One-shot release helper for `@snoai/mda-config`.
#
#   Usage:  scripts/release.sh <semver>          # e.g. scripts/release.sh 1.0.0
#           scripts/release.sh 1.0.0 --local     # publish from this machine instead of CI
#
# Default flow (RECOMMENDED for first release and all subsequent):
#   1. Verify the workspace is clean (no uncommitted changes).
#   2. Verify the requested version matches packages/typescript/package.json.
#   3. Run typecheck + tests + build + npm publish --dry-run; refuse to continue
#      if anything fails or the tarball contains files outside the §6.1 allow-list.
#   4. Create an annotated git tag `vX.Y.Z`.
#   5. Push the current branch and the tag to `origin`.
#   6. The GitHub Actions workflow `.github/workflows/publish.yml` picks up
#      the tag and runs `npm publish --provenance` from CI. Provenance REQUIRES
#      the GitHub repo to be public — flip visibility BEFORE pushing the tag
#      (Settings → General → Change visibility → Public).
#
# `--local` flow (only for emergencies — no provenance, no Sigstore attestation):
#   Steps 1-3 as above, then `npm publish` from this machine using your local
#   `~/.npmrc` credentials.

set -euo pipefail

# ─── parse args ──────────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "usage: $0 <semver> [--local]" >&2
  exit 64
fi
VERSION="$1"
shift || true
MODE="ci"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) MODE="local" ;;
    *) echo "unknown flag: $1" >&2; exit 64 ;;
  esac
  shift
done

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "version must be SemVer (e.g. 1.0.0 or 1.0.0-rc.1), got: $VERSION" >&2
  exit 64
fi

# ─── locate repo root ────────────────────────────────────────────────────────
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$REPO/packages/typescript"
cd "$REPO"

# ─── 1. workspace clean ──────────────────────────────────────────────────────
if [[ -n "$(git status --porcelain)" ]]; then
  echo "workspace has uncommitted changes; commit or stash first." >&2
  git status --short >&2
  exit 1
fi

# ─── 2. version matches package.json ─────────────────────────────────────────
PKG_VERSION="$(node -p "require('$PKG/package.json').version")"
if [[ "$PKG_VERSION" != "$VERSION" ]]; then
  echo "package.json version is $PKG_VERSION but you asked to release $VERSION." >&2
  echo "Either update packages/typescript/package.json or pass the matching version." >&2
  exit 1
fi

# ─── 3. quality gates ────────────────────────────────────────────────────────
echo ">>> bun install (frozen lockfile)"
bun install --frozen-lockfile

echo ">>> typecheck"
( cd "$PKG" && bun run typecheck )

echo ">>> test"
( cd "$PKG" && bun run test )

echo ">>> build"
( cd "$PKG" && bun run build )

echo ">>> npm publish --dry-run"
DRY_OUT="$(cd "$PKG" && npm publish --dry-run 2>&1)"
echo "$DRY_OUT"

# ── tarball allow-list check (PRD §6.1) ──
ALLOWED='^(dist/.*|README\.md|LICENSE|CHANGELOG\.md|package\.json)$'
BAD="$(echo "$DRY_OUT" \
  | sed -n 's/^npm notice [0-9.]*[a-zA-Z]*B //p' \
  | grep -Ev "$ALLOWED" || true)"
if [[ -n "$BAD" ]]; then
  echo
  echo "ERROR: tarball contains files outside the §6.1 allow-list:" >&2
  echo "$BAD" >&2
  exit 1
fi

# ─── 4 + 5. tag + push (CI mode) or local publish ────────────────────────────
if [[ "$MODE" == "ci" ]]; then
  TAG="v$VERSION"
  if git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
    echo "tag $TAG already exists." >&2
    exit 1
  fi

  echo
  echo ">>> About to tag $TAG and push to origin."
  echo "    Make sure: (1) origin remote is set, (2) NPM_TOKEN is configured"
  echo "    in GitHub repo secrets, (3) repo visibility is PUBLIC if you want"
  echo "    npm provenance to work."
  read -r -p "Proceed? [y/N] " ans
  if [[ "${ans,,}" != "y" ]]; then
    echo "aborted."
    exit 0
  fi

  git tag -a "$TAG" -m "Release $TAG"
  git push origin HEAD
  git push origin "$TAG"
  echo
  echo "Tag $TAG pushed. The GitHub Actions Publish workflow will now run."
  echo "Watch:  gh run watch  (or)  https://github.com/sno-ai/mda-config/actions"
else
  # local mode
  echo
  echo ">>> Publishing from THIS machine (no provenance attestation)."
  read -r -p "Proceed with local 'npm publish'? [y/N] " ans
  if [[ "${ans,,}" != "y" ]]; then
    echo "aborted."
    exit 0
  fi
  ( cd "$PKG" && npm publish )
  echo
  echo "Published @snoai/mda-config@$VERSION (no provenance)."
  echo "Verify: npm view @snoai/mda-config@$VERSION"
fi
