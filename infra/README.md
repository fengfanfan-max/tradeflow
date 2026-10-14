# Deploying Tradeflow to AWS

Two long-running processes and a database. That shape rules out a pure
serverless deployment and points at the simplest thing that fits.

| Piece | Service | Why |
| --- | --- | --- |
| API | **App Runner** | Runs the container as-is. No cluster, no load balancer, TLS and a URL included. Fargate would work and costs more to operate for one service. |
| Database | **RDS PostgreSQL**, `db.t4g.micro` | The application needs a real PostgreSQL: an exclusion constraint, transactions and `timestamptz`. Aurora Serverless is better at scale and unnecessary here. |
| Web | **Amplify Hosting** | Builds the Next.js app from the repository and fronts it with CloudFront. |
| Secrets | **Secrets Manager** | `DATABASE_URL` and `JWT_SECRET`, injected into App Runner at runtime rather than baked into the image. |

Nothing in the application assumes a single instance or holds state in memory, so
App Runner can scale it horizontally without further work — the scheduling
guarantee is a database constraint, not a lock.

## Prerequisites

- An AWS account, and credentials with permission to create the resources above.
- The AWS CLI: `brew install awscli`
- Docker, **only** if you build the image locally. App Runner can build from the
  repository instead, which is what the script below does.

```bash
aws configure          # or: export AWS_PROFILE=...
aws sts get-caller-identity   # confirm which account you are about to touch
```

## Deploying

```bash
export AWS_REGION=eu-west-2
export GITHUB_REPO_URL='https://github.com/<you>/tradeflow'

./infra/deploy.sh
```

The script is idempotent: it creates what is missing and updates what exists.
Re-running it after a code change redeploys the API and prints the URLs again.

## What it creates, in order

1. **Secrets** — a generated `JWT_SECRET` (48 bytes) and a `DATABASE_URL` that is
   filled in once the database exists.
2. **Network** — the default VPC, with the database in a private subnet group.
   Security groups allow 5432 only from the App Runner service, never from
   `0.0.0.0/0`.
3. **Database** — RDS PostgreSQL 17, `db.t4g.micro`, 20 GB, single-AZ. Not
   multi-AZ: a demo does not need automatic failover, and multi-AZ doubles the
   cost for a standby nobody will use.
4. **Migrations** — run once as a one-off task before the API serves traffic.
   App Runner has no release phase, so this is a separate step in the script.
5. **App Runner service** — built from the repository's `apps/api/Dockerfile`.
6. **Amplify app** — the web app, with `API_BASE_URL` pointed at the App Runner
   URL.

## Costs

Roughly, in `eu-west-2`, for a demo left running:

- RDS `db.t4g.micro`, 20 GB: ~$13/month (free tier covers it for 12 months on a
  new account)
- App Runner: ~$5/month at low traffic, billed on provisioned memory while idle
- Amplify: free tier covers a demo

**Stop the database when you are not showing it.** `aws rds stop-db-instance`
suspends the compute charge for up to seven days, and it resumes automatically.

## Tearing it down

```bash
./infra/deploy.sh destroy
```

This deletes the App Runner service, the Amplify app and the database. It asks
for confirmation first, because the database deletion is not reversible without a
snapshot — and the script takes one before deleting.

## Honest limits

- **This script has been written, not run.** There were no AWS credentials
  available while it was written, so `infra/deploy.sh` and the CloudFormation it
  uses are unverified against a real account. Treat the first run as a debugging
  session, not a deploy.
- No custom domain. App Runner gives you an `*.awsapprunner.com` URL and Amplify
  an `*.amplifyapp.com` one. Both work and neither is a nice thing to put in a
  proposal; add Route 53 when it matters.
- No CI/CD trigger. A push does not redeploy. App Runner supports automatic
  deployments from a repository, and it is a one-line change once the connection
  is authorised.
- The seed runs against production if you run it. Do not. It deletes the tenant
  and recreates it.
