# Vercel frontend proof of concept

## Decision and scope

The Vercel proof of concept is a **static deployment of the existing React
browser client only**. It is not a deployment of an Actual sync server, a
database, authentication service, or bank-sync provider. No React-to-Next.js
migration, serverless API, proxy, database, credential, or real financial data
is introduced.

`vercel.json` builds the existing browser target and publishes
`packages/desktop-client/build`. It deliberately does not define `/sync`,
`/account`, bank-provider, or secret routes. A successful Vercel deployment
therefore proves static frontend delivery only; it is not a production-ready
financial service.

## Repository findings

| Concern                       | Existing implementation                                                                                                  | Vercel PoC outcome                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Web UI                        | React/Vite in `packages/desktop-client`                                                                                  | Static hosting supported.                                                                      |
| Financial engine              | `loot-core` runs in a browser worker                                                                                     | Supported in the browser; no Node server calculation is required.                              |
| Local database                | SQLite/sql.js plus absurd-sql stores browser data in IndexedDB                                                           | Supported when the browser grants storage. It is per-browser storage, not a Vercel data store. |
| Required binary/static assets | Vite stages `sql-wasm.wasm`, `data/default-db.sqlite`, migrations, `kcab/`, and `service-worker/` into the browser build | Published as static files; configuration preserves the WASM MIME type.                         |
| Navigation                    | React Router/PWA navigation                                                                                              | Vercel rewrite falls back to `index.html`; existing files retain filesystem precedence.        |
| Synchronization               | Express routes such as `/sync`, `/account`, and `/secret` in `packages/sync-server`                                      | Requires a separately hosted, persistent sync server.                                          |
| Authentication                | Password/header/OpenID records in sync-server `account.sqlite`                                                           | Remains on the external sync server; Vercel does not authenticate Actual users.                |
| Bank sync                     | GoCardless, SimpleFIN, Pluggy, Akahu, and Enable Banking routes and server-side secrets                                  | Requires the external sync server and its protected persistent configuration.                  |
| WebSockets                    | Only Vite development HMR proxies WebSockets                                                                             | No production sync WebSocket is required by this browser build.                                |

The browser requests persistent storage with `navigator.storage.persist()` but
the browser may decline it. A local-only budget should be exported regularly;
it can be evicted or lost if the user clears browser storage. A synchronized
budget still needs a durable remote server for multi-device recovery.

## PoC configuration

`vercel.json` uses the repository's existing scripts:

```text
install: yarn install --immutable
build:   yarn build:browser --skip-translations
output:  packages/desktop-client/build
```

`--skip-translations` is intentional: the normal packaging script can clone
and update the translations repository. A reproducible Vercel build must use
the translations already committed to this checkout rather than mutate the
checkout or fetch a moving translation revision.

The configuration applies the same cross-origin isolation headers used by the
existing static-host setup. They are needed for the worker/WASM database path.
It permits HTTPS connections to a separately hosted sync server, but blocks
insecure HTTP connections from the deployed frontend. It does not add a Vercel
rewrite to proxy sync traffic: that would turn the deployment into an
unreviewed financial-data proxy and would not solve persistence.

No application environment variable is required for this static PoC. The
server URL is selected by the user in Actual and stored in the browser's local
database/preferences. Do not put server passwords, session tokens, OpenID
client secrets, bank credentials, or `ACTUAL_*` sync-server configuration in
Vercel or in a `REACT_APP_*` build variable. Values included in a browser
bundle are public to its users.

## Manual Vercel steps (not performed by this PoC)

Deployment is intentionally left to the project owner. Before creating even a
preview deployment, use only a synthetic, disposable browser budget.

1. Import the ActuYNAB repository into the owner-controlled Vercel team and
   set the project root to the repository root.
2. Select a static/Vite-style project (not Next.js). Leave the committed
   install, build, and output settings in `vercel.json` in control.
3. Do **not** add application secrets or an external-server token as a Vercel
   variable. If Vercel system variables are enabled, treat them as build
   metadata only.
4. Create a protected preview deployment first. Confirm that `/`, a client
   route, `/sql-wasm.wasm`, `/data/default-db.sqlite`, and a file under
   `/kcab/` return successfully with the expected headers.
5. Start in browser-only mode or point the client to a synthetic, HTTPS,
   separately hosted Actual sync server. Confirm login, sync, CORS, and a
   backup/restore drill independently. Do not point a preview deployment at a
   personal budget.
6. Only after the security and recovery checks in [Operations](operations.md)
   pass should the owner decide whether a private production deployment is
   appropriate. Project-level deployment protection is not a replacement for
   Actual sync-server authentication.

Vercel serves static content over HTTPS. The external sync-server URL must
also be HTTPS to satisfy the PoC CSP and to protect financial data in transit.
The current server calls Express `cors()` with its default policy; test the
actual browser origin against the selected server and review the server's CORS
policy before any production use. Its authentication, rate limiting, backup,
access control, and provider-secret protections remain the operator's
responsibility.

