# Bank statement import architecture

## Current foundation

Actual's import pipeline already supports CSV, QIF, OFX, QFX, and CAMT in
`packages/loot-core/src/server/transactions/import/`. CSV has a mapping and
preview workflow, configurable date format/delimiter/encoding, separate
inflow/outflow support, amount inversion, and amount multiplication. OFX/QFX
is preferred when available because stable transaction IDs make duplicate
avoidance strongest.

Existing matching first considers an imported ID. Without one, Actual compares
nearby date, amount, and a similar payee, favoring the incoming bank record
when merging. Existing bank sync includes Enable Banking and GoCardless for
European institutions, but those are provider integrations—not a substitute
for Portuguese-bank export support.

## Target pipeline

```text
statement file or provider record
  → format parser
  → bank adapter / normalized transaction
  → deterministic identity and match assessment
  → preview with warnings
  → explicit commit
  → rules and categorization
  → import batch history + review queue
```

Each stage returns structured results. A row can be imported, merged, skipped
as an exact duplicate, or held for review; it is never silently dropped because
it is ambiguous.

## Adapter contract

For a new Portuguese bank, add a narrow adapter with fixture-backed behaviour:

- recognize the bank's exported format/version without relying only on filename;
- normalize encoding, `DD/MM/YYYY`-style dates, decimal commas/thousands
  separators, EUR amounts, debit/credit direction, and raw descriptions;
- preserve a bank transaction ID or a stable source fingerprint when present;
- expose raw description, normalized payee candidate, booking/pending status,
  and source fields needed to explain a decision;
- return warnings for malformed, incomplete, or unrecognized rows;
- never log statement contents outside a deliberately protected diagnostic path.

Adapters produce the existing import-transaction model; they must not write
directly to the database. That keeps import semantics, sync behaviour, and
financial calculations in the established core paths.

## Idempotency and matching policy

1. Same account plus stable bank/imported ID is an exact duplicate or merge
   candidate, according to the existing re-import-deleted preference.
2. Without an ID, compare account, sign-adjusted integer amount, normalized
   booking date within a documented window, and normalized counterparty.
3. One high-confidence candidate may be proposed as a merge; multiple plausible
   candidates are held for user review.
4. A potential internal transfer is a suggestion until both sides or an
   explicit user rule establish the relationship.
5. The completed batch stores counts and decision provenance so a future import
   is explainable and repeatable.

No fallback match uses a floating-point tolerance. Exact amounts stay in
Actual's integer representation.

## Import-batch audit model

ActuYNAB should add an additive model for batch metadata, not raw statement
storage by default. A batch records source type/adapter version, account,
started/finished timestamps, a non-sensitive fingerprint, total rows, and the
counts of imported, merged, exact duplicates, review items, errors, and user
overrides. Item-level records reference destination transactions where one
exists and retain a redacted explanation sufficient for the dashboard.

## Test sequence

For every adapter, add synthetic fixtures for normal, duplicate, malformed,
different-encoding, decimal-comma, pending/booked, transfer-like, and
ambiguous rows. Assert parser output, preview decisions, a repeated import,
and preservation of balances/reconciliation. Add UI tests only after the core
path is deterministic.

## ActivoBank and Revolut status (2026-10-17)

No bank account was connected during this milestone. The facts below separate
what this repository already contains from a connection that still needs a
credentialed, user-authorized check.

| Bank                  | Available now                                                                                                                                                                                                                                                                    | Remaining requirement before a real connection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ActivoBank (Portugal) | The upstream release history records `Banco ActivoBank` as a GoCardless institution with limited history. Actual also has the experimental European Enable Banking provider. Generic CSV, OFX/QFX, QIF, and CAMT file import is already available without a provider connection. | GoCardless Bank Account Data stopped accepting new accounts in July 2025, so it is only a path for an existing GoCardless user. For a new connection, first confirm that ActivoBank appears in the Enable Banking provider catalog for the desired account type, then configure an Actual server with HTTPS, an Enable Banking production application, redirect URL, application ID, and credential file. Confirm available history and consent duration with a synthetic/no-op provider check before importing real statements. |
| Revolut               | The sync server has a `REVOLUT_REVOLT21` GoCardless normalizer, including Revolut Bizum payee handling; Enable Banking fixtures also include Revolut. Generic file imports remain available without credentials.                                                                 | The same GoCardless new-account limitation applies. For a new direct connection, verify Revolut's current availability and account type in the Enable Banking catalog, then complete the experimental provider setup on a self-hosted Actual server. Validate transaction IDs, pending/booked behaviour, currency handling, and history window with a disposable test budget before enabling scheduled sync.                                                                                                                     |

Enable Banking is documented by Actual as experimental and requires an
`actual-server` deployment, HTTPS redirect endpoint, and provider credentials;
its bank list is dynamic, so source-code references are not a guarantee that a
specific personal/business product is currently linkable. Actual documents that
GoCardless Bank Account Data no longer accepts new accounts. See the official
[Enable Banking setup](https://actualbudget.org/docs/advanced/bank-sync/enable-banking/)
and [GoCardless status](https://actualbudget.org/docs/advanced/bank-sync/gocardless/)
before starting a future provider integration.
