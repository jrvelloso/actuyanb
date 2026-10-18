# Deployment readiness and private validation

Milestone 6 prepares a private, synthetic-data operating baseline. It does not
authorize a production budget, DNS cutover, or public service.

## Integration baseline

The first five feature pull requests form a linear dependency chain through
Milestone 4. The Vercel PoC (PR #6) and synced import review (PR #7) are
siblings from that point. To preserve both without modifying either pull
request, the Milestone 6 branch is based on PR #7 and cherry-picks PR #6's
single Vercel commit.

```text
master <- #1 <- #2 <- #3 <- #4 <- #5
                                  |- #6 Vercel frontend PoC
                                  `- #7 synced import review <- #8 M6
                                                          + cherry-pick #6
```

The proposed PR #8 base is `feature/milestone-5-synced-review`. It therefore
reviews the PoC and deployment work together while leaving PRs #1--#7, their
branches, and their merge order intact. After PR #8 merges, the owner may
choose to close PR #6 as superseded; that is deliberately not done here.

## Architecture decision

The recommended first private environment is **a Docker-hosted sync server
from this fork, with a persistent data volume and Caddy TLS**. It is the
simplest reliable deployment because it retains Actual's native server,
authentication, CRDT protocol, SQLite metadata, user/server files, and
same-origin web serving option. The supplied configuration is in
[`deploy/actuynab-private`](../../deploy/actuynab-private).

| Option                                               | Compatibility                       | Operational result                                                                                                                                                                            | Decision                                             |
| ---------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Vercel static frontend + external Actual sync server | High; no core changes               | Two origins, so CORS and remote HTTPS must be tested against the actual browser URL. Vercel has no durable sync filesystem.                                                                   | Viable after the Docker server is operating.         |
| Vercel frontend + Supabase synchronization adapter   | Not currently compatible            | Would require a new implementation of Actual's account, file, authentication, and CRDT synchronization contracts. Supabase does not substitute for the server's SQLite/filesystem data model. | Rejected for this milestone; no adapter was written. |
| Docker sync server + Caddy                           | Highest; uses the existing protocol | One durable volume, native authentication, TLS reverse proxy, and ordinary backup/restore.                                                                                                    | Recommended private baseline.                        |
| Browser-only static frontend                         | Supported local mode                | IndexedDB/WASM is per browser and is not multi-device recovery.                                                                                                                               | Development and synthetic demonstrations only.       |

Vercel remains useful for a protected static frontend, but never stores
budgets, passwords, server secrets, bank credentials, or backups. The browser
must be configured with an HTTPS sync URL. The Vercel CSP intentionally permits
only `https:` remote connections; it rejects insecure sync URLs.

## Private server configuration

`compose.yaml` builds the current fork and has exactly two services:

- `actual-server`: the native sync server, running unprivileged and writing
  only to its mounted `/data` directory;
- `caddy`: terminates TLS and proxies only to the internal server port.

The initial Actual password is created through Actual's own bootstrap flow; it
is not an environment variable and must not be committed. Perform bootstrap
from a trusted private network before making the hostname externally reachable.
Do not expose an uninitialized server where another visitor could claim the
first password. Use a valid, publicly trusted certificate for browser clients;
the self-signed certificate used by the local validation below is test-only.

Use a host-owned directory outside the checkout for `ACTUYNAB_DATA_DIR`. It
must be writable by container UID/GID 1001. The directory contains the server
SQLite database and budget/user files, so restrict host access and encrypt
backups. Caddy state should also be retained by its named volumes.

Before any upgrade or restore:

1. Stop the server and take a complete, access-controlled backup of the data
   directory.
2. Restore it to a different empty directory; do not overwrite the live one.
3. Start the same image against that restored directory on an isolated host or
   hostname, then sign in and compare synthetic accounts and review status.
4. Record only the date, artifact version, duration, and pass/fail outcome;
   do not record statement contents, identifiers, tokens, or passwords.

The native server currently uses its existing Express CORS behavior. CORS is
not authentication and is not a replacement for TLS, Actual authentication,
network access control, or backup protection. For the optional Vercel frontend,
exercise login and sync from the real protected preview URL before using it
with any non-synthetic budget.

## Vercel preview setup

An empty, password-protected project named `actuynab-private-preview` was
created in the owner's `jrvellosos-projects` team. No deployment remains, and
no DNS mapping, environment variable, or financial data was created. Do not use
it as a production project.

A direct Vercel CLI upload was started while verifying the project, but the CLI
reported its target as **Production** even without `--prod`. It was removed
while still building, and `vercel list` then confirmed that the project had
zero deployments. Do not use that direct CLI path for this project. Create the
first deployment from the dashboard's explicitly labelled **Preview** flow and
verify its environment before allowing the build to proceed.

When the owner is ready to create the first protected preview from the
Milestone 6 branch, use the Vercel dashboard and these project settings:

| Setting               | Value                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Root Directory        | repository root (`.`)                                                                                          |
| Framework Preset      | Other (static Vite output; not Next.js)                                                                        |
| Install Command       | `yarn install --immutable`                                                                                     |
| Build Command         | `yarn build:browser --skip-translations`                                                                       |
| Output Directory      | `packages/desktop-client/build`                                                                                |
| Preview source branch | `feature/milestone-6-deployment-readiness` until reviewed                                                      |
| Environment variables | None required; never add `ACTUAL_*`, passwords, bank secrets, or a sync token                                  |
| Protection            | Password protection enabled before deployment; retain team protection and do not add custom production domains |

Confirm the dashboard identifies the new deployment as **Preview**, not
Production, before accepting it. `vercel.json` supplies SPA fallback, `application/wasm`, cross-origin
isolation, restrictive browser security headers, and an HTTPS-only `connect-src`
policy. The client route fallback never proxies `/sync`, `/account`, or any
other server endpoint.

## Executed synthetic validation

All evidence below used fictional accounts, merchants, amounts, credentials,
and temporary data directories that were removed after the test.

| Check                         | Result               | Evidence                                                                                                                                                                                                         |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production browser build      | Passed               | `yarn build:browser --skip-translations` with Git for Windows `sh.exe` on `PATH`.                                                                                                                                |
| Compose configuration         | Passed               | `docker compose ... config -q` resolved the private server configuration with synthetic placeholder values.                                                                                                      |
| Static browser initialization | Passed               | Chromium loaded the built bundle, cross-origin isolation, SharedArrayBuffer, worker bridge, SQLite/WASM, and demo budget.                                                                                        |
| Navigation/assets/headers     | Passed               | Root and client route returned 200 HTML; SQLite WASM returned `application/wasm`; default database loaded; COOP, COEP, CORP, CSP, permissions, referrer, and nosniff headers were asserted.                      |
| Native sync authentication    | Passed locally       | A browser signed into an HTTPS test server using Actual's password workflow.                                                                                                                                     |
| Independent-client sync       | Passed locally       | A second Chromium profile loaded the same synthetic budget after server restart.                                                                                                                                 |
| M5 review persistence         | Passed locally       | A safe categorized import was approved; an independent client observed no pending review item.                                                                                                                   |
| Household safeguards          | Passed locally       | Seven fictional accounts were created: Activo, Millenium, three credit cards, and off-budget Home/Tesla liabilities. A historical grocery match proposed `reliable-history`; monetary fields remained untouched. |
| Backup and isolated restore   | Passed locally       | A stopped-server `/data` archive restored into a different data directory, then authenticated and loaded all seven accounts plus the confirmed review state.                                                     |
| Reimport idempotency          | Passed in regression | M3/M5 focused tests assert repeated statement/review processing creates no financial duplicate.                                                                                                                  |

The local HTTPS test deliberately bypassed certificate validation only because
it used a temporary self-signed certificate. That exception is not permitted
for the private deployment: browsers must validate the Caddy certificate.

## Remaining manual gates

This milestone is **partially complete** until a durable remote host, trusted
certificate, network policy, and protected Vercel preview can be exercised
together with synthetic data. The remaining owner-controlled procedure is:

1. Provision a private Docker-capable host and a DNS name without exposing an
   uninitialized service; use the supplied configuration with a host data path.
2. Bootstrap Actual authentication privately, then verify Caddy obtains a
   trusted certificate and the data directory survives a container restart.
3. Deploy the protected Vercel preview through the dashboard from the
   documented branch, confirm its environment is Preview, open it in two
   separate browser profiles, and configure the synthetic HTTPS server URL in
   each.
4. Repeat the import -> review -> confirmation -> reload -> second-client ->
   repeated-import -> server-restart -> isolated-restore checklist.
5. Obtain explicit authorization before associating a production domain,
   importing non-synthetic data, enabling a bank integration, or publishing an
   accessible production instance.

The local Docker CLI is installed, but its Docker Desktop Linux engine was not
running while this change was validated; therefore the Caddy container itself
was not started or runtime-validated locally. Run `docker compose ... up
--build` and the Caddy certificate/health checks on the target private host as
part of step 1, before treating the Compose definition as an operational
deployment.

The known Node 24 Windows-1252 parser baseline remains unrelated to deployment
and is still documented in [Functional validation](validation.md).
