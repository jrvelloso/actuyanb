# Functional validation

This document is the repeatable Milestone 1 validation procedure. It uses only
synthetic values and local fixtures. Do not substitute a real statement, bank
credential, or exported personal budget into a test command or source file.

## Windows 11 development setup

The validated environment is Node `24.12.0` and Yarn `4.17.1` from the
repository-managed Yarn release. Install Git for Windows and ensure its POSIX
shell is visible to the terminal that starts Actual. `yarn start` reaches a
script with a `#!/bin/bash` shebang, so a plain PowerShell PATH without `sh.exe`
cannot start it.

In PowerShell, add Git for Windows for the current session before installing or
starting the project:

```powershell
$env:Path = 'C:\Program Files\Git\usr\bin;' + $env:Path
Get-Command sh
node --version
yarn --version
yarn install --immutable
```

`Get-Command sh` should resolve to `C:\Program Files\Git\usr\bin\sh.exe`.
For a persistent developer setup, add that directory to the user or system
`PATH` in Windows Environment Variables, then open a new terminal. Git Bash
already provides `sh`; this requirement matters when working from PowerShell or
Windows Terminal.

Useful local checks are:

```powershell
yarn typecheck
yarn workspace @actual-app/core vitest --run src/server/transactions/import/actuynab-validation.test.ts src/server/cloud-import.test.ts src/server/main.test.ts
$env:Path = 'C:\Program Files\Git\usr\bin;' + $env:Path
yarn start
```

The lint command currently reports formatting debt inherited from upstream;
do not mass-reformat unrelated files to make that baseline green. Format only
files changed by the branch with `yarn exec oxfmt <paths>`.

## Synthetic dataset

`packages/loot-core/src/server/transactions/import/actuynab-validation.test.ts`
creates the following in a fresh in-memory Actual database:

- three on-budget accounts: Everyday checking, Rainy-day savings, and Credit
  card;
- income and expense categories for salary, interest, rent, utilities,
  groceries, household, entertainment, and travel;
- historical opening balances, income, rent, and broadband expenses;
- an `Example Broadband` monthly recurring schedule plus two historical
  broadband payments;
- an `Example Market` split of `-8,250` minor units into groceries (`-7,000`)
  and household (`-1,250`);
- a `-50,000` minor-unit checking-to-savings transfer and its generated
  `+50,000` counterpart.

Before statement import, balances are checking `192,750`, savings `550,000`,
and credit `-25,000` minor units. The combined balance is `717,750`; creating
the transfer leaves that combined balance unchanged.

The test fixtures are deliberately fictional:

- `actuynab-m1-checking.csv`: salary and coffee expense;
- `actuynab-m1-credit.ofx`: two credit-card expenses with stable FITIDs;
- `actuynab-m1-savings.qif`: interest income;
- `actuynab-m1-checking.xml`: a CAMT rail expense with an account-servicer
  reference.

They cover the locally supported CSV, OFX, QIF, and CAMT paths. Existing core
parser coverage also covers QFX and TSV; the import dialog accepts QIF, OFX,
QFX, CSV, TSV, and XML/CAMT files.

## Repeatable import validation

Run the focused test command above. It parses each fixture using Actual's
parser and routes normalized transactions through `reconcileTransactions`.
The first pass adds two CSV, two OFX, one QIF, and one CAMT transaction. The
second pass must report zero additions and zero updates for every file.

After the first pass, expected balances are checking `533,585`, savings
`550,425`, and credit `-30,775` minor units. The combined balance is
`1,053,235`. A repeated pass must leave both account counts and this combined
balance unchanged.

For a manual UI smoke check, create an empty local account, choose **Import**,
select a synthetic fixture, map the CSV fields where applicable, inspect the
preview, and import. Re-open the same file and confirm that the review shows no
new transactions before committing anything. Use a new synthetic budget for
each manual run.

## Backup and restore validation

`cloud-import.test.ts` constructs a SQLite archive with fictional checking,
savings, and credit records, calls Actual's `exportBuffer`, restores it through
`importBuffer`, then queries the restored database. The restored account
balances are checking `330,000`, savings `50,000`, and credit `-4,250` minor
units, exactly matching the exported transaction rows.

The corresponding manual drill is:

1. In a synthetic budget, select **Settings > Export data** and save the ZIP.
2. Choose the budget name, then **Switch file > Import file > Actual**.
3. Import the ZIP as a separate copy; do not overwrite the source during the
   drill.
4. Compare account balances, transaction counts, one split, and both sides of
   a transfer before treating the backup as usable.
5. Delete only the disposable restored copy after recording the result.

