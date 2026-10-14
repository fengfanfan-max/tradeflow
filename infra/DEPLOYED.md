# The live demo

**http://54.66.107.135** — sign in as `daniel.halstead@halsteadelectrical.co.uk` / `demo-password-2026`.

| | |
| --- | --- |
| Region | `ap-southeast-2` |
| EC2 | `i-040cb002f576d1d69` — t4g.small, Amazon Linux 2023, arm64 |
| Elastic IP | `54.66.107.135` |
| Database | RDS PostgreSQL 17, `db.t4g.micro`, `tradeflow-db.cv2ykkao8nhu.ap-southeast-2.rds.amazonaws.com` |
| Web server | nginx, `/` → :3000, `/api/` → :3001 |
| Processes | `tradeflow-api`, `tradeflow-web` under systemd, both enabled |
| Secrets | master password in Secrets Manager as `tradeflow/db-password` |

## Why not App Runner

The plan in `README.md` was RDS + App Runner + Amplify. App Runner is denied by
the organisation's service control policy
(`arn:aws:organizations::941035170474:policy/o-p3t30svdmd/service_control_policy/p-szbwfpjq`),
and so is EC2, RDS and Amplify — **but only in `us-east-1`**, which is what the
CLI defaults to. The policy is region-scoped. The account's own project region,
`ap-southeast-2`, permits all of them.

So the same three pieces are deployed one level down: an EC2 instance running
both Node processes behind nginx, rather than two managed services. Two fewer
moving parts, and no container registry, since there is no Docker on this machine
to build an image with.

## What the deploy actually cost in time

Everything below was found by deploying, and none of it was visible locally:

1. **`SHADOW_DATABASE_URL` was required to deploy.** `prisma migrate deploy`
   never uses a shadow database; only `migrate dev` does. The config demanded it
   anyway, so the first deploy failed on a variable that exists to serve a
   development command. Fixed in `9d7e0fb`.
2. **RDS refuses unencrypted connections** — `no pg_hba.conf entry ... no
   encryption`. The connection string needs `sslmode=require`.
3. **Node rejects the RDS certificate** — the AWS RDS CA is not in Node's default
   trust store, so the first query failed with "self-signed certificate in
   certificate chain". Fixed by installing `global-bundle.pem` and pointing
   `NODE_EXTRA_CA_CERTS` at it in the unit file.
4. **`corepack` does not exist** in the Node tarball layout used here, so pnpm
   was never installed by the bootstrap script; and npm's global prefix is not
   writable by the instance user. pnpm went in under a user-level prefix.
5. **The security group had no SSH rule**, so the first connection attempt hung
   for five minutes.

## Operating it

```bash
ssh -i .aws-deploy/tradeflow-deploy.pem ec2-user@54.66.107.135
sudo journalctl -u tradeflow-api -f
sudo systemctl restart tradeflow-api tradeflow-web
```

Redeploying is `git pull` then rebuild then restart; there is no pipeline. The
database is not in a snapshot rotation: `--backup-retention-period 1` gives a
day of automated backups.

**This is a demo, not a production deployment.** No TLS, no custom domain, no
load balancer, no monitoring, no secret rotation, and the seed's demo password is
in the unit's environment file.
