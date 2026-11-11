#!/usr/bin/env bash
# Uploads the build's readiness/history.json to a site bucket only when the bucket
# has no history yet, so /ai-readiness never fetches a missing file. Once the
# weekly job (.github/workflows/site-readiness.yml) has written the file, this
# does nothing. Any error other than "not found" stops without uploading, so a
# permissions problem can never overwrite the real history.
#
# usage: scripts/readiness-first-copy.sh <bucket> <build dir>
set -euo pipefail
bucket="$1"
file="$2/readiness/history.json"
[ -f "$file" ] || { echo "[readiness] no $file in the build; skipping"; exit 0; }
if out=$(aws s3api head-object --bucket "$bucket" --key readiness/history.json 2>&1); then
  echo "[readiness] s3://$bucket/readiness/history.json exists; leaving it alone"
elif grep -q -E '404|Not Found' <<< "$out"; then
  aws s3 cp "$file" "s3://$bucket/readiness/history.json" --content-type application/json --cache-control 'max-age=300'
  echo "[readiness] uploaded the first copy to s3://$bucket/readiness/history.json"
else
  echo "[readiness] couldn't check s3://$bucket/readiness/history.json, not uploading: $out" >&2
fi
