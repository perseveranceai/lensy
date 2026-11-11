#!/usr/bin/env bash
# Installs the site routing on a CloudFront distribution that isn't in CDK
# (prod: E274OKID4GUQ1J). Used by the prod job in .github/workflows/deploy.yml
# right after the new frontend files are uploaded.
#
# What "apply" changes on the distribution, and nothing else:
#   - the default behaviour's viewer-request function becomes the published
#     backend/cloudfront/site-router.js (/cli -> /cli/index.html, Markdown on
#     Accept: text/markdown)
#   - the 403 and 404 error pages become /404.html with status 404
#
# usage:
#   scripts/cloudfront-site-router.sh check    <distribution-id> <function-name>   read-only preflight
#   scripts/cloudfront-site-router.sh apply    <distribution-id> <function-name>   saves the old config to cloudfront-before.json first
#   scripts/cloudfront-site-router.sh rollback <distribution-id> <saved-config.json>
#   scripts/cloudfront-site-router.sh verify   <site-url>                          HTTP checks, retried for up to 10 minutes
set -euo pipefail

say() { printf '[cloudfront-site-router] %s\n' "$*"; }
die() { say "ERROR: $*" >&2; exit 1; }

ROUTER="$(cd "$(dirname "$0")/.." && pwd)/backend/cloudfront/site-router.js"
action="${1:-}"

function_arn() {
  aws cloudfront describe-function --name "$1" --stage LIVE --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text 2>/dev/null || true
}

case "$action" in
  check)
    dist="$2"; fn="$3"
    aws cloudfront get-distribution-config --id "$dist" --query 'DistributionConfig.DefaultCacheBehavior.FunctionAssociations' --output json \
      || die "can't read the config of $dist (needs cloudfront:GetDistributionConfig)"
    current=$(aws cloudfront get-distribution-config --id "$dist" --query "DistributionConfig.DefaultCacheBehavior.FunctionAssociations.Items[?EventType=='viewer-request'].FunctionARN | [0]" --output text)
    ours=$(function_arn "$fn")
    if [ "$current" != "None" ] && [ -n "$current" ] && [ "$current" != "$ours" ]; then
      die "$dist already runs another viewer-request function ($current). Not replacing it automatically; check what it does first."
    fi
    say "preflight ok: $dist readable, no other viewer-request function in the way"
    ;;

  apply)
    dist="$2"; fn="$3"
    [ -f "$ROUTER" ] || die "missing $ROUTER"

    # 1. Create or update the function, then publish it.
    if etag=$(aws cloudfront describe-function --name "$fn" --stage DEVELOPMENT --query ETag --output text 2>/dev/null); then
      etag=$(aws cloudfront update-function --name "$fn" --if-match "$etag" \
        --function-config Comment="Lensy site routing",Runtime=cloudfront-js-2.0 \
        --function-code "fileb://$ROUTER" --query ETag --output text)
      say "updated function $fn"
    else
      etag=$(aws cloudfront create-function --name "$fn" \
        --function-config Comment="Lensy site routing",Runtime=cloudfront-js-2.0 \
        --function-code "fileb://$ROUTER" --query ETag --output text)
      say "created function $fn"
    fi
    aws cloudfront publish-function --name "$fn" --if-match "$etag" > /dev/null
    arn=$(function_arn "$fn")
    [ -n "$arn" ] || die "function $fn has no LIVE stage after publishing"
    say "published $arn"

    # 2. Point the distribution at it and set the 404 page. Keep a copy of the
    #    old config so the change can be undone with "rollback".
    aws cloudfront get-distribution-config --id "$dist" > cloudfront-current.json
    dist_etag=$(jq -r '.ETag' cloudfront-current.json)
    jq '.DistributionConfig' cloudfront-current.json > cloudfront-before.json
    jq --arg arn "$arn" '
      .DefaultCacheBehavior.FunctionAssociations = {
        Quantity: (([.DefaultCacheBehavior.FunctionAssociations.Items[]? | select(.EventType != "viewer-request")] + [{FunctionARN: $arn, EventType: "viewer-request"}]) | length),
        Items: ([.DefaultCacheBehavior.FunctionAssociations.Items[]? | select(.EventType != "viewer-request")] + [{FunctionARN: $arn, EventType: "viewer-request"}])
      }
      | .CustomErrorResponses = {
        Quantity: (([.CustomErrorResponses.Items[]? | select(.ErrorCode != 403 and .ErrorCode != 404)] + [
          {ErrorCode: 403, ResponsePagePath: "/404.html", ResponseCode: "404", ErrorCachingMinTTL: 10},
          {ErrorCode: 404, ResponsePagePath: "/404.html", ResponseCode: "404", ErrorCachingMinTTL: 10}
        ]) | length),
        Items: ([.CustomErrorResponses.Items[]? | select(.ErrorCode != 403 and .ErrorCode != 404)] + [
          {ErrorCode: 403, ResponsePagePath: "/404.html", ResponseCode: "404", ErrorCachingMinTTL: 10},
          {ErrorCode: 404, ResponsePagePath: "/404.html", ResponseCode: "404", ErrorCachingMinTTL: 10}
        ])
      }' cloudfront-before.json > cloudfront-after.json

    if diff -q <(jq -S . cloudfront-before.json) <(jq -S . cloudfront-after.json) > /dev/null; then
      say "$dist already has this routing; nothing to change"
    else
      aws cloudfront update-distribution --id "$dist" --if-match "$dist_etag" \
        --distribution-config file://cloudfront-after.json > /dev/null
      say "updated $dist; the change reaches every edge location within a few minutes"
    fi
    ;;

  rollback)
    dist="$2"; saved="$3"
    [ -f "$saved" ] || die "no saved config at $saved"
    dist_etag=$(aws cloudfront get-distribution-config --id "$dist" --query ETag --output text)
    aws cloudfront update-distribution --id "$dist" --if-match "$dist_etag" --distribution-config "file://$saved" > /dev/null
    say "restored the previous config of $dist from $saved"
    ;;

  verify)
    site="${2%/}"
    for i in $(seq 1 40); do
      missing=$(curl -s -o /dev/null -w '%{http_code}' -H 'Cache-Control: no-cache' "$site/lensy-deploy-check-does-not-exist-$i")
      title=$(curl -s -A 'lensy-deploy-check' "$site/cli?check=$i" | grep -o '<title>[^<]*' | head -1 || true)
      md=$(curl -s -H 'Accept: text/markdown' "$site/cli?check=$i" | head -c 30 || true)
      say "attempt $i: missing page=$missing, /cli title='${title#<title>}', markdown='${md%%$'\n'*}'"
      if [ "$missing" = "404" ] && [ "$title" = "<title>Lensy command line guide" ] && [[ "$md" == "# Lensy command line"* ]]; then
        say "verified: real 404s, /cli has its own HTML, Markdown on request"
        exit 0
      fi
      sleep 15
    done
    die "routing still not live on $site after 10 minutes"
    ;;

  *)
    die "unknown action '$action' (check, apply, rollback, verify)"
    ;;
esac