## Windows test-lifecycle findings

The initial Windows core run exposed `EBUSY` while removing
`test-budget/db.sqlite`; the failed cleanup left the directory in place, so the
next test then failed with `EEXIST` on `mkdir`. The fix is deliberately
test-only: nested cleanup closes the SQLite database before deleting the
directory, and fixture creation removes an interrupted-run directory before
creating it. The focused `main.test.ts` now passes on Windows.

The sync-server suite exposed a second Windows teardown issue: its final
migration removed `test-server-files` while the shared `account.sqlite` handle
was open. The last rollback migration now closes that test/database handle
immediately before removing the directories. This preserves normal SQLite
behaviour and lets the full sync-server suite complete its migration rollback.

## Remaining baseline issue

The existing full core parser suite still has two Windows-1252 expectation
failures on this Node 24.12.0 runtime: `TextDecoder('windows-1252')` decodes
bytes `0x80` and `0x97` as control characters instead of the expected Euro
sign and em dash. The affected existing tests are `handles windows-1252
charset` and `csv import accepts iso-8859-1 as a windows-1252 alias` in
`parse-file.test.ts`. No importer code changed in this milestone, and the new
synthetic CSV/OFX/QIF/CAMT validation passes. Treat this as a separate
cross-runtime encoding investigation; do not update snapshots to accept the
corrupted text.

## Recorded outcomes

On 2026-10-17, the following focused tests passed on Windows 11:

```text
yarn workspace @actual-app/core vitest --run src/server/main.test.ts src/server/transactions/import/actuynab-validation.test.ts src/server/cloud-import.test.ts

Test Files  3 passed (3)
Tests       23 passed (23)
```

The full sync-server validation also passed after the SQLite teardown fix:

```text
yarn workspace @actual-app/sync-server test

Test Files  57 passed (57)
Tests       697 passed (697)
Migrations: DONE (rollback)
```

`yarn typecheck` also passes across the workspaces. The full core suite still
reports the two Windows-1252 baseline failures described above; all M1-focused
tests pass.

The expected out-of-sync-migration diagnostic in one `main.test.ts` scenario
is part of that test's assertion, not a failure. Vite also emits its current
configuration-loader deprecation warning; it does not affect the passing
validation result.

## Milestone 2 YNAB 4 migration validation

The focused YNAB 4 assurance test uses an entirely synthetic `.ynab4` ZIP and
creates a new temporary Actual budget for each run. It verifies that parsing
does not modify either source object or source archive, removes the temporary
destination through the normal abort-import path, and repeats the migration to
assert byte-for-byte equal JSON report data.

Run it with the existing importer regression test:

```text
yarn workspace @actual-app/core vitest --run src/server/importers/ynab4.test.ts src/server/importers/ynab4-validation.test.ts
```

The report covers account balances, transaction count and aggregate amount,
transfers, split totals, category and payee mappings, allocations/carryover,
and reconciliation state. It separately records expected model differences:
YNAB 4 schedules and payee rename rules are not imported; account type and
account reconciliation checkpoint metadata are not stored by Actual. The
current Node 24 Windows-1252 parser baseline issue remains unrelated to this
archive workflow and is intentionally unchanged.

## Milestone 3 bank-import validation

Milestone 3 uses only two clearly labeled synthetic CSV fixtures:
`actuynab-m3-activobank-synthetic.csv` and
`actuynab-m3-revolut-synthetic.csv`. They are not samples copied from a bank,
and their column maps are test contracts rather than declarations of a real
export format.

Run the focused validation from the repository root:

```text
yarn workspace @actual-app/core test:node src/server/transactions/import/actuynab-bank-import.test.ts
```

The test starts from an empty in-memory budget and validates all of the
following through Actual's normal parser and reconciliation path:

- ActivoBank-style `DD/MM/YYYY`, decimal-comma debit/credit transactions,
  reference IDs, and a narrowly normalized `Continente` payee candidate.
- Revolut-style booked/pending status, refund, explicit fee, and an explicit
  EUR settlement amount for a foreign-currency card purchase.
- Integer totals of `-10,984` for the ActivoBank fixture and `7,496` for the
  Revolut fixture, while raw source rows and an unprepared budget remain
  unchanged.
- A repeated import has four exact duplicates and no changed balance; an
  overlapping row without a stable ID updates one existing transaction rather
  than creating another; and a confirmed existing payee remains unchanged.
- Ambiguous same-date/same-amount matches are skipped for review; rerunning a
  source after an interrupted caller-side audit handoff adds no transactions;
  and a reference-matched `-10,000`/`+10,000` transfer suggestion preserves a
  zero combined balance.
