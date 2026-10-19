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
8. **Private operation.** Keep the native sync server, its `/data` volume, and
   Actual authentication intact. `deploy/actuynab-private` builds this fork's
   sync server and uses Caddy only as a TLS reverse proxy. Supabase is not a
   drop-in persistence layer for the server's CRDT/filesystem protocol; do not
   add an adapter without a separately approved compatibility design. See
   [Deployment readiness](deployment-readiness.md).

9. **Household setup and overview.** M7 stores only a synced role-to-Actual
   account mapping and optional template state in additive tables. The setup
   creates or adopts ordinary Actual accounts and transfer payees; it does not
   own balances, transactions, schedules, loan calculations, or a parallel
   database. M4/M5 derive account roles from this mapping, while the Household
   page reads existing ledgers, budget sheets, schedules, and import-audit
   rows. See [Household budget experience](household-budget.md).
10. **Financing allocation metadata.** M10 adds a synced, additive link from
    an explicitly verified checking movement to an existing Home/Tesla
    tracking-account movement. It stores only transaction IDs, integer amounts,
    date, and payment/refund direction; the view reads outstanding balances
    from Actual's ledger. It never writes a transfer, split, account balance,
    reconciliation field, amortization schedule, or parallel financial store.
    See [Financing management](financing-management.md).
11. **Financial dashboard projection.** M11 reads the selected month's Actual
    budget-sheet cells and categorized on-budget ledger rows, M5 pending-review
    count, M7 roles, schedules, and M10 verified allocation metadata. It writes
    no financial or metadata record, adds no migration, and does not derive
    availability from checking/cards/tracking accounts. Current account
    balances remain observed ledger values while month-specific flows are
    calculated from the selected month. See
    [Financial dashboard](financial-dashboard.md).
12. **Daily budget interaction.** M12 reads the same native budget-sheet
    category cells as Actual's Budget view and reuses the existing local
    `budget.startMonth` preference. It opens existing category/account and M5
    review views, but creates no confirmation route or financial mutation.
    See [Daily budget experience](daily-budget-experience.md).
13. **YNAB 4-inspired setup and navigation.** M13 groups the existing native
    account routes in the sidebar without owning account values. Its Household
    setup preview is a core read transaction; the existing configuration
    transaction reruns that preview before applying optional, group-qualified
    category records through Actual's normal category API. No dashboard,
    preview, or sidebar component writes a financial record. See
    [YNAB 4-inspired experience](ynab4-experience.md).
14. **Multi-month native budget grid.** M14 is an opt-in envelope-Budget
    presentation that composes Actual's existing month-sheet providers,
    `SheetCell` editor, and `budget/budget-amount` undoable handler. Its local
    layout preference has no CRDT record, while the allocation mutation keeps
    Actual's normal SQLite/CRDT sync path. It never reimplements availability,
    carryover, transfers, card payments, or tracking-account calculations. See
    [Multi-month budget grid](multi-month-budget.md).

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
- Household account roles must be configured and synced by account ID. Do not
  restore display-name matching as a hidden classifier rule. Off-budget Home
  and Tesla accounts are tracking accounts only; no code may infer loan terms,
  principal/interest amounts, or a payment schedule. Verified M10 allocation
  metadata must stay separate from financial ledger totals and must reference
  existing Actual movements.
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

| Risk                       | Evidence                                                                                                                       | Planned response                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| YNAB 4 split payees        | Existing importer/docs identify split-payee repair as a known issue                                                            | Add migration validation and a supported repair/report workflow                     |
| Import-review retention    | M5 stores a synced, file-free audit batch, item IDs, and decisions; a full multi-device server round trip is not yet automated | Run a private two-device sync verification before production approval               |
| Portuguese bank variance   | M3 has synthetic ActivoBank/Revolut adapter contracts; real export schemas remain unverified                                   | Verify private schemas, then add one reviewed adapter at a time                     |
| Classification persistence | M5 persists confirmed mappings and reviewed transaction updates through Actual's CRDT sync path                                | Keep the model additive and validate sync-server behavior privately                 |
| Bank-secret exposure       | Upstream docs state provider secrets are not covered by E2E encryption                                                         | Self-host, restrict server access, and document backup/secret handling              |
| Windows test cleanup       | Baseline test teardown can leave SQLite files locked                                                                           | Run CI on Linux; make future Windows tests close handles before cleanup             |
| Deployment boundary        | A Vercel build is a static browser runtime, not a durable sync service                                                         | Use native sync server, persistent `/data`, authentication, TLS, and restore drills |
