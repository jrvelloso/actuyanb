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
