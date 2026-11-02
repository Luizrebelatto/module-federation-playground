#!/usr/bin/env bash
set -euo pipefail

# Publishes a channel's manifest to S3 (served by CloudFront).
# It is the ONLY mutable file: upload it last, after the bundles already exist.

DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ ! -f "$DIR/cdn.env" ]]; then
  echo "create release/cdn.env from release/cdn.env.example" >&2
  exit 1
fi
source "$DIR/cdn.env"

usage() {
  echo "usage: $0 <staging|production> [--local-remote]" >&2
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
    [[ "$CHANNEL" == staging ]] || { echo "--local-remote is only allowed on staging" >&2; exit 1; }
    SOURCE="$DIR/manifest.dev.json"
    ;;
  *) usage ;;
esac

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Validate schema, channel and HTTPS in entries before touching AWS.
node - "$SOURCE" "$CHANNEL" "$MODE" "$TMP" <<'JS'
const fs = require('node:fs');
const [source, channel, mode, out] = process.argv.slice(2);
const fail = (message) => {
  console.error(`invalid manifest (${source}): ${message}`);
  process.exit(1);
};

const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
if (mode === '--local-remote') manifest.channel = channel;

if (manifest.schema !== 1) fail('schema must be 1');
if (manifest.channel !== channel) fail(`channel "${manifest.channel}" != "${channel}"`);
if (typeof manifest.remotes !== 'object' || manifest.remotes === null) fail('remotes missing');

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
  if (!valid) fail(`remote "${name}" does not match the schema`);

  if (mode !== '--local-remote') {
    for (const entry of Object.values(release.entries)) {
      if (!entry.startsWith('https://')) fail(`remote "${name}" has a non-HTTPS entry: ${entry}`);
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

[[ -n "$CDN_BUCKET" ]] || { echo "fill in CDN_BUCKET in release/cdn.env" >&2; exit 1; }

export AWS_PROFILE="${AWS_PROFILE:-$CDN_AWS_PROFILE}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [[ "$ACCOUNT" != "$CDN_ACCOUNT_ID" ]]; then
  echo "profile $AWS_PROFILE is on account $ACCOUNT, expected $CDN_ACCOUNT_ID" >&2
  exit 1
fi

# max-age=60 → a rollback / kill switch reaches clients within 1 min, with no invalidation.
aws s3 cp "$TMP" "s3://$CDN_BUCKET/$KEY" \
  --cache-control "public, max-age=60" \
  --content-type application/json

echo
echo "Published: $URL"
echo "CloudFront may serve the previous version for up to 60 s."
curl -sI "$URL" | grep -iE '^(HTTP/|x-cache|cache-control|last-modified)' || true
