#!/usr/bin/env bash
#
# Fails if anything imports the Prisma client from `@prisma/client`.
#
# `@prisma/client` re-exports `.prisma/client/default` out of a content-addressed
# pnpm store directory, which is a *different copy* from the one at
# `apps/api/src/generated/prisma`. After a schema change the two drift, and the
# mismatch surfaces as a runtime error naming a column rather than an import —
# which is exactly what happened during this build, after a migration changed an
# enum and the seed was still reading the old client.
#
# Everything imports `apps/api/src/prisma/client.ts`, which is the one file that
# knows where the generated output lives.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if grep -rn --include='*.ts' "from '@prisma/client'" apps/api/src apps/api/prisma apps/api/test 2>/dev/null; then
  cat >&2 <<'MSG'

Import the Prisma client from '../src/generated/prisma' (or through
apps/api/src/prisma/client.ts), not from '@prisma/client'. See the note at the
top of this script for why the two are not the same module.
MSG
  exit 1
fi

echo "  ✓ no imports from @prisma/client"
