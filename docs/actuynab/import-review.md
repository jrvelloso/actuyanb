# Synced import review and confirmation

Milestone 5 turns Actual's existing import confirmation and the ActuYNAB
classification preview into one deliberate workflow. It is designed for
synthetic or private local statements only; it does not connect a bank account
or upload a statement.

```text
statement file
  -> Actual import preview and reconciliation
  -> ActuYNAB review queue
  -> explicit user approval/correction/rejection
  -> Actual transaction update plus synced audit and decision records
```

Actual remains the only financial database. The review layer calls Actual's
normal `transactions-import` reconciliation path and its batch transaction
update API. It does not maintain a second transaction store, change the
budgeting engine, or use browser component state as durable storage.

## User workflow

1. Open an account and choose **Import**. Use Actual's existing file parser,
   field mapping, preview, selection, and reconciliation controls.
2. For a CSV or QIF statement, choose the audit source bank in the **Import
   review** section: ActivoBank, Revolut, or Other statement. This identifies
   the audit record only; it does not claim that the generic parser recognized
   a real bank export schema.
3. Complete Actual's normal reconciled import. When rows are added or matched,
   the **Import review** modal opens automatically. The account header also
   provides **Review imports** to reopen the latest pending review after a
   browser refresh or application restart.
4. Inspect each item: original imported description, date, integer amount,
   deterministic reason, qualitative confidence, possible-duplicate marker,
   and transfer/manual-attention status.
5. Use **Approve safe suggestions** only for high-confidence,
   non-duplicate, non-structural suggestions. For other unprotected rows,
   explicitly approve, correct with an existing payee/category, or reject.
6. Choose **Confirm decisions**. The review is saved through Actual's synced
   SQLite/CRDT path. Refreshing or reopening the budget retains both the
   applied transaction fields and the confirmed normalized-payee mapping.

The generic add-only import mode intentionally does not launch a review:
upstream's add-only endpoint returns no created transaction identifiers, so a
precise auditable queue cannot be safely reconstructed. Use the default
**Merge with existing transactions** path for reviewed statement imports.

## Safety rules

- Confirmation may write only an existing transaction's `payee` and
  `category` fields. It never writes money, date, account, cleared state,
  reconciled state, imported description, split amount, or transfer link.
- Reconciled rows, split parents/children, and already categorized rows are
  protected. They are shown but cannot be changed through automation.
- Internal transfers, credit-card bill payments, Home mortgage payments, and
  Tesla financing payments are held out of automated category writes. The
  existing transfer UI remains the only way to create or confirm a transfer.
- A correction can select only an existing Actual payee/category. The review
  layer never creates a duplicate payee. A rejected proposal leaves the
  financial transaction untouched.
- The M4 precedence is retained: Actual rules, confirmed mappings,
  conflict-free history, recurring patterns, narrow heuristics, then manual
  review. Conflicting confirmed mappings remain manual review.

## Synced audit data

Migration `1792273503984_add_actuynab_import_review.sql` adds three additive,
CRDT-synced tables with a single `id` primary key:

| Table                          | Purpose                                                                                                                                                              | Intentionally not stored                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `actuynab_import_batches`      | account, source-bank/format label, timestamp, fingerprint, aggregate parsed/imported/updated/duplicate/skipped/failed/warning counts, review status, and error codes | statement file, path, raw rows, descriptions |
| `actuynab_import_review_items` | batch-to-Actual-transaction reference and possible-duplicate marker                                                                                                  | monetary copies or source rows               |
| `actuynab_review_decisions`    | normalized payee, selected existing payee/category, reason, confidence, user decision, and applied flag                                                              | raw statement or credentials                 |

`source_fingerprint` is a SHA-256 identifier derived from imported identities
and/or fallback financial identity. It supports repeatability without retaining
the original file. It is not a substitute for the upstream reconciliation
rules: repeated statement imports remain financially idempotent because Actual
continues to match imported IDs first and then its existing fallback logic.

The tables are written through `db.insert`/`db.update`, which emit normal CRDT
messages. They therefore synchronize with devices using a compatible Actual
sync server alongside the underlying transaction updates. Older clients defer
unknown synced table messages under Actual's additive migration protocol;
there is no core schema replacement or external service.

## Household setup

The runtime household guard recognizes these exact account names: `Activo`,
`Millenium`, `CC-Activo-Classic`, `CC-Millenium-Gold`,
`CC-Millenium-Classic`, `Tesla`, and `Home`. It uses the intentionally narrow
transfer phrases documented in [Categorization](categorization.md). Rename an
account only after updating this guarded configuration in a future reviewed
change; the review does not infer broad transfer patterns from text.

Personal-account contributions require explicit importer/caller metadata and
are not inferred from a free-text description. Loan principal/interest remains
unchanged unless the imported transaction already contains that split.

## Synthetic validation

Run from the repository root:

```text
yarn workspace @actual-app/core test:node src/server/transactions/actuynab-review.test.ts
```

The test creates a fictional Activo account, credit card, Continente payee,
and grocery history. It verifies preview, approval, correction, a persisted
reload, repeat-review idempotency, source-file-free audit data, native CRDT
message datasets, and protections for a credit-card payment, reconciled row,
and split. It uses no real account, statement, credential, or remote sync
server.

The test proves that the new records use Actual's sync message mechanism. A
full two-device sync-server round trip is not executed by this milestone and
must be completed in a private deployment test before production use.

## Current limitations

- The review follows, rather than replaces, Actual's existing import preview:
  financial import selection is confirmed in the upstream modal first, while
  categorization is confirmed in the next modal.
- Only the default reconciled import path can create an automatic review queue.
- The audit stores an explicit source-bank label selected for CSV/QIF imports;
  it does not autodetect a production bank schema or validate a real export.
- Transfer candidates are protective classifications, not automatically linked
  transfers. Bank account connections and live synchronization are out of
  scope.
