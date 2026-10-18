# ActuYNAB roadmap

This roadmap is ordered by financial safety and existing extension points. It
is a structured backlog, not a promise of dates.

## M0 — repository discovery and baseline — complete

- Fork cloned with `origin` and `upstream` remotes; work is on
  `docs/milestone-0-baseline`.
- Development toolchain installed immutably and baseline package structure,
  importers, migration, rule engine, sync, security, deployment, and backups
  inspected.
- Project architecture, roadmap, operating model, migration plan, import plan,
  and categorization plan added under `docs/actuynab/`.
- Full typecheck passes. Test and lint baseline caveats are recorded in the
  Milestone 0 delivery notes rather than hidden by unrelated changes.

## M1 — functional baseline

**Goal:** establish a reproducible local validation baseline before changing
financial behaviour.

1. Launch a synthetic demo budget in browser and test accounts, transfers,
   splits, scheduled transactions, reconciliation, budgeting, and reports.
2. Exercise CSV, OFX/QFX, and CAMT imports twice against fixtures and record
   expected duplicate behavior.
3. Add a private Docker Compose deployment guide with HTTPS/reverse-proxy
   choices, persistent-volume paths, smoke checks, and backup/restore drills.
4. Resolve or isolate the Windows test-cleanup baseline so CI is reliable.

**Validated outcome:** a new contributor can run the synthetic financial tests,
repeat fixture imports idempotently, and recover synthetic records from an
export without using real financial data.

### M1 implementation result

Milestone 1 is complete. Windows 11 setup is documented, including the Git for
Windows `sh` PATH requirement used by local startup scripts. Focused tests
create a synthetic checking, savings, and credit-card budget with historical
income/expenses, categories, a recurring schedule, a split, and a matched
internal transfer.

CSV, OFX, QIF, and CAMT fixtures are parsed and reconciled twice; the second
pass has no additions or updates, while balances remain exact. Archive
export/import restores synthetic account and transaction records without
changing balances. The Windows test fixture now closes SQLite before deleting
its directory and removes a stale interrupted-test fixture before setup,
resolving the observed core-test `EBUSY`/follow-on `EEXIST` failure. See
[Functional validation](validation.md).

## M2 — YNAB 4 migration assurance — complete

**Goal:** make existing migration observable and safe before adding behaviour.

1. Add synthetic source fixtures covering accounts, transfers, splits, notes,
   categories, schedules, and monthly budgets.
2. Produce a post-import validation report with source/destination account
   balances, transaction counts, transfer/split counts, and explicit gaps.
3. Improve the split-payee repair path and evaluate import of YNAB 4 payee
   rules and scheduled transactions.
4. Add regression tests for repeatability and failures without source mutation.

### M2 implementation result

Milestone 2 adds a complete fictional YNAB 4 archive and runs it through the
existing importer into a fresh, isolated Actual budget twice. The report is
reproducible in Markdown and JSON and validates per-account balances,
transaction counts and aggregate amounts, transfer relationships, split totals,
category/payee mappings, budget allocations and carryover, and reconciliation
states. The source object and ZIP buffer are asserted unchanged, while the
temporary destination budget is removed after each test.

The investigation confirms that schedules and payee rename rules are parsed
but not imported. YNAB account type and account-level reconciliation checkpoint
metadata have no equivalent in Actual’s account model. These are documented
expected model differences, not financial discrepancies. Existing supported
financial behavior required no speculative core-engine changes. See
[YNAB 4 migration](ynab4-migration.md).

## M3 — statement import automation — complete

**Goal:** make recurring Portuguese-bank statement imports safe and reviewable.

1. Define the importer-adapter contract and import-batch audit model.
2. Add fixture-led support for the first nominated Portuguese bank and its
   export format; include European dates, decimal commas, EUR, encoding, and
   statement identifiers.
3. Preserve imported IDs, improve deterministic fallback matching, and surface
   ambiguous duplicates and transfer candidates for confirmation.
4. Build an import preview/history and review queue, then repeat per bank.

### M3 implementation result

