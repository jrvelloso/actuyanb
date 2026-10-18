# Financing management

Milestone 10 adds a conservative financing-management view for the configured
`Home` mortgage and `Tesla` vehicle-financing tracking accounts. It is an
operational reconciliation aid, not a loan calculator, amortization engine, or
source of accounting truth.

All examples and tests use synthetic movements only. Do not commit a lender
statement, account identifier, loan offer, repayment schedule, or credential.

## Source of truth and synced metadata

Actual's existing off-budget tracking accounts remain the sole source of the
current outstanding balance. Their transactions, transfers, splits, categories,
cleared/reconciled states, and CRDT synchronization continue to use the
upstream engine unchanged.

The additive synced table `actuynab_financing_installments` contains only a
user-verified link between existing Actual transaction IDs and integer
minor-unit allocations:

- the existing joint-checking payment or refund movement;
- the existing Home or Tesla principal movement;
- known principal and interest amounts;
- an optional existing, separately charged insurance movement;
- the existing payment date and a user-confirmed payment/refund direction.

It contains no bank descriptions, raw statement data, lender details, inferred
terms, calculated rates, or repayment schedule. It is written through Actual's
normal `db.insert`/`db.update` CRDT path and therefore follows the budget's
existing sync and backup behavior. Saving or deleting this metadata never
creates, deletes, or updates a financial transaction.

## Verified allocation workflow

Open **Household → Financing management** and select:

1. the configured Home or Tesla tracking account;
2. an existing joint-checking debit for a payment, or credit for a confirmed
   refund/correction;
3. the existing tracking-account movement that represents known principal;
4. verified principal and interest amounts, plus either included insurance or
   a separate existing insurance charge.

The page shows up to 250 recent existing movements for each role. Use Actual's
normal account and transaction views to locate or correct older records; M10
does not manufacture a replacement ledger entry.

The server validates every save, including:

- the selected roles still belong to the synced household profile;
- a payment is a joint-checking movement and principal is in the selected
  tracking account;
- the selected payment/refund direction matches the checking movement sign;
- principal exactly matches the referenced tracking-account movement;
- principal + interest + included insurance equals the payment magnitude;
- a separately charged insurance amount exactly matches its own checking
  movement; and
- one financial movement is not allocated to more than one active financing
  record.

A record has a deterministic ID based on its tracking account and payment
transaction. Saving the same verified allocation again updates that metadata
instead of creating a duplicate. If a referenced movement is edited or removed
later, the record is kept but marked **needs review** and excluded from the
known-allocation totals until the user verifies it again.

## Reading the overview safely

The financing panel deliberately separates values that answer different
questions:

| Value                                  | Meaning                                                                            | It does not mean                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Current ledger balance                 | Current sum of the Home/Tesla Actual ledger                                        | A calculated payoff balance or loan schedule                         |
| Known principal / interest / insurance | Verified metadata from active matching records, net of explicitly recorded refunds | Additional spending, cash, or liability to add to the ledger balance |
| Payment history                        | Links to existing movements and their verified allocation                          | A replacement transaction register                                   |
| Needs review                           | A linked movement changed or disappeared                                           | A financial correction made automatically                            |

The UI never combines these values into a new balance, spending total, or
liability total. This avoids counting a checking transfer, its principal
counterpart, and interest metadata more than once. Existing M5 import-review
protections continue to withhold mortgage and vehicle-financing transfers from
automatic categorization.

## Limits

- No loan term, rate, payment schedule, future principal amount, or missing
  insurance amount is inferred.
- The workflow does not turn an imported payment into a transfer or split. Use
  Actual's normal transaction editor where a financial ledger correction is
  required, then save a verified M10 allocation.
- A selected positive checking movement is a user-confirmed refund/correction;
  M10 does not guess why it was received.
- It does not connect to a bank or store a bank file.
- A private two-client sync-server validation remains an operational test; the
  core tests verify that the table emits native CRDT messages.

## Focused synthetic validation

Run from the repository root:

```text
yarn workspace @actual-app/core vitest --run src/server/transactions/actuynab-financing.test.ts src/server/transactions/actuynab-household.test.ts src/server/transactions/actuynab-review.test.ts
yarn workspace @actual-app/core typecheck
yarn workspace @actual-app/web typecheck
yarn workspace @actual-app/web playwright test e2e/household-financing.test.ts --browser=chromium --workers=1
```

The M10 fixture-less integration test creates a clean fictional household in a
temporary SQLite budget. It proves split payment allocation, partial payment,
separate insurance, a refund, duplicate-reference rejection, changed-evidence
review status, native CRDT messages, idempotent resaving, and unchanged ledger
balances/reconciliation. No actual statement or loan data is needed.

For an isolated browser run on Windows, build first with Git for Windows'
`sh` on `PATH`, serve `packages/desktop-client/build` through the existing
`bin/serve-build.mjs` helper on an unused localhost port, and set
`E2E_START_URL` to that port. This prevents Playwright from reusing an
unrelated Vite server already bound to the default development port.
