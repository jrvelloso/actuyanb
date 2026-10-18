# Categorization strategy

Actual already has a transparent, ordered rules engine. Imported transactions
retain their original `imported_payee`; Actual evaluates enabled `pre`, default,
and `post` rules, including its existing visible learned payee/category rules.
ActuYNAB extends that model with a preview service. It does not add a second
writer, calculation engine, or opaque classifier.

## Decision order

For an uncategorized transaction, Milestone 4 applies these deterministic
layers in order:

1. An enabled Actual rule, evaluated through `runRules`.
2. A user-confirmed normalized-payee/category association supplied to the
   preview.
3. Reliable history: at least three matching normalized payees with one
   non-empty category and no conflicting category.
4. A monthly recurring pattern with one category and no conflict.
5. A narrow, configured merchant heuristic after Milestone 3 normalization.
6. A manual-review result for unknown, incomplete, or conflicting evidence.

The existing Actual rule runner cannot distinguish an automatically learned
visible rule from a hand-authored visible rule. Both remain in the first layer
because changing their precedence would risk overriding a user's current
budget behavior. A future synced provenance model can make that distinction
without changing this safety rule.

Structural transfer detection protects the category layers. A confirmed
internal transfer, credit-card bill payment, or transfer to the `Home` or
`Tesla` off-budget account is not proposed as a household expense, even if an
otherwise matching historical category exists. A manually categorized row is
preserved before all automatic processing.

## Explainable results

`classifyHouseholdTransaction` returns a pure preview with:

- the normalized and proposed payee (an existing payee ID when one is known);
- a proposed category ID when appropriate;
- a named deterministic reason;
- qualitative `high`, `medium`, or `review` confidence; and
- an explicit `requiresManualReview` flag and, for transfers, the target
  account ID.

Confidence is a policy label, not a probability or a percentage. The service
does not change amounts, dates, reconciled/cleared state, account balances,
source descriptions, payees, categories, or transactions. It never creates a
payee; callers must use Actual's established transaction and transfer flows to
apply a reviewed suggestion.

## Household rules

The synthetic fixture models the initial shared household accounts:

- on-budget `Activo`, `Millenium`, `CC-Activo-Classic`,
  `CC-Millenium-Gold`, and `CC-Millenium-Classic`;
- off-budget `Tesla` vehicle financing and `Home` mortgage.

Transfer identification is intentionally configured with exact, normalized
description tokens or an existing Actual transfer payee. A payment to a credit
card produces `credit-card-bill-payment` with no expense category. A payment
to `Home` or `Tesla` produces `off-budget-financing-transfer`; it receives no
invented principal or interest category. When a loan payment already contains
a principal/interest split, the result is `provided-loan-split-preserved` and
the subtransactions are left untouched.

An incoming contribution from a personal account is only classified as income
when the adapter or caller explicitly marks it `externalContribution`. Text
alone is not enough to infer a personal account. Refunds retain their original
positive amount and can use a confirmed merchant/category mapping; they are
not converted into a new expense.

## Synced confirmation in Milestone 5

Milestone 5 supplies the missing confirmation boundary without changing the
classifier's purity. The review modal invokes the preview for transaction IDs
already returned by Actual's reconciled import. A user may approve a safe
suggestion, correct it to an existing payee/category, or reject it. Only an
approved/corrected selection can update the Actual transaction, and that update
contains only `payee` and `category` fields.

The confirmation service records a normalized-payee mapping in an additive,
synced review-decision table. On later imports, those conflict-free decisions
become the second precedence layer described above. Reconciled, split, already
categorized, and structural-transfer rows are not eligible for an automated
write. See [Synced import review](import-review.md) for the audit schema,
workflow, and recovery behavior.

## Data and privacy boundaries

- Original bank descriptions remain in `imported_payee`; normalization is only
  a matching and display candidate.
- The preview service itself has no database writes and stores no source
  statement data. M5 stores only file-free audit metadata, transaction IDs,
  normalized mappings, and explicit user decisions through Actual's synced
  persistence path.
- Confirmed mappings are never inferred from an unreviewed suggestion; they
  exist only after an approved or corrected confirmation.
- No external model or AI service is part of this milestone.

## Validation

`packages/loot-core/src/server/transactions/actuynab-classification.fixture.ts`
contains only fictional household accounts, merchant names, categories,
history, and integer amounts. Its companion test covers rule precedence,
manual corrections, known and unknown merchants, conflicting history, refunds,
splits, internal transfers, credit-card payments, mortgage and vehicle
financing, personal contributions, repeatability, input preservation, and
payee/transaction non-creation.

Run the focused validation from the repository root:

```text
yarn workspace @actual-app/core test:node src/server/transactions/actuynab-classification.test.ts
```

On 2026-10-17, the focused classifier suite passed all six tests. The broader
Actual rules and M1-M3 import/migration regression set also passed 60 tests
together. The normal Vite configuration-loader deprecation warning was present
but does not affect the results.

The follow-on work is private sync-server validation and any later review
history/dashboard refinement. Those changes must retain this module's no-write
preview boundary until the user confirms an action.
