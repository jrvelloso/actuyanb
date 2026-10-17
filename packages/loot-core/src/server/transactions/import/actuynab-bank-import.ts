import { createHash } from 'node:crypto';

import {
  matchTransactions,
  reconcileTransactions,
} from '#server/accounts/sync';
import type { ReconcileTransactionsResult } from '#server/accounts/sync';
import { amountToInteger } from '#shared/util';
import type { ImportTransactionEntity } from '#types/models';

/**
 * This module prepares bank-specific statement rows for Actual's existing
 * import-and-reconcile flow. It deliberately does not parse bank files or
 * write to SQLite directly: the existing parser, preview and mutator remain
 * the only persistence path.
 *
 * The supplied field maps describe the synthetic fixtures in this repository.
 * They are examples of an adapter contract, not a claim about either bank's
 * live export layout. A production map must be verified against a statement
 * owned by the person importing it.
 */

export const BANK_IMPORT_PROVIDERS = ['activobank', 'revolut'] as const;
export type BankImportProvider = (typeof BANK_IMPORT_PROVIDERS)[number];

export type BankStatementFormat = 'csv' | 'ofx' | 'qfx' | 'qif' | 'camt';

export type StatementRow = Record<string, string | number | null | undefined>;

export type StatementFieldMap = Readonly<Record<string, string>>;

export type BankStatementTransactionType =
  | 'card-purchase'
  | 'exchange'
  | 'fee'
  | 'refund'
  | 'transfer'
  | 'unknown';

export const ACTIVOBANK_SYNTHETIC_CSV_FIELDS = {
  bookingDate: 'Data movimento',
  credit: 'Crédito',
  debit: 'Débito',
  description: 'Descrição',
  reference: 'Referência',
  transferReference: 'Referência transferência',
  valueDate: 'Data valor',
} as const satisfies StatementFieldMap;

export const REVOLUT_SYNTHETIC_CSV_FIELDS = {
  amount: 'Amount',
  completedDate: 'Completed Date',
  currency: 'Currency',
  description: 'Description',
  exchangeAmount: 'Exchange Amount',
  exchangeCurrency: 'Exchange Currency',
  fee: 'Fee',
  id: 'ID',
  reference: 'Reference',
  state: 'State',
  type: 'Type',
} as const satisfies StatementFieldMap;

export type BankImportIssue = {
  code:
    | 'ambiguous-match'
    | 'currency-not-imported'
    | 'exchange-settlement-amount-used'
    | 'invalid-amount'
    | 'invalid-date'
    | 'missing-description'
    | 'source-duplicate';
  row: number;
};

export type TransferSuggestion = {
  destinationAccountId: string;
  sourceAccountId: string;
  sourceRows: [number, number];
  transferReference: string;
};

export type PreparedBankTransaction = ImportTransactionEntity & {
  sourceFingerprint: string;
  sourceRow: number;
  statementType: BankStatementTransactionType;
  transferReference?: string;
  skipTransaction?: boolean;
};

export type BankImportAuditRecord = {
  accountId: string;
  batchId: string;
  createdAt: string;
  duplicate: number;
  errors: number;
  imported: number;
  parsed: number;
  provider: BankImportProvider;
  skipped: number;
  sourceFingerprint: string;
  sourceFormat: BankStatementFormat;
  totalAmount: number;
  updated: number;
  userConfirmedDecisions: number;
  warnings: number;
};

export type PreparedBankImport = {
  audit: BankImportAuditRecord;
  errors: BankImportIssue[];
  provider: BankImportProvider;
  transactions: PreparedBankTransaction[];
  warnings: BankImportIssue[];
};

export type PrepareBankImportOptions = {
  accountCurrency?: string;
  accountId: string;
  createdAt: string;
  fieldMap: StatementFieldMap;
  provider: BankImportProvider;
  rows: StatementRow[];
  sourceFormat: BankStatementFormat;
};

export type CommitBankImportOptions = {
  /** Source-row fingerprints explicitly accepted after an ambiguity review. */
  approvedSourceFingerprints?: ReadonlySet<string>;
};

export type CompletedBankImport = {
  audit: BankImportAuditRecord;
  errors: BankImportIssue[];
  reconciliation: ReconcileTransactionsResult;
  warnings: BankImportIssue[];
};

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function value(row: StatementRow, fieldMap: StatementFieldMap, field: string) {
  const column = fieldMap[field] ?? field;
  const candidate = row[column];
  if (candidate == null) {
    return null;
  }
  return String(candidate).trim() || null;
}

