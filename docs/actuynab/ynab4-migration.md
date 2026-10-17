# YNAB 4 migration assurance

Actual already imports a YNAB 4 `.ynab4` ZIP through
`packages/loot-core/src/server/importers/ynab4.ts`. ActuYNAB does not replace
that importer. Milestone 2 adds a synthetic, repeatable validation harness
around it so the importer can be evaluated without exposing a personal budget.

## Verified compatibility

The importer reads the archive, finds the latest YNAB device with complete
knowledge, and uses its `Budget.yfull`. It only reads the archive. The
destination is a newly created Actual budget; an import is never performed
into an already-open user budget.

| Source area                                                                                    | Status                         | Observed handling                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account name, on/off-budget state, and hidden/closed state                                     | Supported                      | Creates Actual accounts with corresponding `offbudget` and `closed` values.                                                                                                                                                                                                                |
| Account type and account reconciliation checkpoint                                             | Expected model difference      | Actual’s core account model has no YNAB 4 account-type classification, and `lastReconciledBalance` is not retained.                                                                                                                                                                        |
| Account balances                                                                               | Supported through transactions | The validator compares the integer ledger total per account; no separate source balance is trusted.                                                                                                                                                                                        |
| Categories, groups, hidden-category cleanup, and category/group notes                          | Supported                      | Imports live outflow groups and categories, removes YNAB’s hidden-category suffix, and imports notes.                                                                                                                                                                                      |
| Payee names and transfer targets                                                               | Supported                      | Normal payees are mapped; transfer payees resolve to the mapped target account.                                                                                                                                                                                                            |
| Payee rename/autofill rules                                                                    | Unsupported                    | `renameConditions`, autofill category, amount, and memo are not imported. The report records this as an expected difference.                                                                                                                                                               |
| Historical transactions and memos                                                              | Supported                      | Live transactions retain integer amount, date, memo, category, payee, and import order. Tombstones are skipped.                                                                                                                                                                            |
| Transfers                                                                                      | Supported                      | The importer pre-allocates transaction IDs, then preserves both sides of a transfer, including transfer children in a split. The report checks relationship pairs and total balances.                                                                                                      |
| Split transactions                                                                             | Partially supported            | Amounts, categories, notes, and transfer links are imported. A non-transfer split child deliberately falls back to the parent payee, matching YNAB 4’s parent-payee representation. Review the existing advanced split-payee repair tool if a migrated split displays an unexpected payee. |
| Monthly budget allocations, carryover, and month/category notes                                | Supported where comparable     | Allocation values are imported in integer amounts. `AffectsBuffer` maps to no carryover and `Confined` maps to carryover. Missing category entries are normalized to zero for each imported month before comparison.                                                                       |
| Negative available category balances                                                           | Partially comparable           | The source allocation and rollover settings are compared. The resulting available balance is a calculation in each product’s budgeting model, so it is not claimed to be byte-for-byte comparable.                                                                                         |
| Scheduled transactions                                                                         | Unsupported                    | `scheduledTransactions` is parsed but not passed to Actual’s schedules API. It is reported explicitly, never silently treated as migrated.                                                                                                                                                 |
| Credit cards                                                                                   | Partially supported            | Credit-card ledger transactions, transfers, and reconciled states are preserved, but the YNAB credit-card account type and YNAB-specific payment workflow are not represented as account metadata.                                                                                         |
| Cleared and reconciled transactions                                                            | Supported                      | `Cleared` and `Reconciled` map to Actual transaction states. A split’s state is parent-owned in YNAB 4 and is therefore validated against the parent state on all Actual child rows.                                                                                                       |
| Budget/file locale, currency, device knowledge, account check numbers, and YNAB-specific flags | Unsupported metadata           | These values are not carried into Actual’s financial model.                                                                                                                                                                                                                                |

## Synthetic validation fixture and report

`ynab4-validation-fixture.ts` builds a fictional three-account archive with
historical income and correction entries, a credit-card purchase, a transfer,
a reconciled split, three months of allocations (including a negative
allocation and carryover settings), notes, a scheduled expense, and a payee
rename rule. It contains no personal data.

