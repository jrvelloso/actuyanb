# Daily budget experience

Milestone 12 makes the existing Household dashboard faster to use day to day.
It is stacked on Milestone 11 because it extends that read-only dashboard; its
pull request must therefore target the M11 branch until M10 and M11 are
integrated. It does not depend on the independent Millennium BCP import work.

## Native budget values

For the selected month, the dashboard reads Actual's existing budget-sheet
cells for each visible expense category:

| Display                           | Native Actual value                                   |
| --------------------------------- | ----------------------------------------------------- |
| Budgeted                          | `budget-<category-id>`                                |
| Spent                             | the displayed direction of `sum-amount-<category-id>` |
| Remaining or overspent            | `leftover-<category-id>`                              |
| Carryover indicator               | `carryover-<category-id>`                             |
| Total remaining category balances | `total-leftover`                                      |

Expense activity is stored by Actual as a negative amount, so only its display
direction is inverted for **Spent**. The dashboard neither reconstructs a
budget balance nor calculates carryover. If a budget sheet does not exist for
the month, it reports that state rather than displaying invented zeroes.

The view keeps budget availability, category balances, current ledger account
balances, and off-budget liabilities separate. In particular, Home and Tesla
remain tracking-account observations, and credit-card payments and transfers
do not become new spending.

## Daily workflow

- Previous, next, and month-picker controls use the existing local
  `budget.startMonth` preference. Opening **Open full budget** carries that
  selection to Actual's native Budget page; it introduces no preference store
  or synchronized settings record.
- Negative categories are called out first, while non-zero positive category
  balances remain visible. Each category opens Actual's existing transaction
  view, filtered to that category and selected month.
- Pending import batches are read from the M5 audit queue. **Open review**
  invokes the existing M5 import-review modal for the exact account and batch,
  where a user can approve, correct, or reject a suggestion.
- The queue identifies manual-attention items, protected transfer candidates,
  and protected credit-card bill payments. It never confirms a suggestion
  from the dashboard.

Buttons use the existing accessible Button control and explicit labels. The
layout uses wrapping cards and preserves informative empty and unavailable
states on narrower screens.

## Safety boundary

M12 only reads the ordinary Actual ledger, category/budget-sheet values,
configured M7 roles, and M5/M10 additive records. It does not create or modify
transactions, categories, payees, rules, transfers, budgets, reconciliations,
import audits, or financing allocations. It adds no migration, database, sync
protocol, or financial calculation engine.

## Synthetic validation

Run from the repository root:

```text
yarn workspace @actual-app/core vitest --run src/server/transactions/actuynab-dashboard.test.ts src/server/transactions/actuynab-financing.test.ts src/server/transactions/actuynab-household.test.ts src/server/transactions/actuynab-review.test.ts
yarn workspace @actual-app/web vitest --run src/components/household/HouseholdDailyBudget.test.tsx
yarn workspace @actual-app/core typecheck
yarn workspace @actual-app/web typecheck
```

The core test uses a wholly fictional household. It asserts budgeted, spent,
remaining/overspent, and carryover values from native cells; pending-review
queue details; and unchanged ledger balances and financing metadata after the
read. The component test exercises overspending, carryover text, category
drill-down, and opening the established M5 modal rather than applying a
classification.

Browser E2E is an operational check. When a safely controllable Chromium
environment is available, use a new synthetic local budget to verify keyboard
month controls, responsive layout, review opening, confirmation in the M5
modal, browser reload, and unchanged balance after a repeated import. Do not
infer those browser results from unit tests and do not use real financial data.

## Limits

- The focused category list is an operational overview; Actual's native Budget
  page remains the complete category editor and source of budget actions.
- M12 does not add automatic categorization, transfer matching, or a new bulk
  confirmation path.
- Display formatting uses the existing Actual currency and number preferences.
