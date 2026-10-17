# ActuYNAB architecture

## Current foundation

Actual Budget is a local-first TypeScript monorepo. The React interface and a
local database server run on the user's device; the optional sync server
coordinates device synchronization rather than becoming the accounting engine.
This separation is retained by ActuYNAB.

```text
React web / desktop / mobile clients
        │ messages and queries
        ▼
loot-core local runtime ───── SQLite budget data
        │ optional CRDT synchronization
        ▼
sync-server ───── server metadata, files, authentication, bank-provider secrets
```

The browser runtime uses a worker to keep database work off the UI thread. The
Electron runtime uses a Node child process. The sync server is an Express
service; it is not a replacement database for budget calculations.

## Primary package boundaries

| Area                                    | Location                                                 | Responsibility                                                                                  |
| --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Financial model and business logic      | `packages/loot-core`                                     | SQLite schema/migrations, budgets, transactions, imports, rules, reports, and platform adapters |
| Web and desktop interface               | `packages/desktop-client`                                | React pages, transaction/import UI, hooks, translations, and E2E tests                          |
| Shared UI                               | `packages/component-library`                             | Theme-aware, accessible components and financial-number presentation                            |
| Synchronization and server integrations | `packages/sync-server`                                   | Authentication, sync, server files, provider credentials, and bank integrations                 |
| Sync protocol                           | `packages/crdt`                                          | Conflict-tolerant device synchronization                                                        |
| Other clients/integrations              | `packages/mobile-client`, `packages/api`, `packages/cli` | Mobile shell, public API, and command-line operations                                           |

## ActuYNAB extension seams

1. **Statement parsing and normalization.** Start in
   `packages/loot-core/src/server/transactions/import/`. Add narrow,
   bank-specific adapters and normalized metadata before the established import
   and merge path; do not fork transaction persistence.
2. **Duplicate and transfer review.** Preserve the existing imported-ID and
   date/amount/payee matching. Add an explicit result model and UI review queue
   for uncertain matches instead of silently changing the matching threshold.
3. **Categorization.** M4's
   `server/transactions/actuynab-classification.ts` invokes the existing
   `transaction-rules.ts` runner, then returns a side-effect-free,
   explainable household preview. Keep provenance and confidence additive; do
   not create a parallel transaction writer or calculation rule.
4. **Migration.** Build validation around `server/importers/ynab4.ts` and its
   tests. Keep source archives read-only and write only into a newly-created
   Actual budget.
5. **Automation UI.** Compose new React views from the component library and
   existing account/rule/import hooks. Reuse translation and responsive
   conventions; do not redesign the entire application.
6. **Synced import review.** M5 adds additive review/audit tables and writes
   them with Actual's `db.insert`/`db.update` CRDT path. The review modal
   receives only IDs returned from Actual's reconciled importer, then applies
   selected existing payee/category IDs through `batchUpdateTransactions`.
   It never stores raw bank files or becomes a transaction database.
7. **Static web hosting.** The existing Vite browser output can be served from
   a static host, including Vercel, when it preserves SPA fallback,
   cross-origin-isolation headers, and the WASM MIME type. This hosts the React
   client and browser SQLite runtime only; keep `packages/sync-server` on a
   separately operated host with durable storage. See
   [Vercel frontend proof of concept](vercel-deployment.md).

## Financial correctness constraints

- Use Actual's integer monetary values throughout; never introduce floating
  point calculations.
- Migrations are additive where possible and must update the schema/API
  contract as required by Actual's migration guidance.
- Imports must be repeatable, deterministic, and traceable. An ambiguity is a
  review item, not a discarded row or a guessed transfer.
- Keep transaction mutations inside established core APIs so sync,
  reconciliation, and views remain consistent.
- Classification previews must not modify amounts, dates, reconciliation,
  balances, source descriptions, payees, categories, or transfers. M5's
  confirmation applies only explicit, user-selected existing payee/category
  values through Actual's established transaction API.
- Sensitive bank credentials remain server-side and are not end-to-end
  encrypted by Actual's bank-sync feature. Private self-hosting is the
  recommended deployment boundary.

## Upstream strategy

`origin` is the ActuYNAB fork and `upstream` is Actual Budget. ActuYNAB changes
should be concentrated in new modules and small integration points, with tests
beside the relevant core or UI code. Before taking upstream updates, compare
`upstream/master`, inspect affected custom seams, integrate on a dedicated
branch, run regression tests, and record any adaptation in these documents.

## Baseline risks to address

| Risk                       | Evidence                                                                                                                       | Planned response                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| YNAB 4 split payees        | Existing importer/docs identify split-payee repair as a known issue                                                            | Add migration validation and a supported repair/report workflow         |
| Import-review retention    | M5 stores a synced, file-free audit batch, item IDs, and decisions; a full multi-device server round trip is not yet automated | Run a private two-device sync verification before production approval   |
| Portuguese bank variance   | M3 has synthetic ActivoBank/Revolut adapter contracts; real export schemas remain unverified                                   | Verify private schemas, then add one reviewed adapter at a time         |
| Classification persistence | M5 persists confirmed mappings and reviewed transaction updates through Actual's CRDT sync path                                | Keep the model additive and validate sync-server behavior privately     |
| Bank-secret exposure       | Upstream docs state provider secrets are not covered by E2E encryption                                                         | Self-host, restrict server access, and document backup/secret handling  |
| Windows test cleanup       | Baseline test teardown can leave SQLite files locked                                                                           | Run CI on Linux; make future Windows tests close handles before cleanup |
