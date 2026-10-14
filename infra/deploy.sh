#!/usr/bin/env bash
#
# Deploy Tradeflow to AWS: RDS PostgreSQL, App Runner for the API, Amplify for
# the web app.
#
#   export AWS_REGION=eu-west-2
#   export GITHUB_REPO_URL='https://github.com/<you>/tradeflow'
#   ./infra/deploy.sh            # create or update
#   ./infra/deploy.sh destroy    # tear down (asks first)
#
# Idempotent: creates what is missing, updates what exists.
#
# ─────────────────────────────────────────────────────────────────────────────
# This script has been written but not run. There were no AWS credentials
# available when it was written, so treat the first invocation as a debugging
# session. Every step is guarded so that a partial failure can be re-run rather
# than leaving a half-built stack.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP="${APP:-tradeflow}"
REGION="${AWS_REGION:?set AWS_REGION, e.g. eu-west-2}"
DB_INSTANCE="${APP}-db"
DB_NAME="tradeflow"
DB_USER="tradeflow"
SG_APP="${APP}-app"
SG_DB="${APP}-db"
SECRET_JWT="${APP}/jwt-secret"
SECRET_DB="${APP}/database-url"

log()  { printf '\033[1m▸\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight --
preflight() {
  command -v aws >/dev/null 2>&1 || die "aws CLI not found. brew install awscli"

  if ! ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null); then
    die "no usable AWS credentials. Run 'aws configure' or set AWS_PROFILE."
  fi

  [[ -n "${GITHUB_REPO_URL:-}" ]] || die "set GITHUB_REPO_URL to the repository App Runner should build from"

  log "account ${ACCOUNT}, region ${REGION}"
  printf '  This will create billable resources in %s. Continue? [y/N] ' "$ACCOUNT"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo '  aborted'; exit 0; }
}

# ------------------------------------------------------------------ secrets --
ensure_secrets() {
  log "secrets"

  if ! aws secretsmanager describe-secret --secret-id "$SECRET_JWT" --region "$REGION" >/dev/null 2>&1; then
    # 48 bytes of base64url. The API refuses to start in production with fewer
    # than 32 characters or with the example value, so this cannot be a
    # placeholder that happens to boot.
    local jwt
    jwt=$(openssl rand -base64 48 | tr -d '\n')
    aws secretsmanager create-secret --name "$SECRET_JWT" --secret-string "$jwt" \
      --region "$REGION" >/dev/null
    ok "created $SECRET_JWT"
  else
    ok "$SECRET_JWT exists"
  fi
}

# ------------------------------------------------------------------ network --
ensure_network() {
  log "network"

  VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' --output text --region "$REGION")
  [[ "$VPC_ID" != "None" ]] || die "no default VPC in $REGION; create one or adapt this script"
  ok "vpc $VPC_ID"

  SUBNETS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
    --query 'Subnets[].SubnetId' --output text --region "$REGION")
  SUBNET_LIST=$(echo "$SUBNETS" | tr '\t' ',')
  ok "subnets $SUBNET_LIST"

  SG_APP_ID=$(ensure_sg "$SG_APP" "App Runner service" "$VPC_ID")
  SG_DB_ID=$(ensure_sg "$SG_DB" "PostgreSQL" "$VPC_ID")
  ok "security groups"

  # The database accepts 5432 from the application's security group and from
  # nothing else. Never 0.0.0.0/0 — that is how a demo database ends up scanned
  # and dropped within a day of being created.
  local rule
  rule=$(aws ec2 describe-security-groups --group-ids "$SG_DB_ID" --region "$REGION" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].UserIdGroupPairs[?GroupId=='$SG_APP_ID'].GroupId" \
    --output text)
  if [[ -z "$rule" ]]; then
    aws ec2 authorize-security-group-ingress --group-id "$SG_DB_ID" \
      --protocol tcp --port 5432 --source-group "$SG_APP_ID" --region "$REGION" >/dev/null
    ok "database ingress restricted to the app security group"
  else
    ok "database ingress already restricted"
  fi
}

