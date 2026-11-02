#!/usr/bin/env bash
set -euo pipefail

# Builds the products-remote container and publishes it to S3, in an IMMUTABLE per-version folder.
# Run it BEFORE publish-manifest.sh: the manifest may only point at bundles that already exist.
#
#   release/publish-remote.sh 1.0.0
#   DRY_RUN=1 release/publish-remote.sh 1.0.0   # builds and prints, without uploading

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
REMOTE="$ROOT/products-remote"

[[ -f "$DIR/cdn.env" ]] || { echo "create release/cdn.env from release/cdn.env.example" >&2; exit 1; }
source "$DIR/cdn.env"

VERSION="${1:-}"
[[ -n "$VERSION" ]] || { echo "usage: $0 <version>   (e.g. 1.0.0)" >&2; exit 1; }

export AWS_PROFILE="${AWS_PROFILE:-$CDN_AWS_PROFILE}"

for PLATFORM in ios android; do
  OUT="$REMOTE/build/release/$PLATFORM/$VERSION"
  rm -rf "$OUT"; mkdir -p "$OUT"

  echo ">> building the container ($PLATFORM, v$VERSION)"
  # Re.Pack/Rspack emits products.container.bundle + chunks + assets into this directory.
  # (flags may vary depending on the Re.Pack version.)
  ( cd "$REMOTE" && npx react-native bundle \
      --platform "$PLATFORM" \
      --entry-file index.js \
      --bundle-output "$OUT/index.bundle" \
      --assets-dest "$OUT" \
      --dev false )

  KEY="$CDN_PREFIX/products/$PLATFORM/$VERSION"
  if [[ "${DRY_RUN:-}" == 1 ]]; then
    echo "DRY_RUN: s3://${CDN_BUCKET:-<CDN_BUCKET>}/$KEY/  <=  $OUT"
    ls -1 "$OUT"
    continue
  fi

  [[ -n "${CDN_BUCKET:-}" ]] || { echo "fill in CDN_BUCKET in release/cdn.env" >&2; exit 1; }

  # A per-version folder is never overwritten → 1-year cache, no invalidation.
  # Sourcemaps (*.map) stay off the public CDN.
  aws s3 sync "$OUT" "s3://$CDN_BUCKET/$KEY/" \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "*.map"
done

echo
echo "Bundles published under $CDN_PREFIX/products/<platform>/$VERSION/"
echo "Now point the manifest (entries → version $VERSION) and run publish-manifest.sh."
