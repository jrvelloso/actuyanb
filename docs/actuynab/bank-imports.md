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

Milestone 3 returns an additive audit record instead of storing raw statement
content. The record contains source type, account, supplied timestamp, a
non-sensitive fingerprint, total rows and amount, and counts of imported,
updated, exact duplicates, skipped/review items, errors, warnings, and explicit
user approvals. It is produced without manipulating SQLite tables.

Milestone 3 continues to return JSON or Markdown without directly writing
SQLite. Milestone 5 now consumes the reconciled transaction IDs in a separate,
additive synced review flow. Its audit records source-bank/format labels,
file-free fingerprints, aggregate counts, pending review references, and
explicit user decisions through Actual's normal CRDT persistence path. See
[Synced import review](import-review.md). It still does not retain source files
or raw rows.

## Milestone 3 implementation

`packages/loot-core/src/server/transactions/import/actuynab-bank-import.ts`
implements a narrow preparation layer for `activobank` and `revolut`. It
accepts parsed statement rows plus an explicit field map, emits Actual's
existing import-transaction shape, and commits only through
`reconcileTransactions`. It adds no database tables, direct SQLite writes,
credentials, raw-statement persistence, or UI redesign.

The supplied maps are deliberately named
`ACTIVOBANK_SYNTHETIC_CSV_FIELDS` and `REVOLUT_SYNTHETIC_CSV_FIELDS`. They
describe the fictional fixtures in this repository; they do not claim that a
current bank export has these headers. A real statement must first be inspected
privately and its mapping verified before an adapter can be enabled for it.

The layer provides these safeguards:

- Portuguese `DD/MM/YYYY`, decimal-comma debit/credit rows, and stable
  references normalize to Actual integer amounts for ActivoBank-style input.
- Revolut-style rows preserve booked/pending status, model refunds as their
  statement amount, create a separately identifiable fee debit, and use an
  explicit settlement amount only when it agrees with the supplied target
  account currency. An unsupported currency is rejected rather than guessed.
- Raw descriptions remain in `imported_payee`. Narrow merchant rules can
  propose a payee (the synthetic `COMPRA CARTAO CONTINENTE...` row becomes
  `Continente`), but the normal reconciler retains an already-confirmed Actual
  payee on a matched transaction.
- Imported IDs are namespaced by provider and account. Rows without a source ID
  use a SHA-256 fingerprint rather than raw text. A one-candidate fallback may
  update an existing transaction; two or more candidates are skipped with a
  review warning.
- A cross-account transfer is only a suggestion when both rows have the same
  explicit transfer reference, different accounts, and exactly opposite integer
  amounts. The importer must still confirm it in Actual's existing transfer UI.

Each prepared or committed call returns a deterministic
`BankImportAuditRecord`: batch ID, account, provider, source format, supplied
timestamp, non-sensitive source fingerprint, parsed/imported/updated/duplicate
/skipped counts, errors, warnings, total minor-unit amount, and confirmed
review count. `formatBankImportAuditJson` and
`formatBankImportAuditMarkdown` let a caller store or inspect that result
without reading or manipulating SQLite. Neither format includes raw
descriptions, per-row amounts, credentials, or original file content.

### Synthetic fixtures and repeatable validation

The following fixtures contain no personal data and are intentionally labeled
synthetic:

- `packages/loot-core/src/mocks/files/actuynab-m3-activobank-synthetic.csv`
  covers Portuguese dates, decimal commas, debit/credit direction, a merchant,
  fee, refund, and a transfer reference.
- `packages/loot-core/src/mocks/files/actuynab-m3-revolut-synthetic.csv`
  covers booked and pending card rows, refund, fee, EUR settlement for a
  foreign-currency purchase, and the counterpart transfer reference.

Run the test with:

```text
yarn workspace @actual-app/core test:node src/server/transactions/import/actuynab-bank-import.test.ts
```

It proves preparation does not change source rows or a budget; checks integer
totals; repeats the same import without duplicate financial transactions;
imports an overlapping row without its stable ID; protects a confirmed payee;
blocks an ambiguous date/amount fallback; reruns after a simulated lost audit
handoff; and verifies the suggested transfer has a zero combined balance. It
also validates JSON and Markdown audit output.

## Milestone 5 review integration

The existing Actual import dialog remains the parser and first confirmation
step. After a reconciled import returns added or updated transaction IDs, the
desktop client opens **Import review**. The user may identify a CSV/QIF audit
as ActivoBank, Revolut, or Other statement, inspect the M4 classification
reason/confidence, then approve safe suggestions in bulk or individually
approve, correct, or reject the rest.

Repeated statement imports remain governed by Actual's imported-ID and
fallback reconciliation rules. M5 records matched/updated rows as possible
duplicates for review but does not create another financial transaction. An
ambiguous M3 source row remains skipped until its existing importer-specific
review is resolved; M5 never lowers the matching threshold or manufactures a
transfer. The review's audit/mapping persistence, account safeguards, and
reopen-after-refresh behavior are documented in
[Synced import review](import-review.md).

## Milestone 8: verified ActivoBank XLSX export

The desktop **Import** picker now accepts `.xlsx` and recognizes the verified
ActivoBank Portugal account-statement structure. Recognition is structural,
not based on the filename: the workbook must contain exactly one worksheet and
a transaction table with the five normalized headers `Data Lanc.`, `Data
Valor`, `Descrição`, `Valor`, and `Saldo`. The known export places that table
at row 8, but the parser locates the validated header row rather than treating
the row number as an identity claim.

The adapter reads XLSX as a bounded OOXML ZIP, does not modify the source
workbook, and rejects unsafe archives, encrypted/unsupported layouts, missing
headers, malformed date/amount/balance values, absent or non-EUR currency
metadata, and multi-sheet workbooks. It does not execute formulas. A
structurally valid empty statement is a visible warning, not an invented
transaction.