- Deterministic audit JSON and Markdown output without raw descriptions or
  source-file data.

Do not substitute a real statement or credential. The new adapter is
intentionally not wired to automatic bank detection or a production source
schema. The current Node 24 Windows-1252 baseline issue is unrelated and
unchanged.

### Recorded M3 outcome

On 2026-10-17 on Windows 11, the focused M3 command passed four tests. The
combined M1/M2/M3 focused regression run passed 13 tests in four files:

```text
yarn workspace @actual-app/core test:node src/server/transactions/import/actuynab-bank-import.test.ts src/server/transactions/import/actuynab-validation.test.ts src/server/importers/ynab4.test.ts src/server/importers/ynab4-validation.test.ts

Test Files  4 passed (4)
Tests       13 passed (13)
```

The wider parser run still reports only the two existing Node 24 Windows-1252
expectation failures described above. The new M3 module does not alter that
parser, and no snapshot was changed to mask the corruption.

## Milestone 5 synced import-review validation

Milestone 5 creates only fictional accounts, categories, payees, and imported
transaction rows. It does not read a real statement, use credentials, connect
to a bank, or require an external sync server.

Run the focused workflow test from the repository root:

```text
yarn workspace @actual-app/core test:node src/server/transactions/actuynab-review.test.ts
```

The test covers this end-to-end local sequence:

1. Create a synthetic Activo account, a credit card, grocery category, and
   fictional categorized Continente history.
2. Add a synthetic imported card purchase and prepare a review/audit batch.
3. Approve the deterministic category suggestion and verify only the existing
   payee/category fields can change; amount, date, and reconciliation state
   remain exact.
4. Reload the review from its synced SQLite rows and verify the decision,
   audit status, and normalized mapping remain available.
5. Prepare the same transaction again and verify the deterministic batch ID
   and unchanged financial-row count.
6. Verify a credit-card bill payment, reconciled row, and split are rejected
   from automated edits and preserve their combined balance.
7. Verify a correction accepts only existing category/payee IDs and creates no
   new payee.
8. Assert the batch, item, and decision records were emitted through Actual's
   native CRDT `messages` datasets.

This is an executed local-persistence and native-sync-protocol test, not a
claim that a remote server synchronized two devices. The remaining private
deployment validation is a compatible sync-server two-device round trip, plus
the normal HTTPS/authentication/backup operational checks. The known Node 24
Windows-1252 parser baseline remains unrelated and unchanged.

## Milestone 6 deployment-readiness validation

Milestone 6 uses only temporary, fictional household data and an isolated
native sync-server data directory. It does not load a bank statement, personal
budget, credential, or production database.

The production browser bundle was built on Windows 11 with Git for Windows'
`sh.exe` ahead of other shells on `PATH`:

```powershell
$env:Path = "C:\Program Files\Git\usr\bin;$env:Path"
yarn build:browser --skip-translations
```

It was then served by the repository static server and validated with a real
Chromium runtime:

```text
E2E_START_URL=http://localhost:4173 E2E_USE_BUILD=true \
  yarn workspace @actual-app/web playwright test \
  e2e/deployment-readiness.test.ts --browser=chromium --workers=1

Test Files  1 passed (1)
Tests       1 passed (1)
```

The check requests the built SQLite WASM and default database assets, follows a
client route through the SPA fallback, asserts cross-origin isolation and the
worker bridge, opens the synthetic demo budget, and asserts the deployment
security headers. The existing onboarding browser regression also passed from
the production bundle:

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

For the native sync drill, two independent Chromium profiles connected to a
temporary HTTPS sync server using its password flow. The first client created
only the synthetic Activo, Millenium, three credit-card, Home, and Tesla
accounts, prepared a fictional categorized import review, and confirmed it.
After a server restart, the second profile authenticated and observed the same
budget. Repeating the test source through the existing M3/M5 regression path
created no duplicate financial rows. A stopped-server archive of the temporary
`/data` directory restored into a different data directory; a separate server
then authenticated a third client, which observed all seven accounts and the
confirmed review state.

The self-signed certificate and browser certificate bypass used for this local
test are test-only. A remotely accessible deployment must use a trusted Caddy
certificate and repeat the complete synthetic procedure from a protected Vercel
preview. See [Deployment readiness](deployment-readiness.md) for the exact
remaining gates and backup procedure.

`docker compose config -q` accepted the supplied private deployment definition
with fictional placeholder values. The local Docker Desktop Linux engine was
not running, so the Caddy container was not started or runtime-validated here;
that remains a target-host preflight rather than a passed local test.