function parseDecimal(value: string | null): number | null {
  if (value == null) {
    return null;
  }

  const normalized = value
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=.*\.)/g, '')
    .replace(/,(?=.*[,])/g, '');
  const usesCommaDecimal = normalized.includes(',');
  const numeric = Number(
    usesCommaDecimal
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, ''),
  );
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePortugueseDate(value: string | null): string | null {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  const [, day, month, year] = match;
  const date = `${year}-${month}-${day}`;
  return isDate(date) ? date : null;
}

function parseIsoDate(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  const date = value.slice(0, 10);
  return isDate(date) ? date : null;
}

function isDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * These are intentionally narrow merchant rules. Unknown descriptions remain
 * untouched, and the original description is always kept as imported_payee.
 */
export function normalizeBankPayee(description: string): string {
  const normalized = description.trim().replace(/\s+/g, ' ');
  const unaccented = normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (/^COMPRA CARTAO CONTINENTE\b/.test(unaccented)) {
    return 'Continente';
  }
  if (/^COMPRA CARTAO PINGO DOCE\b/.test(unaccented)) {
    return 'Pingo Doce';
  }
  return normalized;
}

function makeImportedId(
  provider: BankImportProvider,
  accountId: string,
  sourceId: string | null,
  fingerprint: string,
): string {
  // Prefix IDs to avoid a provider's reference colliding with an existing OFX
  // or manual-import identifier. The fallback is a hash, never raw statement
  // text.
  const identity = sourceId ? sourceId.replace(/\s+/g, ' ') : fingerprint;
  return `actuynab:${provider}:${accountId}:${identity}`;
}

function makeFingerprint(parts: Record<string, string | number | null>) {
  return hash(JSON.stringify(parts));
}

function createPreparedTransaction({
  accountId,
  amount,
  date,
  description,
  provider,
  sourceId,
  sourceRow,
  statementType,
  transferReference,
}: {
  accountId: string;
  amount: number;
  date: string;
  description: string;
  provider: BankImportProvider;
  sourceId: string | null;
  sourceRow: number;
  statementType: BankStatementTransactionType;
  transferReference?: string | null;
}): PreparedBankTransaction {
  const sourceFingerprint = makeFingerprint({
    accountId,
    amount,
    date,
    description,
    provider,
    sourceId,
    transferReference: transferReference ?? null,
  });

  return {
    account: accountId,
    amount,
    date,
    imported_id: makeImportedId(
      provider,
      accountId,
      sourceId,
      sourceFingerprint,
    ),
    imported_payee: description,
    payee_name: normalizeBankPayee(description),
    sourceFingerprint,
    sourceRow,
    statementType,
    ...(transferReference ? { transferReference } : {}),
  };
}

function classifyActivoBankTransaction(
  description: string,
): BankStatementTransactionType {
  const unaccented = description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (/^TRANSFERENCIA\b/.test(unaccented)) {
    return 'transfer';
  }
  if (/^REEMBOLSO\b/.test(unaccented)) {
    return 'refund';
  }
  if (/^(COMISSAO|TAXA)\b/.test(unaccented)) {
    return 'fee';
  }
  if (/^COMPRA CARTAO\b/.test(unaccented)) {
    return 'card-purchase';
  }
  return 'unknown';
}

function classifyRevolutTransaction(
  sourceType: string | null,
): BankStatementTransactionType {
  switch (sourceType?.toLowerCase()) {
    case 'bank_transfer':
    case 'card_to_card_transfer':
      return 'transfer';
    case 'card_payment':
      return 'card-purchase';
    case 'card_refund':
      return 'refund';
    case 'exchange':
      return 'exchange';
    default:
      return 'unknown';
  }
}

