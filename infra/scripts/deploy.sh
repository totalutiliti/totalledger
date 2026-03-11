#!/usr/bin/env bash
# ============================================================================
# SercofiRH — Azure Bicep Deployment Script
# Usage: ./deploy.sh <dev|prod>
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BICEP_DIR="${SCRIPT_DIR}/../bicep"

# ── Validate arguments ──────────────────────────────────────────────────────

ENVIRONMENT="${1:-}"

if [[ -z "${ENVIRONMENT}" ]]; then
  echo "Error: environment argument is required."
  echo "Usage: $0 <dev|prod>"
  exit 1
fi

if [[ "${ENVIRONMENT}" != "dev" && "${ENVIRONMENT}" != "prod" ]]; then
  echo "Error: environment must be 'dev' or 'prod'."
  exit 1
fi

PARAM_FILE="${BICEP_DIR}/parameters/${ENVIRONMENT}.bicepparam"
MAIN_TEMPLATE="${BICEP_DIR}/main.bicep"
DEPLOYMENT_NAME="sercofi-${ENVIRONMENT}-$(date +%Y%m%d%H%M%S)"
LOCATION="brazilsouth"

# ── Validate prerequisites ──────────────────────────────────────────────────

if ! command -v az &> /dev/null; then
  echo "Error: Azure CLI (az) is not installed."
  exit 1
fi

if [[ ! -f "${MAIN_TEMPLATE}" ]]; then
  echo "Error: main.bicep not found at ${MAIN_TEMPLATE}"
  exit 1
fi

if [[ ! -f "${PARAM_FILE}" ]]; then
  echo "Error: parameter file not found at ${PARAM_FILE}"
  exit 1
fi

# ── Validate POSTGRES_ADMIN_PASSWORD is set ──────────────────────────────────

if [[ -z "${POSTGRES_ADMIN_PASSWORD:-}" ]]; then
  echo "Error: POSTGRES_ADMIN_PASSWORD environment variable is not set."
  echo "Export it before running: export POSTGRES_ADMIN_PASSWORD='<your-password>'"
  exit 1
fi

# ── Check Azure login ───────────────────────────────────────────────────────

echo "Checking Azure CLI login status..."
if ! az account show &> /dev/null; then
  echo "Not logged in. Running 'az login'..."
  az login
fi

echo ""
echo "=========================================="
echo " SercofiRH Deployment"
echo "=========================================="
echo " Environment:  ${ENVIRONMENT}"
echo " Location:     ${LOCATION}"
echo " Deployment:   ${DEPLOYMENT_NAME}"
echo " Template:     ${MAIN_TEMPLATE}"
echo " Parameters:   ${PARAM_FILE}"
echo "=========================================="
echo ""

# ── Deploy ───────────────────────────────────────────────────────────────────

echo "Starting deployment..."

az deployment sub create \
  --name "${DEPLOYMENT_NAME}" \
  --location "${LOCATION}" \
  --template-file "${MAIN_TEMPLATE}" \
  --parameters "${PARAM_FILE}" \
  --verbose

echo ""
echo "Deployment '${DEPLOYMENT_NAME}' completed successfully."
echo ""

# ── Show outputs ─────────────────────────────────────────────────────────────

echo "Deployment outputs:"
az deployment sub show \
  --name "${DEPLOYMENT_NAME}" \
  --query "properties.outputs" \
  --output table
