#!/usr/bin/env bash
set -euo pipefail

# Builda o container do products-remote e publica no S3, em pasta IMUTÁVEL por versão.
# Rode ANTES do publish-manifest.sh: o manifesto só pode apontar para bundles que já existem.
#
#   release/publish-remote.sh 1.0.0
#   DRY_RUN=1 release/publish-remote.sh 1.0.0   # builda e mostra, sem subir

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
REMOTE="$ROOT/products-remote"

[[ -f "$DIR/cdn.env" ]] || { echo "crie release/cdn.env a partir de release/cdn.env.example" >&2; exit 1; }
source "$DIR/cdn.env"

VERSION="${1:-}"
[[ -n "$VERSION" ]] || { echo "uso: $0 <versão>   (ex: 1.0.0)" >&2; exit 1; }

export AWS_PROFILE="${AWS_PROFILE:-$CDN_AWS_PROFILE}"

for PLATFORM in ios android; do
  OUT="$REMOTE/build/release/$PLATFORM/$VERSION"
  rm -rf "$OUT"; mkdir -p "$OUT"

  echo ">> build do container ($PLATFORM, v$VERSION)"
  # Re.Pack/Rspack emite products.container.bundle + chunks + assets neste diretório.
  # (as flags podem variar conforme a versão do Re.Pack.)
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

  [[ -n "${CDN_BUCKET:-}" ]] || { echo "preencha CDN_BUCKET em release/cdn.env" >&2; exit 1; }

  # Pasta por versão nunca é sobrescrita → cache de 1 ano, sem invalidation.
  # Sourcemaps (*.map) ficam fora da CDN pública.
  aws s3 sync "$OUT" "s3://$CDN_BUCKET/$KEY/" \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "*.map"
done

echo
echo "Bundles publicados em $CDN_PREFIX/products/<plataforma>/$VERSION/"
echo "Agora aponte o manifesto (entries → versão $VERSION) e rode publish-manifest.sh."