function normalizeActivoBankRow(
  row: StatementRow,
  sourceRow: number,
  options: PrepareBankImportOptions,
):
  | { transaction: PreparedBankTransaction; warnings: BankImportIssue[] }
  | { errors: BankImportIssue[] } {
  const description = value(row, options.fieldMap, 'description');
  const date = parsePortugueseDate(
    value(row, options.fieldMap, 'bookingDate') ??
      value(row, options.fieldMap, 'valueDate'),
  );
  const debit = parseDecimal(value(row, options.fieldMap, 'debit'));
  const credit = parseDecimal(value(row, options.fieldMap, 'credit'));

  const errors: BankImportIssue[] = [];
  if (!description) {
    errors.push({ code: 'missing-description', row: sourceRow });
  }
  if (!date) errors.push({ code: 'invalid-date', row: sourceRow });
  if ((debit == null && credit == null) || (debit != null && credit != null)) {
    errors.push({ code: 'invalid-amount', row: sourceRow });
  }
  if (errors.length > 0) {
    return { errors };
  }

  const amount = amountToInteger(credit ?? -Math.abs(debit ?? 0));
  return {
    transaction: createPreparedTransaction({
      accountId: options.accountId,
      amount,
      date: date as string,
      description: description as string,
      provider: 'activobank',
      sourceId: value(row, options.fieldMap, 'reference'),
      sourceRow,
      statementType: classifyActivoBankTransaction(description as string),
      transferReference: value(row, options.fieldMap, 'transferReference'),
    }),
    warnings: [],
  };
}

function normalizeRevolutRow(
  row: StatementRow,
  sourceRow: number,
  options: PrepareBankImportOptions,
):
  | { transaction: PreparedBankTransaction[]; warnings: BankImportIssue[] }
  | { errors: BankImportIssue[] } {
  const description = value(row, options.fieldMap, 'description');
  const date = parseIsoDate(value(row, options.fieldMap, 'completedDate'));
  const amount = parseDecimal(value(row, options.fieldMap, 'amount'));
  const currency = value(row, options.fieldMap, 'currency');
  const exchangeAmount = parseDecimal(
    value(row, options.fieldMap, 'exchangeAmount'),
  );
  const exchangeCurrency = value(row, options.fieldMap, 'exchangeCurrency');

  const errors: BankImportIssue[] = [];
  if (!description) {
    errors.push({ code: 'missing-description', row: sourceRow });
  }
  if (!date) errors.push({ code: 'invalid-date', row: sourceRow });
  if (amount == null) errors.push({ code: 'invalid-amount', row: sourceRow });
  if (errors.length > 0) {
    return { errors };
  }

  const warnings: BankImportIssue[] = [];
  const accountCurrency = options.accountCurrency?.toUpperCase();
  let settledAmount = amount as number;
  if (accountCurrency && currency?.toUpperCase() !== accountCurrency) {
    if (
      exchangeAmount != null &&
      exchangeCurrency?.toUpperCase() === accountCurrency
    ) {
      settledAmount = exchangeAmount;
      warnings.push({
        code: 'exchange-settlement-amount-used',
        row: sourceRow,
      });
    } else {
      return { errors: [{ code: 'currency-not-imported', row: sourceRow }] };
    }
  }

  const sourceId = value(row, options.fieldMap, 'id');
  const transferReference = value(row, options.fieldMap, 'reference');
  const statementType = classifyRevolutTransaction(
    value(row, options.fieldMap, 'type'),
  );
  const state = value(row, options.fieldMap, 'state')?.toUpperCase();
  const transaction = createPreparedTransaction({
    accountId: options.accountId,
    amount: amountToInteger(settledAmount),
    date: date as string,
    description: description as string,
    provider: 'revolut',
    sourceId,
    sourceRow,
    statementType,
    transferReference,
  });
  transaction.cleared = state !== 'PENDING';

  const transactions = [transaction];
  const fee = parseDecimal(value(row, options.fieldMap, 'fee'));
  if (fee != null && fee !== 0) {
    const feeTransaction = createPreparedTransaction({
      accountId: options.accountId,
      amount: amountToInteger(-Math.abs(fee)),
      date: date as string,
      description: `${description} fee`,
      provider: 'revolut',
      sourceId: sourceId ? `${sourceId}:fee` : null,
      sourceRow,
      statementType: 'fee',
      transferReference,
    });
    feeTransaction.cleared = transaction.cleared;
    transactions.push(feeTransaction);
  }

  return { transaction: transactions, warnings };
}

function sourceFingerprint(options: PrepareBankImportOptions): string {
  return hash(
    JSON.stringify({
      accountId: options.accountId,
      provider: options.provider,
      rows: options.rows,
      sourceFormat: options.sourceFormat,
    }),
  );
}

