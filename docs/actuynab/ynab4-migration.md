# YNAB 4 migration strategy

## Existing capability

Actual already imports a YNAB 4 `.ynab4` archive in
`packages/loot-core/src/server/importers/ynab4.ts`. It reads the archive without
altering it, selects the latest complete YNAB device data, creates a new Actual
budget, then maps entities through generated IDs.

| Source element              | Current handling                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Accounts and state          | Created as on/off-budget and open/closed accounts                                    |
| Categories/groups and notes | Imported, including notes and hidden-category name cleanup                           |
| Payees and transfer targets | Imported; transfer payees map to target accounts                                     |
| Transactions                | Imported with amounts, dates, notes, cleared/reconciled state, categories, and links |
| Splits                      | Imported as subtransactions with linked transfer metadata                            |
| Monthly budgets             | Imported as allocations plus carryover behavior and notes                            |
| Payee rules                 | Not imported; the importer has an explicit TODO                                      |
| Scheduled transactions      | Must be confirmed with fixture-led discovery before claiming support                 |

The upstream documentation records a known split-payee presentation issue:
YNAB 4 stores the payee on the split parent while Actual derives the parent
payee from split payees. Actual supplies an advanced repair action, but
ActuYNAB must report this outcome clearly rather than treat it as invisible.

## Safety rules

- Never write into the source archive or import into an existing user budget.
- Parse and validate the source before creating destination records where
  practical; on failure, abort the destination import using the existing import
  lifecycle.
- Use only synthetic archives in automated tests.
- Preserve source IDs in the validation process as transient mapping data, not
  as a reason to overwrite an existing destination.
- Execute validation after import and before presenting the migration as ready.

## Validation report design

The migration flow should generate a persisted, exportable report containing:

1. Source archive metadata and a non-sensitive file fingerprint.
2. Counts for live accounts, categories/groups, payees, transactions, splits,
   transfers, monthly budgets, notes, schedules, and rules.
3. Destination counts using the same definitions.
4. Per-account opening, imported-transaction, and destination balances in
   Actual integer amounts; report equality or a clear discrepancy.
5. Lists of transformed, skipped, ambiguous, or unsupported source elements
   with a reason and suggested user action.
6. The resulting budget identifier, importer version, and completion/failure
   status—never raw transaction descriptions or credentials in application logs.

The report does not replace reconciliation. It gives users a bounded checklist
to compare source and destination before they begin using the new budget.

## First implementation tasks

- Expand importer tests with synthetic YNAB 4 archives covering each table row
  above, including rejected/corrupt files.
- Establish expected mapping of scheduled transactions from a controlled
  fixture; document the result before implementing a change.
- Implement report calculations from source and destination data without using
  floating-point values.
- Test a repeated import into separate fresh budgets and assert equal results.
- Decide, from evidence, whether to import payee rules or produce a prominent
  unsupported-item report.
