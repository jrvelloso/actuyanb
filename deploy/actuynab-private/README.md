# Private ActuYNAB sync-server deployment

This Compose definition builds the sync server from this fork's
`sync-server.Dockerfile`, mounts its only durable state at `ACTUYNAB_DATA_DIR`,
and puts Caddy in front for TLS. It is intentionally a server deployment; it
does not make Vercel responsible for financial persistence.

Follow the full safety and recovery procedure in
[`docs/actuynab/deployment-readiness.md`](../../docs/actuynab/deployment-readiness.md)
before using this outside a synthetic test environment. In particular, create
the first Actual password from a private network before exposing the service.

```text
Copy-Item .env.example .env
# Edit .env with a real, private host name, email, and absolute data path.
New-Item -ItemType Directory -Force <data-path>
docker compose --env-file .env config -q
docker compose --env-file .env up --build -d
```

The data path is never a repository path. Backup and restore the complete
directory only while the server is stopped, then verify the restore using a
different directory and host name. Do not put passwords, bank credentials,
budgets, or backups in `.env` or source control.

For a Windows 11 localhost-only development server, use the additional
`compose.local.yaml` override and the companion `.env.local.example`. It
starts **only** the native sync server and binds it to `127.0.0.1`; it
intentionally does not run Caddy, obtain a certificate, or publish ports
80/443. The complete start, backup, restore, and browser validation procedure
is in
[`docs/actuynab/local-docker-development.md`](../../docs/actuynab/local-docker-development.md).
