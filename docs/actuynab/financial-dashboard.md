# Financial dashboard

Milestone 11 adds a read-only **Financial dashboard** to the existing
Household page. It is a concise monthly view for a configured shared household;
it is not a new accounting model, net-worth calculation, loan calculator, or
financial data store.

The implementation is intentionally stacked on M10 because it surfaces that
milestone's verified financing-allocation metadata. Until M10 is merged, the
M11 pull request targets the M10 branch rather than `master`.

## What the dashboard reads

The dashboard has one selected month. It uses Actual's existing SQLite views,
budget sheet, schedules, M5 import-audit rows, M7 account-role mapping, and M10
financing metadata:

| Dashboard value                          | Source and semantics                                                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Available to budget / Available savings  | Actual's existing selected-month budget-sheet value (`to-budget` for envelope budgets, `total-saved` for tracking budgets). It is never reconstructed from account balances.                               |
| Monthly income                           | Categorized, on-budget ledger income for the selected month.                                                                                                                                               |
| Budgeted / actual spending               | Existing category budget-sheet values compared with categorized, on-budget expense activity. A fresh month with no initialized sheet is labelled unavailable rather than shown as an invented zero budget. |
| Checking and card balances               | Current ledger balances for M7-configured accounts. Card totals retain the existing displayed liability magnitude, but each ledger sign remains visible.                                                   |
| Home and Tesla                           | Current observed tracking-account ledger balances. These remain off-budget liabilities, not availability or spending.                                                                                      |
| Category trends                          | Net categorized expense activity for the selected month and five preceding months. Refunds reduce their category total.                                                                                    |
| Pending reviews                          | M5's current pending or partially confirmed import-batch count.                                                                                                                                            |
| Financing principal, interest, insurance | Only verified M10 allocation metadata whose payment date is in the selected month. Refund/correction records subtract their verified amounts.                                                              |
| Upcoming transactions                    | Existing Actual schedules; the dashboard never posts or changes them.                                                                                                                                      |

Transfers, uncategorized account-to-account movements, credit-card repayments,
and Home/Tesla tracking transfers have no category and are excluded from monthly
income/spending and category trends. A card purchase remains categorized
spending; a card bill payment does not become a second expense. M10 principal,
interest, and insurance values are shown as **verified manual allocations** and
are never added to an account balance, liability, income, or spending total.

## Navigation

Use the selected-month control or previous/next controls to inspect a month.
Current ledger balances intentionally remain current observations while monthly
flows and allocations follow the selected month. This prevents the dashboard
from pretending it can reconstruct a historical account balance from a partial
view.

Account and financing figures open Actual's existing account transaction views.
Selecting a category trend opens the existing transaction list filtered to the
selected category and month. Scheduled rows open Actual's schedule view, and
the financing cards link to the established **Financing management** section.

M12 extends this navigation with native category-budget drill-downs and an
M5 batch-level review queue. The same selected month is stored through
Actual's existing local `budget.startMonth` preference and can be opened in the
native Budget page. See [Daily budget experience](daily-budget-experience.md).

## Safety guarantees

- The dashboard handler is read-only. It does not call a transaction mutator,
  create a payee/category/account, write an import audit row, or update a
  financing allocation.
- It relies on the configured M7 account IDs, never names, and uses Actual
  integer minor units end to end.
- It does not infer a loan term, rate, future payment, missing split, or
  financing allocation.
- It does not change amounts, dates, reconciled state, transfer links,
  categories, budgets, schedules, account balances, or synchronization data.
- The M10 allocation table remains the only persisted supplemental data; it is
  already additive and CRDT-synced. M11 adds no migration or second database.

## Synthetic regression

Run from the repository root:

```text
yarn workspace @actual-app/core vitest --run src/server/transactions/actuynab-dashboard.test.ts src/server/transactions/actuynab-financing.test.ts src/server/transactions/actuynab-household.test.ts src/server/transactions/actuynab-review.test.ts
yarn workspace @actual-app/core typecheck
yarn workspace @actual-app/web typecheck
```

`actuynab-dashboard.test.ts` creates only fictional accounts and values. It
covers two checking accounts, all three cards, Home/Tesla, categorized income
and spending, a refund, an internal checking transfer, a card payment, a
pending review, verified mortgage principal/interest/separate-insurance, and a
verified vehicle payment. It asserts the selected-month summary, six-month
category trend, current balances, and manual allocation figures. Before and
after ledger balances and allocation-row counts must be identical.

Browser and two-client remote-sync validation are operational checks, not
claimed by these unit tests. Use the localhost procedure in
[Windows local Docker development](local-docker-development.md) with only a
fresh synthetic budget when a safely controllable browser is available. For a
two-client M10 check, record a verified allocation in the first client, wait
for sync, confirm the same allocation and unchanged linked movement balances
in a second isolated browser profile, restart `actual-server`, then repeat the
read from both clients. Do not enter a real account, balance, statement, or
credential into that procedure.

## Limits

- The dashboard is a focused Household view; Actual's detailed reports remain
  the authoritative exploration and reporting interfaces.
- No visual screenshot baseline is asserted until the ActuYNAB visual baseline
  has been approved.
- It does not replace M5's review modal with a bulk approval action. A pending
  review count is a drill-down signal, not permission to alter a transaction.
