#!/bin/bash
set -euo pipefail

# Lensy Production Deployment Script
# Usage: ./scripts/deploy-prod.sh [backend|frontend|all]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

PROD_S3_BUCKET="lensy-console-951411676525-us-east-1"
PROD_CF_DISTRIBUTION="E1ZTJJDLRMWRZF"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

deploy_backend() {
    log "=== Backend: Compiling TypeScript + CDK Deploy (prod) ==="
    cd "$ROOT_DIR/backend"
    npm run deploy:prod
    log "=== Backend deployed ==="
}

deploy_frontend() {
    log "=== Frontend: Building for prod ==="
    cd "$ROOT_DIR/frontend"
    npm run build:prod

    log "=== Syncing to S3: $PROD_S3_BUCKET ==="
    aws s3 sync build/ "s3://$PROD_S3_BUCKET" --delete

    log "=== Invalidating CloudFront: $PROD_CF_DISTRIBUTION ==="
    INVALIDATION_ID=$(aws cloudfront create-invalidation \
        --distribution-id "$PROD_CF_DISTRIBUTION" \
        --paths "/*" \
        --query 'Invalidation.Id' --output text)
    log "CloudFront invalidation created: $INVALIDATION_ID"
    log "=== Frontend deployed — allow 2-5 min for CDN propagation ==="
}

smoke_test() {
    log "=== Running smoke tests ==="
    # Check site is reachable
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://perseveranceai.com)
    if [ "$HTTP_STATUS" -eq 200 ]; then
        log "✓ perseveranceai.com returns 200"
    else
        warn "✗ perseveranceai.com returned $HTTP_STATUS"
    fi

    # Check API health
    API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com/usage)
    if [ "$API_STATUS" -eq 200 ]; then
        log "✓ Prod API /usage returns 200"
    else
        warn "✗ Prod API /usage returned $API_STATUS"
    fi

    log "=== Smoke tests done ==="
}

MODE="${1:-all}"

case "$MODE" in
    backend)
        deploy_backend
        ;;
    frontend)
        deploy_frontend
        smoke_test
        ;;
    all)
        deploy_backend
        deploy_frontend
        smoke_test
        ;;
    *)
        echo "Usage: $0 [backend|frontend|all]"
        exit 1
        ;;
esac

log "🎉 Production deployment complete!"