For each movement, the adapter keeps booking date and value date distinct:

- the booking date is the Actual import date;
- the value date is retained as non-financial preview metadata and, when it
  differs, a visible `Value date: YYYY-MM-DD` note;
- the signed EUR amount and running balance are converted directly to integer
  minor units without floating-point arithmetic;
- the original description is retained for Actual's import/review flow, while
  M3 emits a normalized payee candidate and stable, account-scoped imported
  identity; and
- consecutive running balances are checked in either chronological direction.
  An inconsistent balance is a visible warning that requires review; it never
  changes an amount or silently removes a movement.

The only persisted identity is an account-scoped SHA-256 fingerprint of the
financial identity. Raw workbook bytes, source path, account metadata, and
description text are not copied into the audit tables. Exact source duplicates
or ambiguous M3 matches remain visible but initially unchecked in the normal
Actual preview, so a user can decide rather than losing a legitimate movement.

The path remains the established one:

```text
ActivoBank XLSX
  -> structural parser and balance validation
  -> M3 preparation / duplicate assessment
  -> Actual reconciliation
  -> M4 deterministic classification
  -> M5 review and explicit confirmation
  -> synced Actual transaction and audit records
```

Observed descriptions are tagged narrowly as card purchases, direct debits,
bank transfers, MB WAY, cash withdrawals, credit-card payments, refunds, or
fees. The tags are not a transfer-linking or merchant-identity assertion.
Configured M7 household roles still protect internal transfers and recognised
credit-card bill payments from becoming new household spending. Ambiguous
descriptions stay in manual review; no principal/interest amount is inferred.

## Milestone 9: Millennium BCP format discovery and shared safeguards

No authentic Millennium BCP export, sanitized authoritative layout
specification, or bank-published import contract has been supplied to this
repository. Consequently, ActuYNAB does **not** claim that `.xlsx`, `.csv`, or
any other filename is a Millennium BCP statement, does not label an import as
Millennium BCP, and does not include a speculative bank adapter or fixture.
Unknown workbooks remain rejected by the narrow ActivoBank recognizer; they can
still use Actual's existing generic CSV/OFX/QFX/QIF/CAMT paths where the user
explicitly maps and reviews them.

Before a dedicated adapter can be added, obtain a private, sanitized format
description that records only structural facts:

- supported extension(s) and, for spreadsheets, worksheet name/count;
- the exact transaction header text and the table's location or reliable
  structural marker;
- separate booking and value-date fields (or confirmation that one is absent),
  including their date representation;
- description/counterparty, debit/credit or signed-amount, currency, stable
  transaction-reference, and running-balance columns where present; and
- known variants, ordering, pending/reversal conventions, and a statement that
  the described samples contain no personal account or transaction data.

The resulting adapter must have a synthetic fixture based only on those facts,
recognize its own structure rather than its filename, preserve the original
file, and reject unknown variants safely. It must not use a real bank export
as a test artifact.

While that evidence is pending, M9 adds two reusable protections without
changing Actual's persistence or reconciliation logic:

- `suggestHouseholdTransferPairs` receives the synced M7 household account
  roles and emits only a **manual-review** suggestion between the two configured
  joint checking accounts. In addition to M3's existing exact shared-reference
  match, a configured destination phrase can identify an Activo-to-Millenium
  outflow only if there is exactly one same-day, opposite-minor-unit inflow in
  the configured counterpart account. Repeated equal movements are deliberately
  not paired. The helper creates no transfers.
- In M4/M5 review, a generic Portuguese `PAGAMENTO CARTÃO`/`PAGAMENTO CC`
  debit from a configured joint account is not inferred as spending. When the
  persisted role mapping identifies exactly one credit card it is protected as
  that card's payment; where several configured cards could match, it has no
  proposed category and remains a visible manual-review item. A configured
  card-specific phrase remains the stronger, unambiguous signal.

These are household safeguards, not Millennium BCP parsing support. The
existing M3 account-scoped imported IDs, duplicate reconciliation, M5 audit,
and explicit confirmation remain unchanged.

### Synthetic fixture and validation

`actuynab-activobank-xlsx.fixture.ts` constructs a fully synthetic one-sheet
workbook in memory; no binary export or real account information is committed.
It covers booking/value-date differences, card purchase, direct debit,
transfer, MB WAY credit, cash withdrawal, card payment, refund, and running
balances. Focused tests also cover repeat and overlapping imports, reversed
order, same-date/same-amount legitimate movements, exact duplicate source
rows, malformed headers/dates/amounts, non-EUR metadata, empty statements, and
an incorrect running balance.

Run the focused regression from the repository root:

```text
yarn workspace @actual-app/core vitest --run src/server/transactions/import/actuynab-activobank-xlsx.test.ts
```

This implementation intentionally supports only the validated one-sheet OOXML
shape. A different ActivoBank export must be rejected and reviewed before a
new adapter variant is added; it must not be forced through the CSV mapping or
misidentified by its filename.

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
`actual-server` deployment, HTTPS redirect endpoint, an application ID, and a
credential file. It also requires first linking accounts in Enable Banking's
interface. Its bank list is dynamic, so source-code references are not a
guarantee that a specific personal/business product is currently linkable.
Actual documents that GoCardless Bank Account Data no longer accepts new
accounts. No account, credential, or provider API was used for this
investigation. See the official
[Enable Banking setup](https://actualbudget.org/docs/advanced/bank-sync/enable-banking/)
and [bank-sync provider overview](https://actualbudget.org/docs/advanced/bank-sync/)
before starting a future provider integration.
