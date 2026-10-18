# Windows local Docker development and Household validation

This procedure creates a **localhost-only**, synthetic-data development
environment. It reuses the Milestone 6 native Actual sync server and durable
`/data` mount, but does not start Caddy: a localhost HTTP endpoint is useful
for development only and must not be published, used from Vercel, or used with
personal financial data.

## Prerequisites

Use Windows 11 with WSL2, Docker Desktop's Linux engine, Node 24, Yarn 4, and
Git for Windows. The browser packaging scripts require Git's `sh.exe` when
they are run from PowerShell:

```powershell
$env:Path = 'C:\Program Files\Git\usr\bin;' + $env:Path
Get-Command sh
docker version
wsl --status
node --version
yarn --version
```

`docker version` must show both Client and Server sections. If the Server
section is absent, start Docker Desktop and wait for its Linux engine; WSL2
being installed alone is not enough.

## Local sync server

From the repository root, create an ignored local configuration and a durable
host-owned directory outside the checkout:

```powershell
Copy-Item deploy/actuynab-private/.env.local.example deploy/actuynab-private/.env.local
# Replace <windows-user> in .env.local with the current Windows user name.
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\ActuYNAB\local-sync-data"

docker compose --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml config -q

docker compose --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml up --build -d actual-server
```

The server is reachable only at `http://127.0.0.1:5006`. Confirm it is healthy
without printing its data or credentials:

```powershell
docker compose --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml ps
docker compose --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml logs --tail 50 actual-server
```

Bootstrap Actual's password only through the localhost browser flow. Use a
unique throwaway local password and do not record it in `.env.local`, source
control, a test fixture, or terminal history.

## React development server

In a second PowerShell window at the repository root:

```powershell
$env:Path = 'C:\Program Files\Git\usr\bin;' + $env:Path
$env:VITE_HOST = '127.0.0.1'
yarn start
```

Open `http://localhost:3001`. This is the existing Vite development workflow;
source changes hot-reload. `VITE_HOST` keeps this development process on
loopback; omit it only when deliberately testing from another private device.
From the welcome flow choose **Connect to a server**, use
`http://127.0.0.1:5006`, bootstrap or sign in with the local test password,
then create a fresh synthetic budget.

## Household and import validation

Use no real accounts, statements, balances, credentials, or bank connections.

1. Open **Household** from the primary sidebar.
2. Keep or edit the suggested synthetic account names, apply the optional
   category template, and save. Verify that two checking accounts, three card
   accounts, and the off-budget Home/Tesla tracking accounts appear.
3. Reload the page and confirm the dashboard still separates available budget,
   checking cash, card/financing liabilities, pending reviews, and schedules.
4. In a synthetic account, use Actual's normal **Import** flow with the
   repository's synthetic M3 statement fixture. Complete the existing merge
   preview, review its M5 suggestions, and explicitly confirm only an eligible
   suggestion.
5. Reload the browser and verify the confirmed payee/category and review state
   persist. Reimport the same fixture and verify that Actual produces no new
   financial transaction.
6. Restart `actual-server` and repeat the reload check. Open a second isolated
   Chromium profile, sign in to the same local server, and verify the same
   synthetic budget, household roles, and confirmed review state are visible.

Credit-card bill payments, transfers, reconciled rows, provided splits, and
Home/Tesla financing movements must remain protected from automated
categorization. A card payment or financing transfer must not increase the
dashboard's current-month categorized spending.

## Stop, rebuild, backup, and isolated restore

Stop without deleting the host-mounted data directory:

```powershell
docker compose --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml stop actual-server
```

Rebuild and restart after source or image changes:

```powershell
docker compose --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml up --build -d actual-server
```

Back up only while stopped. The sample uses a date-stamped archive outside the
checkout; protect it like financial data and keep it synthetic in development:

```powershell
$source = "$env:LOCALAPPDATA\ActuYNAB\local-sync-data"
$backup = "$env:LOCALAPPDATA\ActuYNAB\backups\local-sync-$(Get-Date -Format yyyyMMdd-HHmmss).zip"
New-Item -ItemType Directory -Force (Split-Path $backup)
Compress-Archive -Path "$source\*" -DestinationPath $backup

docker compose --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml up -d actual-server
```

To test recovery, never overwrite the live directory. Extract an archive into
a new empty directory and start it under a second Compose project on a
different localhost port. The process environment below overrides the values
loaded from `.env.local`; it does not change that ignored file or the live
server:

```powershell
$restore = "$env:LOCALAPPDATA\ActuYNAB\restore-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force $restore
Expand-Archive -LiteralPath $backup -DestinationPath $restore

$env:ACTUYNAB_DATA_DIR = $restore.Replace('\', '/')
$env:ACTUYNAB_LOCAL_PORT = '5007'
docker compose -p actuynab-local-restore `
  --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml up -d actual-server

docker compose -p actuynab-local-restore `
  --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml ps
```

Authenticate to `http://127.0.0.1:5007` and compare only synthetic account
counts, balances, and review state. Stop the isolated server when the drill is
complete, then clear the two temporary environment variables by opening a new
PowerShell session:

```powershell
docker compose -p actuynab-local-restore `
  --env-file deploy/actuynab-private/.env.local `
  -f deploy/actuynab-private/compose.yaml `
  -f deploy/actuynab-private/compose.local.yaml stop actual-server
```

## Recorded local validation

The following validation was performed on 2026-10-18 using only a synthetic
budget and a localhost-bound sync server:

- Docker Desktop 4.84 / Engine 29.6.2 and WSL 2 were available; the composed
  sync server became healthy on `127.0.0.1:5006` with its data outside the
  checkout.
- The React development server ran with hot reload on `127.0.0.1:3001`.
  A real Playwright Chromium browser completed the native server sign-in flow,
  created a synthetic budget, and loaded the Household page.
- The Household setup template created the five configured on-budget accounts
  (Activo, Millenium, and the three credit cards) and the Home and Tesla
  off-budget liabilities. The dashboard displayed those account roles and its
  checking, credit-card, financing, spending, and pending-review summaries.
- A one-row synthetic CSV was imported through Actual's UI, corrected to the
  existing `Groceries` category, and confirmed. A second independent Chromium
  context observed the household configuration and the confirmed result.
- Reimporting the same row produced `Import 0 transactions`. The confirmed
  category and household dashboard state survived a browser reload and an
  `actual-server` container restart.
- A stopped-server archive was restored into an isolated data directory and
  separate Compose project on port 5007. A fresh Chromium session verified the
  restored category, household configuration, and monthly spending state.

The browser test intentionally did not enter real or non-synthetic account
data. It validates the actual UI and native sync protocol, not a public HTTPS
deployment. M7's focused regression tests remain the coverage for non-zero
credit-card and financing-account financial scenarios.

## Boundaries

- `compose.local.yaml` suppresses the remote Caddy proxy and binds only the
  sync server port to loopback. It is not a trusted-HTTPS or Vercel setup.
- Docker's container lifecycle does not persist financial data; the host path
  configured by `ACTUYNAB_DATA_DIR` does.
- Do not use `docker compose down --volumes` as a backup or restore command.
  It can remove named Caddy volumes in the remote configuration.
- Before any remote/private deployment, return to the Milestone 6 procedure:
  valid TLS, native authentication, restricted host/network access, a
  protected frontend, and an isolated restore drill remain required.
