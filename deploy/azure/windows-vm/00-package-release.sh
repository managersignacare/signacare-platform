#!/usr/bin/env bash
set -euo pipefail

# Signacare EMR — Windows VM deployment packager
# Produces a monorepo-shaped artifact bundle expected by
# deploy/azure/windows-vm/03-deploy-app.ps1.
#
# Usage:
#   deploy/azure/windows-vm/00-package-release.sh
#   deploy/azure/windows-vm/00-package-release.sh --skip-install
#   deploy/azure/windows-vm/00-package-release.sh --output artifacts/my-release

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

SKIP_INSTALL="false"
OUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install)
      SKIP_INSTALL="true"
      shift
      ;;
    --output)
      OUT_DIR="${2:-}"
      if [[ -z "$OUT_DIR" ]]; then
        echo "error: --output requires a directory path" >&2
        exit 1
      fi
      shift 2
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f package.json || ! -d apps/api || ! -d apps/web || ! -d packages/shared ]]; then
  echo "error: run this script from the Signacare repo checkout" >&2
  exit 1
fi

if [[ "$SKIP_INSTALL" != "true" ]]; then
  npm ci
fi

npm run build -w packages/shared
npm run build -w apps/api
npm run build -w apps/web

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="artifacts/windows-vm-release-$STAMP"
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/apps/api" "$OUT_DIR/apps/web" "$OUT_DIR/packages/shared" "$OUT_DIR/deploy/azure/windows-vm"

cp package.json "$OUT_DIR/"
cp package-lock.json "$OUT_DIR/"

cp apps/api/package.json "$OUT_DIR/apps/api/"
cp -R apps/api/dist "$OUT_DIR/apps/api/"
cp -R apps/api/migrations "$OUT_DIR/apps/api/"
cp -R apps/api/scripts "$OUT_DIR/apps/api/"

cp -R apps/web/dist "$OUT_DIR/apps/web/"

cp packages/shared/package.json "$OUT_DIR/packages/shared/"
cp -R packages/shared/dist "$OUT_DIR/packages/shared/"

cp deploy/azure/windows-vm/01-setup-prerequisites.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/02-create-database.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/03-deploy-app.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/04-configure-iis.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/05-install-services.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/06-configure-redis.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/07-bootstrap-node.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/08-bootstrap-node-fast.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/10-launch-bootstrap-bg.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/11-check-bootstrap-bg.ps1 "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/web.config "$OUT_DIR/deploy/azure/windows-vm/"
cp deploy/azure/windows-vm/env.windows-template "$OUT_DIR/deploy/azure/windows-vm/"

cat >"$OUT_DIR/DEPLOYMENT_MANIFEST.txt" <<EOF
Signacare Windows VM release bundle
Generated UTC: $STAMP

Root lockfiles:
  - package.json
  - package-lock.json

Runtime workspaces:
  - apps/api (dist, migrations, scripts, package.json)
  - packages/shared (dist, package.json)
  - apps/web/dist

VM setup scripts:
  - deploy/azure/windows-vm/01-setup-prerequisites.ps1
  - deploy/azure/windows-vm/02-create-database.ps1
  - deploy/azure/windows-vm/03-deploy-app.ps1
  - deploy/azure/windows-vm/04-configure-iis.ps1
  - deploy/azure/windows-vm/05-install-services.ps1
  - deploy/azure/windows-vm/06-configure-redis.ps1
  - deploy/azure/windows-vm/07-bootstrap-node.ps1
  - deploy/azure/windows-vm/08-bootstrap-node-fast.ps1
  - deploy/azure/windows-vm/10-launch-bootstrap-bg.ps1
  - deploy/azure/windows-vm/11-check-bootstrap-bg.ps1
  - deploy/azure/windows-vm/env.windows-template
  - deploy/azure/windows-vm/web.config
EOF

(cd "$(dirname "$OUT_DIR")" && zip -r "$(basename "$OUT_DIR").zip" "$(basename "$OUT_DIR")" >/dev/null)

echo "Bundle ready:"
echo "  Directory: $OUT_DIR"
echo "  Zip file:  ${OUT_DIR}.zip"
