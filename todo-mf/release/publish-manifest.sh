#!/usr/bin/env bash
# Publica o manifesto de um canal no S3, servido pelo CloudFront em $CDN_URL/manifests/<canal>.json.
#
# Uso:
#   release/publish-manifest.sh staging                  publica release/manifest.staging.json
#   release/publish-manifest.sh production               publica release/manifest.prod.json
#   release/publish-manifest.sh staging --local-remote   publica o manifesto dev com channel=staging, apontando
#                                                        para o remote em localhost (só para testar o app)
#
# DRY_RUN=1 valida e mostra o manifesto sem falar com a AWS.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
# cdn.env não é commitado (repo público): bucket e conta ficam só na máquina de quem publica.
if [[ ! -f "$DIR/cdn.env" ]]; then
  echo "crie release/cdn.env a partir de release/cdn.env.example" >&2
  exit 1
fi
# shellcheck source=cdn.env.example
source "$DIR/cdn.env"

usage() {
  echo "uso: $0 <staging|production> [--local-remote]" >&2
  exit 1
}

CHANNEL="${1:-}"
MODE="${2:-}"

case "$CHANNEL" in
  staging) SOURCE="$DIR/manifest.staging.json" ;;
  production) SOURCE="$DIR/manifest.prod.json" ;;
  *) usage ;;
esac

case "$MODE" in
  "") ;;
  --local-remote)
    [[ "$CHANNEL" == staging ]] || { echo "--local-remote só é permitido em staging" >&2; exit 1; }
    SOURCE="$DIR/manifest.dev.json"
    ;;
  *) usage ;;
esac

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Mesmas regras do parseManifest do host, mais: canal certo e nada de http/localhost fora do --local-remote.
node - "$SOURCE" "$CHANNEL" "$MODE" "$TMP" <<'JS'
const fs = require('node:fs');
const [source, channel, mode, out] = process.argv.slice(2);
const fail = (message) => {
  console.error(`manifesto inválido (${source}): ${message}`);
  process.exit(1);
};

const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
if (mode === '--local-remote') manifest.channel = channel;

if (manifest.schema !== 1) fail('schema precisa ser 1');
if (manifest.channel !== channel) fail(`channel "${manifest.channel}" != "${channel}"`);
if (typeof manifest.remotes !== 'object' || manifest.remotes === null) fail('remotes ausente');

const isString = (value) => typeof value === 'string';
for (const [name, release] of Object.entries(manifest.remotes)) {
  const compat = release.compatibility ?? {};
  const valid =
    typeof release.enabled === 'boolean' &&
    isString(release.container) &&
    isString(release.releaseId) &&
    typeof release.entries === 'object' &&
    release.entries !== null &&
    typeof compat.runtimeApi === 'number' &&
    [compat.contract, compat.react, compat.reactNative, compat.minHostVersion, compat.maxHostVersionExclusive].every(isString);
  if (!valid) fail(`remote "${name}" fora do schema`);

  if (mode !== '--local-remote') {
    for (const entry of Object.values(release.entries)) {
      if (!entry.startsWith('https://')) fail(`remote "${name}" tem entry sem HTTPS: ${entry}`);
    }
  }
}

fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
JS

KEY="$CDN_PREFIX/manifests/$CHANNEL.json"
URL="$CDN_URL/manifests/$CHANNEL.json"

if [[ "${DRY_RUN:-}" == 1 ]]; then
  echo "DRY_RUN: s3://${CDN_BUCKET:-<CDN_BUCKET>}/$KEY"
  cat "$TMP"
  exit 0
fi

[[ -n "$CDN_BUCKET" ]] || { echo "preencha CDN_BUCKET em release/cdn.env" >&2; exit 1; }

export AWS_PROFILE="${AWS_PROFILE:-$CDN_AWS_PROFILE}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [[ "$ACCOUNT" != "$CDN_ACCOUNT_ID" ]]; then
  echo "o perfil $AWS_PROFILE está na conta $ACCOUNT, esperado $CDN_ACCOUNT_ID" >&2
  exit 1
fi

# Manifesto é o único arquivo mutável: cache curto para rollback e kill switch chegarem rápido.
aws s3 cp "$TMP" "s3://$CDN_BUCKET/$KEY" \
  --cache-control "public, max-age=60" \
  --content-type application/json

echo
echo "Publicado: $URL"
echo "O CloudFront pode servir a versão anterior por até 60 s."
curl -sI "$URL" | grep -iE '^(HTTP/|x-cache|cache-control|last-modified)' || true