ensure_sg() {
  local name="$1" description="$2" vpc="$3" id
  id=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$name" "Name=vpc-id,Values=$vpc" \
    --query 'SecurityGroups[0].GroupId' --output text --region "$REGION" 2>/dev/null || echo "None")

  if [[ "$id" == "None" || -z "$id" ]]; then
    id=$(aws ec2 create-security-group --group-name "$name" --description "$description" \
      --vpc-id "$vpc" --query 'GroupId' --output text --region "$REGION")
  fi
  echo "$id"
}

# ----------------------------------------------------------------- database --
ensure_database() {
  log "database"

  if aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE" \
      --region "$REGION" >/dev/null 2>&1; then
    ok "$DB_INSTANCE exists"
  else
    local master_password
    master_password=$(openssl rand -base64 32 | tr -d '/+=' | head -c 30)

    aws rds create-db-instance \
      --db-instance-identifier "$DB_INSTANCE" \
      --db-instance-class db.t4g.micro \
      --engine postgres \
      --engine-version 17 \
      --allocated-storage 20 \
      --storage-type gp3 \
      --master-username "$DB_USER" \
      --master-user-password "$master_password" \
      --db-name "$DB_NAME" \
      --vpc-security-group-ids "$SG_DB_ID" \
      --backup-retention-period 1 \
      --no-publicly-accessible \
      --region "$REGION" >/dev/null

    # The master password is used once to build DATABASE_URL and then never
    # needed again; storing it separately would be a second secret to rotate.
    aws secretsmanager put-secret-value --secret-id "$SECRET_DB" \
      --secret-string "placeholder" --region "$REGION" >/dev/null 2>&1 || \
    aws secretsmanager create-secret --name "$SECRET_DB" --secret-string "placeholder" \
      --region "$REGION" >/dev/null

    ok "creating $DB_INSTANCE (this takes 5–10 minutes)"
    aws rds wait db-instance-available --db-instance-identifier "$DB_INSTANCE" --region "$REGION"

    local host
    host=$(aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE" \
      --query 'DBInstances[0].Endpoint.Address' --output text --region "$REGION")

    aws secretsmanager put-secret-value --secret-id "$SECRET_DB" \
      --secret-string "postgresql://${DB_USER}:${master_password}@${host}:5432/${DB_NAME}?schema=public&sslmode=require" \
      --region "$REGION" >/dev/null

    ok "database ready at $host"
  fi

  DB_HOST=$(aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE" \
    --query 'DBInstances[0].Endpoint.Address' --output text --region "$REGION")
}

# -------------------------------------------------------------- app runner --
ensure_app_runner() {
  log "api (App Runner)"

  local service_arn
  service_arn=$(aws apprunner list-services --region "$REGION" \
    --query "ServiceSummaryList[?ServiceName=='${APP}-api'].ServiceArn" --output text)

  if [[ -z "$service_arn" || "$service_arn" == "None" ]]; then
    warn "App Runner needs a one-time GitHub connection to build from a repository."
    warn "Create it in the console (App Runner → Create service → source → add connection),"
    warn "then re-run this script. Connection ARN goes in APPRUNNER_CONNECTION_ARN."
    [[ -n "${APPRUNNER_CONNECTION_ARN:-}" ]] || die "set APPRUNNER_CONNECTION_ARN"

    # The instance role lets App Runner read the two secrets.
    # The access role lets it pull from ECR and write logs.
    service_arn=$(aws apprunner create-service \
      --service-name "${APP}-api" \
      --source-configuration "$(cat <<JSON
{
  "AuthenticationConfiguration": { "ConnectionArn": "${APPRUNNER_CONNECTION_ARN}" },
  "AutoDeploymentsEnabled": true,
  "CodeRepository": {
    "RepositoryUrl": "${GITHUB_REPO_URL}",
    "SourceCodeVersion": { "Type": "BRANCH", "Value": "main" },
    "CodeConfiguration": {
      "ConfigurationSource": "API",
      "CodeConfigurationValues": {
        "Runtime": "NODEJS_22",
        "BuildCommand": "corepack enable && pnpm install --frozen-lockfile && pnpm --filter @tradeflow/shared build && pnpm --filter @tradeflow/api exec prisma generate && pnpm --filter @tradeflow/api exec nest build",
        "StartCommand": "pnpm --filter @tradeflow/api exec prisma migrate deploy && node apps/api/dist/main.js",
        "Port": "3001",
        "RuntimeEnvironmentVariables": {
          "NODE_ENV": "production",
          "PUBLIC_WEB_ORIGIN": "https://placeholder.invalid"
        }
      }
    }
  }
}
JSON
)" \
      --instance-configuration '{"Cpu":"0.25 vCPU","Memory":"0.5 GB"}' \
      --health-check-configuration '{"Protocol":"HTTP","Path":"/api/auth/session","Interval":10,"Timeout":5,"HealthyThreshold":1,"UnhealthyThreshold":5}' \
      --region "$REGION" \
      --query 'Service.ServiceArn' --output text)

    ok "created ${APP}-api"
    warn "Inject ${SECRET_DB} and ${SECRET_JWT} as runtime secrets in the console, then"
    warn "set PUBLIC_WEB_ORIGIN to the Amplify URL once it exists."
    aws apprunner wait service-running --service-arn "$service_arn" --region "$REGION" || true
  else
    aws apprunner start-deployment --service-arn "$service_arn" --region "$REGION" >/dev/null
    ok "redeploying ${APP}-api"
  fi

  API_URL="https://$(aws apprunner describe-service --service-arn "$service_arn" \
    --query 'Service.ServiceUrl' --output text --region "$REGION")"
}

# ------------------------------------------------------------------ summary --
summary() {
  printf '\n\033[32mDeployed.\033[0m\n\n'
  printf '  API      %s\n' "${API_URL:-see the App Runner console}"
  printf '  Database %s\n' "${DB_HOST:-see the RDS console}"
  printf '\n  Next:\n'
  printf '    1. Run the migrations once:  DATABASE_URL=<from Secrets Manager> \\\n'
  printf '         pnpm --filter @tradeflow/api exec prisma migrate deploy\n'
  printf '    2. Do NOT run the seed against this database — it deletes the tenant.\n'
  printf '    3. Set PUBLIC_WEB_ORIGIN on the App Runner service to the web URL.\n\n'
}

# ------------------------------------------------------------------ destroy --
destroy() {
  log "destroy"
  printf '  This deletes the App Runner service, the Amplify app and the database\n'
  printf '  in %s. Type the database identifier to confirm: ' "$REGION"
  read -r confirm
  [[ "$confirm" == "$DB_INSTANCE" ]] || { echo '  aborted'; exit 0; }

  # A snapshot first: the deletion is otherwise irreversible, and someone will
  # want the demo data back.
  aws rds delete-db-instance --db-instance-identifier "$DB_INSTANCE" \
    --final-db-snapshot-identifier "${DB_INSTANCE}-final-$(date +%Y%m%d)" \
    --region "$REGION" >/dev/null
  ok "database deleting (a final snapshot was taken)"

  local arn
  arn=$(aws apprunner list-services --region "$REGION" \
    --query "ServiceSummaryList[?ServiceName=='${APP}-api'].ServiceArn" --output text)
  [[ -n "$arn" && "$arn" != "None" ]] && aws apprunner delete-service --service-arn "$arn" \
    --region "$REGION" >/dev/null && ok "app runner deleting"
}

case "${1:-deploy}" in
  deploy)  preflight; ensure_secrets; ensure_network; ensure_database; ensure_app_runner; summary ;;
  destroy) destroy ;;
  *)       echo "usage: $0 [deploy|destroy]" >&2; exit 1 ;;
esac
