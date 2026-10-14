#!/usr/bin/env bash
#
# Everything CI checks, locally, in the order that fails fastest.
#
#   ./scripts/verify.sh
#
# Needs a PostgreSQL reachable at DATABASE_URL and a disposable database at
# TEST_DATABASE_URL. `./scripts/db-local.sh start` provides both.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

step 'Generated client consistency'
bash scripts/check-prisma-imports.sh

step 'Typecheck'
pnpm -r typecheck
pass 'all packages'

step 'Unit tests'
pnpm --filter @tradeflow/shared test
pass 'money and document arithmetic'

step 'Migrations apply from empty'
pnpm --filter @tradeflow/api exec prisma migrate deploy >/dev/null
pass 'migration history is complete'

step 'No schema drift'
( cd apps/api && pnpm exec prisma migrate diff \
    --from-schema=prisma/schema.prisma \
    --to-config-datasource \
    --exit-code >/dev/null )
pass 'schema.prisma and the database agree'

step 'End-to-end tests'
pnpm --filter @tradeflow/api test:e2e
pass 'the whole flow, against real PostgreSQL'

step 'Build'
pnpm build
pass 'api and web'

printf '\n\033[32mAll checks passed.\033[0m\n'
