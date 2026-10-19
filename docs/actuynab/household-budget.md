# Household budget experience

Milestone 7 adds a focused **Household** page to Actual's desktop/browser
interface. It sets up the shared-household account roles used by the import
review and categorization safeguards, then shows a compact operational
overview. It does not replace Actual's account, transaction, budget, schedule,
reconciliation, or sync model.

All automated tests and examples use fictional data only. Do not enter a real
statement, account number, loan proposal, balance, or credential into this
repository.

## Setup workflow

Open **Household** from the primary sidebar. The initial setup asks for each
role below. For every role, either select a compatible existing Actual account
or give a name for a new zero-balance account. The displayed names and narrow
transfer-description phrases are editable suggestions, not matching rules
hardwired into the importer.

| Role                       | Suggested name       | Actual account type |
| -------------------------- | -------------------- | ------------------- |
| Joint checking             | Activo               | On budget           |
| Joint checking             | Millenium            | On budget           |
| Credit card                | CC-Activo-Classic    | On budget           |
| Credit card                | CC-Millenium-Gold    | On budget           |
| Credit card                | CC-Millenium-Classic | On budget           |
| Mortgage tracking          | Home                 | Off budget          |
| Vehicle-financing tracking | Tesla                | Off budget          |

The setup persists a role-to-Actual-account-ID mapping in the additive synced
tables `actuynab_household_profiles` and
`actuynab_household_account_roles`. M4/M5 classification reads that mapping,
not a display-account name. This means a household can use its own names, and
renaming an account later does not silently change its import safeguards.

Applying the same configuration again is safe: it reuses its existing role
mapping, creates no new financial transaction, does not change an adopted
account's opening balance or on/off-budget type, and ensures that Actual's
normal transfer payee exists. If name matching would find two compatible
accounts, setup stops and asks the user to select the intended one rather than
guessing.

Personal accounts are intentionally absent from this setup. A contribution
from one is still an inflow only when the importing caller explicitly marks it
as an external contribution; free text does not identify a personal account.

## Optional category template

The setup can add a conservative category template. It is optional and
idempotent: groups and categories with the same normalized name are reused,
not duplicated. It never changes an existing category's budget, goal,
transactions, order, or hidden state.

The groups are:

- Housing
- Monthly Bills
- Food
- Transport
- Health & Personal Care
- Lifestyle
- Sports
- Irregular Expenses
- Savings Goals

The template supplies modest starter categories such as Groceries, Fuel,
Healthcare, and Emergency fund. It is a starting point, not a replacement for
the household's existing category taxonomy.

## Financing and card safety

`Home` and `Tesla` are standard **off-budget Actual tracking accounts**. The
Household page does not create an amortization schedule, infer loan terms, or
invent principal/interest values. A loan-payment split remains intact only
when the imported transaction already supplies it. Use Actual's normal
transaction editor for any required ledger correction, then use **Financing
management** to record a documented allocation against those existing
movements. The saved allocation is synced metadata only; it does not alter a
transaction, transfer, split, category, reconciliation state, or account
balance. Leave the allocation absent when the breakdown is unavailable.

See [Financing management](financing-management.md) for the exact validation
rules, insurance handling, refund treatment, and limits.

Credit-card purchases remain categorized spending. A card-payment transfer is
not another expense, and a refund remains a positive categorized transaction
that reduces the monthly net-spending amount. Actual's existing transfer,
split, reconciliation, and category behavior remains authoritative. M5 keeps
reconciled transactions, split rows, manually categorized rows, and
structural transfers out of automated confirmation.

## Overview semantics

The page distinguishes these intentionally different values:

| Value                                   | Meaning                                                                    | Not a substitute for                             |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| Available to budget / Available savings | Actual's current-month budget value, according to the selected budget type | A bank-account balance                           |
| Joint checking balances                 | Ledger totals for configured on-budget checking accounts                   | Budget availability                              |
| Credit-card liabilities                 | Individual card ledger totals and their displayed liability magnitude      | New spending or spendable cash                   |
| Off-budget financing                    | Ledger totals for the configured Home and Tesla tracking accounts          | A loan amortization calculation                  |
| Financing management allocations        | User-verified reference metadata for existing payment movements            | Amounts to add to ledger liabilities or spending |
| Total liabilities                       | Absolute ledger magnitudes for configured cards and financing accounts     | Net worth or cash available to spend             |
| This month's spending                   | Current-month categorized on-budget activity, net of refunds               | Transfers, card payments, or financing movements |

The card and financing totals deliberately use the magnitude of their ledger
balances because Actual tracking accounts have no separate liability type. The
individual ledger balances remain visible so that a household can keep its own
sign convention clear.

Pending import reviews come from M5's synced audit records. Upcoming recurring
bills are read from Actual schedules; the Household page does not create or
post a schedule.

## Financial dashboard

M11 extends the Household page with a selected-month dashboard. It keeps three
value kinds visibly separate: current observed ledger balances, Actual's
calculated budget/ledger totals for the selected month, and user-verified M10
allocation metadata. It never sums cash and liabilities to decide availability
and never adds principal, interest, or insurance metadata to a financial
total. See [Financial dashboard](financial-dashboard.md).

M12 adds a daily category and import-review layer to that dashboard. It reads
the native budget sheet for category budgeted, activity, remaining, and
carryover values; highlights overspending; and reuses the M5 review modal for
explicit user decisions. See [Daily budget experience](daily-budget-experience.md).

## Personal setup and account navigation

M13 places technical role/category configuration in **Household Settings** and
keeps Household itself as the daily overview. Before a user applies a setup,
the core returns a no-write preview of records to create, reuse, or resolve as
conflicts. The preview protects incompatible and ambiguous account matches and
category records that cannot safely be reused. Its optional personal category
template is group-qualified and idempotent; it never changes existing budgets,
goals, orders, or transactions. The sidebar presents native accounts in
collapsible Budget Accounts and Off-Budget Accounts sections while leaving the
configured role mapping as the only source of account-role meaning.

See [YNAB 4-inspired experience](ynab4-experience.md) for the selected
categories, matching/order rules, and multi-month-budget follow-up design.

## Validation

The reusable fictional setup fixture is
`packages/loot-core/src/server/transactions/actuynab-household.fixture.ts`.
It contains only synthetic names and transfer phrases. The integration test
creates a clean in-memory budget, applies the setup and category template,
reloads the persisted mapping, protects a synthetic card payment, and verifies
dashboard values against synthetic transactions without changing a balance.

Run the focused checks from the repository root:

```text
yarn workspace @actual-app/core vitest --run src/server/transactions/actuynab-classification.test.ts src/server/transactions/actuynab-review.test.ts src/server/transactions/actuynab-household.test.ts
yarn workspace @actual-app/web vitest --run src/components/sidebar/sidebarMenu.test.ts
```

This validates local SQLite persistence and CRDT message creation for the new
role records. It does not claim a new remote deployment, bank connection, or
loan-data import. A private two-client sync check remains governed by the
Milestone 6 deployment procedure.

## Known limitations

- The starter template does not include loan calculations, targets, or account
  opening balances.
- Transfer-description phrases are intentionally narrow and must be reviewed
  when a bank changes statement wording.
- The overview is a household operational summary, not a net-worth report or
  an amortization tool.
- The known Windows Node 24 Windows-1252 parser baseline is unrelated and
  remains documented in [Functional validation](validation.md).