Milestone 3 adds a fixture-led normalization and audit layer for explicitly
synthetic ActivoBank-style and Revolut-style CSV rows. It uses Actual's
existing parser and `reconcileTransactions` path, with no direct database
writes, new UI, real statement, account connection, credential, or core
budgeting-engine change. Namespaced source IDs and non-sensitive fallback
fingerprints make repeated and overlapping statement imports financially
idempotent. Multi-candidate fallback matches are withheld for review, and
cross-account transfers are suggestions only until confirmed through Actual's
existing transfer workflow.

Structured JSON and Markdown batch records make each preparation/commit result
auditable without creating an unsynced import-history store. The remaining
work before real bank exports can be supported is private verification of the
actual export schemas, a reviewed column mapping, and a deliberately designed
synced history/review UI. See [Bank statement imports](bank-imports.md).

## M4 — intelligent categorization — complete

**Goal:** improve automation using explainable, deterministic signals first.

Milestone 4 adds a no-write household-classification preview that runs
Actual's existing rules engine first, then applies confirmed mappings,
conflict-free history, recurring patterns, and narrow normalized-merchant
heuristics. Each result names its proposed payee/category, reason, qualitative
confidence, and review requirement.

The fixture covers the shared Activo and Millenium checking accounts, the
three named credit cards, and off-budget Tesla and Home liabilities. Internal
transfers and credit-card bill payments never receive a new expense category.
Loan principal/interest is preserved only when it is already present in a
split; absent amounts are never invented. The service preserves manual
classifications, raw descriptions, monetary and reconciliation fields, and
balances, and it creates no payees or transactions. See
[Categorization](categorization.md).

## M5 — synced import review and confirmation — complete

**Goal:** make statement import, deterministic categorization, explicit human
confirmation, and synced persistence a single safe desktop workflow.

### M5 implementation result

Milestone 5 keeps Actual's import preview and reconciliation path intact, then
opens a responsive **Import review** modal for the returned transaction IDs.
It displays the imported description, date, amount, reason, qualitative
confidence, potential duplicates, transfer candidates, and protected/manual
items. Users can approve safe suggestions in bulk or approve, correct, and
reject individual unprotected suggestions.

The additive synced audit model records source-bank/format labels, a file-free
fingerprint, aggregate processing counts, review status, pending item IDs, and
confirmed mappings. Confirmation writes only existing payee/category IDs using
Actual's normal batch transaction API; no monetary, date, reconciliation,
split, or transfer value can be changed. Reconciled, split, manually
categorized, transfer, credit-card-payment, mortgage, and vehicle-financing
rows are held out of automation.

Focused synthetic tests prove persisted reload behavior, repeat-review
idempotency, correction validation, native CRDT sync messages, and household
safeguards. A private two-device sync-server round trip remains a deployment
validation task, not a claim made by this implementation. See [Synced import
review](import-review.md).

### Hosting proof of concept (complete; not a milestone)

The Vercel PoC adds a static frontend configuration for the existing Vite
browser build. It leaves synchronization, authentication, bank integrations,
and all durable financial storage on a separately hosted Actual sync server;
no Vercel deployment or production approval is implied. The configuration,
validation contract, security boundaries, and Docker/browser-only comparison
are recorded in [Vercel frontend proof of concept](vercel-deployment.md).

## M6 — deployment readiness and end-to-end validation — partially complete

**Goal:** validate a private, supportable self-hosted service.

1. Verify HTTPS, authentication, sync recovery, access controls, persistent
   storage, backup/restore, and routine upgrades in a test environment.
2. Review logs and operational configuration for financial-data exposure.
3. Run focused financial, import, sync, and security regressions before any
   production deployment approval.

### M6 implementation result

The Milestone 6 integration branch safely combines the sibling Vercel PoC and
synced review branches without merging, force-pushing, or deleting any existing
pull request. It adds a Docker/Caddy configuration that builds the fork's
native sync server, retains its durable `/data` model, and defines a protected
static Vercel preview without client-side secrets.

Using only synthetic data, the production browser bundle initialized in real
Chromium with WASM/worker storage and enforced static-host headers; Actual
password authentication, two isolated browser clients, native sync after a
server restart, M5 review confirmation persistence, and an isolated server
data restore all passed locally. A focused regression protects static asset,
SPA fallback, and security-header behavior.