function batchId(
  options: PrepareBankImportOptions,
  fingerprint: string,
): string {
  return hash(
    JSON.stringify({
      accountId: options.accountId,
      provider: options.provider,
      sourceFingerprint: fingerprint,
      sourceFormat: options.sourceFormat,
    }),
  );
}

/**
 * Prepare a statement without mutating a budget. Call `commitBankImport` only
 * after showing its warnings and review-required rows to a person.
 */
export function prepareBankImport(
  options: PrepareBankImportOptions,
): PreparedBankImport {
  const errors: BankImportIssue[] = [];
  const warnings: BankImportIssue[] = [];
  const transactions: PreparedBankTransaction[] = [];
  const fingerprints = new Set<string>();
  const importedIds = new Set<string>();

  options.rows.forEach((row, index) => {
    const sourceRow = index + 1;
    const normalized =
      options.provider === 'activobank'
        ? normalizeActivoBankRow(row, sourceRow, options)
        : normalizeRevolutRow(row, sourceRow, options);

    if ('errors' in normalized) {
      errors.push(...normalized.errors);
      return;
    }

    const sourceTransactions = Array.isArray(normalized.transaction)
      ? normalized.transaction
      : [normalized.transaction];
    for (const transaction of sourceTransactions) {
      if (
        fingerprints.has(transaction.sourceFingerprint) ||
        (transaction.imported_id != null &&
          importedIds.has(transaction.imported_id))
      ) {
        transaction.skipTransaction = true;
        warnings.push({ code: 'source-duplicate', row: sourceRow });
      }
      fingerprints.add(transaction.sourceFingerprint);
      if (transaction.imported_id != null) {
        importedIds.add(transaction.imported_id);
      }
      transactions.push(transaction);
    }
    warnings.push(...normalized.warnings);
  });

  const fingerprint = sourceFingerprint(options);
  return {
    audit: {
      accountId: options.accountId,
      batchId: batchId(options, fingerprint),
      createdAt: options.createdAt,
      duplicate: 0,
      errors: errors.length,
      imported: 0,
      parsed: options.rows.length,
      provider: options.provider,
      skipped: transactions.filter(transaction => transaction.skipTransaction)
        .length,
      sourceFingerprint: fingerprint,
      sourceFormat: options.sourceFormat,
      totalAmount: transactions.reduce(
        (total, transaction) => total + (transaction.amount ?? 0),
        0,
      ),
      updated: 0,
      userConfirmedDecisions: 0,
      warnings: warnings.length,
    },
    errors,
    provider: options.provider,
    transactions,
    warnings,
  };
}

/**
 * Mark a row for review when fallback reconciliation could choose between two
 * or more existing records. This keeps the existing matcher but prevents its
 * lowest-fidelity pass from silently selecting one of several candidates.
 */
export async function requireReviewForAmbiguousMatches(
  prepared: PreparedBankImport,
): Promise<PreparedBankImport> {
  const matching = await matchTransactions(
    prepared.audit.accountId,
    prepared.transactions,
    { strictIdChecking: false, payeeNameNormalization: 'original' },
  );
  const warnings = [...prepared.warnings];
  const transactions = prepared.transactions.map((transaction, index) => {
    const step = matching.transactionsStep1[index];
    if (
      !transaction.skipTransaction &&
      !step?.match &&
      (step?.fuzzyDataset?.length ?? 0) > 1
    ) {
      const warning = {
        code: 'ambiguous-match' as const,
        row: transaction.sourceRow,
      };
      if (
        !warnings.some(
          issue => issue.code === warning.code && issue.row === warning.row,
        )
      ) {
        warnings.push(warning);
      }
      return { ...transaction, skipTransaction: true };
    }
    return transaction;
  });

  return {
    ...prepared,
    audit: {
      ...prepared.audit,
      skipped: transactions.filter(transaction => transaction.skipTransaction)
        .length,
      warnings: warnings.length,
    },
    transactions,
    warnings,
  };
}

function toReconciliationTransaction(transaction: PreparedBankTransaction) {
  const {
    sourceFingerprint: _sourceFingerprint,
    sourceRow: _sourceRow,
    statementType: _statementType,
    transferReference: _transferReference,
    ...rest
  } = transaction;
  return rest;
}