`ynab4-validation.test.ts` performs this sequence twice:

1. Creates a disposable `.ynab4` ZIP in memory and checks the source object
   and ZIP buffer are unchanged after parsing.
2. Starts a new disposable Actual budget, imports the parsed source, and reads
   the destination through Actual’s database views.
3. Deletes that temporary destination through the normal abort-import path.
4. Builds the same report on the second run and asserts that it is identical.

The report builder is `buildYnab4MigrationReport` in
`packages/loot-core/src/server/importers/ynab4-validation.ts`. It accepts a
parsed source and a destination snapshot; it does not write source IDs or
report data into a budget. `formatYnab4MigrationReportMarkdown` and
`formatYnab4MigrationReportJson` provide human-readable Markdown and stable,
machine-readable JSON respectively.

Reports deliberately include entity IDs, counts, integer amounts, and reasons
but omit payee names, transaction descriptions, notes, credentials, and raw
archive contents. A report distinguishes:

- **financial** discrepancies (an error): expected value, actual value,
  affected entity, and reason are present for balance, amount, transaction,
  transfer, split, category/payee mapping, allocation, carryover, and
  reconciled-state checks;
- **expected model differences** (information): the source value is visible,
  but the difference is a documented importer/model limitation, such as a
  scheduled transaction or a YNAB account type.

The current fixture validates 3 accounts, 7 parent transactions, 1 split with
2 children, 1 transfer relationship, and an aggregate ledger amount of
`96,250` Actual minor units. Its scheduled transaction and payee rule are
intentionally reported as expected differences. A financial discrepancy test
also proves that an altered destination balance is emitted with expected
`71,250` and actual `1` for `account:account-checking`.

Run the focused assurance suite from the repository root:

```bash
yarn workspace @actual-app/core vitest --run src/server/importers/ynab4.test.ts src/server/importers/ynab4-validation.test.ts
```

The validation helper is intentionally not a new end-user screen or a
background importer. Keeping it test- and API-oriented avoids persisting
financial audit data without a reviewed retention design.

## Safe migration procedure for a personal YNAB 4 budget

1. Make and verify an ordinary YNAB 4 backup. Keep the original ZIP read-only
   and outside the ActuYNAB repository.
2. Export an Actual backup of every existing Actual budget before starting.
   Importing YNAB 4 creates a separate budget, but this preserves an easy
   rollback point.
3. In Actual, use **Switch file > Import file > YNAB 4** and select a copy of
   the archive. Do not open or edit the archive in place during the process.
4. Confirm that Actual opens a newly created imported budget rather than an
   existing budget. If it does not, cancel before making edits.
5. Compare each account’s ledger balance, total transaction count, and the
   combined balance across both sides of every transfer. Check several splits,
   including their child totals and payees.
6. Compare at least the last two budget months’ allocations and carryover
   choices. Treat calculated “available” figures as a model-level review, not
   proof of an importer failure.
7. Reconcile a representative cleared/reconciled transaction in every
   account. Re-create schedules and payee rules manually; review credit-card
   workflow and account-type expectations before treating the imported budget
   as active.
8. Keep both source archive and the pre-migration Actual export until at least
   one backup/restore drill of the imported copy has passed. Delete only the
   disposable imported copy if validation does not pass.

Never use a real archive in the automated test command above. The automated
fixture exists precisely so that migration behavior can be regression-tested
without reading personal financial data.

## Known limitations and next-safe action

No importer behavior was changed in Milestone 2: the synthetic migration
preserves all supported financial values. Schedules and YNAB payee rules are
confirmed unsupported and are surfaced as expected report differences rather
than silently ignored. Account types and reconciliation checkpoints cannot be
faithfully represented by the current Actual account model.

The safest next action is to add a user-reviewed migration checklist/export
path only after deciding where an audit report may be stored and how long it
may retain financial metadata. Do not infer new budgeting-engine behavior from
those unsupported fields.
