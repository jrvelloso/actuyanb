# YNAB 4-inspired experience

Milestone 13 makes the everyday ActuYNAB navigation more account-centred and
adds an optional personal-budget setup template. It is stacked on the M12
branch (which is stacked on M11 and M10); M9 remains independent. The work
uses Actual's existing account, category, budget-sheet, transaction, and sync
mechanisms. It does not create a financial engine, a second database, or a
financial write path from the dashboard.

## Account-centred navigation

The sidebar now keeps **Budget** and **Reports** as the primary financial
navigation. **All Accounts** is the entry point for the native account view;
configured Actual accounts are shown in collapsible **Budget Accounts** and
**Off-Budget Accounts** groups beneath it. Each account continues to use the
native reactive balance binding and its normal account route.

Other existing destinations, including Household, schedules, payees, rules,
and management screens, remain available as secondary navigation. Their
stored visibility and ordering preferences remain in effect. The sidebar does
not hard-code owner account names: its groups reflect the accounts in the
currently opened budget.

## Safe personal setup

The Household overview is a daily financial view. Configuration now lives at
`/household/settings`, so a first-time user is directed to an explicit setup
screen instead of a technical form embedded in the overview.

The screen provides a read-only **Preview Household Setup** step. It resolves
selected accounts against the current budget and reports, for every proposed
account/category/group, whether it will be created, reused, or conflicts. A
preview never writes role mappings, accounts, categories, category budgets, or
transactions. Only **Confirm and apply** calls the existing synced setup
mutation, and it reruns the preview immediately before writing.

Conflicts are deliberately conservative. Setup stops for a missing selected
account, an incompatible on-/off-budget account of the same name, ambiguous
same-name matches, duplicate role selections, and hidden or income category
groups/categories. It never guesses which existing record a user intended.

## Category choices

No category template is applied by default. A user may explicitly select the
legacy shared-household starter template or the following personal
YNAB-4-inspired template:

| Group             | Categories                                                 |
| ----------------- | ---------------------------------------------------------- |
| Car               | Car Insurance, Car Payment, Fuel                           |
| Everyday Expenses | Household Goods, Medical, Restaurants, Spending Money      |
| Food              | Supermarket, Take out food                                 |
| Fun               | Books, Tech                                                |
| Health Care       | Clothing, Doctors, Hair, Health Insurance, Nails, Pharmacy |
| Home              | Home Maintenance, Home Stuff, Mortgage                     |
| Monthly Bills     | Electricity, Housekeeping, Internet, Mobile, Water         |
| Rainy Day Funds   | Birthdays, Christmas, Emergency Fund, Life Insurance       |
| Savings Goals     | Tech, Vacation                                             |
| Sports            | Gym, Paddel                                                |

Matching is by normalized group and category name together. This lets the two
intentional `Tech` categories exist in **Fun** and **Savings Goals** without
being merged. Existing matched records are reused; no budget value, goal,
transaction, hidden state, or order is changed. For the personal template,
new groups/categories are added in deterministic alphabetical order at the
end of their respective existing collections, preserving a user's manually
chosen order for records that already exist.

An optional personal-account convenience toggle only seeds editable account
and transfer-description fields for the existing shared Household model. It
does not identify personal accounts from statement text or automatically
create financial accounts.

## Financial boundaries

- Account balances, transactions, dates, reconciliation states, payees, and
  category amounts are still owned by Actual.
- The dashboard remains read-only and keeps budget availability separate from
  checking, credit-card, and off-budget liability balances.
- Transfers, card repayments, financing principal, and financing allocation
  metadata retain the safeguards from M4, M5, M7, and M10.
- No source bank file, personal account identifier, credential, or real
  financial data is required by this feature or its tests.

## Multi-month budgeting follow-up

M13 intentionally does not add a superficial writable multi-month budget
grid. The current M12 view uses Actual's selected-month budget-sheet cells and
native Budget screen. A safe future implementation must:

1. Read each visible month from the native budget sheet instead of deriving
   envelope balances in React.
2. Reuse Actual's established budget mutation and undo path for an explicit
   edit, rather than writing database rows directly.
3. Preserve carryover, overspending, credit-card, and transfer semantics for
   every displayed month.
4. Provide a virtualized/horizontally scrollable view with keyboard access and
   regression coverage for an edit, undo, reload, and synchronized client.

Until that design is reviewed, the native Budget screen remains the only
writable budget interface.

## Validation

The synthetic core suite verifies template sorting, preview no-write behavior,
first application, repeat application, group-qualified duplicate names,
existing-category reuse, and incompatible account conflict handling. The
sidebar suite verifies the preserved navigation preferences and primary-item
ordering. Run from the repository root:

```text
yarn workspace @actual-app/core vitest --run src/server/transactions/actuynab-household.test.ts src/server/transactions/actuynab-dashboard.test.ts src/server/transactions/actuynab-financing.test.ts src/server/transactions/actuynab-review.test.ts
yarn workspace @actual-app/web vitest --run src/components/sidebar/sidebarMenu.test.ts src/components/household/HouseholdDailyBudget.test.tsx
```

Browser acceptance remains an operational check: use the local Docker/synthetic
budget procedure in [Windows local Docker development](local-docker-development.md)
when a safely controllable Chromium environment is available. No browser run
is inferred from the unit or component results.