/**
 * Commit through Actual's existing reconciliation mechanism. Fuzzy matching is
 * deliberately enabled for bank files whose stable identifiers can change; an
 * earlier ambiguity pass keeps multi-candidate matches out of this call unless
 * the caller has recorded an explicit approval.
 */
export async function commitBankImport(
  prepared: PreparedBankImport,
  options: CommitBankImportOptions = {},
): Promise<CompletedBankImport> {
  // Keep the safety guarantee at the committing boundary. Consumers may call
  // the review function early to render a preview, but cannot accidentally
  // bypass it by committing a merely prepared batch.
  const reviewed = await requireReviewForAmbiguousMatches(prepared);
  const approved = options.approvedSourceFingerprints ?? new Set<string>();
  const transactions: PreparedBankTransaction[] = reviewed.transactions.map(
    transaction => {
      const shouldSkip =
        transaction.skipTransaction &&
        !approved.has(transaction.sourceFingerprint);
      if (shouldSkip) {
        return { ...transaction, skipTransaction: true };
      }

      // `skipTransaction` is an importer-only control field. In particular, do
      // not pass `false` through to an insert, where the transaction schema
      // correctly rejects unknown fields.
      const { skipTransaction: _skipTransaction, ...ready } = transaction;
      return ready;
    },
  );
  const reconciliation = await reconcileTransactions(
    reviewed.audit.accountId,
    transactions.map(toReconciliationTransaction),
    { payeeNameNormalization: 'original', strictIdChecking: false },
  );
  const duplicate = reconciliation.updatedPreview.filter(
    preview => preview.ignored,
  ).length;
  const skipped = transactions.filter(
    transaction => transaction.skipTransaction,
  ).length;

  return {
    audit: {
      ...reviewed.audit,
      duplicate,
      errors: reviewed.errors.length,
      imported: reconciliation.added.length,
      skipped,
      updated: reconciliation.updated.length,
      userConfirmedDecisions: reviewed.transactions.filter(
        transaction =>
          transaction.skipTransaction === true &&
          approved.has(transaction.sourceFingerprint),
      ).length,
      warnings: reviewed.warnings.length,
    },
    errors: reviewed.errors,
    reconciliation,
    warnings: reviewed.warnings,
  };
}

/**
 * Suggest, but never create, transfer relationships. Only an explicit shared
 * reference, different accounts and exactly opposite amounts are enough for a
 * suggestion. The caller must use Actual's existing transfer UI to confirm it.
 */
export function suggestTransferPairs(
  source: PreparedBankImport,
  destination: PreparedBankImport,
): TransferSuggestion[] {
  if (source.audit.accountId === destination.audit.accountId) {
    return [];
  }

  const suggestions: TransferSuggestion[] = [];
  for (const transaction of source.transactions) {
    if (!transaction.transferReference || transaction.skipTransaction) continue;
    const candidates = destination.transactions.filter(
      candidate =>
        !candidate.skipTransaction &&
        candidate.transferReference === transaction.transferReference &&
        candidate.amount === -(transaction.amount ?? 0),
    );
    if (candidates.length === 1) {
      suggestions.push({
        destinationAccountId: destination.audit.accountId,
        sourceAccountId: source.audit.accountId,
        sourceRows: [transaction.sourceRow, candidates[0].sourceRow],
        transferReference: transaction.transferReference,
      });
    }
  }
  return suggestions;
}

export function formatBankImportAuditJson(
  audit: BankImportAuditRecord,
): string {
  return JSON.stringify(audit, null, 2);
}

export function formatBankImportAuditMarkdown(
  audit: BankImportAuditRecord,
): string {
  return [
    '# Bank import audit',
    '',
    `- Batch ID: \`${audit.batchId}\``,
    `- Provider: ${audit.provider}`,
    `- Account: \`${audit.accountId}\``,
    `- Source format: ${audit.sourceFormat}`,
    `- Source fingerprint: \`${audit.sourceFingerprint}\``,
    `- Created at: ${audit.createdAt}`,
    '',
    '| Parsed | Imported | Updated | Duplicate | Skipped | Errors | Warnings | Total amount |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${audit.parsed} | ${audit.imported} | ${audit.updated} | ${audit.duplicate} | ${audit.skipped} | ${audit.errors} | ${audit.warnings} | ${audit.totalAmount} |`,
  ].join('\n');
}
