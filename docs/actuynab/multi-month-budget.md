# YNAB 4-inspired multi-month budget grid

Milestone 14 adds an opt-in three-month presentation to Actual's existing
envelope Budget page. It is stacked on M13, so it retains the account-centred
sidebar, Household settings route, and optional category templates from that
work. It is a presentation and interaction extension, not a budget engine.

## Enable or disable it

Open **Budget** and use the **3 months** control in the desktop title bar. The
control is available for an envelope budget and is deliberately local to the
current budget file (`budget.ynab4MultiMonthGrid`). It does not change another
device's layout or write a synced financial preference. Turning it off returns
to Actual's standard responsive month-count control.

The selected start month remains Actual's existing local
`budget.startMonth` preference. The ordinary month picker, previous/next
controls, keyboard left/right shortcuts, and Today control are unchanged.

## Layout and accessibility

The grid retains Actual's category groups, user order, group-collapse state,
hidden-category choice, and category management controls. It fixes three
consecutive native month sheets in the grid:

- On a sufficiently wide desktop view, all three months are visible.
- On a narrower view, the grid scrolls horizontally while the category column
  remains sticky at the left edge.
- Each month uses Actual's existing **Budgeted**, **Spent**, and **Balance**
  columns and the normal available-to-budget summary above it.

The existing `SheetCell` interactions remain in use: click or keyboard-focus a
Budgeted cell, enter a currency-formatted value, press Enter to commit, or
Escape to cancel. The standard vertical Enter/Tab traversal, visible focused
cell, localized currency formatting, screen-reader labels, category activity
links, context menus, and native Undo/Redo controls are retained.

## Financial source of truth

Each visible column is wrapped in Actual's normal month-sheet provider. It
therefore reads native fields such as `budget-<category>`,
`sum-amount-<category>`, `leftover-<category>`, `carryover-<category>`, and
the native available-to-budget summary. React does not sum transactions,
calculate rollover, or infer availability.

An inline edit calls Actual's existing undoable `budget/budget-amount` handler.
The handler writes through the normal CRDT/database mutation path, so existing
sync and reload behavior apply. The grid does not write SQLite directly and it
does not create transactions, transfers, reconciliations, rules, or financing
records.

Consequently, the familiar Actual semantics remain authoritative:

- Category carryover, overspending, future allocations, and credit-card
  treatment are shown exactly as the current Actual budget sheet computes
  them; this project does not emulate YNAB 4 formulas in the UI.
- The available-to-budget summary is a native budget-sheet value, never a sum
  of checking, credit-card, or tracking-account balances.
- Internal transfers and credit-card repayments remain ledger movements rather
  than newly created household spending. Off-budget tracking movements do not
  become on-budget category activity.

This is intentionally a YNAB 4-inspired information layout, not a claim that
Actual and YNAB 4 have identical rollover or credit-card semantics. Users who
need to compare the standard presentation can turn the local preference off.

## Synthetic validation

The focused tests use only synthetic accounts and movements. They verify the
three-month layout boundary and then exercise Actual's native budget handler
across January--March, including a card purchase/payment pair and an
off-budget movement. The financial test asserts native Budgeted, Spent, and
Balance cells, carryover into the next displayed month, and undo/redo of a
February inline allocation.

Run from the repository root:

```text
yarn workspace @actual-app/web vitest --run src/components/budget/DynamicBudgetTable.test.ts
yarn workspace @actual-app/core vitest --run src/server/transactions/actuynab-multimonth-budget.test.ts
```

For an operational browser check, start the existing local synthetic budget
environment, enable **3 months**, edit a category in each visible month, use
Undo then Redo, reload, and confirm the same data in a second synthetic client.
Use the local Docker procedure in [Windows local Docker development](local-docker-development.md);
do not use real bank data. Browser E2E results are recorded separately from
these focused tests.

## Limits

- The grid deliberately uses Actual's existing category rows rather than a
  second virtualized ledger or a new accounting model.
- The three-month mode applies to envelope budgets. Actual's tracking budget
  keeps its existing responsive multi-month presentation.
- The feature has no migration and no new synced entity. A device can opt out
  without changing the budget's financial data.