## Hosting options

| Option                                    | Architecture                                                                     | Operations and reliability                                                                                                                                                                          | Additional cost                                                                                                          | Upstream compatibility                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| A. Vercel frontend + external sync server | Static Vercel React build; separate persistent Actual server and `/data` volume  | Two services, two security boundaries, and cross-origin testing. Durable sync and backups depend wholly on the server host. Vercel improves CDN delivery but not financial persistence.             | The existing Vercel plan may cover static delivery; the sync-server host, volume, backups, and domain still have a cost. | High for the frontend and server independently; no core rewrite.     |
| B. One Docker-based Actual deployment     | Existing sync server serves the built frontend and uses a mounted `/data` volume | Simplest operational shape and same-origin requests. One host still needs TLS, authentication, volume backups, monitoring, and upgrade drills.                                                      | A persistent compute/storage host and domain/TLS arrangement are required.                                               | Highest: matches the existing server packaging and operations guide. |
| C. Browser-only local-first mode          | Static frontend with IndexedDB/SQLite/WASM; no remote server                     | Lowest setup burden, but data is tied to each browser profile. No account service, multi-device sync, bank sync, or server-side backup. Suitable for development and synthetic demonstrations only. | No persistent server cost; normal static hosting cost only.                                                              | Supported browser mode, with intentionally absent server features.   |

For a household budget, option B is the recommended production baseline until
the external sync-server boundary in option A has been separately exercised
with synthetic data, HTTPS, access controls, CORS, and restore testing.

## Validation contract and status

The following checks are required before calling the PoC verified:

1. Build the committed browser target locally with
   `yarn build:browser --skip-translations`.
2. Parse and format-check `vercel.json` locally. The currently published
   `@vercel/config` CLI validates `router.config.ts`, not `vercel.json`; its
   `validate` command therefore fails before reading this static configuration.
   Vercel will perform the authoritative configuration validation when the
   owner imports the project or creates the protected preview.
3. Serve the generated `packages/desktop-client/build` locally and request
   `/`, a non-file client route, `/sql-wasm.wasm`,
   `/data/default-db.sqlite`, and a `kcab` worker file. Record status and MIME
   results.
4. Run the relevant web/core typechecks. The known Node 24 Windows-1252
   parser baseline remains outside this PoC unless a result demonstrates a
   deployment-specific dependency.

This branch does **not** link a Vercel project, change DNS, add environment
variables, or deploy. Its final validation record must report these separately:

| Capability                  | Meaning of success                                                                                      | This configuration alone proves it?                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Frontend deployment         | Vercel builds and serves the static output over HTTPS                                                   | No; owner deployment and URL verification are still required.                                                              |
| Local browser functionality | Browser initializes a synthetic/local budget using IndexedDB/WASM                                       | Partly; local artifact and smoke checks can prove asset delivery, while interactive browser testing proves initialization. |
| Remote synchronization      | Browser signs into and exchanges changes with a durable external server                                 | No; needs the separately hosted server and a synthetic end-to-end test.                                                    |
| Persistent remote storage   | Sync server writes user/server files to a backed-up durable volume                                      | No; Vercel static hosting has no such storage.                                                                             |
| Production readiness        | HTTPS, authentication, CORS, access controls, secret handling, backups, and recovery have been approved | No; requires explicit owner authorization and operational validation.                                                      |

### Current local result (2026-10-17)

- Git for Windows `sh.exe` is now explicitly placed on `PATH`, allowing the
  exact `yarn build:browser --skip-translations` command to pass on Windows.
- Chromium ran the generated static bundle: the browser initialized its worker,
  cross-origin-isolated SQLite/WASM runtime, and synthetic demo budget. The
  deployment readiness test also asserted SPA fallback, the default database,
  WASM MIME type, and the deployed security headers.
- A local HTTPS native-server drill authenticated two independent browser
  profiles, synchronized a synthetic M5 review confirmation across a restart,
  and loaded an isolated `/data` restore. This validates the external-server
  boundary locally, not a Vercel-to-server deployment.
- The `jrvellosos-projects` team now has an empty
  `actuynab-private-preview` project with password protection enabled. No
  deployment, project link, custom domain, environment variable, financial
  data, or server credential was created.

The remaining action is an owner-controlled protected preview deployment from
the Milestone 6 branch and a synthetic connection to a trusted-certificate,
durable external server. The exact setup and gates are in
[Deployment readiness](deployment-readiness.md).

## Windows development note

The root browser packaging command is a POSIX shell script. On Windows 11,
Git for Windows' `sh.exe` must be on `PATH` when running
`yarn build:browser --skip-translations`, exactly as documented in
[Functional validation](validation.md). Vercel's Linux build environment has
the required shell; this Windows requirement does not become a Vercel runtime
dependency.
