# Private deployment, backups, and recovery

## Deployment posture

ActuYNAB's first online deployment remains a private self-hosted Docker
installation based on Actual's sync server. Its persistent `/data` volume is
the critical operational asset. Do not expose a development server or an
unauthenticated sync service to the public internet.

For a private test deployment:

1. Pin and record the tested image/build rather than treating a production
   update as an implicit upgrade.
2. Mount a host-managed persistent directory to `/data`; restrict host and
   filesystem access to the operator.
3. Terminate HTTPS with the upstream-supported certificate configuration or a
   carefully configured reverse proxy. Use a valid private-network certificate
   where possible.
4. Enable supported authentication before remote access. Use multi-user/OpenID
   only when its operational model is deliberately configured and tested.
5. Keep all secrets outside Git and use environment variables or supported
   configuration mechanisms with least privilege.

Bank-provider credentials are server-side secrets and, per Actual's upstream
documentation, are not protected by budget end-to-end encryption. Self-hosting
and strict operator access are therefore important even for a single user.

## Backup policy

Maintain two complementary backups:

- **Application export:** users can export a budget from Settings before
  migrations or other potentially destructive work.
- **Server-volume backup:** take a consistent backup of the mounted `/data`
  directory, including server and user files, and protect it with encryption
  and access controls appropriate to financial data.

The first implementation should define a scheduled, retained, encrypted backup
outside the host; its exact tool and destination are intentionally deferred so
they match the owner's infrastructure and recovery objectives. Never place
backups or real sample budgets in this repository.

For a local, non-production budget, use **Settings > Export data** to create a
portable ZIP. To restore it, choose the budget-name menu, **Switch file >
Import file > Actual**, then select the ZIP. Importing produces a separate
budget copy; inspect that copy before deleting or replacing anything. This is
the path exercised by the synthetic archive/export test described in
[Functional validation](validation.md).

## Recovery drill

A backup is considered valid only after a test restore:

1. Restore a synthetic test instance into an isolated volume.
2. Start the same recorded image/build and verify authentication and sync.
3. Open the test budget, compare account balances/transaction counts, and
   perform a reconciliation read check.
4. Verify a client can reconnect without overwriting newer data.
5. Record date, restore duration, result, and any corrective action without
   recording financial content.

Run this drill before production use and after material server, schema, or
backup-process changes.

## Routine maintenance

Before an upstream update, make and verify a backup, review release changes and
custom seams, test the upgrade in an isolated copy, run focused regressions,
then promote only with explicit production approval. Monitor service health and
logs while avoiding transaction descriptions, authentication tokens, and other
sensitive values in normal logs.