The milestone remains partial because a trusted remote certificate, durable
private host, and protected Vercel preview have not yet been connected to one
another. Supabase was evaluated and deliberately not used: replacing Actual's
server protocol with a Supabase adapter would be a material, unapproved sync
server rewrite. See [Deployment readiness](deployment-readiness.md).

## M7 â€” household budget experience â€” complete

**Goal:** make the shared household model configurable and observable while
keeping Actual's financial engine as the sole source of truth.

### M7 implementation result

The new **Household** page creates or adopts the five on-budget shared
accounts and the Home/Tesla off-budget tracking accounts through Actual's
ordinary account API. It stores a synced account-role mapping, rather than
assuming display names, so import review and categorization can protect
transfers and credit-card payments without a parallel financial model.

An optional, repeatable starter category template adds Housing, Monthly Bills,
Food, Transport, Health & Personal Care, Lifestyle, Sports, Irregular
Expenses, and Savings Goals without duplicating normalized names. The overview
keeps available budget, checking cash, card/financing liabilities, monthly
categorized spending, pending reviews, and upcoming recurring bills visibly
separate. It does not add bank connections, an amortization engine, or inferred
loan splits. Focused synthetic tests validate setup repeatability, persisted
role reload, structural-payment protection, ledger/balance preservation, and
the existing M4/M5 safeguards. See [Household budget
experience](household-budget.md).

## M8 - ActivoBank XLSX import - complete

**Goal:** support the verified ActivoBank Portugal Excel statement safely in
the established import, classification, review, and household workflow.

### M8 implementation result

Milestone 8 adds a narrow, structural XLSX adapter for a one-sheet ActivoBank
export containing `Data Lanc.`, `Data Valor`, `Descrição`, `Valor`, and
`Saldo`. It parses booking and value dates separately, preserves signed EUR
amounts as exact minor units, validates the running balance in either row
order, and rejects unknown or malformed workbook layouts without relying on a
filename. The synthetic in-memory fixture covers card purchase, direct debit,
transfer, MB WAY, ATM cash withdrawal, credit-card bill payment, and refund.

The adapter feeds M3's account-scoped identity and duplicate checks, Actual's
normal reconciliation, M4 classification, M5's synced review records, and M7
account-role protections. Repeated and overlapping files add no financial
transactions; same-date/same-amount legitimate movements remain distinct.
Malformed data is rejected and a running-balance issue is shown as a visible
warning. Browser validation against the local Docker server imported and
reviewed the synthetic workbook, persisted an explicit grocery correction
across a clean client and server restart, and reimported the workbook as zero
transactions with the balance unchanged. No real statement, account,
credential, bank API, or public deployment was used. See [Bank statement
imports](bank-imports.md) and [Functional validation](validation.md).

## M9 — Millennium BCP import safeguards — under review

M9 is intentionally independent from the financing work. Its reviewed branch
adds reusable import safeguards and transfer/card-payment handling while the
project waits for a verified Millennium BCP export structure. It must merge
through its own PR before any bank-specific adapter is claimed supported.

## M10 — financing management — implemented, pending review

**Goal:** make confirmed mortgage and vehicle-financing allocations observable
without changing Actual's off-budget tracking-account or transfer semantics.

M10 adds a Financing management section to Household. It reads the Home/Tesla
outstanding balances from existing ledgers and allows a user to persist a
verified allocation that links existing checking, principal, and optional
separate-insurance movements. Principal, interest, insurance, partial payment,
and explicit refund values are integer metadata only. A deterministic record
prevents duplicate allocation of the same movement; altered evidence is marked
for review rather than repaired or inferred. The UI never creates or updates a
transaction, split, category, transfer, reconciliation state, balance, or loan
schedule. See [Financing management](financing-management.md).

## Deferred evaluation

Open Banking/PSD2 automation, advanced forecasts, PWA capabilities, and a SaaS
offering remain discovery items. Each requires a
separate decision covering consent, provider cost, regulation, privacy,
security, and support burden before implementation.
