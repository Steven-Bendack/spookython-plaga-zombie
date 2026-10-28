#!/usr/bin/env bash
# One-command AWS deployment (us-east-1). Needs: AWS CLI with a profile of the
# team's account (`aws configure sso` or an IAM user just for deploying),
# AWS SAM CLI and Python. Never put keys in this repo.
#
#   AWS_PROFILE=plaga bash scripts/deploy_aws.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="${STACK:-plaga-zombie}"
REGION="${REGION:-us-east-2}"  # new free-plan accounts only allow some regions
cd "$ROOT"

echo "== Account"
aws sts get-caller-identity --query '{account: Account, arn: Arn}' --output table
read -r -p "Deploy stack '$STACK' to this account in $REGION? [y/N] " ok
[ "$ok" = "y" ] || { echo "Cancelled."; exit 1; }

echo "== Build (numpy layer for Linux + SAM)"
python infra/build_layer.py
git rev-parse --short=12 HEAD > src/engine/COMMIT
sam build -t infra/template.yaml --build-dir build/sam

echo "== Deploy"
sam deploy --template-file build/sam/template.yaml --stack-name "$STACK" --region "$REGION" \
  --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides MaxFanout="${MAX_FANOUT:-8}" MapMaxConcurrency="${MAP_CONCURRENCY:-8}"

out() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
URL="$(out WebUrl)"
BUCKET="$(out WebBucketName)"
DIST="$(out DistributionId)"

echo "== Upload the web"
aws s3 sync src/web "s3://$BUCKET" --delete --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query 'Invalidation.Id' --output text

echo "== Smoke test"
for path in / /api/meta; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL$path")"
  echo "$path -> $code"
done
curl -s -X POST -H 'Content-Type: application/json' -d '{"seed":2026,"runs":40}' "$URL/api/simulate" \
  | python -c "import sys, json; d = json.load(sys.stdin); print('simulate ->', d['candidates'][0]['label'], d['elapsed_seconds'], 's')"

echo "Public URL: $URL"
